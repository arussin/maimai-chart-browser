import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeSession,
  deferred,
  dataset,
  file,
  connection,
  supersededReadiness,
} from './player-session-fixture.mjs';

test('a superseded readiness callback cannot unlock or commit a newer import', supersededReadiness);

test('invalid input and failed saves retain the previous profile with precise failure outcomes', async () => {
  for (const stage of ['invalid', 'storage']) {
    const f = makeSession({ initial: dataset(), source: connection() });
    await f.owner.ready;
    if (stage === 'invalid')
      f.ports.core.decode = async () => {
        throw Error('invalid file');
      };
    else
      f.ports.storage.save = async () => {
        throw Error('full device');
      };
    await f.owner.importFile(file(dataset('new')));
    assert.equal(f.owner.active.revision, 'one');
    assert.equal(f.state.active.revision, 'one');
    assert(f.calls.events.some((event) => event.join('/') === 'import_failed/file/' + stage));
    assert.equal(f.owner.busy, false);
  }
});

test('remembered to once rollback restores prior temporary bytes when forgetting fails', async () => {
  const source = connection(),
    f = makeSession({ initial: dataset(), source });
  await f.owner.ready;
  f.values.set('maimai-player-session', 'retained prior tab bytes');
  f.ports.effects.ask = async () => ({ accept: true, remember: false });
  f.ports.sources.readSource = async () => ({ data: dataset('new'), source });
  f.ports.storage.forget = async () => {
    throw Error('interrupted forget');
  };
  await f.owner.importSource('https://fixture.invalid/public', false);
  assert.equal(f.values.get('maimai-player-session'), 'retained prior tab bytes');
  assert.equal(f.state.active.revision, 'one');
  assert.equal(f.owner.active.revision, 'one');
  assert.equal(f.owner.remembered, true);
  assert.equal(f.owner.source.url, source.url);
  assert(f.calls.events.some((event) => event.join('/') === 'import_failed/report/storage'));
});

test('Forget waits for readiness, removes connection, and retains only in-memory scores', async () => {
  const load = deferred(),
    f = makeSession({ initial: dataset(), source: connection(), read: load.promise });
  const forgetting = f.owner.forget();
  assert.equal(f.calls.forget, 0);
  load.resolve();
  await forgetting;
  assert.equal(f.state.active, null);
  assert.equal(f.owner.active.revision, 'one');
  assert.equal(f.owner.source, null);
  assert.equal(f.owner.remembered, false);
  assert.equal(f.owner.busy, false);
  await f.owner.refresh(true);
  assert.equal(f.calls.claim, 0);
});

test('a refresh completing after Forget cannot resurrect scores or a saved connection', async () => {
  const reading = deferred(),
    started = deferred(),
    f = makeSession({ initial: dataset(), source: connection() });
  await f.owner.ready;
  let signal;
  f.ports.sources.readSource = async (_source, options) => {
    signal = options.signal;
    started.resolve();
    return reading.promise;
  };
  const refreshing = f.owner.refresh(true);
  await started.promise;
  await f.owner.forget();
  assert.equal(signal.aborted, true);
  reading.resolve({ data: dataset('new', 200), source: connection('new') });
  await refreshing;
  assert.equal(f.state.active, null);
  assert.equal(f.owner.active.revision, 'one');
  assert.equal(f.owner.source, null);
  assert.equal(f.calls.save, 0);
  assert.equal(f.calls.finish, 0);
});

test('unchanged refresh saves freshness without replacing portable observations', async () => {
  const f = makeSession({ initial: dataset(), source: connection() });
  await f.owner.ready;
  const original = Array.from(f.state.active.bytes);
  f.ports.sources.readSource = async () => ({ data: dataset(), source: connection() });
  await f.owner.refresh(true);
  assert.deepEqual(Array.from(f.state.active.bytes), original);
  assert.equal(f.owner.lastImportedAt, 1000000);
  assert.equal(f.calls.save, 1);
  assert.equal(f.owner.refreshing, false);
  assert.deepEqual(f.calls.events, [
    ['provider_refresh_started', 'report'],
    ['provider_refresh_completed', 'report'],
  ]);
});

test('interrupted and mismatched handoff transactions close their port without committing', async () => {
  for (const interrupted of [true, false]) {
    const f = makeSession();
    await f.owner.ready;
    const statuses = [];
    let closed = 0;
    const offered = dataset('offered'),
      transfer = {
        send: (type) => statuses.push(type),
        close: () => closed++,
        read: async () => {
          if (interrupted) throw Error('interrupted');
          return file(dataset('different')).arrayBuffer();
        },
      };
    await f.owner.handoff(f.ports.core.offer(offered), false, transfer);
    assert.equal(closed, 1);
    assert.equal(f.calls.save, 0);
    assert.equal(f.owner.active, null);
    assert.deepEqual(statuses, ['error']);
    assert(
      f.calls.events.some(
        (event) =>
          event.join('/') === 'import_failed/report/' + (interrupted ? 'unavailable' : 'invalid'),
      ),
    );
  }
});

test('cross-tab Clear invalidates a pending consent and removes in-memory data', async () => {
  const f = makeSession({ initial: dataset(), source: connection() }),
    offered = deferred();
  await f.owner.ready;
  f.ports.effects.ask = (_offer, _options, signal) =>
    new Promise((resolve) => {
      signal.addEventListener('abort', () => resolve({ accept: false, remember: false }), {
        once: true,
      });
      offered.resolve();
    });
  const importing = f.owner.importFile(file(dataset('new')));
  await offered.promise;
  f.state.active = null;
  f.state.control.epoch++;
  f.state.control.version++;
  f.state.control.clearedEpoch = f.state.control.epoch;
  await f.owner.receiveUpdate({
    kind: 'cleared',
    epoch: f.state.control.epoch,
    version: f.state.control.version,
  });
  await importing;
  assert.equal(f.owner.active, null);
  assert.equal(f.owner.source, null);
  assert.equal(f.calls.save, 0);
});
import { loadModule } from './module.mjs';
const { handoffTransfer } = await loadModule('runtime/player-session-browser', {
  Error,
  DOMException,
  ArrayBuffer,
  setTimeout,
  clearTimeout,
});
test('the handoff adapter aborts an outstanding transfer and exposes only protocol responses', async () => {
  const sent = [],
    port = { postMessage: (value) => sent.push(value), close: () => {}, onmessage: null };
  const signal = new AbortController(),
    transfer = handoffTransfer(port),
    reading = transfer.read(signal.signal);
  signal.abort();
  await assert.rejects(reading, { name: 'AbortError' });
  assert.equal(port.onmessage, null);
  assert.deepEqual(
    sent.map((value) => JSON.stringify(value)),
    ['{"type":"accept"}'],
  );
});

test('cancelling a confirmed handoff transfer logs one cancellation and keeps the saved profile', async () => {
  const f = makeSession({ initial: dataset(), source: connection() }),
    accepted = deferred(),
    sent = [];
  await f.owner.ready;
  const saved = structuredClone(f.state.active);
  let closed = 0;
  const port = {
    postMessage: (value) => {
      sent.push(value.type);
      if (value.type === 'accept') accepted.resolve();
    },
    close: () => closed++,
    onmessage: null,
  };
  const importing = f.owner.handoff(
    f.ports.core.offer(dataset('offered', 200)),
    false,
    handoffTransfer(port),
  );
  await accepted.promise;
  f.owner.cancel();
  f.owner.cancel();
  await importing;
  assert.deepEqual(f.calls.events, [
    ['import_opened'],
    ['import_started', 'report'],
    ['import_previewed', 'report'],
    ['import_confirmed', 'report'],
    ['import_cancelled', 'report'],
  ]);
  assert.equal(f.calls.save, 0);
  assert.equal(f.owner.active.revision, 'one');
  assert.deepEqual(f.state.active, saved);
  assert.equal(f.owner.remembered, true);
  assert.equal(f.calls.messages.length, 0);
  assert.equal(port.onmessage, null);
  assert.equal(closed, 1);
  assert.deepEqual(sent, ['accept', 'error']);
});

test('a committed handoff remains one success when cancelled before the save result returns', async () => {
  const f = makeSession({ initial: dataset(), source: connection() }),
    accepted = deferred(),
    persisted = deferred(),
    release = deferred(),
    offered = dataset('offered', 200),
    sent = [],
    save = f.ports.storage.save;
  await f.owner.ready;
  f.ports.storage.save = async (...args) => {
    const token = await save(...args);
    persisted.resolve();
    await release.promise;
    return token;
  };
  let closed = 0;
  const port = {
    postMessage: (value) => {
      sent.push(value.type);
      if (value.type === 'accept') accepted.resolve();
    },
    close: () => closed++,
    onmessage: null,
  };
  const importing = f.owner.handoff(f.ports.core.offer(offered), false, handoffTransfer(port));
  await accepted.promise;
  port.onmessage({ data: { type: 'data', bytes: await file(offered).arrayBuffer() } });
  await persisted.promise;
  f.owner.cancel();
  release.resolve();
  await importing;
  f.owner.cancel();
  assert.deepEqual(f.calls.events, [
    ['import_opened'],
    ['import_started', 'report'],
    ['import_previewed', 'report'],
    ['import_confirmed', 'report'],
    ['import_completed', 'report'],
  ]);
  assert.equal(f.calls.save, 1);
  assert.equal(f.state.active.revision, 'offered');
  assert.equal(f.owner.active.revision, 'one'); // A superseded view stays unchanged.
  assert.equal(f.calls.messages.length, 0);
  assert.equal(port.onmessage, null);
  assert.equal(closed, 1);
  assert.deepEqual(sent, ['accept', 'error']);
  const restored = new f.owner.constructor(f.ports);
  await restored.ready;
  assert.equal(restored.active.revision, 'offered');
  assert.equal(restored.remembered, true);
});

test('a cancelled handoff waiting for storage cannot unlock a newer import', async () => {
  const f = makeSession(),
    blocked = deferred(),
    entered = deferred(),
    offered = deferred(),
    consent = deferred();
  await f.owner.ready;
  const begin = f.ports.storage.begin;
  let first = true;
  f.ports.storage.begin = async (expected) => {
    if (first) {
      first = false;
      entered.resolve();
      await blocked.promise;
      return f.token();
    }
    return begin(expected);
  };
  const transfer = {
    send: () => {},
    close: () => {},
    read: () => {
      throw Error('cancelled handoff must not read');
    },
  };
  const stale = f.owner.handoff(f.ports.core.offer(dataset('old')), false, transfer);
  await entered.promise;
  f.owner.cancel();
  f.ports.effects.ask = () => {
    offered.resolve();
    return consent.promise;
  };
  const current = f.owner.importFile(file(dataset('new')));
  await offered.promise;
  blocked.resolve();
  await stale;
  assert.equal(f.owner.busy, true);
  assert.equal(f.calls.save, 0);
  consent.resolve({ accept: true, remember: true });
  await current;
  assert.equal(f.owner.active.revision, 'new');
});

test('delayed refresh bookkeeping cannot restore a connection after Forget', async () => {
  for (const outcome of ['older', 'failed']) {
    const f = makeSession({ initial: dataset(), source: connection() }),
      entered = deferred(),
      blocked = deferred();
    await f.owner.ready;
    f.ports.sources.readSource = async () => {
      if (outcome === 'failed') throw Error('unavailable');
      return { data: dataset('older', 50), source: connection('older') };
    };
    const finish = f.ports.storage.finish;
    f.ports.storage.finish = async (...args) => {
      const value = await finish(...args);
      entered.resolve();
      await blocked.promise;
      return value;
    };
    const refreshing = f.owner.refresh(true);
    await entered.promise;
    await f.owner.forget();
    blocked.resolve();
    await refreshing;
    assert.equal(f.owner.source, null, outcome);
    assert.equal(f.owner.remembered, false);
    assert.equal(f.state.active, null);
  }
});
