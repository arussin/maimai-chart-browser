import { test } from 'node:test';
import assert from 'node:assert/strict';
import bundled from '../../src/maimai_intelligence/assets/export-artwork/manifest.json' with { type: 'json' };
import { createArtworkModel } from '../src/domain/artwork.ts';
import { resolveExportJacket } from '../src/domain/export-artwork.ts';

const songId = 'song:11111111-1111-1111-1111-111111111111';
const thumbnail = `media/${'a'.repeat(64)}.webp`;
const regionalThumbnail = `media/${'b'.repeat(64)}.webp`;
const larger = `media/${'c'.repeat(64)}.webp`;
const regionalLarger = `media/${'d'.repeat(64)}.webp`;
const chart = { chart_id: 'chart', song_id: songId, title: 'Canonical title', artist: 'Artist' };
function manifest() {
  return {
    version: 'score-export-jackets-2',
    jackets: {
      [`${songId}/JP`]: { title: chart.title, artist: chart.artist, thumbnail, path: larger },
      [`${songId}/INTL`]: {
        title: 'Regional title',
        artist: chart.artist,
        thumbnail: regionalThumbnail,
        path: regionalLarger,
      },
    },
    assets: {
      [larger]: { sha256: 'c'.repeat(64), bytes: 200000, width: 400, height: 400 },
      [regionalLarger]: { sha256: 'd'.repeat(64), bytes: 50000, width: 190, height: 190 },
    },
  };
}
function data() {
  return {
    catalog: [chart],
    artwork: {
      version: 'public-artwork-1',
      songs: { [songId]: { title: chart.title, artist: chart.artist, path: thumbnail } },
      assets: { [thumbnail]: {} },
    },
  };
}

test('export jacket uses canonical binding without changing identity or ordinary thumbnails', () => {
  const input = data(),
    before = structuredClone(input),
    model = createArtworkModel(input);
  assert.equal(model.jacket(chart), thumbnail);
  assert.equal(resolveExportJacket(model, chart, manifest()), larger);
  assert.equal(model.jacket(chart), thumbnail);
  assert.equal(model.accepted(larger), false);
  assert.deepEqual(input, before);
  assert.equal(resolveExportJacket(model, { ...chart, song_id: 'another' }, manifest()), undefined);
  assert.equal(
    resolveExportJacket(model, { ...chart, chart_id: 'another' }, manifest()),
    undefined,
  );
  delete input.artwork.assets[thumbnail];
  assert.equal(resolveExportJacket(createArtworkModel(input), chart, manifest()), undefined);
});

test('regional export requires its exact identity and accepted thumbnail provenance', () => {
  const input = data();
  input.artwork.songs[songId].regions = {
    INTL: { path: regionalThumbnail, title: 'Regional title', artist: chart.artist },
  };
  input.artwork.assets[regionalThumbnail] = {};
  assert.equal(resolveExportJacket(createArtworkModel(input), chart, manifest()), larger);
  assert.equal(
    resolveExportJacket(createArtworkModel(input), { ...chart, view_region: 'INTL' }, manifest()),
    regionalLarger,
  );
  input.artwork.songs[songId].regions.INTL.artist = 'Different artist';
  assert.equal(
    resolveExportJacket(createArtworkModel(input), { ...chart, view_region: 'INTL' }, manifest()),
    regionalThumbnail,
  );
});

test('CN, PRIVATE and unknown regions never acquire a JP or INTL export override', () => {
  const model = createArtworkModel(data());
  for (const region of ['CN', 'PRIVATE', 'unknown', 'cn', 'JP?']) {
    assert.equal(
      resolveExportJacket(model, { ...chart, view_region: region }, manifest()),
      thumbnail,
    );
  }
  const input = data();
  input.artwork.songs[songId].regions = {
    CN: { path: regionalThumbnail, title: 'Regional title', artist: chart.artist },
  };
  input.artwork.assets[regionalThumbnail] = {};
  assert.equal(
    resolveExportJacket(createArtworkModel(input), { ...chart, view_region: 'CN' }, manifest()),
    regionalThumbnail,
  );
});

test('a reviewed jacketless song needs its own exact canonical and regional binding', () => {
  const model = createArtworkModel({ catalog: [chart] }),
    index = manifest();
  index.jackets[`${songId}/JP`].thumbnail = null;
  assert.equal(model.jacket(chart), undefined);
  assert.equal(resolveExportJacket(model, chart, index), larger);
  assert.equal(resolveExportJacket(model, { ...chart, view_region: 'INTL' }, index), undefined);
  assert.equal(resolveExportJacket(model, { ...chart, view_region: 'CN' }, index), undefined);
  index.jackets[`${songId}/JP`].artist = 'Other artist';
  assert.equal(resolveExportJacket(model, chart, index), undefined);
});

test('unmatched, contradictory and unbounded metadata safely keeps accepted artwork', () => {
  const model = createArtworkModel(data());
  for (const mutate of [
    (m) => {
      m.version = 'future';
    },
    (m) => {
      delete m.jackets[`${songId}/JP`];
    },
    (m) => {
      m.jackets[`${songId}/JP`].title = 'Different';
    },
    (m) => {
      m.jackets[`${songId}/JP`].artist = 'Different';
    },
    (m) => {
      m.jackets[`${songId}/JP`].thumbnail = regionalThumbnail;
    },
    (m) => {
      m.jackets[`${songId}/JP`].path = 'https://example.com/private.webp';
    },
    (m) => {
      delete m.assets[larger];
    },
    (m) => {
      m.assets[larger].sha256 = 'a'.repeat(64);
    },
    (m) => {
      m.assets[larger].bytes = 512 * 1024 + 1;
    },
    (m) => {
      m.assets[larger].width = 4096;
    },
    (m) => {
      m.assets[larger].width = 128;
    },
  ]) {
    const altered = manifest();
    mutate(altered);
    assert.equal(resolveExportJacket(model, chart, altered), thumbnail);
  }
});

test('bundled inventory contains only larger, content-addressed regional assets', () => {
  assert.equal(bundled.version, 'score-export-jackets-2');
  assert.ok(Object.keys(bundled.assets).length >= 47);
  for (const [binding, entry] of Object.entries(bundled.jackets)) {
    assert.match(binding, /^song:[a-f0-9-]{36}\/(JP|INTL)$/);
    const asset = bundled.assets[entry.path];
    assert.equal(entry.path, `media/${asset.sha256}.webp`);
    assert.ok(asset.width > 128 && asset.height > 128);
    assert.ok(asset.width <= 512 && asset.height <= 512);
  }
});
