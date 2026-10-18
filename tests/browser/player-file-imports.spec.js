import { test, expect } from "./fixtures.js";
import { selectImportMethod } from "./player-import-fixture.mjs";
import { readFile } from "node:fs/promises";

const translations = JSON.parse(
  await readFile(
    new URL(
      "../../src/maimai_intelligence/assets/locales/player-file-imports.json",
      import.meta.url,
    ),
    "utf8",
  ),
).messages;
const translated = (source, locale) =>
  locale === "en" ? source : translations[source][locale];

test.beforeEach(async ({ page }) => {
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
  await expect(page.locator("#catalog-count strong")).toHaveText("6");
}

async function snapshot(
  page,
  {
    unmatched = true,
    achievement = 987654,
    date = "2026-10-01T12:00:00Z",
  } = {},
) {
  return page.evaluate(
    ({ unmatched, achievement, date }) => {
      const chart = maimaiResearchCatalog.catalog[0];
      const row = {
        songId: "abcdefgh:i11",
        songName: chart.title,
        artist: chart.artist,
        type: chart.format,
        difficulty: chart.difficulty,
        achievement,
        fc: "fc",
        fs: "",
        dxScore: null,
        level: chart.level || "",
        levelPrecise: null,
      };
      return {
        fetchedAt: date,
        displayName: "Synthetic Snapshot",
        songs: [
          row,
          ...(unmatched
            ? [
                {
                  ...row,
                  songId: "ijklmnop:i11",
                  songName: "Unmatched fictional chart",
                  artist: "",
                  achievement: 800000,
                },
              ]
            : []),
        ],
      };
    },
    { unmatched, achievement, date },
  );
}

async function openFileOptions(
  page,
  {
    format = "tomomai",
    account = "FileFixture",
    region = "intl",
    instance,
  } = {},
) {
  await page.locator("#settings-toggle").click();
  await page.locator("#player-import").click();
  await expect(page.locator("input[value=file]")).toBeChecked();
  await expect(page.locator("#player-file-format")).toHaveCount(0);
  await selectImportMethod(
    page,
    format === "portable" ? "file" : `file:${format}`,
  );
  await page.locator("#player-file-account").fill(account);
  await page.locator("#player-file-region").selectOption(region);
  if (instance !== undefined)
    await page.locator("#player-file-instance").fill(instance);
}

async function uploadSelected(page, data) {
  const choosing = page.waitForEvent("filechooser");
  await page
    .locator("#player-import-dialog .player-actions button")
    .first()
    .click();
  const chooser = await choosing;
  // Synthetic bytes remain in memory; no private export is placed in the served tree.
  await chooser.setFiles({
    name: "synthetic-player-export.json",
    mimeType: "application/json",
    buffer: Buffer.from(typeof data === "string" ? data : JSON.stringify(data)),
  });
}

async function preview(page, data, options) {
  await openFileOptions(page, options);
  await uploadSelected(page, data);
  await expect(
    page.locator("#player-import-dialog .player-remember"),
  ).toBeVisible();
}

async function commit(page) {
  const previousRevision = await page.evaluate(
    async () => (await maimaiPlayerStorage.read()).active?.revision ?? null,
  );
  await page.locator("#player-import-dialog .player-remember input").check();
  await page
    .locator("#player-import-dialog .player-actions button")
    .first()
    .click();
  await expect(page.locator("#player-import-dialog")).not.toBeVisible();
  // Closing consent precedes compression and the atomic IndexedDB save. An
  // earlier profile can already be enabled while this replacement is pending.
  await expect
    .poll(() =>
      page.evaluate(async (previous) => {
        const revision = (await maimaiPlayerStorage.read()).active?.revision;
        return typeof revision === "string" && revision !== previous;
      }, previousRevision),
    )
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => maimaiPersonal.enabled()))
    .toBe(true);
}

async function saved(page) {
  return page.evaluate(async () => {
    const state = await maimaiPlayerStorage.read();
    if (!state.active) return null;
    const data = await maimaiPlayerData.decode(state.active.bytes);
    return {
      data,
      source: state.active.source ?? null,
      revision: state.active.revision,
    };
  });
}

test("JSON preview preserves exact and unmatched scores, reloads locally, and never contacts a provider", async ({
  page,
}) => {
  const requests = [];
  page.on("request", (request) => requests.push({url:request.url(), method:request.method()}));
  await boot(page);
  const data = await snapshot(page);
  await preview(page, data);
  const dialog = page.locator("#player-import-dialog");
  await expect(dialog).toContainText("Partial score snapshot");
  await expect(dialog).toContainText("Unmatched PB charts: 1");
  await expect(dialog).toContainText(
    "Unmatched charts are retained but are not attached to catalog results.",
  );
  await expect(dialog).toContainText("Missing charts are kept.");
  await commit(page);
  const first = await saved(page);
  expect(first.data.player.key).toBe("tomomai:maimaidx:intl:FileFixture");
  expect(first.source).toBeNull();
  expect(Object.keys(first.data.charts)).toHaveLength(2);
  expect(Object.keys(first.data.plays)).toHaveLength(0);
  expect(
    Object.values(first.data.snapshots).every((row) => !row.complete),
  ).toBe(true);
  expect(
    Object.values(first.data.records).every((row) => row.timeAchieved === null),
  ).toBe(true);
  expect(
    await page.evaluate(
      () =>
        maimaiPersonal.record(maimaiResearchCatalog.catalog[0])?.achievement,
    ),
  ).toBe(987654);
  await expect(page.locator("#player-refresh")).toBeHidden();
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!window.maimaiPersonal))
    .toBe(true);
  await page.evaluate(() => maimaiPersonal.ready);
  await expect(page.locator("#catalog-count strong")).toHaveText("6");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          maimaiPersonal.record(maimaiResearchCatalog.catalog[0])?.achievement,
      ),
    )
    .toBe(987654);
  expect((await saved(page)).revision).toBe(first.revision);
  const origin = new URL(page.url()).origin;
  expect(
    requests.filter(
      ({url, method}) =>
        /^https?:/.test(url) &&
        (new URL(url).origin !== origin ||
          (new URL(url).pathname.startsWith("/api/player-import/") &&
            !(method === "GET" && new URL(url).pathname === "/api/player-import/oauth/connectors" && !new URL(url).search))),
    ),
  ).toEqual([]);
});

for (const [format, data] of [
  [
    "mai-tools",
    [
      {
        songName: "Fictional Chart",
        genre: "maimai",
        chartType: 1,
        difficulty: 3,
        achievement: 100.1234,
        fcap: "AP+",
        level: 13.7,
      },
    ],
  ],
  [
    "dxrating",
    [
      {
        sheetId: "Fictional Chart__dxrt__dx__dxrt__master",
        achievementRate: 100.1234,
      },
    ],
  ],
  [
    "jietng",
    {
      format: "JiETNGExport",
      schema_version: 2,
      maimai_version: "intl",
      generated_at: "2026-10-10T20:30:00",
      profile: { name: "Fictional Player" },
      records: {
        best: [
          {
            title: "Fictional Chart",
            type: "DX",
            difficulty: "Master",
            achievement: 100.1234,
            internal_level: 13.7,
            dx_score: 1023,
            dx_score_max: 1500,
            combo: "AP+",
            sync: "FDX+",
          },
        ],
        recent: [],
      },
    },
  ],
]) {
  test(
    format + " native JSON previews before a persistent local commit",
    async ({ page }) => {
      await boot(page);
      await preview(page, data, { format });
      expect(await saved(page)).toBeNull();
      await commit(page);
      const imported = (await saved(page)).data;
      expect(imported.player.provider).toBe(format);
      expect(
        Object.values(imported.records).map((row) => row.achievement),
      ).toEqual([1001234]);
      expect(Object.keys(imported.plays)).toHaveLength(0);
    },
  );
}

test("account and private server labels are required before selecting a file", async ({
  page,
}) => {
  await boot(page);
  await openFileOptions(page, {
    format: "aqua",
    account: "",
    region: "private",
  });
  await page
    .locator("#player-import-dialog .player-actions button")
    .first()
    .click();
  await expect(page.locator("#player-file-account")).toBeFocused();
  await page.locator("#player-file-account").fill("Fixture");
  await page
    .locator("#player-import-dialog .player-actions button")
    .first()
    .click();
  await expect(page.locator("#player-file-instance")).toBeFocused();
  expect(await saved(page)).toBeNull();
});

test("partial JSON updates keep omitted charts and malformed files keep the active profile", async ({
  page,
}, testInfo) => {
  await boot(page);
  await preview(page, await snapshot(page));
  await commit(page);
  await preview(
    page,
    await snapshot(page, {
      unmatched: false,
      achievement: 965000,
      date: "2026-10-02T12:00:00Z",
    }),
  );
  await commit(page);
  const updated = await saved(page);
  expect(Object.keys(updated.data.charts)).toHaveLength(2);
  expect(Object.keys(updated.data.snapshots)).toHaveLength(2);
  expect(
    await page.evaluate(async () => {
      const state = await maimaiPlayerStorage.read(),
        data = await maimaiPlayerData.decode(state.active.bytes);
      return maimaiPlayerData.current(data).pbs.size;
    }),
  ).toBe(2);
  expect(
    await page.evaluate(
      () =>
        maimaiPersonal.record(maimaiResearchCatalog.catalog[0])?.achievement,
    ),
  ).toBe(965000);
  await openFileOptions(page);
  await uploadSelected(page, "{invalid");
  await expect(page.locator("#player-import-dialog")).toContainText(
    "Choose a valid JSON export for the selected source.",
  );
  expect((await saved(page)).revision).toBe(updated.revision);
  expect(
    await page.evaluate(
      () =>
        maimaiPersonal.record(maimaiResearchCatalog.catalog[0])?.achievement,
    ),
  ).toBe(965000);
  await page.screenshot({ path: testInfo.outputPath('file-invalid-fixture.png') });
  await page.keyboard.press('Escape');
  await preview(page, await snapshot(page, { achievement: 980000, date: '2026-10-03T12:00:00Z' }));
  expect((await saved(page)).revision).toBe(updated.revision);
  await page.screenshot({ path: testInfo.outputPath('file-recovery-fixture-preview.png') });
  await page.locator('#player-import-dialog .player-actions button').last().click();
  expect((await saved(page)).revision).toBe(updated.revision);
});

test("private-server instances remain separate even for the same account name", async ({
  page,
}) => {
  await boot(page);
  const aqua = (musicId) => ({
    gameId: "SDEZ",
    userData: { userName: "Synthetic Private Player" },
    userMusicDetailList: [
      {
        musicId,
        level: 3,
        achievement: 987654,
        comboStatus: 0,
        syncStatus: 0,
        deluxscoreMax: 1000,
      },
    ],
    userPlaylogList: [],
  });
  await preview(page, aqua(1), {
    format: "aqua",
    account: "PrivateFixture",
    region: "private",
    instance: "one.invalid",
  });
  await commit(page);
  expect((await saved(page)).data.player.key).toBe(
    "aqua:maimaidx:private:PrivateFixture%40one.invalid",
  );
  await preview(page, aqua(2), {
    format: "aqua",
    account: "PrivateFixture",
    region: "private",
    instance: "two.invalid",
  });
  await expect(page.locator(".player-import-replace-warning")).toBeVisible();
  await commit(page);
  const second = await saved(page);
  expect(second.data.player.key).toBe(
    "aqua:maimaidx:private:PrivateFixture%40two.invalid",
  );
  expect(Object.keys(second.data.charts)).toHaveLength(1);
  expect(Object.keys(second.data.snapshots)).toHaveLength(1);
  expect(second.source).toBeNull();
});

test("mixed Aqua Utage exports disclose exclusions and cancel preserves the saved profile", async ({
  page,
}) => {
  await boot(page);
  await preview(page, await snapshot(page));
  await commit(page);
  const original = await saved(page);
  const data = {
    gameId: "SDEZ",
    userData: { userName: "Synthetic Mixed Player" },
    userMusicDetailList: [
      {
        musicId: 1,
        level: 3,
        achievement: 987654,
        comboStatus: 0,
        syncStatus: 0,
        deluxscoreMax: 1000,
      },
      {
        musicId: 100001,
        level: 5,
        achievement: 999999,
        comboStatus: 0,
        syncStatus: 0,
        deluxscoreMax: 1000,
      },
    ],
    userPlaylogList: [],
  };
  const options = {
    format: "aqua",
    account: "PrivateFixture",
    region: "private",
    instance: "fictional.invalid",
  };
  await preview(page, data, options);
  await expect(page.locator("#player-import-dialog")).toContainText(
    "Unsupported Utage rows excluded: 1. Import the remaining scores or cancel to keep your current data.",
  );
  await page
    .locator("#player-import-dialog .player-actions button")
    .last()
    .click();
  await expect(page.locator("#player-import-dialog")).not.toBeVisible();
  expect((await saved(page)).revision).toBe(original.revision);
  expect(
    await page.evaluate(
      () =>
        maimaiPersonal.record(maimaiResearchCatalog.catalog[0])?.achievement,
    ),
  ).toBe(987654);
  await preview(page, data, options);
  await expect(page.locator("#player-import-dialog")).toContainText(
    "Unsupported Utage rows excluded: 1.",
  );
  await commit(page);
  const imported = await saved(page);
  expect(imported.data.player.provider).toBe("aqua");
  expect(Object.keys(imported.data.charts)).toHaveLength(1);
  expect(Object.keys(imported.data.records)).toHaveLength(1);
  expect(Object.values(imported.data.records)[0].achievement).toBe(987654);
  expect(Object.keys(imported.data.plays)).toHaveLength(0);
});

test("long Japanese Tachi identifiers retain observations without inventing plays or PBs", async ({
  page,
}) => {
  await boot(page);
  const title = "架空の日本語楽曲名".repeat(20);
  const data = {
    meta: {
      game: "maimaidx",
      playtype: "Single",
      service: "SyntheticServer",
      version: "fictional-version",
    },
    scores: [
      {
        identifier: title,
        matchType: "songTitle",
        artist: "Authored fixture",
        difficulty: "Master",
        percent: 98,
        lamp: "CLEAR",
        timeAchieved: 1790856000000,
      },
      {
        identifier: title,
        matchType: "songTitle",
        artist: "Authored fixture",
        difficulty: "Master",
        percent: 99,
        lamp: "CLEAR",
      },
    ],
  };
  await preview(page, data, {
    format: "tachi",
    account: "PrivateFixture",
    region: "private",
    instance: "fictional.invalid",
  });
  await expect(page.locator("#player-import-dialog")).toContainText(
    "Unlinked score observations: 2.",
  );
  await commit(page);
  const state = await saved(page);
  expect(Object.keys(state.data.charts)).toHaveLength(1);
  expect(Object.keys(state.data.charts)[0].length).toBeLessThan(256);
  expect(Object.values(state.data.charts)[0].title).toBe(title);
  expect(Object.keys(state.data.records)).toHaveLength(2);
  expect(Object.keys(state.data.plays)).toHaveLength(0);
  expect(
    Object.values(state.data.snapshots).every(
      (row) => Object.keys(row.pbs).length === 0,
    ),
  ).toBe(true);
});

async function expectUnclippedDialog(page) {
  const { selectionMeasurements, ...layout } = await page
    .locator("#player-import-dialog")
    .evaluate((dialog) => {
      const bounds = dialog.getBoundingClientRect();
      const controls = [
        ...dialog.querySelectorAll(
          "select, input:not([type=radio]):not([type=checkbox]), button, a",
        ),
      ].filter(
        (node) =>
          node.getClientRects().length &&
          getComputedStyle(node).visibility !== "hidden",
      );
      const contained = controls.every((node) => {
        const rect = node.getBoundingClientRect();
        return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
      });
      const clipped = controls
        .filter((node) => node.scrollWidth > node.clientWidth + 1)
        .map((node) => node.id || node.textContent);
      const canvas = document.createElement("canvas"),
        context = canvas.getContext("2d");
      const selectionMeasurements = controls
        .filter((node) => node.tagName === "SELECT")
        .map((node) => {
          const style = getComputedStyle(node);
          context.font = style.font;
          const text = node.selectedOptions[0]?.textContent || "";
          return {
            id: node.id,
            text,
            font: style.font,
            width: node.clientWidth,
            requiredWidth:
              context.measureText(text).width +
              parseFloat(style.paddingLeft) +
              parseFloat(style.paddingRight) +
              20,
          };
        });
      const clippedSelection = selectionMeasurements.some(
        ({ requiredWidth, width }) => requiredWidth > width + 1,
      );
      const overlappingLabels = [
        ...dialog.querySelectorAll(".player-source-fields label"),
      ].some((label) => {
        const control = label.querySelector("input, select");
        if (!control || !control.getClientRects().length) return false;
        const controlRect = control.getBoundingClientRect();
        return [...label.childNodes]
          .filter(
            (node) =>
              node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
          )
          .some((node) => {
            const range = document.createRange();
            range.selectNodeContents(node);
            return [...range.getClientRects()].some(
              (rect) =>
                rect.right > controlRect.left + 1 &&
                rect.left < controlRect.right - 1 &&
                rect.bottom > controlRect.top + 1 &&
                rect.top < controlRect.bottom - 1,
            );
          });
      });
      return {
        contained,
        clipped,
        clippedSelection,
        selectionMeasurements,
        overlappingLabels,
        pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      };
    });
  expect(layout, JSON.stringify(selectionMeasurements)).toEqual({
    contained: true,
    clipped: [],
    clippedSelection: false,
    overlappingLabels: false,
    pageOverflow: false,
  });
}

for (const locale of ["en", "zh-Hans", "ko", "ja", "id"]) {
  for (const width of [280, 320, 430, 1280]) {
    test(
      `file controls and preview are translated and unclipped in ${locale} at ${width}px`,
      async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 1000 });
        await boot(page);
        const data = await snapshot(page);
        await page.evaluate((locale) => maimaiI18n.setLocale(locale), locale);
        for (const format of [
          "mai-tools",
          "dxrating",
          "jietng",
          "aqua",
          "tachi",
        ]) {
          const isPrivate = format === "aqua" || format === "tachi";
          await openFileOptions(page, {
            format,
            region: isPrivate ? "private" : "intl",
            ...(isPrivate ? { instance: "fixture.invalid" } : {}),
          });
          await expect(page.locator("#player-import-dialog")).toContainText(
            translated("Source account (to identify your imports)", locale),
          );
          if (isPrivate)
            await expect(page.locator("#player-import-dialog")).toContainText(
              translated("Server name", locale),
            );
          await expectUnclippedDialog(page);
          if (locale === 'en' && width === 320 && format === 'mai-tools')
            await page.screenshot({ path: testInfo.outputPath('mai-tools-account-en-320.png') });
          if (locale === 'en' && width === 1280)
            await page.screenshot({ path: testInfo.outputPath('file-source-' + format + '.png') });
          await page.keyboard.press("Escape");
        }
        await openFileOptions(page);
        await expect(page.locator("#player-import-dialog")).toContainText(
          translated("Source account (to identify your imports)", locale),
        );
        await expect(page.locator("#player-file-instance")).toHaveCount(0);
        await expectUnclippedDialog(page);
        if (locale === 'en' && width === 1280)
          await page.screenshot({ path: testInfo.outputPath('file-source-tomomai.png') });
        await uploadSelected(page, data);
        await expect(
          page.locator("#player-import-dialog .player-remember"),
        ).toBeVisible();
        await expect(page.locator("#player-import-dialog")).toContainText(
          translated("Partial score snapshot", locale),
        );
        await expect(page.locator("#player-import-dialog")).toContainText(
          translated(
            "Unmatched charts are retained but are not attached to catalog results.",
            locale,
          ),
        );
        await expectUnclippedDialog(page);
        if (width === 320)
          await page.screenshot({
            path: testInfo.outputPath("file-import-preview-" + locale + ".png"),
          });
        await page
          .locator("#player-import-dialog .player-actions button")
          .last()
          .click();
        await expect(page.locator("#player-import-dialog")).not.toBeVisible();
        expect(await saved(page)).toBeNull();
      },
    );
  }
}
