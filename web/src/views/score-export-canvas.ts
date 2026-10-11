import type { PlayerChart, PlayerRecord } from '../domain/player-data';
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
  regionLabel?: string;
}
export interface AchievementExport {
  chart: PlayerChart;
  record: PlayerRecord;
  playerName: string;
  recordKind: 'pb' | 'play';
  versionLabel?: string;
  regionLabel?: string;
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
function font(ctx: Context, size: number, weight = 700) {
  ctx.font = `${weight} ${size}px ${fontFamily}`;
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
) {
  // Explicit clipping protects every label, including unusually long imported Unicode names.
  ctx.save();
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  const left = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
  ctx.beginPath();
  ctx.rect(left, y - size * 1.25, width, size * 1.7);
  ctx.clip();
  const minimum = Math.min(size, Math.max(13, size * 0.65));
  font(ctx, size, weight);
  while (ctx.measureText(value).width > width && size > minimum) {
    size -= 1;
    font(ctx, size, weight);
  }
  if (ctx.measureText(value).width > width) {
    const characters = Array.from(value);
    while (characters.length && ctx.measureText(characters.join('') + '…').width > width)
      characters.pop();
    value = characters.join('') + '…';
  }
  ctx.fillText(value, x, y);
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

/** Six same-origin public images at a time; the entire image phase has a five-second budget. */
async function jackets(
  document: Document,
  charts: readonly PlayerChart[],
  options: ExportCanvasOptions,
) {
  const view = document.defaultView;
  const loaded = new Map<string, HTMLImageElement>();
  if (!view) return loaded;
  const window = view;
  const queue = [...new Map(charts.map((chart) => [chart.chartID, chart])).values()];
  const deadline = Date.now() + 5000;
  async function load(chart: PlayerChart) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return;
    let url: URL;
    try {
      const source = options.jacketURL(chart);
      if (!source) return;
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
    } catch {
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), remaining);
    try {
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
      const dataURL = await new Promise<string>((resolve) => {
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
      if (decoded) loaded.set(chart.chartID, image);
    } catch {
      /* Artwork failure cannot prevent a score export. */
    } finally {
      window.clearTimeout(timeout);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(6, queue.length) }, async () => {
      let chart: PlayerChart | undefined;
      while ((chart = queue.shift())) await load(chart);
    }),
  );
  return loaded;
}

function badges(record: PlayerRecord) {
  return [lampLabel(record.lamp), syncLabel(record.sync)].filter(Boolean);
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
  box(ctx, x, y + 3, width, height, '#dfe6ef');
  box(ctx, x, y, width, height, '#fff');
  box(ctx, x, y, width, 30, accent, [18, 18, 0, 0]);
  text(ctx, '#' + String(rank).padStart(2, '0'), x + 13, y + 21, 36, 15, '#fff');
  text(ctx, chart.difficulty.toUpperCase(), x + 55, y + 21, 141, 16, '#fff');
  text(ctx, chart.level || '—', x + width - 13, y + 21, 67, 17, '#fff', 'right');
  jacket(ctx, images.get(chart.chartID), x + 12, y + 42, 86, accent);
  text(ctx, achievement(record.achievement), x + 110, y + 64, 166, 26);
  grade(ctx, gradeForAchievement(record.achievement), x + 145, y + 98, 70, 30);
  text(ctx, String(rating), x + width - 13, y + 101, 80, 31, accent, 'right', 900);
  text(ctx, 'RT', x + width - 13, y + 122, 44, 12, muted, 'right');
  const icons = badges(record);
  text(ctx, icons.join(' · '), x + 110, y + 124, 115, 13, muted);
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
  const footerTop = 2460;
  const { canvas, ctx } = surface(document, 1600, footerTop + notices.length * 48 + 78);
  ctx.fillStyle = '#f0f4f9';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const header = ctx.createLinearGradient(0, 0, 1600, 315);
  header.addColorStop(0, '#293552');
  header.addColorStop(0.55, '#443365');
  header.addColorStop(1, '#225e75');
  ctx.fillStyle = header;
  ctx.fillRect(0, 0, 1600, 302);
  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.globalAlpha = 0.055;
  ctx.lineWidth = 32;
  for (let radius = 140; radius < 1050; radius += 90) {
    ctx.beginPath();
    ctx.arc(1310, 50, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  pill(ctx, 'maimai.party', 48, 32, 176, '#617184', 19);
  text(ctx, t('Best 50'), 48, 156, 920, 91, '#fff', 'left', 900);
  text(
    ctx,
    model.player.displayName || model.player.username || t('Player'),
    52,
    216,
    950,
    36,
    '#fff',
  );
  text(
    ctx,
    [model.version.label, options.regionLabel].filter(Boolean).join(' · '),
    52,
    263,
    950,
    25,
    '#d3d9ed',
    'left',
    500,
  );
  box(ctx, 1130, 77, 422, 170, '#ffffff');
  text(
    ctx,
    t(model.coverage === 'partial' ? 'Rating estimate' : 'Rating total'),
    1341,
    118,
    375,
    22,
    muted,
    'center',
  );
  text(ctx, String(model.totalRating), 1341, 198, 370, 74, ink, 'center', 900);
  const sections = [
    {
      y: 340,
      entries: model.old,
      total: model.oldTotal,
      maximum: 35,
      title: 'Older charts · Best 35',
      accent: '#8456cf',
    },
    {
      y: 1788,
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

function resultRim(ctx: Context, accent: string) {
  const background = ctx.createLinearGradient(0, 0, 1200, 1200);
  background.addColorStop(0, '#e4f9ff');
  background.addColorStop(0.47, '#fffafc');
  background.addColorStop(1, '#f4eafa');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, 1200, 1200);
  const ring = ctx.createLinearGradient(80, 80, 1120, 1120);
  ring.addColorStop(0, '#68d4ed');
  ring.addColorStop(0.3, '#aa8ddc');
  ring.addColorStop(0.62, '#f387bc');
  ring.addColorStop(1, '#f3d569');
  ctx.beginPath();
  ctx.arc(600, 600, 568, 0, Math.PI * 2);
  ctx.strokeStyle = ring;
  ctx.lineWidth = 31;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(600, 600, 535, 0, Math.PI * 2);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 11;
  ctx.stroke();
  for (let index = 0; index < 8; index++) {
    const angle = (index * Math.PI) / 4 + Math.PI / 8;
    ctx.save();
    ctx.translate(600 + Math.cos(angle) * 568, 600 + Math.sin(angle) * 568);
    ctx.rotate(angle + Math.PI / 2);
    box(ctx, -29, -11, 58, 22, '#fff', 11);
    ctx.restore();
  }
  ctx.save();
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = accent;
  for (let index = 0; index < 11; index++) {
    const x = 70 + index * 111,
      y = 105 + ((index * 71) % 975);
    ctx.beginPath();
    ctx.moveTo(x, y - 13);
    ctx.lineTo(x + 13, y);
    ctx.lineTo(x, y + 13);
    ctx.lineTo(x - 13, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** A result-screen-inspired composition; only known observations are drawn. */
export async function renderAchievement(
  document: Document,
  input: AchievementExport,
  options: ExportCanvasOptions,
) {
  const { chart, record } = input;
  const images = await jackets(document, [chart], options);
  const { canvas, ctx } = surface(document, 1200, 1200);
  const t = options.translate,
    accent = difficulty(chart);
  resultRim(ctx, accent);
  text(ctx, t('Result').toUpperCase(), 600, 128, 590, 57, accent, 'center', 900);
  text(
    ctx,
    t(input.recordKind === 'pb' ? 'Personal best' : 'Recorded play'),
    600,
    165,
    720,
    23,
    muted,
    'center',
  );
  box(ctx, 145, 200, 910, 229, '#fff', 28);
  jacket(ctx, images.get(chart.chartID), 166, 220, 187, accent);
  pill(ctx, chart.difficulty.toUpperCase(), 378, 222, 295, accent, 20);
  pill(ctx, t('Level {0}', [chart.level || '—']), 687, 222, 174, accent, 20);
  text(ctx, chart.format.toUpperCase(), 1026, 246, 137, 18, muted, 'right');
  lines(ctx, chart.title, 379, 301, 646, 37, 2);
  text(ctx, chart.artist, 379, 376, 646, 21, muted, 'left', 500);
  text(
    ctx,
    [
      input.versionLabel || record.displayVersion || chart.displayVersion,
      input.regionLabel || options.regionLabel,
    ]
      .filter(Boolean)
      .join(' · '),
    379,
    408,
    646,
    18,
    muted,
    'left',
    500,
  );
  text(ctx, t('Achievement').toUpperCase(), 600, 473, 840, 28, accent, 'center');
  if (record.achievement === null)
    text(ctx, t('Unknown achievement'), 600, 572, 970, 64, ink, 'center', 900);
  else {
    const [whole, fraction] = (record.achievement / 10000).toFixed(4).split('.');
    font(ctx, 134, 900);
    const wholeWidth = ctx.measureText(whole).width;
    font(ctx, 94, 900);
    const fractionalWidth = ctx.measureText('.' + fraction).width;
    font(ctx, 56, 700);
    const unitWidth = ctx.measureText('%').width;
    const left = (1200 - wholeWidth - fractionalWidth - unitWidth - 9) / 2;
    text(ctx, whole, left, 592, wholeWidth + 2, 134, ink, 'left', 900);
    text(ctx, '.' + fraction, left + wholeWidth, 592, fractionalWidth + 2, 94, ink, 'left', 900);
    text(ctx, '%', left + wholeWidth + fractionalWidth + 9, 592, unitWidth + 2, 56, accent);
  }
  grade(ctx, gradeForAchievement(record.achievement), 815, 735, 356, 113);
  const observedBadges = badges(record);
  if (observedBadges.length) {
    observedBadges.forEach((badge, index) => {
      const x = 180 + index * 204;
      box(ctx, x, 639, 187, 83, '#fff', 22);
      text(
        ctx,
        badge,
        x + 93.5,
        693,
        165,
        37,
        badge.startsWith('AP') ? '#b17b10' : '#218b88',
        'center',
        900,
      );
    });
  } else if (record.rate !== null) {
    text(ctx, t('Chart rating'), 180, 668, 382, 22, muted);
    text(ctx, String(record.rate), 180, 717, 382, 48, accent, 'left', 900);
  }
  const judgments = [
    ['Critical perfect', record.pcrit, '#b58116'],
    ['Perfect', record.perfect, '#b58116'],
    ['Great', record.great, '#cf5a95'],
    ['Good', record.good, '#478bac'],
    ['Miss', record.miss, '#727d8a'],
  ].filter((row) => input.recordKind === 'play' && row[1] !== null) as [string, number, string][];
  if (judgments.length) {
    const width = 910 / judgments.length;
    box(ctx, 145, 775, 910, 94, '#ffffff', 22);
    judgments.forEach(([label, value, color], index) => {
      const x = 145 + width * (index + 0.5);
      text(ctx, t(label), x, 805, width - 22, 19, color, 'center');
      text(ctx, String(value), x, 850, width - 22, 38, ink, 'center', 900);
    });
  } else if (input.recordKind === 'play')
    text(ctx, t('Judgment counts unavailable'), 600, 831, 860, 23, muted, 'center', 500);
  const details: [string, string][] = [];
  if (record.dxScore !== null)
    details.push([
      'DX score',
      String(record.dxScore) + (record.maxDxScore === null ? '' : ' / ' + record.maxDxScore),
    ]);
  if (input.recordKind === 'play') {
    if (record.maxCombo !== null) details.push(['Max combo', String(record.maxCombo)]);
    if (record.fast !== null) details.push(['Fast', String(record.fast)]);
    if (record.slow !== null) details.push(['Late', String(record.slow)]);
  } else if (record.rate !== null && observedBadges.length)
    details.push(['Chart rating', String(record.rate)]);
  if (details.length) {
    const width = 870 / details.length;
    if (input.recordKind === 'pb') box(ctx, 145, 796, 910, 143, '#fff', 22);
    details.forEach(([label, value], index) => {
      const x = 165 + width * (index + 0.5);
      text(
        ctx,
        t(label),
        x,
        input.recordKind === 'pb' ? 845 : 912,
        width - 22,
        19,
        muted,
        'center',
      );
      text(ctx, value, x, input.recordKind === 'pb' ? 898 : 950, width - 22, 30, ink, 'center');
    });
  }
  text(ctx, input.playerName || t('Player'), 600, 1013, 770, 32, accent, 'center');
  const stamp = input.recordKind === 'play' ? date(record.timeAchieved) : '';
  if (stamp) text(ctx, t('Played {0}', [stamp]), 600, 1049, 770, 20, muted, 'center', 500);
  if (input.recordKind === 'pb')
    text(
      ctx,
      t('Personal-best values may come from different plays.'),
      600,
      1085,
      770,
      17,
      muted,
      'center',
      500,
    );
  text(ctx, 'maimai.party', 600, 1130, 460, 25, ink, 'center');
  return canvas;
}
