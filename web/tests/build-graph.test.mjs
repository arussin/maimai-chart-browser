import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { hostedPreloads, validateBrowserAssetSizes } from '../build-graph.mjs';

const root = resolve('fictional-assets'),
  startup = resolve('fictional-src/application.ts'),
  path = (name) => resolve(root, 'browser', name + '.js'),
  row = (...imports) => ({ imports: imports.map(([name, kind]) => ({ path: path(name), kind })) });
const graph = () => ({
  outputs: {
    [path('entry')]: row(['shared', 'import-statement'], ['application', 'dynamic-import']),
    [path('application')]: {
      ...row(['shared', 'import-statement'], ['export-canvas', 'dynamic-import']),
      entryPoint: startup,
    },
    [path('shared')]: row(),
    [path('export-canvas')]: row(['shared', 'import-statement'], ['export-art', 'dynamic-import']),
    [path('export-art')]: row(['art-helper', 'import-statement']),
    [path('art-helper')]: row(),
    [path('unreachable')]: row(),
  },
});

test('hosted preloads include explicit startup and static dependencies, leaving exports lazy', () => {
  assert.deepEqual(hostedPreloads(graph(), path('entry'), root, [startup]), [
    'browser/application.js',
    'browser/shared.js',
  ]);
  const reversed = { outputs: Object.fromEntries(Object.entries(graph().outputs).reverse()) };
  assert.deepEqual(
    hostedPreloads(reversed, path('entry'), root, [startup]),
    hostedPreloads(graph(), path('entry'), root, [startup]),
  );
  assert.deepEqual(hostedPreloads(graph(), path('entry'), root), ['browser/shared.js']);
  assert.deepEqual(
    hostedPreloads({ outputs: { [path('entry')]: row() } }, path('entry'), root),
    [],
  );
});

test('explicit startup entries must identify exactly one reachable output', () => {
  const duplicate = graph();
  duplicate.outputs[path('export-canvas')].entryPoint = startup;
  const unreachable = graph();
  delete unreachable.outputs[path('application')].entryPoint;
  unreachable.outputs[path('unreachable')].entryPoint = startup;
  for (const input of [duplicate, unreachable])
    assert.throws(() => hostedPreloads(input, path('entry'), root, [startup]));
  assert.throws(() => hostedPreloads(graph(), path('entry'), root, [resolve('missing.ts')]));
});

test('preload generation rejects broken, external, cyclic and out-of-package modules', () => {
  const missing = graph();
  delete missing.outputs[path('application')];
  const external = graph();
  external.outputs[path('entry')].imports[0].external = true;
  const cyclic = graph();
  cyclic.outputs[path('shared')] = row(['entry', 'import-statement']);
  const outside = graph();
  outside.outputs[path('entry')].imports.push({
    path: resolve(root, '../outside.js'),
    kind: 'dynamic-import',
  });
  outside.outputs[resolve(root, '../outside.js')] = row();
  for (const input of [missing, external, cyclic, outside])
    assert.throws(() => hostedPreloads(input, path('entry'), root));
});

test('lazy export branches still reject missing, external, cyclic and out-of-package dependencies', () => {
  const missing = graph();
  delete missing.outputs[path('export-art')];
  const external = graph();
  external.outputs[path('export-canvas')].imports[1].external = true;
  const cyclic = graph();
  cyclic.outputs[path('export-art')] = row(['export-canvas', 'dynamic-import']);
  const outside = graph();
  outside.outputs[path('export-art')].imports.push({
    path: resolve(root, '../outside.js'),
    kind: 'dynamic-import',
  });
  outside.outputs[resolve(root, '../outside.js')] = row();
  for (const input of [missing, external, cyclic, outside])
    assert.throws(() => hostedPreloads(input, path('entry'), root, [startup]));
});

const mib = 1024 * 1024;
const sizedGraph = (hosted = 2 * mib, offline = 8 * mib) => ({
  entries: { hosted: 'browser/browser-entry-HASH.js', offline: 'browser/browser-offline-HASH.js' },
  assets: {
    'browser/browser-entry-HASH.js': { bytes: hosted },
    'browser/browser-offline-HASH.js': { bytes: offline },
  },
});

test('browser size limits allow only the bound offline entry up to 8 MiB', () => {
  assert.doesNotThrow(() => validateBrowserAssetSizes(sizedGraph()));
  assert.throws(() => validateBrowserAssetSizes(sizedGraph(2 * mib + 1)));
  assert.throws(() => validateBrowserAssetSizes(sizedGraph(1, 8 * mib + 1)));
  for (const bytes of [0, -1, 1.5, NaN, Infinity])
    assert.throws(() => validateBrowserAssetSizes(sizedGraph(bytes)));
  const unbound = sizedGraph();
  unbound.assets['browser/browser-offline-OTHER.js'] = { bytes: 2 * mib + 1 };
  assert.throws(() => validateBrowserAssetSizes(unbound));
  const wrongPrefix = sizedGraph();
  wrongPrefix.entries.offline = 'browser/export-art.js';
  wrongPrefix.assets['browser/export-art.js'] = { bytes: 3 * mib };
  assert.throws(() => validateBrowserAssetSizes(wrongPrefix));
  const sharedEntry = sizedGraph();
  sharedEntry.entries.hosted = sharedEntry.entries.offline;
  assert.throws(() => validateBrowserAssetSizes(sharedEntry));
});

test('browser graph has a 16 MiB aggregate limit even with individually bounded assets', () => {
  const manifest = sizedGraph();
  for (let i = 0; i < 3; i++) manifest.assets[`browser/part-${i}.js`] = { bytes: 2 * mib };
  assert.doesNotThrow(() => validateBrowserAssetSizes(manifest));
  manifest.assets['browser/part-extra.js'] = { bytes: 1 };
  assert.throws(() => validateBrowserAssetSizes(manifest));
});
