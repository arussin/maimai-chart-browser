import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './module.mjs';

const { parseBpmInput, formatBpmInput, restoreBpmFilter, matchesBpm, bpmSymbols } =
  await loadModule('domain/bpm-filter');

const plain = (value) => JSON.parse(JSON.stringify(value));

test('BPM operators display inclusive symbols', () => {
  assert.deepEqual(plain(bpmSymbols), { lte: '≤', eq: '=', gte: '≥' });
});

test('BPM comparisons include the exact threshold on both sides', () => {
  for (const [operator, expected] of [
    ['lte', [true, true, false]],
    ['eq', [false, true, false]],
    ['gte', [false, true, true]],
  ]) {
    assert.deepEqual(
      [179.5, 180, 180.5].map((bpm) => matchesBpm(bpm, { operator, value: 180 })),
      expected,
    );
  }
  assert.equal(matchesBpm(180.5, { operator: 'eq', value: 180.5 }), true);
  assert.equal(matchesBpm(180.5, { operator: 'eq', value: 180 }), false);
});

test('empty BPM is unrestricted, including missing measurements', () => {
  for (const operator of ['lte', 'eq', 'gte']) {
    for (const bpm of [undefined, null, NaN, Infinity, 0, -1, '180', 180]) {
      assert.equal(matchesBpm(bpm, { operator, value: null }), true);
    }
  }
});

test('active BPM excludes unknown, nonnumeric and nonpositive catalog values', () => {
  for (const operator of ['lte', 'eq', 'gte']) {
    for (const bpm of [undefined, null, NaN, Infinity, -Infinity, 0, -1, '180']) {
      assert.equal(matchesBpm(bpm, { operator, value: 180 }), false);
    }
  }
});

test('free BPM input accepts positive decimals without a preset range', () => {
  for (const [input, expected] of [
    ['', null],
    ['   ', null],
    ['180', 180],
    [' 180.50 ', 180.5],
    ['１８０．５', 180.5],
    ['180,5', 180.5],
    ['.5', 0.5],
    ['0.001', 0.001],
    ['180.', 180],
    ['10000', 10000],
  ]) {
    assert.equal(parseBpmInput(input), expected, input);
  }
});

test('invalid drafts are not coerced, partially parsed or made unrestricted', () => {
  for (const input of [
    '0',
    '-1',
    '+180',
    '180 BPM',
    '180x',
    '1e3',
    'NaN',
    'Infinity',
    '.',
    ',',
    '1,000.5',
    '1,2,3',
    '180..5',
    '9'.repeat(400),
  ]) {
    assert.equal(parseBpmInput(input), undefined, input);
  }
});

test('saved BPM state is copied and validated; legacy state resets the filter', () => {
  const saved = { operator: 'gte', value: 180.5 };
  const restored = restoreBpmFilter(saved);
  assert.deepEqual(plain(restored), saved);
  assert.notEqual(restored, saved);
  for (const operator of ['lte', 'eq', 'gte']) {
    assert.deepEqual(plain(restoreBpmFilter({ operator, value: null })), { operator, value: null });
  }
  for (const value of [
    undefined,
    null,
    [],
    {},
    { operator: 'gt', value: 180 },
    { operator: 'lte', value: '180' },
    { operator: 'eq', value: 0 },
    { operator: 'gte', value: -1 },
    { operator: 'eq', value: Infinity },
    { operator: 'eq', value: NaN },
  ]) {
    assert.deepEqual(plain(restoreBpmFilter(value)), { operator: 'eq', value: null });
  }
});

const { BrowserState } = await loadModule('runtime/browser-state');

test('BPM participates in filter snapshots without sharing mutable state', () => {
  const state = new BrowserState();
  state.configureLevels(['MASTER'], [12, 13]);
  state.bpm.operator = 'gte';
  state.bpm.value = 180.5;
  const snapshot = state.filterSnapshot();
  state.bpm.value = 200;
  assert.deepEqual(plain(snapshot.bpm), { operator: 'gte', value: 180.5 });
  const identity = state.bpm;
  state.restoreFilters(snapshot);
  assert.equal(state.bpm, identity);
  assert.deepEqual(plain(state.bpm), { operator: 'gte', value: 180.5 });
  state.restoreFilters({ difficulties: [], low: 12, high: 13 });
  assert.deepEqual(plain(state.bpm), { operator: 'eq', value: null });
});

test('catalog BPM uses current navigation metadata and never a displayed string', () => {
  const state = new BrowserState();
  const data = {
    catalog: [{ chart_id: 'known' }, { chart_id: 'unknown' }],
    navigation: { charts: { known: { bpm: 180.5 }, unknown: { bpm: null } } },
  };
  state.configure(data);
  assert.equal(state.bpmFor('known'), 180.5);
  assert.equal(state.bpmFor('unknown'), null);
  assert.equal(state.bpmFor('absent'), null);
  assert.equal(state.bpmFor(undefined), null);
  data.navigation.charts.known.bpm = 200;
  assert.equal(state.bpmFor('known'), 200);
  state.configure({ catalog: [{ chart_id: 'known' }] });
  assert.equal(state.bpmFor('known'), null);
});

test('malformed saved filters do not retain a previously active BPM filter', () => {
  const state = new BrowserState();
  for (const snapshot of [
    undefined,
    null,
    {},
    { difficulties: [], bpm: { operator: 'gt', value: 180 } },
  ]) {
    state.bpm.operator = 'gte';
    state.bpm.value = 180;
    state.restoreFilters(snapshot);
    assert.deepEqual(plain(state.bpm), { operator: 'eq', value: null });
  }
});

test('valid extreme decimals round-trip through the editable field without exponents', () => {
  assert.equal(formatBpmInput(null), '');
  for (const value of [
    0.0000001,
    1.234e-10,
    Number.MIN_VALUE,
    1e21,
    1.234e25,
    Number.MAX_VALUE,
    180.5,
  ]) {
    const formatted = formatBpmInput(value);
    assert.equal(formatted.includes('e'), false);
    assert.equal(parseBpmInput(formatted), value);
  }
});
