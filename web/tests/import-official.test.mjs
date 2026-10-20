import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOfficialExport } from '../src/domain/import-official.ts';

const fish = {
  song_id: 11115,
  title: 'Fictional Chart',
  type: 'DX',
  level_index: 3,
  achievements: 100.1234,
  fc: 'fcp',
  fs: 'fsdp',
  dxScore: 1023,
  ds: 13.7,
  level: '13+',
};
const lxns = {
  id: 1115,
  song_name: 'Fictional Chart',
  type: 'dx',
  level_index: 3,
  achievements: 100.1234,
  fc: 'app',
  fs: 'sync',
  dx_score: 1023,
  dx_rating: 288.4321,
  level: '13+',
  play_time: '2026-10-09T12:00:00Z',
  upload_time: '2026-10-10T13:01:00Z',
  last_played_time: '2026-10-10T12:00:00Z',
};
const lxnsResponse = (data) => ({ success: true, code: 200, data });
test('Diving-Fish full records and B50 preserve values without inventing completion or dates', () => {
  const parsed = parseOfficialExport('diving-fish', { nickname: 'Demo', records: [fish] });
  assert.equal(parsed.rows[0].achievement, 1001234);
  assert.equal(parsed.rows[0].constant, 137);
  assert.equal(parsed.rows[0].sourceSongID, '11115');
  assert.equal(parsed.rows[0].lamp, 'FULL COMBO+');
  assert.equal(parsed.rows[0].sync, 'FSD+');
  assert.equal(parsed.rows[0].timeAchieved, null);
  assert.equal(parsed.rows[0].artist, '');
  assert.equal(parsed.displayName, 'Demo');
  assert.equal(parsed.capturedAt, null);
  assert.equal(parsed.coverage, 'unknown');
  assert.equal(
    parseOfficialExport('diving-fish', { charts: { sd: [], dx: [fish] } }).coverage,
    'partial',
  );
});

test('LXNS personal scores preserve values and only documented PB play times', () => {
  const parsed = parseOfficialExport('lxns', lxnsResponse([lxns]));
  assert.equal(parsed.rows[0].achievement, 1001234);
  assert.equal(parsed.rows[0].sourceSongID, '1115');
  assert.equal(parsed.rows[0].format, 'DX');
  assert.equal(parsed.rows[0].lamp, 'ALL PERFECT+');
  assert.equal(parsed.rows[0].sync, 'SYNC PLAY');
  assert.equal(parsed.rows[0].dxScore, 1023);
  assert.equal(parsed.rows[0].rate, 288);
  assert.equal(parsed.rows[0].level, '13+');
  assert.equal(parsed.rows[0].constant, null);
  assert.equal(parsed.rows[0].artist, '');
  assert.equal(parsed.rows[0].timeAchieved, Date.parse(lxns.play_time));
  assert.equal(parsed.capturedAt, null);
  assert.equal(parsed.displayName, null);
  assert.equal(parsed.coverage, 'unknown');
  for (const play_time of [null, undefined]) {
    const result = parseOfficialExport('lxns', lxnsResponse([{ ...lxns, play_time }]));
    assert.equal(result.rows[0].timeAchieved, null);
    assert.equal(result.capturedAt, null);
  }
  const offset = parseOfficialExport(
    'lxns',
    lxnsResponse([{ ...lxns, play_time: '2026-10-09T20:00:00+08:00' }]),
  );
  assert.equal(offset.rows[0].timeAchieved, parsed.rows[0].timeAchieved);
});

test('LXNS rating preserves zero, floors fractions and never coerces invalid values', () => {
  for (const [dx_rating, expected] of [
    [0, 0],
    [1.9999, 1],
    [null, null],
    [undefined, null],
  ]) {
    const parsed = parseOfficialExport('lxns', lxnsResponse([{ ...lxns, dx_rating }]));
    assert.equal(parsed.rows[0].rate, expected);
  }
  for (const dx_rating of [-1, '288', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(
      () => parseOfficialExport('lxns', lxnsResponse([{ ...lxns, dx_rating }])),
      /DX Rating/,
    );
});

test('LXNS refuses failed envelopes, manual shapes, B50 and simplified scores', () => {
  for (const value of [
    null,
    [lxns],
    { scores: [lxns] },
    { records: [fish] },
    { data: [lxns] },
    { success: false, code: 200, data: [lxns] },
    { success: true, code: 403, data: [lxns] },
    { success: true, code: '200', data: [lxns] },
    lxnsResponse({ standard: [lxns], dx: [] }),
    lxnsResponse([fish]),
  ])
    assert.throws(() => parseOfficialExport('lxns', value));
  const { achievements, ...simple } = lxns;
  assert.throws(() => parseOfficialExport('lxns', lxnsResponse([simple])), /simplified scores/);
  assert.deepEqual(parseOfficialExport('lxns', lxnsResponse([])).rows, []);
  assert.throws(() => parseOfficialExport('diving-fish', lxnsResponse([lxns])));
});

test('LXNS validates all ordinary records and timestamps before producing any rows', () => {
  for (const mutation of [
    { achievements: -1 },
    { achievements: 101.0001 },
    { achievements: '100.1' },
    { achievements: 100.12345 },
    { id: '1115' },
    { id: null },
    { id: -1 },
    { level_index: 5 },
    { level_index: '3' },
    { type: 'DX' },
    { type: 'unknown' },
    { fc: 'mystery' },
    { fs: 'mystery' },
    { dx_score: -1 },
    { dx_score: 12.1 },
    { song_name: {} },
    { play_time: '2026-10-09T12:00:00' },
    { play_time: '2026-02-30T12:00:00Z' },
    { play_time: '2026-10-09T24:00:00Z' },
    { play_time: '2026-10-09T12:00:00+24:00' },
    { play_time: 1791547200000 },
  ])
    assert.throws(
      () => parseOfficialExport('lxns', lxnsResponse([lxns, { ...lxns, ...mutation }])),
      /Record 2:/,
    );
  assert.throws(
    () => parseOfficialExport('lxns', lxnsResponse(new Array(100001).fill(lxns))),
    /at most/,
  );
});

test('LXNS excludes only its recognized Utage type and reports whole-Utage responses', () => {
  const utage = { ...lxns, id: 100001, type: 'utage', level_index: 0 };
  const result = parseOfficialExport('lxns', lxnsResponse([lxns, utage]));
  assert.equal(result.rows.length, 1);
  assert.equal(result.excludedUtage, 1);
  assert.equal(result.coverage, 'partial');
  assert.throws(() => parseOfficialExport('lxns', lxnsResponse([utage])), /only unsupported Utage/);
  assert.throws(
    () => parseOfficialExport('lxns', lxnsResponse([utage, { ...lxns, type: 'utage2p' }])),
    /Record 2: Invalid chart type/,
  );
});

test('recognized Utage records are visibly excluded without swallowing malformed siblings', () => {
  const parse = (records) => parseOfficialExport('diving-fish', { records });
  const utage = { ...fish, type: 'UTAGE' };
  const result = parse([fish, utage]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.excludedUtage, 1);
  assert.equal(result.coverage, 'partial');
  assert.throws(
    () => parse([fish, utage, { ...fish, achievements: -1 }]),
    /Record 3: Invalid achievement/,
  );
  assert.throws(() => parse([utage, { ...fish, type: 'utage2p' }]), /Record 2: Invalid chart type/);
  assert.throws(() => parse([utage]), /only unsupported Utage/);
});

test('Diving-Fish rejects malformed scores and unknown chart or lamp enums', () => {
  for (const achievements of [-1, 101.0001, NaN, Infinity, '100.1', 100.12345]) {
    assert.throws(
      () => parseOfficialExport('diving-fish', { records: [{ ...fish, achievements }] }),
      /Record 1:/,
    );
  }
  for (const mutation of [
    { level_index: 7 },
    { level_index: '3' },
    { type: 'unknown' },
    { fc: 'mystery' },
    { fs: 'mystery' },
    { dxScore: -1 },
    { song_id: null },
    { ds: -Infinity },
    { ds: 13.77 },
  ]) {
    assert.throws(
      () => parseOfficialExport('diving-fish', { records: [{ ...fish, ...mutation }] }),
      /Record 1:/,
    );
  }
  for (const value of [null, {}, ['junk'], { records: ['junk'] }])
    assert.throws(() => parseOfficialExport('diving-fish', value));
});

test('zero and exact 101 percent stay valid and numeric strings are not score values', () => {
  const result = parseOfficialExport('diving-fish', {
    records: [
      { ...fish, achievements: 0 },
      { ...fish, achievements: 101 },
    ],
  });
  assert.deepEqual(
    result.rows.map((score) => score.achievement),
    [0, 1010000],
  );
  assert.equal(
    parseOfficialExport('diving-fish', { records: [{ ...fish, song_id: '0001' }] }).rows[0]
      .sourceSongID,
    '1',
  );
  assert.throws(
    () => parseOfficialExport('diving-fish', { records: new Array(100001).fill(fish) }),
    /at most/,
  );
});

test('deferred or unknown providers are rejected even when their input resembles a Fish export', () => {
  for (const provider of [
    'mai-tools',
    'dxrating',
    'tomomai',
    'jietng',
    'aqua',
    'tachi',
    'unknown',
  ]) {
    assert.throws(() => parseOfficialExport(provider, { records: [fish] }), /Unsupported/);
  }
});
