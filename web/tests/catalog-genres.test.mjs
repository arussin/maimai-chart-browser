import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { genreId, normalizeGenres } from '../src/domain/catalog-genres.ts';
const fixtures = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/genre-aliases.json', import.meta.url)),
);
const fixture = () => ({
  schema_version: 'maimai-browser-catalog-2',
  catalog: [
    {
      chart_id: 'chart',
      regional: {
        JP: { genre: 'sega:POPS＆ANIME', metadata: { catcode: 'POPS＆ANIME' } },
        INTL: { genre: 'sega:Touhou Project' },
      },
    },
  ],
  navigation: {
    genres: [{ id: 'sega:POPS＆ANIME' }],
    charts: { chart: { genre: 'sega:POPS＆ANIME' } },
  },
});
test('historical official genre spellings are exact aliases, never fuzzy matches', () => {
  for (const row of fixtures)
    for (const alias of row.aliases) {
      assert.equal(genreId(alias), row.id);
      assert.equal(genreId('sega:' + alias), row.id);
    }
  for (const value of [
    null,
    undefined,
    12,
    {},
    [],
    '',
    'Future category',
    'POPS',
    'sega:maimai-ish',
  ])
    assert.throws(() => genreId(value), /unrecognized genre/);
});
test('all references validate before normalization commits any change', () => {
  const valid = fixture();
  assert.equal(normalizeGenres(valid), valid);
  assert.equal(valid.navigation.charts.chart.genre, 'POPSアニメ');
  assert.equal(valid.catalog[0].regional.JP.genre, 'POPSアニメ');
  assert.deepEqual(valid.navigation.genres, [
    { id: 'POPSアニメ', label: 'POPS & ANIME' },
    { id: '東方Project', label: '東方Project' },
  ]);
  for (const corrupt of [
    (data) => data.navigation.genres.push({ id: 'Unknown' }),
    (data) => (data.navigation.charts.bad = { genre: 'Unknown' }),
    (data) => delete data.navigation.charts.chart,
    (data) => (data.catalog[0].regional.INTL.genre = 'Unknown'),
    (data) => (data.catalog[0].regional.JP.metadata.catcode = 'Unknown'),
  ]) {
    const data = fixture();
    corrupt(data);
    const before = structuredClone(data);
    assert.throws(() => normalizeGenres(data), /unrecognized genre/);
    assert.deepEqual(
      data,
      before,
      'A later rejected assertion must not partially rewrite earlier rows',
    );
  }
});
test('historical catalogs without navigation stay unchanged and optional empty collections stay valid', () => {
  for (const data of [
    { schema_version: 'legacy', navigation: { charts: { bad: { genre: 'Unknown' } } } },
    { schema_version: 'maimai-browser-catalog-2' },
  ]) {
    const before = structuredClone(data);
    assert.equal(normalizeGenres(data), data);
    assert.deepEqual(data, before);
  }
  for (const data of [
    { schema_version: 'maimai-browser-catalog-2', navigation: {} },
    { schema_version: 'maimai-browser-catalog-2', navigation: { charts: {} }, catalog: [{}] },
    {
      schema_version: 'maimai-browser-catalog-2',
      navigation: { charts: {} },
      catalog: [{ regional: { JP: { metadata: {} } } }],
    },
  ]) {
    normalizeGenres(data);
    assert.deepEqual(data.navigation.genres, []);
  }
  const missing = fixture();
  delete missing.navigation.charts;
  assert.throws(() => normalizeGenres(missing), /unrecognized genre/);
});
