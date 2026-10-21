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

function mainland(provider = 'diving-fish') {
  const data = dataset(['PRiSM PLUS']);
  Object.assign(data.player, { provider, key: provider + ':maimaidx:cn:demo' });
  data.snapshots.latest.best50 = { provider, region: 'cn', old: [], new: [] };
  return data;
}

test('mainland export uses exact provider observations and order, without Japanese inference', () => {
  for (const provider of ['diving-fish', 'lxns']) {
    const data = mainland(provider);
    add(data, 'low', 'CiRCLE PLUS', 0);
    add(data, 'high', '', 310);
    add(data, 'new', 'maimai', 220);
    add(data, 'not-selected', 'PRiSM PLUS', 999);
    data.records['newer-pb'] = { ...data.records.low, rate: 500, achievement: 1010000 };
    data.snapshots.latest.pbs.low = 'newer-pb';
    data.snapshots.latest.best50.old = ['low', 'high'];
    data.snapshots.latest.best50.new = ['new'];
    assert.deepEqual(versionChoices(data), [
      {
        id: 'cn-provider',
        label: '舞萌 DX · Mainland China',
        versions: [],
        source: 'provider',
        logoVersion: null,
        supportsBest50: true,
      },
    ]);
    assert.equal(detectVersion(data), 'cn-provider');
    assert.throws(() => buildBest50(data, 'prismplus'), /Choose the game version/);
    const result = buildBest50(data, 'cn-provider', (chart) =>
      chart.chartID === 'high'
        ? undefined
        : { canonicalChartID: 'same-alias', displayVersion: 'MAGiCAL' },
    );
    assert.deepEqual(
      result.old.map((row) => [row.chart.chartID, row.rating]),
      [
        ['low', 0],
        ['high', 310],
      ],
    );
    assert.deepEqual(
      result.new.map((row) => [row.chart.chartID, row.rating]),
      [['new', 220]],
    );
    assert.equal(result.old[1].canonicalChartID, null);
    assert.equal(result.totalRating, 530);
    assert.equal(result.calculatedRatings, 0);
    assert.equal(result.unqualifiedVersions, 0);
    assert.equal(result.excluded.total, 0);
    assert.equal(result.coverage, 'partial');
    assert.deepEqual(result.warnings, [
      'Best 50 selection and ratings come from the provider at import time.',
      'There are not enough eligible records to fill all 50 slots.',
    ]);
  }
});

test('mainland coverage describes the selected pools independently of all-PB completeness', () => {
  const data = mainland('lxns');
  data.snapshots.latest.complete = false;
  for (const [pool, count] of [
    ['old', 35],
    ['new', 15],
  ]) {
    for (let i = 0; i < count; i++) {
      const id = pool + i;
      add(data, id, '', i);
      data.snapshots.latest.best50[pool].push(id);
    }
  }
  const result = buildBest50(data, 'cn-provider');
  assert.equal(result.coverage, 'complete');
  assert.equal(result.warnings.length, 1);
  assert.equal(result.totalRating, 700);
});

test('latest mainland acquisition without a provider selection cannot reuse older groups', () => {
  const data = mainland();
  add(data, 'old');
  data.snapshots.latest.best50.old = ['old'];
  data.snapshots.next = {
    capturedAt: 2000,
    phase: 'after',
    complete: false,
    versions: ['CiRCLE'],
    pbs: {},
  };
  assert.deepEqual(versionChoices(data), []);
  assert.equal(detectVersion(data), null);
  assert.throws(() => buildBest50(data, 'cn-provider'), /Choose the game version/);
  delete data.snapshots.next;
  delete data.snapshots.latest.best50;
  assert.deepEqual(versionChoices(data), []);
  data.player.provider = 'mai-tools';
  data.player.key = 'mai-tools:maimaidx:cn:demo';
  assert.deepEqual(versionChoices(data), []);
});

test('mainland export never calculates missing rates or silently drops malformed membership', () => {
  for (const rate of [null, -1, 1.5]) {
    const data = mainland();
    add(data, 'selected', 'PRiSM', rate);
    data.snapshots.latest.best50.old = ['selected'];
    assert.throws(() => buildBest50(data, 'cn-provider'), /Best 50 observation/);
  }
  const data = mainland();
  add(data, 'selected', '', Number.MAX_SAFE_INTEGER);
  add(data, 'another', '', 1);
  data.snapshots.latest.best50.old = ['selected'];
  data.snapshots.latest.best50.new = ['selected'];
  assert.throws(() => buildBest50(data, 'cn-provider'), /Best 50 observation/);
  data.snapshots.latest.best50.new = ['another'];
  assert.throws(() => buildBest50(data, 'cn-provider'), /rating total/);
});

test('snapshot aliases are detected exactly; chart debut never infers record version', () => {
  const data = dataset();
  add(data, 'a', 'CiRCLE');
  assert.equal(detectVersion(data), 'prismplus');
  assert.deepEqual(versionChoices(data).find((choice) => choice.id === 'prismplus').versions, [
    'maimaiでらっくす PRiSM PLUS',
  ]);
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

test('all release choices stay newest first with the detected version in chronological order', () => {
  const data = dataset(['PRiSM+', 'maimaiでらっくす PRiSM PLUS']);
  const original = structuredClone(data);
  const choices = versionChoices(data);
  assert.equal(choices.length, 28);
  assert.deepEqual(
    choices.slice(0, 5).map((choice) => choice.id),
    ['magical', 'circleplus', 'circle', 'prismplus', 'prism'],
  );
  assert.equal(choices.at(-1).id, 'original');
  assert.equal(choices.at(-1).label, 'maimai');
  assert.ok(choices.every((choice) => choice.id));
  assert.equal(new Set(choices.map((choice) => choice.id)).size, choices.length);
  assert.equal(choices.filter((choice) => choice.label === 'maimai DX PRiSM PLUS').length, 1);
  assert.equal(detectVersion(data), 'prismplus');
  assert.deepEqual(choices[3].versions, ['PRiSM+', 'maimaiでらっくす PRiSM PLUS']);
  assert.equal(choices[3].logoVersion, 'maimai DX PRiSM PLUS');
  assert.deepEqual(data, original);
});

test('detected multi-release and custom pools retain exact imported grouping without duplicate choices', () => {
  const data = dataset(['PRiSM+', 'CiRCLE']);
  assert.equal(detectVersion(data), 'circle');
  const circle = versionChoices(data).find((choice) => choice.id === 'circle');
  assert.deepEqual(circle.versions, ['CiRCLE', 'PRiSM+']);
  assert.equal(circle.logoVersion, 'maimai DX CiRCLE');
  add(data, 'old', 'PRiSM');
  add(data, 'previous', 'PRiSM PLUS');
  add(data, 'current', 'CiRCLE');
  add(data, 'future', 'CiRCLE PLUS');
  const report = buildBest50(data, detectVersion(data));
  assert.deepEqual(report.new.map((entry) => entry.chart.chartID).sort(), ['current', 'previous']);
  assert.deepEqual(
    report.old.map((entry) => entry.chart.chartID),
    ['old'],
  );
  assert.equal(report.excluded.futureVersion, 1);
  data.snapshots.latest.versions = ['CiRCLE'];
  assert.deepEqual(versionChoices(data).find((choice) => choice.id === 'circle').versions, [
    'CiRCLE',
  ]);
  data.snapshots.latest.versions = ['Unlisted provider pool'];
  const choices = versionChoices(data);
  assert.equal(choices[0].id, 'magical');
  assert.equal(choices.at(-1).id, 'snapshot');
  assert.equal(choices.at(-1).logoVersion, null);
  assert.deepEqual(choices.at(-1).versions, ['Unlisted provider pool']);
  assert.equal(detectVersion(data), 'snapshot');
});

test('pre-Best-50 releases are selectable without inventing their historical rating formulas', () => {
  const data = dataset(['maimai DX Splash']);
  add(data, 'old', 'maimai DX', 123);
  assert.equal(detectVersion(data), 'splash');
  const choices = versionChoices(data);
  assert.equal(choices.find((choice) => choice.id === 'splash').supportsBest50, false);
  assert.equal(choices.find((choice) => choice.id === 'splashplus').supportsBest50, true);
  for (const choice of choices.filter((choice) => !choice.supportsBest50)) {
    assert.throws(() => buildBest50(data, choice.id), /Best 50 began with Splash PLUS/);
  }
  assert.equal(data.records.old.rate, 123);
});

test('Best 50 is Old 35 plus New 15, never the unrestricted highest 50', () => {
  const data = dataset();
  for (let i = 0; i < 40; i++) add(data, 'old-' + i, 'PRiSM', 400 - i);
  for (let i = 0; i < 20; i++) add(data, 'new-' + i, 'PRiSM PLUS', 200 - i);
  const original = structuredClone(data);
  const result = buildBest50(data, detectVersion(data));
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
  let result = buildBest50(data, detectVersion(data), resolver);
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
  result = buildBest50(data, detectVersion(data), resolver);
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
  const result = buildBest50(data, detectVersion(data));
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
    const result = buildBest50(data, detectVersion(data), () => ({ canonicalChartID: 'same' }));
    assert.equal(result.old[0].chart.chartID, 'a');
    assert.equal(result.old[0].rating, 100);
  }
});

test('source-only charts remain usable and exact custom report pool aliases are retained', () => {
  const data = dataset(['Current custom release']);
  add(data, 'new', 'Current custom release');
  add(data, 'old', 'Older custom release');
  const result = buildBest50(data, detectVersion(data));
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
  const result = buildBest50(data, detectVersion(data));
  const rates = Object.fromEntries(result.new.map((row) => [row.chart.chartID, row.rating]));
  assert.deepEqual(rates, { 999999: 299, 1000000: 302, 1004999: 312, 1005000: 315, 1010000: 316 });
  assert.equal(result.excluded.missingRating, 1);
});

test('contradictory clear flags cannot supply a calculated rating', () => {
  const data = dataset(['CiRCLE']);
  add(data, 'failed', 'CiRCLE', null, { achievement: 800000, lamp: 'FAILED' });
  add(data, 'clear', 'CiRCLE', null, { achievement: 799999, lamp: 'CLEAR' });
  add(data, 'valid', 'CiRCLE', null, { achievement: 800000, lamp: 'CLEAR' });
  const result = buildBest50(data, detectVersion(data));
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
  const authoritative = buildBest50(data, detectVersion(data), resolve);
  assert.equal(authoritative.coverage, 'complete');
  assert.equal(authoritative.unqualifiedVersions, 0);
  data.records['old-0'].displayVersion = '';
  data.charts['old-0'].displayVersion = '';
  const estimated = buildBest50(data, detectVersion(data), resolve);
  assert.equal(estimated.unqualifiedVersions, 1);
  assert.equal(estimated.coverage, 'partial');
  assert.ok(
    estimated.warnings.includes(
      'Chart release groups use community metadata and may differ by region.',
    ),
  );
  data.records['old-0'].rate = null;
  data.records['old-0'].constant = null;
  const excluded = buildBest50(data, detectVersion(data), resolve);
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
