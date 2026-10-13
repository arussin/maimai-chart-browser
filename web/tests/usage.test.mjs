import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { moduleSource, evaluateModule } from './module.mjs';
import { gzipSync } from 'node:zlib';
import {
  fileImportMethods,
  providerUsageRows,
} from '../../usage-worker/test/provider-usage-fixture.mjs';
const source = await moduleSource('usage');
const stagingSource = await moduleSource('usage-staging', { staging: true });
import { DETAILS, FAILURES, validateRow } from '../src/usage-contract.ts';
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

test('import terminal outcomes flush promptly and are never discarded by a full finite queue', async () => {
  const { api, requests } = fixture();
  for (const detail of DETAILS.filter_first_used.slice(0, 16))
    api.emit('filter_first_used', 'charts', detail);
  assert.equal(requests.length, 0);
  api.emit('import_completed', 'charts', 'lxns');
  assert.equal(requests.length, 2);
  const batches = requests.map((request) => JSON.parse(request.options.body));
  assert.equal(batches[0].events.length, 16);
  assert.deepEqual(batches[1].events, [
    { event: 'import_completed', page: 'charts', detail: 'lxns', failure: '', count: 1 },
  ]);
  await api.flush();
  assert.equal(requests.length, 2);
});

test('all finite import failure reasons reach transport without client timestamps or raw errors', async () => {
  const { api, requests } = fixture({ fail: true });
  for (const failure of FAILURES) {
    api.emit('import_failed', 'charts', 'diving-fish', failure);
  }
  assert.equal(requests.length, FAILURES.length);
  await api.flush();
  assert.equal(requests.length, FAILURES.length, 'Failed requests must never retry');
  assert.deepEqual(
    requests.map((request) => JSON.parse(request.options.body).events[0].failure),
    [...FAILURES],
  );
  const row = {
    event: 'import_failed',
    page: 'charts',
    detail: 'lxns',
    failure: 'empty_scores',
    count: 1,
  };
  for (const extra of [
    { timestamp: Date.now() },
    { first_received_at: '2026-10-11T00:00:00.000Z' },
    { message: 'PRIVATE-ERROR' },
  ])
    assert.equal(validateRow({ ...row, ...extra }), null);
  api.emit('import_failed', 'charts', 'lxns', 'PRIVATE-ERROR');
  assert.equal(requests.length, FAILURES.length);
});

test('direct import counts accept only finite provider names and never account or grant identifiers', async () => {
  const { api, requests } = fixture();
  for (const provider of ['kamaitachi', 'diving-fish', 'lxns'])
    api.emit('import_started', 'charts', provider);
  for (const detail of [
    'https://kamai.tachi.ac/u/PRIVATE',
    'PRIVATE-ACCOUNT',
    'diving-fish:PRIVATE-GRANT',
  ])
    api.emit('import_started', 'charts', detail);
  await api.flush();
  const body = requests[0].options.body;
  assert.ok(!body.includes('PRIVATE'));
  assert.deepEqual(
    JSON.parse(body)
      .events.map((row) => row.detail)
      .sort(),
    ['diving-fish', 'kamaitachi', 'lxns'],
  );
});

test('every finite import, provider lifecycle and tracker-link row survives the browser transport unchanged', async () => {
  const { api, requests } = fixture();
  for (let i = 0; i < providerUsageRows.length; i += 16) {
    for (const row of providerUsageRows.slice(i, i + 16))
      api.emit(row.event, row.page, row.detail, row.failure);
    await api.flush();
  }
  const received = requests.flatMap((request) => JSON.parse(request.options.body).events);
  assert.deepEqual(received, providerUsageRows);
  assert.ok(
    requests.every((request) => new TextEncoder().encode(request.options.body).length <= 4096),
  );
});

test('provider telemetry rejects identities, raw errors, invented auto events and invalid failure combinations', async () => {
  const { api, requests } = fixture();
  for (const detail of [
    'PRIVATE-ACCOUNT',
    'https://provider.invalid/PRIVATE',
    'diving-fish:PRIVATE-GRANT',
    'aquadx',
  ])
    api.emit('provider_connect_started', 'charts', detail);
  api.emit('provider_connect_failed', 'charts', 'diving-fish', 'PRIVATE-TOKEN');
  api.emit('provider_connect_started', 'charts', 'diving-fish', 'unavailable');
  api.emit('provider_connect_failed', 'charts', 'diving-fish');
  api.emit('provider_refresh_auto_completed', 'charts', 'diving-fish');
  api.emit('provider_status_completed', 'charts', 'diving-fish');
  api.emit('provider_disconnect_cancelled', 'charts', 'diving-fish');
  for (const detail of ['mai-tools', 'dxrating', 'tomomai', 'jietng', 'aqua', 'tachi']) {
    api.emit('import_started', 'charts', detail);
    api.emit('provider_read_started', 'charts', detail);
  }
  for (const detail of fileImportMethods) {
    api.emit('provider_connect_started', 'charts', detail);
    api.emit('provider_read_started', 'charts', detail);
    api.emit('provider_refresh_started', 'charts', detail);
    api.emit('import_started', 'charts', detail + ':PRIVATE-FILENAME');
  }
  api.emit('file_import_failed', 'charts', 'portable', 'invalid');
  api.emit('provider_file_fallback_clicked', 'charts', 'diving-fish');
  api.emit('resource_opened', 'charts', 'https://www.diving-fish.com/PRIVATE');
  await api.flush();
  assert.equal(requests.length, 0);
});

test('all new lifecycle counters honor opt-outs, suspension and the usage kill switch', async () => {
  for (const settings of [
    { gpc: true },
    { dnt: '1' },
    { enabled: false },
    { host: 'preview.invalid' },
  ]) {
    const { api, requests } = fixture(settings);
    for (const row of providerUsageRows) api.emit(row.event, row.page, row.detail, row.failure);
    await api.flush();
    assert.equal(requests.length, 0);
  }
  const { api, requests } = fixture();
  api.suspend(() => {
    for (const row of providerUsageRows) api.emit(row.event, row.page, row.detail, row.failure);
  });
  await api.flush();
  assert.equal(requests.length, 0);
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
