import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectCatalogRows } from '../src/domain/catalog-row-selection.ts';

const rows = Object.freeze(
  Array.from({ length: 7251 }, (_, index) => Object.freeze({ key: `chart:${index}` })),
);
const indices = (value) => value.map((entry) => entry.index);

test('a route beyond row 4000 adds one exact target without expanding the prefix', () => {
  const selected = selectCatalogRows(rows, 40, 'chart:4015');
  assert.equal(selected.length, 41);
  assert.deepEqual(indices(selected), [...Array(40).keys(), 4015]);
  assert.equal(selected.at(-1).row, rows[4015]);
  assert.equal(new Set(selected.map((entry) => entry.row.key)).size, 41);
});

test('prefix-only, missing and already included targets retain the original order', () => {
  const prefix = [...Array(40).keys()];
  for (const focus of [null, '', 'unknown', 'chart:0', 'chart:39']) {
    assert.deepEqual(indices(selectCatalogRows(rows, 40, focus)), prefix);
  }
  assert.deepEqual(indices(selectCatalogRows(rows, 40, 'chart:40')), [...prefix, 40]);
  assert.deepEqual(selectCatalogRows([], 40, 'unknown'), []);
  assert.deepEqual(selectCatalogRows(rows, 0, null), []);
  assert.deepEqual(indices(selectCatalogRows(rows, 0, 'chart:4015')), [4015]);
});

test('Show more monotonically reaches every row without duplicating the focused row', () => {
  let previous = new Set();
  for (let visible = 40; visible < rows.length + 40; visible += 40) {
    const selected = selectCatalogRows(rows, visible, 'chart:4015');
    const current = new Set(selected.map((entry) => entry.row.key));
    assert.equal(current.size, selected.length);
    for (const id of previous) assert.equal(current.has(id), true);
    for (const entry of selected) assert.equal(entry.row, rows[entry.index]);
    assert.equal(selected.length <= Math.min(visible + 1, rows.length), true);
    assert.deepEqual(
      indices(selected),
      indices(selected).toSorted((a, b) => a - b),
    );
    previous = current;
  }
  assert.equal(previous.size, rows.length);
});

test('filtering never reintroduces an excluded route target and sorting uses current indices', () => {
  const filtered = rows.filter((row) => row.key !== 'chart:4015');
  assert.deepEqual(indices(selectCatalogRows(filtered, 40, 'chart:4015')), [...Array(40).keys()]);
  const reversed = rows.toReversed();
  const selected = selectCatalogRows(reversed, 40, 'chart:4015');
  assert.equal(selected.at(-1).index, 3235);
  assert.equal(selected.at(-1).row, rows[4015]);
  assert.deepEqual(indices(selectCatalogRows(rows, rows.length + 10, 'chart:4015')), [
    ...rows.keys(),
  ]);
});

test('selection preserves input identity and does not mutate the frozen rows', () => {
  const before = JSON.stringify(rows);
  for (let count = 0; count < 2; count++) {
    const selected = selectCatalogRows(rows, 40, 'chart:4015');
    assert.equal(selected.at(-1).row.key, 'chart:4015');
    assert.equal(selected.at(-1).row, rows[4015]);
  }
  assert.equal(JSON.stringify(rows), before);
});

test('invalid prefix requests fail instead of unexpectedly rendering an unbounded list', () => {
  for (const visible of [-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => selectCatalogRows(rows, visible, null), RangeError);
  }
});
