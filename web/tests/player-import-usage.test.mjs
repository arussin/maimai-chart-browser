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

const fileProviders = ['tomomai', 'mai-tools', 'dxrating', 'jietng', 'aqua', 'tachi'];
const localFile = () => ({
  name: 'PRIVATE-export.json',
  size: 1,
  arrayBuffer: async () => new ArrayBuffer(1),
});
const fileOptions = (format) => ({
  format,
  username: 'PRIVATE-account',
  region: format === 'aqua' || format === 'tachi' ? 'private' : 'intl',
  ...(format === 'aqua' || format === 'tachi' ? { instance: 'PRIVATE-instance.invalid' } : {}),
});
const fileResult = (revision = 'new') => ({
  data: dataset(revision, 200),
  excludedUtage: 0,
  snapshotDateUnknown: true,
});

test('all six file formats pass exact options and disclose diagnostics before a finite local commit', async () => {
  for (const format of fileProviders) {
    const f = makeSession(),
      upload = localFile(),
      options = fileOptions(format),
      result = fileResult();
    result.data.records = { pb: {}, play: {}, observed: {}, secondObservation: {} };
    result.data.plays = { realPlay: 'play' };
    result.data.snapshots = { captured: { pbs: { chart: 'pb' } } };
    result.excludedUtage = 2;
    f.ports.effects.unmatched = (data) => {
      assert.equal(data, result.data);
      return 3;
    };
    f.ports.readFile = async (file, received) => {
      assert.equal(file, upload);
      assert.equal(received, options);
      assert.equal(f.calls.save, 0);
      return result;
    };
    f.ports.effects.ask = async (_offer, diagnostics) => {
      assert.equal(f.calls.save, 0);
      assert.deepEqual(JSON.parse(JSON.stringify(diagnostics)), {
        file: true,
        fileExport: true,
        unlinkedObservations: 2,
        excludedUtage: 2,
        snapshotDateUnknown: true,
        unmatched: 3,
      });
      return { accept: true, remember: true };
    };
    await f.owner.importFile(upload, options);
    assert.deepEqual(events(f, 'import_'), [
      ['import_started', `file:${format}`],
      ['import_previewed', `file:${format}`],
      ['import_confirmed', `file:${format}`],
      ['import_completed', `file:${format}`],
    ]);
    assert.equal(f.calls.save, 1);
    assert.equal(f.owner.active.revision, 'new');
    assert.equal(f.owner.source, null);
    assert.deepEqual(events(f, 'provider_'), []);
    assert.ok(!JSON.stringify(f.calls.events).includes('PRIVATE'));
    finite(f);
  }
});

test('all six malformed file failures remain finite and leave saved scores intact', async () => {
  for (const format of fileProviders) {
    const f = makeSession({ initial: dataset('retained') });
    await f.owner.ready;
    f.ports.readFile = async () => {
      throw Error('PRIVATE filename, account and parser detail');
    };
    await f.owner.importFile(localFile(), fileOptions(format));
    assert.deepEqual(events(f, 'import_'), [
      ['import_started', `file:${format}`],
      ['import_failed', `file:${format}`, 'invalid'],
    ]);
    assert.equal(f.calls.save, 0);
    assert.equal(f.owner.active.revision, 'retained');
    assert.equal(f.state.active.revision, 'retained');
    assert.ok(!JSON.stringify(f.calls.events).includes('PRIVATE'));
    finite(f);
  }
});

test('declining each file preview counts cancellation without confirmation or persistence', async () => {
  for (const format of fileProviders) {
    const f = makeSession();
    f.ports.readFile = async () => fileResult();
    f.ports.effects.ask = async () => ({ accept: false, remember: true });
    await f.owner.importFile(localFile(), fileOptions(format));
    assert.deepEqual(events(f, 'import_'), [
      ['import_started', `file:${format}`],
      ['import_previewed', `file:${format}`],
      ['import_cancelled', `file:${format}`],
    ]);
    assert.equal(f.calls.save, 0);
    assert.equal(f.state.active, null);
    finite(f);
  }
});

test('cancelling any file during reading prevents late results from opening a preview', async () => {
  for (const format of fileProviders) {
    const f = makeSession(),
      reading = deferred(),
      release = deferred();
    f.ports.readFile = async () => {
      reading.resolve();
      return release.promise;
    };
    const running = f.owner.importFile(localFile(), fileOptions(format));
    await reading.promise;
    f.owner.cancel();
    release.resolve(fileResult());
    await running;
    assert.deepEqual(events(f, 'import_'), [
      ['import_started', `file:${format}`],
      ['import_cancelled', `file:${format}`],
    ]);
    assert.equal(f.calls.save, 0);
    assert.equal(f.owner.active, null);
    finite(f);
  }
});

test('all six file storage failures never count a successful local import', async () => {
  for (const format of fileProviders) {
    const f = makeSession({ initial: dataset('retained') });
    await f.owner.ready;
    f.ports.readFile = async () => fileResult();
    f.ports.storage.save = async () => {
      throw Error('PRIVATE storage failure');
    };
    await f.owner.importFile(localFile(), fileOptions(format));
    assert.deepEqual(events(f, 'import_'), [
      ['import_started', `file:${format}`],
      ['import_previewed', `file:${format}`],
      ['import_confirmed', `file:${format}`],
      ['import_failed', `file:${format}`, 'storage'],
    ]);
    assert.equal(f.owner.active.revision, 'retained');
    assert.equal(f.state.active.revision, 'retained');
    assert.ok(!JSON.stringify(f.calls.events).includes('PRIVATE'));
    finite(f);
  }
});

test('all six durable file saves count once after cancellation without installing a stale view', async () => {
  for (const format of fileProviders) {
    const f = makeSession(),
      persisted = deferred(),
      release = deferred(),
      save = f.ports.storage.save;
    f.ports.readFile = async () => fileResult();
    f.ports.storage.save = async (...args) => {
      const token = await save(...args);
      persisted.resolve();
      await release.promise;
      return token;
    };
    const running = f.owner.importFile(localFile(), fileOptions(format));
    await persisted.promise;
    f.owner.cancel();
    release.resolve();
    await running;
    assert.deepEqual(events(f, 'import_'), [
      ['import_started', `file:${format}`],
      ['import_previewed', `file:${format}`],
      ['import_confirmed', `file:${format}`],
      ['import_completed', `file:${format}`],
    ]);
    assert.equal(f.owner.active, null);
    assert.equal(f.state.active.source, null);
    const restored = new f.owner.constructor(f.ports);
    await restored.ready;
    assert.equal(restored.active.revision, 'new');
    assert.equal(restored.remembered, true);
    assert.equal(restored.source, null);
    finite(f);
  }
});

test('a delayed file save cannot resurrect data cleared after its durable commit', async () => {
  const f = makeSession(),
    persisted = deferred(),
    release = deferred(),
    save = f.ports.storage.save;
  f.ports.readFile = async () => fileResult();
  f.ports.storage.save = async (...args) => {
    const token = await save(...args);
    persisted.resolve();
    await release.promise;
    return token;
  };
  const running = f.owner.importFile(localFile(), fileOptions('tomomai'));
  await persisted.promise;
  await f.owner.clear();
  release.resolve();
  await running;
  assert.equal(f.state.active, null);
  assert.equal(f.owner.active, null);
  assert.equal(events(f, 'import_completed').length, 1);
  assert.equal(events(f, 'import_cancelled').length, 0);
  assert.equal(events(f, 'import_failed').length, 0);
  finite(f);
});

test('a superseded file reconciliation cannot borrow a newer import signal or reopen consent', async () => {
  const f = makeSession(),
    reconciling = deferred(),
    release = deferred(),
    newShown = deferred(),
    newChoice = deferred(),
    offers = [];
  f.ports.readFile = async (_file, options) => fileResult(options.format);
  f.ports.core.reconcile = async (data) => {
    if (data.revision === 'tomomai') {
      reconciling.resolve();
      await release.promise;
    }
    return data;
  };
  f.ports.effects.ask = async (offer) => {
    offers.push(offer.revision);
    if (offer.revision === 'dxrating') {
      newShown.resolve();
      return newChoice.promise;
    }
    return { accept: true, remember: true };
  };
  const old = f.owner.importFile(localFile(), fileOptions('tomomai'));
  await reconciling.promise;
  f.owner.cancel();
  const current = f.owner.importFile(localFile(), fileOptions('dxrating'));
  await newShown.promise;
  release.resolve();
  await old;
  assert.deepEqual(offers, ['dxrating']);
  assert.equal(f.owner.busy, true);
  assert.equal(f.calls.save, 0);
  newChoice.resolve({ accept: true, remember: true });
  await current;
  assert.equal(f.owner.active.revision, 'dxrating');
  assert.deepEqual(events(f, 'import_cancelled'), [['import_cancelled', 'file:tomomai']]);
  assert.deepEqual(events(f, 'import_completed'), [['import_completed', 'file:dxrating']]);
  finite(f);
});

test('a file parser rejecting after cancellation cannot show a stale error over a later operation', async () => {
  const f = makeSession(),
    reading = deferred(),
    release = deferred();
  f.ports.readFile = async () => {
    reading.resolve();
    return release.promise;
  };
  const running = f.owner.importFile(localFile(), fileOptions('aqua'));
  await reading.promise;
  f.owner.cancel();
  release.reject(Error('PRIVATE stale parser detail'));
  await running;
  assert.deepEqual(events(f, 'import_'), [
    ['import_started', 'file:aqua'],
    ['import_cancelled', 'file:aqua'],
  ]);
  assert.equal(f.calls.messages.length, 0);
  assert.equal(f.calls.save, 0);
  finite(f);
});
