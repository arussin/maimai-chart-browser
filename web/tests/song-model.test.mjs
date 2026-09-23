import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSongModel } from '../src/domain/song-model.ts';

const chart = (id = 'a', extra = {}) => ({
  chart_id: id,
  song_id: 'song',
  source_hash: 'hash',
  title: 'JP',
  artist: 'Artist',
  format: 'DX',
  difficulty: 'MASTER',
  ...extra,
});
const fixture = () => ({
  schema_version: 'maimai-browser-catalog-2',
  snippets: {},
  catalog: [
    chart('a', {
      regional: {
        INTL: {
          listing: 'listed',
          level: '11',
          genre: 'Touhou Project',
          version: 'Intl',
          metadata: { title: 'INTL', catcode: 'Touhou Project', version: 'Intl' },
        },
      },
    }),
    chart('b'),
    chart('std', { format: 'STD' }),
    chart('variant', { variant_id: 'special' }),
    chart('other', { song_id: 'other-song' }),
  ],
  navigation: {
    genres: [{ id: 'maimai', label: 'maimai' }],
    charts: Object.fromEntries(
      ['a', 'b', 'std', 'variant', 'other'].map((id) => [
        id,
        {
          source_hash: 'hash',
          chart_id: id,
          genre: 'maimai',
          version: 'JP',
          chart_constant: 12,
          bpm: 180,
          regional_metrics: { chart_constant: { INTL: 11.5 } },
          metric_sources: { chart_constant: { provider: 'verified', region: 'JP' } },
        },
      ]),
    ),
  },
});

test('regional song projection is independent, exact, and never mutates accepted input', () => {
  const data = fixture(),
    before = structuredClone(data),
    model = createSongModel(data, 'song');
  const jp = model(false),
    intl = model(true);
  assert.deepEqual(
    jp.charts.map((c) => c.chart_id),
    ['a', 'b', 'std', 'variant'],
  );
  assert.equal(jp.charts[0].title, 'JP');
  assert.equal(intl.charts[0].title, 'INTL');
  assert.equal(jp.constant(jp.charts[0]), 12);
  assert.equal(intl.constant(intl.charts[0]), 11.5);
  assert.equal(jp.folder(jp.charts[0], 'version'), 'JP');
  assert.equal(intl.folder(intl.charts[0], 'version'), 'Intl');
  assert.equal(intl.folder(intl.charts[0], 'genre'), '東方Project');
  assert.equal(jp.bpm(jp.charts[0]), 180);
  assert.deepEqual(jp.constantSource(jp.charts[0]), { provider: 'verified', region: 'JP' });
  assert.deepEqual(
    jp.choices(jp.charts[0]).map((c) => c.chart_id),
    ['a', 'b'],
  );
  assert.deepEqual(
    jp.choices(jp.charts[2]).map((c) => c.chart_id),
    ['std'],
  );
  assert.deepEqual(
    jp.choices(jp.charts[3]).map((c) => c.chart_id),
    ['variant'],
  );
  assert.equal(model(false).charts[0].title, 'JP');
  assert.deepEqual(data, before);
  jp.charts[0].title = 'edited view';
  assert.equal(model(false).charts[0].title, 'JP');
});

test('constants require the correct canonical identity and finite supported bounds', () => {
  for (const variant of [false, true])
    for (const value of [undefined, null, '12', NaN, Infinity, -1, 0, 15.1, 1, 15]) {
      const data = fixture();
      data.catalog = [chart('a', variant ? { variant_id: 'special' } : {})];
      data.navigation.charts.a.chart_constant = value;
      const model = createSongModel(data, 'song')(false),
        c = model.charts[0];
      assert.equal(
        model.constant(c),
        typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 15
          ? value
          : null,
      );
      data.navigation.charts.a[variant ? 'chart_id' : 'source_hash'] = 'different';
      const mismatched = createSongModel(data, 'song')(false);
      assert.equal(mismatched.constant(mismatched.charts[0]), null);
    }
});

test('historical missing metadata stays unknown without inventing chart identity', () => {
  for (const navigation of [undefined, { charts: {} }, { charts: { a: {} } }]) {
    const data = { schema_version: 'historical', catalog: [chart()], navigation, snippets: {} };
    const view = createSongModel(data, 'song')(false),
      c = view.charts[0];
    assert.equal(view.constant(c), null);
    assert.equal(view.bpm(c), null);
    assert.equal(view.folder(c, 'genre'), 'unknown');
    assert.equal(view.constantSource(c), undefined);
    const stranger = chart('absent');
    assert.equal(view.constant(stranger), null);
    assert.equal(view.constant({ ...stranger, variant_id: 'special' }), null);
    assert.equal(view.bpm(stranger), null);
    assert.equal(view.folder(stranger, 'version'), 'unknown');
    assert.equal(view.constantSource(stranger), undefined);
    assert.deepEqual(createSongModel(data, 'missing')(true).charts, []);
  }
});

test('contradictory inventory genres fail before returning a song projection', () => {
  const data = fixture();
  data.navigation.charts.a.genre = 'unreviewed category';
  assert.throws(() => createSongModel(data, 'song'), /unrecognized genre/);
});
