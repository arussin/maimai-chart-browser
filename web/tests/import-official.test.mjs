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
    'lxns',
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
