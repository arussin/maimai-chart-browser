import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createArtworkModel } from '../src/domain/artwork.ts';
const chart = { chart_id: 'chart', song_id: 'song', title: 'Exact title', artist: 'Exact artist' };
const jp = 'media/' + 'a'.repeat(64) + '.webp',
  intl = 'media/' + 'b'.repeat(64) + '.webp';
const manifest = () => ({
  version: 'public-artwork-1',
  songs: {
    song: { title: chart.title, artist: chart.artist, path: jp, regions: { INTL: { path: intl } } },
  },
  assets: { [jp]: {}, [intl]: {} },
  versions: { Version: jp },
});
test('accepted artwork remains tied to the canonical title, artist and song identity', () => {
  const model = createArtworkModel({ catalog: [chart], artwork: manifest() });
  assert.equal(model.jacket(chart), jp);
  assert.equal(model.jacket({ ...chart, view_region: 'INTL' }), intl);
  assert.equal(model.jacket({ ...chart, view_region: 'unknown' }), jp);
  assert.equal(model.jacket({ ...chart, song_id: 'other' }), undefined);
  assert.equal(model.jacket({ ...chart, chart_id: 'other' }), undefined);
  assert.equal(model.version('Version'), jp);
  assert.equal(model.version('missing'), undefined);
  assert.equal(model.accepted(jp), true);
  for (const value of [
    undefined,
    null,
    1,
    '',
    'https://example.com/a.webp',
    'media/x.webp',
    'media/' + 'c'.repeat(64) + '.webp',
  ])
    assert.equal(model.accepted(value), false);
});
test('unsupported, missing and contradictory artwork produces no promoted candidate', () => {
  for (const art of [
    undefined,
    null,
    1,
    {},
    { ...manifest(), version: 'future' },
    { ...manifest(), songs: undefined },
    { ...manifest(), songs: { song: { title: 'Changed', artist: chart.artist, path: jp } } },
    { ...manifest(), songs: { song: { title: chart.title, artist: 'Changed', path: jp } } },
  ]) {
    const model = createArtworkModel({ catalog: [chart], artwork: art });
    assert.equal(model.jacket(chart), undefined);
  }
  const absent = createArtworkModel({ catalog: [{ ...chart, song_id: undefined }] });
  assert.equal(absent.jacket({ ...chart, song_id: undefined }), undefined);
  assert.equal(absent.version('Version'), undefined);
  const noAssets = createArtworkModel({
    catalog: [chart],
    artwork: { ...manifest(), assets: undefined, versions: undefined },
  });
  assert.equal(noAssets.accepted(jp), false);
  assert.equal(noAssets.version('Version'), undefined);
  const noRegion = manifest();
  delete noRegion.songs.song.regions;
  assert.equal(createArtworkModel({ catalog: [chart], artwork: noRegion }).jacket(chart), jp);
});
