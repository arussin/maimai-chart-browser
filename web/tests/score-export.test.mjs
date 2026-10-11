import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBest50,
  detectVersion,
  versionChoices,
  gradeForAchievement,
  lampLabel,
  syncLabel,
} from '../src/domain/score-export.ts';

function dataset(versions = ['maimaiでらっくす PRiSM PLUS']) {
  return {
    format: 'maimai-player-data',
    schemaVersion: 1,
    revision: 'fixture',
    player: {
      key: 'synthetic',
      provider: 'kamaitachi',
      game: 'maimaidx',
      username: 'demo',
      displayName: 'Demo',
    },
    charts: {},
    records: {},
    plays: {},
    captures: {},
    snapshots: { latest: { capturedAt: 1000, phase: 'after', complete: true, versions, pbs: {} } },
  };
}
function add(data, id, version = 'PRiSM', rate = 300, extra = {}) {
  const chart = {
    chartID: id,
    songID: 'song:' + id,
    title: 'Song ' + id,
    artist: 'Artist',
    format: 'DX',
    difficulty: 'MASTER',
    level: '14',
    constant: 140,
    displayVersion: version,
    inGameID: null,
  };
  const record = {
    chartID: id,
    achievement: 1005000,
    grade: 'SSS+',
    rate,
    lamp: '',
    sync: '',
    constant: 140,
    displayVersion: version,
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
    ...extra,
  };
  data.charts[id] = chart;
  data.records[id] = record;
  data.snapshots.latest.pbs[id] = id;
  return record;
}

test('snapshot aliases are detected exactly; chart debut never infers record version', () => {
  const data = dataset();
  add(data, 'a', 'CiRCLE');
  assert.equal(detectVersion(data), 'snapshot');
  assert.deepEqual(versionChoices(data)[0].versions, ['maimaiでらっくす PRiSM PLUS']);
  data.snapshots.latest.versions = [];
  assert.equal(detectVersion(data), null);
  assert.equal(
    versionChoices(data).some((row) => row.source === 'snapshot'),
    false,
  );
  assert.throws(() => buildBest50(data, ''), /Choose the game version/);
});

test('each base and PLUS release has a distinct pool; CiRCLE includes one previous release', () => {
  const choices = versionChoices(dataset([]));
  assert.deepEqual(choices.find((row) => row.id === 'prismplus').versions, [
    'maimai DX PRiSM PLUS',
  ]);
  assert.deepEqual(choices.find((row) => row.id === 'circle').versions, [
    'maimai DX PRiSM PLUS',
    'maimai DX CiRCLE',
  ]);
  assert.deepEqual(choices.find((row) => row.id === 'circleplus').versions, [
    'maimai DX CiRCLE',
    'maimai DX CiRCLE PLUS',
  ]);
  assert.deepEqual(choices.find((row) => row.id === 'magical').versions, [
    'maimai DX CiRCLE PLUS',
    'maimai DX MAGiCAL',
  ]);
  const data = dataset([]);
  for (const version of ['PRiSM', 'PRiSM+', 'CiRCLE', 'CiRCLE PLUS']) add(data, version, version);
  const result = buildBest50(data, 'circle');
  assert.deepEqual(
    result.old.map((row) => row.chart.chartID),
    ['PRiSM'],
  );
  assert.deepEqual(
    result.new.map((row) => row.chart.chartID),
    ['CiRCLE', 'PRiSM+'],
  );
  assert.equal(result.excluded.futureVersion, 1);
});

test('Best 50 is Old 35 plus New 15, never the unrestricted highest 50', () => {
  const data = dataset();
  for (let i = 0; i < 40; i++) add(data, 'old-' + i, 'PRiSM', 400 - i);
  for (let i = 0; i < 20; i++) add(data, 'new-' + i, 'PRiSM PLUS', 200 - i);
  const original = structuredClone(data);
  const result = buildBest50(data, 'snapshot');
  assert.equal(result.old.length, 35);
  assert.equal(result.new.length, 15);
  assert.equal(result.oldTotal, ((400 + 366) * 35) / 2);
  assert.equal(result.newTotal, ((200 + 186) * 15) / 2);
  assert.equal(result.totalRating, result.oldTotal + result.newTotal);
  assert.equal(result.coverage, 'complete');
  assert.equal(result.calculatedRatings, 0);
  assert.deepEqual(data, original);
});

test('record metadata wins; unknown and future charts never silently become old', () => {
  const data = dataset([]);
  add(data, 'record', 'PRiSM PLUS');
  data.charts.record.displayVersion = 'PRiSM';
  add(data, 'missing', '', null, { constant: null });
  add(data, 'unknown', 'not a release');
  add(data, 'future', 'MAGiCAL');
  add(data, 'utage', 'PRiSM');
  data.charts.utage.difficulty = 'UTAGE';
  const result = buildBest50(data, 'prismplus', (chart) =>
    chart.chartID === 'record' ? { displayVersion: 'CiRCLE' } : undefined,
  );
  assert.equal(result.new[0].chart.chartID, 'record');
  assert.equal(result.excluded.missingVersion, 2);
  assert.equal(result.excluded.futureVersion, 1);
  assert.equal(result.excluded.unsupportedChart, 1);
  assert.equal(result.excluded.total, 4);
  assert.equal(result.coverage, 'partial');
});

test('reviewed canonical aliases count once, prefer newest observation then non-alias', () => {
  const data = dataset();
  add(data, 'alias', 'PRiSM', 999);
  add(data, 'canonical', 'PRiSM', 100);
  const resolver = (chart) => ({ canonicalChartID: 'shared', alias: chart.chartID === 'alias' });
  let result = buildBest50(data, 'snapshot', resolver);
  assert.equal(result.old.length, 1);
  assert.equal(result.old[0].rating, 100);
  assert.equal(result.excluded.duplicate, 1);
  data.snapshots.newer = {
    capturedAt: 2000,
    phase: 'after',
    complete: false,
    versions: ['PRiSM PLUS'],
    pbs: { alias: 'alias' },
  };
  result = buildBest50(data, 'snapshot', resolver);
  assert.equal(result.old[0].rating, 999);
  assert.equal(result.coverage, 'partial');
});

test('latest complete snapshot clears older PBs; same-time after wins over before', () => {
  const data = dataset();
  add(data, 'obsolete');
  add(data, 'kept');
  data.snapshots.latest = {
    capturedAt: 2000,
    phase: 'after',
    complete: true,
    versions: ['PRiSM PLUS'],
    pbs: { kept: 'kept' },
  };
  data.snapshots.before = {
    capturedAt: 2000,
    phase: 'before',
    complete: true,
    versions: ['PRiSM'],
    pbs: { obsolete: 'obsolete' },
  };
  const result = buildBest50(data, 'snapshot');
  assert.deepEqual(
    result.old.map((row) => row.chart.chartID),
    ['kept'],
  );
  assert.deepEqual(result.version.versions, ['PRiSM PLUS']);
});

test('canonical duplicate ties use ascending provider ID regardless of insertion order', () => {
  for (const ids of [
    ['z', 'a'],
    ['a', 'z'],
  ]) {
    const data = dataset();
    for (const id of ids) add(data, id, 'PRiSM', id === 'a' ? 100 : 999);
    const result = buildBest50(data, 'snapshot', () => ({ canonicalChartID: 'same' }));
    assert.equal(result.old[0].chart.chartID, 'a');
    assert.equal(result.old[0].rating, 100);
  }
});

test('source-only charts remain usable and exact custom report pool aliases are retained', () => {
  const data = dataset(['Current custom release']);
  add(data, 'new', 'Current custom release');
  add(data, 'old', 'Older custom release');
  const result = buildBest50(data, 'snapshot');
  assert.equal(result.new.length, 1);
  assert.equal(result.old.length, 1);
  assert.equal(result.new[0].canonicalChartID, null);
  assert.equal(result.excluded.total, 0);
});

test('Maishift missing rates use only observation constants with selected release policy', () => {
  const data = dataset([]);
  data.player.provider = 'maishift';
  data.snapshots.latest.complete = false;
  add(data, 'ordinary', '', null);
  add(data, 'ap', '', null, { lamp: 'ALL_PERFECT', achievement: 1000000 });
  add(data, 'unknown', '', null, { constant: null });
  data.charts.unknown.constant = 150; // Never borrow a later catalog/chart constant.
  const resolve = () => ({ displayVersion: 'PRiSM PLUS' });
  const prism = buildBest50(data, 'prismplus', resolve);
  assert.equal(prism.new.find((row) => row.chart.chartID === 'ordinary').rating, 315);
  assert.equal(prism.new.find((row) => row.chart.chartID === 'ap').rating, 302);
  assert.equal(prism.calculatedRatings, 2);
  assert.equal(prism.excluded.missingRating, 1);
  const circle = buildBest50(data, 'circle', resolve);
  assert.equal(circle.new.find((row) => row.chart.chartID === 'ap').rating, 303);
  assert.equal(
    circle.new.find((row) => row.chart.chartID === 'ordinary').ratingSource,
    'calculated',
  );
  assert.equal(data.records.ap.rate, null);
});

test('integer rating boundaries, achievement cap, and contradictory AP flags', () => {
  const data = dataset(['CiRCLE']);
  for (const achievement of [999999, 1000000, 1004999, 1005000, 1010000])
    add(data, String(achievement), 'CiRCLE', null, {
      achievement,
      lamp: achievement === 1010000 ? 'ALL PERFECT+' : '',
    });
  add(data, 'invalid', 'CiRCLE', null, { achievement: 999999, lamp: 'ALL PERFECT' });
  const result = buildBest50(data, 'snapshot');
  const rates = Object.fromEntries(result.new.map((row) => [row.chart.chartID, row.rating]));
  assert.deepEqual(rates, { 999999: 299, 1000000: 302, 1004999: 312, 1005000: 315, 1010000: 316 });
  assert.equal(result.excluded.missingRating, 1);
});

test('contradictory clear flags cannot supply a calculated rating', () => {
  const data = dataset(['CiRCLE']);
  add(data, 'failed', 'CiRCLE', null, { achievement: 800000, lamp: 'FAILED' });
  add(data, 'clear', 'CiRCLE', null, { achievement: 799999, lamp: 'CLEAR' });
  add(data, 'valid', 'CiRCLE', null, { achievement: 800000, lamp: 'CLEAR' });
  const result = buildBest50(data, 'snapshot');
  assert.equal(result.excluded.missingRating, 2);
  assert.deepEqual(
    result.new.map((row) => row.chart.chartID),
    ['valid'],
  );
});

test('unqualified regional debut fallback is counted only when used and forces partial', () => {
  const data = dataset();
  for (let i = 0; i < 35; i++) add(data, 'old-' + i, 'PRiSM');
  for (let i = 0; i < 15; i++) add(data, 'new-' + i, 'PRiSM PLUS');
  const resolve = () => ({ displayVersion: 'PRiSM', versionEvidence: 'unqualified' });
  const authoritative = buildBest50(data, 'snapshot', resolve);
  assert.equal(authoritative.coverage, 'complete');
  assert.equal(authoritative.unqualifiedVersions, 0);
  data.records['old-0'].displayVersion = '';
  data.charts['old-0'].displayVersion = '';
  const estimated = buildBest50(data, 'snapshot', resolve);
  assert.equal(estimated.unqualifiedVersions, 1);
  assert.equal(estimated.coverage, 'partial');
  assert.ok(
    estimated.warnings.includes(
      'Chart release groups use community metadata and may differ by region.',
    ),
  );
  data.records['old-0'].rate = null;
  data.records['old-0'].constant = null;
  const excluded = buildBest50(data, 'snapshot', resolve);
  assert.equal(excluded.unqualifiedVersions, 0);
  assert.equal(excluded.excluded.missingRating, 1);
});

test('changing pool selection preserves imported ratings and marks evidence limits', () => {
  const data = dataset(['PRiSM PLUS']);
  add(data, 'a', 'PRiSM PLUS', 234, { constant: 99, lamp: 'ALL PERFECT' });
  const result = buildBest50(data, 'circle');
  assert.equal(result.new[0].rating, 234);
  assert.equal(result.new[0].record.constant, 99);
  assert.equal(result.new[0].ratingSource, 'imported');
  assert.equal(result.coverage, 'partial');
  assert.ok(
    result.warnings.includes(
      'Changing the version groups scores only; historical ratings are not recalculated.',
    ),
  );
});

test('choosing the equivalent known release preserves the imported grouping', () => {
  const data = dataset(['maimaiでらっくす PRiSM PLUS']);
  add(data, 'a', 'PRiSM PLUS');
  const result = buildBest50(data, 'prismplus');
  assert.equal(
    result.warnings.includes(
      'Changing the version groups scores only; historical ratings are not recalculated.',
    ),
    false,
  );
});

test('grades and badges normalize presentation without inventing missing facts', () => {
  for (const [value, grade] of [
    [0, 'D'],
    [970000, 'S'],
    [989999, 'S+'],
    [995000, 'SS+'],
    [1004999, 'SSS'],
    [1010000, 'SSS+'],
  ])
    assert.equal(gradeForAchievement(value), grade);
  for (const value of [null, -1, 1010001, NaN, Infinity, 1.5])
    assert.equal(gradeForAchievement(value), '');
  assert.equal(lampLabel('ALL_PERFECT_PLUS'), 'AP+');
  assert.equal(lampLabel('FULL COMBO+'), 'FC+');
  assert.equal(lampLabel('CLEAR'), '');
  assert.equal(syncLabel('FULL_SYNC_DX_PLUS'), 'FSD+');
  assert.equal(syncLabel('FDX'), 'FSD');
  assert.equal(syncLabel(''), '');
});
