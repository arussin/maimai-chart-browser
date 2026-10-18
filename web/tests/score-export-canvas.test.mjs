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

test('Afterglow nameplate is the exact reviewed asset without legacy decorations', () => {
  const artwork = JSON.parse(
    readFileSync(
      new URL('../src/views/score-export-afterglow-artwork.json', import.meta.url),
      'utf8',
    ),
  );
  const legacy = JSON.parse(
    readFileSync(new URL('../src/views/score-export-artwork.json', import.meta.url), 'utf8'),
  );
  const provenance = JSON.parse(
    readFileSync(
      new URL('../../docs/score-export-artwork-provenance.json', import.meta.url),
      'utf8',
    ),
  ).files.find(({ key }) => key === 'nameplate');
  assert.deepEqual(Object.keys(artwork), ['nameplate']);
  assert.equal(artwork.nameplate, legacy.nameplate);
  const bytes = Buffer.from(artwork.nameplate.split(',')[1], 'base64');
  assert.equal(bytes.length, provenance.packaged_bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), provenance.packaged_sha256);
});

test('Afterglow wrappers retain typed models, selected version artwork and independent player totals', async () => {
  const source = readFileSync(
    new URL('../src/views/score-export-canvas.ts', import.meta.url),
    'utf8',
  );
  const prepared = [],
    painted = [],
    images = new Map(),
    canvas = {};
  const wrappers = runInNewContext(
    stripTypeScriptTypes(
      source.slice(source.indexOf('export async function renderBest50(')),
    ).replace(/^export /gm, '') + '\n({ renderBest50, renderAchievement })',
    {
      jackets: async (...args) => {
        prepared.push(args);
        return images;
      },
      paintAfterglowBest50: (...args) => {
        painted.push(args);
        return canvas;
      },
      paintAfterglowAchievement: (...args) => {
        painted.push(args);
        return canvas;
      },
      Number,
    },
  );
  const document = {},
    options = { translate: (key) => key };
  for (const logoVersion of ['PRiSM PLUS', null]) {
    const model = {
      old: [{ chart: { chartID: 'old' } }],
      new: [{ chart: { chartID: 'new' } }],
      totalRating: 0,
      version: { label: 'An imported release label', logoVersion },
    };
    assert.equal(await wrappers.renderBest50(document, model, options), canvas);
    const args = prepared.at(-1);
    assert.equal(args[0], document);
    assert.deepEqual(Array.from(args[1]), [model.old[0].chart, model.new[0].chart]);
    assert.equal(args[2], options);
    assert.equal(args[3], logoVersion || '');
    assert.equal(args[4], 0);
    assert.equal(args.length, 5, 'No legacy artwork mode or decorative partner is prepared');
    assert.deepEqual(painted.at(-1), [document, model, images, options]);
  }
  for (const value of [
    undefined,
    null,
    0,
    15432,
    -1,
    NaN,
    Infinity,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    const input = {
      chart: { chartID: 'one' },
      record: { rate: 335 },
      playerRating:
        value === undefined ? undefined : value === null ? null : { value, source: 'maishift' },
      versionLabel: 'PRiSM PLUS',
      partnerKey: 'shama',
    };
    assert.equal(await wrappers.renderAchievement(document, input, options), canvas);
    const args = prepared.at(-1);
    assert.deepEqual(Array.from(args[1]), [input.chart]);
    assert.equal(args[3], '', 'Single records never request a game-version logo');
    assert.equal(args[4], Number.isSafeInteger(value) && value >= 0 ? value : undefined);
    assert.equal(args.length, 5, 'Legacy partner preference is not repurposed');
    assert.deepEqual(painted.at(-1), [document, input, images, options]);
  }
});

function loaderFixture(
  jacketURL,
  { packagedArtwork = false, unavailableArtwork, fetchResponse } = {},
) {
  const source = readFileSync(
    new URL('../src/views/score-export-canvas.ts', import.meta.url),
    'utf8',
  );
  // Keep this test offline while observing exactly which packaged modules the loader requests.
  const loaderSource = source
    .slice(source.indexOf('async function jackets('), source.indexOf('/** Local image preparation'))
    .replace(
      /import\('(\.\/score-export-[^']+\.json)'\)\.then\(\(module\) => module\.default\)/g,
      'loadArtwork("$1")',
    );
  let now = 0,
    nextTimer = 0,
    fallbacks = 0;
  const timers = new Map(),
    requests = [],
    timerDurations = [],
    importedModules = [],
    decodedSources = [];
  const window = {
    location: { origin: 'https://maimai.party' },
    setTimeout(callback, duration) {
      const id = ++nextTimer;
      timers.set(id, { callback, at: now + duration });
      timerDurations.push(duration);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    async fetch(url, options) {
      requests.push({ url: url.href, options });
      if (fetchResponse) return fetchResponse(url, options);
      return { ok: true, blob: async () => ({ type: 'image/webp', size: 32 }) };
    },
  };
  const document = {
    defaultView: window,
    baseURI: 'https://maimai.party/lab/',
    createElement(name) {
      assert.equal(name, 'img');
      return {
        naturalWidth: 400,
        naturalHeight: 400,
        removeAttribute() {},
        get src() {
          return this.currentSource;
        },
        set src(source) {
          this.currentSource = source;
          decodedSources.push(source);
          queueMicrotask(() => this.onload?.());
        },
      };
    },
  };
  class Reader {
    readAsDataURL(blob) {
      this.result = blob.dataURL || 'data:image/webp;base64,AA==';
      queueMicrotask(() => this.onload?.());
    }
    abort() {
      this.onabort?.();
    }
  }
  const loader = runInNewContext('(' + stripTypeScriptTypes(loaderSource) + ')', {
    ratingTier,
    async loadArtwork(module) {
      importedModules.push(module);
      if (module === unavailableArtwork) throw new Error('Packaged artwork unavailable');
      return packagedArtwork
        ? JSON.parse(readFileSync(new URL('../src/views/' + module, import.meta.url), 'utf8'))
        : {};
    },
    Date: { now: () => now },
    URL,
    AbortController,
    FileReader: Reader,
  });
  return {
    requests,
    timers,
    timerDurations,
    importedModules,
    decodedSources,
    get fallbacks() {
      return fallbacks;
    },
    setNow(value) {
      now = value;
    },
    expire() {
      for (const [id, timer] of [...timers])
        if (timer.at <= now) {
          timers.delete(id);
          timer.callback();
        }
    },
    load(
      charts = [{ chartID: 'synthetic' }],
      { version = '', rating, artworkURL, versionLogoURL, jacketFallbackURL } = {},
    ) {
      return loader(
        document,
        charts,
        {
          translate: (key) => key,
          jacketURL,
          jacketFallbackURL,
          artworkURL,
          versionLogoURL,
          artworkFallback: () => {
            fallbacks++;
          },
        },
        version,
        rating,
      );
    },
  };
}

test('Afterglow prepares required artwork without fetching or decoding legacy backgrounds or partners', async () => {
  const source = readFileSync(
    new URL('../src/views/score-export-canvas.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /(?:from|import\()\s*['"]\.\/score-export-(?:partners|partner-artwork|artwork\.json)/,
  );
  const fixture = loaderFixture(() => undefined, { packagedArtwork: true });
  const requestedKeys = [];
  const images = await fixture.load([], {
    version: 'PRiSM PLUS',
    rating: 15432,
    artworkURL(key) {
      requestedKeys.push(key);
      return 'data:image/webp;base64,AQ==';
    },
    versionLogoURL: () => '/media/' + 'e'.repeat(64) + '.webp',
  });
  assert.deepEqual(fixture.importedModules.sort(), [
    './score-export-afterglow-artwork.json',
    './score-export-result-artwork.json',
  ]);
  assert.ok(images.has('art:nameplate'));
  for (const key of ['fc', 'fc+', 'ap', 'ap+', 'fs', 'fs+', 'fdx', 'fdx+', 'sync']) {
    assert.ok(images.has('art:result:' + key), key);
    assert.ok(images.has('art:result:' + key.replace('+', '') + '_base'), key);
    assert.ok(images.has('art:badge:' + key), key);
  }
  assert.ok(requestedKeys.includes('rating:rainbow'));
  assert.ok(images.has('art:rating:rainbow'));
  assert.ok(images.has('art:version'));
  const legacy = JSON.parse(
    readFileSync(new URL('../src/views/score-export-artwork.json', import.meta.url), 'utf8'),
  );
  for (const [key, value] of Object.entries(legacy))
    if (key !== 'nameplate') {
      assert.ok(!images.has('art:' + key), key);
      assert.ok(!fixture.decodedSources.includes(value), key);
    }
  assert.ok(![...images.keys()].some((key) => key.startsWith('art:partner:')));
  assert.equal(
    fixture.requests.length,
    1,
    'Only the reviewed version logo needs a network image fetch',
  );
  assert.equal(fixture.fallbacks, 0);
  assert.equal(fixture.timers.size, 0);
});

test('missing Afterglow nameplate emits the existing finite fallback and keeps jacket preparation', async () => {
  const fixture = loaderFixture(() => '/media/' + 'f'.repeat(64) + '.webp', {
    packagedArtwork: true,
    unavailableArtwork: './score-export-afterglow-artwork.json',
  });
  const images = await fixture.load();
  assert.equal(fixture.fallbacks, 1);
  assert.ok(images.has('jacket:synthetic'));
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.timers.size, 0);
});

test('async reviewed jacket resolution retains same-origin fetch privacy and remaining decode budget', async () => {
  const path = '/media/' + 'a'.repeat(64) + '.webp';
  const fixture = loaderFixture(async () => {
    fixture.setNow(3000);
    return path;
  });
  const images = await fixture.load();
  assert.ok(images.has('jacket:synthetic'));
  assert.equal(fixture.requests.length, 1);
  const { url, options } = fixture.requests[0];
  assert.equal(url, 'https://maimai.party' + path);
  assert.equal(options.credentials, 'omit');
  assert.equal(options.mode, 'same-origin');
  assert.equal(options.redirect, 'error');
  assert.equal(options.referrerPolicy, 'no-referrer');
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(fixture.timerDurations.at(-1), 2000, 'Resolution consumes the shared5s budget');
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.fallbacks, 0);
});

test('a successful larger jacket upgrades the already decoded ordinary thumbnail', async () => {
  const preferred = '/media/' + '1'.repeat(64) + '.webp';
  const thumbnail = '/media/' + '0'.repeat(64) + '.webp';
  const fixture = loaderFixture(() => preferred, {
    fetchResponse(url) {
      const dataURL = 'data:image/webp;base64,' + (url.pathname === preferred ? 'AQ==' : 'AA==');
      return { ok: true, blob: async () => ({ type: 'image/webp', size: 32, dataURL }) };
    },
  });
  const images = await fixture.load(undefined, {
    jacketFallbackURL: () => thumbnail,
  });
  assert.equal(images.get('jacket:synthetic').src, 'data:image/webp;base64,AQ==');
  assert.deepEqual(
    fixture.requests.map(({ url }) => new URL(url).pathname),
    [thumbnail, preferred],
  );
  assert.deepEqual(fixture.decodedSources, [
    'data:image/webp;base64,AA==',
    'data:image/webp;base64,AQ==',
  ]);
  assert.equal(fixture.fallbacks, 0);
  assert.equal(fixture.timers.size, 0);
});

test('a 404 larger jacket keeps the accepted thumbnail within the original privacy and time budget', async () => {
  const preferred = '/media/' + '2'.repeat(64) + '.webp';
  const thumbnail = '/media/' + '3'.repeat(64) + '.webp';
  let thumbnailResolutions = 0;
  const fixture = loaderFixture(() => preferred, {
    fetchResponse(url) {
      if (url.pathname === preferred) {
        fixture.setNow(2200);
        return { ok: false, status: 404 };
      }
      return { ok: true, blob: async () => ({ type: 'image/webp', size: 32 }) };
    },
  });
  const images = await fixture.load(undefined, {
    jacketFallbackURL(chart) {
      assert.equal(chart.chartID, 'synthetic');
      thumbnailResolutions++;
      fixture.setNow(1800);
      return thumbnail;
    },
  });
  assert.ok(images.has('jacket:synthetic'));
  assert.equal(thumbnailResolutions, 1);
  assert.deepEqual(
    fixture.requests.map(({ url }) => url),
    ['https://maimai.party' + thumbnail, 'https://maimai.party' + preferred],
  );
  for (const { options } of fixture.requests) {
    assert.equal(options.credentials, 'omit');
    assert.equal(options.mode, 'same-origin');
    assert.equal(options.redirect, 'error');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.ok(options.signal instanceof AbortSignal);
  }
  assert.equal(fixture.timerDurations.at(-1), 3200);
  assert.equal(fixture.fallbacks, 1, 'The recovered primary failure remains diagnosable');
  assert.equal(fixture.timers.size, 0);
});

test('unavailable preferred projection can use an ordinary thumbnail without reporting a transport failure', async () => {
  const fixture = loaderFixture(() => undefined);
  const images = await fixture.load(undefined, {
    jacketFallbackURL: () => '/media/' + '4'.repeat(64) + '.webp',
  });
  assert.ok(images.has('jacket:synthetic'));
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.fallbacks, 0);
  assert.equal(fixture.timers.size, 0);
});

test('identical preferred and ordinary URLs reuse the settled image without a second request', async () => {
  const thumbnail = '/media/' + '4'.repeat(64) + '.webp';
  const fixture = loaderFixture(() => 'https://maimai.party' + thumbnail);
  const images = await fixture.load(undefined, { jacketFallbackURL: () => thumbnail });
  assert.equal(images.size, 1);
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.decodedSources.length, 1);
  assert.equal(fixture.fallbacks, 0);
  assert.equal(fixture.timers.size, 0);
});

test('a missing or failed ordinary thumbnail can still receive its reviewed larger jacket', async () => {
  const preferred = '/media/' + '1'.repeat(64) + '.webp';
  const thumbnail = '/media/' + '0'.repeat(64) + '.webp';
  for (const ordinary of [undefined, thumbnail]) {
    const fixture = loaderFixture(() => preferred, {
      fetchResponse(url) {
        return url.pathname === thumbnail
          ? { ok: false, status: 404 }
          : { ok: true, blob: async () => ({ type: 'image/webp', size: 32 }) };
      },
    });
    const images = await fixture.load(undefined, { jacketFallbackURL: () => ordinary });
    assert.equal(images.size, 1);
    assert.equal(fixture.requests.length, ordinary ? 2 : 1);
    assert.equal(fixture.fallbacks, ordinary ? 1 : 0);
    assert.equal(fixture.timers.size, 0);
  }
});

test('thumbnail preparation retains URL validation and never recursively retries a failure', async () => {
  const thumbnail = '/media/' + '5'.repeat(64) + '.webp';
  for (const value of [
    'https://external.example' + thumbnail,
    'https://owner:secret@maimai.party' + thumbnail,
    thumbnail + '?player=private',
    thumbnail + '#private',
    '/unreviewed.webp',
    'data:image/webp;base64,AA==',
    thumbnail,
  ]) {
    let resolutions = 0;
    const fixture = loaderFixture(() => '/media/' + '6'.repeat(64) + '.webp', {
      fetchResponse: () => ({ ok: false, status: 404 }),
    });
    const images = await fixture.load(undefined, {
      jacketFallbackURL() {
        resolutions++;
        return value;
      },
    });
    assert.equal(images.size, 0);
    assert.equal(resolutions, 1);
    assert.equal(fixture.requests.length, value === thumbnail ? 2 : 1);
    assert.equal(fixture.fallbacks, 1, 'One finite fallback report per failed jacket');
    assert.equal(fixture.timers.size, 0);
  }
});

test('expired ordinary-thumbnail requests never begin a larger-jacket upgrade', async () => {
  const preferred = '/media/' + '7'.repeat(64) + '.webp';
  const thumbnail = '/media/' + '8'.repeat(64) + '.webp';
  const expired = loaderFixture(
    () => {
      assert.fail('No upgrade may resolve after the thumbnail phase exhausts the deadline');
      return preferred;
    },
    {
      fetchResponse() {
        expired.setNow(5000);
        return { ok: false, status: 404 };
      },
    },
  );
  const noFallback = await expired.load(undefined, {
    jacketFallbackURL: () => thumbnail,
  });
  assert.equal(noFallback.size, 0);
  assert.equal(expired.requests.length, 1);
  assert.equal(new URL(expired.requests[0].url).pathname, thumbnail);
  assert.equal(expired.fallbacks, 1);
  assert.equal(expired.timers.size, 0);
});

test('late larger-jacket resolution preserves its settled thumbnail without extending the deadline', async () => {
  const preferred = '/media/' + '7'.repeat(64) + '.webp';
  const thumbnail = '/media/' + '8'.repeat(64) + '.webp';
  let release;
  const delayed = loaderFixture(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    {
      fetchResponse() {
        delayed.setNow(3000);
        return { ok: true, blob: async () => ({ type: 'image/webp', size: 32 }) };
      },
    },
  );
  const pending = delayed.load(undefined, {
    jacketFallbackURL: () => thumbnail,
  });
  await new Promise(setImmediate);
  assert.equal(delayed.timerDurations.at(-1), 2000);
  delayed.setNow(5000);
  delayed.expire();
  const images = await pending;
  assert.equal(images.size, 1);
  const settled = images.get('jacket:synthetic');
  release(preferred);
  await new Promise(setImmediate);
  assert.equal(delayed.requests.length, 1, 'Late upgrade resolution starts no request');
  assert.equal(images.get('jacket:synthetic'), settled, 'Late work does not replace the thumbnail');
  assert.equal(delayed.fallbacks, 1);
  assert.equal(delayed.timers.size, 0);
});

test('a pending larger-jacket fetch aborts at the shared deadline and keeps its thumbnail', async () => {
  const thumbnail = '/media/' + '0'.repeat(64) + '.webp';
  let release;
  const fixture = loaderFixture(() => '/media/' + '9'.repeat(64) + '.webp', {
    fetchResponse(url, { signal }) {
      if (url.pathname === thumbnail)
        return { ok: true, blob: async () => ({ type: 'image/webp', size: 32 }) };
      return new Promise((resolve, reject) => {
        release = resolve;
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    },
  });
  const pending = fixture.load(undefined, {
    jacketFallbackURL: () => thumbnail,
  });
  await new Promise(setImmediate);
  fixture.setNow(5000);
  fixture.expire();
  const images = await pending;
  assert.equal(fixture.requests[1].options.signal.aborted, true);
  const settled = images.get('jacket:synthetic');
  release({ ok: true, blob: async () => ({ type: 'image/webp', size: 32 }) });
  await new Promise(setImmediate);
  assert.equal(images.size, 1);
  assert.equal(images.get('jacket:synthetic'), settled);
  assert.equal(fixture.decodedSources.length, 1);
  assert.equal(fixture.requests.length, 2);
  assert.equal(fixture.fallbacks, 1);
  assert.equal(fixture.timers.size, 0);
});

test('slow-link partial upgrades preserve every settled thumbnail and never exceed six workers', async () => {
  const path = (stage, id) => '/media/' + stage + id.toString(16).padStart(63, '0') + '.webp';
  const image = (stage, id) =>
    'data:image/webp;base64,' + Buffer.from(stage + ':' + id).toString('base64');
  const response = (stage, id) => ({
    ok: true,
    blob: async () => ({ type: 'image/webp', size: 32, dataURL: image(stage, id) }),
  });
  const thumbnails = [],
    upgrades = [],
    resolvedUpgrades = [];
  let inFlight = 0,
    maximumInFlight = 0;
  const fixture = loaderFixture(
    (chart) => {
      resolvedUpgrades.push(chart.chartID);
      return path('2', Number(chart.chartID));
    },
    {
      fetchResponse(url, { signal }) {
        const stage = url.pathname[7],
          id = Number.parseInt(url.pathname.slice(8, -5), 16);
        inFlight++;
        maximumInFlight = Math.max(maximumInFlight, inFlight);
        if (stage === '2' && id < 2) {
          inFlight--;
          return response(stage, id);
        }
        return new Promise((resolve, reject) => {
          let pending = true;
          const finish = () => {
            if (pending) inFlight--;
            pending = false;
          };
          const item = {
            id,
            resolve() {
              finish();
              resolve(response(stage, id));
            },
          };
          (stage === '1' ? thumbnails : upgrades).push(item);
          signal.addEventListener(
            'abort',
            () => {
              finish();
              reject(new Error('aborted'));
            },
            { once: true },
          );
        });
      },
    },
  );
  const charts = Array.from({ length: 10 }, (_, id) => ({ chartID: String(id) }));
  const pending = fixture.load(charts, {
    jacketFallbackURL: (chart) => path('1', Number(chart.chartID)),
  });
  await new Promise(setImmediate);
  assert.equal(thumbnails.length, 6);
  assert.deepEqual(resolvedUpgrades, []);
  fixture.setNow(800);
  for (const item of thumbnails.slice()) item.resolve();
  await new Promise(setImmediate);
  assert.equal(thumbnails.length, 10);
  assert.deepEqual(
    resolvedUpgrades,
    [],
    'No high-resolution lookup starts before every thumbnail settles',
  );
  fixture.setNow(1500);
  for (const item of thumbnails.slice(6)) item.resolve();
  await new Promise(setImmediate);
  assert.equal(upgrades.length, 6, 'Two completed upgrades leave six slow requests in flight');
  assert.equal(resolvedUpgrades.length, 8);
  assert.equal(maximumInFlight, 6);
  assert.ok(fixture.requests.slice(0, 10).every(({ url }) => new URL(url).pathname[7] === '1'));
  fixture.setNow(5000);
  fixture.expire();
  const images = await pending;
  assert.equal(images.size, 10, 'The deadline cannot discard any settled ordinary jacket');
  for (let id = 0; id < 10; id++)
    assert.equal(images.get('jacket:' + id).src, image(id < 2 ? '2' : '1', id));
  assert.equal(fixture.requests.length, 18, 'The final two upgrades start no request after expiry');
  assert.equal(fixture.fallbacks, 8, 'Each incomplete upgrade has one finite fallback signal');
  assert.equal(inFlight, 0);
  assert.equal(fixture.timers.size, 0);
  const settled = Array.from(images.values());
  for (const item of upgrades) item.resolve();
  await new Promise(setImmediate);
  assert.deepEqual(
    Array.from(images.values()),
    settled,
    'Late responses cannot replace completed output',
  );
  assert.equal(
    fixture.decodedSources.length,
    12,
    'Only ten thumbnails and two timely upgrades decode',
  );
});

test('async jacket URLs cannot bypass the reviewed artwork boundary', async () => {
  const path = '/media/' + 'b'.repeat(64) + '.webp';
  for (const value of [
    'https://external.example' + path,
    'https://owner:secret@maimai.party' + path,
    path + '?player=private',
    path + '#private',
    '/unreviewed.webp',
    'data:image/webp;base64,AA==',
  ]) {
    const fixture = loaderFixture(async () => value);
    assert.equal((await fixture.load()).size, 0);
    assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.fallbacks, 1);
    assert.equal(fixture.timers.size, 0);
  }
  const unavailable = loaderFixture(async () => undefined);
  assert.equal((await unavailable.load()).size, 0);
  assert.equal(
    unavailable.fallbacks,
    0,
    'An absent reviewed jacket remains an ordinary neutral placeholder',
  );
});

test('slow or rejected jacket projection remains bounded and ignores late results', async () => {
  let release;
  const fixture = loaderFixture(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = fixture.load();
  await new Promise(setImmediate);
  fixture.setNow(5000);
  fixture.expire();
  assert.equal((await pending).size, 0);
  assert.equal(fixture.fallbacks, 1);
  release('/media/' + 'c'.repeat(64) + '.webp');
  await new Promise(setImmediate);
  assert.equal(
    fixture.requests.length,
    0,
    'A projection that finishes after the deadline starts no request',
  );
  assert.equal(fixture.timers.size, 0);
  for (const jacketURL of [
    () => {
      throw new Error('Private path');
    },
    async () => {
      throw new Error('Private path');
    },
  ]) {
    const rejected = loaderFixture(jacketURL);
    assert.equal((await rejected.load()).size, 0);
    assert.equal(rejected.fallbacks, 1);
    assert.equal(rejected.requests.length, 0);
  }
});

test('lazy jacket resolution stays within the existing six-job pool and deduplicates charts', async () => {
  const pending = [];
  const fixture = loaderFixture(
    (chart) => new Promise((resolve) => pending.push({ chart, resolve })),
  );
  const charts = Array.from({ length: 10 }, (_, i) => ({ chartID: String(i) }));
  const result = fixture.load([...charts, charts[0]]);
  await new Promise(setImmediate);
  assert.equal(pending.length, 6);
  for (const item of pending.slice()) item.resolve('/media/' + 'd'.repeat(64) + '.webp');
  await new Promise(setImmediate);
  assert.equal(pending.length, 10);
  for (const item of pending.slice(6)) item.resolve('/media/' + 'd'.repeat(64) + '.webp');
  assert.equal((await result).size, 10);
  assert.equal(fixture.requests.length, 10);
  assert.equal(fixture.timers.size, 0);
});
