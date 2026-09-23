import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, createHash } from 'node:crypto';
import { loadModule } from './module.mjs';
const { loadSongCatalog } = await loadModule('runtime/song-catalog', { TextDecoder, Uint8Array });
const { PublicReader } = await loadModule('runtime/verified-data', {
  crypto: webcrypto,
  TextDecoder,
  Uint8Array,
  URL,
  fetch: async () => new Response('tampered'),
});
const hash = 'a'.repeat(64);
const fixture = () => ({
  schema_version: 'maimai-song-catalog-1',
  song_id: 'song',
  source_song_ids: ['song'],
  data: {
    schema_version: 'maimai-browser-catalog-2',
    source_catalog_sha256: hash,
    navigation: { charts: {} },
    snippets: {},
    catalog: [
      {
        chart_id: 'chart',
        song_id: 'song',
        source_hash: hash,
        title: 'Song',
        artist: 'Artist',
        format: 'DX',
        difficulty: 'MASTER',
      },
    ],
  },
});
function prepare(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = createHash('sha256').update(bytes).digest('hex');
  return {
    reader: { verified: async () => bytes },
    ref: {
      song: 'song',
      catalog: hash,
      asset: { path: `song-catalog/${digest}.json`, sha256: digest, bytes: bytes.length },
    },
  };
}
test('loads only the verified song projection without requesting the full catalog', async () => {
  const { reader, ref } = prepare(fixture());
  const value = await loadSongCatalog(reader, ref);
  assert.equal(value.catalog.length, 1);
  assert.equal(value.catalog[0].song_id, 'song');
});
test('rejects mismatched scope, identity, catalog, joins and lazy details', async () => {
  for (const mutate of [
    (value) => {
      value.song_id = 'other';
    },
    (value) => {
      value.schema_version = 'future';
    },
    (value) => {
      value.source_song_ids = ['other'];
    },
    (value) => {
      value.data.source_catalog_sha256 = 'b'.repeat(64);
    },
    (value) => {
      value.data.catalog.push({ ...value.data.catalog[0] });
    },
    (value) => {
      value.data.catalog[0].song_id = 'other';
    },
    (value) => {
      value.data.catalog[0].source_hash = '';
    },
    (value) => {
      value.data.catalog[0].detail_bucket = '000';
    },
    (value) => {
      value.data.detail_buckets = {};
    },
    (value) => {
      value.data.snippets.other = {};
    },
    (value) => {
      value.data.analysis = { charts: { other: {} } };
    },
    (value) => {
      value.data.navigation.charts.other = {};
    },
    (value) => {
      value.data.provider_mapping = { charts: { x: { chart_id: 'other' } } };
    },
  ]) {
    const value = fixture();
    mutate(value);
    const { reader, ref } = prepare(value);
    await assert.rejects(loadSongCatalog(reader, ref));
  }
});
test('enforces content hashes, size limits and same-origin asset references', async () => {
  const { reader, ref } = prepare(fixture());
  for (const asset of [
    { ...ref.asset, path: 'https://example.org/x' },
    { ...ref.asset, bytes: 8 * 1024 * 1024 + 1 },
  ])
    await assert.rejects(loadSongCatalog(reader, { ...ref, asset }));
  await assert.rejects(
    loadSongCatalog(new PublicReader(new URL('https://example.org/')), ref),
    /integrity/,
  );
});

test('official inventory charts do not require an unavailable transcription hash', async () => {
  const value = fixture();
  delete value.data.catalog[0].source_hash;
  const { reader, ref } = prepare(value);
  assert.equal((await loadSongCatalog(reader, ref)).catalog[0].source_hash, undefined);
  value.data.schema_version = 'maimai-browser-catalog-1';
  await assert.rejects(loadSongCatalog(prepare(value).reader, ref));
});
