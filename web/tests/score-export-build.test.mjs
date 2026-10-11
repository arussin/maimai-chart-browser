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
  const exportModules = Object.keys(manifest.assets).filter((path) =>
    /^browser\/score-export-/.test(path),
  );
  for (const prefix of ['canvas-', 'artwork-', 'result-artwork-', 'partner-kanadera-magical-'])
    assert.ok(exportModules.some((path) => path.startsWith('browser/score-export-' + prefix)));
  for (const path of exportModules) assert.equal(manifest.preloads.includes(path), false, path);
  assert.equal(manifest.preloads.includes(manifest.entries.offline), false);
  assert.equal(manifest.preloads.includes(manifest.recoveryPagination), false);
  validateBrowserAssetSizes(manifest);
});
