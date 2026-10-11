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

test('Best 50 cards show imported constants, larger jackets and an independent format suffix', () => {
  const source = readFileSync(
    new URL('../src/views/score-export-canvas.ts', import.meta.url),
    'utf8',
  );
  const paints = [],
    jackets = [];
  const draw = runInNewContext(
    '(' +
      stripTypeScriptTypes(
        source.slice(
          source.indexOf('function best50Card('),
          source.indexOf('/** Native canvas export:'),
        ),
      ) +
      ')',
    {
      difficulty: () => '#8456cf',
      box() {},
      text: (...args) => paints.push(args),
      jacket: (...args) => jackets.push(args),
      grade() {},
      gradeForAchievement: () => 'SSS+',
      achievement: () => '100.5000%',
      badges: () => [],
      muted: '#667487',
    },
  );
  for (const constant of [149, null, 0])
    for (const format of ['DX', 'STD']) {
      paints.length = jackets.length = 0;
      draw(
        {},
        {
          chart: {
            chartID: 'synthetic',
            title: 'Long imported title '.repeat(10),
            level: '14+',
            constant: 150,
            format,
            difficulty: 'MASTER',
          },
          record: { constant, achievement: 1005000 },
          rating: 335,
        },
        1,
        48,
        465,
        new Map(),
        { translate: (key) => key },
      );
      const constantPaint = paints.find(([, , x, y]) => x === 323 && y === 486);
      assert.equal(constantPaint[1], constant === null ? '—' : (constant / 10).toFixed(1));
      assert.ok(
        !paints.some(
          ([, value]) => value === '14+' || value === '15.0' || value.startsWith('Constant'),
        ),
      );
      assert.equal(jackets[0][4], 106);
      const title = paints.find(([, value]) => value.startsWith('Long imported title'));
      const suffix = paints.find(([, value]) => value === format);
      assert.equal(title[3], suffix[3]);
      assert.ok(title[2] + title[4] < suffix[2] - suffix[4], 'Long title cannot cover format');
      assert.ok(jackets[0][3] + jackets[0][4] < title[3] - 21);
    }
});

test('Best 50 has fifty bounded cards, matched name and rating widths, and no painted footer', async () => {
  const source = readFileSync(
    new URL('../src/views/score-export-canvas.ts', import.meta.url),
    'utf8',
  );
  const paints = [],
    cards = [],
    names = [],
    ratings = [],
    brands = [],
    artwork = [],
    boxes = [],
    attributes = {};
  const ctx = {
    fillRect() {},
    save() {},
    beginPath() {},
    rect() {},
    clip() {},
    restore() {},
    createLinearGradient() {
      return { addColorStop() {} };
    },
  };
  const canvas = {
    setAttribute(key, value) {
      attributes[key] = value;
    },
  };
  const draw = runInNewContext(
    '(' +
      stripTypeScriptTypes(
        source.slice(
          source.indexOf('export async function renderBest50('),
          source.indexOf('/** The artwork fills'),
        ),
      ).replace(/^export /, '') +
      ')',
    {
      jackets: async () => new Map(),
      surface: (_, width, height) => {
        Object.assign(canvas, { width, height });
        return { canvas, ctx };
      },
      officialBackground() {},
      art: (...args) => artwork.push(args),
      box: (...args) => boxes.push(args),
      siteBrand: (...args) => brands.push(args),
      muted: '#667487',
      ink: '#243348',
      text: (...args) => paints.push(args),
      best50Card: (...args) => cards.push(args),
      playerName: (...args) => names.push(args),
      playerRating: (...args) => ratings.push(args),
    },
  );
  const warning = 'Imported observation warning';
  const model = {
    old: [],
    new: [],
    totalRating: 0,
    oldTotal: 0,
    newTotal: 0,
    player: { displayName: 'Synthetic' },
    version: { label: 'PRiSM PLUS' },
    coverage: 'partial',
    excluded: { total: 2 },
    warnings: [warning],
  };
  await draw({}, model, { translate: (key) => key, regionLabel: 'Japan' });
  assert.equal(canvas.width, 1600);
  assert.equal(canvas.height, 2369);
  assert.equal(cards.length, 50);
  assert.equal(new Set(cards.map((c) => c[3])).size, 5);
  for (const card of cards) assert.ok(card[4] + 186 < canvas.height);
  assert.equal(cards[0][4], 340);
  assert.equal(cards[35][4], 1778);
  assert.equal(cards.at(-1)[4] + 186, 2356);
  assert.deepEqual(boxes[0].slice(1), [28, 20, 1544, 2337, '#ffffffd6', 24]);
  assert.ok(artwork.every(([, , key]) => key !== 'character'));
  assert.deepEqual(artwork.find(([, , key]) => key === 'version').slice(3), [1090, 79, 462, 132]);
  assert.equal(names[0][3], ratings[0][3]);
  assert.equal(names[0][5], ratings[0][5]);
  assert.equal(names[0][3], cards[0][3], 'Player block aligns with chart grid');
  assert.equal(names[0][5], 480);
  assert.ok(names[0][6] >= (names[0][5] * 25) / 268, 'Nameplate art can occupy its entire width');
  assert.ok(
    paints.every(
      ([, value, , y]) =>
        y < canvas.height &&
        value !== warning &&
        value !== model.version.label &&
        value !== 'Rating total' &&
        value !== 'Rating estimate' &&
        !value.startsWith('Captured') &&
        value !== 'Created from imported records',
    ),
  );
  assert.match(attributes['aria-label'], /Imported observation warning/);
  assert.match(attributes['aria-label'], /Rating estimate 0/);
  assert.match(attributes['aria-label'], /PRiSM PLUS/);
  assert.deepEqual(brands[0].slice(1), [820, 116, 300, 48, 'center']);
  const heading = paints.find(([, value]) => value === 'Best 50');
  assert.deepEqual(heading.slice(2, 6), [820, 194, 390, 66]);
  assert.equal(heading[6], '#243348');
  assert.equal(heading[7], 'center');
  assert.ok(brands[0][2] < heading[3] - heading[5], 'Wordmark sits above Best 50');
  const region = paints.find(([, value]) => value === 'Japan');
  assert.deepEqual(region.slice(2, 6), [820, 238, 330, 20]);
  assert.equal(region[7], 'center');
  paints.length = 0;
  await draw({}, { ...model, coverage: 'complete' }, { translate: (key) => key });
  assert.ok(
    paints.every(
      ([, value]) =>
        value !== model.version.label && value !== 'Rating total' && value !== 'Rating estimate',
    ),
  );
  assert.ok(!paints.some(([, , , y]) => y === 238), 'No empty regional caption is painted');
  assert.match(attributes['aria-label'], /Rating total 0/);
});

test('canvas branding retains the actual site wordmark colors and type treatment', () => {
  const source = readFileSync(
    new URL('../src/views/score-export-canvas.ts', import.meta.url),
    'utf8',
  );
  const css = readFileSync(
    new URL('../../src/maimai_intelligence/assets/site-brand.css', import.meta.url),
    'utf8',
  );
  const paints = [];
  let offset = 0,
    scale = 1;
  const ctx = {
    save() {},
    restore() {},
    translate(x) {
      offset = x;
    },
    scale(x) {
      scale = x;
    },
    measureText(value) {
      return value === 'm'
        ? { width: 34, actualBoundingBoxLeft: -4, actualBoundingBoxRight: 31 }
        : { width: 24, actualBoundingBoxLeft: 3, actualBoundingBoxRight: 28 };
    },
    fillText(value, x) {
      const bounds = this.measureText(value);
      paints.push({
        value,
        color: this.fillStyle,
        font: this.font,
        left: offset + (x - bounds.actualBoundingBoxLeft) * scale,
        right: offset + (x + bounds.actualBoundingBoxRight) * scale,
      });
    },
  };
  const draw = runInNewContext(
    '(' +
      stripTypeScriptTypes(
        source.slice(
          source.indexOf('function siteBrand('),
          source.indexOf('function achievement('),
        ),
      ) +
      ')',
  );
  draw(ctx, 0, 0, 326, 52);
  assert.equal(paints.map((p) => p.value).join(''), 'maimai.party');
  for (const paint of paints) assert.match(paint.font, /italic 850 52px system-ui/);
  for (const paint of paints.slice(0, 7)) assert.equal(paint.color, '#007887');
  for (const [index, name] of ['red', 'orange', 'yellow', 'green', 'blue'].entries())
    assert.equal(
      paints[index + 7].color,
      new RegExp('\\.party-' + name + '\\{color:(#[a-f0-9]+)\\}').exec(css)[1],
    );
  assert.equal(Math.min(...paints.map((paint) => paint.left)), 0, 'Default stays left anchored');
  for (const width of [326, 72]) {
    paints.length = 0;
    draw(ctx, 830, 154, width, 52, 'center');
    const left = Math.min(...paints.map((paint) => paint.left));
    const right = Math.max(...paints.map((paint) => paint.right));
    assert.ok(Math.abs((left + right) / 2 - 830) < 1e-9, 'Actual glyph ink is centered');
    assert.ok(right - left <= width + 1e-9, 'Centered wordmark stays within its allocated width');
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
