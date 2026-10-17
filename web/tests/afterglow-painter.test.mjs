import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { gradeForAchievement, lampLabel, syncLabel } from '../src/domain/score-export.ts';
import { achievementPalette, ratingTier } from '../src/views/score-export-style.ts';
import { DiagnosticError, diagnosticError } from '../src/runtime/diagnostic-error.ts';

const source = readFileSync(new URL('../src/views/afterglow-painter.ts', import.meta.url), 'utf8');
const painter = runInNewContext(
  stripTypeScriptTypes(source)
    .replace(/^import[\s\S]*?;\s*/gm, '')
    .replace(/^export /gm, '') +
    '\n({ paintAfterglowBest50, paintAfterglowAchievement, playerBadge, brand, card, grade, percentage })',
  { gradeForAchievement, lampLabel, syncLabel, achievementPalette, ratingTier, DiagnosticError },
);
const t = (key, values = []) => key.replace(/\{(\d+)\}/g, (_, i) => String(values[i]));
const options = { translate: t };
const image = (key) => ({ key, naturalWidth: 400, naturalHeight: 400 });

function drawing() {
  const texts = [],
    images = [],
    shapes = [],
    states = [];
  const ctx = {
    font: '800 20px Arial',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    offsetX: 0,
    offsetY: 0,
    scaleX: 1,
    scaleY: 1,
    save() {
      states.push(
        Object.fromEntries(Object.entries(this).filter(([, v]) => typeof v !== 'function')),
      );
    },
    restore() {
      Object.assign(this, states.pop());
    },
    beginPath() {},
    clip() {},
    fill() {},
    stroke() {},
    rect(...args) {
      shapes.push({ type: 'clip', args });
    },
    roundRect(...args) {
      shapes.push({ type: 'round', args });
    },
    fillRect(...args) {
      shapes.push({ type: 'fill', args });
    },
    translate(x, y) {
      this.offsetX += x;
      this.offsetY += y;
    },
    scale(x, y) {
      this.scaleX *= x;
      this.scaleY *= y;
    },
    createLinearGradient() {
      return {
        stops: [],
        addColorStop(...args) {
          this.stops.push(args);
        },
      };
    },
    createRadialGradient() {
      return this.createLinearGradient();
    },
    measureText(value) {
      const size = Number(/([\d.]+)px/.exec(this.font)[1]);
      return {
        width: Array.from(value).length * size * 0.55,
        actualBoundingBoxLeft: size * (value === '1' ? 0.13 : 0.3),
        actualBoundingBoxRight:
          value.length === 1 ? size * (value === '1' ? 0.27 : 0.3) : value.length * size * 0.55,
        actualBoundingBoxAscent: size * 0.73,
        actualBoundingBoxDescent: size * 0.02,
      };
    },
    fillText(value, x, y) {
      assert.ok(Number.isFinite(x) && Number.isFinite(y));
      const bounds = this.measureText(value);
      texts.push({
        value,
        x,
        y,
        color: this.fillStyle,
        font: this.font,
        bounds,
        align: this.textAlign,
        baseline: this.textBaseline,
        left: this.offsetX + (x - bounds.actualBoundingBoxLeft) * this.scaleX,
        right: this.offsetX + (x + bounds.actualBoundingBoxRight) * this.scaleX,
      });
    },
    drawImage(...args) {
      images.push(args);
    },
  };
  return { ctx, texts, images, shapes };
}

function documentFixture() {
  const canvases = [];
  return {
    canvases,
    document: {
      createElement(name) {
        assert.equal(name, 'canvas');
        const draw = drawing(),
          attributes = {};
        const canvas = {
          ...draw,
          attributes,
          getContext: () => draw.ctx,
          setAttribute: (key, value) => {
            attributes[key] = value;
          },
        };
        canvases.push(canvas);
        return canvas;
      },
    },
  };
}

function achievement(record = {}, input = {}) {
  return {
    chart: {
      chartID: 'synthetic',
      title: 'Synthetic song',
      artist: 'Synthetic artist',
      format: 'DX',
      difficulty: 'MASTER',
      level: '14+',
      constant: 150,
    },
    record: {
      achievement: 1005000,
      grade: 'A',
      constant: 149,
      rate: 335,
      lamp: '',
      sync: '',
      pcrit: null,
      perfect: null,
      great: null,
      good: null,
      miss: null,
      maxCombo: null,
      fast: null,
      slow: null,
      timeAchieved: null,
      dxScore: null,
      maxDxScore: null,
      ...record,
    },
    playerName: 'Synthetic player',
    recordKind: 'pb',
    playerRating: null,
    ...input,
  };
}

function best50(overrides = {}) {
  return {
    old: [],
    new: [],
    oldTotal: 0,
    newTotal: 0,
    totalRating: 0,
    player: { displayName: 'Synthetic' },
    version: { label: 'PRiSM PLUS', logoVersion: 'PRiSM PLUS' },
    coverage: 'complete',
    excluded: { total: 0 },
    warnings: [],
    ...overrides,
  };
}

test('Afterglow rating digits stay centered within official frame windows', () => {
  for (const width of [224, 328, 540])
    for (const rating of [0, 1234, 14510, 98765]) {
      const draw = drawing(),
        x = 72,
        y = 129,
        frameY = y + width * 0.0933 + 4,
        height = (width * 86) / 296;
      draw.ctx.textAlign = 'right';
      draw.ctx.textBaseline = 'top';
      const images = new Map([
        ['art:nameplate', image('name')],
        ['art:rating:' + ratingTier(rating), image('rating')],
      ]);
      painter.playerBadge(draw.ctx, images, 'Synthetic', rating, x, y, width, t);
      const digits = draw.texts.filter(({ font }) => font.includes('Arial Black'));
      assert.equal(digits.map(({ value }) => value).join(''), String(rating));
      assert.equal(new Set(digits.map(({ y }) => y)).size, 1);
      for (const [index, digit] of digits.entries()) {
        const cellWidth = width * 0.1069,
          slot = 5 - digits.length + index,
          center = x + width * 0.4155 + cellWidth * (slot + 0.5),
          left = digit.x - digit.bounds.actualBoundingBoxLeft,
          right = digit.x + digit.bounds.actualBoundingBoxRight,
          top = digit.y - digit.bounds.actualBoundingBoxAscent,
          bottom = digit.y + digit.bounds.actualBoundingBoxDescent;
        assert.equal(digit.align, 'center');
        assert.equal(digit.baseline, 'alphabetic');
        assert.ok(Math.abs((left + right) / 2 - center) < 1e-8);
        assert.ok(left > center - cellWidth / 2 && right < center + cellWidth / 2);
        assert.ok(Math.abs((top + bottom) / 2 - (frameY + (height * 45) / 86)) < 1e-8);
        assert.ok(top > frameY + (height * 24) / 86 && bottom < frameY + (height * 66) / 86);
      }
      assert.equal(draw.ctx.textAlign, 'right');
      assert.equal(draw.ctx.textBaseline, 'top');
    }
});

test('rating fallback preserves missing, real zero and totals beyond five digits', () => {
  for (const rating of [null, 0, 15432, 100000]) {
    const draw = drawing();
    painter.playerBadge(draw.ctx, new Map(), 'Synthetic', rating, 48, 44, 404, t);
    assert.ok(draw.texts.some(({ value }) => value === (rating === null ? '—' : String(rating))));
    assert.ok(draw.texts.some(({ value }) => value === 'Rating total'));
    assert.equal(draw.images.length, 0);
    if (rating === null) assert.ok(!draw.texts.some(({ value }) => value === '0'));
  }
});

test('Afterglow wordmark keeps exact brand colors and positive ink gaps around its dot', () => {
  const css = readFileSync(
    new URL('../../src/maimai_intelligence/assets/site-brand.css', import.meta.url),
    'utf8',
  );
  for (const width of [322, 72]) {
    const draw = drawing();
    painter.brand(draw.ctx, 800, 146, width, 54);
    assert.equal(draw.texts.map(({ value }) => value).join(''), 'maimai.party');
    assert.ok(draw.texts.every(({ font }) => /italic 850 54px system-ui/.test(font)));
    for (const part of draw.texts.slice(0, 2)) assert.equal(part.color, '#007887');
    for (const [i, name] of ['red', 'orange', 'yellow', 'green', 'blue'].entries())
      assert.equal(
        draw.texts[i + 2].color,
        new RegExp('\\.party-' + name + '\\{color:(#[a-f0-9]+)\\}').exec(css)[1],
      );
    assert.ok(draw.texts[1].left > draw.texts[0].right, 'Visible gap before the dot');
    assert.ok(draw.texts[2].left > draw.texts[1].right, 'Visible gap after the dot');
    assert.equal(draw.texts[0].left, 800);
    assert.ok(draw.texts.at(-1).right <= 800 + width + 1e-8);
  }
});

test('Best50 cards keep imported precision and constants independent of catalog labels', () => {
  for (const constant of [149, null, 0])
    for (const format of ['DX', 'STD']) {
      const draw = drawing(),
        input = achievement({ constant });
      input.chart.format = format;
      input.chart.title = '長い曲名😀'.repeat(30);
      painter.card(
        draw.ctx,
        { ...input, rating: 321 },
        1,
        72,
        484,
        355.2,
        new Map([['jacket:synthetic', image('jacket')]]),
        t,
      );
      const values = draw.texts.map(({ value }) => value);
      assert.ok(values.includes(constant === null ? '—' : (constant / 10).toFixed(1)));
      assert.ok(
        !values.includes('15.0'),
        'Current catalog constant cannot replace observed constant',
      );
      assert.ok(values.includes(format + ' · 14+'));
      assert.ok(values.includes('100.5000'));
      assert.ok(values.includes('SSS+'), 'Grade comes from achievement, not imported grade A');
      assert.ok(values.includes('321'), 'Best50 uses the selected entry contribution');
      assert.ok(!values.includes('335'));
      assert.deepEqual(draw.images[0].slice(5), [72, 484, 355.2, 440]);
      const formatText = draw.texts.find(({ value }) => value === format + ' · 14+');
      assert.ok(
        draw.texts
          .filter(({ value }) => value.includes('長い'))
          .every(({ y }) => y > formatText.y + 100),
      );
    }
});

test('Best50 keeps all fifty bounded slots, separate pools and truthful warnings without an editorial footer', () => {
  const fixture = documentFixture(),
    provenance = 'Ratings and constants come from the imported record.',
    model = best50({
      coverage: 'partial',
      excluded: { total: 2 },
      warnings: [provenance, 'Imported observation warning'],
    });
  const canvas = painter.paintAfterglowBest50(
    fixture.document,
    model,
    new Map([['art:version', image('version')]]),
    { ...options, regionLabel: 'Japan' },
  );
  assert.equal(canvas.width, 2000);
  assert.ok(canvas.height > 5380);
  const values = canvas.texts.map(({ value }) => value);
  assert.equal(values.filter((value) => value === 'No eligible record').length, 50);
  for (const value of [
    'Older charts · Best 35',
    'New charts · Best 15',
    '0 / 35 charts',
    'Partial report',
    '2 excluded records',
    'Imported observation warning',
    'Japan',
  ])
    assert.ok(values.includes(value), value);
  assert.ok(values.some((value) => value.includes('0 / 15 charts')));
  assert.ok(!values.includes(provenance));
  assert.ok(!values.includes('35 / 15'));
  const cards = canvas.shapes.filter(({ type, args }) => type === 'round' && args[3] === 440);
  assert.equal(cards.length, 100, 'Each of50 slots has a clip and filled card');
  assert.equal(new Set(cards.map(({ args }) => args[0])).size, 5);
  for (const {
    args: [x, y, w, h],
  } of cards)
    assert.ok(x >= 0 && x + w <= canvas.width && y + h < canvas.height);
  assert.deepEqual(
    canvas.images.find(([img]) => img.key === 'version').slice(1),
    [1679, 126, 154, 154],
  );
  assert.match(canvas.attributes['aria-label'], /Rating estimate 0/);
  assert.match(
    canvas.attributes['aria-label'],
    /Ratings and constants come from the imported record/,
  );
  assert.match(canvas.attributes['aria-label'], /PRiSM PLUS/);
  const complete = painter.paintAfterglowBest50(
    documentFixture().document,
    best50(),
    new Map(),
    options,
  );
  assert.equal(complete.height, 5380);
  assert.match(complete.attributes['aria-label'], /Rating total 0/);
});

test('single-record painting separates unknown values, real zeros, profile rating and chart contribution', () => {
  for (const value of [null, 0]) {
    const input = achievement({ achievement: value, constant: value, rate: value });
    input.playerRating = value === null ? null : { value, source: 'maishift' };
    const canvas = painter.paintAfterglowAchievement(
      documentFixture().document,
      input,
      new Map(),
      options,
    );
    const values = canvas.texts.map(({ value }) => value);
    assert.equal(canvas.width, 1200);
    assert.equal(canvas.height, 1200);
    assert.ok(values.includes(value === null ? '—' : '0.0000'));
    assert.ok(values.includes(value === null ? '—' : '0.0'));
    assert.ok(!values.includes('15.0'));
    assert.match(
      canvas.attributes['aria-label'],
      value === null ? /Chart rating —/ : /Chart rating 0/,
    );
    assert.match(
      canvas.attributes['aria-label'],
      /Personal-best values may come from different plays/,
    );
    assert.ok(values.includes('PERSONAL BEST'));
    if (value === null) {
      assert.ok(!values.includes('0'));
      assert.doesNotMatch(canvas.attributes['aria-label'], /Current imported rating/);
    } else assert.match(canvas.attributes['aria-label'], /Current imported rating 0/);
  }
  const input = achievement(
    {},
    { playerRating: { value: 15432, source: 'reconstructed' }, versionLabel: 'PRiSM PLUS' },
  );
  const canvas = painter.paintAfterglowAchievement(
    documentFixture().document,
    input,
    new Map([
      ['art:version', image('version')],
      ['art:partner:shama', image('partner')],
    ]),
    options,
  );
  assert.match(canvas.attributes['aria-label'], /Chart rating 335/);
  assert.match(canvas.attributes['aria-label'], /Current reconstructed rating 15432/);
  assert.ok(canvas.texts.some(({ value }) => value === '15432'));
  assert.ok(!canvas.images.some(([img]) => ['version', 'partner'].includes(img.key)));
  assert.ok(!canvas.texts.some(({ value }) => value === 'PRiSM PLUS'));
});

test('dense and sparse recorded plays preserve observed detail including zero, without inventing PB judgments', () => {
  const record = {
    pcrit: 900,
    perfect: 33,
    great: 0,
    good: 0,
    miss: 0,
    maxCombo: 933,
    fast: 0,
    slow: 0,
    timeAchieved: 0,
    dxScore: 4567,
    maxDxScore: 5000,
  };
  for (const recordKind of ['play', 'pb']) {
    const canvas = painter.paintAfterglowAchievement(
      documentFixture().document,
      achievement(record, { recordKind }),
      new Map(),
      options,
    );
    const values = canvas.texts.map(({ value }) => value);
    assert.ok(values.includes('4567 / 5000'));
    for (const label of [
      'Critical perfect',
      'Perfect',
      'Great',
      'Good',
      'Miss',
      'Max combo',
      'Fast',
      'Late',
    ])
      assert.equal(values.includes(label), recordKind === 'play', label);
    assert.equal(values.includes('Played 1970-01-01T00:00:00.000Z'), recordKind === 'play');
    assert.equal(canvas.height, recordKind === 'play' ? 1534 : 1310);
    assert.ok(canvas.texts.every(({ y }) => y < canvas.height));
    if (recordKind === 'play') assert.ok(values.filter((v) => v === '0').length >= 5);
  }
  const canvas = painter.paintAfterglowAchievement(
    documentFixture().document,
    achievement({ fast: 0, dxScore: 0 }, { recordKind: 'play' }),
    new Map(),
    options,
  );
  assert.equal(canvas.height, 1310);
  assert.match(canvas.attributes['aria-label'], /Fast 0/);
  assert.match(canvas.attributes['aria-label'], /DX score 0/);
  assert.ok(!canvas.texts.some(({ value }) => value === 'Critical perfect'));
});

test('authentic combo and normalized DX sync artwork is used without fabricating awards', () => {
  const assets = new Map(['fc', 'fdx+'].map((key) => ['art:badge:' + key, image(key)]));
  const canvas = painter.paintAfterglowAchievement(
    documentFixture().document,
    achievement({ lamp: 'FC', sync: 'FSD+' }),
    assets,
    options,
  );
  assert.deepEqual(
    canvas.images.map(([img]) => img.key),
    ['fc', 'fdx+'],
  );
  assert.ok(canvas.texts.some(({ value }) => value === 'Full Combo'));
  assert.ok(canvas.texts.some(({ value }) => value === 'Full Sync DX+'));
  const unknown = painter.paintAfterglowAchievement(
    documentFixture().document,
    achievement(),
    assets,
    options,
  );
  assert.equal(unknown.images.length, 0);
});

test('percentage and grade colors share game boundaries while preserving exact digits', () => {
  for (const [value, color] of [
    [null, '#c4b7d7'],
    [0, '#8bc6ff'],
    [799999, '#8bc6ff'],
    [800000, '#ff8794'],
    [969999, '#ff8794'],
    [970000, '#ffe397'],
  ]) {
    const draw = drawing();
    painter.percentage(draw.ctx, value, 0, 100, 512, 80);
    painter.grade(draw.ctx, value, 0, 200, 512, 118);
    assert.equal(draw.texts[0].value, value === null ? '—' : (value / 10000).toFixed(4));
    assert.ok(draw.texts.every((text) => text.color === color));
  }
});

test('blocked canvas contexts retain the existing finite diagnostic boundary', () => {
  for (const failure of ['null', 'throw']) {
    const document = {
      createElement: () => ({
        setAttribute() {},
        getContext() {
          if (failure === 'throw') throw new Error('Private environment message');
          return null;
        },
      }),
    };
    for (const render of [
      () => painter.paintAfterglowBest50(document, best50(), new Map(), options),
      () => painter.paintAfterglowAchievement(document, achievement(), new Map(), options),
    ])
      assert.throws(render, (error) => {
        assert.deepEqual(diagnosticError(error), { reason: 'canvas_context', stage: 'canvas' });
        assert.doesNotMatch(error.message, /Private environment/);
        return true;
      });
  }
});
