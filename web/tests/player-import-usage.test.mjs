import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSession, dataset, connection, deferred } from './player-session-fixture.mjs';
import { loadModule } from './module.mjs';
const { validateRow } = await loadModule('usage-contract');
const { ImportFailureError } = await loadModule('runtime/import-failure', { Error, DOMException });
const direct = (provider = 'diving-fish') => ({
  ...connection(),
  type: provider,
  connectionID: 'synthetic-grant',
  url: `/api/player-import/oauth/${provider}/read`,
  contentRevision: 'same',
});
const events = (fixture, prefix) =>
  fixture.calls.events.filter(([event]) => event.startsWith(prefix));
function finite(fixture) {
  for (const [event, detail = '', failure = ''] of fixture.calls.events) {
    assert(
      validateRow({ event, detail, failure, page: 'charts', count: 1 }),
      `invalid finite usage tuple ${event}/${detail}/${failure}`,
    );
  }
}

test('successful direct connect and validated read are separate from browser commit', async () => {
  const f = makeSession();
  f.ports.sources.readSource = async () => ({ data: dataset(), source: direct() });
  f.ports.effects.ask = async () => {
    assert.deepEqual(
      events(f, 'provider_').map(([event]) => event),
      [
        'provider_connect_started',
        'provider_connect_completed',
        'provider_read_started',
        'provider_read_completed',
      ],
    );
    assert.equal(f.calls.save, 0);
    return { accept: true, remember: true };
  };
  await f.owner.importSource({ type: 'diving-fish' }, true, async () => ({
    type: 'diving-fish',
    connectionID: 'synthetic-grant',
  }));
  assert.equal(events(f, 'import_completed').length, 1);
  finite(f);
});

test('explicit cancellation emits one connect cancellation and no read or failed outcome', async () => {
  const f = makeSession(),
    started = deferred();
  let cancel;
  f.ports.effects.reading = (callback) => {
    cancel = callback;
    return () => {};
  };
  const waiting = f.owner.importSource(
    { type: 'diving-fish' },
    true,
    (signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), {
          once: true,
        });
        started.resolve();
      }),
  );
  await started.promise;
  cancel();
  await waiting;
  assert.deepEqual(
    events(f, 'provider_').map(([event]) => event),
    ['provider_connect_started', 'provider_connect_cancelled'],
  );
  assert.equal(events(f, 'import_cancelled').length, 1);
  assert.equal(events(f, 'import_failed').length, 0);
  finite(f);
});

test('read failure logs a finite failure without the upstream message or account', async () => {
  const f = makeSession();
  f.ports.sources.readSource = async () => {
    throw Error('secret account upstream URL');
  };
  await f.owner.importSource({ type: 'kamaitachi', account: 'not logged' }, true);
  assert.deepEqual(events(f, 'provider_'), [
    ['provider_read_started', 'kamaitachi'],
    ['provider_read_failed', 'kamaitachi', 'unavailable'],
  ]);
  assert(!JSON.stringify(f.calls.events).includes('secret'));
  assert(!JSON.stringify(f.calls.events).includes('not logged'));
  finite(f);
});

test('only manual refresh emits lifecycle events; automatic refresh and restore stay silent', async () => {
  for (const manual of [false, true]) {
    const source = direct(),
      f = makeSession({ initial: dataset(), source });
    await f.owner.ready;
    assert.deepEqual(events(f, 'provider_'), []);
    f.ports.sources.readSource = async () => ({ data: dataset(), source });
    await f.owner.refresh(manual);
    assert.deepEqual(
      events(f, 'provider_').map(([event]) => event),
      manual ? ['provider_refresh_started', 'provider_refresh_completed'] : [],
    );
    finite(f);
  }
});

test('offline Forget logs failed scoped disconnect after local erasure, without a refresh event', async () => {
  const f = makeSession({ initial: dataset(), source: direct() });
  await f.owner.ready;
  f.ports.sources.disconnect = async () => {
    assert.equal(f.state.active, null);
    throw Error('offline');
  };
  await f.owner.forget();
  assert.deepEqual(events(f, 'provider_'), [
    ['provider_disconnect_started', 'diving-fish'],
    ['provider_disconnect_failed', 'diving-fish', 'unavailable'],
  ]);
  assert.equal(f.state.active, null);
  finite(f);
});

test('a manual refresh cancelled by Forget has one cancelled outcome, without failure or completion', async () => {
  const f = makeSession({ initial: dataset(), source: direct() }),
    started = deferred();
  await f.owner.ready;
  f.ports.sources.readSource = async (_source, { signal }) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), {
        once: true,
      });
      started.resolve();
    });
  const pending = f.owner.refresh(true);
  await started.promise;
  await f.owner.forget();
  await pending;
  assert.deepEqual(
    events(f, 'provider_refresh_').map(([event]) => event),
    ['provider_refresh_started', 'provider_refresh_cancelled'],
  );
  finite(f);
});

test('LXNS connect, read, explicit refresh and disconnect reach only finite report counters', async () => {
  const f = makeSession();
  const source = direct('lxns');
  f.ports.sources.readSource = async () => ({ data: dataset(), source });
  f.ports.effects.ask = async () => ({ accept: true, remember: true });
  await f.owner.importSource({ type: 'lxns' }, true, async () => ({
    type: 'lxns',
    connectionID: 'PRIVATE-LXNS-GRANT',
  }));
  await f.owner.refresh(true);
  await f.owner.forget();
  assert.deepEqual(events(f, 'provider_'), [
    ['provider_connect_started', 'lxns'],
    ['provider_connect_completed', 'lxns'],
    ['provider_read_started', 'lxns'],
    ['provider_read_completed', 'lxns'],
    ['provider_refresh_started', 'lxns'],
    ['provider_refresh_completed', 'lxns'],
    ['provider_disconnect_started', 'lxns'],
    ['provider_disconnect_completed', 'lxns'],
  ]);
  assert(!JSON.stringify(f.calls.events).includes('PRIVATE-LXNS-GRANT'));
  assert.equal(f.state.active, null);
  finite(f);
});

test('remembered and one-time commits count success before slow obsolete-grant cleanup', async () => {
  for (const remember of [true, false]) {
    const old = direct(),
      f = makeSession({ initial: dataset(), source: old });
    await f.owner.ready;
    const started = deferred(),
      release = deferred();
    f.ports.sources.readSource = async () => ({
      data: dataset('new', 200),
      source: { ...old, connectionID: 'new-grant' },
    });
    f.ports.effects.ask = async () => ({ accept: true, remember });
    f.ports.sources.disconnect = async () => {
      started.resolve();
      await release.promise;
    };
    const running = f.owner.importSource({ type: 'diving-fish' }, remember, async () => ({
      type: 'diving-fish',
      connectionID: 'new-grant',
    }));
    await started.promise;
    assert.equal(f.owner.active.capturedAt, 200);
    assert.equal(f.owner.remembered, remember);
    assert.equal(events(f, 'import_completed').length, 1);
    assert.deepEqual(
      events(f, 'import_').map(([event]) => event),
      ['import_started', 'import_previewed', 'import_confirmed', 'import_completed'],
    );
    f.owner.cancel(); // A navigation after the commit cannot turn success into cancellation.
    release.resolve();
    await running;
    assert.equal(events(f, 'import_completed').length, 1);
    assert.equal(events(f, 'import_cancelled').length, 0);
    assert.equal(events(f, 'import_failed').length, 0);
    finite(f);
  }
});

test('a durable save finishing after cancellation counts success and retains its saved grant', async () => {
  for (const provider of ['diving-fish', 'lxns']) {
    const f = makeSession(),
      persisted = deferred(),
      release = deferred(),
      disconnected = [],
      source = direct(provider),
      save = f.ports.storage.save;
    f.ports.sources.readSource = async () => ({ data: dataset('new', 200), source });
    f.ports.sources.disconnect = async (value) => disconnected.push(value.connectionID);
    f.ports.storage.save = async (...args) => {
      const token = await save(...args);
      persisted.resolve();
      await release.promise;
      return token;
    };
    const running = f.owner.importSource({ type: provider }, true, async () => ({
      type: provider,
      connectionID: source.connectionID,
    }));
    await persisted.promise;
    assert.equal(f.state.active.source.connectionID, source.connectionID);
    f.owner.cancel();
    release.resolve();
    await running;
    assert.deepEqual(events(f, 'import_'), [
      ['import_started', provider],
      ['import_previewed', provider],
      ['import_confirmed', provider],
      ['import_completed', provider],
    ]);
    assert.deepEqual(disconnected, []);
    assert.equal(f.owner.active, null); // Superseded UI must not be installed.
    const restored = new f.owner.constructor(f.ports);
    await restored.ready;
    assert.equal(restored.active.capturedAt, 200);
    assert.equal(restored.source.connectionID, source.connectionID);
    assert.equal(restored.remembered, true);
    finite(f);
  }
});

test('a delayed durable-save result cannot resurrect a subsequent Clear or release its grant twice', async () => {
  const f = makeSession(),
    persisted = deferred(),
    release = deferred(),
    disconnected = [],
    source = direct(),
    save = f.ports.storage.save;
  f.ports.sources.readSource = async () => ({ data: dataset('new', 200), source });
  f.ports.sources.disconnect = async (value) => disconnected.push(value.connectionID);
  f.ports.storage.save = async (...args) => {
    const token = await save(...args);
    persisted.resolve();
    await release.promise;
    return token;
  };
  const running = f.owner.importSource({ type: source.type }, true, async () => ({
    type: source.type,
    connectionID: source.connectionID,
  }));
  await persisted.promise;
  await f.owner.clear();
  release.resolve();
  await running;
  assert.equal(f.state.active, null);
  assert.equal(f.owner.active, null);
  assert.equal(f.owner.remembered, false);
  assert.deepEqual(disconnected, [source.connectionID]);
  assert.equal(events(f, 'import_completed').length, 1);
  assert.equal(events(f, 'import_cancelled').length, 0);
  assert.equal(events(f, 'import_failed').length, 0);
  finite(f);
});

test('preview decline and storage failure never emit local commit success', async () => {
  for (const failure of ['decline', 'storage']) {
    const f = makeSession();
    f.ports.sources.readSource = async () => ({ data: dataset(), source: direct('lxns') });
    f.ports.effects.ask = async () => ({ accept: failure !== 'decline', remember: true });
    f.ports.storage.save = async () => {
      throw Error('PRIVATE storage detail');
    };
    await f.owner.importSource({ type: 'lxns' }, true);
    assert.equal(events(f, 'import_previewed').length, 1);
    assert.equal(events(f, 'import_confirmed').length, failure === 'storage' ? 1 : 0);
    assert.equal(events(f, 'import_completed').length, 0);
    assert.equal(events(f, 'import_cancelled').length, failure === 'decline' ? 1 : 0);
    if (failure === 'storage')
      assert.deepEqual(events(f, 'import_failed'), [['import_failed', 'lxns', 'storage']]);
    assert.ok(!JSON.stringify(f.calls.events).includes('PRIVATE'));
    finite(f);
  }
});

test('only typed finite causes classify direct failures across independently bundled modules', async () => {
  for (const reason of [
    'authorization_failed',
    'timeout',
    'network',
    'rate_limited',
    'connection_expired',
    'agreement_required',
    'profile_missing',
    'empty_scores',
    'invalid_response',
    'account_mismatch',
    'cleanup_required',
  ]) {
    const f = makeSession();
    f.ports.sources.readSource = async () => {
      throw new ImportFailureError('PRIVATE upstream account URL', reason, 'PRIVATE-CODE');
    };
    await f.owner.importSource({ type: 'lxns' }, true);
    assert.deepEqual(events(f, 'provider_read_failed'), [['provider_read_failed', 'lxns', reason]]);
    assert.deepEqual(events(f, 'import_failed'), [['import_failed', 'lxns', reason]]);
    assert.equal(events(f, 'import_previewed').length, 0);
    assert.ok(!JSON.stringify(f.calls.events).includes('PRIVATE'));
    finite(f);
  }
  const f = makeSession();
  f.ports.sources.readSource = async () => {
    throw Object.assign(Error('authorization_failed PRIVATE'), {
      code: 'authorization_failed',
      failure: 'empty_scores',
    });
  };
  await f.owner.importSource({ type: 'kamaitachi', account: 'PRIVATE' }, true);
  assert.deepEqual(events(f, 'provider_read_failed'), [
    ['provider_read_failed', 'kamaitachi', 'unavailable'],
  ]);
  finite(f);
});
