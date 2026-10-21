import type { PlayerChart, PlayerRecord } from '../domain/player-data';
import {
  gradeForAchievement,
  lampLabel,
  syncLabel,
  type Best50Export,
  type ExportEntry,
} from '../domain/score-export';
import type { AchievementExport, ExportCanvasOptions } from './score-export-canvas';
import { achievementPalette, ratingTier } from './score-export-style';
import { DiagnosticError } from '../runtime/diagnostic-error';

/** Presentation only. The caller owns validation, grouping, rating calculations and asset loading. */
type Images = ReadonlyMap<string, HTMLImageElement>;
type Context = CanvasRenderingContext2D;
type Translate = ExportCanvasOptions['translate'];
const family = '"Segoe UI", "Noto Sans", "Yu Gothic", "Malgun Gothic", Arial, sans-serif';
const background = '#100c19';
const white = '#fbf9ff';
const muted = '#c4b7d7';
const lime = '#e2fc8b';
const gold = '#ffe397';

function context(canvas: HTMLCanvasElement): Context {
  try {
    const ctx = canvas.getContext('2d');
    if (ctx) return ctx;
  } catch {
    // Keep the existing finite diagnostic code for blocked canvas contexts.
  }
  throw new DiagnosticError(
    'Image export is unavailable in this browser.',
    'canvas_context',
    'canvas',
  );
}

function surface(document: Document, width: number, height: number, description: string) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', description);
  canvas.textContent = description;
  const ctx = context(canvas);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  const glow = ctx.createRadialGradient(width * 0.3, 0, 0, width * 0.3, 0, width * 0.95);
  glow.addColorStop(0, '#48326c55');
  glow.addColorStop(1, '#48326c00');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  return { canvas, ctx };
}

function setFont(ctx: Context, size: number, weight = 800, italic = false) {
  ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${family}`;
}

/** Shrink only within a bounded range, then clip/ellipsize on Unicode code-point boundaries. */
function label(
  ctx: Context,
  value: string,
  x: number,
  baseline: number,
  width: number,
  size: number,
  fill: string | CanvasGradient = white,
  align: CanvasTextAlign = 'left',
  weight = 800,
  italic = false,
) {
  ctx.save();
  const left = align === 'right' ? x - width : align === 'center' ? x - width / 2 : x;
  ctx.beginPath();
  ctx.rect(left, baseline - size * 1.3, width, size * 1.65);
  ctx.clip();
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = fill;
  const minimum = size * 0.72;
  setFont(ctx, size, weight, italic);
  while (size > minimum && ctx.measureText(value).width > width) {
    size -= 1;
    setFont(ctx, size, weight, italic);
  }
  if (ctx.measureText(value).width > width) {
    const characters = Array.from(value);
    while (characters.length && ctx.measureText(characters.join('') + '…').width > width)
      characters.pop();
    value = characters.join('') + '…';
  }
  ctx.fillText(value, x, baseline);
  ctx.restore();
}

function lines(ctx: Context, value: string, width: number, size: number, weight = 750): string[] {
  setFont(ctx, size, weight);
  const result: string[] = [];
  let line = '';
  // Character wrapping also handles CJK text and unbroken imported identifiers.
  for (const character of Array.from(value)) {
    if (character === '\n' || (line && ctx.measureText(line + character).width > width)) {
      result.push(line.trim());
      line = character === '\n' ? '' : character;
    } else line += character;
  }
  if (line || !result.length) result.push(line.trim());
  return result;
}

function wrappedLabel(
  ctx: Context,
  value: string,
  x: number,
  top: number,
  width: number,
  size: number,
  maxLines: number,
  fill = white,
  weight = 750,
  italic = false,
) {
  const wrapped = lines(ctx, value, width, size, weight);
  wrapped.slice(0, maxLines).forEach((line, index) => {
    if (index === maxLines - 1 && wrapped.length > maxLines) line += '…';
    label(
      ctx,
      line,
      x,
      top + size + index * size * 1.15,
      width,
      size,
      fill,
      'left',
      weight,
      italic,
    );
  });
}

function box(
  ctx: Context,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string | CanvasGradient,
  radius = 8,
  border?: string,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  if (border) {
    ctx.strokeStyle = border;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function rule(ctx: Context, x: number, y: number, width: number) {
  ctx.fillStyle = '#8a6fac66';
  ctx.fillRect(x, y, width, 2);
}

function fit(
  ctx: Context,
  image: HTMLImageElement | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  if (!image || !image.naturalWidth || !image.naturalHeight) return false;
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const w = image.naturalWidth * scale,
    h = image.naturalHeight * scale;
  ctx.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h);
  return true;
}

function cover(
  ctx: Context,
  image: HTMLImageElement | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  if (!image || !image.naturalWidth || !image.naturalHeight) {
    const fallback = ctx.createLinearGradient(x, y, x + width, y + height);
    fallback.addColorStop(0, '#49345e');
    fallback.addColorStop(1, '#152c3e');
    ctx.fillStyle = fallback;
    ctx.fillRect(x, y, width, height);
    return;
  }
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const sourceWidth = width / scale,
    sourceHeight = height / scale;
  ctx.drawImage(
    image,
    (image.naturalWidth - sourceWidth) / 2,
    (image.naturalHeight - sourceHeight) / 2,
    sourceWidth,
    sourceHeight,
    x,
    y,
    width,
    height,
  );
}

/** Exact site colors, with a positive INK gap on both sides of the domain separator. */
function brand(
  ctx: Context,
  x: number,
  baseline: number,
  maximumWidth: number,
  size: number,
  align: 'left' | 'center' = 'left',
) {
  ctx.save();
  ctx.font = `italic 850 ${size}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const parts: { value: string; x: number; color: string }[] = [];
  let inkRight = 0;
  for (const [index, value] of ['maimai', '.', 'p', 'a', 'r', 't', 'y'].entries()) {
    const bounds = ctx.measureText(value);
    const gap = index === 1 || index === 2 ? size * 0.12 : index ? -size * 0.025 : 0;
    const position = inkRight + gap + bounds.actualBoundingBoxLeft;
    parts.push({
      value,
      x: position,
      color:
        index < 2 ? '#007887' : ['#ed5053', '#f39835', '#f2c62e', '#8aba3d', '#27a9e0'][index - 2],
    });
    inkRight = position + bounds.actualBoundingBoxRight;
  }
  const scale = Math.min(1, maximumWidth / inkRight);
  ctx.translate(align === 'center' ? x - (inkRight * scale) / 2 : x, baseline);
  ctx.scale(scale, scale);
  for (const part of parts) {
    ctx.fillStyle = part.color;
    ctx.fillText(part.value, part.x, 0);
  }
  ctx.restore();
}

/** Keep localized native text, with a restrained arcade bevel and violet depth. */
function best50Title(ctx: Context, value: string) {
  ctx.save();
  // The offset layer gives the title a crisp edge without changing glyph shapes.
  label(ctx, value, 592, 209, 800, 112, '#725994', 'left', 900, true);
  const face = ctx.createLinearGradient(0, 96, 0, 209);
  face.addColorStop(0, '#ffffff');
  face.addColorStop(0.48, '#f7efff');
  face.addColorStop(1, '#c5afe9');
  ctx.shadowColor = '#0a0612';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;
  label(ctx, value, 592, 203, 800, 112, face, 'left', 900, true);
  ctx.restore();
}

function playerBadge(
  ctx: Context,
  images: Images,
  name: string,
  rating: number | null,
  x: number,
  y: number,
  width: number,
  t: Translate,
) {
  const nameHeight = width * 0.0933;
  if (!fit(ctx, images.get('art:nameplate'), x, y, width, nameHeight))
    box(ctx, x, y, width, nameHeight, '#f6f5fa', nameHeight / 2);
  label(
    ctx,
    name || t('Player'),
    x + width / 2,
    y + nameHeight * 0.72,
    width - 42,
    nameHeight * 0.55,
    '#1d2841',
    'center',
    900,
  );
  const frameY = y + nameHeight + 4,
    height = (width * 86) / 296;
  if (rating === null) {
    box(ctx, x, frameY, width, height, '#211b2e', 16, '#66577a');
    label(
      ctx,
      t('Rating total'),
      x + 18,
      frameY + height * 0.38,
      width * 0.67,
      width * 0.043,
      muted,
    );
    label(
      ctx,
      '—',
      x + width - 25,
      frameY + height * 0.8,
      width - 50,
      width * 0.14,
      muted,
      'right',
      900,
    );
    return;
  }
  if (
    rating > 99999 ||
    !fit(ctx, images.get('art:rating:' + ratingTier(rating)), x, frameY, width, height)
  ) {
    box(ctx, x, frameY, width, height, '#211b2e', 16, '#66577a');
    label(ctx, t('Rating total'), x + 18, frameY + height * 0.33, width - 36, width * 0.043, muted);
    label(
      ctx,
      String(rating),
      x + width - 18,
      frameY + height * 0.82,
      width - 36,
      width * 0.13,
      gold,
      'right',
      900,
    );
    return;
  }
  ctx.save();
  ctx.font = `900 ${width * 0.125}px "Arial Black", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const bounds = ctx.measureText('0123456789');
  const baseline =
    frameY +
    (height * 45) / 86 +
    (bounds.actualBoundingBoxAscent - bounds.actualBoundingBoxDescent) / 2;
  ctx.fillStyle = '#ffe352';
  ctx.shadowColor = '#291800';
  ctx.shadowBlur = 2;
  ctx.shadowOffsetY = 2;
  for (const [index, digit] of String(rating).padStart(5, ' ').split('').entries()) {
    if (digit === ' ') continue;
    const glyph = ctx.measureText(digit);
    ctx.fillText(
      digit,
      x +
        width * 0.4155 +
        width * 0.1069 * (index + 0.5) +
        (glyph.actualBoundingBoxLeft - glyph.actualBoundingBoxRight) / 2,
      baseline,
    );
  }
  ctx.restore();
}

function difficulty(chart: PlayerChart) {
  const key = chart.difficulty
    .toLowerCase()
    .replace(/^dx\s*/, '')
    .replace(/[^a-z]/g, '');
  const colors: Record<string, string> = {
    basic: '#2b9c63',
    advanced: '#e69719',
    expert: '#d83057',
    master: '#7b2cbe',
    remaster: '#f5e9ff',
    utage: '#c847a9',
  };
  return {
    color: colors[key] || '#458eab',
    ink: key === 'remaster' ? '#7738aa' : white,
    name: key === 'remaster' ? 'RE:MASTER' : chart.difficulty.toUpperCase(),
  };
}

function difficultyBar(
  ctx: Context,
  chart: PlayerChart,
  record: PlayerRecord,
  x: number,
  y: number,
  width: number,
  height: number,
  t: Translate,
) {
  const style = difficulty(chart);
  box(ctx, x, y, width, height, style.color, 4);
  label(
    ctx,
    t(style.name),
    x + 14,
    y + height * 0.65,
    width * 0.56,
    height * 0.37,
    style.ink,
    'left',
    900,
  );
  const constant = record.constant === null ? '—' : (record.constant / 10).toFixed(1);
  label(
    ctx,
    constant,
    x + width - 12,
    y + height * 0.76,
    width * 0.28,
    height * 0.65,
    style.ink,
    'right',
    900,
  );
  label(
    ctx,
    t('CC'),
    x + width * 0.68,
    y + height * 0.7,
    width * 0.12,
    height * 0.27,
    style.ink,
    'right',
    800,
  );
}

function achievementColor(value: number | null) {
  if (value === null) return muted;
  return { gold, red: '#ff8794', blue: '#8bc6ff' }[achievementPalette(value)];
}

function percentage(
  ctx: Context,
  value: number | null,
  x: number,
  baseline: number,
  width: number,
  size: number,
) {
  if (value === null) {
    label(ctx, '—', x, baseline, width, size, muted, 'left', 900);
    return;
  }
  const number = (value / 10000).toFixed(4),
    color = achievementColor(value);
  ctx.save();
  setFont(ctx, size, 900);
  let numberWidth = ctx.measureText(number).width;
  while (numberWidth + size * 0.65 > width) {
    size -= 1;
    setFont(ctx, size, 900);
    numberWidth = ctx.measureText(number).width;
  }
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(number, x, baseline);
  setFont(ctx, size * 0.49, 900);
  ctx.fillText('%', x + numberWidth + size * 0.035, baseline);
  ctx.restore();
}

function grade(
  ctx: Context,
  value: number | null,
  x: number,
  baseline: number,
  width: number,
  size: number,
  align: CanvasTextAlign = 'left',
) {
  const name = gradeForAchievement(value) || '—';
  let fill: string | CanvasGradient = achievementColor(value);
  if (name.startsWith('SSS')) {
    const left = align === 'right' ? x - width : x;
    const gradient = ctx.createLinearGradient(left, baseline - size, left + width, baseline);
    [
      [0, '#fff1ab'],
      [0.3, '#b4f4e6'],
      [0.52, '#b5d9ff'],
      [0.75, '#e2c1ff'],
      [1, '#ffb1d1'],
    ].forEach(([stop, color]) => gradient.addColorStop(Number(stop), String(color)));
    fill = gradient;
  }
  label(ctx, name, x, baseline, width, size, fill, align, 900, true);
}

function badge(ctx: Context, images: Images, value: string, x: number, y: number, size: number) {
  if (!value) return false;
  const key = value.toLowerCase().replace(/^fsd/, 'fdx');
  const baseKey = key.replace('+', '');
  const base = images.get('art:result:' + baseKey + '_base');
  const symbol = images.get('art:result:' + key);
  if (base && symbol) {
    fit(ctx, base, x, y, size, size);
    fit(
      ctx,
      symbol,
      x + (size * 7) / 128,
      y + (size * 34) / 128,
      (size * 114) / 128,
      (size * 67) / 128,
    );
    return true;
  }
  // Existing official compact assets, never a newly drawn approximation of the emblem.
  if (fit(ctx, images.get('art:badge:' + key), x, y, size, size)) return true;
  label(ctx, value, x + size / 2, y + size * 0.62, size, size * 0.3, muted, 'center', 900);
  return false;
}

function recordDescription(entry: ExportEntry, t: Translate) {
  const { chart, record } = entry;
  return [
    chart.title,
    chart.difficulty,
    chart.format,
    t('Chart constant') +
      ' ' +
      (record.constant === null ? '—' : (record.constant / 10).toFixed(1)),
    t('Achievement') +
      ' ' +
      (record.achievement === null ? '—' : (record.achievement / 10000).toFixed(4) + '%'),
    gradeForAchievement(record.achievement),
    t('Chart rating') + ' ' + entry.rating,
    lampLabel(record.lamp),
    syncLabel(record.sync),
  ]
    .filter(Boolean)
    .join(' · ');
}

function card(
  ctx: Context,
  entry: ExportEntry | undefined,
  rank: number,
  x: number,
  y: number,
  width: number,
  images: Images,
  t: Translate,
) {
  const height = 440;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 8);
  ctx.clip();
  box(ctx, x, y, width, height, '#0e0917', 8);
  if (!entry) {
    label(
      ctx,
      String(rank).padStart(2, '0'),
      x + width / 2,
      y + 206,
      width - 32,
      64,
      '#665376',
      'center',
      900,
    );
    wrappedLabel(ctx, t('No eligible record'), x + 24, y + 235, width - 48, 23, 3, muted);
    ctx.restore();
    return;
  }
  const { chart, record } = entry;
  cover(ctx, images.get('jacket:' + chart.chartID), x, y, width, height);
  const shade = ctx.createLinearGradient(x, y, x, y + height);
  [
    [0, '#100b1a00'],
    [0.36, '#100b1a25'],
    [0.68, '#100b1aed'],
    [0.86, '#100b1afc'],
    [1, '#100b1a'],
  ].forEach(([stop, color]) => shade.addColorStop(Number(stop), String(color)));
  ctx.fillStyle = shade;
  ctx.fillRect(x, y, width, height);
  difficultyBar(ctx, chart, record, x + 14, y + 14, width - 28, 50, t);
  box(ctx, x + 16, y + 76, 54, 32, '#100b1ace', 4);
  label(ctx, String(rank).padStart(2, '0'), x + 43, y + 100, 42, 22, white, 'center', 900);
  const format = [chart.format.toUpperCase(), chart.level].filter(Boolean).join(' · ');
  box(ctx, x + width - 128, y + 76, 112, 32, '#f8f3ff', 4);
  label(ctx, format || '—', x + width - 72, y + 98, 100, 17, '#30233c', 'center', 900);
  wrappedLabel(ctx, chart.title, x + 16, y + 260, width - 32, 23, 2);
  percentage(ctx, record.achievement, x + 16, y + 345, width - 121, 40);
  grade(ctx, record.achievement, x + width - 16, y + 344, 92, 39, 'right');
  const chips = [lampLabel(record.lamp), syncLabel(record.sync)].filter(Boolean);
  if (chips.length)
    chips.forEach((value, index) => badge(ctx, images, value, x + 16 + index * 62, y + 372, 58));
  else label(ctx, '—', x + 16, y + 415, 100, 21, muted);
  label(ctx, String(entry.rating), x + width - 16, y + 409, width - 158, 65, lime, 'right', 900);
  label(
    ctx,
    t('Chart rating').toUpperCase(),
    x + width - 16,
    y + 430,
    width - 158,
    14,
    lime,
    'right',
    800,
  );
  ctx.restore();
  ctx.strokeStyle = '#b990dc35';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 8);
  ctx.stroke();
}

function section(
  ctx: Context,
  entries: readonly ExportEntry[],
  capacity: number,
  total: number,
  version: string,
  isNew: boolean,
  y: number,
  images: Images,
  t: Translate,
) {
  const x = 48,
    width = 1904,
    padding = 24,
    gap = 20;
  const rows = Math.ceil(capacity / 5),
    gridHeight = rows * 440 + (rows - 1) * gap;
  const height = 140 + gridHeight + padding;
  const accent = isNew ? '#75e8d4' : '#c28bff';
  const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
  gradient.addColorStop(0, isNew ? '#17433c55' : '#2b1b3b99');
  gradient.addColorStop(1, isNew ? '#101b2288' : '#17101f88');
  box(ctx, x, y, width, height, gradient, 8, isNew ? '#367569' : '#65427d');
  ctx.fillStyle = accent;
  ctx.fillRect(x + 1, y, width - 2, 8);
  label(ctx, String(capacity), x + 24, y + 103, 112, 78, accent, 'left', 900, true);
  const title = t(isNew ? 'New charts · Best 15' : 'Older charts · Best 35');
  label(ctx, title, x + 146, y + 66, 1300, 43, white, 'left', 900);
  const subtitle = [
    isNew ? version : '',
    entries.length < capacity ? t('{0} / {1} charts', [entries.length, capacity]) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  if (subtitle) label(ctx, subtitle, x + 146, y + 108, 1300, 22, accent);
  label(ctx, total.toLocaleString('en-US'), x + width - 24, y + 66, 310, 48, accent, 'right', 900);
  label(ctx, t('Chart rating').toUpperCase(), x + width - 24, y + 104, 310, 19, muted, 'right');
  const cardWidth = (width - padding * 2 - gap * 4) / 5;
  for (let i = 0; i < capacity; i++)
    card(
      ctx,
      entries[i],
      i + 1,
      x + padding + (i % 5) * (cardWidth + gap),
      y + 140 + Math.floor(i / 5) * 460,
      cardWidth,
      images,
      t,
    );
  return y + height;
}

/** Synchronous native-canvas painter; no data, identifiers or URLs leave the browser. */
export function paintAfterglowBest50(
  document: Document,
  model: Best50Export,
  images: Images,
  options: ExportCanvasOptions,
): HTMLCanvasElement {
  const t = options.translate;
  const name = model.player.displayName || model.player.username || t('Player');
  const versionLabel =
    model.version.source === 'provider' ? t(model.version.label) : model.version.label;
  const notices = [
    model.coverage === 'partial' ? t('Partial report') : '',
    model.excluded.total ? t('{0} excluded records', [model.excluded.total]) : '',
    ...model.warnings.map((warning) => t(warning)),
  ].filter(Boolean);
  const description = [
    t('Best 50'),
    name,
    versionLabel,
    t(model.coverage === 'partial' ? 'Rating estimate' : 'Rating total') + ' ' + model.totalRating,
    ...notices,
    ...[...model.old, ...model.new].map((entry) => recordDescription(entry, t)),
  ].join(' · ');
  // The routine provenance sentence is accessible metadata, not a mock/editorial footer.
  // Actual limitations stay on the image, since a downloaded PNG has no DOM accessibility tree.
  const visibleNotices = [
    model.coverage === 'partial' ? t('Partial report') : '',
    model.excluded.total ? t('{0} excluded records', [model.excluded.total]) : '',
    ...model.warnings
      .filter((warning) => warning !== 'Ratings and constants come from the imported record.')
      .map((warning) => t(warning)),
  ].filter(Boolean);
  const measuring = context(document.createElement('canvas'));
  const noticeLines = visibleNotices.flatMap((notice) => lines(measuring, notice, 1856, 22));
  const noticeHeight = noticeLines.length ? 26 + noticeLines.length * 30 : 0;
  const { canvas, ctx } = surface(document, 2000, 5380 + noticeHeight, description);
  playerBadge(ctx, images, name, model.totalRating, 48, 52, 480, t);
  best50Title(ctx, t('Best 50'));
  if (options.regionLabel) label(ctx, options.regionLabel, 592, 252, 790, 22, muted);
  brand(ctx, 1756, 102, 322, 52, 'center');
  if (!fit(ctx, images.get('art:version'), 1560, 126, 392, 154))
    wrappedLabel(ctx, versionLabel, 1560, 157, 392, 28, 3, white, 800);
  rule(ctx, 48, 299, 1904);
  if (noticeLines.length) {
    box(ctx, 48, 318, 1904, noticeHeight - 8, '#2c2133', 8, '#8e6c63');
    noticeLines.forEach((line, index) =>
      label(ctx, line, 72, 347 + index * 30, 1856, 22, '#ffe2b4', 'left', 650),
    );
  }
  const oldEnd = section(
    ctx,
    model.old,
    35,
    model.oldTotal,
    versionLabel,
    false,
    344 + noticeHeight,
    images,
    t,
  );
  section(ctx, model.new, 15, model.newTotal, versionLabel, true, oldEnd + 60, images, t);
  return canvas;
}

function awardName(value: string, t: Translate) {
  const keys: Record<string, string> = {
    FC: 'Full Combo',
    'FC+': 'Full Combo+',
    AP: 'All Perfect',
    'AP+': 'All Perfect+',
    FS: 'Full Sync',
    'FS+': 'Full Sync+',
    FSD: 'Full Sync DX',
    'FSD+': 'Full Sync DX+',
    SYNC: 'Sync Play',
  };
  return value ? t(keys[value] || value) : '—';
}

function observedDetails(input: AchievementExport, t: Translate): [string, string][] {
  const { record } = input;
  const rows: [string, string][] = [];
  if (input.recordKind === 'play') {
    const values: [string, number | null][] = [
      ['Critical perfect', record.pcrit],
      ['Perfect', record.perfect],
      ['Great', record.great],
      ['Good', record.good],
      ['Miss', record.miss],
      ['Max combo', record.maxCombo],
      ['Fast', record.fast],
      ['Late', record.slow],
    ];
    for (const [key, value] of values) if (value !== null) rows.push([t(key), String(value)]);
    if (record.timeAchieved !== null && Number.isFinite(record.timeAchieved)) {
      const date = new Date(record.timeAchieved);
      if (Number.isFinite(date.getTime())) rows.push([t('Played {0}', [date.toISOString()]), '']);
    }
  }
  if (record.dxScore !== null)
    rows.push([
      t('DX score'),
      String(record.dxScore) + (record.maxDxScore === null ? '' : ' / ' + record.maxDxScore),
    ]);
  return rows;
}

/** No game-version logo: a song observation is independent of the selected Best 50 release. */
export function paintAfterglowAchievement(
  document: Document,
  input: AchievementExport,
  images: Images,
  options: ExportCanvasOptions,
): HTMLCanvasElement {
  const t = options.translate,
    { chart, record } = input;
  const playerRating =
    input.playerRating &&
    Number.isSafeInteger(input.playerRating.value) &&
    input.playerRating.value >= 0
      ? input.playerRating
      : null;
  const ratingCaption = playerRating
    ? t(
        playerRating.source === 'maishift'
          ? 'Current imported rating'
          : 'Current reconstructed rating',
      )
    : '';
  const details = observedDetails(input, t);
  const detailRows = Math.ceil(details.length / 2);
  const extraHeight = detailRows ? 54 + detailRows * 56 : 0;
  const description = [
    input.playerName || t('Player'),
    chart.title,
    chart.artist,
    chart.difficulty,
    chart.format,
    chart.level,
    t('Chart constant') +
      ' ' +
      (record.constant === null ? '—' : (record.constant / 10).toFixed(1)),
    t('Achievement') +
      ' ' +
      (record.achievement === null ? '—' : (record.achievement / 10000).toFixed(4) + '%'),
    gradeForAchievement(record.achievement),
    t('Chart rating') + ' ' + (record.rate ?? '—'),
    lampLabel(record.lamp),
    syncLabel(record.sync),
    playerRating ? ratingCaption + ' ' + playerRating.value : '',
    input.recordKind === 'pb' ? t('Personal-best values may come from different plays.') : '',
    ...details.map(([key, value]) => key + ' ' + value),
  ]
    .filter(Boolean)
    .join(' · ');
  const { canvas, ctx } = surface(document, 1200, 1200 + extraHeight, description);
  const image = images.get('jacket:' + chart.chartID);
  ctx.save();
  ctx.globalAlpha = 0.38;
  cover(ctx, image, 0, 0, 1200, 1200);
  ctx.restore();
  const horizontal = ctx.createLinearGradient(0, 0, 1200, 0);
  horizontal.addColorStop(0, '#100c1720');
  horizontal.addColorStop(0.74, '#100c17ee');
  horizontal.addColorStop(1, '#100c17ee');
  ctx.fillStyle = horizontal;
  ctx.fillRect(0, 0, 1200, 1200);
  const vertical = ctx.createLinearGradient(0, 0, 0, 1200);
  [
    [0, '#100c17ee'],
    [0.32, '#100c1730'],
    [0.93, '#100c17'],
    [1, '#100c17'],
  ].forEach(([stop, color]) => vertical.addColorStop(Number(stop), String(color)));
  ctx.fillStyle = vertical;
  ctx.fillRect(0, 0, 1200, 1200);
  playerBadge(ctx, images, input.playerName, playerRating?.value ?? null, 48, 44, 404, t);
  brand(ctx, 800, 146, 352, 54);
  if (ratingCaption) label(ctx, ratingCaption, 48, 218, 650, 16, muted, 'left', 650);
  label(
    ctx,
    t(input.recordKind === 'pb' ? 'Personal best' : 'Result').toUpperCase(),
    48,
    255,
    760,
    23,
    muted,
    'left',
    900,
  );
  label(
    ctx,
    [chart.format.toUpperCase(), chart.level].filter(Boolean).join(' · ') || '—',
    1152,
    255,
    315,
    25,
    muted,
    'right',
    900,
  );
  rule(ctx, 48, 285, 1104);
  cover(ctx, image, 48, 364, 552, 552);
  const fade = ctx.createLinearGradient(462, 0, 600, 0);
  fade.addColorStop(0, '#100c1900');
  fade.addColorStop(1, background);
  ctx.fillStyle = fade;
  ctx.fillRect(462, 364, 138, 552);
  difficultyBar(ctx, chart, record, 640, 334, 512, 70, t);
  const titleLines = lines(ctx, chart.title, 512, 61, 900);
  // Two reserved title lines prevent long titles from shifting achievement or rating fields.
  wrappedLabel(
    ctx,
    chart.title,
    640,
    420,
    512,
    titleLines.length > 1 ? 43 : 61,
    2,
    white,
    900,
    true,
  );
  label(ctx, chart.artist, 640, 540, 512, 25, muted, 'left', 500);
  label(ctx, t('Achievement').toUpperCase(), 640, 588, 512, 24, muted, 'left', 900);
  percentage(ctx, record.achievement, 640, 680, 512, 80);
  grade(ctx, record.achievement, 640, 809, 512, 118);
  box(ctx, 640, 840, 512, 108, lime, 12);
  wrappedLabel(ctx, t('Chart rating').toUpperCase(), 661, 869, 225, 22, 2, '#24291a', 900, true);
  label(
    ctx,
    record.rate === null ? '—' : String(record.rate),
    1130,
    925,
    235,
    86,
    '#24291a',
    'right',
    900,
    true,
  );
  rule(ctx, 48, 1005, 1104);
  const lamps = [lampLabel(record.lamp), syncLabel(record.sync)];
  lamps.forEach((value, index) => {
    const x = index ? 622 : 48;
    if (value) badge(ctx, images, value, x, 1030, 96);
    else label(ctx, '—', x + 48, 1094, 96, 42, muted, 'center', 900);
    label(ctx, awardName(value, t), x + 118, 1067, index ? 412 : 432, 28, white, 'left', 900);
    label(
      ctx,
      t(index ? 'Sync achievement' : 'Combo achievement').toUpperCase(),
      x + 118,
      1108,
      index ? 412 : 432,
      18,
      muted,
      'left',
      500,
    );
  });
  rule(ctx, 48, 1147, 1104);
  if (details.length) {
    details.forEach(([key, value], index) => {
      const x = 48 + (index % 2) * 574,
        y = 1218 + Math.floor(index / 2) * 56;
      box(ctx, x, y, 530, 46, '#241c31', 6);
      label(ctx, key, x + 14, y + 31, value ? 300 : 502, 21, muted, 'left', 650);
      if (value) label(ctx, value, x + 516, y + 32, 185, 23, white, 'right', 900);
    });
  }
  return canvas;
}
