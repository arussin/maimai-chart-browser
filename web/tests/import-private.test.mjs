import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { loadModule } from './module.mjs';

const { parsePrivateExport } = await loadModule('domain/import-private');
const plain = (value) => JSON.parse(JSON.stringify(value));

function aqua() {
  return {
    gameId: 'SDEZ',
    userData: { userName: 'Fictional player', cardAccessCode: 'DO NOT RETAIN' },
    token: 'DO NOT RETAIN',
    userMusicDetailList: [
      {
        musicId: 12345,
        level: 3,
        achievement: 1005001,
        comboStatus: 2,
        syncStatus: 5,
        deluxscoreMax: 1700,
      },
    ],
    userPlaylogList: [
      {
        musicId: 12345,
        level: 3,
        achievement: 1001234,
        comboStatus: 1,
        syncStatus: 3,
        deluxscore: 1600,
        playlogId: 42,
        trackNo: 2,
        userPlayDate: '2026-10-10 14:30:00',
        isClear: true,
        fastCount: 3,
        lateCount: 4,
        maxCombo: 567,
        placeName: 'PRIVATE VENUE',
        playedUserName1: 'OTHER PLAYER',
      },
    ],
  };
}

function batch() {
  return {
    meta: { game: 'maimaidx', playtype: 'Single', service: 'AquaDX-Manual' },
    scores: [
      {
        percent: 100.1234,
        lamp: 'FULL COMBO',
        matchType: 'inGameID',
        identifier: '12345',
        difficulty: 'DX Master',
        timeAchieved: 1791642600000,
        judgements: { pcrit: 300, perfect: 200, great: 60, good: 7, miss: 0 },
        optional: { fast: 3, slow: 4, maxCombo: 567 },
      },
    ],
  };
}

test('Aqua full export keeps PBs separate from attempts, scaled ticks and exact song IDs', () => {
  const result = plain(parsePrivateExport('aqua', JSON.stringify(aqua())));
  assert.equal(result.rows.length, 2);
  const [pb, play] = result.rows;
  assert.equal(pb.sourceSongID, '12345');
  assert.equal(pb.sourceGenre, 'in-game-id');
  assert.equal(pb.sourceID, play.sourceID);
  assert.equal(pb.format, 'DX');
  assert.equal(pb.difficulty, 'MASTER');
  assert.equal(pb.achievement, 1005001);
  assert.equal(pb.lamp, 'FULL COMBO+');
  assert.equal(pb.sync, 'SYNC PLAY');
  assert.equal(pb.dxScore, 1700);
  assert.equal(pb.title, '');
  assert.equal(pb.constant, null);
  assert.equal(pb.timeAchieved, null);
  assert.equal(pb.playID, undefined);
  assert.equal(pb.kind, 'pb');
  assert.equal(JSON.parse(play.playID.slice('aqua:'.length))[1], 42);
  assert.equal(play.timeAchieved, null);
  assert.equal(play.kind, 'play');
  assert.equal(play.fast, 3);
  assert.equal(play.slow, 4);
  assert.equal(play.maxCombo, 567);
  assert.equal(result.coverage, 'unknown');
  assert.equal(result.capturedAt, null);
  assert.equal(result.displayName, 'Fictional player');
  assert.equal(result.sourceService, 'AquaDX');
  assert.doesNotMatch(
    JSON.stringify(result),
    /DO NOT RETAIN|PRIVATE VENUE|OTHER PLAYER|cardAccessCode/u,
  );
});

test('Aqua attempt times use explicit offsets only and attempt IDs survive row reordering', () => {
  const input = aqua();
  input.userPlaylogList[0].userPlayDate = '2026-10-10T14:30:00+09:00';
  input.userPlaylogList.push({ ...input.userPlaylogList[0], playlogId: 43, trackNo: 3 });
  const first = plain(parsePrivateExport('aqua', input));
  assert.equal(first.rows[1].timeAchieved, Date.parse('2026-10-10T05:30:00Z'));
  assert.notEqual(first.rows[1].playID, first.rows[2].playID);
  input.userPlaylogList.reverse();
  const second = plain(parsePrivateExport('aqua', input));
  assert.equal(first.rows[1].playID, second.rows[2].playID);
  assert.equal(first.rows[2].playID, second.rows[1].playID);
});

test('Aqua incomplete judgement groups remain unknown; complete groups are totaled', () => {
  const input = aqua();
  const play = input.userPlaylogList[0];
  play.tapMiss = 0;
  for (const kind of ['tap', 'hold', 'slide', 'touch', 'break']) play[`${kind}Great`] = 2;
  const row = parsePrivateExport('aqua', input).rows[1];
  assert.equal(row.miss, null);
  assert.equal(row.great, 10);
  assert.equal(row.perfect, null);
});

test('Aqua data never invents a time or attempt from unidentifiable logs', () => {
  const input = aqua();
  const play = input.userPlaylogList[0];
  delete play.playlogId;
  delete play.userPlayDate;
  const row = parsePrivateExport('aqua', input).rows[1];
  assert.equal(row.playID, undefined);
  assert.equal(row.timeAchieved, null);
  assert.equal(row.kind, 'observation');
  play.playlogId = 42;
  assert.equal(parsePrivateExport('aqua', input).rows[1].playID, undefined);
  for (const missing of ['playlogId', 'trackNo']) {
    const incomplete = aqua();
    delete incomplete.userPlaylogList[0][missing];
    const observation = parsePrivateExport('aqua', incomplete).rows[1];
    assert.equal(observation.playID, undefined);
    assert.equal(observation.kind, 'observation');
  }
});

test('Aqua native event identity survives corrected or enriched score measurements', () => {
  const input = aqua();
  const previous = parsePrivateExport('aqua', input).rows[1];
  Object.assign(input.userPlaylogList[0], {
    achievement: 1005678,
    deluxscore: 1800,
    comboStatus: 2,
    syncStatus: 4,
    fastCount: 0,
    lateCount: 1,
    maxCombo: 600,
  });
  const corrected = parsePrivateExport('aqua', input).rows[1];
  assert.equal(previous.playID, corrected.playID);
  assert.notEqual(previous.achievement, corrected.achievement);
  assert.notEqual(previous.dxScore, corrected.dxScore);
});

test('Aqua reports recognized Utage exclusions without discarding ordinary PBs and plays', () => {
  const input = aqua();
  input.userMusicDetailList.push(
    { ...input.userMusicDetailList[0], musicId: 100001, level: 10 },
    { ...input.userMusicDetailList[0], level: 5 },
  );
  input.userPlaylogList.push({ ...input.userPlaylogList[0], musicId: 100002, level: 5 });
  const result = parsePrivateExport('aqua', input);
  assert.equal(result.excludedUtage, 3);
  assert.equal(result.coverage, 'partial');
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].kind, 'pb');
  assert.equal(result.rows[0].sourceSongID, '12345');
  assert.equal(result.rows[1].kind, 'play');
  assert.doesNotMatch(JSON.stringify(result), /100001|100002|PRIVATE VENUE|OTHER PLAYER/u);
});

test('Aqua wholly excluded Utage export fails with a named explanation', () => {
  const input = aqua();
  input.userMusicDetailList[0].musicId = 100001;
  input.userPlaylogList[0].level = 5;
  assert.throws(() => parsePrivateExport('aqua', input), /only unsupported Utage/u);
});

test('Aqua exclusion detection never coerces malformed IDs or difficulty values', () => {
  for (const patch of [
    { musicId: '100001' },
    { musicId: 100001.5 },
    { musicId: -100001 },
    { musicId: 100001, level: '5' },
    { musicId: 100001, level: -1 },
    { level: 5.5 },
    { musicId: 0, level: 5 },
  ]) {
    const input = aqua();
    input.userMusicDetailList.push({ ...input.userMusicDetailList[0], ...patch });
    assert.throws(() => parsePrivateExport('aqua', input));
  }
});

test('Aqua validation fails the whole file for other invalid rows, games and bounds', () => {
  for (const patch of [
    { musicId: 0 },
    { musicId: '00001' },
    { level: 10 },
    { achievement: 1010001 },
    { achievement: 100.5 },
    { comboStatus: 5 },
    { syncStatus: 6 },
    { deluxscoreMax: -1 },
  ]) {
    const input = aqua();
    input.userMusicDetailList.push({ ...input.userMusicDetailList[0], musicId: 100001 });
    input.userMusicDetailList.push({ ...input.userMusicDetailList[0], ...patch });
    assert.throws(() => parsePrivateExport('aqua', input));
  }
  const wrongGame = aqua();
  wrongGame.gameId = 'SDHD';
  assert.throws(() => parsePrivateExport('aqua', wrongGame));
  for (const date of ['2026-02-30 12:00:00', '2026-10-10 25:00:00', 'not a date']) {
    const input = aqua();
    input.userPlaylogList[0].userPlayDate = date;
    assert.throws(() => parsePrivateExport('aqua', input));
  }
});

test('Tachi BATCH-MANUAL preserves timestamped observations, precision and judgements', () => {
  const result = plain(parsePrivateExport('tachi', batch()));
  const row = result.rows[0];
  assert.equal(result.sourceService, 'AquaDX-Manual');
  assert.equal(result.coverage, 'unknown');
  assert.equal(row.achievement, 1001234);
  assert.equal(row.sourceSongID, '12345');
  assert.equal(row.sourceGenre, 'in-game-id');
  assert.equal(row.format, 'DX');
  assert.equal(row.difficulty, 'MASTER');
  assert.equal(row.timeAchieved, 1791642600000);
  assert.equal(row.pcrit, 300);
  assert.equal(row.good, 7);
  assert.equal(row.fast, 3);
  assert.equal(row.playID, undefined);
  assert.equal(row.kind, 'observation');
  const input = batch();
  delete input.scores[0].timeAchieved;
  const pb = parsePrivateExport('tachi', input).rows[0];
  assert.equal(pb.timeAchieved, null);
  assert.equal(pb.playID, undefined);
  assert.equal(pb.kind, 'observation');
});

test('Tachi identities retain namespaces and exact title/artist instead of guessing IDs', () => {
  const input = batch();
  Object.assign(input.scores[0], {
    matchType: 'songTitle',
    identifier: 'Fictional Song',
    artist: 'Fictional Artist',
  });
  const title = parsePrivateExport('tachi', input).rows[0];
  assert.equal(title.title, 'Fictional Song');
  assert.equal(title.artist, 'Fictional Artist');
  assert.equal(title.sourceSongID, '');
  assert.equal(title.sourceGenre, 'song-title');
  Object.assign(input.scores[0], { matchType: 'tachiSongID', identifier: '12345' });
  const id = parsePrivateExport('tachi', input).rows[0];
  assert.equal(id.sourceGenre, 'tachi-song-id');
  assert.equal(id.title, '');
  assert.notEqual(id.sourceID, parsePrivateExport('tachi', batch()).rows[0].sourceID);
});

test('Tachi chart identities stay stable across game-version labels', () => {
  const input = batch();
  input.meta.version = 'prism';
  const previous = parsePrivateExport('tachi', input).rows[0];
  input.meta.version = 'circle';
  const current = parsePrivateExport('tachi', input).rows[0];
  assert.equal(previous.sourceID, current.sourceID);
  assert.equal(previous.playID, current.playID);
  assert.deepEqual(JSON.parse(current.sourceID.slice('tachi:'.length)), [
    'inGameID',
    '12345',
    '',
    'DX',
    'MASTER',
  ]);
  input.scores[0].artist = 'Display metadata may change';
  assert.equal(current.sourceID, parsePrivateExport('tachi', input).rows[0].sourceID);
});

test('Tachi rejects wrong games, unsupported types, precision loss and conflicting format', () => {
  for (const patch of [
    { percent: 101.0001 },
    { percent: -0.0001 },
    { percent: 100.12345 },
    { percent: '100.5' },
    { identifier: '100001' },
    { identifier: 12345 },
    { difficulty: 'Master' },
    { difficulty: 'Utage' },
    { matchType: 'gcmInGameIDSpecialChart' },
    { lamp: 'AP' },
    { timeAchieved: '2026-10-10' },
    { timeAchieved: -1 },
    { judgements: { miss: -1 } },
    { game: 'maimai' },
  ]) {
    const input = batch();
    input.scores.push({ ...input.scores[0], ...patch });
    assert.throws(() => parsePrivateExport('tachi', input));
  }
  for (const meta of [
    { game: 'maimai', playtype: 'Single', service: 'Legacy tracker' },
    { game: 'maimaidx', playtype: 'Double', service: 'Other' },
    { game: 'maimaidx' },
  ])
    assert.throws(() => parsePrivateExport('tachi', { ...batch(), meta }));
});

test('private parsers reject unrelated JSON and never mutate caller data', () => {
  const input = aqua();
  const original = structuredClone(input);
  parsePrivateExport('aqua', input);
  assert.deepEqual(input, original);
  for (const value of [null, [], 4, '{bad json', {}]) {
    assert.throws(() => parsePrivateExport('aqua', value));
  }
  assert.throws(() => parsePrivateExport('myt', aqua()));
});

test('private reexports keep native plays singular and BATCH observations uncounted', async () => {
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
  const { readImportFile } = await loadModule('runtime/import-file', globals);
  const core = createPlayerDataCore();
  const options = {
    format: 'aqua',
    username: 'Synthetic',
    region: 'private',
    instance: 'example.invalid',
  };
  const file = (value, lastModified) => {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    return { size: bytes.length, lastModified, arrayBuffer: async () => bytes.buffer };
  };
  const input = aqua();
  delete input.userPlaylogList[0].deluxscore;
  const original = await readImportFile(core, file(input, 1700000000000), options);
  input.userPlaylogList[0].deluxscore = 1600;
  const enriched = await readImportFile(core, file(input, 1700000000001), options);
  const merged = await core.merge(original, enriched);
  assert.equal(Object.keys(merged.plays).length, 1);
  assert.equal(merged.records[Object.values(merged.plays)[0]].dxScore, 1600);
  assert.equal(Object.keys(merged.records).length, 3);
  input.userPlaylogList.push({ ...input.userPlaylogList[0], achievement: 980000 });
  await assert.rejects(
    () => readImportFile(core, file(input, 1700000000002), options),
    /Conflicting play identities/,
  );

  const tachiInput = batch();
  tachiInput.scores.push({ ...tachiInput.scores[0], optional: { fast: 9 } });
  const observed = await readImportFile(core, file(tachiInput, 1700000000000), {
    ...options,
    format: 'tachi',
  });
  assert.equal(Object.keys(observed.plays).length, 0);
  assert.equal(core.current(observed).pbs.size, 0);
  assert.equal(Object.keys(observed.records).length, 2);
});
