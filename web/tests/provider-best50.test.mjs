import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { loadModule } from './module.mjs';
import { makeSession } from './player-session-fixture.mjs';

const globals = {
  crypto: webcrypto,
  TextEncoder,
  TextDecoder,
  Blob,
  DecompressionStream,
  CompressionStream,
  structuredClone,
  Date,
  Map,
  Set,
  Uint8Array,
  ArrayBuffer,
};
const { createPlayerDataCore } = await loadModule('views/player-data-core', globals);
const core = createPlayerDataCore();
const clone = (value) => JSON.parse(JSON.stringify(value));

async function fixture(provider = 'diving-fish') {
  const data = {
    format: 'maimai-player-data',
    schemaVersion: 1,
    revision: '',
    player: {
      provider,
      game: 'maimaidx',
      username: 'Fixture',
      displayName: 'Fictional',
      key: provider + ':maimaidx:cn:Fixture',
    },
    charts: {},
    records: {},
    plays: {},
    snapshots: {},
    captures: {},
  };
  const refs = [];
  for (const [id, rate] of [
    [1, 0],
    [1, 999],
    [2, 200],
  ]) {
    const chartID = provider + ':cn:' + id;
    data.charts[chartID] = {
      chartID,
      songID: String(id),
      title: 'Fictional ' + id,
      artist: '',
      format: 'DX',
      difficulty: 'MASTER',
      level: '13',
      constant: 130,
      displayVersion: 'PRiSM PLUS',
      inGameID: id,
    };
    const record = {
      chartID,
      achievement: 1000000,
      grade: 'SSS',
      rate,
      lamp: '',
      sync: '',
      constant: 130,
      displayVersion: 'PRiSM PLUS',
      timeAchieved: null,
      dxScore: null,
      maxDxScore: null,
      maxCombo: null,
      fast: null,
      slow: null,
      miss: null,
      good: null,
      great: null,
      perfect: null,
      pcrit: null,
    };
    const ref = await core.digest(record);
    data.records[ref] = record;
    refs.push(ref);
  }
  const snapshot = {
    capturedAt: 1000,
    phase: 'after',
    complete: true,
    versions: ['PRiSM PLUS'],
    pbs: { [provider + ':cn:1']: refs[1] },
    best50: { provider, region: 'cn', old: [refs[0]], new: [refs[2]] },
  };
  data.snapshots[await core.digest(snapshot)] = snapshot;
  return { data: await seal(data), refs };
}
async function seal(data) {
  const { revision, ...body } = data;
  data.revision = await core.digest(body);
  return core.validate(data);
}

test('both providers retain exact Best 50 observations through portable encode/decode', async () => {
  for (const provider of ['diving-fish', 'lxns']) {
    const { data, refs } = await fixture(provider);
    const decoded = await core.decode(await core.encode(data));
    assert.deepEqual(clone(decoded), clone(data));
    const { snapshot, pbs } = core.current(decoded);
    assert.equal(pbs.get(provider + ':cn:1').rate, 999);
    assert.equal(decoded.records[snapshot.best50.old[0]].rate, 0);
    assert.deepEqual(clone(snapshot.best50.new), [refs[2]]);
    assert.equal(core.offer(decoded).profile.rating, null);
    assert.equal(core.offer(decoded).pbCount, 1);
    assert.equal(core.offer(decoded).playCount, 0);
  }
});

test('old v1 snapshots remain valid and a later absence remains unavailable after merge', async () => {
  const { data } = await fixture();
  const next = clone(data);
  const snapshot = { ...Object.values(next.snapshots)[0], capturedAt: 2000 };
  delete snapshot.best50;
  next.snapshots = { [await core.digest(snapshot)]: snapshot };
  await seal(next);
  assert.deepEqual(clone(await core.decode(await core.encode(next))), next);
  const merged = await core.merge(data, next);
  assert.equal(core.current(merged).snapshot.best50, undefined);
  assert.equal(Object.values(merged.snapshots).filter((row) => row.best50).length, 1);
  assert.equal(core.offer(merged).profile.rating, null);
});

test('Best 50 metadata is exact, provider-scoped, bounded and unique by chart across pools', async () => {
  const mutations = [
    (s) => {
      s.best50 = null;
    },
    (s) => {
      s.best50.extra = true;
    },
    (s) => {
      s.best50.provider = 'lxns';
    },
    (s) => {
      s.best50.region = 'jp';
    },
    (s) => {
      s.best50.old = 'not an array';
    },
    (s) => {
      s.best50.old = Array(36).fill(s.best50.old[0]);
    },
    (s) => {
      s.best50.new = Array(16).fill(s.best50.new[0]);
    },
    (s) => {
      s.best50.new = [s.best50.old[0]];
    },
    (s, refs) => {
      s.best50.new = [refs[1]];
    },
    (s) => {
      s.best50.old = ['f'.repeat(64)];
    },
    (s) => {
      s.best50.old = [null];
    },
  ];
  for (const mutate of mutations) {
    const { data, refs } = await fixture();
    const snapshot = Object.values(data.snapshots)[0];
    mutate(snapshot, refs);
    await assert.rejects(core.validate(data), /Best 50/);
  }
  for (const rate of [null, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const { data, refs } = await fixture();
    data.records[refs[0]].rate = rate;
    await assert.rejects(core.validate(data));
  }
  const { data, refs } = await fixture();
  data.records[refs[0]].rate = Number.MAX_SAFE_INTEGER;
  await assert.rejects(core.validate(data), /Best 50 rating total/);
});

test('Best 50-only charts participate in deterministic newest chart metadata merging', async () => {
  const { data } = await fixture();
  const next = clone(data);
  const snapshot = { ...Object.values(next.snapshots)[0], capturedAt: 2000 };
  next.snapshots = { [await core.digest(snapshot)]: snapshot };
  next.charts['diving-fish:cn:2'].title = 'A newer provider title';
  await seal(next);
  for (const inputs of [
    [data, next],
    [next, data],
  ]) {
    const merged = await core.merge(...inputs);
    assert.equal(merged.charts['diving-fish:cn:2'].title, 'A newer provider title');
    assert.equal(core.current(merged).snapshot.capturedAt, 2000);
  }
});

test('portable import preview counts genuine orphans but not either selected Best 50 pool', async () => {
  for (const provider of ['diving-fish', 'lxns']) {
    const { data, refs } = await fixture(provider);
    const orphan = { ...data.records[refs[0]], rate: 777 };
    data.records[await core.digest(orphan)] = orphan;
    await seal(data);
    const bytes = await core.encode(data);
    const previews = [];
    const f = makeSession({
      configure(ports) {
        ports.core = core;
        ports.effects.ask = async (_offer, details) => {
          previews.push(details);
          return { accept: true, remember: true };
        };
      },
    });
    await f.owner.ready;
    await f.owner.importFile({
      size: bytes.length,
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
    assert.equal(previews.length, 1);
    assert.equal(previews[0].unlinkedObservations, 1);
    const saved = await core.decode(f.state.active.bytes);
    assert.equal(saved.revision, data.revision);
    assert.equal(Object.keys(saved.records).length, 4);
    assert.deepEqual(clone(core.current(saved).snapshot.best50), {
      provider,
      region: 'cn',
      old: [refs[0]],
      new: [refs[2]],
    });
    assert.equal(Object.keys(saved.plays).length, 0);
    assert.equal(f.calls.events.filter(([event]) => event === 'import_completed').length, 1);
  }
});

test('direct refresh hashes membership and its absence, never acquisition timestamps', async () => {
  const rows = [1, 2].map((song_id) => ({
    song_id,
    title: 'Fictional ' + song_id,
    type: 'DX',
    level_index: 3,
    achievements: 100,
    ds: 13,
    ra: song_id * 100,
    fc: '',
    fs: '',
    dxScore: 100,
  }));
  let selection = { old: [rows[0]], new: [rows[1]] };
  let fetchedAt = 1000;
  const { createPlayerSources } = await loadModule('views/player-sources', {
    ...globals,
    Error,
    DOMException,
    AbortController,
    AbortSignal,
    URL,
    Response,
    fetch: async (url) => {
      assert.equal(url, '/api/player-import/oauth/diving-fish/read');
      return new Response(
        JSON.stringify({
          provider: 'diving-fish',
          accountID: 'a'.repeat(64),
          connectionID: 'x'.repeat(32),
          displayName: 'Fictional',
          fetchedAt: fetchedAt++,
          capturedAt: null,
          coverage: 'full',
          data: { records: rows, ...(selection ? { best50: selection } : {}) },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    },
  });
  const sources = createPlayerSources({ playerCore: core });
  const read = () => sources.readDirect({ type: 'diving-fish', connectionID: 'x'.repeat(32) });
  const first = await read();
  const repeated = await read();
  assert.notEqual(first.data.revision, repeated.data.revision);
  assert.equal(first.source.contentRevision, repeated.source.contentRevision);
  selection = { old: [rows[1]], new: [rows[0]] };
  const changed = await read();
  assert.deepEqual(clone(changed.data.records), clone(first.data.records));
  assert.notEqual(changed.source.contentRevision, first.source.contentRevision);
  selection = null;
  const absent = await read();
  assert.deepEqual(clone(absent.data.records), clone(first.data.records));
  assert.notEqual(absent.source.contentRevision, changed.source.contentRevision);
  assert.equal((await read()).source.contentRevision, absent.source.contentRevision);
});
