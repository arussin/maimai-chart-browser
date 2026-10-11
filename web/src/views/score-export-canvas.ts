import type { PlayerChart, PlayerRecord } from '../domain/player-data';
import { achievementPalette, achievementSpriteLayout, ratingTier } from './score-export-style';
import { scoreExportPartners } from './score-export-partners';
import { loadScoreExportPartnerArtwork } from './score-export-partner-artwork';
import {
  gradeForAchievement,
  lampLabel,
  syncLabel,
  type Best50Export,
  type ExportEntry,
} from '../domain/score-export';

export interface ExportCanvasOptions {
  translate(key: string, values?: readonly (string | number)[]): string;
  /** A verified public-artwork projection, never a URL from an imported player file. */
  jacketURL(chart: PlayerChart): string | undefined;
  /** Only reviewed, packaged interface artwork; never a provider image URL. */
  artworkURL?(key: string): string | undefined;
  versionLogoURL?(version: string): string | undefined;
  regionLabel?: string;
}
export interface AchievementExport {
  chart: PlayerChart;
  record: PlayerRecord;
  playerName: string;
  recordKind: 'pb' | 'play';
  versionLabel?: string;
  regionLabel?: string;
  /** Explicit decorative artwork choice; never inferred from the retained record. */
  partnerKey?: string;
}

type Context = CanvasRenderingContext2D;
const fontFamily = '"Arial", "Noto Sans", "Yu Gothic", "Malgun Gothic", sans-serif';
const ink = '#243348';
const muted = '#667487';
const colors: Record<string, string> = {
  basic: '#2b9c63',
  advanced: '#b76b06',
  expert: '#dc385b',
  master: '#8456cf',
  remaster: '#a25dc9',
  utage: '#c847a9',
};
function difficulty(chart: PlayerChart) {
  return (
    colors[
      chart.difficulty
        .toLowerCase()
        .replace(/^dx\s*/, '')
        .replace(/[^a-z]/g, '')
    ] || '#458eab'
  );
}

function font(ctx: Context, size: number, weight = 700, family = fontFamily) {
  ctx.font = `${weight} ${size}px ${family}`;
}
function text(
  ctx: Context,
  value: string,
  x: number,
  y: number,
  width: number,
  size: number,
  color = ink,
  align: CanvasTextAlign = 'left',
  weight = 700,
  family = fontFamily,
  vertical: 'baseline' | 'center' = 'baseline',
) {
  // Explicit clipping protects every label, including unusually long imported Unicode names.
  ctx.save();
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  const left = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
  ctx.beginPath();
  ctx.rect(left, y - size * (vertical === 'center' ? 0.85 : 1.25), width, size * 1.7);
  ctx.clip();
  const minimum = Math.min(size, Math.max(13, size * 0.65));
  font(ctx, size, weight, family);
  while (ctx.measureText(value).width > width && size > minimum) {
    size -= 1;
    font(ctx, size, weight, family);
  }
  if (ctx.measureText(value).width > width) {
    const characters = Array.from(value);
    while (characters.length && ctx.measureText(characters.join('') + '…').width > width)
      characters.pop();
    value = characters.join('') + '…';
  }
  const bounds = ctx.measureText(value);
  const baseline =
    vertical === 'center'
      ? y + (bounds.actualBoundingBoxAscent - bounds.actualBoundingBoxDescent) / 2
      : y;
  ctx.fillText(value, x, baseline);
  ctx.restore();
}
function lines(
  ctx: Context,
  value: string,
  x: number,
  y: number,
  width: number,
  size: number,
  count: number,
  color = ink,
  weight = 700,
) {
  font(ctx, size, weight);
  const characters = Array.from(value);
  for (let row = 0; row < count && characters.length; row++) {
    if (row === count - 1) {
      text(ctx, characters.join(''), x, y + row * size * 1.28, width, size, color, 'left', weight);
      break;
    }
    let part = '';
    while (characters.length && ctx.measureText(part + characters[0]).width <= width)
      part += characters.shift();
    if (!part) part = characters.shift() || '';
    text(ctx, part, x, y + row * size * 1.28, width, size, color, 'left', weight);
  }
}
function box(
  ctx: Context,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  radius: number | number[] = 18,
) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fill();
}
function rule(ctx: Context, x: number, y: number, width: number, color = '#e1e7ed') {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width, 1);
}
function pill(
  ctx: Context,
  value: string,
  x: number,
  y: number,
  width: number,
  color: string,
  size = 17,
) {
  box(ctx, x, y, width, 31, color, 15);
  text(ctx, value, x + width / 2, y + 22, width - 18, size, '#fff', 'center');
}
function achievement(value: number | null) {
  return value === null ? '—' : (value / 10000).toFixed(4) + '%';
}
function date(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '';
  const stamp = new Date(value);
  return Number.isFinite(stamp.getTime()) ? stamp.toISOString().slice(0, 10) + ' UTC' : '';
}
function surface(document: Document, width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image export is unavailable in this browser.');
  return { canvas, ctx };
}
function jacket(
  ctx: Context,
  image: HTMLImageElement | undefined,
  x: number,
  y: number,
  size: number,
  color: string,
) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, Math.max(8, size / 16));
  ctx.clip();
  if (image) {
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    ctx.drawImage(
      image,
      (image.naturalWidth - side) / 2,
      (image.naturalHeight - side) / 2,
      side,
      side,
      x,
      y,
      size,
      size,
    );
  } else {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, size, size);
    ctx.globalAlpha = 0.18;
    for (let i = -1; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(x + size * 0.5, y + size * 0.5, size * (0.24 + i * 0.17), 0, Math.PI * 2);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = size * 0.045;
      if (i >= 0) ctx.stroke();
    }
    ctx.globalAlpha = 1;
    text(ctx, '♪', x + size / 2, y + size * 0.69, size * 0.8, size * 0.58, '#fff', 'center');
  }
  ctx.restore();
}

/** Six public images at a time; the entire image phase has a five-second budget. */
async function jackets(
  document: Document,
  charts: readonly PlayerChart[],
  options: ExportCanvasOptions,
  version: string,
  rating?: number,
  resultArtwork = false,
  partnerKey?: string,
) {
  const view = document.defaultView;
  const loaded = new Map<string, HTMLImageElement>();
  if (!view) return loaded;
  const window = view;
  const deadline = Date.now() + 5000;
  const queue: { key: string; source: string | undefined; embedded: boolean }[] = [];
  let timer = 0;
  try {
    const artwork = await Promise.race([
      Promise.all([
        import('./score-export-artwork.json').then((module) => module.default),
        resultArtwork
          ? import('./score-export-result-artwork.json').then((module) => module.default)
          : Promise.resolve({}),
        resultArtwork ? loadScoreExportPartnerArtwork(partnerKey) : Promise.resolve({}),
      ]).then(([common, result, partner]) => ({ ...common, ...result, ...partner })),
      new Promise<undefined>((resolve) => {
        timer = window.setTimeout(() => resolve(undefined), 5000);
      }),
    ]);
    const selectedPartner = scoreExportPartners.some((choice) => choice.key === partnerKey)
      ? 'partner:' + partnerKey
      : undefined;
    if (artwork)
      for (const [key, source] of Object.entries(artwork)) {
        if (key.startsWith('partner:') && key !== selectedPartner) continue;
        queue.push({ key: 'art:' + key, source, embedded: true });
      }
  } catch {
    /* The original canvas layout remains usable without decorative artwork. */
  } finally {
    window.clearTimeout(timer);
  }
  const keys = ['fc', 'fc+', 'ap', 'ap+', 'fs', 'fs+', 'fdx', 'fdx+', 'sync'].map(
    (badge) => 'badge:' + badge,
  );
  if (rating !== undefined && rating >= 0 && rating <= 99999)
    keys.push('rating:' + ratingTier(rating));
  for (const key of keys) {
    try {
      queue.push({ key: 'art:' + key, source: options.artworkURL?.(key), embedded: true });
    } catch {
      /* The artwork projection is optional. */
    }
  }
  try {
    if (version)
      queue.push({
        key: 'art:version',
        source: options.versionLogoURL?.(version),
        embedded: false,
      });
  } catch {
    /* Unknown releases retain their written version label. */
  }
  for (const chart of new Map(charts.map((chart) => [chart.chartID, chart])).values()) {
    try {
      queue.push({
        key: 'jacket:' + chart.chartID,
        source: options.jacketURL(chart),
        embedded: false,
      });
    } catch {
      /* Missing catalog artwork is represented by the neutral jacket. */
    }
  }
  async function load(item: (typeof queue)[number]) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return;
    let url: URL | undefined,
      dataURL = '';
    try {
      const source = item.source;
      if (!source) return;
      if (
        item.embedded &&
        source.length <= 6 * 1024 * 1024 &&
        /^data:image\/(?:png|webp);base64,[A-Za-z0-9+/]+=*$/.test(source)
      )
        dataURL = source;
      else {
        url = new URL(source, document.baseURI);
        if (
          url.origin !== window.location.origin ||
          !/^https?:$/.test(url.protocol) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          !/\/media\/[a-f0-9]{64}\.webp$/.test(url.pathname)
        )
          return;
      }
    } catch {
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), remaining);
    try {
      if (url) {
        const response = await window.fetch(url, {
          credentials: 'omit',
          mode: 'same-origin',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          signal: controller.signal,
        });
        if (!response.ok) return;
        const blob = await response.blob();
        if (!blob.type.startsWith('image/') || blob.size > 4 * 1024 * 1024) return;
        // The hosted image policy allows self/data, not blob URLs. Only bytes from
        // the verified public artwork request reach this local decoder.
        dataURL = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          const finish = (result: string) => {
            reader.onload = null;
            reader.onerror = null;
            reader.onabort = null;
            controller.signal.removeEventListener('abort', abort);
            resolve(result);
          };
          const abort = () => {
            reader.abort();
            finish('');
          };
          reader.onload = () => finish(typeof reader.result === 'string' ? reader.result : '');
          reader.onerror = () => finish('');
          reader.onabort = () => finish('');
          controller.signal.addEventListener('abort', abort, { once: true });
          if (controller.signal.aborted) abort();
          else reader.readAsDataURL(blob);
        });
      }
      if (!dataURL) return;
      const image = document.createElement('img');
      image.decoding = 'async';
      image.referrerPolicy = 'no-referrer';
      const decoded = await new Promise<boolean>((resolve) => {
        const finish = (success: boolean) => {
          image.onload = null;
          image.onerror = null;
          controller.signal.removeEventListener('abort', abort);
          resolve(success);
        };
        const abort = () => {
          image.removeAttribute('src');
          finish(false);
        };
        image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0);
        image.onerror = () => finish(false);
        controller.signal.addEventListener('abort', abort, { once: true });
        if (controller.signal.aborted) abort();
        else image.src = dataURL;
      });
      if (decoded) loaded.set(item.key, image);
    } catch {
      /* Artwork failure cannot prevent a score export. */
    } finally {
      window.clearTimeout(timeout);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(6, queue.length) }, async () => {
      let item: (typeof queue)[number] | undefined;
      while ((item = queue.shift())) await load(item);
    }),
  );
  return loaded;
}

function badges(record: PlayerRecord) {
  return [lampLabel(record.lamp), syncLabel(record.sync)].filter(Boolean);
}
function art(
  ctx: Context,
  images: Map<string, HTMLImageElement>,
  key: string,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const image = images.get('art:' + key);
  if (!image) return false;
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const w = image.naturalWidth * scale,
    h = image.naturalHeight * scale;
  ctx.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h);
  return true;
}
function badgeArt(
  ctx: Context,
  images: Map<string, HTMLImageElement>,
  label: string,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const key = label.toLowerCase().replace(/^fsd/, 'fdx');
  return art(ctx, images, 'badge:' + key, x, y, width, height);
}
function officialBackground(
  ctx: Context,
  images: Map<string, HTMLImageElement>,
  width: number,
  height: number,
) {
  const image = images.get('art:background');
  if (!image) return;
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const w = image.naturalWidth * scale,
    h = image.naturalHeight * scale;
  ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
}
function playerName(
  ctx: Context,
  images: Map<string, HTMLImageElement>,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  if (!art(ctx, images, 'nameplate', x, y, width, height))
    box(ctx, x, y, width, height, '#fff', height / 2);
  text(ctx, name, x + width / 2, y + height * 0.71, width - 42, height * 0.53, ink, 'center', 900);
}
function playerRating(
  ctx: Context,
  images: Map<string, HTMLImageElement>,
  rating: number,
  x: number,
  y: number,
  width: number,
) {
  const height = (width * 86) / 296;
  if (
    rating < 0 ||
    rating > 99999 ||
    !art(ctx, images, 'rating:' + ratingTier(rating), x, y, width, height)
  ) {
    box(ctx, x, y, width, height, '#fff', 20);
    text(
      ctx,
      String(rating),
      x + width / 2,
      y + height * 0.73,
      width - 40,
      height * 0.66,
      ink,
      'center',
      900,
    );
    return;
  }
  // The same five digit windows and gold typography as the existing profile placard.
  const digitWidth = width * 0.1069;
  for (const [index, digit] of String(rating).padStart(5, ' ').split('').entries()) {
    ctx.save();
    ctx.shadowColor = '#291800';
    ctx.shadowBlur = 2;
    ctx.shadowOffsetY = 2;
    text(
      ctx,
      digit,
      x + width * 0.4155 + digitWidth * (index + 0.5),
      y + height * 0.722,
      digitWidth,
      width * 0.125,
      '#ffe352',
      'center',
      900,
      '"Arial Black", Arial, sans-serif',
    );
    ctx.restore();
  }
}
function achievementArt(
  ctx: Context,
  images: Map<string, HTMLImageElement>,
  value: number,
  center: number,
  baseline: number,
  maximum: number,
) {
  const palette = achievementPalette(value);
  const atlas = images.get('art:digits-' + palette),
    percent = images.get('art:percent-' + palette);
  if (!atlas || !percent) return false;
  let fractional = false;
  const glyphs = achievementSpriteLayout(value).map((glyph) => {
    if (glyph.character === '.') fractional = true;
    const height = fractional ? 112 : 164;
    return { ...glyph, height, width: glyph.character === '.' ? 36 : (height * 86) / 118 };
  });
  const total = glyphs.reduce((sum, glyph) => sum + glyph.width, 0) + 80;
  const scale = Math.min(1, maximum / total);
  let x = center - (total * scale) / 2;
  for (const glyph of glyphs) {
    const cellWidth = atlas.naturalWidth / 4,
      cellHeight = atlas.naturalHeight / 4;
    // Crop the decimal glyph's transparent side bearings, without altering artwork pixels.
    const decimal = glyph.character === '.',
      cropX = decimal ? 18 : 0,
      cropWidth = decimal ? 50 : cellWidth;
    ctx.drawImage(
      atlas,
      glyph.column * cellWidth + cropX,
      glyph.row * cellHeight,
      cropWidth,
      cellHeight,
      x,
      baseline - glyph.height * scale,
      glyph.width * scale,
      glyph.height * scale,
    );
    x += glyph.width * scale;
  }
  ctx.drawImage(percent, x, baseline - 80 * scale, 80 * scale, 80 * scale);
  return true;
}
function grade(ctx: Context, value: string, x: number, y: number, width: number, size: number) {
  ctx.save();
  const gradient = ctx.createLinearGradient(x - width / 2, y - size, x + width / 2, y);
  for (const [stop, color] of [
    [0, '#ed5280'],
    [0.25, '#d18b19'],
    [0.5, '#47a78c'],
    [0.75, '#4b88db'],
    [1, '#a361cf'],
  ] as const)
    gradient.addColorStop(stop, color);
  ctx.fillStyle = gradient;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  font(ctx, size, 900);
  while (ctx.measureText(value).width > width && size > 14) font(ctx, --size, 900);
  ctx.lineWidth = Math.max(3, size / 15);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#fff';
  ctx.strokeText(value, x, y, width);
  ctx.fillText(value, x, y, width);
  ctx.restore();
}

function best50Card(
  ctx: Context,
  entry: ExportEntry | undefined,
  rank: number,
  x: number,
  y: number,
  images: Map<string, HTMLImageElement>,
  options: ExportCanvasOptions,
) {
  const width = 288,
    height = 182;
  if (!entry) {
    box(ctx, x, y, width, height, '#e9eef4');
    text(
      ctx,
      String(rank).padStart(2, '0'),
      x + width / 2,
      y + 78,
      width - 32,
      42,
      '#b3becc',
      'center',
    );
    text(
      ctx,
      options.translate('No eligible record'),
      x + width / 2,
      y + 116,
      width - 32,
      18,
      muted,
      'center',
      500,
    );
    return;
  }
  const { chart, record, rating } = entry,
    accent = difficulty(chart);
  box(ctx, x - 2, y - 2, width + 4, height + 6, accent);
  box(ctx, x, y, width, height, '#fff');
  box(ctx, x, y, width, 30, accent, [18, 18, 0, 0]);
  text(ctx, '#' + String(rank).padStart(2, '0'), x + 13, y + 21, 36, 15, '#fff');
  text(ctx, chart.difficulty.toUpperCase(), x + 55, y + 21, 141, 16, '#fff');
  text(ctx, chart.level || '—', x + width - 13, y + 21, 67, 17, '#fff', 'right');
  jacket(ctx, images.get('jacket:' + chart.chartID), x + 12, y + 42, 86, accent);
  text(ctx, achievement(record.achievement), x + 110, y + 64, 166, 26);
  grade(ctx, gradeForAchievement(record.achievement), x + 145, y + 98, 70, 30);
  text(ctx, String(rating), x + width - 13, y + 101, 80, 31, accent, 'right', 900);
  text(ctx, 'RT', x + width - 13, y + 122, 44, 12, muted, 'right');
  const icons = badges(record);
  icons.forEach((badge, index) => {
    if (!badgeArt(ctx, images, badge, x + 112 + index * 34, y + 98, 29, 33))
      text(ctx, badge, x + 112 + index * 44, y + 124, 43, 13, muted);
  });
  text(ctx, chart.title, x + 12, y + 152, width - 24, 21);
  const constant = record.constant;
  text(
    ctx,
    [
      chart.format.toUpperCase(),
      constant === null ? '' : options.translate('Constant {0}', [(constant / 10).toFixed(1)]),
    ]
      .filter(Boolean)
      .join(' · '),
    x + 12,
    y + 174,
    width - 24,
    14,
    muted,
    'left',
    500,
  );
}

/** Native canvas export: player observations remain in memory and never enter image URLs. */
export async function renderBest50(
  document: Document,
  model: Best50Export,
  options: ExportCanvasOptions,
) {
  const images = await jackets(
    document,
    [...model.old, ...model.new].map((entry) => entry.chart),
    options,
    model.version.label,
    model.totalRating,
  );
  const t = options.translate;
  const notices = [
    [
      model.coverage === 'partial' ? t('Partial report') : '',
      model.excluded.total ? t('{0} excluded records', [model.excluded.total]) : '',
    ]
      .filter(Boolean)
      .join(' · '),
    ...model.warnings.map((warning) => t(warning)),
  ].filter(Boolean);
  const footerTop = 2520;
  const { canvas, ctx } = surface(document, 1600, footerTop + notices.length * 48 + 78);
  ctx.fillStyle = '#f0f4f9';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  officialBackground(ctx, images, canvas.width, canvas.height);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, 1600, 364);
  ctx.clip();
  art(ctx, images, 'character', 985, -50, 640, 380);
  ctx.restore();
  const shade = ctx.createLinearGradient(0, 0, 1600, 0);
  shade.addColorStop(0, '#ffffffdd');
  shade.addColorStop(0.6, '#ffffffaa');
  shade.addColorStop(1, '#ffffff00');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, 1600, 364);
  playerName(
    ctx,
    images,
    model.player.displayName || model.player.username || t('Player'),
    58,
    43,
    686,
    64,
  );
  playerRating(ctx, images, model.totalRating, 72, 129, 540);
  text(
    ctx,
    t(model.coverage === 'partial' ? 'Rating estimate' : 'Rating total'),
    78,
    313,
    540,
    23,
    muted,
  );
  text(ctx, t('Best 50'), 687, 170, 650, 70, '#693e9e', 'left', 900);
  art(ctx, images, 'version', 1030, 186, 520, 148);
  text(
    ctx,
    [model.version.label, options.regionLabel].filter(Boolean).join(' · '),
    692,
    233,
    326,
    25,
    ink,
    'left',
    500,
  );
  pill(ctx, 'maimai.party', 696, 278, 182, '#8154ad', 19);
  box(ctx, 28, 375, 1544, 2107, '#ffffffb8', 24);
  const sections = [
    {
      y: 400,
      entries: model.old,
      total: model.oldTotal,
      maximum: 35,
      title: 'Older charts · Best 35',
      accent: '#8456cf',
    },
    {
      y: 1848,
      entries: model.new,
      total: model.newTotal,
      maximum: 15,
      title: 'New charts · Best 15',
      accent: '#237d98',
    },
  ];
  for (const section of sections) {
    box(ctx, 48, section.y, 8, 39, section.accent, 4);
    text(ctx, t(section.title), 71, section.y + 31, 1030, 33);
    text(
      ctx,
      `${t('{0} / {1} charts', [section.entries.length, section.maximum])}  ·  ${section.total} RT`,
      1552,
      section.y + 29,
      420,
      24,
      muted,
      'right',
    );
    for (let index = 0; index < section.maximum; index++)
      best50Card(
        ctx,
        section.entries[index],
        index + 1,
        48 + (index % 5) * 304,
        section.y + 65 + Math.floor(index / 5) * 196,
        images,
        options,
      );
  }
  const footerY = canvas.height - 28;
  box(ctx, 28, footerTop - 18, 1544, canvas.height - footerTop + 10, '#ffffffed', 20);
  rule(ctx, 48, footerTop, 1504);
  const stamp = date(model.capturedAt);
  text(
    ctx,
    ['maimai.party', stamp ? t('Captured {0}', [stamp]) : ''].filter(Boolean).join(' · '),
    48,
    footerY,
    810,
    18,
    muted,
    'left',
    500,
  );
  text(ctx, t('Created from imported records'), 1552, footerY, 650, 18, muted, 'right', 500);
  notices.forEach((notice, index) =>
    lines(
      ctx,
      notice,
      48,
      footerTop + 31 + index * 48,
      1504,
      18,
      2,
      model.coverage === 'partial' ? '#875321' : muted,
      500,
    ),
  );
  return canvas;
}

/** The artwork fills the display itself; the physical cabinet is not part of the export. */
function resultScreen(ctx: Context, images: Map<string, HTMLImageElement>) {
  ctx.fillStyle = '#edf1f8';
  ctx.fillRect(0, 0, 1200, 1200);
  ctx.save();
  ctx.beginPath();
  ctx.arc(600, 582, 574, 0, Math.PI * 2);
  ctx.clip();
  officialBackground(ctx, images, 1200, 1160);
  ctx.fillStyle = '#ffffff64';
  ctx.fillRect(0, 0, 1200, 1160);
  ctx.translate(600, 580);
  ctx.rotate(-Math.PI / 7);
  for (let y = -900; y < 900; y += 115) {
    ctx.fillStyle = y % 230 === 0 ? '#ffffff64' : '#b6f7ef40';
    ctx.fillRect(-1000, y, 2000, 38);
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(600, 582, 574, 0, Math.PI * 2);
  ctx.strokeStyle = '#263246';
  ctx.lineWidth = 5;
  ctx.stroke();
}

function prismatic(ctx: Context, y: number, height: number) {
  const fill = ctx.createLinearGradient(0, y, 70, y + height);
  for (const [stop, color] of [
    [0, '#fffcc3'],
    [0.16, '#fddd64'],
    [0.32, '#9df5e4'],
    [0.5, '#81bbff'],
    [0.65, '#e8a5f5'],
    [0.83, '#ff859a'],
    [1, '#ffe495'],
  ] as const)
    fill.addColorStop(stop, color);
  return fill;
}

function clearLabel(ctx: Context, value: string) {
  ctx.save();
  ctx.font = '600 86px "Bahnschrift", "Arial Narrow", Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  const characters = Array.from(value);
  const tracking = value === 'CLEAR!' ? 20 : 3;
  const widths = characters.map((character) => ctx.measureText(character).width);
  const width =
    widths.reduce((total, advance) => total + advance, 0) + tracking * (characters.length - 1);
  const scale = Math.min(1, 720 / width);
  ctx.translate(600 - (width * scale) / 2, 180);
  ctx.scale(scale, scale);
  const fill = ctx.createLinearGradient(0, -82, 0, 0);
  fill.addColorStop(0, '#fff3aa');
  fill.addColorStop(0.44, '#f6d667');
  fill.addColorStop(0.61, '#fff8cc');
  fill.addColorStop(0.78, '#bf9adc');
  fill.addColorStop(1, '#f19abd');
  let x = 0;
  for (const [index, character] of characters.entries()) {
    for (const [lineWidth, color] of [
      [9, '#fff9d7'],
      [6, '#45455b'],
      [2, '#fff9df'],
    ] as const) {
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = color;
      ctx.strokeText(character, x, 0);
    }
    ctx.fillStyle = fill;
    ctx.fillText(character, x, 0);
    x += widths[index] + tracking;
  }
  ctx.restore();
}

/** Original vector lettering, matched to the modern cabinet's angular, italic rank. */
function cabinetGrade(
  ctx: Context,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  if (!/^S{2,3}\+?$/.test(value)) {
    ctx.save();
    const goldRank = /^S{1,2}\+?$/.test(value);
    ctx.font = `${goldRank ? '' : 'italic '}900 ${height}px "Arial Black", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    for (const [lineWidth, color] of [
      [18, '#e4bd63'],
      [12, '#27367d'],
      [5, '#fffde9'],
    ] as const) {
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = color;
      ctx.strokeText(value, x + width / 2, y + height * 0.84, width);
    }
    const gold = ctx.createLinearGradient(0, y, 0, y + height);
    gold.addColorStop(0, '#fffbc4');
    gold.addColorStop(0.42, '#f8e469');
    gold.addColorStop(0.5, '#fffbcd');
    gold.addColorStop(1, '#cc951b');
    ctx.fillStyle = goldRank ? gold : '#416295';
    ctx.fillText(value, x + width / 2, y + height * 0.84, width);
    ctx.restore();
    return;
  }
  const count = value.replace('+', '').length;
  const goldRank = count === 2;
  const units = count * 117 + (value.endsWith('+') ? 66 : 0);
  const scale = Math.min(width / units, height / 154);
  ctx.save();
  ctx.translate(x + (width - units * scale) / 2 + 20 * scale, y);
  ctx.scale(scale, scale);
  ctx.transform(1, 0, -0.18, 1, 0, 0);
  const sPath = () => {
    ctx.beginPath();
    ctx.moveTo(112, 5);
    ctx.lineTo(34, 5);
    ctx.quadraticCurveTo(8, 5, 8, 36);
    ctx.lineTo(8, 58);
    ctx.quadraticCurveTo(8, 79, 34, 79);
    ctx.lineTo(75, 79);
    ctx.lineTo(75, 94);
    ctx.lineTo(11, 94);
    ctx.lineTo(0, 142);
    ctx.lineTo(75, 142);
    ctx.quadraticCurveTo(105, 142, 105, 111);
    ctx.lineTo(105, 86);
    ctx.quadraticCurveTo(105, 58, 80, 58);
    ctx.lineTo(39, 58);
    ctx.lineTo(39, 44);
    ctx.lineTo(105, 44);
    ctx.closePath();
  };
  const plusPath = () => {
    ctx.beginPath();
    ctx.moveTo(21, 9);
    ctx.lineTo(48, 9);
    ctx.lineTo(48, 28);
    ctx.lineTo(66, 28);
    ctx.lineTo(66, 54);
    ctx.lineTo(48, 54);
    ctx.lineTo(48, 73);
    ctx.lineTo(21, 73);
    ctx.lineTo(21, 54);
    ctx.lineTo(2, 54);
    ctx.lineTo(2, 28);
    ctx.lineTo(21, 28);
    ctx.closePath();
  };
  for (let i = 0; i < count + Number(value.endsWith('+')); i++) {
    ctx.save();
    ctx.translate(i * 117, 0);
    const path = i < count ? sPath : plusPath;
    ctx.lineJoin = 'round';
    for (const [lineWidth, color] of [
      [13, '#9c526e'],
      [10, '#f7d879'],
      [7, '#233375'],
      [2.7, '#ffffd7'],
    ] as const) {
      path();
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
    path();
    const gold = ctx.createLinearGradient(0, 0, 55, 145);
    gold.addColorStop(0, '#fffcc5');
    gold.addColorStop(0.3, '#f4cc56');
    gold.addColorStop(0.5, '#fff9d8');
    gold.addColorStop(0.52, '#ebca49');
    gold.addColorStop(0.78, '#fff1a1');
    gold.addColorStop(1, '#dea331');
    ctx.fillStyle = goldRank ? gold : prismatic(ctx, 0, 145);
    ctx.fill();
    ctx.save();
    path();
    ctx.clip();
    if (goldRank) {
      for (const [color, points] of [
        [
          '#ffffffa6',
          [
            [-10, 5],
            [57, 1],
            [32, 51],
          ],
        ],
        [
          '#d7efbba6',
          [
            [57, 1],
            [125, 21],
            [76, 62],
          ],
        ],
        [
          '#dba44d99',
          [
            [32, 51],
            [76, 62],
            [11, 95],
          ],
        ],
        [
          '#fffde8c9',
          [
            [76, 62],
            [122, 105],
            [49, 114],
          ],
        ],
        [
          '#e5dda080',
          [
            [11, 95],
            [49, 114],
            [-8, 151],
          ],
        ],
        [
          '#f7e97fb3',
          [
            [49, 114],
            [120, 135],
            [51, 154],
          ],
        ],
      ] as const) {
        ctx.beginPath();
        points.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
      }
    } else {
      ctx.fillStyle = '#ffffff4a';
      for (let k = -1; k < 5; k++) {
        ctx.beginPath();
        ctx.moveTo(-15, k * 47);
        ctx.lineTo(135, k * 47 - 45);
        ctx.lineTo(135, k * 47 - 32);
        ctx.lineTo(-15, k * 47 + 13);
        ctx.fill();
      }
    }
    ctx.restore();
    ctx.restore();
  }
  ctx.restore();
}

function resultBadge(
  ctx: Context,
  images: Map<string, HTMLImageElement>,
  label: string,
  x: number,
  y: number,
) {
  if (!label) return;
  const key = label.toLowerCase().replace(/^fsd/, 'fdx');
  const base =
    key.replace('+', '') === 'ap'
      ? 'ap'
      : key.replace('+', '') === 'fc'
        ? 'fc'
        : key.replace('+', '') === 'fdx'
          ? 'fdx'
          : key === 'sync'
            ? 'sync'
            : 'fs';
  const hasBase = art(ctx, images, 'result:' + base + '_base', x, y, 128, 128);
  const hasText = art(ctx, images, 'result:' + key, x + 7, y + 34, 114, 67);
  if (!hasBase || !hasText) {
    if (!badgeArt(ctx, images, label, x + 23, y + 16, 82, 92))
      text(ctx, label, x + 64, y + 79, 116, 29, ink, 'center', 900);
  }
}

function resultLettering(
  ctx: Context,
  value: string,
  x: number,
  baseline: number,
  width: number,
  size: number,
  edge: string,
) {
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  font(ctx, size, 900);
  while (ctx.measureText(value).width > width && size > 14) font(ctx, --size, 900);
  const actualWidth = Math.min(width, ctx.measureText(value).width);
  ctx.beginPath();
  ctx.rect(x - 4, baseline - size * 1.3, width + 8, size * 1.7);
  ctx.clip();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#eee6fa';
  ctx.lineWidth = 5;
  ctx.strokeText(value, x, baseline, width);
  ctx.strokeStyle = edge;
  ctx.lineWidth = 2.5;
  ctx.strokeText(value, x, baseline, width);
  ctx.fillStyle = '#fff';
  ctx.fillText(value, x, baseline, width);
  ctx.restore();
  return actualWidth;
}

function resultDifficulty(ctx: Context, chart: PlayerChart, key: string) {
  const label = key === 'remaster' ? 'Re:MASTER' : chart.difficulty.toUpperCase();
  const width = resultLettering(ctx, label, 313, 292, 278, 32, '#5c3687');
  const start = 313 + width + 10;
  ctx.save();
  ctx.fillStyle = '#eee1ffa6';
  for (let index = 0; index < 4; index++) {
    const x = start + index * 17;
    ctx.beginPath();
    ctx.moveTo(x, 266);
    ctx.lineTo(x + 8, 266);
    ctx.lineTo(x + 18, 281);
    ctx.lineTo(x + 8, 296);
    ctx.lineTo(x, 296);
    ctx.lineTo(x + 10, 281);
    ctx.closePath();
    ctx.fill();
  }
  ctx.beginPath();
  for (let point = 0; point < 10; point++) {
    const angle = -Math.PI / 2 + (point * Math.PI) / 5;
    const radius = point % 2 ? 6.5 : 15;
    const x = start + 87 + Math.cos(angle) * radius;
    const y = 281 + Math.sin(angle) * radius;
    if (!point) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.strokeStyle = '#eee1ffa6';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();
}

function resultLevel(ctx: Context, level: string, edge: string) {
  const value = level.trim() || '—';
  const known = /^(\d{1,2})(\+?)$/.exec(value);
  const digits = known?.[1] || value;
  const plus = known?.[2] || '';
  ctx.save();
  font(ctx, 24, 900);
  const prefixWidth = ctx.measureText('LV').width;
  font(ctx, 28, 900);
  const plusWidth = plus ? ctx.measureText(plus).width + 1 : 0;
  const digitSpace = 120 - prefixWidth - 4 - plusWidth;
  let size = 60;
  font(ctx, size, 900);
  while (ctx.measureText(digits).width > digitSpace && size > 32) font(ctx, --size, 900);
  const digitBounds = ctx.measureText(digits);
  const digitWidth = Math.min(digitBounds.width, digitSpace);
  const left = 918 - (prefixWidth + 4 + digitWidth + plusWidth) / 2;
  const baseline = 294;
  resultLettering(ctx, 'LV', left, baseline, prefixWidth, 24, edge);
  resultLettering(ctx, digits, left + prefixWidth + 4, baseline, digitSpace, size, edge);
  if (plus) {
    font(ctx, 28, 900);
    const plusBaseline =
      baseline -
      digitBounds.actualBoundingBoxAscent +
      ctx.measureText(plus).actualBoundingBoxAscent;
    resultLettering(
      ctx,
      plus,
      left + prefixWidth + 4 + digitWidth + 1,
      plusBaseline,
      plusWidth,
      28,
      edge,
    );
  }
  ctx.restore();
}

/** A cabinet result composition; unavailable play observations stay unavailable. */
export async function renderAchievement(
  document: Document,
  input: AchievementExport,
  options: ExportCanvasOptions,
) {
  const { chart, record } = input;
  // White rating artwork denotes an unknown total. A single-chart contribution is not a player total.
  const images = await jackets(
    document,
    [chart],
    options,
    input.versionLabel || '',
    0,
    true,
    input.partnerKey,
  );
  const { canvas, ctx } = surface(document, 1200, 1200);
  const t = options.translate,
    accent = difficulty(chart);
  const precise = achievement(record.achievement);
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `${chart.title} · ${t('Achievement')} ${precise}`);
  canvas.textContent = `${chart.title} · ${t('Achievement')} ${precise}`;
  resultScreen(ctx, images);
  clearLabel(
    ctx,
    record.achievement !== null && record.achievement >= 800000
      ? 'CLEAR!'
      : t('Result').toUpperCase(),
  );

  const difficultyKey = chart.difficulty
    .toLowerCase()
    .replace(/^dx\s*/, '')
    .replace(/[^a-z]/g, '');
  const ribbon = images.get('art:ribbon:' + difficultyKey);
  const headerInk = difficultyKey === 'remaster' ? '#60258e' : '#fff';
  if (ribbon) {
    const scale = 725 / ribbon.naturalWidth;
    // The source's difficulty label straddles the top edge of a song-list card.
    // Reuse its clean patterned row and level surround, with a centered result label.
    ctx.drawImage(ribbon, 350, 0, 274, 100, 279, 207, 350 * scale, 100 * scale);
    ctx.drawImage(
      ribbon,
      350,
      0,
      ribbon.naturalWidth - 350,
      100,
      279 + 350 * scale,
      207,
      (ribbon.naturalWidth - 350) * scale,
      100 * scale,
    );
    ctx.drawImage(ribbon, 0, 100, ribbon.naturalWidth, 56, 279, 207 + 100 * scale, 725, 56 * scale);
  } else {
    box(ctx, 280, 255, 724, 100, accent, 14);
    box(ctx, 300, 307, 669, 41, '#173770', 10);
  }
  jacket(ctx, images.get('jacket:' + chart.chartID), 187, 235, 109, accent);
  resultDifficulty(ctx, chart, difficultyKey);
  text(ctx, chart.title, 635, 327, 638, 29, '#fff', 'center', 900, fontFamily, 'center');
  resultLevel(ctx, chart.level || '', '#4a286d');
  if (chart.format.toUpperCase() !== 'DX' || !art(ctx, images, 'result:chart-dx', 760, 265, 80, 32))
    text(
      ctx,
      chart.format.toUpperCase() === 'DX' ? 'でらっくす' : chart.format.toUpperCase(),
      822,
      281,
      91,
      21,
      headerInk,
      'center',
      900,
      fontFamily,
      'center',
    );

  ctx.fillStyle = '#243c85';
  ctx.beginPath();
  ctx.moveTo(88, 357);
  ctx.lineTo(378, 357);
  ctx.lineTo(404, 374);
  ctx.lineTo(378, 391);
  ctx.lineTo(88, 391);
  ctx.closePath();
  ctx.fill();
  text(ctx, 'ACHIEVEMENT', 109, 382, 270, 25, '#fff', 'left', 900);
  text(ctx, '›››☆', 405, 386, 126, 37, '#283f82', 'left', 900);
  if (record.achievement === null)
    text(ctx, t('Unknown achievement'), 115, 527, 700, 61, ink, 'left', 900);
  else if (!achievementArt(ctx, images, record.achievement, 465, 552, 770)) {
    text(
      ctx,
      precise,
      105,
      529,
      770,
      117,
      '#e4b548',
      'left',
      900,
      '"Arial Black", Arial, sans-serif',
    );
  }
  cabinetGrade(ctx, gradeForAchievement(record.achievement), 126, 585, 670, 218);

  // Only explicitly selected, verified official promotional artwork reaches this position.
  const partner = input.partnerKey;
  if (scoreExportPartners.some((choice) => choice.key === partner))
    art(ctx, images, 'partner:' + partner, 850, 405, 230, 300);

  if (!art(ctx, images, 'result:base', 215, 825, 384, 180)) {
    box(ctx, 222, 947, 373, 38, '#fff', 19);
  }
  resultBadge(ctx, images, lampLabel(record.lamp), 258, 846);
  resultBadge(ctx, images, syncLabel(record.sync), 414, 846);
  if (art(ctx, images, 'rating:white', 324, 982, 328, 95))
    text(ctx, '—', 553, 1046, 137, 49, '#fff7ba', 'center', 900);

  const rows: [string, string, string][] = [];
  if (input.recordKind === 'play') {
    for (const [label, value, color] of [
      ['Critical perfect', record.pcrit, '#d8a024'],
      ['Perfect', record.perfect, '#d8a024'],
      ['Great', record.great, '#d267a4'],
      ['Good', record.good, '#62adce'],
      ['Miss', record.miss, '#8b90a2'],
    ] as const)
      if (value !== null) rows.push([label, String(value), color]);
  }
  const panelX = 694,
    panelWidth = 282;
  // At maximum observed detail, the last baseline is y=1007 and its right edge
  // is x=967: both fit inside the circular display, including text descenders.
  let rowY = 716;
  for (const [label, value, color] of rows) {
    box(ctx, panelX, rowY, panelWidth, 28, '#ffffffed', 4);
    box(ctx, panelX, rowY, 177, 28, color, [4, 0, 0, 4]);
    text(ctx, t(label).toUpperCase(), panelX + 8, rowY + 20, 160, 17, '#fff', 'left', 900);
    text(ctx, value, panelX + panelWidth - 12, rowY + 22, 107, 23, ink, 'right', 900);
    rowY += 30;
  }
  if (record.dxScore !== null) {
    rowY += 9;
    const dxArtwork = art(ctx, images, 'dx-score', panelX, rowY, panelWidth, 58);
    if (!dxArtwork)
      text(ctx, t('DX score'), panelX + 10, rowY + 17, panelWidth - 20, 19, '#254b82');
    text(
      ctx,
      String(record.dxScore) + (record.maxDxScore === null ? '' : ' / ' + record.maxDxScore),
      panelX + panelWidth / 2,
      rowY + 51,
      panelWidth - 20,
      25,
      '#243b6f',
      'center',
      900,
    );
    rowY += 63;
  }
  const details: [string, number][] = [];
  if (input.recordKind === 'play') {
    if (record.maxCombo !== null) details.push(['Max combo', record.maxCombo]);
    if (record.fast !== null) details.push(['Fast', record.fast]);
    if (record.slow !== null) details.push(['Late', record.slow]);
  } else if (record.rate !== null) {
    box(ctx, panelX, rowY + 9, panelWidth, 100, '#ffffffed', 12);
    text(
      ctx,
      t('Chart rating'),
      panelX + panelWidth / 2,
      rowY + 34,
      panelWidth - 28,
      23,
      '#334164',
      'center',
      700,
      fontFamily,
      'center',
    );
    text(
      ctx,
      String(record.rate),
      panelX + panelWidth / 2,
      rowY + 77,
      panelWidth - 28,
      44,
      '#243b6f',
      'center',
      900,
      fontFamily,
      'center',
    );
  }
  for (const [label, value] of details) {
    text(ctx, t(label), panelX + 7, rowY + 19, 194, 18, '#334164');
    text(ctx, String(value), panelX + panelWidth - 9, rowY + 19, 87, 22, '#243b6f', 'right', 900);
    rowY += 25;
  }
  // The footer identifies this as an imported-record export, outside the cabinet composition.
  const stamp = input.recordKind === 'play' ? date(record.timeAchieved) : '';
  text(ctx, input.playerName || t('Player'), 40, 1174, 570, 20, ink);
  text(ctx, 'maimai.party', 1160, 1174, 235, 20, ink, 'right');
  if (input.recordKind === 'pb')
    text(
      ctx,
      t('Personal-best values may come from different plays.'),
      600,
      1195,
      1120,
      16,
      muted,
      'center',
      500,
    );
  else if (stamp) text(ctx, t('Played {0}', [stamp]), 600, 1195, 1120, 16, muted, 'center', 500);
  return canvas;
}
