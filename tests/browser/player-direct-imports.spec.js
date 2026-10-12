import { test, expect } from "./fixtures.js";
import { selectImportMethod } from './player-import-fixture.mjs';
import { readFile } from "node:fs/promises";

const messages = JSON.parse(
  await readFile(
    new URL(
      "../../src/maimai_intelligence/assets/locales/player-connections.json",
      import.meta.url,
    ),
    "utf8",
  ),
).messages;
const translated = (key, locale) =>
  locale === "en" ? key : messages[key][locale];
const legacy = "a".repeat(40);
test.beforeEach(async ({ page, fixtureOrigins }) => {
  for (const origin of [
    "https://kamai.tachi.ac",
    "https://auth.diving-fish.com",
  ])
    fixtureOrigins.synthetic(origin);
  await page.addInitScript(() => {
    localStorage.setItem("maimai-language-v1", "en");
    sessionStorage.setItem(
      "maimai-announcement:player-import-sources-v1",
      "seen",
    );
  });
});
async function boot(page) {
  await page.goto("/lab/");
  await expect
    .poll(() => page.evaluate(() => !!window.maimaiPersonal))
    .toBe(true);
  await page.evaluate(() => maimaiPersonal.ready);
}
async function openImport(page, provider) {
  await page.locator("#settings-toggle").click();
  await page.locator("#player-import").click();
  if (provider) await selectImportMethod(page, provider);
}
async function accept(page, remember = true) {
  await expect(page.getByRole('heading', { name: 'Import this profile?', exact: true })).toBeVisible();
  await expect(page.locator("#player-import-dialog .player-remember")).toBeVisible();
  await page
    .locator("#player-import-dialog .player-remember input")
    .setChecked(remember);
  await page.locator("#player-import-dialog .player-actions button").first().click();
  await expect
    .poll(() => page.evaluate(() => maimaiPersonal.enabled()))
    .toBe(true);
  await expect(page.locator("#player-import-dialog")).not.toBeVisible();
}
async function saved(page) {
  return page.evaluate(async () => {
    const state = await maimaiPlayerStorage.read();
    return state.active
      ? {
          ...state.active,
          bytes: undefined,
          data: await maimaiPlayerData.decode(state.active.bytes),
        }
      : null;
  });
}
async function age(page) {
  await page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const request = indexedDB.open("maimai-player-data", 2);
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("datasets", "readwrite"),
        store = transaction.objectStore("datasets"),
        request = store.get("active");
      request.onsuccess = () =>
        store.put(
          {
            ...request.result,
            source: { ...request.result.source, lastAttempt: 0, retryAt: null },
          },
          "active",
        );
      transaction.oncomplete = resolve;
      transaction.onabort = reject;
    });
    db.close();
  });
}
async function configureKamaitachi(page) {
  return page.evaluate((legacy) => {
    const chart = maimaiResearchCatalog.catalog[0];
    maimaiPersonal.configure({
      ...maimaiResearchCatalog,
      provider_mapping: {
        schema_version: "provider-mapping-2",
        charts: {
          [legacy]: {
            chart_id: chart.chart_id,
            format: chart.format,
            difficulty: chart.difficulty,
            acceptance_basis: "reviewed",
            expected_source: {
              title: chart.title,
              artist: chart.artist,
              format: chart.format,
              difficulty: chart.difficulty,
            },
          },
        },
      },
    });
    return chart;
  }, legacy);
}
async function mockKamaitachi(context, chart) {
  const state = { failing: false, empty: false, missingGame: false, requests: [] };
  const song = {
    id: "synthetic-song",
    title: chart.title,
    artist: chart.artist,
  };
  const difficulty = {
    BASIC: "Basic",
    ADVANCED: "Advanced",
    EXPERT: "Expert",
    MASTER: "Master",
    "RE:MASTER": "Re:Master",
  }[chart.difficulty];
  const body = {
    songs: [song],
    charts: [
      {
        game: "maimaidx",
        chartID: "synthetic-chart",
        legacyChartID: legacy,
        song,
        level: chart.level || "13",
        levelNum: 13,
        isPrimary: true,
        difficulty: (chart.format === "DX" ? "DX " : "") + difficulty,
        data: { displayVersion: "PRiSM", inGameID: 999999 },
      },
    ],
    pbs: [
      {
        userID: 42,
        game: "maimaidx",
        chartID: "synthetic-chart",
        songID: "synthetic-song",
        isPrimary: true,
        timeAchieved: null,
        scoreData: {
          percent: 99.1234,
          lamp: "FULL COMBO",
          grade: "SS",
          optional: {},
          judgements: {},
        },
        calculatedData: { rate: 250 },
      },
    ],
  };
  await context.route("https://kamai.tachi.ac/**", async (route) => {
    state.requests.push(route.request().url());
    await route.fulfill({
      status: state.failing ? 503 : state.missingGame && route.request().url().endsWith('/pbs/all') ? 404 : 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        success: true,
        body: route.request().url().endsWith("/pbs/all")
          ? state.empty ? { songs: [], charts: [], pbs: [] } : body
          : { id: 42, username: "Fixture42" },
      }),
    });
  });
  return state;
}
async function mockOAuth(context, { enabled = true } = {}) {
  const state = {
    grants: [],
    calls: [],
    nextID: 0,
    readFail: false,
    disconnectFail: false,
    empty: false,
    agreementRequired: false,
    records: null,
    enabled,
    fetchedAt: Date.now(),
  };
  const fulfill = (route, value, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(value),
    });
  await context.route("**/api/player-import/oauth/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname.split("/").slice(4);
    const body = request.method() === "POST" ? request.postDataJSON() : {};
    state.calls.push({ path: path.join("/"), body });
    if (path[0] === "capabilities")
      return fulfill(route, {
        providers: {
          "diving-fish": { enabled: state.enabled },
        },
      });
    if (path[0] === "status")
      return fulfill(route, { connections: state.grants });
    const [provider, action] = path;
    if (action === "start") {
      state.grants.push({
        provider,
        accountID: "b".repeat(64),
        connectionID: `synthetic_grant_${++state.nextID}_abcdefghijkl`,
        displayName: "Synthetic Connected Player",
        connected: true,
        requiresReconnect: false,
        flowNonce: body.nonce,
        warnings: provider === "diving-fish" ? ["fish_masking_unverified"] : [],
      });
      const origin = "https://auth.diving-fish.com";
      return fulfill(route, {
        authorizationURL:
          origin +
          "/oauth/authorize?state=" +
          body.nonce +
          "&fixture_origin=" +
          encodeURIComponent(url.origin),
      });
    }
    if (action === "callback")
      return route.fulfill({
        contentType: "text/html",
        body: `<script>window.opener?.postMessage(${JSON.stringify({ type: "maimai-party-oauth", provider, status: "connected", nonce: url.searchParams.get("state") })},${JSON.stringify(url.origin)});window.close()</script>`,
      });
    if (action === "read") {
      if (state.readFail) return fulfill(route, { error: "unavailable" }, 503);
      if (state.agreementRequired) return fulfill(route, { error: 'tracker_agreement_required' }, 403);
      const grant = state.grants.find(
        (row) =>
          row.provider === provider && row.connectionID === body.connectionID,
      );
      if (!grant) return fulfill(route, { error: "connection_changed" }, 409);
      const common = {
        level_index: 3,
        achievements: 99.4321,
        fc: "fc",
        fs: "",
        level: "13",
      };
      const data = {
              nickname: "Synthetic Connected Player",
              records: state.empty ? [] : state.records ?? [
                {
                  ...common,
                  song_id: 999999,
                  title: "Synthetic Unknown OAuth Chart",
                  type: "DX",
                  dxScore: 1000,
                  ds: 13,
                },
              ],
            };
      return fulfill(route, {
        ...grant,
        coverage: "full",
        fetchedAt: state.fetchedAt,
        capturedAt: null,
        data,
      });
    }
    if (action === "disconnect") {
      if (state.disconnectFail)
        return fulfill(route, { error: "unavailable" }, 503);
      state.grants = state.grants.filter(
        (row) =>
          row.provider !== provider ||
          (row.connectionID !== body.connectionID &&
            row.flowNonce !== body.nonce),
      );
      return fulfill(route, { disconnected: true, revocation: "unavailable" });
    }
    return fulfill(route, { error: "not_found" }, 404);
  });
  for (const [origin, provider] of [
    ["https://auth.diving-fish.com", "diving-fish"],
  ]) {
    await context.route(origin + "/oauth/authorize**", (route) => {
      const url = new URL(route.request().url()),
        callback =
          url.searchParams.get("fixture_origin") +
          "/api/player-import/oauth/" +
          provider +
          "/callback?state=" +
          url.searchParams.get("state");
      return route.fulfill({
        contentType: "text/html",
        body: `<script>location.replace(${JSON.stringify(callback)})</script>`,
      });
    });
  }
  return state;
}
async function connect(page, provider) {
  await openImport(page, provider);
  if (provider === "diving-fish")
    await page.locator("#player-fish-masking").check();
  await page.locator("#player-import-dialog .player-actions button").first().click();
  await expect(page.getByRole('heading', { name: 'Import this profile?', exact: true })).toBeVisible();
}

test('exact Fish metadata enables image exports without inventing a release or changing China provenance', async ({ page, context }) => {
  const state = await mockOAuth(context);
  state.records = [{
    song_id: 8, title: 'True Love Song', type: 'SD', level_index: 3,
    achievements: 99.4321, fc: 'fc', fs: '', level: '12', dxScore: 1000, ds: 12.4,
  }];
  await page.addInitScript(() => {
    localStorage.setItem('maimai-chart-sections-v1', JSON.stringify({ chart: false, player: false }));
    window.fishExportJacketDraws = 0;
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (image, ...args) {
      if (window.fishExportJacket && image.src === window.fishExportJacket)
        window.fishExportJacketDraws++;
      return draw.call(this, image, ...args);
    };
  });
  await boot(page);
  const fixture = await page.evaluate(() => {
    // The API record omits artist. The real Fish normalizer must supply this
    // exact identity from the pinned public song table, not from this catalog.
    const chart = maimaiResearchCatalog.catalog[0];
    Object.assign(chart, {
      title: 'True Love Song', artist: 'Kai/クラシック「G線上のアリア」',
      format: 'STD', difficulty: 'MASTER', variant_id: 'ordinary', song_id: 'fish-export-fixture',
    });
    const path = 'media/' + 'e'.repeat(64) + '.webp';
    const reviewed = {
      chart_id: chart.chart_id, format: chart.format, difficulty: chart.difficulty,
      acceptance_basis: 'reviewed', displayVersion: 'maimai',
      expected_source: { title: chart.title, artist: chart.artist, format: chart.format, difficulty: chart.difficulty },
    };
    maimaiPersonal.configure({
      ...maimaiResearchCatalog,
      provider_mapping: {
        schema_version: 'provider-mapping-2',
        charts: { 'fish-reviewed-source-a': reviewed, 'fish-reviewed-source-b': { ...reviewed } },
      },
      artwork: {
        version: 'public-artwork-1',
        songs: { [chart.song_id]: { title: chart.title, artist: chart.artist, path } },
        assets: { [path]: { fixture: true } },
      },
    });
    const canvas = document.createElement('canvas');
    canvas.width = 7; canvas.height = 11;
    const paint = canvas.getContext('2d');
    paint.fillStyle = '#e432a5'; paint.fillRect(0, 0, 7, 11);
    window.fishExportJacket = canvas.toDataURL('image/png');
    const url = new URL(location.href);
    url.searchParams.set('chart', chart.chart_id);
    history.replaceState(null, '', url);
    dispatchEvent(new PopStateEvent('popstate'));
    return { chartID: chart.chart_id, path, jacket: window.fishExportJacket };
  });
  await context.route('**/' + fixture.path, route => route.fulfill({
    contentType: 'image/png', body: Buffer.from(fixture.jacket.split(',')[1], 'base64'),
  }));
  await connect(page, 'diving-fish');
  await expect(page.locator('#player-import-dialog')).not.toContainText('Unmatched PB charts:');
  await accept(page);
  const imported = await saved(page);
  expect(imported.data.player.key).toBe('diving-fish:maimaidx:cn:' + 'b'.repeat(64));
  expect(Object.values(imported.data.charts)).toMatchObject([{
    title: 'True Love Song', artist: 'Kai/クラシック「G線上のアリア」', displayVersion: '',
  }]);
  expect(Object.values(imported.data.records).every(row => row.displayVersion === '')).toBe(true);
  expect(Object.values(imported.data.snapshots).every(row => row.versions.length === 0)).toBe(true);
  expect(imported.data.plays).toEqual({});
  expect(await page.evaluate(chartID => maimaiPersonal.record(maimaiResearchCatalog.catalog.find(row => row.chart_id === chartID))?.achievement, fixture.chartID)).toBe(994321);

  await page.locator('#player-export-best50').click();
  await expect(page.locator('#player-export-version')).toHaveValue('');
  await expect(page.locator('#player-export-generate')).toBeDisabled();
  await expect(page.locator('#player-export-dialog')).toContainText('Your import does not identify its version. Choose the version when these scores were recorded.');
  await page.locator('#player-export-version-button').click();
  await page.getByRole('option', { name: 'maimai DX PRiSM PLUS', exact: true }).click();
  await expect(page.locator('#player-export-summary')).toContainText('Old 35: 1/35 · New 15: 0/15');
  await expect(page.locator('#player-export-summary')).toContainText('Chart release groups use community metadata and may differ by region.');
  await expect(page.locator('#player-export-generate')).toBeEnabled();
  await page.locator('#player-export-generate').click();
  await expect(page.locator('#player-export-download')).toHaveAttribute('href', /^blob:/);
  await expect.poll(() => page.evaluate(() => window.fishExportJacketDraws)).toBeGreaterThan(0);

  await page.keyboard.press('Escape');
  await page.locator('.player-export-achievement').first().click();
  await page.locator('#player-export-partner').selectOption('none');
  await page.evaluate(() => { window.fishExportJacketDraws = 0; });
  await page.locator('#player-export-generate').click();
  await expect(page.locator('#player-export-download')).toHaveAttribute('href', /^blob:/);
  await expect.poll(() => page.locator('#player-export-preview').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.fishExportJacketDraws)).toBeGreaterThan(0);
  const after = await saved(page);
  expect(after.revision).toBe(imported.revision);
  expect(after.data.player.key).toBe(imported.data.player.key);
});

test('four service sections expose five methods, local marks, and keyboard controls', async ({ page, context }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  const state = await mockOAuth(context, { enabled: false });
  await boot(page);
  await openImport(page);
  const dialog = page.locator('#player-import-dialog');
  await expect(dialog.locator('[data-import-service]')).toHaveCount(4);
  await expect(dialog.locator('input[name=player-source]')).toHaveCount(5);
  expect(await dialog.locator('[data-import-service]').evaluateAll(nodes => nodes.map(node => node.dataset.importService))).toEqual(['kamaitachi', 'diving-fish', 'maishift', 'session-report']);
  await expect(dialog.locator('.player-service-body:visible')).toHaveCount(1);
  await expect(dialog.locator('[data-service-toggle="session-report"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(dialog.getByRole('radio')).toHaveCount(2);
  await expect(dialog.locator('input[value=file]')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(dialog.locator('input[value=report]')).toBeChecked();
  expect(state.calls).toEqual([]);
  await expect.poll(() => dialog.locator('.player-service-toggle img').evaluateAll(nodes => nodes.length > 0 && nodes.every(node => node.src.startsWith('data:image/') && node.complete && node.naturalWidth > 0))).toBe(true);
  const kamaitachiMark = dialog.locator('[data-import-service="kamaitachi"] .player-service-toggle img');
  await expect(kamaitachiMark).toHaveCount(1);
  await expect(kamaitachiMark).toHaveAttribute('src', /^data:image\//);
  const kamaitachi = dialog.locator('[data-service-toggle="kamaitachi"]');
  await kamaitachi.focus();
  await page.keyboard.press('Enter');
  await expect(kamaitachi).toBeFocused();
  await expect(kamaitachi).toHaveAttribute('aria-expanded', 'true');
  await expect(dialog.locator('.player-service-body:visible')).toHaveCount(1);
  await expect(dialog).toContainText('Import by username');
  await expect(dialog.getByRole('button', { name: 'Preview scores', exact: true })).toBeVisible();
  await page.locator('#player-kamaitachi-account').fill('UnsubmittedDraft');
  await kamaitachi.focus();
  await page.keyboard.press('Space');
  await expect(dialog.locator('.player-service-body:visible')).toHaveCount(0);
  await expect(dialog.locator('.player-source-footer button')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#player-kamaitachi-account')).toHaveValue('UnsubmittedDraft');
  await selectImportMethod(page, 'diving-fish');
  await expect(dialog.getByRole('radio')).toHaveCount(1);
  await expect(dialog.locator('.player-file-fallback')).toHaveCount(0);
  await expect(dialog.locator('input[data-import-method^="file:"]')).toHaveCount(0);
  await expect(dialog.locator('#player-file-account')).toHaveCount(0);
  await expect(dialog).toContainText('Diving-Fish connection is not available yet.');
  expect(state.calls.every(call => ['capabilities', 'status'].includes(call.path))).toBe(true);
  await selectImportMethod(page, 'file');
  await page.screenshot({ path: testInfo.outputPath('service-import-sections-desktop.png') });
  await dialog.locator('[data-service-toggle="session-report"]').click();
  await page.screenshot({ path: testInfo.outputPath('service-import-overview.png') });
});

test('availability failure differs from disabled Fish, and both preserve the remaining import routes', async ({ page, context }, testInfo) => {
  const state = await mockOAuth(context, { enabled: false });
  await boot(page);
  await openImport(page, 'diving-fish');
  const dialog = page.locator('#player-import-dialog');
  await expect(dialog).toContainText('Diving-Fish connection is not available yet. Please try again later.');
  await expect(dialog.locator('.player-actions button').first()).toBeDisabled();
  await expect(dialog.locator('.player-file-fallback')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('connection-not-enabled.png') });
  await page.keyboard.press('Escape');
  await context.route('**/api/player-import/oauth/capabilities', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await boot(page);
  await openImport(page, 'diving-fish');
  await expect(dialog).toContainText('Could not check Diving-Fish availability. Please try again when online.');
  await expect(dialog).not.toContainText('connection is not available yet');
  await expect(dialog.locator('.player-actions button').first()).toBeDisabled();
  await selectImportMethod(page, 'kamaitachi');
  await page.locator('#player-kamaitachi-account').fill('Fixture42');
  await expect(dialog.getByRole('button', { name: 'Preview scores', exact: true })).toBeEnabled();
  await selectImportMethod(page, 'file');
  await expect(dialog).toContainText('Choose a compressed player file exported by Session Report.');
  await expect(dialog.locator('.player-actions button').first()).toBeEnabled();
  expect(state.calls.every(call => ['capabilities', 'status'].includes(call.path))).toBe(true);
});
test("Kamaitachi public PBs match exactly, survive reload and failed refresh, and Forget stops refresh", async ({
  page,
  context,
}) => {
  await boot(page);
  const chart = await configureKamaitachi(page),
    state = await mockKamaitachi(context, chart);
  await openImport(page, "kamaitachi");
  await page.locator("#player-kamaitachi-account").fill("https://kamai.tachi.ac/u/Fixture42");
  await page.locator("#player-import-dialog .player-actions button").first().click();
  await expect(page.locator("#player-import-dialog .player-remember")).toBeVisible();
  expect(await saved(page)).toBeNull();
  await accept(page);
  const first = await saved(page);
  expect(first.source.account).toBe("42");
  expect(first.data.player.key).toBe("kamaitachi:maimaidx:42");
  expect(Object.keys(first.data.plays)).toHaveLength(0);
  expect(
    Object.values(first.data.snapshots).every((row) => !row.complete),
  ).toBe(true);
  expect(
    await page.evaluate(
      () =>
        maimaiPersonal.record(maimaiResearchCatalog.catalog[0])?.achievement,
    ),
  ).toBe(991234);
  await boot(page);
  await configureKamaitachi(page);
  expect((await saved(page)).revision).toBe(first.revision);
  state.failing = true;
  await age(page);
  await page.locator("#settings-toggle").click();
  await page.locator("#player-refresh").click();
  await expect.poll(() => state.requests.length).toBeGreaterThan(2);
  expect((await saved(page)).revision).toBe(first.revision);
  await page.locator("#settings-toggle").click();
  await page.locator("#player-forget").click();
  await expect.poll(() => saved(page)).toBeNull();
  const count = state.requests.length;
  await page.keyboard.press("Escape");
  await boot(page);
  expect(state.requests).toHaveLength(count);
  expect(await page.evaluate(() => maimaiPersonal.enabled())).toBe(false);
});

test('empty or missing Kamaitachi game profiles preserve the saved profile and can be retried', async ({ page, context }) => {
  await boot(page);
  const chart = await configureKamaitachi(page), state = await mockKamaitachi(context, chart);
  await openImport(page, 'kamaitachi');
  await page.locator('#player-kamaitachi-account').fill('Fixture42');
  await page.getByRole('button', { name: 'Preview scores', exact: true }).click();
  await accept(page);
  const first = await saved(page);
  for (const [flag, message] of [
    ['empty', 'This Kamaitachi profile has no maimai DX personal bests to import. Update its scores in Kamaitachi first, then try again.'],
    ['missingGame', 'This Kamaitachi user has no maimai DX profile. Import maimai DX scores into Kamaitachi first, then try again.'],
  ]) {
    state[flag] = true;
    await openImport(page, 'kamaitachi');
    await page.getByRole('button', { name: 'Preview scores', exact: true }).click();
    await expect(page.locator('#player-import-dialog')).toContainText(message);
    await expect(page.locator('#player-import-dialog .player-remember')).toHaveCount(0);
    expect((await saved(page)).revision).toBe(first.revision);
    state[flag] = false;
    await page.keyboard.press('Escape');
  }
  await openImport(page, 'kamaitachi');
  await page.getByRole('button', { name: 'Preview scores', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Import this profile?', exact: true })).toBeVisible();
  await page.locator('#player-import-dialog .player-actions button').last().click();
  expect((await saved(page)).revision).toBe(first.revision);
});

test("Diving-Fish previews before save, cancel keeps an old grant, unchanged refresh adds no snapshots, and offline Forget is recoverable", async ({
  page,
  context,
}) => {
  const state = await mockOAuth(context);
  await boot(page);
  await connect(page, "diving-fish");
  expect(await saved(page)).toBeNull();
  await expect(page.locator("#player-import-dialog")).toContainText(
    "Unmatched PB charts: 1",
  );
  await accept(page);
  const first = await saved(page),
    original = first.source.connectionID;
  await openImport(page, "diving-fish");
  await page.locator('#player-fish-masking').check();
  await page
    .getByRole("button", { name: "Connect another account", exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Import this profile?', exact: true })).toBeVisible();
  await page.locator("#player-import-dialog .player-actions button").last().click();
  await expect.poll(() => state.grants.length).toBe(1);
  expect(state.grants[0].connectionID).toBe(original);
  expect((await saved(page)).revision).toBe(first.revision);
  state.fetchedAt += 60000;
  await age(page);
  await page.locator("#settings-toggle").click();
  await page.locator("#player-refresh").click();
  await expect
    .poll(() => state.calls.filter((call) => call.path === "diving-fish/read").length)
    .toBe(3);
  expect((await saved(page)).revision).toBe(first.revision);
  expect(Object.keys((await saved(page)).data.snapshots)).toHaveLength(1);
  state.disconnectFail = true;
  await page.locator("#settings-toggle").click();
  await page.locator("#player-forget").click();
  await expect.poll(() => saved(page)).toBeNull();
  await expect(page.locator("#player-import-dialog")).toContainText(
    "Saved player data was removed.",
  );
  await page.keyboard.press("Escape");
  state.disconnectFail = false;
  await openImport(page);
  await page
    .getByRole("button", { name: "Retry connection cleanup", exact: true })
    .click();
  await expect.poll(() => state.grants.length).toBe(0);
  // The mock's grant list changes before its response reaches the browser.
  // Wait for the client to validate that response and persist cleanup completion.
  await expect.poll(() => page.evaluate(() =>
    localStorage.getItem("maimai-provider-cleanup-v1"),
  )).toBeNull();
});

test("Diving-Fish requires masking acknowledgement and one-time consent removes the grant", async ({
  page,
  context,
}) => {
  const state = await mockOAuth(context);
  await boot(page);
  await openImport(page, "diving-fish");
  const next = page.locator("#player-import-dialog .player-actions button").first();
  await expect(page.locator("#player-fish-masking")).toBeVisible();
  await expect(next).toBeDisabled();
  await page.locator("#player-fish-masking").check();
  await next.click();
  await expect(page.getByRole('heading', { name: 'Import this profile?', exact: true })).toBeVisible();
  await expect(page.locator("#player-import-dialog")).toContainText(
    "Diving-Fish score masking could not be verified.",
  );
  await expect(page.locator("#player-import-dialog")).toContainText(
    "The connection service stores an access grant for refreshes.",
  );
  await accept(page, false);
  await expect.poll(() => state.grants.length).toBe(0);
  expect(await saved(page)).toBeNull();
  expect(
    state.calls.find((call) => call.path === "diving-fish/start").body
      .maskingDisabled,
  ).toBe(true);
  await boot(page);
  await expect(page.locator("#player-refresh")).toBeHidden();
});

test('Fish agreement and empty-account failures preserve local data, clean up the new grant, and allow retry', async ({ page, context }) => {
  const fish = await mockOAuth(context);
  await boot(page);
  const chart = await configureKamaitachi(page);
  await mockKamaitachi(context, chart);
  await openImport(page, 'kamaitachi');
  await page.locator('#player-kamaitachi-account').fill('42');
  await page.getByRole('button', { name: 'Preview scores', exact: true }).click();
  await accept(page);
  const first = await saved(page);
  for (const [flag, message] of [
    ['agreementRequired', 'Open Diving-Fish, accept its tracker agreement, and confirm your scores are visible. Then try again.'],
    ['empty', 'No supported scores were found in Diving-Fish. Open its tracker, accept the agreement, and add your scores before trying again.'],
  ]) {
    fish[flag] = true;
    await openImport(page, 'diving-fish');
    await page.locator('#player-fish-masking').check();
    await page.getByRole('button', { name: 'Connect Diving-Fish', exact: true }).click();
    await expect(page.locator('#player-import-dialog')).toContainText(message);
    await expect.poll(() => fish.grants.length).toBe(0);
    expect((await saved(page)).revision).toBe(first.revision);
    fish[flag] = false;
    await page.keyboard.press('Escape');
  }
  await connect(page, 'diving-fish');
  await expect(page.locator('.player-import-replace-warning')).toBeVisible();
  await page.locator('#player-import-dialog .player-actions button').last().click();
  await expect.poll(() => fish.grants.length).toBe(0);
  expect((await saved(page)).revision).toBe(first.revision);
});

test("an interrupted provider grant can be disconnected explicitly without importing scores", async ({
  page,
  context,
}) => {
  const state = await mockOAuth(context);
  state.grants.push({
    provider: "diving-fish",
    accountID: "b".repeat(64),
    connectionID: "orphan_grant_abcdefghijkl",
    displayName: "Interrupted connection",
    connected: true,
    requiresReconnect: false,
    warnings: [],
  });
  await boot(page);
  await openImport(page, "diving-fish");
  await expect(page.locator(".player-provider-connections")).toContainText(
    "Interrupted connection",
  );
  await page
    .getByRole("button", { name: "Disconnect connection", exact: true })
    .click();
  await expect.poll(() => state.grants.length).toBe(0);
  expect(state.calls.some((call) => call.path.endsWith("/read"))).toBe(false);
  expect(await saved(page)).toBeNull();
});

async function unclipped(page) {
  const layout = await page.locator("#player-import-dialog").evaluate((dialog) => {
    const bounds = dialog.getBoundingClientRect();
    const controls = [
      ...dialog.querySelectorAll(
        "input:not([type=radio]):not([type=checkbox]), button, a",
      ),
    ].filter((node) => node.getClientRects().length);
    return {
      contained: controls.every((node) => {
        const rect = node.getBoundingClientRect();
        return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
      }),
      clipped: controls
        .filter((node) => node.scrollWidth > node.clientWidth + 1)
        .map((node) => node.id || node.textContent),
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
  expect(layout).toEqual({ contained: true, clipped: [], overflow: false });
}
for (const locale of ["en", "zh-Hans", "ko", "ja", "id"]) {
  test(
    "direct connection controls stay translated and unclipped in " + locale,
    async ({ page, context }, testInfo) => {
      await mockOAuth(context);
      await boot(page);
      await page.evaluate((locale) => maimaiI18n.setLocale(locale), locale);
      for (const width of [280, 320, 430, 1280]) {
        await page.setViewportSize({ width, height: 1000 });
        await openImport(page, "kamaitachi");
        await expect(page.locator("#player-import-dialog")).toContainText(
          translated("Choose a service and an import method.", locale),
        );
        await expect(page.locator("#player-import-dialog")).toContainText(
          translated("Kamaitachi username or profile URL", locale),
        );
        await unclipped(page);
        if (locale === "en" && width === 1280)
          await page.screenshot({ path: testInfo.outputPath("kamaitachi-desktop.png") });
        await selectImportMethod(page, 'diving-fish');
        await expect(page.locator("#player-fish-masking")).toBeVisible();
        await expect(page.locator("#player-import-dialog")).toContainText(
          translated("I have disabled score masking in Diving-Fish.", locale),
        );
        await expect(page.getByRole('button', { name: translated('Connect Diving-Fish', locale), exact: true })).toBeDisabled();
        await unclipped(page);
        if (locale === "en" && width === 1280)
          await page.screenshot({ path: testInfo.outputPath("diving-fish-desktop.png") });
        if (width === 280 || width === 320)
          await page.screenshot({
            path: testInfo.outputPath("direct-import-" + locale + "-" + width + ".png"),
          });
        await selectImportMethod(page, 'maishift');
        await unclipped(page);
        await selectImportMethod(page, 'report');
        await unclipped(page);
        await selectImportMethod(page, 'file');
        await unclipped(page);
        await page.locator('#player-import-dialog .player-source-footer button').click();
      }
      expect(await saved(page)).toBeNull();
    },
  );
}
