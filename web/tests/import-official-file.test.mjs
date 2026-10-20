import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOfficialFileExport as parseOfficialExport } from '../src/domain/import-official.ts';

const mai = {
  songName: 'Fictional Chart',
  genre: 'maimai',
  chartType: 1,
  difficulty: 3,
  achievement: 100.1234,
  fcap: 'AP+',
  level: 13.7,
};
const dx = {
  sheetId: 'Fictional Chart__dxrt__dx__dxrt__master',
  achievementRate: 100.1234,
};
const tomoSong = {
  songId: 'Ab3xK9pQ:i11',
  songName: 'Fictional Chart',
  artist: 'Fictional Artist',
  difficulty: 'master',
  type: 'dx',
  achievement: 1001234,
  dxScore: 1023,
  fc: 'none',
  fs: 'fdx+',
  levelPrecise: 137,
  level: '13+',
};

test('mai-tools preserves disambiguating genre and treats negative constants as unknown', () => {
  const parsed = parseOfficialExport('mai-tools', [
    mai,
    { ...mai, songName: 'Link', genre: 'niconico＆ボーカロイド', level: -13.7 },
  ]);
  assert.equal(parsed.rows[0].achievement, 1001234);
  assert.equal(parsed.rows[0].difficulty, 'MASTER');
  assert.equal(parsed.rows[1].sourceSongID, 'Link (2)');
  assert.equal(parsed.rows[1].sourceGenre, 'niconico＆ボーカロイド');
  assert.equal(parsed.rows[1].constant, null);
  assert.equal(parsed.rows[0].timeAchieved, null);
});

test('DXRating keeps provider title IDs separate and verifies optional structured identity', () => {
  const parsed = parseOfficialExport('dxrating', [
    dx,
    { ...dx, sheetId: 'Link (2)__dxrt__std__dxrt__remaster' },
  ]);
  assert.equal(parsed.rows[0].sourceSongID, 'Fictional Chart');
  assert.equal(parsed.rows[0].title, 'Fictional Chart');
  assert.equal(parsed.rows[1].format, 'STD');
  assert.equal(parsed.rows[1].difficulty, 'RE:MASTER');
  assert.equal(parsed.coverage, 'unknown');
  assert.throws(
    () =>
      parseOfficialExport('dxrating', [
        { ...dx, identity: { songId: 'wrong', type: 'dx', difficulty: 'master' } },
      ]),
    /disagrees/,
  );
  assert.throws(
    () => parseOfficialExport('dxrating', [{ ...dx, sheetId: 'missing delimiters' }]),
    /sheet ID/,
  );
});

test('Tomomai already uses ticks and exposes snapshot time separately from achievement time', () => {
  const result = parseOfficialExport('tomomai', {
    fetchedAt: '2026-10-10T12:30:00Z',
    displayName: 'Demo',
    songs: [tomoSong],
  });
  assert.equal(result.rows[0].achievement, 1001234);
  assert.equal(result.rows[0].constant, 137);
  assert.equal(result.rows[0].sourceSongID, 'Ab3xK9pQ');
  assert.equal(result.rows[0].lamp, '');
  assert.equal(result.rows[0].sync, 'FSD+');
  assert.equal(result.rows[0].artist, 'Fictional Artist');
  assert.equal(result.rows[0].timeAchieved, null);
  assert.equal(result.capturedAt, Date.parse('2026-10-10T12:30:00Z'));
  assert.equal(
    parseOfficialExport('tomomai', { songs: [{ ...tomoSong, rating: 300 }] }).coverage,
    'partial',
  );
  assert.throws(() => parseOfficialExport('tomomai', { songs: null }), /does not include/);
  assert.throws(
    () => parseOfficialExport('tomomai', { songs: [{ ...tomoSong, achievement: 100.1234 }] }),
    /ticks/,
  );
});

test('Tomomai recent scores preserve real times and remain partial regardless of pagination', () => {
  const play = {
    achievement: 999000,
    dxScore: 1000,
    maxDxScore: 1500,
    fc: 'fc',
    fs: 'none',
    playedAt: '2026-10-10T20:30:00+08:00',
    song: tomoSong,
  };
  const result = parseOfficialExport('tomomai', { plays: [play], totalCount: 1, hasMore: false });
  assert.equal(result.rows[0].timeAchieved, Date.parse('2026-10-10T12:30:00Z'));
  assert.equal(result.rows[0].maxDxScore, 1500);
  assert.equal(result.rows[0].kind, 'observation');
  assert.equal(result.coverage, 'partial');
  assert.equal(result.capturedAt, null);
});

test('Tomomai versioned instances share one stable chart identity', () => {
  const ids = ['Ab3xK9pQ', 'Ab3xK9pQ:i11', 'Ab3xK9pQ:i12', 'Ab3xK9pQ:j-1'];
  const rows = ids.map(
    (songId) => parseOfficialExport('tomomai', { songs: [{ ...tomoSong, songId }] }).rows[0],
  );
  assert.equal(new Set(rows.map((row) => row.sourceID)).size, 1);
  for (const songId of ['bad', 'Ab3xK9pQ:i01', 'Ab3xK9pQ:x1', 'Ab3xK9pQ:i1.5'])
    assert.throws(
      () => parseOfficialExport('tomomai', { songs: [{ ...tomoSong, songId }] }),
      /Tomomai song ID/,
    );
});

test('recognized Utage records are visibly excluded without swallowing malformed siblings', () => {
  const examples = [
    ['mai-tools', [mai, { ...mai, chartType: 2 }]],
    ['dxrating', [dx, { ...dx, sheetId: 'Party__dxrt__utage__dxrt__utage' }]],
    ['tomomai', { songs: [tomoSong, { ...tomoSong, type: 'utage' }] }],
  ];
  for (const [provider, input] of examples) {
    const result = parseOfficialExport(provider, input);
    assert.equal(result.rows.length, 1);
    assert.equal(result.excludedUtage, 1);
    assert.equal(result.coverage, 'partial');
  }
  assert.throws(
    () =>
      parseOfficialExport('mai-tools', [
        mai,
        { ...mai, chartType: 2 },
        { ...mai, achievement: -1 },
      ]),
    /Record 3: Invalid achievement/,
  );
  assert.throws(
    () =>
      parseOfficialExport('mai-tools', [
        { ...mai, chartType: 2 },
        { ...mai, chartType: 7 },
      ]),
    /Record 2: Invalid chart type/,
  );
  assert.throws(
    () => parseOfficialExport('mai-tools', [{ ...mai, chartType: 2 }]),
    /only unsupported Utage/,
  );
});

test('Tomomai detailed judgments aggregate only complete note groups', () => {
  const group = { cPerfect: 10, perfect: 2, great: 1, good: 0, miss: 0 };
  const play = {
    achievement: 999000,
    dxScore: 1000,
    maxDxScore: 1500,
    fc: 'fc',
    fs: 'none',
    playedAt: '2026-10-10T12:30:00Z',
    song: tomoSong,
    maxCombo: '123',
    notes: {
      fast: 2,
      late: 3,
      tap: group,
      hold: group,
      slide: group,
      touch: { ...group, cPerfect: null },
      break: group,
    },
  };
  const row = parseOfficialExport('tomomai', { plays: [play] }).rows[0];
  assert.equal(row.perfect, 10);
  assert.equal(row.pcrit, null);
  assert.equal(row.fast, 2);
  assert.equal(row.slow, 3);
  assert.equal(row.maxCombo, 123);
  assert.throws(
    () => parseOfficialExport('tomomai', { plays: [{ ...play, maxCombo: '123 wrong' }] }),
    /maximum combo/,
  );
});

test('JiETNG v2 preserves PB and recent evidence without inventing UTC dates or private identities', () => {
  const parsed = parseOfficialExport('jietng', jietng);
  assert.equal(parsed.displayName, 'Fictional Player');
  assert.equal(parsed.sourceRegion, 'intl');
  assert.equal(parsed.capturedAt, null);
  assert.equal(parsed.rows[0].achievement, 1001234);
  assert.equal(parsed.rows[0].constant, 137);
  assert.equal(parsed.rows[0].difficulty, 'RE:MASTER');
  assert.equal(parsed.rows[0].maxDxScore, 1500);
  assert.equal(parsed.rows[0].lamp, 'ALL PERFECT+');
  assert.equal(parsed.rows[0].sync, 'FSD+');
  assert.equal(parsed.rows[0].sourceSongID, 'Fictional Chart');
  assert.equal(parsed.rows[0].sourceGenre, 'dxrating-title');
  assert.equal(parsed.rows[0].artist, '');
  assert.equal(parsed.rows[0].kind, 'pb');
  assert.equal(parsed.rows[1].kind, 'observation');
  assert.equal(parsed.rows[0].timeAchieved, null);
  assert.equal(parsed.rows[1].playID, undefined);
  assert.equal(JSON.stringify(parsed).includes('private-line-identity'), false);
  assert.equal(
    parseOfficialExport('jietng', { ...jietng, generated_at: '2026-10-10T20:30:00+08:00' })
      .capturedAt,
    Date.parse('2026-10-10T12:30:00Z'),
  );
});

test('JiETNG validates its envelope and all ordinary rows before returning a result', () => {
  for (const change of [
    { format: 'other' },
    { schema_version: 1 },
    { maimai_version: 'cn' },
    { generated_at: '2026-02-30T20:30:00' },
    { generated_at: 123 },
    { records: { best: [] } },
  ])
    assert.throws(() => parseOfficialExport('jietng', { ...jietng, ...change }));
  for (const change of [
    { achievement: '100' },
    { achievement: 1001234 },
    { type: 'wrong' },
    { difficulty: 'wrong' },
    { dx_score: 1600 },
    { combo: 'mystery' },
  ])
    assert.throws(
      () =>
        parseOfficialExport('jietng', {
          ...jietng,
          records: { best: [jieScore], recent: [{ ...jieScore, ...change }] },
        }),
      /Record 2:/,
    );
  const result = parseOfficialExport('jietng', {
    ...jietng,
    records: { best: [{ ...jieScore, type: 'Utage' }], recent: [jieScore] },
  });
  assert.equal(result.excludedUtage, 1);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].kind, 'observation');
  assert.equal(result.coverage, 'partial');
  assert.throws(
    () =>
      parseOfficialExport('jietng', {
        ...jietng,
        records: { best: [{ ...jieScore, type: 'Utage' }], recent: [] },
      }),
    /only unsupported Utage/,
  );
});

const jieScore = {
  title: 'Fictional Chart',
  type: 'DX',
  difficulty: 'Re:Master',
  achievement: 100.1234,
  internal_level: 13.7,
  dx_score: 1023,
  dx_score_max: 1500,
  combo: 'AP+',
  sync: 'FDX+',
};
const jietng = {
  format: 'JiETNGExport',
  schema_version: 2,
  maimai_version: 'intl',
  generated_at: '2026-10-10T20:30:00',
  user_id: 'private-line-identity',
  profile: { name: 'Fictional Player' },
  records: { best: [jieScore], recent: [{ ...jieScore, achievement: 99 }] },
};

test('file parsers reject malformed precision, timestamps and undocumented formats', () => {
  for (const achievement of [-1, 101.0001, NaN, Infinity, '100.1', 100.12345])
    assert.throws(() => parseOfficialExport('mai-tools', [{ ...mai, achievement }]), /Record 1:/);
  for (const change of [
    { chartType: '1' },
    { difficulty: 9 },
    { fcap: 'unknown' },
    { level: -Infinity },
  ])
    assert.throws(() => parseOfficialExport('mai-tools', [{ ...mai, ...change }]));
  for (const fetchedAt of [
    '2026-02-30T12:00:00Z',
    '2026-10-10T25:00:00Z',
    '2026-10-10T12:00:00',
    'invalid',
  ])
    assert.throws(
      () => parseOfficialExport('tomomai', { fetchedAt, songs: [tomoSong] }),
      /timestamp/,
    );
  for (const provider of ['diving-fish', 'lxns', 'tachi', 'aqua', 'unknown'])
    assert.throws(() => parseOfficialExport(provider, []), /Unsupported/);
  assert.throws(() => parseOfficialExport('mai-tools', new Array(100001).fill(mai)), /at most/);
  assert.throws(
    () => parseOfficialExport('tomomai', { songs: [{ ...tomoSong, achievement: '1001234' }] }),
    /ticks/,
  );
  assert.deepEqual(
    parseOfficialExport('mai-tools', [
      { ...mai, achievement: 0 },
      { ...mai, achievement: 101 },
    ]).rows.map((row) => row.achievement),
    [0, 1010000],
  );
});
