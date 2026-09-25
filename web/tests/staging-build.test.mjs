import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const web = fileURLToPath(new URL('..', import.meta.url));
const assets = fileURLToPath(new URL('../../src/maimai_intelligence/assets/', import.meta.url));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function productionInventory() {
  const raw = await readFile(join(assets, 'browser-assets.json'));
  const manifest = JSON.parse(raw);
  return {
    manifest: hash(raw),
    compatibility: hash(await readFile(join(web, 'generated-assets.json'))),
    assets: Object.fromEntries(
      await Promise.all(
        Object.keys(manifest.assets).map(async (path) => [
          path,
          hash(await readFile(join(assets, path))),
        ]),
      ),
    ),
  };
}
test(
  'staging build uses shared entries and an exclusive collector without altering production',
  { timeout: 30000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'maimai-staging-build-'));
    const output = join(directory, 'browser');
    let passed = false;
    const before = await productionInventory();
    const run = (destination) =>
      spawnSync(process.execPath, ['build.mjs', '--staging-output', destination], {
        cwd: web,
        encoding: 'utf8',
        timeout: 20000,
      });
    try {
      const result = run(output);
      assert.equal(result.status, 0, result.stderr);
      const raw = await readFile(join(output, 'browser-assets.json'));
      const manifest = JSON.parse(raw);
      const receipt = JSON.parse(await readFile(join(output, 'staging-build.json')));
      assert.equal(receipt.usage_origin, 'https://maimai-party-staging.pages.dev');
      assert.equal(receipt.shared_entry, 'web/src/browser-entry.ts');
      assert.equal(receipt.usage_adapter, 'web/src/usage-staging.ts');
      assert.equal(receipt.production_manifest_sha256, before.manifest);
      assert.equal(receipt.staging_manifest_sha256, hash(raw));
      assert.deepEqual(Object.keys(manifest.entries).sort(), ['hosted', 'offline']);
      assert.ok(manifest.preloads.length > 0);
      assert.equal(new Set(manifest.preloads).size, manifest.preloads.length);
      for (const path of manifest.preloads) {
        assert.ok(manifest.assets[path]);
        assert.ok(!Object.values(manifest.entries).includes(path));
      }
      for (const [path, expected] of Object.entries(manifest.assets)) {
        const bytes = await readFile(join(output, path));
        assert.equal(hash(bytes), expected.sha256);
        assert.equal(bytes.length, expected.bytes);
      }
      const hosted = (await readFile(join(output, manifest.entries.hosted))).toString();
      assert.ok(hosted.includes('https://maimai-party-staging.pages.dev'));
      // Static snapshot manifest is enough to prove neither existing bundle was overwritten.
      assert.deepEqual(await productionInventory(), before);
      assert.notEqual(run(output).status, 0);
      assert.notEqual(run(join(assets, 'must-not-create-staging')).status, 0);
      assert.deepEqual(await productionInventory(), before);
      t.diagnostic(
        JSON.stringify({
          production_manifest: before.manifest,
          staging_manifest: hash(raw),
          profile: receipt.schema_version,
        }),
      );
      passed = true;
    } finally {
      if (passed) {
        const resolved = await realpath(directory),
          temporaryRoot = await realpath(tmpdir());
        assert.ok(
          resolved.startsWith(temporaryRoot + sep) &&
            basename(resolved).startsWith('maimai-staging-build-'),
        );
        await rm(resolved, { recursive: true, force: true });
      } else t.diagnostic('Retained staging build failure evidence: ' + directory);
    }
  },
);
