import { test, expect } from './fixtures.js';
import { mountRegistryPage } from './registry-page-mount.mjs';

const labels = {
  en: 'Find a chart',
  'zh-Hans': '查找谱面',
  ko: '채보 찾기',
  ja: '譜面を探す',
  id: 'Cari chart',
};
const choose = (page, locale) =>
  page.locator('.site-header [data-language="' + locale + '"]').click();
const settle = async (page) => {
  await expect(page.locator('#songs .song-row').first()).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('maimai-catalog-filters-collapsed', '0');
    localStorage.setItem('maimai-personal-filters-collapsed', '0');
  });
});

for (const width of [280, 320, 360, 390, 420, 768, 1280]) {
  test(`five-language controls preserve chart identity and fit at ${width}px`, async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/registry/?view=catalog');
    await settle(page);
    await page.locator('#search').fill('ソテリア');
    const row = page.locator('#songs .song-row[data-difficulty=MASTER]');
    await expect(row).toHaveCount(1);
    const identity = await row.getAttribute('data-chart-id');
    const data = await page.evaluate(() => JSON.stringify(maimaiResearchCatalog));
    for (const locale of ['en', 'zh-Hans', 'ko', 'ja', 'id', 'en']) {
      await choose(page, locale);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('#catalog h1')).toHaveText(labels[locale]);
      await expect(page.locator('#search')).toHaveValue('ソテリア');
      await expect(row).toHaveAttribute('data-chart-id', identity);
      await expect(row).toContainText('ソテリア');
      expect(await page.evaluate(() => JSON.stringify(maimaiResearchCatalog))).toBe(data);
      const controls = page.locator('.site-header .language-controls');
      await expect(controls.locator('button')).toHaveCount(5);
      const layout = await controls.evaluate((group) => {
        const buttons = [...group.querySelectorAll('button')].map((node) => node.getBoundingClientRect());
        const brand = group.closest('.site-header').querySelector('.party-brand').getBoundingClientRect();
        return {
          pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
          brandOverlap: buttons.some((rect) => Math.min(rect.right, brand.right) > Math.max(rect.left, brand.left) + 1 && Math.min(rect.bottom, brand.bottom) > Math.max(rect.top, brand.top) + 1),
          clipped: buttons.some((rect) => rect.width <= 0 || rect.left < 0 || rect.right > innerWidth + 1),
          overlap: buttons.some((a, i) => buttons.some((b, j) => i < j &&
            Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1 &&
            Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1)),
        };
      });
      expect(layout, locale + ' at ' + width + 'px').toEqual({ pageOverflow: false, brandOverlap: false, clipped: false, overlap: false });
      if (locale === 'id') {
        const clipping = await page.locator('.site-header nav').evaluate((nav) =>
          [...nav.querySelectorAll(':scope > button > span:first-child')].some((label) => {
            const range = document.createRange();
            range.selectNodeContents(label);
            const button = label.parentElement.getBoundingClientRect();
            const context = document.createElement('canvas').getContext('2d');
            context.font = getComputedStyle(label).font;
            if (label.textContent.trim().split(/\s+/).some((word) => context.measureText(word).width > label.getBoundingClientRect().width + 1)) return true;
            return [...range.getClientRects()].some((rect) => rect.width > 0 &&
              (rect.left < button.left - 1 || rect.right > button.right + 1));
          }),
        );
        expect(clipping).toBe(false);
        await page.screenshot({ path: testInfo.outputPath(`indonesian-header-${width}.png`) });
      }
    }
    expect(errors).toEqual([]);
  });
}

// Wider fallback metrics reproduce the 280px overflow found on Linux CI.
for (const width of [280, 320]) for (const font of ['Verdana, sans-serif', 'monospace']) {
  test(`Indonesian controls fit ${font} at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/registry/?view=catalog');
    await settle(page);
    await choose(page, 'id');
    await expect(page.locator('html')).toHaveAttribute('lang', 'id');
    await page.evaluate(font => document.documentElement.style.fontFamily = font, font);
    const nav = page.locator('.site-header nav');
    expect(await nav.evaluate(node => {
      const box = node.getBoundingClientRect();
      const children = [...node.children], rectangles = children.map(child => child.getBoundingClientRect());
      return children.every((child, index) => {
        const rect = rectangles[index], label = child.querySelector(':scope > span:first-child');
        if (label) {
          const range = document.createRange();
          range.selectNodeContents(label);
          if ([...range.getClientRects()].some(text => text.left < rect.left - 1 || text.right > rect.right + 1)) return false;
        }
        return rect.left >= box.left - 1 && rect.right <= box.right + 1 && rect.height >= 44 &&
          rectangles.every((other, otherIndex) => index === otherIndex ||
            Math.min(rect.right, other.right) <= Math.max(rect.left, other.left) + 1 ||
            Math.min(rect.bottom, other.bottom) <= Math.max(rect.top, other.top) + 1);
      });
    })).toBe(true);
    for (const region of ['', 'JP', 'INTL']) {
      await page.locator('#filter-region [data-region="' + region + '"]').click();
      expect(await page.locator('#filter-region button').evaluateAll(buttons => buttons.every(button => {
        const box = button.getBoundingClientRect(), range = document.createRange();
        range.selectNodeContents(button);
        return [...range.getClientRects()].every(rect => rect.left >= box.left - 1 &&
          rect.right <= box.right + 1 && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1);
      }))).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
    await page.locator('#filter-region').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('indonesian-fallback-font.png') });
  });
}

test('Indonesian selection persists and opens its complete README', async ({ page }) => {
  await page.goto('/registry/?view=catalog');
  await settle(page);
  await choose(page, 'id');
  await expect(page.locator('.site-header [data-language=id]')).toHaveAccessibleName('Bahasa Indonesia');
  await page.reload();
  await settle(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'id');
  await page.locator('#about-tab').click();
  await expect(page.locator('a[data-localized-readme]')).toHaveAttribute('href',
    'https://github.com/arussin/maimai-chart-browser/blob/main/README.id.md');
  await page.goto('/registry/player-import-help.id.html');
  await expect(page.locator('html')).toHaveAttribute('lang', 'id');
  await expect(page.locator('h1')).toHaveText('Impor data pemain');
  await expect(page.locator('#session-report')).toHaveCount(1);
  await expect(page.locator('#maishift')).toHaveCount(1);
});


test('id-ID negotiation, explicit preferences and denied storage work in a real browser', async ({ browser, baseURL }) => {
  for (const denied of [false, true]) {
    const context = await browser.newContext({ locale: 'id-ID' });
    try {
      if (denied) await context.addInitScript(() => Object.defineProperty(window, 'localStorage', {
        get() { throw new DOMException('Unavailable', 'SecurityError'); },
      }));
      const page = await context.newPage();
      await page.goto(baseURL + '/registry/?view=catalog');
      await settle(page);
      await expect(page.locator('html')).toHaveAttribute('lang', 'id');
      await expect(page.locator('#catalog h1')).toHaveText('Cari chart');
      await choose(page, 'ja');
      await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
      await page.reload();
      await settle(page);
      await expect(page.locator('html')).toHaveAttribute('lang', denied ? 'id' : 'ja');
      await page.goto(baseURL + '/registry/?view=catalog&lang=id');
      await settle(page);
      await expect(page.locator('html')).toHaveAttribute('lang', 'id');
      await choose(page, 'en');
      await expect(page.locator('#catalog h1')).toHaveText('Find a chart');
    } finally { await context.close(); }
  }
});

test('Indonesian routes override query and storage and preserve International preference', async ({ page, request, baseURL }) => {
  await page.addInitScript(() => localStorage.setItem('maimai-language-v1', 'ko'));
  const mount = await mountRegistryPage(page, baseURL);
  try {
    const ledger = await (await request.get('/registry/permalinks.json')).json();
    const slug = Object.values(ledger.songs)[0];
    const path = '/id/songs/' + encodeURIComponent(slug) + '/';
    await page.goto(path + '?lang=ja');
    await expect(page.locator('#seo-route-view .song-workspace')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'id');
    await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', 'https://maimai.party' + path);
    const region = page.locator('#seo-route-view [data-seo-international]');
    await region.check();
    for (const locale of ['en', 'ja', 'ko', 'zh-Hans', 'id']) {
      await choose(page, locale);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(region).toBeChecked();
      await expect(page).toHaveURL(new RegExp('/' + (locale === 'zh-Hans' ? 'zh-hans' : locale) + '/songs/'));
    }
    await page.reload();
    await expect(page.locator('#seo-route-view .song-workspace')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'id');
    await expect(region).toBeChecked();
  } finally { await mount.close(); }
});
