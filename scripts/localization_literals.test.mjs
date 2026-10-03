import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createLiteralClassifier, isSvgPath } from './localization_literals.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const assets = path.join(root, 'src/maimai_intelligence/assets');
const known = new Set(fs.readdirSync(path.join(assets, 'locales')).filter((name) => name.endsWith('.json')).flatMap((name) => {
  const catalog = JSON.parse(fs.readFileSync(path.join(assets, 'locales', name), 'utf8'));
  return [...Object.keys(catalog.messages || {}), ...Object.keys(catalog.invariants || {})];
}));
const caption = '<text class="pattern-example-caption" x="14" y="83">one continuous path</text>';
const movement = '<path class="pattern-example-movement" d="M38 56L130 22L218 57L275 30"/>';

test('complete SVG path tokens are protocol, including minified adjacent numbers', () => {
  for (const value of ['M6 6l12 12M6 18 18 6', 'm.5-.6L1e-3,2E+4z', 'M12 0C5.373 0 0 5.373 0 12z']) {
    assert.equal(isSvgPath(value), true, value);
  }
  for (const value of ['Missing artwork', 'M12 4 missing prose', 'M12 4<title>New words</title>', 'M', 'M12 4 E', 'Move to library']) {
    assert.equal(isSvgPath(value), false, value);
  }
});

test('minifier-folded shipped markup retains every exact classification', () => {
  const classified = createLiteralClassifier(known);
  assert.equal(known.has(caption), true);
  assert.equal(known.has(movement), true);
  assert.equal(classified(caption), true);
  assert.equal(classified(movement), true);
  assert.equal(classified(caption + movement), true);
  assert.equal(classified(caption.replace('one continuous path', 'Untranslated new caption') + movement), false);
  assert.equal(classified(caption + movement.replace('/>', ' aria-label="Untranslated meaning"/>')), false);
  assert.equal(classified(caption + 'Missing prose' + movement), false);
  assert.equal(classified(caption + movement + 'Missing prose'), false);
  assert.equal(classified('Missing prose' + caption + movement), false);
  assert.equal(createLiteralClassifier(new Set(['Known ', 'words']))('Known words'), false);
});

test('scanner preserves missing-prose rejection in generated modules and UI slots', (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'maimai-localization-literals-'));
  t.after(() => {
    assert.equal(path.dirname(temporary), fs.realpathSync(os.tmpdir()));
    fs.rmSync(temporary, { recursive: true });
  });
  const fixture = path.join(temporary, 'src/maimai_intelligence/assets');
  fs.mkdirSync(path.join(fixture, 'locales'), { recursive: true });
  fs.writeFileSync(path.join(fixture, 'locales/messages.json'), JSON.stringify({ invariants: { [caption]: {}, [movement]: {} } }));
  const run = () => spawnSync(process.execPath, [path.join(root, 'scripts/localization_sources.mjs'), temporary], {
    encoding: 'utf8', env: { ...process.env, MAIMAI_NODE_MODULES_ROOT: process.env.MAIMAI_NODE_MODULES_ROOT || root },
  });
  fs.writeFileSync(path.join(fixture, 'chart-visuals.js'), `const drawing = ${JSON.stringify(caption + movement)};`);
  fs.writeFileSync(path.join(fixture, 'settings-menu.js'), 'const icon = "M6 6l12 12M6 18 18 6";');
  const accepted = run();
  assert.equal(accepted.status, 0, accepted.stderr);
  fs.appendFileSync(path.join(fixture, 'settings-menu.js'), 'const missing = "Untranslated generated-module text"; text(button, "M12 34");');
  const rejected = run();
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /Untranslated generated-module text/);
  assert.match(rejected.stderr, /M12 34/);
  fs.writeFileSync(path.join(fixture, 'chart-visuals.js'), `const drawing = ${JSON.stringify(caption.replace('one continuous path', 'Untranslated new caption') + movement)};`);
  assert.match(run().stderr, /Untranslated new caption/);
});

test('long malformed numeric path rejects without regex backtracking', () => {
  const helper = new URL('./localization_literals.mjs', import.meta.url).href;
  const source = `import { isSvgPath } from ${JSON.stringify(helper)};
    const coordinates = '1'.repeat(4096);
    console.log(JSON.stringify([
      isSvgPath('M' + coordinates + ' invalid'),
      isSvgPath('M' + coordinates + ' 2Z')
    ]));`;
  // Keep a regression in the recognizer from hanging the test runner itself.
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [false, true]);
});
