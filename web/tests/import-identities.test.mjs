import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FILE_PROVIDERS,
  filePlayerKey,
  validFilePlayer,
  validFileChartID,
  exactFileChartIndex,
} from '../src/domain/import-identities.ts';

const player = (provider = 'diving-fish', region = 'cn', username = 'Fixture') => ({
  provider,
  game: 'maimaidx',
  username,
  displayName: 'Synthetic Player',
  key: filePlayerKey(provider, region, username),
});
const chart = (id = 'diving-fish:cn:101:DX:MASTER', overrides = {}) => ({
  chartID: id,
  songID: '101',
  title: 'Exact Title',
  artist: 'Exact Artist',
  format: 'DX',
  difficulty: 'MASTER',
  level: '13+',
  constant: 137,
  displayVersion: '',
  inGameID: 101,
  ...overrides,
});
const canonical = (id = 'canonical:one', overrides = {}) => ({
  chart_id: id,
  title: 'Exact Title',
  artist: 'Exact Artist',
  format: 'DX',
  difficulty: 'MASTER',
  variant_id: 'ordinary',
  ...overrides,
});

test('Fish identity preserves case and Unicode in its China tracker namespace', () => {
  assert.deepEqual(FILE_PROVIDERS, ['diving-fish']);
  assert(validFilePlayer(player()));
  assert.equal(player().key, 'diving-fish:maimaidx:cn:Fixture');
  assert.notEqual(player().key, player('diving-fish', 'cn', 'fixture').key);
  assert.equal(
    player('diving-fish', 'cn', '名字:1').key,
    'diving-fish:maimaidx:cn:%E5%90%8D%E5%AD%97%3A1',
  );
  assert.equal(validFilePlayer({ ...player(), key: 'diving-fish:maimaidx:cn:fixture' }), false);
  assert.equal(validFilePlayer({ ...player(), game: 'other' }), false);
  assert.equal(validFilePlayer({ ...player(), key: 'missing' }), false);
  assert.equal(validFilePlayer({ ...player(), provider: 'unknown' }), false);
});

test('deferred namespaces, unsupported regions and portable limits are rejected', () => {
  for (const provider of [
    'lxns',
    'mai-tools',
    'dxrating',
    'tomomai',
    'jietng',
    'aqua',
    'tachi',
    'unknown',
  ])
    assert.throws(() => filePlayerKey(provider, 'cn', 'Fixture'), /Unsupported/);
  for (const region of ['jp', 'intl', 'private', 'unknown'])
    assert.throws(() => filePlayerKey('diving-fish', region, 'Fixture'), /Unsupported/);
  for (const username of ['', 'x\n', '\ud800', '名'.repeat(30)])
    assert.throws(() => filePlayerKey('diving-fish', 'cn', username));
  assert.throws(
    () => filePlayerKey('diving-fish', 'cn', '名'.repeat(30)),
    /portable player-data limit/,
  );
});

test('chart references cannot cross namespaces and source IDs stay encoded opaque strings', () => {
  const source = player();
  assert(validFileChartID(source, 'diving-fish:cn:101:DX:RE:MASTER'));
  assert(validFileChartID(source, 'diving-fish:cn:' + encodeURIComponent('名前/song')));
  for (const id of [
    '101',
    'lxns:cn:101',
    'diving-fish:jp:101',
    'diving-fish:cn:',
    'diving-fish:cn:101::MASTER',
    'diving-fish:cn:../101',
    'diving-fish:cn:__proto__',
    'diving-fish:cn:%63onstructor',
    'diving-fish:cn:%00',
    'diving-fish:cn:%zz',
    'diving-fish:cn:%ff',
    'diving-fish:cn:' + '1'.repeat(256),
  ])
    assert.equal(validFileChartID(source, id), false, id);
  assert.equal(validFileChartID({ ...source, provider: 'unknown' }, 'diving-fish:cn:101'), false);
});

test('matching requires exact complete metadata and ignores numeric IDs and display projections', () => {
  const source = chart();
  assert.deepEqual(
    exactFileChartIndex([canonical()], { [source.chartID]: source }),
    new Map([['canonical:one', [source.chartID]]]),
  );
  for (const change of [
    { artist: '' },
    { artist: 'Different Artist' },
    { title: '' },
    { title: 'Exact Title (another edition)' },
    { title: 'exact title' },
    { format: 'STD' },
    { difficulty: 'EXPERT' },
    { difficulty: 'UTAGE' },
  ]) {
    const other = chart(source.chartID, change);
    assert.equal(exactFileChartIndex([canonical()], { [other.chartID]: other }).size, 0);
  }
  const projected = canonical('other', {
    title: 'Other Title',
    view_title: 'Exact Title',
    inGameID: 101,
  });
  assert.equal(exactFileChartIndex([projected], { [source.chartID]: source }).size, 0);
  const whitespace = chart(source.chartID, { title: ' Exact  Title ', artist: 'Exact\tArtist' });
  assert.equal(exactFileChartIndex([canonical()], { [whitespace.chartID]: whitespace }).size, 1);
  const decomposed = chart(source.chartID, { title: 'Cafe\u0301' });
  assert.equal(
    exactFileChartIndex([canonical('one', { title: 'Café' })], { [source.chartID]: decomposed })
      .size,
    1,
  );
});

test('duplicate or nonordinary identities remain unmatched and leave original records intact', () => {
  const source = chart(),
    original = structuredClone(source);
  for (const catalog of [
    [canonical('one'), canonical('two')],
    [canonical('one', { variant_id: 'utage' })],
  ])
    assert.equal(exactFileChartIndex(catalog, { [source.chartID]: source }).size, 0);
  const duplicate = chart('diving-fish:cn:102:DX:MASTER');
  assert.equal(
    exactFileChartIndex([canonical()], { [source.chartID]: source, [duplicate.chartID]: duplicate })
      .size,
    0,
  );
  assert.deepEqual(source, original);
});
