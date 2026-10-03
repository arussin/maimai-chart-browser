import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { selectCatalogRows } from '../src/domain/catalog-row-selection.ts';

test('the recovery expression is a hash-bound build of the maintained row decision', async () => {
  const assets = new URL('../../src/maimai_intelligence/assets/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('browser-assets.json', assets), 'utf8'));
  assert.match(manifest.recoveryPagination, /^browser\/recovery-pagination-[a-f0-9]{16}\.js$/);
  const bytes = await readFile(new URL(manifest.recoveryPagination, assets));
  assert.deepEqual(manifest.assets[manifest.recoveryPagination], {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
  });
  const context = vm.createContext({});
  const generated = vm.runInContext(bytes.toString(), context);
  assert.equal(typeof generated, 'function');
  assert.deepEqual(Object.keys(context), []);
  assert.equal(Object.values(manifest.entries).includes(manifest.recoveryPagination), false);
  assert.equal(manifest.preloads.includes(manifest.recoveryPagination), false);
  const rows = Array.from({ length: 7251 }, (_, index) => ({ key: `chart:${index}` }));
  for (const visible of [0, 40, 4000, 4040, 8000]) {
    for (const focus of [null, 'missing', 'chart:0', 'chart:4015', 'chart:7250']) {
      assert.equal(
        JSON.stringify(generated(rows, visible, focus)),
        JSON.stringify(selectCatalogRows(rows, visible, focus)),
      );
    }
  }
});
