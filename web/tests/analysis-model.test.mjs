import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnalysisModel } from '../src/domain/analysis-model.ts';
const chart = { chart_id: 'a', source_hash: 'hash-a' };
const other = { chart_id: 'b', source_hash: 'hash-b' };
const plain = (value) => JSON.parse(JSON.stringify(value));
function pack(representation, tags, extras = {}) {
  return {
    version: 'research-overview-2',
    representation,
    patterns: ['pattern.one', 'trait.two', 'pattern.three', 'pattern.four'],
    charts: { a: { source_hash: chart.source_hash, span: [0, 60e6], tags, ...extras } },
  };
}
test('historical dense and sparse encodings preserve the same evidence and coverage', () => {
  const evidence = [{ kind: 'retained', value: 1 }];
  const dense = [0, 'detected', 2, 0.5, 'complete', true, [[1, 2]], evidence];
  for (const representation of [undefined, 'sparse-tags-1', 'sparse-tags-2', 'sparse-tags-3']) {
    const encoded = ['sparse-tags-2', 'sparse-tags-3'].includes(representation)
      ? [0, 13, 2, 0.5, [[1, 2]], [0]]
      : dense;
    const input = pack(representation, [encoded], { absent: [1] });
    if (['sparse-tags-2', 'sparse-tags-3'].includes(representation)) input.evidence_pool = evidence;
    const model = createAnalysisModel(input, [chart]);
    assert.deepEqual(plain(model.tags(chart)[0]), {
      id: 'pattern.one',
      status: 'detected',
      count: 2,
      prevalence: 0.5,
      coverage: 'complete',
      truncated: true,
      spans: [[1, 2]],
      evidence,
    });
    assert.equal(model.rate(chart, model.tags(chart)[0]), 2);
    assert.equal(model.frequency.get('pattern.one'), 1);
    assert.equal(model.coverage.get('pattern.one'), 1);
    if (representation) {
      assert.equal(model.tags(chart)[1].status, 'not-detected-with-supported-coverage');
      assert.equal(model.tags(chart)[2].status, 'unknown');
      assert.equal(model.coverage.has('pattern.three'), false);
    }
  }
});
test('unsupported packs and stale source identities never supply chart evidence', () => {
  for (const input of [
    undefined,
    null,
    {},
    { version: 'other' },
    pack('unknown', []),
    { ...pack(undefined, []), patterns: [1] },
  ]) {
    const model = createAnalysisModel(input, [chart]);
    assert.equal(model.get(chart), null);
    assert.equal(model.tags(chart).length, 0);
    assert.equal(model.compare(chart, other).patternDistance, null);
  }
  const input = pack('sparse-tags-2', [[0, 1, 2, 0.5, [], []]]);
  const model = createAnalysisModel(input, [chart]);
  assert.equal(model.get({ ...chart, source_hash: 'changed' }), null);
  assert.equal(model.tags(other).length, 0);
  assert.equal(model.tags(chart)[0].coverage, 'partial');
  assert.equal(model.tags(chart)[0].truncated, false);
  input.charts.a.span = [2, 1];
  assert.equal(model.rate(chart, model.tags(chart)[0]), null);
});
test('comparison distinguishes absent, partial and unknown evidence and weights complete observations', () => {
  const rows = (ids) => ids.map((index) => [index, 'detected', 2, 0.5, 'complete', false, []]);
  const input = pack('sparse-tags-1', rows([0, 1, 2, 3]));
  input.charts.b = {
    source_hash: other.source_hash,
    span: [0, 120e6],
    tags: rows([0, 1]),
    absent: [2, 3],
  };
  const model = createAnalysisModel(input, [chart, other]);
  const result = model.compare(chart, other);
  assert.deepEqual(plain(result.shared), ['pattern.one', 'trait.two']);
  assert.deepEqual(plain(result.first), ['pattern.three', 'pattern.four']);
  assert.equal(result.coverage, 4);
  assert.ok(result.patternDistance > 0);
  assert.deepEqual(plain(model.compare(other, chart).second), plain(result.first));
  assert.equal(model.compare(chart, chart).patternDistance, 0);
  input.charts.b.absent = [];
  assert.deepEqual(plain(model.compare(chart, other).unknown), ['pattern.three', 'pattern.four']);
  assert.equal(model.compare(chart, other).patternDistance, null);
  input.charts.b.tags[0][4] = 'partial';
  assert.equal(model.compare(chart, other).coverage, 1);
});
test('detected ordering and hydrated observations use the same retained model without a view dependency', () => {
  const input = pack(undefined, [
    [1, 'detected', 9, 0.9, 'complete', false, []],
    [0, 'detected', 1, 0.1, 'complete', false, []],
  ]);
  const model = createAnalysisModel(input, [chart]);
  assert.deepEqual(plain(model.detected(chart).map((tag) => tag.id)), ['pattern.one', 'trait.two']);
  input.charts.a = { ...input.charts.a, tags: [[0, 'detected', 7, 0.8, 'complete', false, []]] };
  assert.equal(model.tags(chart)[0].count, 7);
  assert.equal(model.frequency.get('pattern.one'), 1);
});

// Exhaust historical status/coverage combinations, including absent and zero-duration evidence.
test('comparison remains symmetric and bounded across every evidence-state combination', () => {
  const states = ['unknown', 'detected', 'not-detected-with-supported-coverage'];
  for (const leftStatus of states)
    for (const rightStatus of states)
      for (const coverage of ['complete', 'partial'])
        for (const count of [null, 0, 1]) {
          const rows = (status) =>
            [0, 1, 2, 3].map((i) => [i, status, count, count ? 0.5 : 0, coverage, false, []]);
          const input = pack(undefined, rows(leftStatus));
          input.charts.b = { source_hash: other.source_hash, tags: rows(rightStatus) };
          const model = createAnalysisModel(input, [chart, other]);
          const forward = model.compare(chart, other),
            reverse = model.compare(other, chart);
          assert.equal(forward.patternDistance, reverse.patternDistance);
          if (forward.patternDistance !== null)
            assert.ok(forward.patternDistance >= 0 && forward.patternDistance <= 1);
          assert.deepEqual(plain(forward.first), plain(reverse.second));
          model.detected(chart);
          model.rate(chart, model.tags(chart)[0]);
        }
});
test('dense ordering handles equal prevalences, counts and names without changing input', () => {
  const input = pack(undefined, [
    [3, 'detected', null, null, 'complete', false, []],
    [2, 'detected', 2, 0, 'complete', false, []],
    [0, 'detected', 2, 0, 'complete', false, []],
    [1, 'unknown', 0, 0, 'complete', false, []],
  ]);
  const before = JSON.stringify(input);
  const model = createAnalysisModel(input, [chart]);
  assert.deepEqual(
    model.detected(chart).map((tag) => tag.id),
    ['pattern.one', 'pattern.three', 'pattern.four'],
  );
  assert.equal(JSON.stringify(input), before);
  const sparse = pack('sparse-tags-2', [[0, 1, 1, 0, [], ['retained']]]);
  assert.deepEqual(createAnalysisModel(sparse, [chart]).tags(chart)[0].evidence, ['retained']);
  const noKnown = pack('sparse-tags-1', []);
  assert.equal(
    createAnalysisModel(noKnown, [chart])
      .tags(chart)
      .every((tag) => tag.status === 'unknown'),
    true,
  );
  assert.equal(createAnalysisModel('invalid', []).get(chart), null);
});

test('startup counts do not decode detail payloads and preserve sparse override semantics', () => {
  const input = pack(
    'sparse-tags-3',
    [
      [0, 1, 2, 0.5, [], [0]],
      [0, 5, 3, 0.6, [], [0]],
    ],
    { absent: [0, 1] },
  );
  let decoded = 0;
  input.evidence_pool = new Proxy([{ kind: 'retained' }], {
    get(target, key) {
      if (key === '0') decoded++;
      return target[key];
    },
  });
  const model = createAnalysisModel(input, [chart, { ...chart, source_hash: 'stale' }]);
  assert.equal(decoded, 0);
  assert.deepEqual([...model.frequency], [['pattern.one', 1]]);
  assert.deepEqual(
    [...model.coverage],
    [
      ['pattern.one', 1],
      ['trait.two', 1],
    ],
  );
  assert.equal(model.tags(chart)[0].count, 3);
  assert.equal(decoded, 1);
  assert.equal(model.tags(chart)[0].status, 'detected');
  assert.equal(model.tags(chart)[1].status, 'not-detected-with-supported-coverage');
});
