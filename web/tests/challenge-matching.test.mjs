import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIndex } from '../src/domain/challenge-matching.ts';
const groups = ['cadence', 'rhythm', 'coordination', 'holds', 'slides', 'spatial'];
function profile(id, value = 1, extra = {}) {
  return {
    chart_id: id,
    song_id: id,
    version: 'challenge-profile-1-experimental',
    demand: Object.fromEntries(groups.map((name, i) => [name, { rate: value + i }])),
    ...extra,
  };
}
test('ranked comparison keeps percentile ties and matches known summary distances', () => {
  const index = createIndex([profile('a', 1), profile('b', 2), profile('c', 3)]);
  assert.deepEqual(index.compare('a', 'c'), {
    distance: 0.666667,
    closest_groups: ['cadence', 'coordination'],
    largest_difference: 'spatial',
  });
  assert.equal(index.compare('b', 'a').distance, 0.333333);
  assert.deepEqual(index.compare('a', 'a'), {
    distance: 0,
    closest_groups: ['cadence', 'coordination'],
    largest_difference: 'spatial',
  });
  assert.deepEqual(
    index.similar('a').map((row) => row.chart_id),
    ['b', 'c'],
  );
  assert.equal(index.similar('a')[0].rankDistance, undefined);
  const unequal = profile('z', 10);
  unequal.demand.slides.rate = 5;
  assert.deepEqual(createIndex([profile('a', 1), unequal]).compare('a', 'z').closest_groups, [
    'slides',
    'cadence',
  ]);
});
test('rejects invalid profiles, duplicates and measurements; registry-only charts stay excluded', () => {
  for (const invalid of [
    { version: 'future' },
    { demand: { cadence: { rate: '1' } } },
    { demand: { cadence: { rate: Infinity } } },
    { demand: { cadence: { rate: NaN } } },
  ])
    assert.throws(() => createIndex([profile('a', 1, invalid)]), /Incompatible|Invalid/);
  assert.throws(() => createIndex([profile('a'), profile('a')]), /Incompatible/);
  const index = createIndex([profile('a'), profile('legacy', 0, { version: 'registry-chart-1' })]);
  for (const [a, b] of [
    ['missing', 'a'],
    ['a', 'missing'],
  ])
    assert.throws(() => index.compare(a, b), /not in this catalog/);
  for (const id of ['legacy', 'missing'])
    assert.throws(() => index.similar(id), /not in this catalog/);
  for (const limit of [0, 101, 1.5, NaN])
    assert.throws(() => index.similar('a', { limit }), /1..100/);
  assert.deepEqual(index.similar('a'), []);
});
test('shared measurement coverage must have four groups and never treats absent keys as zero', () => {
  const partial = profile('partial', 2, {
    demand: { cadence: { different: 1 }, rhythm: { rate: 2 }, holds: { rate: 3 } },
  });
  const index = createIndex([profile('a'), partial, profile('b')]);
  assert.equal(index.compare('a', 'partial'), null);
  assert.deepEqual(
    index.similar('a').map((row) => row.chart_id),
    ['b'],
  );
  assert.throws(() => createIndex([]).similar('a'), /not in this catalog/);
});
test('eligibility and song families suppress alternatives without consuming the result limit', () => {
  const rows = [
    profile('query', 1, { song_family: 'q' }),
    profile('sibling', 1, { song_family: 'q' }),
    profile('b2', 2, { song_family: 'b' }),
    profile('b1', 2, { song_family: 'b' }),
    profile('c', 3),
    profile('d', 4),
  ];
  const index = createIndex(rows);
  assert.deepEqual(
    index.similar('query', { limit: 2 }).map((row) => row.chart_id),
    ['b1', 'c'],
  );
  assert.deepEqual(
    index.similar('query', { eligibleIds: ['b2', 'c'] }).map((row) => row.chart_id),
    ['b2', 'c'],
  );
  assert.deepEqual(index.similar('query', { eligibleIds: [] }), []);
});
test('pattern weighting is optional and ranks unknown coverage last with deterministic ties', () => {
  const index = createIndex([
    profile('q'),
    profile('a'),
    profile('b'),
    profile('c'),
    profile('d'),
    profile('e'),
  ]);
  const patterns = {
    a: { patternDistance: 1 },
    b: { patternDistance: 0 },
    c: { patternDistance: null },
    d: null,
    e: undefined,
  };
  const rows = index.similar('q', {
    patternCompare: (_, candidate) => patterns[candidate.chart_id],
  });
  assert.deepEqual(
    rows.map((row) => row.chart_id),
    ['b', 'a', 'c', 'd', 'e'],
  );
  assert.equal(rows[0].rankDistance, 0);
  assert.equal(rows[1].rankDistance, 0.6);
  assert.equal(rows[2].patternDistance, null);
  assert.equal(rows[3].patterns, null);
});
