import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { parseOfficialFileExport } from '../src/domain/import-official.ts';
import { loadModule } from './module.mjs';

const { lookupDXRatingSheet } = await loadModule('domain/import-dxrating-metadata');
const parse = (rows) => parseOfficialFileExport('dxrating', rows, lookupDXRatingSheet);
const fixtures = Object.fromEntries(
  await Promise.all(
    ['all-records', 'best50', 'legacy', 'mixed'].map(async (name) => [
      name,
      JSON.parse(
        await readFile(new URL(`./fixtures/dxrating-${name}.json`, import.meta.url), 'utf8'),
      ),
    ]),
  ),
);
const score = fixtures['all-records'][1];
const tag = Symbol.for('maimai.party.diagnostic-error-v1');

for (const [name, input] of Object.entries(fixtures)) {
  test(`DXRating ${name} real-shape fixture normalizes synthetic scores`, () => {
    const result = parse(input);
    assert.equal(result.rows.length, 2);
    assert.equal(result.coverage, 'unknown');
    assert.equal(result.capturedAt, null);
    assert.equal(result.rows[0].achievement, Math.round(input[0].achievementRate * 10000));
  });
}

test('public sheet identity supplies exact metadata without copying optional provenance', () => {
  const row = parse([score]).rows[0];
  assert.equal(row.sourceID, score.sheetId);
  assert.equal(row.sourceSongID, score.identity.songId);
  assert.equal(row.title, '君の知らない物語');
  assert.equal(row.artist, 'supercell「化物語」');
  assert.equal(row.format, 'DX');
  assert.equal(row.difficulty, 'MASTER');
  assert.equal(row.achievement, 1005432);
  assert.equal(row.lamp, 'ALL PERFECT');
  assert.equal(row.sync, '');
  assert.equal(row.dxScore, 234);
  assert.equal('source' in row, false);
  assert.equal('providerConfig' in row, false);
  for (const identity of [
    null,
    {},
    'malformed',
    { songId: 'dsng_x' },
    { ...score.identity, type: ['dx'] },
  ])
    assert.equal(parse([{ ...score, identity }]).rows[0].title, row.title);
});

test('well-formed public identity disagreements reject with the existing finite reason', () => {
  for (const change of [{ songId: 'dsng_23456789ab' }, { type: 'std' }, { difficulty: 'basic' }])
    assert.throws(
      () => parse([{ ...score, identity: { ...score.identity, ...change } }]),
      (error) => error[tag]?.reason === 'record_identity' && /disagrees/.test(error.message),
    );
  for (const sheetId of ['dsht_0000000000', 'dsht_234', 'constructor'])
    assert.throws(
      () => parse([{ ...score, sheetId }]),
      (e) => e[tag]?.reason === 'record_identity',
    );
});

test('bad scores reject the entire ordinary file without widening percentage bounds', () => {
  for (const achievementRate of [null, -1, 101.0001, 150, NaN, Infinity, '100', 100.12345])
    assert.throws(
      () => parse([score, { ...score, achievementRate }]),
      (e) => e[tag]?.reason === 'record_score' && /Record 2:/.test(e.message),
    );
  assert.deepEqual(
    parse([0, 101].map((achievementRate) => ({ ...score, achievementRate }))).rows.map(
      (r) => r.achievement,
    ),
    [0, 1010000],
  );
});

test('unknown IDs never acquire guessed chart metadata', () => {
  const sheetId = 'dsht_23456789ab';
  assert.equal(lookupDXRatingSheet(sheetId), undefined);
  const row = parse([{ ...score, sheetId }]).rows[0];
  assert.equal(row.title, '');
  assert.equal(row.artist, '');
  assert.equal(row.sourceID, sheetId);
  assert.throws(
    () => parse([{ sheetId, achievementRate: 99 }]),
    (e) => e[tag]?.reason === 'record_identity' && /Refresh the lookup/.test(e.message),
  );
});

test('public Utage follows the same type handling as legacy, including all-Utage failure', () => {
  const lookup = () => ({
    songID: 'dsng_23456789ab',
    title: 'Synthetic',
    artist: 'Synthetic',
    type: 'utage',
    difficulty: '【宴】',
  });
  const utage = { sheetId: 'dsht_23456789ab', achievementRate: 99 };
  const result = parseOfficialFileExport('dxrating', [fixtures.legacy[0], utage], lookup);
  assert.equal(result.excludedUtage, 1);
  assert.equal(result.coverage, 'partial');
  assert.equal(result.rows.length, 1);
  assert.throws(
    () => parseOfficialFileExport('dxrating', [utage], lookup),
    /only unsupported Utage/,
  );
});

test('file normalizer loads the public lookup and retains structured unknowns unmatched', async () => {
  const globals = {
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    Blob,
    DecompressionStream,
    CompressionStream,
    structuredClone,
    Date,
    Map,
    Set,
    Uint8Array,
    ArrayBuffer,
  };
  const { createPlayerDataCore } = await loadModule('views/player-data-core', globals);
  const { normalizeFileImportDocument } = await loadModule('runtime/import-file', globals);
  const { exactFileChartIndex } = await loadModule('domain/import-identities', globals);
  const core = createPlayerDataCore();
  for (const [name, input] of Object.entries(fixtures)) {
    const data = await normalizeFileImportDocument(
      core,
      input,
      { format: 'dxrating', username: 'Synthetic', region: 'intl' },
      { capturedAt: 1700000000000, sourceKind: 'dxrating-file' },
    );
    assert.equal(core.current(data).pbs.size, 2, name);
    assert.ok(Object.values(data.snapshots).every((s) => !s.complete));
  }
  const data = await normalizeFileImportDocument(
    core,
    [score, { ...score, sheetId: 'dsht_23456789ab' }],
    { format: 'dxrating', username: 'Synthetic', region: 'intl' },
    { sourceKind: 'dxrating-file' },
  );
  const catalog = [
    {
      chart_id: 'synthetic-catalog',
      title: '君の知らない物語',
      artist: 'supercell「化物語」',
      format: 'DX',
      difficulty: 'MASTER',
    },
  ];
  assert.equal(core.current(data).pbs.size, 2);
  assert.equal(exactFileChartIndex(catalog, data.charts).size, 1);
});
