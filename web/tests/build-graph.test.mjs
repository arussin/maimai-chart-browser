import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { hostedPreloads } from '../build-graph.mjs';

const root = resolve('fictional-assets'),
  path = (name) => resolve(root, 'browser', name + '.js'),
  row = (...imports) => ({ imports: imports.map(([name, kind]) => ({ path: path(name), kind })) });
const graph = () => ({
  outputs: {
    [path('entry')]: row(['shared', 'import-statement'], ['application', 'dynamic-import']),
    [path('application')]: row(['shared', 'import-statement']),
    [path('shared')]: row(),
    [path('unreachable')]: row(),
  },
});

test('hosted preload closure includes dynamic application and shared modules once', () => {
  assert.deepEqual(hostedPreloads(graph(), path('entry'), root), [
    'browser/application.js',
    'browser/shared.js',
  ]);
  const reversed = { outputs: Object.fromEntries(Object.entries(graph().outputs).reverse()) };
  assert.deepEqual(
    hostedPreloads(reversed, path('entry'), root),
    hostedPreloads(graph(), path('entry'), root),
  );
  assert.deepEqual(
    hostedPreloads({ outputs: { [path('entry')]: row() } }, path('entry'), root),
    [],
  );
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
