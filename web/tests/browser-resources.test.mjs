import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './module.mjs';

const { browserResources, documentResources } = await loadModule('runtime/browser-resources');
const ref = (extension = 'json', bytes = 20) => ({
  path: `browser-resources/${'a'.repeat(64)}.${extension}`,
  sha256: 'a'.repeat(64),
  bytes,
});
const fixture = () => ({
  version: 1,
  entry: { ...ref('js'), path: 'browser/browser-entry-FIXTURE.js' },
  configuration: ref(),
  shell: ref('html'),
  catalog: ref(),
  styles: ref('css'),
  permalinks: ref(),
  seoStyle: ref('css'),
});

test('hosted resources are immutable and keep exact document references', () => {
  const input = fixture(),
    resources = browserResources(input);
  assert.equal(JSON.stringify(resources), JSON.stringify(input));
  input.configuration.path = 'manifest.json';
  assert.notEqual(resources.configuration.path, input.configuration.path);
  assert.equal(Object.isFrozen(resources), true);
  assert.equal(Object.isFrozen(resources.configuration), true);
  const plain = browserResources({ ...fixture(), permalinks: null, seoStyle: null });
  assert.equal(plain.permalinks, null);
});

test('mutable aliases, foreign URLs, malformed hashes and over-limit references are rejected', () => {
  for (const replacement of [
    null,
    {},
    [],
    { ...fixture(), version: 2 },
    { ...fixture(), unexpected: 1 },
    { ...fixture(), configuration: null },
    ...[
      { path: 'browser-config.json' },
      { path: '../browser-resources/' + 'a'.repeat(64) + '.json' },
      { path: 'https://example.invalid/config.json' },
      { sha256: 'not-a-hash' },
      { bytes: 0 },
      { bytes: 4 * 1024 * 1024 + 1 },
      { bytes: true },
      { bytes: 1.5 },
    ].map((change) => ({ ...fixture(), configuration: { ...ref(), ...change } })),
  ])
    assert.throws(() => browserResources(replacement));
});

test('hosted documents must provide exactly one bounded descriptor and never fall back', () => {
  const document = { querySelectorAll: () => [{ textContent: JSON.stringify(fixture()) }] };
  assert.equal(documentResources(document).version, 1);
  for (const nodes of [
    [],
    [{ textContent: '{}' }, { textContent: '{}' }],
    [{ textContent: 'x'.repeat(16385) }],
    [{ textContent: 'broken' }],
  ])
    assert.throws(() => documentResources({ querySelectorAll: () => nodes }));
});
