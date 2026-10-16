import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { moduleSource, evaluateModule } from './module.mjs';
import { gzipSync } from 'node:zlib';
const source = await moduleSource('usage');
const stagingSource = await moduleSource('usage-staging', { staging: true });
import { DETAILS, validateRow } from '../src/usage-contract.ts';
function fixture({
  host = 'maimai.party',
  module = source,
  gpc = false,
  dnt = '0',
  enabled = true,
  fail = false,
  status = 204,
  receipt = false,
  timeout = false,
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
    AbortSignal: timeout
      ? { timeout: () => AbortSignal.abort(new DOMException('private', 'TimeoutError')) }
      : AbortSignal,
    clearTimeout() {},
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (fail) throw Error('private network error');
      return {
        status,
        headers: {
          get: (key) =>
            key === 'X-Maimai-Usage-Schema'
              ? '1,2'
              : key === 'X-Maimai-Usage-Receipt' && receipt
                ? 'stored'
                : null,
        },
      };
    },
  });
  const api = evaluateModule(module, context).createUsage();
  return { api, requests, listeners, context };
}
const diagnostic = {
  operation: 'catalog',
  stage: 'transport',
  reason: 'network',
  outcome: 'failed',
  source: 'none',
  mode: 'automatic',
  duration: 'under_1s',
  instrumentation: 'diagnostics-1',
  count: 1,
};
test('delivery status distinguishes unconfirmed 204, acknowledgement, rejection, unavailable and uncertain transport', async () => {
  for (const [settings, expected] of [
    [{}, 'unconfirmed'],
    [{ receipt: true }, 'recorded'],
    [{ status: 400 }, 'rejected'],
    [{ status: 503 }, 'unavailable'],
    [{ fail: true }, 'network'],
    [{ fail: true, timeout: true }, 'timeout'],
  ]) {
    const f = fixture(settings);
    f.api.diagnose(diagnostic);
    await f.api.flush();
    assert.equal(f.api.delivery().last, expected);
    assert.equal(f.requests.length, 1);
    await f.api.flush();
    assert.equal(f.requests.length, 1);
    assert.equal(JSON.parse(f.requests[0].options.body).version, 2);
    assert(Object.isFrozen(f.api.delivery()));
  }
});
test('diagnostics share every privacy gate and local saturation status stays bounded', async () => {
  for (const settings of [
    { gpc: true },
    { dnt: '1' },
    { enabled: false },
    { host: 'preview.invalid' },
  ]) {
    const f = fixture(settings);
    f.api.diagnose(diagnostic);
    await f.api.flush();
    assert.equal(f.requests.length, 0);
    assert.equal(f.api.delivery().last, 'disabled');
  }
  const f = fixture();
  f.api.suspend(() => f.api.diagnose(diagnostic));
  await f.api.flush();
  assert.equal(f.requests.length, 0);
  for (let i = 0; i < 2000; i++) f.api.emit('settings_opened');
  assert.equal(f.api.delivery().saturated, 1000);
  assert.equal(f.api.delivery().dropped, 1000);
  await f.api.flush();
  assert.equal(JSON.parse(f.requests[0].options.body).events[0].count, 100);
  f.api.disable();
  assert.equal(f.api.delivery().dropped, 0);
  f.api.diagnose(diagnostic);
  await f.api.flush();
  assert.equal(f.requests.length, 1);
});
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
test('export counters accept only finite action kinds and never transmit saved choices or errors', async () => {
  const { api, requests } = fixture();
  for (const [event, details] of Object.entries(DETAILS).filter(([event]) =>
    event.startsWith('score_export_'),
  )) {
    for (const detail of details) {
      assert.ok(validateRow({ event, page: 'song', detail, failure: '', count: 1 }));
      api.emit(event, 'song', detail);
    }
    for (const detail of [
      'PRIVATE-SENTINEL',
      'prismplus',
      'kanadera-magical',
      'https://private.invalid/song',
    ]) {
      assert.equal(validateRow({ event, page: 'song', detail, failure: '', count: 1 }), null);
      api.emit(event, 'song', detail);
    }
    assert.equal(
      validateRow({
        event,
        page: 'song',
        detail: details[0],
        failure: 'PRIVATE-SENTINEL',
        count: 1,
      }),
      null,
    );
    await api.flush();
  }
  const rows = requests.flatMap((request) => JSON.parse(request.options.body).events);
  assert.equal(rows.length, 17);
  assert.ok(
    rows.every((row) => Object.keys(row).sort().join(',') === 'count,detail,event,failure,page'),
  );
  assert.doesNotMatch(
    JSON.stringify(requests),
    /PRIVATE-SENTINEL|prismplus|kanadera-magical|private\.invalid/,
  );
  const before = requests.length;
  api.suspend(() => api.emit('score_export_option_changed', 'song', 'partner'));
  await api.flush();
  assert.equal(requests.length, before);
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
