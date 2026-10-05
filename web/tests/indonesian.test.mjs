import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createLocalization } from '../src/views/localization.ts';
import { titleLabel } from '../src/catalog-query.ts';
import { catalogFailure, catalogPending } from '../src/runtime/diagnostics.ts';
import { publicPath, routePattern } from '../src/runtime/public-routes.ts';

// Source-level regression tests. These do not replace the real-browser layout suite.
const assets = new URL('../../src/maimai_intelligence/assets/', import.meta.url);
const readJSON = (relative) => JSON.parse(readFileSync(new URL(relative, assets), 'utf8'));
const catalogs = readdirSync(new URL('locales/', assets))
  .filter((name) => name.endsWith('.json'))
  .map((name) => readJSON('locales/' + name));
const messages = Object.assign({}, ...catalogs.map((catalog) => catalog.messages));
const flags = Object.fromEntries(
  ['en', 'ja', 'ko', 'zh-Hans', 'id'].map((locale) => [locale, 'data:image/png;base64,fixture']),
);
const configuration = { messages, flags };

function fixture(t, { path = '/', saved, languages = ['en-US'], denied = false } = {}) {
  const writes = [],
    listeners = new Map(),
    styles = new Map();
  const document = { readyState: 'loading', addEventListener() {} };
  class Element {
    constructor(tag) {
      this.tagName = tag;
      this.nodeType = 1;
      this.childNodes = [];
      this.dataset = {};
      this.attributes = new Map();
      this.ownerDocument = document;
    }
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    }
    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    }
    append(...nodes) {
      this.childNodes.push(...nodes);
    }
    prepend(...nodes) {
      this.childNodes.unshift(...nodes);
    }
    replaceChildren(...nodes) {
      this.childNodes = nodes;
    }
    get firstChild() {
      return this.childNodes[0];
    }
    set textContent(value) {
      this.childNodes = [document.createTextNode(value)];
    }
    get textContent() {
      return this.childNodes.map((node) => node.nodeValue ?? node.textContent).join('');
    }
    querySelector() {
      return null;
    }
    querySelectorAll(selector) {
      const matches = [];
      const visit = (node) => {
        if (selector === '[data-language]' && node.dataset?.language) matches.push(node);
        for (const child of node.childNodes ?? []) visit(child);
      };
      for (const node of this.childNodes) visit(node);
      return matches;
    }
  }
  document.createTextNode = (value) => ({ nodeType: 3, nodeValue: String(value) });
  document.createElement = (tag) => new Element(tag);
  document.documentElement = new Element('html');
  document.documentElement.style = { setProperty: (key, value) => styles.set(key, value) };
  document.defaultView = {
    navigator: { languages },
    location: new URL('https://maimai.party' + path),
    addEventListener(name, listener) {
      listeners.set(name, [...(listeners.get(name) ?? []), listener]);
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) ?? []) listener(event);
      return true;
    },
  };
  const previous = new Map();
  for (const [key, value] of Object.entries({
    Node: { TEXT_NODE: 3 },
    localStorage: {
      getItem() {
        if (denied) throw new Error('Storage unavailable');
        return saved;
      },
      setItem(...args) {
        if (denied) throw new Error('Storage unavailable');
        writes.push(args);
      },
    },
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  t.after(() => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const root = new Element('body');
  const view = createLocalization({ root, configuration });
  return { root, document, view, writes, listeners, styles };
}

for (const [name, options, expected] of [
  ['browser id-ID', { languages: ['id-ID'] }, 'id'],
  ['browser preference order', { languages: ['en-US', 'id-ID'] }, 'en'],
  ['saved choice before browser', { saved: 'ja', languages: ['id-ID'] }, 'ja'],
  ['saved Indonesian', { saved: 'id' }, 'id'],
  ['explicit query before saved choice', { path: '/?lang=id', saved: 'ko' }, 'id'],
  ['Indonesian route before query', { path: '/id/songs/example/?lang=ja', saved: 'ko' }, 'id'],
  ['English route before query', { path: '/en/songs/example/?lang=id', saved: 'id' }, 'en'],
]) {
  test('Indonesian locale precedence: ' + name, (t) => {
    const { view, writes } = fixture(t, options);
    assert.equal(view.locale, expected);
    assert.equal(writes.length, 0, 'automatic selection must not persist');
  });
}

test('all catalogs include Indonesian with intact placeholders and unique English keys', () => {
  const seen = new Set();
  for (const catalog of catalogs)
    for (const [english, translations] of Object.entries(catalog.messages ?? {})) {
      assert.ok(!seen.has(english), 'Duplicate English key: ' + english);
      seen.add(english);
      assert.deepEqual(
        Object.keys(translations)
          .filter((key) => key !== '$translate')
          .sort(),
        ['id', 'ja', 'ko', 'zh-Hans'],
      );
      assert.ok(translations.id.trim(), english);
      assert.deepEqual(
        (translations.id.match(/\{\d+\}/g) ?? []).sort(),
        (english.match(/\{\d+\}/g) ?? []).sort(),
        english,
      );
    }
  assert.equal(seen.size, Object.keys(messages).length);
});

test('switching binds Indonesian text but preserves literal song and player values', (t) => {
  const { view, root, document, writes } = fixture(t);
  const label = document.createElement('p'),
    literal = document.createElement('p');
  root.append(label, literal);
  view.text(label, 'Close');
  view.literal(literal, 'Close');
  assert.equal(view.setLocale('id'), true);
  assert.equal(label.textContent, 'Tutup');
  assert.equal(literal.textContent, 'Close');
  assert.equal(
    view.translate(view.message('Compare with {0}', [view.verbatim('Close')])),
    'Bandingkan dengan Close',
  );
  assert.equal(
    view.translate('Drag handles, or type 13, 13+ or 13.5.'),
    'Geser penanda, atau ketik 13, 13+, atau 13.5.',
  );
  assert.deepEqual(writes, [['maimai-language-v1', 'id']]);
  assert.equal(view.setLocale('en'), true);
  assert.equal(label.textContent, 'Close');
  assert.equal(literal.textContent, 'Close');
  assert.equal(view.setLocale('unknown'), false);
});

test('Indonesian stays usable when device storage is denied', (t) => {
  const { view, writes } = fixture(t, { languages: ['id-ID'], denied: true });
  assert.equal(view.locale, 'id');
  assert.equal(view.translate('Find a chart'), 'Cari chart');
  assert.equal(view.setLocale('en'), true);
  assert.equal(view.setLocale('id'), true);
  assert.equal(writes.length, 0);
});

test('five language buttons include the native Indonesian name and update pressed state', (t) => {
  const { root, view } = fixture(t);
  const controls = view.controls(root);
  const buttons = controls.querySelectorAll('[data-language]');
  assert.equal(buttons.length, 5);
  const button = buttons.find((node) => node.dataset.language === 'id');
  assert.equal(button.getAttribute('aria-label'), 'Bahasa Indonesia');
  button.onclick();
  assert.equal(view.locale, 'id');
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.equal(buttons.filter((node) => node.getAttribute('aria-pressed') === 'true').length, 1);
});

test('storage changes update language without writing the preference again', (t) => {
  const { document, view, writes } = fixture(t);
  document.defaultView.dispatchEvent({
    type: 'storage',
    key: 'maimai-language-v1',
    newValue: 'id',
  });
  assert.equal(view.locale, 'id');
  assert.equal(writes.length, 0);
});

test('Indonesian title-state labels do not rename a real title', () => {
  assert.equal(titleLabel({ title: '', title_state: 'missing' }, 'id'), 'Judul tidak tersedia');
  assert.equal(
    titleLabel({ title: '', title_state: 'intentional_blank' }, 'id'),
    'Tanpa judul (disengaja)',
  );
  assert.equal(titleLabel({ title: 'Close', title_state: 'present' }, 'id'), 'Close');
});

test('Indonesian loading and failure diagnostics follow language changes', (t) => {
  const { root, view } = fixture(t, { languages: ['id-ID'] });
  assert.equal(catalogPending(root, 'id').textContent, 'Memuat katalog…');
  catalogFailure(root, 'id');
  const failure = root.firstChild;
  assert.match(failure.textContent, /Katalog tidak dapat dimuat/);
  assert.equal(failure.childNodes[1].textContent, 'Coba muat lagi');
  view.setLocale('en');
  assert.match(failure.textContent, /The catalog could not be loaded/);
});

test('Indonesian canonical routes share unchanged Unicode song identities', () => {
  const id = publicPath('id', 'songs', '青空-example');
  assert.equal(id, publicPath('en', 'songs', '青空-example').replace('/en/', '/id/'));
  assert.ok(routePattern.test(id));
  assert.ok(routePattern.test(publicPath('id', 'versions', 'CiRCLE-PLUS')));
  assert.ok(!routePattern.test('/id-ID/songs/example/'));
});

test('bundled Indonesian flag matches its pinned source receipt', () => {
  const entry = readJSON('flag-icons-source.json').files.find(
    (item) => item.file === 'flag-id.png',
  );
  assert.ok(entry);
  const bytes = readFileSync(new URL(entry.file, assets));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
  assert.equal(bytes.readUInt32BE(16), 16);
  assert.equal(bytes.readUInt32BE(20), 11);
});
