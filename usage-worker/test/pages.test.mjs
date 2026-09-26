/** Compile the actual Pages router and cross a local service binding into a separate D1. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const wrangler = join(
  dirname(require.resolve("wrangler/package.json")),
  "bin/wrangler.js",
);
const origin = "https://maimai-party-staging.pages.dev";
const body = JSON.stringify({
  version: 1,
  events: [{ event: "page_view", page: "charts", detail: "", count: 1 }],
});
test(
  "compiled private Pages route forwards only permitted headers to the existing collector and separate D1",
  { timeout: 30000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "maimai-staging-pages-"));
    const violations = join(directory, "network-violations.txt");
    const commandEnv = {};
    for (const key of [
      "PATH",
      "Path",
      "SystemRoot",
      "SYSTEMROOT",
      "WINDIR",
      "TEMP",
      "TMP",
      "TMPDIR",
    ])
      if (process.env[key] !== undefined) commandEnv[key] = process.env[key];
    Object.assign(commandEnv, {
      CI: "true",
      NO_COLOR: "1",
      WRANGLER_SEND_METRICS: "false",
      WRANGLER_HIDE_BANNER: "true",
      WRANGLER_LOG_PATH: join(directory, "wrangler.log"),
      XDG_CONFIG_HOME: join(directory, "configuration"),
      NODE_OPTIONS: `--require "${join(root, "test/local-network.cjs").replaceAll("\\", "/")}"`,
      MAIMAI_NETWORK_VIOLATIONS: violations,
    });
    let mf,
      passed = false;
    try {
      const compiled = spawnSync(
        process.execPath,
        [
          wrangler,
          "pages",
          "functions",
          "build",
          join(root, "pages/functions"),
          "--project-directory",
          join(root, "pages"),
          "--outdir",
          join(directory, "pages-worker"),
        ],
        {
          cwd: directory,
          env: commandEnv,
          encoding: "utf8",
          timeout: 15000,
        },
      );
      await writeFile(
        join(directory, "compile.txt"),
        compiled.stdout + compiled.stderr,
      );
      assert.equal(compiled.status, 0, compiled.stderr);
      await assert.rejects(
        readFile(violations),
        (error) => error.code === "ENOENT",
      );
      const collector = await build({
        stdin: {
          contents: `import collector from './staging.ts';
        export default {fetch(request, env) {
          // Assert at the receiving service boundary, before invoking unchanged collector logic.
          for (const name of request.headers.keys())
            if (!['content-type', 'origin', 'dnt', 'sec-gpc', 'transfer-encoding', 'content-length'].includes(name)) return new Response(name, {status: 599});
          return collector.fetch(request, env);
        }}`,
          resolveDir: root,
        },
        bundle: true,
        write: false,
        format: "esm",
        target: "es2022",
      });
      const outboundService = () => {
        throw Error("Private staging fixture forbids external requests");
      };
      let staticRequests = 0;
      mf = new Miniflare(
        convertV4MiniflareOptions({
          resourcePersistencePath: join(directory, "state"),
          workers: [
            {
              name: "pages",
              compatibilityDate: "2026-09-25",
              compatibilityFlags: ["nodejs_compat"],
              modules: true,
              scriptPath: join(directory, "pages-worker/index.js"),
              modulesRoot: join(directory, "pages-worker"),
              outboundService,
              serviceBindings: {
                USAGE_COLLECTOR: "collector",
                ASSETS: () => {
                  staticRequests++;
                  return new Response("fictional static asset");
                },
              },
            },
            {
              name: "collector",
              compatibilityDate: "2026-09-22",
              modules: true,
              script: collector.outputFiles[0].text,
              outboundService,
              d1Databases: { USAGE_DB: "staging-bridge-test" },
              bindings: { USAGE_ENABLED: "true" },
            },
          ],
        }),
      );
      const db = await mf.getD1Database("USAGE_DB", "collector");
      const schema = await readFile(
        join(root, "migrations/0001_daily.sql"),
        "utf8",
      );
      for (const sql of schema
        .replace(/--[^\n]*/g, "")
        .split(";")
        .filter((sql) => sql.trim()))
        await db.prepare(sql).run();
      const send = (path = "/__usage", options = {}) =>
        mf.dispatchFetch(origin + path, {
          method: "POST",
          body,
          ...options,
          headers: {
            Origin: origin,
            "Content-Type": "application/json",
            ...options.headers,
          },
        });
      const accepted = await send("/__usage", {
        headers: {
          Cookie: "CF_Authorization=PRIVATE-SENTINEL",
          Authorization: "Bearer PRIVATE-SENTINEL",
          "Cf-Access-Jwt-Assertion": "PRIVATE-SENTINEL",
          "Cf-Access-Authenticated-User-Email": "PRIVATE-SENTINEL",
          "Cf-Connecting-Ip": "192.0.2.1",
          "X-Forwarded-For": "192.0.2.1",
          Referer: "PRIVATE-SENTINEL",
        },
      });
      assert.equal(accepted.status, 204, await accepted.text());
      assert.equal(
        (
          await db
            .prepare("SELECT SUM(count) AS count FROM usage_daily")
            .first()
        ).count,
        1,
      );
      for (const headers of [{ DNT: "1" }, { "Sec-GPC": "1" }])
        assert.equal((await send("/__usage", { headers })).status, 204);
      for (const path of ["/__usage/", "/__usage?private=1"])
        assert.equal((await send(path)).status, 404);
      assert.equal(
        (
          await send("/__usage", {
            headers: { Origin: "https://maimai.party" },
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await send("/__usage", {
            body: body.replace("page_view", "PRIVATE-SENTINEL"),
          })
        ).status,
        400,
      );
      assert.equal(
        (await send("/__usage", { method: "GET", body: undefined })).status,
        405,
      );
      assert.equal(
        (
          await mf.dispatchFetch("https://maimai.party/__usage", {
            method: "POST",
            body,
            headers: {
              Origin: "https://maimai.party",
              "Content-Type": "application/json",
            },
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await db
            .prepare("SELECT SUM(count) AS count FROM usage_daily")
            .first()
        ).count,
        1,
      );
      assert.equal(
        await (
          await mf.dispatchFetch(origin + "/catalogs/fictional.json")
        ).text(),
        "fictional static asset",
      );
      assert.equal(
        staticRequests,
        1,
        "the Pages assets fallback remains separate",
      );
      const rows = (await db.prepare("SELECT * FROM usage_daily").all())
        .results;
      assert.ok(!JSON.stringify(rows).includes("PRIVATE-SENTINEL"));
      passed = true;
    } finally {
      await mf?.dispose();
      if (passed) {
        const resolved = await realpath(directory),
          tempRoot = await realpath(tmpdir());
        assert.ok(
          resolved.startsWith(tempRoot + sep) &&
            basename(resolved).startsWith("maimai-staging-pages-"),
        );
        await rm(resolved, { recursive: true, force: true });
      } else t.diagnostic("Retained private staging failure: " + directory);
    }
  },
);
