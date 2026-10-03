import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './module.mjs';
function fixture(path, saved) {
  const writes = [];
  const events = new Map();
  const document = {
    readyState: 'loading',
    documentElement: { lang: '' },
    addEventListener: (name, handler) => events.set(name, handler),
  };
  document.defaultView = {
    navigator: { languages: ['en-US'] },
    location: new URL('https://maimai.party' + path),
    addEventListener() {},
  };
  return {
    root: { ownerDocument: document },
    events,
    writes,
    globals: {
      localStorage: { getItem: () => saved, setItem: (...args) => writes.push(args) },
      URLSearchParams,
    },
  };
}
const configuration = {
  messages: {
    Close: { ja: '閉じる', ko: '닫기', 'zh-Hans': '关闭' },
    'Results: {0}': { ja: '結果：{0}', ko: '결과: {0}', 'zh-Hans': '结果：{0}', $translate: [0] },
    ' {0} ': { ja: ' {0} ', ko: ' {0} ', 'zh-Hans': ' {0} ' },
  },
  flags: {},
};
test('route language is separate from stored preference and official literal names', async () => {
  for (const [route, locale, close] of [
    ['en', 'en', 'Close'],
    ['ja', 'ja', '閉じる'],
    ['ko', 'ko', '닫기'],
    ['zh-hans', 'zh-Hans', '关闭'],
  ]) {
    const state = fixture('/' + route + '/songs/fictional/', 'ko');
    const { createLocalization } = await loadModule('views/localization', state.globals);
    const view = createLocalization({ root: state.root, configuration });
    assert.equal(view.locale, locale);
    assert.equal(view.translate('Close'), close);
    assert.equal(view.translate(view.verbatim('Close')), 'Close');
    assert.equal(
      view.translate(view.message('Results: {0}', [view.verbatim('Close')])),
      locale === 'ja'
        ? '結果：Close'
        : locale === 'ko'
          ? '결과: Close'
          : locale === 'zh-Hans'
            ? '结果：Close'
            : 'Results: Close',
    );
    assert.equal(state.writes.length, 0);
    assert.ok(state.events.has('DOMContentLoaded'));
  }
});
test('linked language, browser negotiation and structured message formatting preserve existing precedence', async () => {
  const state = fixture('/?lang=ja', 'ko');
  const { createLocalization } = await loadModule('views/localization', state.globals);
  const view = createLocalization({ root: state.root, configuration });
  assert.equal(view.locale, 'ja');
  assert.equal(view.negotiate(['fr', 'zh-TW']), 'zh-Hans');
  assert.equal(view.negotiate(['ja-JP']), 'ja');
  assert.equal(view.negotiate(['ko-KR']), 'ko');
  assert.equal(view.negotiate(['fr']), 'en');
  assert.equal(view.translate('  Close '), '  閉じる ');
  assert.equal(view.translate('Results: Close'), '結果：閉じる');
  assert.equal(
    view.translate(view.parts([view.verbatim('Close'), 'Close'], ' · ')),
    'Close · 閉じる',
  );
  assert.equal(view.translate('No translation'), 'No translation');
  assert.equal(view.translate(null), '');
  assert.equal(view.translate(0), '0');
});
