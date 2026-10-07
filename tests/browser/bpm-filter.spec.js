import { test, expect } from './fixtures.js';
import AxeBuilder from '@axe-core/playwright';

async function open(page) {
  await page.addInitScript(() => {
    localStorage.setItem('maimai-catalog-filters-collapsed', '0');
    localStorage.setItem('maimai-language-v1', 'en');
  });
  await page.goto('/registry/?search=ソテリア&view=catalog');
  await expect(page.locator('#songs .song-row')).toHaveCount(4);
  await expect(page.locator('#bpm-filter-field')).toBeVisible();
  return page.evaluate(() => {
    const ids = [...document.querySelectorAll('#songs .song-row')].map(row => row.dataset.chartId);
    return ids.map(id => maimaiResearchCatalog.navigation.charts[id]?.bpm).filter(bpm => typeof bpm === 'number' && bpm > 0);
  });
}

async function setBpm(page, operator, value) {
  await page.locator('#filter-bpm-operator').selectOption(operator);
  await page.locator('#filter-bpm-value').fill(String(value));
  await page.locator('#filter-bpm-value').press('Enter');
}

test('BPM has inclusive comparisons, exact equality and one removable filter', async ({ page }) => {
  const bpms = await open(page);
  const initialChips = await page.locator('#active-filters .filter-chip').count();
  expect(bpms.every(bpm => typeof bpm === 'number' && Number.isFinite(bpm) && bpm > 0)).toBe(true);
  expect(bpms).toHaveLength(2); // Two other fixture charts deliberately have unknown BPM.
  expect(new Set(bpms).size).toBe(1);
  const bpm = bpms[0];
  const rows = page.locator('#songs .song-row');
  const field = page.locator('#filter-bpm-value');
  const operator = page.locator('#filter-bpm-operator');
  await expect(operator).toHaveValue('eq');
  await expect(field).toHaveValue('');
  expect(await operator.locator('option').allTextContents()).toEqual(['≤', '=', '≥']);
  for (const op of ['lte', 'eq', 'gte']) {
    await setBpm(page, op, bpm);
    await expect(rows).toHaveCount(2);
    await expect(page.locator('#catalog-filter-count')).toHaveText(`${initialChips + 1} active`);
    await expect(page.getByRole('button', { name: 'Remove BPM filter', exact: true })).toHaveCount(1);
  }
  await setBpm(page, 'lte', bpm - 0.5);
  await expect(rows).toHaveCount(0);
  await operator.selectOption('gte');
  await expect(rows).toHaveCount(2);
  await operator.selectOption('eq');
  await expect(rows).toHaveCount(0);
  await setBpm(page, 'lte', bpm + 0.5);
  await expect(rows).toHaveCount(2);
  await operator.selectOption('gte');
  await expect(rows).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove BPM filter', exact: true }).click();
  await expect(rows).toHaveCount(4);
  await expect(operator).toHaveValue('eq');
  await expect(field).toHaveValue('');
  await expect(field).toBeFocused();
  await operator.selectOption('gte');
  await expect(rows).toHaveCount(4);
  await expect(page.locator('#active-filters .filter-chip')).toHaveCount(initialChips);
});

test('BPM composes with difficulty, retains valid state on errors, and clears reliably', async ({ page }) => {
  const [bpm] = await open(page);
  const initialChips = await page.locator('#active-filters .filter-chip').count();
  const field = page.locator('#filter-bpm-value');
  const rows = page.locator('#songs .song-row');
  await page.locator('#difficulty-summary').click();
  await page.locator('#difficulty-options input[value="EXPERT"]').check();
  await page.locator('#difficulty-summary').click();
  await setBpm(page, 'gte', bpm);
  await expect(rows).toHaveCount(1);
  await expect(page.locator('#active-filters .filter-chip')).toHaveCount(initialChips + 2);
  for (const draft of ['0', '-1', 'not a number', 'Infinity', '180 BPM']) {
    await field.fill(draft);
    await field.press('Enter');
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(rows).toHaveCount(1);
    await expect(page.locator('#bpm-filter-error')).not.toBeEmpty();
  }
  await field.press('Escape');
  await expect(field).toHaveValue(String(bpm));
  await expect(field).not.toHaveAttribute('aria-invalid', 'true');
  // Clearing by blur must remove only BPM, not the independent difficulty filter.
  await field.fill('');
  await field.press('Tab');
  await expect(page.locator('#active-filters .filter-chip')).toHaveCount(initialChips + 1);
  await expect(rows).toHaveCount(1);
  await setBpm(page, 'lte', bpm);
  // A chip click must survive an uncommitted draft and the associated blur.
  await field.fill(String(bpm + 1));
  await page.getByRole('button', { name: 'Remove BPM filter', exact: true }).click();
  await expect(field).toHaveValue('');
  await expect(page.locator('#active-filters .filter-chip')).toHaveCount(initialChips + 1);
  await setBpm(page, 'gte', bpm);
  await page.locator('#reset-filters').click();
  await expect(field).toHaveValue('');
  await expect(page.locator('#filter-bpm-operator')).toHaveValue('eq');
  await expect(page.locator('#search')).toHaveValue('');
  await expect(page.locator('#active-filters .filter-chip')).toHaveCount(0);
  await expect(rows).toHaveCount(await page.evaluate(() => maimaiResearchCatalog.catalog.length));
});

for (const locale of ['en', 'ja', 'ko', 'zh-Hans', 'id']) {
  test(`BPM controls retain values, labels and fit in ${locale}`, async ({ page }, testInfo) => {
    const [bpm] = await open(page);
    await setBpm(page, 'gte', bpm);
    await page.locator(`.site-header [data-language="${locale}"]`).click();
    const field = page.locator('#filter-bpm-value');
    const operator = page.locator('#filter-bpm-operator');
    await expect(field).toHaveValue(String(bpm));
    await expect(operator).toHaveValue('gte');
    await expect(page.locator('#bpm-filter-field')).toHaveCount(1);
    expect(await field.getAttribute('aria-label')).toBeTruthy();
    if (locale !== 'en') expect(await field.getAttribute('aria-label')).not.toBe('BPM value');
    for (const width of [1280, 390, 280]) {
      await page.setViewportSize({ width, height: 900 });
      await field.fill('invalid');
      await field.press('Enter');
      await expect(field).toHaveAttribute('aria-invalid', 'true');
      expect(await page.locator('#bpm-filter-field').evaluate(root => {
        const controls = [root, ...root.querySelectorAll('input,select,p')];
        return controls.every(node => {
          const box = node.getBoundingClientRect();
          return box.left >= 0 && box.right <= innerWidth && node.scrollWidth <= node.clientWidth + 1;
        }) && document.documentElement.scrollWidth <= innerWidth;
      })).toBe(true);
      await page.locator('#catalog-filters').screenshot({ path: testInfo.outputPath(`bpm-${locale}-${width}-invalid.png`) });
      await field.press('Escape');
      await page.locator('#catalog-filters').screenshot({ path: testInfo.outputPath(`bpm-${locale}-${width}.png`) });
    }
    expect((await new AxeBuilder({ page }).include('#bpm-filter-field').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  });
}

test('BPM excludes missing values, composes with levels, and filters comparison matches', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('maimai-catalog-filters-collapsed', '0'));
  await page.goto('/lab/');
  await expect(page.locator('#songs .song-row')).toHaveCount(6);
  await expect.poll(() => page.evaluate(() => !!window.maimaiResearchCatalog)).toBe(true);
  const metadata = await page.evaluate(() => Object.fromEntries(maimaiResearchCatalog.catalog.map(c => [c.chart_id, maimaiResearchCatalog.navigation.charts[c.chart_id]?.bpm ?? null])));
  expect(Object.values(metadata).filter(value => value === null)).toHaveLength(1);
  await setBpm(page, 'lte', 120);
  await expect(page.locator('#songs .song-row')).toHaveCount(2);
  await page.locator('#filter-min').fill('11');
  await page.locator('#filter-min').press('Enter');
  await expect(page.locator('#songs .song-row')).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove minimum level filter', exact: true }).click();
  await expect(page.locator('#songs .song-row')).toHaveCount(2);
  await page.locator('#compare-tab').click();
  const picker = page.locator('#compare-left-search');
  // Study 4 is a different song family from the two 120 BPM charts.
  await picker.fill('Fictional study 4');
  await picker.press('ArrowDown');
  await picker.press('Enter');
  await page.locator('#similar-use-filters').check();
  await page.locator('#find-similar').click();
  const matches = page.locator('#similar-results [data-compare-chart]');
  await expect(matches).toHaveCount(1);
  for (const id of await matches.evaluateAll(nodes => nodes.map(node => node.dataset.compareChart))) expect(metadata[id]).toBe(120);
  await page.locator('#similar-use-filters').uncheck();
  await expect.poll(() => matches.count()).toBeGreaterThan(1);
  const unfiltered = await matches.evaluateAll(nodes => nodes.map(node => node.dataset.compareChart));
  expect(unfiltered.some(id => metadata[id] === null || metadata[id] > 120)).toBe(true);
});

test('BPM survives song navigation and Back; legacy snapshots reset it', async ({ page, baseURL }) => {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== baseURL) return route.abort();
    const response = await route.fetch({ url: baseURL + '/registry' + url.pathname + url.search });
    await route.fulfill({ response });
  });
  await page.addInitScript(() => localStorage.setItem('maimai-catalog-filters-collapsed', '0'));
  await page.goto('/?search=ソテリア&view=catalog');
  await expect(page.locator('#songs .song-row')).toHaveCount(4);
  await expect.poll(() => page.evaluate(() => !!window.maimaiBrowserState)).toBe(true);
  const bpm = await page.evaluate(() => [...document.querySelectorAll('#songs .song-row')].map(row => maimaiResearchCatalog.navigation.charts[row.dataset.chartId]?.bpm).find(value => typeof value === 'number' && value > 0));
  await setBpm(page, 'gte', bpm);
  const row = page.locator('#songs .song-row').first();
  await row.locator('.chart-row').click();
  await row.locator('a[data-song-page]').click();
  await expect(page.locator('#seo-route-view')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#filter-bpm-value')).toHaveValue(String(bpm));
  await expect(page.locator('#filter-bpm-operator')).toHaveValue('gte');
  await expect(page.locator('#songs .song-row')).toHaveCount(2);
  expect(await page.evaluate(() => {
    const snapshot = maimaiBrowserState.capture();
    delete snapshot.chartFilters.bpm;
    return maimaiBrowserState.restore(snapshot);
  })).toBe(true);
  await expect(page.locator('#filter-bpm-value')).toHaveValue('');
  await expect(page.locator('#filter-bpm-operator')).toHaveValue('eq');
  await expect(page.getByRole('button', { name: 'Remove BPM filter', exact: true })).toHaveCount(0);
});

test('localized decimals and extreme valid values remain valid after Enter then blur', async ({ page }) => {
  await open(page);
  const field = page.locator('#filter-bpm-value');
  for (const [draft, expected] of [['１８０，５', '180.5'], ['0.0000001', '0.0000001'], ['1000000000000000000000', '1000000000000000000000']]) {
    await field.fill(draft);
    await field.press('Enter');
    await field.press('Tab');
    await expect(field).toHaveValue(expected);
    await expect(field).not.toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('button', { name: 'Remove BPM filter', exact: true })).toHaveCount(1);
  }
});
