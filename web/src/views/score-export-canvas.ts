import { paintAfterglowBest50, paintAfterglowAchievement } from './afterglow-painter';
import type { PlayerChart, PlayerRecord } from '../domain/player-data';
import { ratingTier } from './score-export-style';
import type { Best50Export, ExportPlayerRating } from '../domain/score-export';

export interface ExportCanvasOptions {
  artworkFallback?(): void;
  translate(key: string, values?: readonly (string | number)[]): string;
  /** A verified public-artwork projection, never a URL from an imported player file. */
  jacketURL(chart: PlayerChart): string | undefined | Promise<string | undefined>;
  /** Accepted ordinary thumbnail, tried once only if the preferred jacket is unavailable. */
  jacketFallbackURL?(chart: PlayerChart): string | undefined | Promise<string | undefined>;
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
  /** Current profile rating, not the player's rating at the time of a historical play. */
  playerRating?: ExportPlayerRating | null;
  versionLabel?: string;
  regionLabel?: string;
  /** Legacy preference retained for compatible callers; Afterglow paints no partner. */
  partnerKey?: string;
}

async function jackets(
  document: Document,
  charts: readonly PlayerChart[],
  options: ExportCanvasOptions,
  version: string,
  rating?: number,
) {
  const view = document.defaultView;
  const loaded = new Map<string, HTMLImageElement>();
  if (!view) return loaded;
  const window = view;
  const deadline = Date.now() + 5000;
  const queue: {
    key: string;
    source?: string;
    resolve?: () => ReturnType<ExportCanvasOptions['jacketURL']>;
    fallback?: () => ReturnType<ExportCanvasOptions['jacketURL']>;
    embedded: boolean;
  }[] = [];
  let timer = 0;
  try {
    const artwork = await Promise.race([
      Promise.all([
        // Exact reviewed nameplate bytes; the legacy background/character bundle is unused.
        // Its source/hash remain recorded in docs/score-export-artwork-provenance.json.
        import('./score-export-afterglow-artwork.json').then((module) => module.default),
        import('./score-export-result-artwork.json').then((module) => module.default),
      ]).then(([common, result]) => ({ ...common, ...result })),
      new Promise<undefined>((resolve) => {
        timer = window.setTimeout(() => resolve(undefined), 5000);
      }),
    ]);
    if (!artwork) options.artworkFallback?.();
    if (artwork)
      for (const [key, source] of Object.entries(artwork)) {
        queue.push({ key: 'art:' + key, source, embedded: true });
      }
  } catch {
    options.artworkFallback?.();
    /* The Afterglow layout remains usable without decorative artwork. */
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
    queue.push({
      key: 'jacket:' + chart.chartID,
      resolve: () => options.jacketURL(chart),
      fallback: options.jacketFallbackURL ? () => options.jacketFallbackURL?.(chart) : undefined,
      embedded: false,
    });
  }
  async function loadAttempt(item: (typeof queue)[number], failed: () => void) {
    let remaining = deadline - Date.now();
    if (!item.source && !item.resolve) return;
    if (remaining <= 0) {
      failed();
      return;
    }
    let source = item.source;
    if (item.resolve) {
      let resolverTimer = 0;
      try {
        source = await Promise.race([
          Promise.resolve().then(item.resolve),
          new Promise<never>((_, reject) => {
            resolverTimer = window.setTimeout(
              () => reject(new Error('Artwork resolution timed out.')),
              remaining,
            );
          }),
        ]);
      } catch {
        failed();
        return;
      } finally {
        window.clearTimeout(resolverTimer);
      }
      if (!source) return;
      remaining = deadline - Date.now();
      if (remaining <= 0) {
        failed();
        return;
      }
    }
    let url: URL | undefined,
      dataURL = '';
    try {
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
        ) {
          failed();
          return;
        }
      }
    } catch {
      failed();
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
        if (!response.ok || controller.signal.aborted || Date.now() >= deadline) return;
        const blob = await response.blob();
        if (
          !blob.type.startsWith('image/') ||
          blob.size > 4 * 1024 * 1024 ||
          controller.signal.aborted ||
          Date.now() >= deadline
        )
          return;
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
      if (decoded && !controller.signal.aborted && Date.now() < deadline)
        loaded.set(item.key, image);
    } catch {
      /* Artwork failure cannot prevent a score export. */
    } finally {
      if (!loaded.has(item.key)) failed();
      window.clearTimeout(timeout);
    }
  }
  async function load(item: (typeof queue)[number]) {
    let reported = false;
    const failed = () => {
      if (!reported) options.artworkFallback?.();
      reported = true;
    };
    await loadAttempt(item, failed);
    if (!loaded.has(item.key) && item.fallback && Date.now() < deadline) {
      // One ordinary-thumbnail attempt shares the original deadline and privacy checks.
      await loadAttempt({ key: item.key, resolve: item.fallback, embedded: false }, failed);
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

/** Local image preparation precedes the synchronous Afterglow painter. */
export async function renderBest50(
  document: Document,
  model: Best50Export,
  options: ExportCanvasOptions,
) {
  const images = await jackets(
    document,
    [...model.old, ...model.new].map((entry) => entry.chart),
    options,
    model.version.logoVersion || '',
    model.totalRating,
  );
  return paintAfterglowBest50(document, model, images, options);
}

export async function renderAchievement(
  document: Document,
  input: AchievementExport,
  options: ExportCanvasOptions,
) {
  const profileRating =
    input.playerRating &&
    Number.isSafeInteger(input.playerRating.value) &&
    input.playerRating.value >= 0
      ? input.playerRating.value
      : undefined;
  const images = await jackets(document, [input.chart], options, '', profileRating);
  return paintAfterglowAchievement(document, input, images, options);
}
