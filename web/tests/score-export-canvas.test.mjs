import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  scoreExportPartners,
  defaultScoreExportPartner,
} from '../src/views/score-export-partners.ts';
import {
  achievementPalette,
  achievementSpriteLayout,
  ratingTier,
} from '../src/views/score-export-style.ts';

test('official result sprite positions preserve every observed decimal', () => {
  for (const [value, expected] of [
    [1005000, '100.5000'],
    [970001, '97.0001'],
    [0, '0.0000'],
    [123456, '12.3456'],
  ]) {
    const glyphs = achievementSpriteLayout(value);
    assert.equal(glyphs.map((glyph) => glyph.character).join(''), expected);
    assert.deepEqual(
      glyphs.find((glyph) => glyph.character === '.'),
      { character: '.', column: 1, row: 3 },
    );
    for (const glyph of glyphs.filter((glyph) => glyph.character !== '.'))
      assert.equal(glyph.row * 4 + glyph.column, Number(glyph.character));
  }
});

test('result artwork palettes follow the game score boundaries', () => {
  assert.equal(achievementPalette(799999), 'blue');
  assert.equal(achievementPalette(800000), 'red');
  assert.equal(achievementPalette(969999), 'red');
  assert.equal(achievementPalette(970000), 'gold');
});

test('export rating frames retain the existing player placard thresholds', () => {
  const boundaries = [
    [0, 'white'],
    [1000, 'blue'],
    [2000, 'green'],
    [4000, 'yellow'],
    [7000, 'red'],
    [10000, 'purple'],
    [12000, 'bronze'],
    [13000, 'silver'],
    [14000, 'gold'],
    [14500, 'platinum'],
    [15000, 'rainbow'],
    [16000, 'rainbow-ex'],
  ];
  for (const [index, [value, tier]] of boundaries.entries()) {
    assert.equal(ratingTier(value), tier);
    if (index) assert.equal(ratingTier(value - 1), boundaries[index - 1][1]);
  }
});

test('every selectable partner has one reviewed local artwork with matching provenance', () => {
  const assets = JSON.parse(
    readFileSync(new URL('../src/views/score-export-result-artwork.json', import.meta.url), 'utf8'),
  );
  const provenance = JSON.parse(
    readFileSync(
      new URL('../../docs/score-export-result-artwork-provenance.json', import.meta.url),
      'utf8',
    ),
  );
  const partnerDirectory = new URL('../src/views/score-export-partner-artwork/', import.meta.url);
  const partnerModules = scoreExportPartners.map(({ key }) => `score-export-partner-${key}.json`);
  assert.deepEqual(readdirSync(partnerDirectory).sort(), partnerModules.sort());
  for (const { key } of scoreExportPartners) {
    assets['partner:' + key] = JSON.parse(
      readFileSync(new URL(`score-export-partner-${key}.json`, partnerDirectory), 'utf8'),
    );
  }
  const partnerKeys = scoreExportPartners.map(({ key }) => 'partner:' + key).sort();
  assert.equal(defaultScoreExportPartner, 'none');
  assert.equal(new Set(partnerKeys).size, partnerKeys.length);
  assert.deepEqual(
    Object.keys(assets)
      .filter((key) => key.startsWith('partner:'))
      .sort(),
    partnerKeys,
  );
  assert.deepEqual(provenance.files.map(({ key }) => key).sort(), Object.keys(assets).sort());
  for (const file of provenance.files) {
    const encoded = assets[file.key];
    assert.match(encoded, /^data:image\/(?:webp|png);base64,[A-Za-z0-9+/]+=*$/);
    const bytes = Buffer.from(encoded.split(',')[1], 'base64');
    assert.equal(bytes.length, file.packaged_bytes, file.key);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.packaged_sha256, file.key);
    assert.ok(file.width > 0 && file.height > 0, file.key);
    assert.equal(new URL(file.url).protocol, 'https:', file.key);
    assert.equal(
      file.module,
      file.key.startsWith('partner:')
        ? `web/src/views/score-export-partner-artwork/score-export-partner-${file.key.slice(8)}.json`
        : 'web/src/views/score-export-result-artwork.json',
      file.key,
    );
  }
});
