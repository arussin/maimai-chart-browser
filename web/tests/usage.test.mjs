import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { moduleSource, evaluateModule } from './module.mjs';
import { gzipSync } from 'node:zlib';
const source = await moduleSource('usage');
const stagingSource = await moduleSource('usage-staging', { staging: true });
function fixture({
  host = 'maimai.party',
  module = source,
  gpc = false,
  dnt = '0',
  enabled = true,
  fail = false,
} = {}) {
  const listeners = {},
    requests = [];
  const win = {
    maimaiUsageEnabled: enabled,
    addEventListener: (key, fn) => (listeners[key] = fn),
    setTimeout: () => 1,
  };
  const context = vm.createContext({
    window: win,
    location: { protocol: 'https:', hostname: host, origin: 'https://' + host },
    navigator: { globalPrivacyControl: gpc, doNotTrack: dnt },
    document: { prerendering: false, addEventListener: (key, fn) => (listeners[key] = fn) },
    TextEncoder,
    AbortSignal,
    clearTimeout() {},
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (fail) throw Error('private network error');
      return { ok: true };
    },
  });
  const api = evaluateModule(module, context).createUsage();
  return { api, requests, listeners, context };
}
test('first-party counts are bounded finite data, with no application or persistent access', async () => {
  const { api, requests, listeners } = fixture();
  api.activate('song');
  api.emit('filter_first_used', 'song', 'genre');
  api.emit('filter_first_used', 'song', 'genre');
  api.emit('search_used', 'charts', 'PRIVATE-SENTINEL');
  api.emit('private_event');
  await api.flush();
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.equal(request.url, '/__usage');
  assert.ok(!request.options.body.includes('PRIVATE-SENTINEL'));
  assert.equal(request.options.credentials, 'omit');
  assert.equal(request.options.referrerPolicy, 'no-referrer');
  assert.equal(request.options.redirect, 'error');
  const body = JSON.parse(request.options.body);
  assert.equal(body.events.length, 2);
  assert.equal(body.events[1].count, 1);
  assert.ok(gzipSync(source).length < 5120);
});
test('GA refusal is independent; GPC, DNT, previews and kill switch produce no requests', async () => {
  for (const settings of [
    { host: 'preview.invalid' },
    { gpc: true },
    { dnt: '1' },
    { enabled: false },
  ]) {
    const { api, requests } = fixture(settings);
    api.emit('settings_opened');
    await api.flush();
    assert.equal(requests.length, 0);
  }
  const { api, requests } = fixture();
  api.emit('settings_opened');
  await api.flush();
  assert.equal(requests.length, 1);
});
test('restore is suppressed; failures drop without retry and disable clears buffered rows', async () => {
  const { api, requests } = fixture({ fail: true });
  api.suspend(() => api.emit('settings_opened'));
  await api.flush();
  assert.equal(requests.length, 0);
  api.emit('settings_opened');
  await api.flush();
  await api.flush();
  assert.equal(requests.length, 1);
  api.emit('settings_opened');
  api.disable();
  await api.flush();
  assert.equal(requests.length, 1);
});
test('same broad page category counts each committed navigation but no automatic page view', async () => {
  const { api, requests, listeners } = fixture();
  await api.flush();
  assert.equal(requests.length, 0);
  api.activate('song');
  api.activate('song');
  await api.flush();
  assert.equal(JSON.parse(requests[0].options.body).events[0].count, 2);
});

for (const [name, module, host, forbidden] of [
  ['production', source, 'maimai.party', 'maimai-party-staging.pages.dev'],
  ['staging', stagingSource, 'maimai-party-staging.pages.dev', 'maimai.party'],
]) {
  test(
    name + ' usage has an exclusive build-selected origin and unchanged privacy controls',
    async () => {
      for (const settings of [
        { host: forbidden },
        { host: 'unrelated.invalid' },
        { host: host + ':8443' },
        { host, gpc: true },
        { host, dnt: '1' },
        { host, enabled: false },
      ]) {
        const { api, requests, context } = fixture({ module, ...settings });
        // An untrusted page cannot redirect this bundle's eligibility through settings.
        context.window.maimaiUsageOrigin = 'https://' + settings.host;
        api.activate('song');
        api.emit('settings_opened');
        await api.flush();
        assert.equal(requests.length, 0, JSON.stringify(settings));
      }
      const { api, requests, listeners } = fixture({ module, host });
      assert.deepEqual(Object.keys(listeners).sort(), ['pagehide', 'visibilitychange']);
      api.activate('song');
      api.emit('search_used', 'charts', 'PRIVATE-SENTINEL');
      api.emit('import_failed', 'song', 'file', 'storage');
      await api.flush();
      assert.equal(requests.length, 1);
      assert.ok(!requests[0].options.body.includes('PRIVATE-SENTINEL'));
      assert.deepEqual(
        JSON.parse(requests[0].options.body).events.map((row) => row.event),
        ['page_view', 'import_failed'],
      );
      assert.equal(requests[0].options.credentials, name === 'staging' ? 'same-origin' : 'omit');
      assert.equal(requests[0].options.referrerPolicy, 'no-referrer');
      api.emit('settings_opened');
      api.disable();
      await api.flush();
      assert.equal(requests.length, 1);
    },
  );
}
