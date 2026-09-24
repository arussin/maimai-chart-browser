/**
 * Strict same-origin release transition acceptance using actual artifact bytes.
 *
 * This is a synthetic platform-switch simulation, not a Pages/DNS rehearsal,
 * browser-cache proof, production check, or complete-corpus integrity check.
 * Run through release-transition.config.js. The normal fixture suite excludes it.
 * Roots may be fixture artifacts for runtime diagnosis; release acceptance must
 * bind the exact full baseline/candidate/rollback inventories separately.
 */
import {test as base, expect} from './fixtures.js';
import {gzipSync} from 'node:zlib';
import {inspectArtifact, startArtifactSwitch, sha256} from './release-transition-server.mjs';

const test = base.extend({
  transition: async ({fixtureOrigins, context}, use, testInfo) => {
    const baseline = await inspectArtifact(process.env.MAIMAI_TRANSITION_BASELINE_ROOT, 'legacy');
    const candidate = await inspectArtifact(process.env.MAIMAI_TRANSITION_CANDIDATE_ROOT, 'modular');
    const rollback = await inspectArtifact(
      process.env.MAIMAI_TRANSITION_ROLLBACK_ROOT || baseline.root, 'legacy',
    );
    expect(candidate.root, 'The candidate must be a distinct retained artifact').not.toBe(baseline.root);
    expect(candidate.runtimeSha256, 'Do not simulate two versions with the same runtime').not.toBe(baseline.runtimeSha256);
    expect(rollback.htmlSha256, 'Rollback must serve the exact baseline document').toBe(baseline.htmlSha256);
    expect(rollback.runtimeSha256, 'Rollback must serve the exact baseline runtime entry').toBe(baseline.runtimeSha256);
    const artifacts = {baseline, candidate, rollback};
    const server = await startArtifactSwitch(artifacts);
    fixtureOrigins.allow(server.origin);
    const errors = [];
    const watch = page => page.on('pageerror', error => errors.push(error.message));
    context.on('page', watch);
    for (const page of context.pages()) watch(page);
    await context.addInitScript(origin => {
      // New pages begin at about:blank, whose opaque origin has no storage.
      // Limit fixture preferences to the exact allocated site, not other frames.
      if (location.origin !== origin) return;
      localStorage.setItem('maimai-language-v1', 'en');
      localStorage.setItem('maimai-announcement:player-import-sources-v1', 'seen');
    }, server.origin);
    try {
      await use({...server, artifacts, errors});
    } finally {
      await server.close();
      await testInfo.attach('release-transition-evidence', {
        body: JSON.stringify({
          schema: 'local-release-transition/1',
          simulation: 'read-only artifact switch on one loopback origin',
          limitations: [
            'Not a Cloudflare Pages, DNS, TLS or propagation rehearsal',
            'Network isolation uses interception; not a native HTTP-cache test',
            'Full-corpus inventory and source binding are separate acceptance gates',
          ],
          browser: testInfo.project.name,
          status: testInfo.status,
          origin: server.origin,
          artifacts,
          pageErrors: errors,
          requests: server.requests,
        }, null, 2),
        contentType: 'application/json',
      });
    }
  },
});

async function boot(page, transition, kind) {
  await page.goto(transition.origin + '/?view=catalog');
  await expect.poll(() => page.evaluate(() => !!globalThis.maimaiPersonal)).toBe(true);
  await page.evaluate(() => globalThis.maimaiPersonal.ready);
  await expect(page.locator('#songs .song-row').first()).toBeVisible({timeout: 45000});
  await expect(page.locator('script[type=module][src*="/browser-entry"]')).toHaveCount(kind === 'modular' ? 1 : 0);
}

// Authored here, not read from any local player's exports. One retained play and
// PB are intentionally outside the public corpus; their portable identity and
// observations must survive even when they have no public catalog mapping.
async function fictionalDataset(page, achievement = 970000, capturedAt = 4000) {
  return page.evaluate(async ({achievement, capturedAt}) => {
    const core = globalThis.maimaiPlayerData;
    const chart = {
      chartID: 'rollback-fictional-chart', songID: 'rollback-fictional-song',
      title: 'Fictional rollback study', artist: 'Fictional author',
      format: 'DX', difficulty: 'EXPERT', level: '10', constant: 100,
      displayVersion: 'Synthetic release', inGameID: null,
    };
    const record = {
      chartID: chart.chartID, achievement, grade: 'S', rate: 194,
      lamp: 'CLEAR', sync: '', constant: 100, displayVersion: 'Synthetic release',
      timeAchieved: capturedAt - 1000, dxScore: null, maxDxScore: null,
      maxCombo: 120, fast: null, slow: null, miss: null, good: null,
      great: null, perfect: null, pcrit: null,
    };
    const recordID = await core.digest(record);
    const snapshot = {
      capturedAt, phase: 'after', complete: true,
      versions: ['Synthetic release'], pbs: {[chart.chartID]: recordID},
    };
    const snapshotID = await core.digest(snapshot);
    const capture = {
      capturedAt, sourceKind: 'authored-test', sourceID: 'rollback-fixture',
      sessionID: 'fictional-session', historyCoverage: 'retained-window',
      playIDs: ['fictional-play-' + capturedAt], snapshotIDs: [snapshotID],
    };
    const body = {
      format: 'maimai-player-data', schemaVersion: 1,
      player: {
        key: 'kamaitachi:maimaidx:rollback-fixture',
        provider: 'kamaitachi', game: 'maimaidx',
        username: 'rollback-fixture', displayName: 'Fictional Rollback Player',
      },
      charts: {[chart.chartID]: chart}, records: {[recordID]: record},
      plays: {['fictional-play-' + capturedAt]: recordID},
      snapshots: {[snapshotID]: snapshot}, captures: {[await core.digest(capture)]: capture},
    };
    return core.validate({...body, revision: await core.digest(body)});
  }, {achievement, capturedAt});
}

async function chooseFile(page, data) {
  await page.locator('input[type=file]').setInputFiles({
    name: 'fictional-rollback-player.gz',
    mimeType: 'application/gzip',
    buffer: gzipSync(Buffer.from(JSON.stringify(data))),
  });
  await expect(page.getByRole('heading', {name: 'Import this profile?', exact: true})).toBeVisible();
  await page.getByLabel('Remember on this device', {exact: true}).check();
}

async function importRemembered(page, data) {
  await chooseFile(page, data);
  await page.getByRole('button', {name: 'Import data', exact: true}).click();
  await expect.poll(() => page.evaluate(() => globalThis.maimaiPersonal.enabled())).toBe(true);
  await expect.poll(async () => (await stored(page)).revision).toBe(data.revision);
}

async function stored(page) {
  return page.evaluate(async () => {
    // Inspect the real production namespace; never clear, seed, rename or replace
    // IndexedDB to get compatibility. Missing storage is a failure here.
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('maimai-player-data');
      request.onupgradeneeded = () => {
        request.transaction.abort();
        reject(Error('Expected the real player database to exist'));
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(Error('Player database unexpectedly blocked'));
    });
    try {
      const state = await new Promise((resolve, reject) => {
        const transaction = db.transaction('datasets', 'readonly');
        const store = transaction.objectStore('datasets');
        const active = store.get('active'), control = store.get('control');
        transaction.oncomplete = () => resolve({active: active.result, control: control.result});
        transaction.onabort = () => reject(transaction.error);
      });
      const data = state.active ? await globalThis.maimaiPlayerData.decode(state.active.bytes) : null;
      return {
        databaseVersion: db.version,
        revision: state.active?.revision ?? null,
        bytesSha256: state.active ? await globalThis.maimaiPlayerData.hash(state.active.bytes) : null,
        lastImportedAt: state.active?.lastImportedAt ?? null,
        epoch: state.control?.epoch ?? 0,
        records: data ? Object.keys(data.records).length : 0,
        plays: data ? Object.keys(data.plays).length : 0,
        playerKey: data?.player.key ?? null,
      };
    } finally {
      db.close();
    }
  });
}

test('remembered fictional scores survive old/new/old with two live tabs and one database', async ({page, context, transition}) => {
  await boot(page, transition, 'legacy');
  const dataset = await fictionalDataset(page);
  await importRemembered(page, dataset);
  const saved = await stored(page);
  expect(saved).toMatchObject({
    databaseVersion: 2, revision: dataset.revision, records: 1, plays: 1,
    playerKey: 'kamaitachi:maimaidx:rollback-fixture',
  });
  const other = await context.newPage();
  await boot(other, transition, 'legacy');
  expect(await stored(other)).toEqual(saved);
  await expect.poll(() => other.evaluate(() => globalThis.maimaiPersonal.enabled())).toBe(true);

  transition.switchTo('candidate');
  await boot(other, transition, 'modular');
  expect(await stored(other)).toEqual(saved);
  await expect.poll(() => other.evaluate(() => globalThis.maimaiPersonal.enabled())).toBe(true);
  // The first tab still executes the old release while the second executes new.
  await expect(page.locator('script[type=module][src*="/browser-entry"]')).toHaveCount(0);
  expect(await stored(page)).toEqual(saved);

  transition.switchTo('rollback');
  await boot(other, transition, 'legacy');
  expect(await stored(other)).toEqual(saved);
  await expect.poll(() => other.evaluate(() => globalThis.maimaiPersonal.enabled())).toBe(true);
  expect(await stored(page)).toEqual(saved);
  expect(transition.errors).toEqual([]);
});

test('old-tab Forget wins over a paused new-tab import and remains forgotten after rollback', async ({page, context, transition}) => {
  await boot(page, transition, 'legacy');
  await importRemembered(page, await fictionalDataset(page));
  const before = await stored(page);
  transition.switchTo('candidate');
  const importing = await context.newPage();
  await boot(importing, transition, 'modular');
  const replacement = await fictionalDataset(importing, 980000, 6000);
  await chooseFile(importing, replacement);
  await importing.evaluate(async () => {
    globalThis.rollbackStaleCommit = await globalThis.maimaiPlayerStorage.read();
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    let first = true;
    globalThis.rollbackImportSettled = false;
    // Observe completion of the actual compression reader used by core.encode.
    // The current commit checks its generation immediately after encode resolves.
    // A following task observes that continuation/catch/finally without imposing
    // an arbitrary delay, changing bytes, or adding a cancellation mechanism.
    const Compression = globalThis.CompressionStream;
    globalThis.CompressionStream = class extends Compression {
      constructor(...args) {
        super(...args);
        const getReader = this.readable.getReader.bind(this.readable);
        this.readable.getReader = (...readerArgs) => {
          const reader = getReader(...readerArgs), read = reader.read.bind(reader);
          reader.read = async (...readArgs) => {
            const result = await read(...readArgs);
            if (result.done) setTimeout(() => { globalThis.rollbackImportSettled = true; }, 0);
            return result;
          };
          return reader;
        };
      }
    };
    crypto.subtle.digest = async (...args) => {
      if (first) {
        first = false;
        globalThis.rollbackImportWaiting = true;
        await new Promise(resolve => { globalThis.releaseRollbackImport = resolve; });
      }
      return digest(...args);
    };
  });
  await importing.getByRole('button', {name: 'Import data', exact: true}).click();
  await importing.waitForFunction(() => globalThis.rollbackImportWaiting);

  transition.switchTo('rollback');
  await page.locator('#settings-toggle').click();
  await page.locator('#player-forget').click();
  await expect(page.getByRole('heading', {name: 'Player data forgotten', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Okay!', exact: true}).click();
  await expect.poll(async () => (await stored(page)).revision).toBeNull();
  expect((await stored(page)).epoch).toBeGreaterThan(before.epoch);
  // Forget intentionally permits viewing in-memory scores in open tabs. It
  // removes persistence/automatic refresh; do not assert Clear semantics here.
  await importing.evaluate(() => globalThis.releaseRollbackImport());
  await importing.waitForFunction(() => globalThis.rollbackImportSettled);
  await expect.poll(() => importing.locator('#player-forget').evaluate(button => button.hidden)).toBe(true);
  expect(await importing.evaluate(async () => {
    const state = globalThis.rollbackStaleCommit;
    try {
      await globalThis.maimaiPlayerStorage.save(state.active, state.token);
      return 'saved';
    } catch {
      return 'rejected';
    }
  }), 'Forget must invalidate the real pending import token').toBe('rejected');
  expect((await stored(importing)).revision).toBeNull();
  expect(await importing.evaluate(() => sessionStorage.getItem('maimai-player-session'))).toBeNull();

  await boot(importing, transition, 'legacy');
  await expect.poll(() => importing.evaluate(() => globalThis.maimaiPersonal.enabled())).toBe(false);
  expect((await stored(importing)).revision).toBeNull();
  await boot(page, transition, 'legacy');
  await expect.poll(() => page.evaluate(() => globalThis.maimaiPersonal.enabled())).toBe(false);
  expect((await stored(page)).revision).toBeNull();
  expect(transition.errors).toEqual([]);
});

async function pauseAssetBeforeDispatch(page, url) {
  let arrive, release;
  const arrived = new Promise(resolve => { arrive = resolve; });
  const resumed = new Promise(resolve => { release = resolve; });
  await page.route(url, async route => {
    arrive({url: route.request().url()});
    await resumed;
    // Continue through the existing deny-only proxy. Do not fulfill, rewrite
    // or preload the response; it must come from the newly active artifact.
    await route.continue();
  }, {times: 1});
  return {arrived, release};
}

async function retainDelayedRequest(page, transition, from, to, label, source) {
  transition.switchTo(from);
  const hold = await pauseAssetBeforeDispatch(page, transition.origin + source.lateURL);
  const fetchResource = ['configuration', 'catalog', 'permalinks'].includes(label);
  if (fetchResource) await page.addInitScript(expected => {
    const original = window.fetch.bind(window);
    window.fetch = (...args) => original(...args).then(response => {
      if (response.url === expected) {
        // Observe a clone of the actual application response. Chromium can lose
        // its protocol response body when an early fetch straddles document
        // initialization; do not replace that assertion with a second request.
        void response.clone().arrayBuffer().then(async bytes => {
          const hash = await crypto.subtle.digest('SHA-256', bytes);
          window.releaseObservedFetch = {
            status: response.status,
            sha256: [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join(''),
          };
        }).catch(error => { window.releaseObservedFetch = {error: error.message}; });
      }
      return response;
    });
  }, transition.origin + source.lateURL);
  const document = page.goto(transition.origin + '/?view=catalog', {waitUntil: 'domcontentloaded'});
  // Attach the rejection handler immediately; a broken transition must report
  // its assertion rather than an unhandled navigation-promise rejection.
  const navigation = document.then(() => null, error => error);
  try {
    await expect.poll(() => transition.requests.some(row => row.url === '/?view=catalog')).toBe(true);
    if (label === 'permalinks') {
      // Permalinks are intentionally lazy: chart expansion is the real action
      // that requests this resource, rather than an artificial fixture fetch.
      await expect(page.locator('#songs .song-row').first()).toBeVisible();
      await page.locator('#songs .song-row').first().locator('.chart-row').first().click();
    }
    const arrival = await Promise.race([
      hold.arrived,
      new Promise((_, reject) => {
        const timer = setTimeout(() => reject(Error('Actual late runtime request was never observed')), 15000);
        timer.unref();
      }),
    ]);
    expect(arrival.url).toBe(transition.origin + source.lateURL);
    expect(transition.requests.some(row => row.url === source.lateURL)).toBe(false);
    const lateResponse = page.waitForResponse(response =>
      new URL(response.url()).pathname === new URL(source.lateURL, transition.origin).pathname,
    );
    transition.switchTo(to);
    hold.release();
    const response = await lateResponse;
    expect(response.status(), `${label} lost ${source.lateURL}; the destination artifact lacks the open document's asset closure`).toBe(200);
    expect(await navigation).toBeNull();
    if (fetchResource) {
      await expect.poll(() => page.evaluate(() => window.releaseObservedFetch), {
        message: `${label} must deliver the original bytes to the actual application fetch`,
      }).toEqual({status: 200, sha256: source.lateSha256});
    } else {
      expect(sha256(await response.body()), `${label} changed bytes behind an existing runtime URL`).toBe(source.lateSha256);
    }
    await expect.poll(() => page.evaluate(() => !!globalThis.maimaiPersonal)).toBe(true);
    await page.evaluate(() => globalThis.maimaiPersonal.ready);
    await expect(page.locator('#songs .song-row').first()).toBeVisible({timeout: 45000});
    expect(transition.errors).toEqual([]);
    expect(transition.requests.some(row => row.url === source.lateURL && row.startedAt === to && row.servedBy === to && row.status === 200)).toBe(true);
  } finally {
    hold.release();
    // Let goto bind its document response before fixture teardown closes the
    // context. Closing this page first races Playwright's response disposal
    // and can replace the real missing-asset assertion with a protocol error.
    await navigation;
  }
}

for (const [from, to, label] of [
  ['baseline', 'candidate', 'promotion'],
  ['candidate', 'rollback', 'rollback'],
]) {
  test(`${label} retains exact late runtime bytes for a document already open before the switch`, async ({page, transition}) => {
    await retainDelayedRequest(page, transition, from, to, label, transition.artifacts[from]);
  });
}

for (const role of ['configuration', 'catalog', 'permalinks', 'styles']) {
  test(`rollback retains the document-bound ${role} requested after switching`, async ({page, transition}) => {
    const resource = transition.artifacts.candidate.boundResources[role];
    expect(resource, 'The candidate must declare its complete immutable resource descriptor').toBeTruthy();
    await retainDelayedRequest(page, transition, 'candidate', 'rollback', role, resource);
  });
}

function publicRoute(transition, locale = 'en', kind = 'songs') {
  const path = transition.artifacts.candidate.publicRoutes.find(value => value.startsWith(`/${locale}/${kind}/`));
  expect(path, 'The generated fictional corpus must contain this actual public route').toBeTruthy();
  return path;
}

async function staticRecovery(page, path, kind = 'song') {
  await expect(page.locator('meta[name="maimai-route-recovery"]')).toHaveAttribute('content', 'static-v1');
  await expect(page.locator('meta[name="maimai-route-recovery"]')).toHaveAttribute('data-path', path);
  await expect(page.locator(`main[data-seo-page="${kind}"]`)).toBeVisible();
  await expect(page.locator('script')).toHaveCount(0);
  await expect(page.locator('input,select,textarea,button,iframe')).toHaveCount(0);
  await expect(page.locator('link[rel="alternate"]')).toHaveCount(5);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://maimai.party' + path);
}

for (const javaScriptEnabled of [true, false]) {
  test.describe('static recovery JavaScript ' + javaScriptEnabled, () => {
    test.use({javaScriptEnabled});
    for (const locale of ['en', 'ja', 'ko', 'zh-hans']) for (const kind of ['songs', 'versions']) {
      test(`direct ${locale} ${kind} arrival never starts the rolled-back application`, async ({page, transition}) => {
        const path = publicRoute(transition, locale, kind);
        transition.switchTo('rollback');
        const response = await page.goto(transition.origin + path);
        expect(response.status()).toBe(200);
        await staticRecovery(page, path, kind === 'songs' ? 'song' : 'version');
        await expect(page.locator('html')).toHaveAttribute('lang', locale === 'zh-hans' ? 'zh-Hans' : locale);
        const scripts = transition.requests.filter(row => /\.m?js(?:\?|$)/.test(row.url));
        expect(scripts, 'Recovery arrivals must execute neither candidate nor baseline scripts').toEqual([]);
        expect(transition.requests.filter(row => row.url === path)).toHaveLength(1);
        expect(transition.errors).toEqual([]);
      });
    }
  });
}

test('recovery preserves genuine unknown-route 404s', async ({page, transition}) => {
  transition.switchTo('rollback');
  const response = await page.goto(transition.origin + '/en/songs/never-published-fixture/');
  expect(response.status()).toBe(404);
  await expect(page.locator('meta[name="maimai-route-recovery"]')).toHaveCount(0);
});

async function holdRouteFetch(page, origin, path) {
  let arrived, resume, finished;
  const arrival = new Promise(resolve => { arrived = resolve; });
  const release = new Promise(resolve => { resume = resolve; });
  const settled = new Promise(resolve => { finished = resolve; });
  page.on('requestfinished', request => { if (request.url() === origin + path && request.resourceType() === 'fetch') finished(); });
  page.on('requestfailed', request => { if (request.url() === origin + path && request.resourceType() === 'fetch') finished(); });
  await page.route(origin + path, async route => {
    if (route.request().resourceType() !== 'fetch') return route.continue();
    arrived();
    await release;
    await route.continue();
  });
  return {arrival, resume, settled};
}

test('recovery during a direct song self-fetch performs one full static navigation', async ({page, transition}) => {
  const path = publicRoute(transition), hold = await holdRouteFetch(page, transition.origin, path);
  transition.switchTo('candidate');
  try {
    await page.goto(transition.origin + path + '?ignored=fixture#chart-fixture', {waitUntil: 'domcontentloaded'});
    await hold.arrival;
    transition.switchTo('rollback');
    hold.resume();
    await staticRecovery(page, path);
    expect(new URL(page.url()).search).toBe('');
    expect(new URL(page.url()).hash).toBe('#chart-fixture');
    const requests = transition.requests.filter(row => new URL(row.url, transition.origin).pathname === path);
    expect(requests.map(row => row.servedBy)).toEqual(['candidate', 'rollback', 'rollback']);
    expect(transition.errors).toEqual([]);
  } finally { hold.resume(); }
});

async function songLink(page) {
  const row = page.locator('#songs .song-row').first();
  await row.locator('.chart-row').first().click();
  const link = row.locator('a[data-song-page]');
  await expect(link).toBeVisible();
  return link;
}

for (const cancel of [false, true]) {
  test(`late recovery ${cancel ? 'cannot override a newer tab choice' : 'replaces song soft navigation with a static arrival'}`, async ({page, transition}) => {
    transition.switchTo('candidate');
    await boot(page, transition, 'modular');
    const link = await songLink(page), path = new URL(await link.getAttribute('href'), transition.origin).pathname;
    const hold = await holdRouteFetch(page, transition.origin, path);
    try {
      await link.click();
      await hold.arrival;
      transition.switchTo('rollback');
      if (cancel) {
        await page.locator('#compare-tab').click();
        await expect(page.locator('#compare')).toBeVisible();
      }
      hold.resume();
      await hold.settled;
      if (cancel) {
        await expect(page.locator('#compare')).toBeVisible();
        expect(new URL(page.url()).pathname).toBe('/');
        await expect(page.locator('meta[name="maimai-route-recovery"]')).toHaveCount(0);
      } else await staticRecovery(page, path);
      expect(transition.errors).toEqual([]);
    } finally { hold.resume(); }
  });
}

test('Back restoration into recovery reloads the matching static song once', async ({page, transition}) => {
  transition.switchTo('candidate');
  await boot(page, transition, 'modular');
  const link = await songLink(page), path = new URL(await link.getAttribute('href'), transition.origin).pathname;
  await link.click();
  await expect(page.locator('#seo-route-view .song-workspace')).toBeVisible();
  // Tab choices replace their entry. A deliberate language change pushes a
  // second song route, so Back actually restores the first song's entry.
  await page.locator('.language-controls [data-language="ja"]:visible').first().click();
  await expect(page).toHaveURL(transition.origin + path.replace('/en/', '/ja/'));
  const hold = await holdRouteFetch(page, transition.origin, path);
  try {
    await page.goBack();
    await hold.arrival;
    transition.switchTo('rollback');
    hold.resume();
    await staticRecovery(page, path);
    expect(transition.requests.filter(row => row.url === path && row.servedBy === 'rollback')).toHaveLength(2);
    expect(transition.errors).toEqual([]);
  } finally { hold.resume(); }
});

test('an already-open song can finish comparison after recovery using its immutable catalog', async ({page, transition}) => {
  const path = publicRoute(transition), resource = transition.artifacts.candidate.boundResources.catalog;
  const hold = await pauseAssetBeforeDispatch(page, transition.origin + resource.lateURL);
  transition.switchTo('candidate');
  try {
    await page.goto(transition.origin + path);
    await expect(page.locator('#seo-route-view .song-workspace')).toBeVisible();
    await page.locator('#seo-route-view .chart-detail-actions button').first().click();
    await hold.arrived;
    transition.switchTo('rollback');
    hold.release();
    await expect(page.locator('#compare')).toBeVisible();
    await expect(page.locator('#compare-left-search')).not.toHaveValue('');
    expect(transition.requests.some(row => row.url === resource.lateURL && row.servedBy === 'rollback' && row.sha256 === resource.lateSha256)).toBe(true);
    expect(transition.errors).toEqual([]);
  } finally { hold.release(); }
});

test('static chart links enter the exact old chart and pinned retained catalog', async ({page, transition}) => {
  const path = publicRoute(transition);
  transition.switchTo('rollback');
  await page.goto(transition.origin + path);
  await staticRecovery(page, path);
  const link = page.locator('.seo-table a[href*="chart="]').first();
  const target = new URL(await link.getAttribute('href'), transition.origin);
  expect([...target.searchParams.keys()].sort()).toEqual(['chart', 'version', 'view']);
  expect(target.searchParams.get('version')).toBe('transition-fictional');
  const chart = target.searchParams.get('chart');
  await link.click();
  await expect(page.locator('#songs .chart-pattern-detail').first()).toBeVisible();
  expect(new URL(page.url()).searchParams.get('chart')).toBe(chart);
  await expect(page.locator('script[type=module][data-maimai-browser]')).toHaveCount(0);
  expect(transition.errors).toEqual([]);
});

