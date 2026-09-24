/** Exercise the real owner command, including its pinned Wrangler child process. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import worker from "../worker.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const command = join(root, "report.mjs");
const guard = fileURLToPath(new URL("local-network.cjs", import.meta.url));
const outputs = [".json", ".md", ".csv", ".coverage.csv"];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function localStore(persistTo, databaseID) {
  // Wrangler 4's local D1 command uses this same persistence root and database ID.
  return new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("local fixture")}}',
      compatibilityDate: "2026-09-22",
      resourcePersistencePath: join(persistTo, "v3"),
      d1Databases: { USAGE_DB: databaseID },
      outboundService: () => {
        throw Error("Owner report fixture forbids outbound requests");
      },
    }),
  );
}

function commandEnvironment(directory, violationFile) {
  // Do not forward credentials or the owner's CLI configuration into this fixture.
  const env = {};
  for (const key of [
    "PATH",
    "Path",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "TEMP",
    "TMP",
    "TMPDIR",
  ]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return {
    ...env,
    CI: "true",
    NO_COLOR: "1",
    WRANGLER_SEND_METRICS: "false",
    WRANGLER_LOG_PATH: join(directory, "wrangler.log"),
    XDG_CONFIG_HOME: join(directory, "configuration"),
    NODE_OPTIONS: `--require "${guard.replaceAll("\\", "/")}"`,
    MAIMAI_NETWORK_VIOLATIONS: violationFile,
  };
}

async function missing(path) {
  await assert.rejects(readFile(path), (error) => error.code === "ENOENT");
}

async function snapshot(db) {
  return {
    totals: (
      await db
        .prepare(
          "SELECT * FROM usage_daily ORDER BY day,version,event,page,detail,failure",
        )
        .all()
    ).results,
    coverage: (
      await db
        .prepare("SELECT * FROM usage_coverage ORDER BY day,version")
        .all()
    ).results,
  };
}

test(
  "persisted collector totals reach the actual owner CLI; failed queries emit no report",
  { timeout: 60000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "maimai-owner-report-"));
    const persistTo = join(directory, "state");
    const violationFile = join(directory, "network-violations.txt");
    const env = commandEnvironment(directory, violationFile);
    const config = JSON.parse(
      await readFile(join(root, "wrangler.jsonc"), "utf8"),
    );
    const database = config.d1_databases.find(
      (binding) => binding.binding === "USAGE_DB",
    );
    assert.equal(database.database_id, "00000000-0000-0000-0000-000000000000");
    let mf,
      passed = false;
    try {
      // Verify that the inherited transport guard fails before a non-loopback request.
      const probe = spawnSync(
        process.execPath,
        [
          "-e",
          'const net=require("node:net");for(const run of [()=>net.connect(443,"example.invalid"),()=>new net.Socket().connect([443,"example.invalid"])]){try{run();process.exitCode=1}catch(e){if(e.code!=="ERR_MAIMAI_OFFLINE")throw e}}',
        ],
        {
          cwd: root,
          env: commandEnvironment(
            directory,
            join(directory, "guard-probe.txt"),
          ),
          encoding: "utf8",
          timeout: 10000,
        },
      );
      assert.equal(probe.status, 0, probe.stderr);
      assert.equal(
        await readFile(join(directory, "guard-probe.txt"), "utf8"),
        "non-loopback transport blocked\nnon-loopback transport blocked\n",
      );

      mf = localStore(persistTo, database.database_id);
      const db = await mf.getD1Database("USAGE_DB");
      const schema = await readFile(
        join(root, "migrations", "0001_daily.sql"),
        "utf8",
      );
      for (const sql of schema
        .replace(/--[^\n]*/g, "")
        .split(";")
        .filter((value) => value.trim())) {
        await db.prepare(sql).run();
      }
      for (const [day, events] of [
        [
          "2026-03-08",
          [
            { event: "page_view", page: "charts", detail: "", count: 3 },
            { event: "settings_opened", page: "charts", detail: "", count: 1 },
          ],
        ],
        [
          "2026-03-09",
          [{ event: "page_view", page: "charts", detail: "", count: 2 }],
        ],
      ]) {
        t.mock.timers.enable({
          apis: ["Date"],
          now: new Date(day + "T16:00:00Z"),
        });
        try {
          const request = new Request("https://maimai.party/__usage", {
            method: "POST",
            headers: {
              Origin: "https://maimai.party",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ version: 1, events }),
          });
          assert.equal(
            (
              await worker.fetch(request, {
                USAGE_DB: db,
                USAGE_ENABLED: "true",
              })
            ).status,
            204,
          );
        } finally {
          t.mock.timers.reset();
        }
      }
      for (const [day, status] of [
        ["2026-03-08", "complete"],
        ["2026-03-09", "partial"],
        ["2026-03-10", "off"],
        ["2026-03-11", "complete"],
      ])
        await db
          .prepare(
            "INSERT INTO usage_coverage(day,version,status) VALUES(?,1,?)",
          )
          .bind(day, status)
          .run();
      const before = await snapshot(db);
      await mf.dispose();
      mf = undefined;

      function report(prefix) {
        return spawnSync(
          process.execPath,
          [
            command,
            "--database",
            database.database_name,
            "--persist-to",
            persistTo,
            "--from",
            "2026-03-07",
            "--to",
            "2026-03-11",
            "--activated",
            "2026-03-08",
            "--output",
            prefix,
          ],
          {
            cwd: root,
            env,
            encoding: "utf8",
            timeout: 25000,
            maxBuffer: 2 * 1024 * 1024,
          },
        );
      }
      const prefix = join(directory, "accepted");
      const result = report(prefix);
      assert.equal(result.status, 0, result.stderr);
      const files = Object.fromEntries(
        await Promise.all(
          outputs.map(async (suffix) => [
            suffix,
            await readFile(prefix + suffix),
          ]),
        ),
      );
      const parsed = JSON.parse(files[".json"]);
      assert.equal(parsed.schema_version, "usage-report-1");
      assert.deepEqual(parsed.totals, before.totals);
      assert.deepEqual(
        parsed.coverage.map((row) => [
          row.day,
          row.status,
          row.count,
          row.zero_is_measured,
        ]),
        [
          ["2026-03-07", "unknown", 0, false],
          ["2026-03-08", "complete", 4, true],
          ["2026-03-09", "partial", 2, false],
          ["2026-03-10", "off", 0, false],
          ["2026-03-11", "complete", 0, true],
        ],
      );
      assert.equal(parsed.activation, "2026-03-08");
      assert.match(
        files[".md"].toString(),
        /\| 2026-03-11 \| 1 \| complete \| 0 \|/,
      );
      assert.match(
        files[".md"].toString(),
        /\| 2026-03-10 \| 1 \| off \| unknown \|/,
      );
      assert.match(
        files[".csv"].toString(),
        /"2026-03-08",1,"page_view","charts","","",3/,
      );
      assert.match(
        files[".coverage.csv"].toString(),
        /"2026-03-08",1,"complete",4,true,"2026-03-08T05:00:00.000Z","2026-03-09T04:00:00.000Z"/,
      );
      await missing(violationFile);

      // Reopen persisted state: successful owner SELECTs must not modify the database.
      mf = localStore(persistTo, database.database_id);
      const reopened = await mf.getD1Database("USAGE_DB");
      assert.deepEqual(await snapshot(reopened), before);
      await reopened.prepare("DROP TABLE usage_coverage").run();
      await mf.dispose();
      mf = undefined;
      const failedPrefix = join(directory, "failed");
      const failed = report(failedPrefix);
      assert.equal(failed.status, 1, failed.stderr);
      assert.match(
        failed.stderr,
        /Usage report failed; no complete report is available/,
      );
      for (const suffix of outputs) {
        await missing(failedPrefix + suffix);
        assert.deepEqual(await readFile(prefix + suffix), files[suffix]);
      }
      await missing(violationFile);
      t.diagnostic(
        JSON.stringify({
          collector_rows: before.totals.length,
          received_count: 6,
          coverage_states: ["complete", "partial", "off", "unknown"],
          actual_owner_cli: true,
          actual_wrangler_query: true,
          failed_query_outputs: 0,
          report_hashes: Object.fromEntries(
            outputs.map((suffix) => [suffix, digest(files[suffix])]),
          ),
        }),
      );
      passed = true;
    } finally {
      await mf?.dispose();
      if (passed) {
        const resolved = await realpath(directory),
          temporaryRoot = await realpath(tmpdir());
        assert.ok(
          resolved.startsWith(temporaryRoot + sep) &&
            basename(resolved).startsWith("maimai-owner-report-"),
        );
        await rm(resolved, { recursive: true, force: true });
      } else
        t.diagnostic(
          "Retained fictional owner-report failure evidence: " + directory,
        );
    }
  },
);
