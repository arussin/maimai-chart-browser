import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSession, dataset, connection } from './player-session-fixture.mjs';

const direct = (revision = 'new', id = 'new-grant') => ({
  ...connection(revision),
  type: 'diving-fish',
  account: 'a'.repeat(64),
  connectionID: id,
  url: '/api/player-import/oauth/diving-fish/read',
  sourceUpdatedAt: 200,
  contentRevision: 'new-content',
});

test('direct providers retain their type and preview before saving an acquired grant', async () => {
  const f = makeSession();
  const acquired = { type: 'diving-fish', account: 'a'.repeat(64), connectionID: 'new-grant' };
  const events = [];
  f.ports.sources.readSource = async (source) => {
    assert.equal(source.type, 'diving-fish');
    assert.equal(source.connectionID, acquired.connectionID);
    events.push('read');
    return { data: dataset('new', 200), source: direct() };
  };
  f.ports.effects.ask = async () => {
    assert.equal(f.calls.save, 0);
    events.push('preview');
    return { accept: true, remember: true };
  };
  f.ports.sources.disconnect = async () => events.push('disconnect');
  await f.owner.importSource({ type: 'diving-fish' }, true, async () => {
    events.push('authorize');
    return acquired;
  });
  assert.deepEqual(events, ['authorize', 'read', 'preview']);
  assert.equal(f.state.active.source.connectionID, acquired.connectionID);
  assert.equal(f.owner.source.type, 'diving-fish');
  assert(f.calls.events.some((event) => event.join('/') === 'import_completed/diving-fish'));
});

test('cancelled direct preview removes only the newly acquired grant and retains saved scores', async () => {
  const f = makeSession({ initial: dataset(), source: connection() });
  const disconnected = [];
  f.ports.sources.disconnect = async (source) => {
    if (source.connectionID) disconnected.push(source.connectionID);
  };
  f.ports.sources.readSource = async () => ({ data: dataset('new', 200), source: direct() });
  f.ports.effects.ask = async () => ({ accept: false, remember: false });
  await f.owner.importSource({ type: 'diving-fish' }, true, async () => ({
    type: 'diving-fish',
    connectionID: 'new-grant',
  }));
  assert.equal(f.state.active.revision, 'one');
  assert.equal(f.owner.active.revision, 'one');
  assert.deepEqual(disconnected, ['new-grant']);
  assert.equal(f.calls.save, 0);
});

test('one-time OAuth import keeps tab data and releases its server grant', async () => {
  const f = makeSession();
  const disconnected = [];
  f.ports.sources.disconnect = async (source) => {
    if (source.connectionID) disconnected.push(source.connectionID);
  };
  f.ports.sources.readSource = async () => ({ data: dataset('new', 200), source: direct() });
  f.ports.effects.ask = async () => ({ accept: true, remember: false });
  await f.owner.importSource({ type: 'diving-fish' }, false, async () => ({
    type: 'diving-fish',
    connectionID: 'new-grant',
  }));
  assert.equal(f.owner.active.capturedAt, 200);
  assert.equal(f.owner.source, null);
  assert.equal(f.state.active, null);
  assert.deepEqual(disconnected, ['new-grant']);
});

test('unchanged direct refresh updates freshness without adding retrieval snapshots', async () => {
  const savedSource = direct('one', 'retained-grant');
  const f = makeSession({ initial: dataset(), source: savedSource });
  await f.owner.ready;
  const bytes = Array.from(f.state.active.bytes);
  f.ports.sources.readSource = async (source, options) => {
    assert.equal(source.connectionID, 'retained-grant');
    assert.equal(options.expectedPlayer, dataset().player.key);
    return {
      data: dataset('new-fetch-time', 300),
      source: { ...savedSource, sourceRevision: 'new-fetch-time', sourceUpdatedAt: 300 },
    };
  };
  await f.owner.refresh(true);
  assert.deepEqual(Array.from(f.state.active.bytes), bytes);
  assert.equal(f.owner.active.revision, 'one');
  assert.equal(f.owner.source.lastChecked, 1000000);
});

test('failed direct refresh preserves the profile and Forget cancels future reads', async () => {
  const f = makeSession({ initial: dataset(), source: direct('one', 'retained-grant') });
  const disconnected = [];
  await f.owner.ready;
  f.ports.sources.readSource = async () => {
    throw Error('grant expired');
  };
  f.ports.sources.disconnect = async (source) => {
    if (source.connectionID) disconnected.push(source.connectionID);
  };
  await f.owner.refresh(true);
  assert.equal(f.owner.active.revision, 'one');
  assert.match(f.owner.refreshText, /saved data/);
  await f.owner.forget();
  assert.deepEqual(disconnected, ['retained-grant']);
  assert.equal(f.state.active, null);
  assert.equal(f.owner.source, null);
  const attempts = f.calls.claim;
  await f.owner.refresh(true);
  assert.equal(f.calls.claim, attempts);
});

test('agreement-required refresh shows fixed setup guidance while preserving saved scores and grant', async () => {
  for (const manual of [false, true]) {
    const f = makeSession({ initial: dataset(), source: direct('one', 'retained-grant') });
    const disconnected = [];
    await f.owner.ready;
    const bytes = Array.from(f.state.active.bytes);
    const retainedData = JSON.stringify(f.owner.active);
    f.ports.sources.disconnect = async (source) => disconnected.push(source.connectionID);
    f.ports.sources.readSource = async () => {
      throw Object.assign(Error('PRIVATE provider text, account and token must never be shown'), {
        code: 'tracker_agreement_required',
        retryAt: 1030000,
      });
    };
    await f.owner.refresh(manual);
    assert.equal(
      f.owner.refreshText,
      'Open Diving-Fish, accept its tracker agreement, and confirm your scores are visible. Then try again.',
    );
    assert.equal(JSON.stringify(f.owner.active), retainedData);
    assert.deepEqual(Array.from(f.state.active.bytes), bytes);
    assert.equal(f.owner.source.connectionID, 'retained-grant');
    assert.equal(f.state.active.source.connectionID, 'retained-grant');
    assert.equal(f.owner.source.retryAt, 1030000);
    assert.equal(f.owner.remembered, true);
    assert.equal(f.calls.save, 0);
    assert.equal(f.calls.forget, 0);
    assert.deepEqual(disconnected, []);
    assert(!JSON.stringify(f.calls.events).includes('PRIVATE'));
    assert.deepEqual(
      f.calls.events,
      manual
        ? [
            ['provider_refresh_started', 'diving-fish'],
            ['provider_refresh_failed', 'diving-fish', 'unavailable'],
          ]
        : [],
    );
  }
});

test('refresh setup guidance requires the exact Fish error code and never relays arbitrary errors', async () => {
  for (const [type, code] of [
    ['diving-fish', undefined],
    ['diving-fish', 'tracker_agreement_required PRIVATE'],
    ['diving-fish', 'authorization_failed'],
    ['kamaitachi', 'tracker_agreement_required'],
    ['report', 'tracker_agreement_required'],
  ]) {
    const f = makeSession({ initial: dataset(), source: { ...direct(), type } });
    await f.owner.ready;
    f.ports.sources.readSource = async () => {
      throw Object.assign(Error('PRIVATE upstream text'), { code });
    };
    await f.owner.refresh(true);
    assert.equal(f.owner.refreshText, 'Could not refresh — showing your saved data');
    assert.equal(f.owner.active.revision, 'one');
    assert.equal(f.calls.save, 0);
    assert(!JSON.stringify(f.calls.events).includes('PRIVATE'));
  }
});

test('failed server grant removal is explicit after local Forget completes', async () => {
  const f = makeSession({ initial: dataset(), source: direct('one', 'retained-grant') });
  await f.owner.ready;
  f.ports.sources.disconnect = async () => {
    throw Error('The provider connection could not be removed. Try again when online.');
  };
  await f.owner.forget();
  assert.equal(f.calls.forget, 1);
  assert.equal(f.state.active, null);
  assert.equal(f.owner.source, null);
  assert(f.calls.messages.some((entry) => entry[1].includes('Saved player data was removed.')));
});

test('a one-time different source preserves the saved grant until Clear removes that retained profile', async () => {
  const f = makeSession({ initial: dataset(), source: direct('one', 'retained-grant') });
  const disconnected = [];
  await f.owner.ready;
  f.ports.sources.disconnect = async (source) => {
    if (source.connectionID) disconnected.push(source.connectionID);
  };
  f.ports.sources.readSource = async () => ({
    data: dataset('temporary', 200),
    source: { ...connection(), url: 'https://other.example/player/party/latest.json' },
  });
  f.ports.effects.ask = async () => ({ accept: true, remember: false });
  await f.owner.importSource('https://other.example/player/');
  assert.equal(f.owner.source, null);
  assert.equal(f.state.active.source.connectionID, 'retained-grant');
  assert.deepEqual(disconnected, []);
  await f.owner.clear();
  assert.equal(f.state.active, null);
  assert.equal(f.owner.active, null);
  assert.deepEqual(disconnected, ['retained-grant']);
});

test('a newly remembered candidate finalizes other same-provider grants only after the atomic save', async () => {
  const f = makeSession();
  const events = [];
  f.ports.sources.readSource = async () => ({ data: dataset('new', 200), source: direct() });
  f.ports.sources.disconnect = async (source) => {
    assert.equal(f.state.active.source.connectionID, 'new-grant');
    events.push(source.connectionID);
  };
  await f.owner.importSource({ type: 'diving-fish' }, true, async () => ({
    type: 'diving-fish',
    connectionID: 'new-grant',
    previousConnectionIDs: ['old-grant'],
  }));
  assert.deepEqual(events, ['old-grant']);
});

test('one-time different OAuth account sharing the provider read URL preserves the original saved profile and grant', async () => {
  const initial = dataset();
  initial.player.key = 'diving-fish:maimaidx:cn:' + 'a'.repeat(64);
  const previous = { ...direct('one', 'original-grant'), playerKey: initial.player.key };
  const f = makeSession({ initial, source: previous });
  const disconnected = [];
  await f.owner.ready;
  const incoming = dataset('new-account', 200);
  incoming.player.key = 'diving-fish:maimaidx:cn:' + 'b'.repeat(64);
  f.ports.sources.disconnect = async (source) => disconnected.push(source.connectionID);
  f.ports.sources.readSource = async () => ({
    data: incoming,
    source: { ...direct('new-account', 'candidate-grant'), playerKey: incoming.player.key },
  });
  f.ports.effects.ask = async () => ({ accept: true, remember: false });
  await f.owner.importSource({ type: 'diving-fish' }, false, async () => ({
    type: 'diving-fish',
    connectionID: 'candidate-grant',
  }));
  assert.equal(f.owner.active.player.key, incoming.player.key);
  assert.equal(f.state.active.source.connectionID, 'original-grant');
  assert.equal(f.calls.forget, 0);
  assert.deepEqual(disconnected, ['candidate-grant']);
});

test('remembered replacement releases an older saved grant hidden by one-time tab data', async () => {
  const f = makeSession({ initial: dataset(), source: direct('one', 'retained-grant') });
  const disconnected = [];
  await f.owner.ready;
  f.ports.sources.disconnect = async (source) => disconnected.push(source.connectionID);
  f.ports.sources.readSource = async () => ({
    data: dataset('temporary', 200),
    source: { ...connection(), url: 'https://other.example/player/party/latest.json' },
  });
  f.ports.effects.ask = async () => ({ accept: true, remember: false });
  await f.owner.importSource('https://other.example/player/', false);
  assert.equal(f.owner.source, null);
  assert.equal(f.state.active.source.connectionID, 'retained-grant');
  f.ports.effects.ask = async () => ({ accept: true, remember: true });
  f.ports.sources.readSource = async () => ({
    data: dataset('remembered-replacement', 300),
    source: { ...connection(), url: 'https://other.example/player/party/latest.json' },
  });
  await f.owner.importSource('https://other.example/player/', true);
  assert.deepEqual(disconnected, ['retained-grant']);
  assert.equal(f.state.active.source.type, 'report');
});
