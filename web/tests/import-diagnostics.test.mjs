import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './module.mjs';
import { makeSession, dataset, connection, file } from './player-session-fixture.mjs';
import { validateDiagnostic } from '../src/diagnostic-contract.ts';
const globals = {
  Error,
  DOMException,
  AbortController,
  AbortSignal,
  TextDecoder,
  TextEncoder,
  Uint8Array,
  URL,
  Response,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
};
const { diagnosticError } = await loadModule('runtime/diagnostic-error', globals);
const { importFailure } = await loadModule('runtime/import-failure', globals);
const { createPlayerProviderConnections } = await loadModule(
  'views/player-provider-connections',
  globals,
);
const { fetchImportConnectorFlags } = await loadModule('runtime/import-connector-flags', globals);
const { readImportFile } = await loadModule('runtime/import-file', globals);
const { openProviderPopup, checkKamaitachiInput } = await loadModule('views/player-data', globals);
const methods = [
  'file',
  'report',
  'maishift',
  'kamaitachi',
  'diving-fish',
  'lxns',
  'file:mai-tools',
  'file:dxrating',
  'file:tomomai',
  'file:jietng',
  'file:aqua',
  'file:tachi',
];
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const terminals = (rows, operation) => rows.filter((row) => row.operation === operation);
const safe = (rows) => {
  for (const row of rows) assert(validateDiagnostic(row), JSON.stringify(row));
  assert(!JSON.stringify(rows).includes('PRIVATE'));
};
const grantID = 'x'.repeat(32);
const bounded = async (stream) => new Uint8Array(await new Response(stream).arrayBuffer());

test('all twelve import methods keep one diagnostic and one action success for each storage choice', async () => {
  for (const method of methods)
    for (const remember of [true, false]) {
      const rows = [],
        f = makeSession({
          diagnose: (row) => rows.push(row),
          configure: (ports) => {
            ports.readFile = async () => ({
              data: dataset(),
              excludedUtage: 0,
              snapshotDateUnknown: false,
            });
          },
        });
      await f.owner.ready;
      f.ports.effects.ask = async () => ({ accept: true, remember });
      if (method === 'file' || method.startsWith('file:')) {
        await f.owner.importFile(file(dataset()), {
          format: method === 'file' ? 'portable' : method.slice(5),
          username: 'PRIVATE account',
          region: 'intl',
        });
      } else {
        f.ports.sources.readSource = async () => ({
          data: dataset(),
          source: { ...connection(), type: method },
        });
        await f.owner.importSource(
          { type: method, url: 'PRIVATE URL', account: 'PRIVATE account' },
          remember,
        );
      }
      const result = terminals(rows, 'import');
      assert.equal(result.length, 1, method);
      assert.equal(result[0].source, method);
      assert.equal(result[0].mode, 'manual');
      assert.equal(result[0].stage, 'commit');
      assert.equal(result[0].outcome, 'success');
      assert.equal(f.calls.events.filter(([event]) => event === 'import_completed').length, 1);
      safe(rows);
    }
});

test('every new source keeps diagnostic restore/automatic refresh separate from deliberate actions', async () => {
  for (const provider of ['kamaitachi', 'diving-fish', 'lxns'])
    for (const manual of [false, true]) {
      const rows = [],
        source = { ...connection(), type: provider },
        f = makeSession({ initial: dataset(), source, diagnose: (row) => rows.push(row) });
      await f.owner.ready;
      assert(rows.some((row) => row.operation === 'restore'));
      assert.equal(f.calls.events.length, 0);
      f.ports.sources.readSource = async () => ({ data: dataset(), source });
      await f.owner.refresh(manual);
      const result = terminals(rows, 'refresh');
      assert.equal(result.length, 1);
      assert.equal(result[0].outcome, 'unchanged');
      assert.equal(result[0].source, provider);
      assert.equal(result[0].mode, manual ? 'manual' : 'automatic');
      assert.equal(
        f.calls.events.filter(([event]) => event === 'provider_refresh_completed').length,
        manual ? 1 : 0,
      );
      safe(rows);
    }
});

test('durable direct refresh retains both successes when its view is superseded during the transaction', async () => {
  for (const unchanged of [true, false]) {
    const rows = [],
      source = { ...connection(), type: 'lxns' },
      f = makeSession({ initial: dataset(), source, diagnose: (row) => rows.push(row) });
    await f.owner.ready;
    f.ports.sources.readSource = async () => ({
      data: dataset(unchanged ? 'one' : 'two', unchanged ? 100 : 200),
      source: { ...source, sourceRevision: unchanged ? 'one' : 'two' },
    });
    const save = f.ports.storage.save;
    f.ports.storage.save = async (...args) => {
      const token = await save(...args);
      f.owner.cancel();
      return token;
    };
    await f.owner.refresh(true);
    assert.equal(f.state.active.revision, unchanged ? 'one' : 'fixture-merged');
    assert.deepEqual(
      f.calls.events.filter(([event]) => event.startsWith('provider_refresh_')),
      [
        ['provider_refresh_started', 'lxns'],
        ['provider_refresh_completed', 'lxns'],
      ],
    );
    assert.equal(terminals(rows, 'refresh').length, 1);
    assert.equal(terminals(rows, 'refresh')[0].outcome, unchanged ? 'unchanged' : 'success');
  }
});

test('OAuth Worker response categories survive without relaying arbitrary response properties', async () => {
  for (const [code, reason, failure] of [
    ['worker_timeout', 'worker_timeout', 'timeout'],
    ['upstream_network', 'network', 'network'],
    ['rate_limited', 'rate_limited', 'rate_limited'],
    ['upstream_busy', 'upstream_busy', 'unavailable'],
    ['invalid_response', 'malformed_response', 'invalid_response'],
    ['response_too_large', 'oversized_response', 'invalid_response'],
    ['provider_configuration_changed', 'contract_changed', 'invalid_response'],
    ['provider_contract_changed', 'contract_changed', 'invalid_response'],
    ['integration_disabled', 'configuration_unavailable', 'unavailable'],
    ['PRIVATE unknown', 'unknown', 'unavailable'],
  ]) {
    const api = createPlayerProviderConnections({
      bounded,
      fetch: async () =>
        json({ error: code, message: 'PRIVATE payload', stack: 'PRIVATE stack' }, 502),
    });
    await assert.rejects(api.read('lxns', grantID, new AbortController().signal), (error) => {
      assert.equal(diagnosticError(error).reason, reason, code);
      assert.equal(importFailure(error), failure, code);
      assert(!error.message.includes('PRIVATE'));
      return true;
    });
  }
});

test('uncertain OAuth renewal retains reauthorization behavior and only a finite diagnostic cause', async () => {
  for (const [code, cause, reason] of [
    ['reconnect_required', 'worker_timeout', 'worker_timeout'],
    ['reconnect_required', 'upstream_network', 'network'],
    ['reconnect_required', 'invalid_token_response', 'contract_changed'],
    ['reconnect_required', 'PRIVATE raw cause', 'connection_expired'],
    ['reconnect_required', { reason: 'worker_timeout' }, 'connection_expired'],
    ['not_connected', 'worker_timeout', 'connection_expired'],
  ]) {
    const api = createPlayerProviderConnections({
      bounded,
      fetch: async () => json({ error: code, diagnosticCode: cause }, 401),
    });
    await assert.rejects(
      api.read('diving-fish', grantID, new AbortController().signal),
      (error) => {
        assert.equal(importFailure(error), 'connection_expired');
        assert.equal(diagnosticError(error).reason, reason);
        assert.equal(
          error.message,
          'The connection needs to be renewed. Connect your account again.',
        );
        return true;
      },
    );
  }
});

test('provider cleanup diagnostics retain underlying failures and distinguish automatic from manual retry', async () => {
  const rows = [],
    api = createPlayerProviderConnections({
      bounded,
      diagnose: (row) => rows.push(row),
      fetch: async () => json({ error: 'worker_timeout', message: 'PRIVATE' }, 502),
    });
  await assert.rejects(api.disconnect('lxns', { connectionID: grantID }));
  await assert.rejects(api.retryCleanup('lxns'));
  assert.deepEqual(
    rows.map((row) => [row.operation, row.mode, row.reason, row.outcome]),
    [
      ['provider_disconnect', 'automatic', 'worker_timeout', 'failed'],
      ['provider_cleanup', 'manual', 'worker_timeout', 'failed'],
    ],
  );
  safe(rows);
});

test('flags diagnostics distinguish all-off success, unavailable configuration and invalid data', async () => {
  for (const [response, reason] of [
    [() => json({ schemaVersion: 1, methods: {} }), 'none'],
    [() => json({ error: 'PRIVATE' }, 503), 'configuration_unavailable'],
    [
      () => new Response('{', { headers: { 'Content-Type': 'application/json' } }),
      'malformed_response',
    ],
    [
      () =>
        new Response(new Uint8Array([0xff]), { headers: { 'Content-Type': 'application/json' } }),
      'malformed_response',
    ],
    [() => json({ schemaVersion: 1, methods: { 'PRIVATE URL': true } }), 'contract_changed'],
  ]) {
    const rows = [];
    try {
      await fetchImportConnectorFlags(
        new AbortController().signal,
        async () => response(),
        1000,
        (row) => rows.push(row),
      );
    } catch {}
    assert.equal(rows.length, 1);
    assert.equal(rows[0].operation, 'connector_config');
    assert.equal(rows[0].reason, reason);
    assert.equal(rows[0].mode, 'automatic');
    assert.equal(rows[0].outcome, reason === 'none' ? 'success' : 'failed');
    safe(rows);
  }
});

test('flag deadline and dialog supersession each terminate once without a failure for cancellation', async () => {
  for (const cancelled of [true, false]) {
    const rows = [],
      controller = new AbortController();
    const pending = fetchImportConnectorFlags(
      controller.signal,
      () => new Promise(() => {}),
      5,
      (row) => rows.push(row),
    );
    if (cancelled) controller.abort();
    await assert.rejects(pending);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].outcome, cancelled ? 'superseded' : 'failed');
    assert.equal(rows[0].reason, cancelled ? 'none' : 'client_timeout');
  }
});

test('malformed file and size failures classify boundaries without filename or account dimensions', async () => {
  const core = { MAX_COMPRESSED: 32 * 1024 * 1024 };
  for (const [file, reason, stage] of [
    [
      {
        size: 1,
        name: 'PRIVATE.json',
        arrayBuffer: async () => new TextEncoder().encode('{invalid').buffer,
      },
      'malformed_response',
      'decode',
    ],
    [{ size: 33 * 1024 * 1024, name: 'PRIVATE.json' }, 'oversized_response', 'read'],
  ]) {
    await assert.rejects(
      readImportFile(core, file, { format: 'tomomai', username: 'PRIVATE', region: 'intl' }),
      (error) => {
        assert.deepEqual({ ...diagnosticError(error) }, { reason, stage });
        return true;
      },
    );
  }
});

test('blocked popup and native validation have diagnostics before the coordinator can start', () => {
  const rows = [],
    events = [];
  openProviderPopup(
    { open: () => null },
    'lxns',
    (...args) => events.push(args),
    (row) => rows.push(row),
  );
  assert.deepEqual(
    rows.map((row) => [row.operation, row.reason]),
    [
      ['import', 'popup_blocked'],
      ['provider_connect', 'popup_blocked'],
    ],
  );
  rows.length = 0;
  checkKamaitachiInput(
    { reportValidity: () => false },
    () => {},
    (row) => rows.push(row),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, 'kamaitachi');
  safe(rows);
});

test('explicit disconnect is manual while post-import cleanup remains automatic', async () => {
  for (const mode of ['manual', 'automatic']) {
    const rows = [],
      api = createPlayerProviderConnections({
        bounded,
        diagnose: (row) => rows.push(row),
        fetch: async () => json({ disconnected: true }),
      });
    await api.disconnect('lxns', { connectionID: grantID }, 'provider_disconnect', mode);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].mode, mode);
    assert.equal(rows[0].outcome, 'success');
  }
});

test('invalid Session Report submissions are counted while assisted recovery does not invent an import', async () => {
  for (const invalid of [true, false]) {
    const rows = [],
      f = makeSession({ diagnose: (row) => rows.push(row) });
    await f.owner.ready;
    f.ports.sources.reportURL = () => {
      if (invalid) throw Error('PRIVATE URL');
      return { url: 'PRIVATE recovery URL', manifest: null };
    };
    await f.owner.importSource('PRIVATE supplied URL', false);
    assert.deepEqual(
      f.calls.events,
      invalid
        ? [
            ['import_started', 'report'],
            ['import_failed', 'report', 'invalid'],
          ]
        : [],
    );
    const result = terminals(rows, 'import');
    assert.equal(result.length, invalid ? 1 : 0);
    if (invalid) {
      assert.equal(result[0].reason, 'normalization');
      assert.equal(result[0].stage, 'normalize');
    }
    safe(rows);
  }
});

test('failed provider readiness emits one finite diagnostic while successful probes and status polls stay silent', async () => {
  const rows = [];
  let failure = true;
  const { createPlayerSources } = await loadModule('views/player-sources', {
    ...globals,
    fetch: async (url) =>
      failure
        ? json({ error: 'integration_disabled', message: 'PRIVATE configuration' }, 503)
        : String(url).endsWith('/status')
          ? json({ connections: [] })
          : json({ providers: { 'diving-fish': { enabled: true }, lxns: { enabled: true } } }),
  });
  const sources = createPlayerSources({
    playerCore: { bounded },
    diagnose: (row) => rows.push(row),
  });
  assert.equal((await sources.directCapabilities()).checked, false);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].operation, 'connector_config');
  assert.equal(rows[0].reason, 'configuration_unavailable');
  assert.equal(rows[0].outcome, 'failed');
  assert.equal(rows[0].mode, 'automatic');
  failure = false;
  for (let i = 0; i < 3; i++) {
    assert.equal((await sources.directCapabilities()).checked, true);
    await sources.connectionStatus();
  }
  assert.equal(rows.length, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(sources.directCapabilities(controller.signal), { name: 'AbortError' });
  assert.equal(rows.length, 1);
  safe(rows);
});
