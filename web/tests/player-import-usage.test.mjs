import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSession, dataset, connection, deferred } from './player-session-fixture.mjs';
import { loadModule } from './module.mjs';
const { validateRow } = await loadModule('usage-contract');
const direct = () => ({
  ...connection(),
  type: 'diving-fish',
  connectionID: 'synthetic-grant',
  url: '/api/player-import/oauth/diving-fish/read',
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
