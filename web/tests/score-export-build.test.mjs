import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateBrowserAssetSizes } from '../build-graph.mjs';

test('generated hosted graph preloads startup while preserving lazy export artwork', async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL('../../src/maimai_intelligence/assets/browser-assets.json', import.meta.url),
    ),
  );
  assert.ok(manifest.preloads.some((path) => /^browser\/application-/.test(path)));
  const assets = Object.keys(manifest.assets);
  const exportModules = assets.filter((path) =>
    /^browser\/(?:score-export-|export-artwork-)/.test(path),
  );
  for (const prefix of ['canvas-', 'afterglow-artwork-', 'result-artwork-'])
    assert.ok(exportModules.some((path) => path.startsWith('browser/score-export-' + prefix)));
  assert.ok(exportModules.some((path) => path.startsWith('browser/export-artwork-')));
  assert.deepEqual(
    assets.filter((path) => /^browser\/score-export-(?:artwork-|partner-)/.test(path)),
    [],
  );
  for (const path of exportModules) assert.equal(manifest.preloads.includes(path), false, path);
  assert.equal(manifest.preloads.includes(manifest.entries.offline), false);
  assert.equal(manifest.preloads.includes(manifest.recoveryPagination), false);
  validateBrowserAssetSizes(manifest);
});
