import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { loadModule } from './module.mjs';

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
const { normalizeImportDocument } = await loadModule('runtime/import-provider', globals);
const { exactFileChartIndex } = await loadModule('domain/import-identities', globals);
const core = createPlayerDataCore();
const options = { provider: 'diving-fish', username: 'Fictional', region: 'cn' };
const acquisition = {
  capturedAt: 1760000000000,
  sourceKind: 'provider-api',
  sourceID: 'diving-fish',
};
const normalize = (input, opts = options, observation = acquisition, diagnostics) =>
  normalizeImportDocument(core, input, opts, observation, diagnostics);
const fish = (achievement = 100.1234) => ({
  nickname: 'Fictional Player',
  records: [
    {
      song_id: 8,
      title: 'True Love Song',
      type: 'SD',
      level_index: 3,
      achievements: achievement,
      ds: 12.4,
      fc: 'fcp',
      fs: 'fsdp',
      dxScore: 820,
    },
  ],
});
const lxnsOptions = { ...options, provider: 'lxns' };
const lxnsAcquisition = { ...acquisition, sourceID: 'lxns' };
const lxnsScore = {
  id: 30,
  song_name: 'ネコ日和。',
  type: 'dx',
  level_index: 3,
  achievements: 100.1234,
  fc: 'app',
  fs: 'fsdp',
  dx_score: 1023,
  dx_rating: 288.4321,
  level: '12+',
  play_time: '2025-10-08T12:00:00Z',
  upload_time: '2025-10-09T12:00:00Z',
};
const lxns = (scores = [lxnsScore]) => ({ success: true, code: 200, data: scores });
const normalizeLXNS = (input = lxns(), observation = lxnsAcquisition) =>
  normalize(input, lxnsOptions, observation);

test('network acquisition preserves scores without pretending retrieval is play time', async () => {
  const data = await normalize(fish());
  assert.equal(Object.values(data.snapshots)[0].capturedAt, acquisition.capturedAt);
  assert.equal(Object.values(data.records)[0].timeAchieved, null);
  assert.equal(Object.keys(data.plays).length, 0);
  assert.equal(Object.values(data.captures)[0].sourceKind, 'provider-api');
  assert.equal(Object.values(data.captures)[0].sourceID, 'diving-fish');
  assert.equal((await core.validate(data)).revision, data.revision);
  const inferred = await normalize(fish(), options, {
    capturedAt: acquisition.capturedAt,
    sourceKind: 'provider-api',
  });
  assert.equal(Object.values(inferred.captures)[0].sourceID, await core.digest(fish()));
});

test('Fish gets pinned metadata, integer scores and an isolated identity without invented plays', async () => {
  const data = await normalize(fish());
  const [record] = Object.values(data.records),
    [chart] = Object.values(data.charts);
  assert.equal(data.player.key, 'diving-fish:maimaidx:cn:Fictional');
  assert.equal(record.achievement, 1001234);
  assert.equal(record.constant, 124);
  assert.equal(record.lamp, 'FULL COMBO+');
  assert.equal(record.sync, 'FSD+');
  assert.equal(record.timeAchieved, null);
  assert.equal(Object.keys(data.plays).length, 0);
  assert.equal(chart.artist, 'Kai/クラシック「G線上のアリア」');
  assert.equal(Object.values(data.snapshots)[0].complete, false);
  const mapping = exactFileChartIndex(
    [{ ...chart, chart_id: 'canonical', variant_id: 'ordinary' }],
    data.charts,
  );
  assert.equal(mapping.get('canonical')[0], chart.chartID);
  assert.equal((await core.decode(await core.encode(data))).revision, data.revision);
});

test('repeated identical acquisitions deduplicate and unsupported identities cannot enter portable data', async () => {
  const data = await normalize(fish());
  const repeated = await core.merge(data, await normalize(fish()));
  assert.equal(repeated.revision, data.revision);
  const unsupported = structuredClone(data);
  unsupported.player.provider = 'unknown';
  unsupported.player.key = unsupported.player.key.replace('diving-fish:', 'unknown:');
  await assert.rejects(() => core.validate(unsupported), /player|source|identity/i);
});

test('unknown metadata remains unmatched and contradictory known source identity is rejected', async () => {
  const input = fish();
  input.records[0].song_id = 99999;
  input.records[0].title = 'Future Fictional Song';
  const unknown = await normalize(input);
  assert.equal(Object.keys(unknown.records).length, 1);
  assert.equal(Object.values(unknown.charts)[0].artist, '');
  assert.equal(exactFileChartIndex([], unknown.charts).size, 0);
  input.records[0].song_id = 8;
  await assert.rejects(() => normalize(input), /disagrees/);
});

test('partial updates retain omitted charts and corrections while separate accounts never merge', async () => {
  const first = fish();
  first.records.push({ ...first.records[0], level_index: 2 });
  const a = await normalize(first);
  const b = await normalize(fish(98), options, {
    ...acquisition,
    capturedAt: acquisition.capturedAt + 1000,
  });
  const merged = await core.merge(a, b);
  assert.equal(core.current(merged).pbs.size, 2);
  assert.equal(core.current(merged).pbs.get(Object.keys(b.charts)[0]).achievement, 980000);
  const another = await normalize(fish(), { ...options, username: 'Other' });
  await assert.rejects(() => core.merge(a, another), /Different players/);
  const empty = await normalize({ records: [] }, options, {
    ...acquisition,
    capturedAt: acquisition.capturedAt + 2000,
  });
  assert.equal(core.current(await core.merge(merged, empty)).pbs.size, 2);
});

test('conflicting PBs fail before producing portable data', async () => {
  const duplicate = fish();
  duplicate.records.push({ ...duplicate.records[0], achievements: 97 });
  await assert.rejects(() => normalize(duplicate), /Conflicting personal bests/);
});

test('Fish diagnostics disclose excluded Utage and the lack of a source snapshot date', async () => {
  const input = fish();
  input.records.push({ ...input.records[0], type: 'UTAGE' });
  let diagnostics;
  const data = await normalize(input, options, acquisition, (...args) => {
    diagnostics = args;
  });
  assert.deepEqual(diagnostics, [1, true]);
  assert.equal(Object.keys(data.records).length, 1);
  assert.equal(Object.keys(data.plays).length, 0);
  assert.equal(Object.values(data.snapshots)[0].complete, false);
  assert.equal([...core.current(data).pbs.values()][0].achievement, 1001234);
});

test('deferred providers and unsupported regions fail before parsing their records', async () => {
  for (const provider of [
    'portable',
    'mai-tools',
    'dxrating',
    'tomomai',
    'jietng',
    'aqua',
    'tachi',
    'unknown',
  ])
    await assert.rejects(() => normalize(fish(), { ...options, provider }), /Unsupported/);
  for (const region of ['jp', 'intl', 'private'])
    await assert.rejects(() => normalize(fish(), { ...options, region }), /Unsupported/);
});

test('LXNS PBs use its CN namespace and exact format metadata without invented version or plays', async () => {
  const data = await normalizeLXNS(lxns([lxnsScore, { ...lxnsScore, type: 'standard' }]));
  assert.equal(data.player.key, 'lxns:maimaidx:cn:Fictional');
  assert.equal(core.current(data).pbs.size, 2);
  assert.equal(Object.keys(data.plays).length, 0);
  const charts = Object.values(data.charts);
  assert.equal(new Set(charts.map((chart) => chart.chartID)).size, 2);
  assert.deepEqual(new Set(charts.map((chart) => chart.format)), new Set(['STD', 'DX']));
  for (const chart of charts) {
    assert.equal(chart.songID, '30');
    assert.equal(chart.artist, 'Kai/能登有沙');
    assert.equal(chart.constant, null);
    assert.equal(chart.displayVersion, '');
    assert.equal(chart.inGameID, null);
  }
  for (const record of Object.values(data.records)) {
    assert.equal(record.achievement, 1001234);
    assert.equal(record.rate, 288);
    assert.equal(record.lamp, 'ALL PERFECT+');
    assert.equal(record.sync, 'FSD+');
    assert.equal(record.timeAchieved, Date.parse(lxnsScore.play_time));
    assert.equal(record.displayVersion, '');
    assert.equal(record.constant, null);
  }
  const snapshot = Object.values(data.snapshots)[0];
  assert.equal(snapshot.capturedAt, acquisition.capturedAt);
  assert.equal(snapshot.complete, false);
  assert.deepEqual(Array.from(snapshot.versions), []);
  const mapped = exactFileChartIndex(
    charts.map((chart, i) => ({ ...chart, chart_id: `canonical:${i}`, variant_id: 'ordinary' })),
    data.charts,
  );
  assert.equal(mapped.size, 2);
  assert.equal((await core.decode(await core.encode(data))).revision, data.revision);
});

test('LXNS identity never aliases Fish, unrecognized IDs, missing difficulty or conflicting metadata', async () => {
  const data = await normalizeLXNS();
  const fishData = await normalize(fish());
  await assert.rejects(() => core.merge(data, fishData), /Different players/);
  const unknown = await normalizeLXNS(
    lxns([{ ...lxnsScore, id: 9999, song_name: 'Unknown synthetic song' }]),
  );
  assert.equal(core.current(unknown).pbs.size, 1);
  assert.equal(Object.values(unknown.charts)[0].artist, '');
  assert.equal(exactFileChartIndex([], unknown.charts).size, 0);
  // 10030 is a Fish-style DX ID, never an LXNS alias for source ID 30.
  const offset = await normalizeLXNS(lxns([{ ...lxnsScore, id: 10030 }]));
  assert.equal(Object.values(offset.charts)[0].artist, '');
  assert.notEqual(Object.keys(offset.charts)[0], Object.keys(data.charts)[0]);
  const absentDifficulty = await normalizeLXNS(lxns([{ ...lxnsScore, level_index: 4 }]));
  assert.equal(Object.values(absentDifficulty.charts)[0].artist, '');
  await assert.rejects(
    () => normalizeLXNS(lxns([{ ...lxnsScore, song_name: 'Conflicting title' }])),
    /disagrees/,
  );
});

test('LXNS repeats deduplicate while later omissions preserve retained personal bests', async () => {
  const first = await normalizeLXNS(lxns([lxnsScore, { ...lxnsScore, type: 'standard' }]));
  assert.equal(
    (
      await core.merge(
        first,
        await normalizeLXNS(lxns([lxnsScore, { ...lxnsScore, type: 'standard' }])),
      )
    ).revision,
    first.revision,
  );
  const updated = await normalizeLXNS(lxns([{ ...lxnsScore, achievements: 98 }]), {
    ...lxnsAcquisition,
    capturedAt: acquisition.capturedAt + 1000,
  });
  const merged = await core.merge(first, updated);
  assert.equal(core.current(merged).pbs.size, 2);
  assert.equal(core.current(merged).pbs.get(Object.keys(updated.charts)[0]).achievement, 980000);
  const empty = await normalizeLXNS(lxns([]), {
    ...lxnsAcquisition,
    capturedAt: acquisition.capturedAt + 2000,
  });
  assert.equal(core.current(await core.merge(merged, empty)).pbs.size, 2);
  await assert.rejects(
    () => normalizeLXNS(lxns([lxnsScore, { ...lxnsScore, achievements: 97 }])),
    /Conflicting personal bests/,
  );
  for (const region of ['jp', 'intl', 'private'])
    await assert.rejects(() => normalize(lxns(), { ...lxnsOptions, region }), /Unsupported/);
});

test('LXNS reports excluded Utage and retains unknown charts without backfilling version evidence', async () => {
  let diagnostics;
  const data = await normalize(
    lxns([lxnsScore, { ...lxnsScore, id: 100001, type: 'utage', level_index: 0 }]),
    lxnsOptions,
    lxnsAcquisition,
    (...args) => {
      diagnostics = args;
    },
  );
  assert.deepEqual(diagnostics, [1, true]);
  assert.equal(core.current(data).pbs.size, 1);
  assert.equal(Object.keys(data.plays).length, 0);
  assert.equal(Object.values(data.snapshots)[0].complete, false);
});

test('long unknown Unicode titles remain lossless while portable IDs stay bounded', async () => {
  const title = '未収録'.repeat(100);
  const input = fish();
  input.records[0].title = title;
  input.records[0].song_id = 99999;
  const data = await normalize(input);
  const chart = Object.values(data.charts)[0];
  assert.equal(chart.title, title);
  assert.ok(chart.songID.length <= 256);
  assert.ok(chart.chartID.length <= 200);
  assert.equal(Object.keys(data.plays).length, 0);
  assert.equal(core.current(data).pbs.size, 1);
  assert.equal((await core.decode(await core.encode(data))).revision, data.revision);
});

test('full responses retain thousands of PBs beyond a best-50 selection', async () => {
  const input = fish();
  const template = input.records[0];
  input.records = Array.from({ length: 2010 }, (_, i) => ({
    ...template,
    song_id: 70000 + i,
    title: 'Synthetic full export ' + i,
    achievements: i % 2 ? 97.1234 : 100.1234,
  }));
  const data = await normalize(input);
  assert.equal(Object.keys(data.records).length, 2010);
  assert.equal(core.current(data).pbs.size, 2010);
  assert.equal(Object.keys(data.plays).length, 0);
  assert.equal((await core.decode(await core.encode(data))).revision, data.revision);
});
