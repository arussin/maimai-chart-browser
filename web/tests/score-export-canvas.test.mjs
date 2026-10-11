import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
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

test('Best 50 rating numerals share a baseline and center in the official digit windows', () => {
  const source = readFileSync(
    new URL('../src/views/score-export-canvas.ts', import.meta.url),
    'utf8',
  );
  const playerRating = runInNewContext(
    '(' +
      stripTypeScriptTypes(
        source.slice(
          source.indexOf('function playerRating('),
          source.indexOf('function achievementArt('),
        ),
      ) +
      ')',
    {
      art: () => true,
      ratingTier,
      font: (ctx, size) => {
        ctx.size = size;
      },
    },
  );
  for (const width of [224, 328, 540]) {
    for (const rating of [0, 1234, 14510, 98765]) {
      const drawn = [],
        x = 72,
        y = 129,
        height = (width * 86) / 296;
      const ctx = {
        textAlign: 'right',
        textBaseline: 'top',
        size: 0,
        save() {
          this.saved = { textAlign: this.textAlign, textBaseline: this.textBaseline };
        },
        restore() {
          Object.assign(this, this.saved);
        },
        measureText(value) {
          // Deliberately asymmetric ink catches alignment by advance width alone.
          return {
            actualBoundingBoxAscent: this.size * 0.73,
            actualBoundingBoxDescent: this.size * 0.02,
            actualBoundingBoxLeft: this.size * (value === '1' ? 0.13 : 0.3),
            actualBoundingBoxRight: this.size * (value === '1' ? 0.27 : 0.3),
          };
        },
        fillText(value, left, baseline) {
          assert.equal(this.textAlign, 'center');
          assert.equal(this.textBaseline, 'alphabetic');
          drawn.push({ value, left, baseline, bounds: this.measureText(value) });
        },
      };
      playerRating(ctx, new Map(), rating, x, y, width);
      assert.equal(drawn.map((d) => d.value).join(''), String(rating));
      assert.equal(new Set(drawn.map((d) => d.baseline)).size, 1);
      for (const [index, d] of drawn.entries()) {
        const slot = 5 - drawn.length + index,
          cellWidth = width * 0.1069;
        const center = x + width * 0.4155 + cellWidth * (slot + 0.5);
        const inkLeft = d.left - d.bounds.actualBoundingBoxLeft,
          inkRight = d.left + d.bounds.actualBoundingBoxRight;
        assert.ok(Math.abs((inkLeft + inkRight) / 2 - center) < 1e-8);
        assert.ok(inkLeft > center - cellWidth / 2 && inkRight < center + cellWidth / 2);
        const top = d.baseline - d.bounds.actualBoundingBoxAscent,
          bottom = d.baseline + d.bounds.actualBoundingBoxDescent;
        assert.ok(Math.abs((top + bottom) / 2 - (y + (height * 45) / 86)) < 1e-8);
        assert.ok(top > y + (height * 24) / 86 && bottom < y + (height * 66) / 86);
      }
      assert.equal(ctx.textAlign, 'right');
      assert.equal(ctx.textBaseline, 'top');
    }
  }
});

test('rating artwork failure and totals beyond five digits retain a readable numeric fallback', () => {
  const source = readFileSync(
    new URL('../src/views/score-export-canvas.ts', import.meta.url),
    'utf8',
  );
  for (const rating of [0, 15432, 100000]) {
    const painted = [],
      frames = [],
      artworkRequests = [];
    const playerRating = runInNewContext(
      '(' +
        stripTypeScriptTypes(
          source.slice(
            source.indexOf('function playerRating('),
            source.indexOf('function achievementArt('),
          ),
        ) +
        ')',
      {
        art: (...args) => {
          artworkRequests.push(args);
          return false;
        },
        box: (...args) => frames.push(args),
        text: (...args) => painted.push(args),
        ratingTier,
        ink: '#243348',
      },
    );
    playerRating({}, new Map(), rating, 324, 982, 328);
    assert.equal(frames.length, 1);
    assert.equal(painted.length, 1);
    const [, value, x, baseline, maxWidth, size, color, align] = painted[0];
    assert.equal(value, String(rating));
    assert.equal(x, 488);
    assert.equal(maxWidth, 288);
    assert.equal(color, '#243348');
    assert.equal(align, 'center');
    assert.ok(baseline > 982 && baseline < 1078);
    assert.ok(size > 0 && size < 96);
    assert.equal(artworkRequests.length, rating <= 99999 ? 1 : 0);
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
