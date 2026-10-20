import {test, expect} from './fixtures.js';
import {selectImportMethod} from './player-import-fixture.mjs';
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';

const flagsPath = '**/api/player-import/oauth/connectors';
const dialog = page => page.locator('#player-import-dialog');
const services = page => dialog(page).locator('[data-import-service]');

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('maimai-language-v1', 'en');
    sessionStorage.setItem('maimai-announcement:player-import-sources-v1', 'seen');
  });
});

async function boot(page) {
  await page.goto('/lab/');
  await expect.poll(() => page.evaluate(() => !!window.maimaiPersonal)).toBe(true);
  await page.evaluate(() => maimaiPersonal.ready);
}
async function openImport(page) {
  await page.locator('#settings-toggle').click();
  await page.locator('#player-import').click();
  await expect(dialog(page)).toBeVisible();
}
async function closeImport(page) {
  await page.keyboard.press('Escape');
  await expect(dialog(page)).not.toBeVisible();
}
async function flagFixture(context, methods) {
  const state = {methods, status:200, malformed:false, reads:0};
  await context.route(flagsPath, route => {
    state.reads++;
    return route.fulfill({status:state.status, contentType:'application/json', body:state.malformed ? '{invalid' : JSON.stringify({schemaVersion:1,methods:state.methods})});
  });
  return state;
}
async function serviceIDs(page) {
  return services(page).evaluateAll(nodes => nodes.map(node => node.dataset.importService));
}

test('connector boxes turn off and back on between openings without reloading or changing saved data', async ({page, context}, testInfo) => {
  const state = await flagFixture(context, {file:true, 'file:tomomai':true});
  await boot(page);
  const before = await page.evaluate(() => maimaiPlayerStorage.read());
  await openImport(page);
  await expect(services(page)).toHaveCount(2);
  expect(await serviceIDs(page)).toEqual(['session-report', 'tomomai']);
  await page.screenshot({path:testInfo.outputPath('connector-visibility-before.png')});
  await closeImport(page);
  state.methods = {file:true};
  await openImport(page);
  await expect(services(page)).toHaveCount(1);
  expect(await serviceIDs(page)).toEqual(['session-report']);
  await page.screenshot({path:testInfo.outputPath('connector-visibility-hidden.png')});
  await closeImport(page);
  state.methods = {file:true, 'file:tomomai':true};
  await openImport(page);
  await expect(services(page)).toHaveCount(2);
  await selectImportMethod(page, 'file:tomomai');
  await expect(page.locator('#player-file-account')).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('connector-visibility-restored.png')});
  expect(state.reads).toBe(3);
  expect(await page.evaluate(() => maimaiPlayerStorage.read())).toEqual(before);
});

test('method flags hide only that method and remove a service when its last method is off', async ({page, context}) => {
  const state = await flagFixture(context, {kamaitachi:true, 'file:tachi':false, file:false, report:true});
  await boot(page); await openImport(page);
  await expect(services(page)).toHaveCount(2);
  await selectImportMethod(page, 'kamaitachi');
  await expect(page.locator('#player-kamaitachi-account')).toBeVisible();
  await expect(dialog(page).getByText('Upload BATCH-MANUAL', {exact:true})).toHaveCount(0);
  await selectImportMethod(page, 'report');
  await expect(page.locator('#player-report-url')).toBeVisible();
  await expect(dialog(page).getByRole('button', {name:'Choose file', exact:true})).toHaveCount(0);
  await closeImport(page);
  state.methods = {kamaitachi:false, 'file:tachi':true};
  await openImport(page);
  await expect(services(page)).toHaveCount(1);
  expect(await serviceIDs(page)).toEqual(['kamaitachi']);
  await expect(page.locator('#player-kamaitachi-account')).toHaveCount(0);
  await expect(page.locator('#player-file-instance')).toBeVisible();
  await expect(dialog(page).getByRole('button', {name:'Choose file', exact:true})).toBeVisible();
});

test('valid all-off flags respect the choice while an unavailable manifest offers local recovery and Retry works', async ({page, context}) => {
  const state = await flagFixture(context, {});
  await boot(page); await openImport(page);
  await expect(dialog(page)).toContainText('No import options are available right now.');
  await expect(services(page)).toHaveCount(0);
  await expect(dialog(page).getByRole('button', {name:'Choose file', exact:true})).toHaveCount(0);
  await closeImport(page);
  state.status = 503;
  await openImport(page);
  await expect(dialog(page)).toContainText('You can still upload a Session Report file.');
  await expect(services(page)).toHaveCount(1);
  expect(await serviceIDs(page)).toEqual(['session-report']);
  state.status = 200; state.methods = {'file:tomomai':true};
  await dialog(page).getByRole('button', {name:'Retry', exact:true}).click();
  await expect(page.locator('#player-file-account')).toBeVisible();
  expect(await serviceIDs(page)).toEqual(['tomomai']);
  expect(state.reads).toBe(3);
});

test('malformed flags discard previous allow state and do not start provider reads', async ({page, context}) => {
  const state = await flagFixture(context, {'file:tomomai':true});
  const providerRequests = [];
  page.on('request', request => {
    if (/\/api\/player-import\/(?:maishift|oauth\/(?!connectors))/.test(request.url()) || /kamai\.tachi\.ac/.test(request.url())) providerRequests.push(request.url());
  });
  await boot(page);
  await openImport(page);
  await expect(services(page)).toHaveCount(1);
  expect(await serviceIDs(page)).toEqual(['tomomai']);
  await closeImport(page); state.malformed = true;
  await openImport(page);
  await expect(dialog(page)).toContainText('You can still upload a Session Report file.');
  expect(await serviceIDs(page)).toEqual(['session-report']);
  expect(providerRequests).toEqual([]);
});

test('closing a pending check cannot overwrite a newer import window with its late response', async ({page, context}) => {
  let reads = 0, releaseFirst;
  const held = new Promise(resolve => {releaseFirst = resolve;});
  await context.route(flagsPath, async route => {
    reads++;
    const first = reads === 1;
    if (first) await held;
    await route.fulfill({status:200, contentType:'application/json', body:JSON.stringify({schemaVersion:1,methods:first ? {} : {'file:tomomai':true}})}).catch(() => {});
  });
  await boot(page); await openImport(page);
  await expect(dialog(page)).toContainText('Checking import options…');
  await expect.poll(() => reads).toBe(1);
  await closeImport(page);
  await openImport(page);
  await expect(page.locator('#player-file-account')).toBeVisible();
  releaseFirst();
  await expect.poll(() => reads).toBe(2);
  expect(await serviceIDs(page)).toEqual(['tomomai']);
  await expect(dialog(page)).not.toContainText('No import options are available right now.');
});

test('hiding every method preserves a real remembered dataset and leaves data controls available', async ({page, context}) => {
  const state = await flagFixture(context, {file:true});
  await boot(page);
  const raw = JSON.parse(await readFile(new URL('../../output/reconciliation-fixture.json', import.meta.url), 'utf8'));
  const data = await page.evaluate(raw => maimaiPlayerData.reconcile(raw), raw);
  await openImport(page);
  await expect(dialog(page).getByRole('button', {name:'Choose file', exact:true})).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await dialog(page).getByRole('button', {name:'Choose file', exact:true}).click();
  await (await chooser).setFiles({name:'fictional-session.gz', mimeType:'application/gzip', buffer:gzipSync(Buffer.from(JSON.stringify(data)))});
  await page.getByLabel('Remember on this device', {exact:true}).check();
  await page.getByRole('button', {name:'Import data', exact:true}).click();
  await expect.poll(() => page.evaluate(() => maimaiPersonal.enabled())).toBe(true);
  const saved = await page.evaluate(() => maimaiPlayerStorage.read());
  expect(saved.active).not.toBeNull();
  state.methods = {};
  await openImport(page);
  await expect(services(page)).toHaveCount(0);
  await expect(dialog(page)).toContainText('No import options are available right now.');
  expect(await page.evaluate(() => maimaiPlayerStorage.read())).toEqual(saved);
  expect(await page.evaluate(() => maimaiPersonal.enabled())).toBe(true);
  await closeImport(page);
  await page.locator('#settings-toggle').click();
  await expect(page.locator('#player-toggle')).toBeVisible();
  await expect(page.locator('#player-forget')).toBeVisible();
});

for (const locale of ['en', 'ja', 'ko', 'zh-Hans', 'id']) test('flag recovery and all-off controls fit narrow screens in ' + locale, async ({page, context}) => {
  const state = await flagFixture(context, {});
  await boot(page);
  await page.evaluate(locale => maimaiI18n.setLocale(locale), locale);
  for (const width of [280, 320]) {
    await page.setViewportSize({width, height:800});
    for (const status of [200, 503]) {
      state.status = status;
      await openImport(page);
      if (status === 200) await expect(dialog(page).getByRole('button')).toHaveCount(2);
      else await expect(services(page)).toHaveCount(1);
      const layout = await dialog(page).evaluate(root => {
        const visible = [...root.querySelectorAll('button, input, select')].filter(node => node.getClientRects().length);
        const bounds = root.getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          contained: visible.every(node => {const r = node.getBoundingClientRect(); return r.left >= bounds.left && r.right <= bounds.right;}),
          clipped: visible.some(node => node.scrollWidth > node.clientWidth + 1),
        };
      });
      expect(layout).toEqual({overflow:false, contained:true, clipped:false});
      await closeImport(page);
    }
  }
});
