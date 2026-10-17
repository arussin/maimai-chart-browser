import {browserConfigurationFixture} from './browser-configuration-fixture.mjs';
import {test, expect} from './fixtures.js';
test.beforeEach(async({fixtureOrigins})=>{for(const origin of ["https://maimai.party", "https://js.stripe.com", "https://checkout.stripe.com"])fixtureOrigins.synthetic(origin);});
import AxeBuilder from '@axe-core/playwright';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve, extname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';

const root = resolve(process.env.MAIMAI_BROWSER_OUTPUT || fileURLToPath(new URL('../../output/browser-tests/', import.meta.url)));
const storageKey = 'support.checkout.v2.maimai-party';
const mime = {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml'};
// No Stripe account or hosted site is contacted. This models the SDK lifecycle;
// actual regional method rendering remains a separate owner-run sandbox gate.
const sdk = `window.Stripe = () => ({createEmbeddedCheckoutPage: async options => {
  await options.fetchClientSecret();
  let frame;
  const receive = e => {if(e.origin === 'https://checkout.stripe.com' && e.data === 'fixture-complete') options.onComplete();};
  window.addEventListener('message', receive);
  return {mount: node => {frame=document.createElement('iframe'); frame.title='Stripe checkout fixture';
    frame.src='https://checkout.stripe.com/fixture'; frame.setAttribute('allow','payment');
    frame.style.cssText='width:100%;height:300px;border:0'; node.append(frame);},
    destroy: () => {frame?.remove();window.removeEventListener('message', receive);}};
}});`;
const frameHTML = `<!doctype html><html lang="en"><head><title>Checkout fixture</title></head>
<body><main><h1>Stripe test double</h1><p>No real payment. This is a test fixture, not Stripe's design.</p>
<label>Amount (test fixture only) <input id="amount" value="5.00"></label><p role="status" id="result"></p>
<button id="pay">Complete test payment</button><button id="decline">Decline test payment</button>
<script>document.getElementById('pay').onclick=()=>parent.postMessage('fixture-complete','https://maimai.party');
document.getElementById('decline').onclick=()=>document.getElementById('result').textContent='Your card was declined. Try another payment method.';</script></main></body></html>`;

async function hosted(context, {enabled = true, failScript = false, failCreate = 0, stallInit = false} = {}) {
  const state = {api: [], external: [], sessions: new Map(), status: 'open', failStatus: false};
  const configuration=await browserConfigurationFixture(resolve(root,'registry'),value=>({...value,support:{...value.support,enabled,publishableKey:'pk_test_fixture'}}));
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  const supportOriginal=await readFile(resolve(root,'registry','support-config.js'));
  const supportOriginalPath=`browser-resources/${hash(supportOriginal)}.js`;
  if(!(await readFile(resolve(root,'registry',supportOriginalPath))).equals(supportOriginal))throw Error('Support fixture integrity mismatch');
  const supportBody=Buffer.from(supportOriginal.toString().replace(/enabled:\s*(?:!0|!1|true|false)/,'enabled:'+enabled).replace(/publishableKey:\s*['"][^'"]*['"]/,"publishableKey:'pk_test_fixture'"));
  const supportPath=`browser-resources/${hash(supportBody)}.js`;
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname !== 'maimai.party') {
      state.external.push({url: request.url(), body: request.postData() || '', headers: await request.allHeaders()});
      if (url.hostname === 'js.stripe.com') return failScript ? route.abort() :
        route.fulfill({contentType: 'application/javascript', body: stallInit ?
          sdk.replace('let frame;', 'window.__stripeInitWaiting = true; return new Promise(() => {}); let frame;') : sdk});
      if (url.hostname === 'checkout.stripe.com') return route.fulfill({contentType: 'text/html', body: frameHTML});
      return route.fulfill({status: 204, body: ''});
    }
    if (url.pathname.startsWith('/api/support/')) {
      const data = request.postDataJSON();
      state.api.push({path: url.pathname, data, headers: await request.allHeaders(), url: request.url()});
      if (url.pathname.endsWith('/status')) return route.fulfill({status: state.failStatus ? 503 : 200,
        json: state.failStatus ? {error: 'unavailable'} : {status: state.status}});
      // Model Stripe accepting a create even if its response is lost in transit.
      if (!state.sessions.has(data.attempt)) state.sessions.set(data.attempt, {
        session: 'cs_test_' + data.attempt.replaceAll('-', '')});
      const value = state.sessions.get(data.attempt);
      if (failCreate-- > 0) return route.fulfill({status: 502, json: {error: 'unavailable'}});
      return route.fulfill({json: {status: state.status, session: value.session, clientSecret: 'fixture_client_secret'}});
    }
    if (url.pathname === '/api/player-import/oauth/connectors') return route.fulfill({json: {
      schemaVersion: 1, methods: {file: true, report: true, 'file:tomomai': true},
    }});
    if(url.pathname==='/'+configuration.reference.path)return route.fulfill({contentType:'application/json',body:configuration.body});
    if(url.pathname==='/'+supportPath||url.pathname==='/support-config.js')return route.fulfill({contentType:'application/javascript',body:supportBody});
    // Serve the actual allowlisted release, including its stricter return page.
    const path = resolve(root, 'registry', '.' + url.pathname + (url.pathname.endsWith('/') ? 'index.html' : ''));
    if (!path.startsWith(resolve(root, 'registry') + sep)) return route.abort();
    try {
      let bytes = await readFile(path);
      if(extname(path)==='.html')bytes=Buffer.from(configuration.rewriteDocument(bytes).toString().replaceAll('src="'+supportOriginalPath+'"','src="'+supportPath+'"'));
      return route.fulfill({contentType: mime[extname(path)] || 'application/octet-stream', body: bytes});
    } catch { return route.fulfill({status: 404, body: 'Missing fixture'}); }
  });
  return state;
}
async function open(page, {keepNotice = false} = {}) {
  if (!keepNotice && await page.locator('#analytics-notice').isVisible())
    await page.locator('#analytics-notice [data-analytics-choice=denied]').click();
  await page.locator('#about-tab').click();
  await page.locator('#support-open').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#support-checkout-dialog')).toBeVisible();
  await expect(page.locator('#support-checkout-dialog')).toHaveCSS('opacity', '1');
}
const frame = page => page.frameLocator('iframe[title="Stripe checkout fixture"]');
const payment = page => frame(page).getByRole('button', {name: 'Complete test payment'});

async function playerBoot(page) {
  await page.addInitScript(() => {
    localStorage.setItem('maimai-language-v1', 'en');
    localStorage.setItem('maimai-chart-sections-v1', JSON.stringify({chart: false, player: false}));
    window.supportPaintText = [];
    const paint = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
      window.supportPaintText.push(String(text)); return paint.call(this, text, ...args);
    };
    window.supportEvents = [];
    addEventListener('maimai:support', event => window.supportEvents.push(event.detail));
  });
  await page.goto('https://maimai.party/?view=catalog');
  await expect.poll(() => page.evaluate(() => !!window.maimaiPersonal)).toBe(true);
  await page.evaluate(() => maimaiPersonal.ready);
  if (await page.locator('#analytics-notice').isVisible())
    await page.locator('#analytics-notice [data-analytics-choice=denied]').click();
}

async function importSupportFixture(page) {
  const data = await page.evaluate(async () => {
    const core = maimaiPlayerData, catalog = maimaiResearchCatalog, chart = catalog.catalog[0];
    const chartID = 'support-fixture-chart', displayVersion = 'maimaiでらっくす PRiSM PLUS';
    const body = {format: 'maimai-player-data', schemaVersion: 1,
      player: {key: 'kamaitachi:maimaidx:private_support', provider: 'kamaitachi', game: 'maimaidx', username: 'PRIVATE_SUPPORT', displayName: 'PRIVATE_SUPPORT'},
      charts: {[chartID]: {chartID, songID: 'support-fixture-song', title: chart.title, artist: chart.artist, format: chart.format, difficulty: chart.difficulty, level: '14', constant: 140, displayVersion, inGameID: null}},
      records: {}, plays: {}, snapshots: {}, captures: {}};
    const record = {chartID, achievement: 1005000, grade: 'SSS+', rate: 315, lamp: 'ALL PERFECT', sync: '', constant: 140, displayVersion,
      timeAchieved: Date.UTC(2026, 8, 12), dxScore: 2300, maxDxScore: 2500, maxCombo: 500, fast: 0, slow: 0, miss: 0, good: 0, great: 0, perfect: 12, pcrit: 488};
    const recordID = await core.digest(record); body.records[recordID] = record; body.plays['support-fixture-play'] = recordID;
    const snapshot = {capturedAt: Date.UTC(2026, 8, 13), phase: 'after', complete: true, versions: [displayVersion], pbs: {[chartID]: recordID}};
    const snapshotID = await core.digest(snapshot); body.snapshots[snapshotID] = snapshot;
    const capture = {capturedAt: snapshot.capturedAt, sourceKind: 'sync', sourceID: 'support-fixture', sessionID: 'support-fixture', historyCoverage: 'retained-window', playIDs: ['support-fixture-play'], snapshotIDs: [snapshotID]};
    body.captures[await core.digest(capture)] = capture;
    const result = {...body, revision: await core.digest(body)}; await core.validate(result);
    maimaiPersonal.configure(catalog, {schema_version: 'provider-mapping-1', charts: {[chartID]: {chart_id: chart.chart_id, source_hash: chart.source_hash}}});
    const url = new URL(location.href); url.searchParams.set('chart', chart.chart_id); history.replaceState(null, '', url); dispatchEvent(new PopStateEvent('popstate'));
    return result;
  });
  await page.locator('input[type=file]').setInputFiles({name: 'PRIVATE-support.gz', mimeType: 'application/gzip', buffer: gzipSync(Buffer.from(JSON.stringify(data)))});
  await expect(page.locator('#player-import-dialog .player-support-prompt')).toHaveCount(0);
  await page.locator('#player-import-dialog .player-remember input').check();
  await page.locator('#player-import-dialog .player-actions button').first().click();
  await expect.poll(() => page.evaluate(() => maimaiPersonal.enabled())).toBe(true);
  return data.revision;
}

test('Support follows Share in settings, stays lazy, and returns keyboard focus without changing the page', async ({page, context}, testInfo) => {
  test.setTimeout(90000);
  const state = await hosted(context); await playerBoot(page);
  const revision = await importSupportFixture(page), originalURL = page.url();
  const support = page.locator('#site-support');
  await expect(support).toHaveCount(1);
  expect(await support.evaluate(node => node.previousElementSibling.id)).toBe('site-share');
  const labels = {en: 'Support maimai.party', 'zh-Hans': '赞助 maimai.party', ko: 'maimai.party 후원', ja: 'maimai.party を支援', id: 'Dukung maimai.party'};
  for (const locale of ['en', 'zh-Hans', 'ko', 'ja', 'id']) {
    const before = state.api.length, externalBefore = state.external.length;
    await page.evaluate(locale => maimaiI18n.setLocale(locale), locale);
    await page.locator('#settings-toggle').press('ArrowUp');
    await expect(support).toBeFocused(); await expect(support).toHaveText(labels[locale]);
    await expect(support.locator('svg')).toBeVisible();
    await expect(support.locator('svg')).toHaveAttribute('aria-hidden', 'true');
    await expect(support.locator('svg')).toHaveAttribute('fill', 'none');
    for (const width of [1280, 320, 280]) {
      await page.setViewportSize({width, height: 900});
      expect(await page.locator('#settings-menu').evaluate(menu => {
        const bounds = menu.getBoundingClientRect();
        const controls = [...menu.querySelectorAll('[role=menuitem]')].filter(node => node.getBoundingClientRect().width);
        return {inside: bounds.left >= -1 && bounds.right <= innerWidth + 1,
          page: document.documentElement.scrollWidth <= innerWidth + 1,
          clipped: controls.filter(node => {
            const box = node.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(node);
            return node.scrollWidth > node.clientWidth + 1 || [...range.getClientRects()].some(text => text.width && (text.left < box.left - 1 || text.right > box.right + 1 || text.top < box.top - 1 || text.bottom > box.bottom + 1));
          }).map(node => node.id)};
      })).toEqual({inside: true, page: true, clipped: []});
      if ((locale === 'en' && width === 1280) || (locale === 'ja' && width === 320)) await page.screenshot({path: testInfo.outputPath('settings-support-' + locale + '-' + width + '.png')});
    }
    await page.keyboard.press('ArrowUp'); await expect(page.locator('#site-share')).toBeFocused();
    await page.keyboard.press('ArrowDown'); await expect(support).toBeFocused();
    expect(state.api.length).toBe(before); expect(state.external.length).toBe(externalBefore);
    await page.keyboard.press('Enter'); await expect(frame(page).getByRole('heading')).toBeVisible();
    await expect(page.locator('#settings-menu')).toBeHidden();
    await page.keyboard.press('Escape'); await expect(page.locator('#settings-toggle')).toBeFocused();
    await expect(page.locator('#support-checkout-dialog')).toBeHidden();
    expect(page.url()).toBe(originalURL);
    expect(await page.evaluate(async () => (await maimaiPlayerStorage.read()).active.revision)).toBe(revision);
  }
  expect(JSON.stringify(state.api)).not.toContain('PRIVATE');
  expect(await page.evaluate(() => supportEvents.filter(name => name === 'support_opened').length)).toBe(5);
  expect(await page.evaluate(() => supportEvents.every(name => ['support_opened', 'support_checkout_started', 'support_success_return'].includes(name)))).toBe(true);
});

test('plain import support note preserves inputs, focuses its link on return, and fits every language', async ({page, context}, testInfo) => {
  test.setTimeout(90000);
  const state = await hosted(context); await playerBoot(page);
  const revision = await importSupportFixture(page);
  for (const locale of ['en', 'zh-Hans', 'ko', 'ja', 'id']) {
    const apiBefore = state.api.length;
    await page.evaluate(locale => maimaiI18n.setLocale(locale), locale);
    await page.locator('#player-import-primary').click();
    await page.locator('[data-service-toggle="tomomai"]').click();
    const dialog = page.locator('#player-import-dialog'), note = dialog.locator('.player-support-prompt'), link = note.locator('button');
    await page.locator('#player-file-account').fill('PRIVATE_ACCOUNT');
    await page.locator('#player-file-region').selectOption('cn');
    await expect(note).toHaveCount(1);
    if (locale === 'en') {
      await expect(note.locator('p>span')).toHaveText('maimai.party is free to use, but costs quite a bit to maintain.');
      await expect(link).toHaveText('Please consider supporting its development and hosting.');
    } else {
      await expect(note.locator('p>span')).not.toHaveText('maimai.party is free to use, but costs quite a bit to maintain.');
      await expect(link).not.toHaveText('Please consider supporting its development and hosting.');
    }
    for (const width of [1280, 320, 280]) {
      await page.setViewportSize({width, height: 900});
      const geometry = await note.evaluate(node => {
        const heart = node.querySelector('svg').getBoundingClientRect(), text = node.querySelector('p').getBoundingClientRect(), link = node.querySelector('button');
        return {fits: node.scrollWidth <= node.clientWidth + 1 && link.scrollWidth <= link.clientWidth + 1,
          centered: Math.abs(heart.y + heart.height / 2 - text.y - text.height / 2) < 1,
          plain: getComputedStyle(node).borderTopWidth === '0px' && getComputedStyle(node).backgroundColor === 'rgba(0, 0, 0, 0)'};
      });
      expect(geometry).toEqual({fits: true, centered: true, plain: true});
      if (locale === 'en' && width === 1280) await dialog.screenshot({path: testInfo.outputPath('import-support-en-1280.png')});
    }
    expect(await page.locator('#support-checkout-dialog').isVisible()).toBe(false);
    expect(state.api.length).toBe(apiBefore);
    if (locale === 'en') await page.setViewportSize({width: 1280, height: 900});
    await link.focus(); await page.keyboard.press('Enter');
    await expect(frame(page).getByRole('heading')).toBeVisible();
    await expect(dialog).toHaveAttribute('open', '');
    if (locale === 'en') await page.screenshot({path: testInfo.outputPath('import-fixture-checkout-en-1280.png')});
    await page.keyboard.press('Escape');
    await expect(page.locator('#support-checkout-dialog')).toBeHidden();
    await expect(link).toBeFocused();
    await expect(page.locator('#player-file-account')).toHaveValue('PRIVATE_ACCOUNT');
    await expect(page.locator('#player-file-region')).toHaveValue('cn');
    expect(await page.evaluate(async () => (await maimaiPlayerStorage.read()).active.revision)).toBe(revision);
    if (locale === 'en') await dialog.screenshot({path: testInfo.outputPath('import-support-return-focus-en-1280.png')});
    await page.setViewportSize({width: 280, height: 900});
    await dialog.screenshot({path: testInfo.outputPath('import-support-' + locale + '-280.png')});
    await page.keyboard.press('Escape');
  }
  expect(state.api.every(item => Object.keys(item.data).sort().join(',') === (item.data.session ? 'attempt,project,session' : 'attempt,project'))).toBe(true);
  expect(JSON.stringify(state.api)).not.toContain('PRIVATE');
  expect(await page.evaluate(() => supportEvents.filter(name => name === 'support_opened').length)).toBe(5);
});

for (const kind of ['best50', 'pb', 'play']) test('ready-only export support preserves the PNG and imported data: ' + kind, async ({page, context}, testInfo) => {
  test.setTimeout(90000);
  const state = await hosted(context); await playerBoot(page);
  const revision = await importSupportFixture(page);
  await page.locator(kind === 'best50' ? '#player-export-best50' : kind === 'pb' ? '.player-export-achievement' : '.player-export-play').first().click();
  const dialog = page.locator('#player-export-dialog'), note = dialog.locator('.player-support-prompt'), link = note.locator('button');
  await expect(note).toBeHidden(); expect(state.api).toEqual([]);
  await expect(page.locator('#player-export-partner')).toHaveCount(0);
  await page.locator('#player-export-generate').click();
  const download = page.locator('#player-export-download'), preview = page.locator('#player-export-preview');
  await expect(download).toBeVisible(); await expect(note).toBeVisible();
  await expect(note.locator('p>span')).toHaveText('Finding maimai.party useful?');
  const href = await download.getAttribute('href'), src = await preview.getAttribute('src');
  const paint = await page.evaluate(() => supportPaintText.join('\n'));
  expect(paint).not.toContain('Finding maimai.party useful?');
  expect(paint).not.toContain('Please consider supporting its development and hosting.');
  const actions = await dialog.locator('.player-export-actions').boundingBox(), noteBox = await note.boundingBox();
  expect(noteBox.y).toBeGreaterThanOrEqual(actions.y + actions.height);
  if (kind === 'best50') {
    await page.setViewportSize({width: 1280, height: 900});
    await dialog.screenshot({path: testInfo.outputPath('ready-export-support-en-1280.png')});
  }
  if (kind === 'best50') {
    for (const locale of ['en', 'zh-Hans', 'ko', 'ja', 'id']) {
      await page.evaluate(locale => maimaiI18n.setLocale(locale), locale);
      if (locale !== 'en') {
        await expect(note.locator('p>span')).not.toHaveText('Finding maimai.party useful?');
        await expect(link).not.toHaveText('Please consider supporting its development and hosting.');
      }
      for (const width of [1280, 320, 280]) {
        await page.setViewportSize({width, height: 900});
        expect(await note.evaluate(node => {
          const heart = node.querySelector('svg').getBoundingClientRect(), text = node.querySelector('p').getBoundingClientRect(), link = node.querySelector('button');
          return node.scrollWidth <= node.clientWidth + 1 && link.scrollWidth <= link.clientWidth + 1 && Math.abs(heart.y + heart.height / 2 - text.y - text.height / 2) < 1;
        })).toBe(true);
      }
      await note.screenshot({path: testInfo.outputPath('export-support-' + locale + '-280.png')});
      if (locale === 'ja') await dialog.screenshot({path: testInfo.outputPath('ready-export-support-ja-280.png')});
    }
    await page.evaluate(() => maimaiI18n.setLocale('en'));
  }
  expect(state.api).toEqual([]);
  if (kind === 'best50') await page.setViewportSize({width: 1280, height: 900});
  await link.focus(); await page.keyboard.press('Enter');
  await expect(frame(page).getByRole('heading')).toBeVisible();
  if (kind === 'best50') await page.screenshot({path: testInfo.outputPath('export-fixture-checkout-en-1280.png')});
  await page.keyboard.press('Escape'); await expect(link).toBeFocused();
  await expect(download).toHaveAttribute('href', href); await expect(preview).toHaveAttribute('src', src);
  if (kind === 'best50') await dialog.screenshot({path: testInfo.outputPath('export-support-return-focus-en-1280.png')});
  expect(await page.evaluate(async () => (await maimaiPlayerStorage.read()).active.revision)).toBe(revision);
  expect(JSON.stringify(state.api)).not.toContain('PRIVATE');
  expect(state.api[0].data).toEqual({project: 'maimai-party', attempt: (await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), storageKey)).attempt});
  const pending = page.waitForEvent('download'); await download.click(); const file = await pending;
  const bytes = await readFile(await file.path()); expect([...bytes.subarray(0,8)]).toEqual([137,80,78,71,13,10,26,10]);
  await page.keyboard.press('Escape'); await expect(dialog).toBeHidden();
});

test('disabled support leaves import and export available without dormant donation controls', async ({page, context}) => {
  const state = await hosted(context, {enabled: false}); await playerBoot(page);
  await expect(page.locator('#site-support')).toHaveCount(0);
  await page.locator('#player-import-primary').click();
  await expect(page.locator('#player-import-dialog .player-support-prompt')).toHaveCount(0);
  await page.keyboard.press('Escape'); await importSupportFixture(page);
  await page.locator('#player-export-best50').click(); await page.locator('#player-export-generate').click();
  await expect(page.locator('#player-export-download')).toBeVisible();
  await expect(page.locator('#player-export-dialog .player-support-prompt')).toHaveCount(0);
  expect(state.api).toEqual([]); expect(state.external).toEqual([]);
});

test('language changes translate Support without restarting or replacing checkout',async({page,context})=>{
  const state=await hosted(context);await page.goto('https://maimai.party/');await open(page);
  await expect(frame(page).getByRole('heading')).toBeVisible();
  const saved=await page.evaluate(key=>sessionStorage.getItem(key),storageKey),calls=state.api.length;
  const dialog=page.locator('#support-checkout-dialog');
  const original=await dialog.locator('.support-invitation').textContent();
  for(const locale of ['ko','zh-Hans','ja','id']){
    await dialog.locator('[data-language="'+locale+'"]').click();
    await expect(page.locator('html')).toHaveAttribute('lang',locale);
    expect(await dialog.locator('.support-invitation').textContent()).not.toBe(original);
    await expect(frame(page).getByRole('heading')).toBeVisible();
    expect(await page.evaluate(key=>sessionStorage.getItem(key),storageKey)).toBe(saved);
    expect(state.api.length).toBe(calls);
    expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
  }
  await dialog.locator('[data-language="en"]').click();
  await expect(dialog.locator('.support-invitation')).toHaveText(original);
  await dialog.locator('[data-language="ko"]').click();state.status='paid';await payment(page).click();
  await expect(dialog).toHaveAttribute('data-stage','result');
  await expect(dialog.getByRole('button',{name:'다시 후원',exact:true})).toBeVisible();
  const axe=await new AxeBuilder({page}).include('#support-checkout-dialog').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  expect(axe.violations).toEqual([]);
});

test('compact Support errors keep flags and translated controls inside the dialog',async({page,context},testInfo)=>{
  test.setTimeout(90000);
  await hosted(context,{failScript:true});await page.goto('https://maimai.party/');await open(page);
  const dialog=page.locator('#support-checkout-dialog');
  await expect(dialog).toHaveAttribute('data-stage','result');
  // Fallback font metrics differ between Windows and the Linux CI runner.
  for(const width of [280,320,360,390,420,1280])for(const font of ['', 'Verdana, sans-serif']){
    await page.setViewportSize({width,height:900});
    await dialog.locator('.support-dialog-title').evaluate((node,value)=>node.style.fontFamily=value,font);
    for(const locale of ['en','ko','zh-Hans','ja','id']){
      await dialog.locator('[data-language="'+locale+'"]').click();
      await expect(dialog.locator('.language-controls button')).toHaveCount(5);
      if(locale==='id'&&!font)await page.screenshot({path:testInfo.outputPath('support-id-'+width+'.png')});
      const widths=await dialog.evaluate(node=>({scroll:node.scrollWidth,client:node.clientWidth}));
      expect(widths.scroll,JSON.stringify({locale,font,widths})).toBeLessThanOrEqual(widths.client+1);
      const bounds=await dialog.boundingBox();
      const title=await dialog.locator('.support-dialog-title').boundingBox();
      for(const button of await dialog.locator('.language-controls button,.support-dialog-close').all()){
        const box=await button.boundingBox();expect(box.x+box.width).toBeLessThanOrEqual(bounds.x+bounds.width+1);
        expect(box.x>=title.x+title.width-1 || box.y>=title.y+title.height-1).toBe(true);
      }
    }
  }
});

test('separate support page uses native checkout and keeps wallet returns on that page', async ({page, context}) => {
  const state = await hosted(context);
  await page.goto('https://maimai.party/support.html');
  await expect(page.locator('#support-checkout-dialog')).toBeVisible();
  await expect(frame(page).getByRole('heading')).toHaveText('Stripe test double');
  await expect(page.locator('.support-invitation')).toHaveText(
    'maimai.party is free for everyone. If you’d like to help with hosting and domain costs, a few dollars is more than enough.');
  const stored = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), storageKey);
  expect(stored.entry).toBe('support');
  expect(state.api[0].data).toEqual({project: 'maimai-party', attempt: stored.attempt});
  await page.goto('https://maimai.party/support-return.html');
  const back = page.getByRole('link', {name: 'Return to checkout'});
  await expect(back).toHaveAttribute('href', '/support.html');
  await back.click();
  await expect(frame(page).getByRole('heading')).toHaveText('Stripe test double');
  expect(state.sessions.size).toBe(1);
  expect(state.external.every(item => /^https:\/\/(?:js|checkout)\.stripe\.com\//.test(item.url))).toBe(true);
  expect(await page.locator('script[src*="analytics"], script[src*="player-data"]').count()).toBe(0);
});

test('separate support page hides the button and makes no payment request when disabled', async ({page, context}) => {
  const state = await hosted(context, {enabled: false});
  await page.goto('https://maimai.party/support.html');
  await expect(page.getByRole('status')).toContainText('currently unavailable');
  await expect(page.locator('#support-open')).toBeHidden();
  expect(state.api).toEqual([]);
  expect(state.external).toEqual([]);
});

test('native embedded checkout, lazy loading, consent and verified completion stay private', async ({page, context}, testInfo) => {
  const state = await hosted(context);
  await page.goto('https://maimai.party/?view=about&search=PRIVATE_SEARCH#PRIVATE_HASH');
  await page.evaluate(() => localStorage.setItem('PRIVATE_PLAYER', 'PRIVATE_SCORES'));
  expect(state.api).toEqual([]); expect(state.external).toEqual([]);
  await open(page);
  await expect(payment(page)).toBeVisible();
  expect(await page.evaluate(() => window.dataLayer)).toBeUndefined();
  await expect(page.getByRole('heading', {name: 'Support maimai.party', exact: true})).toBeVisible();
  await expect(page.locator('#support-open')).toHaveText('Support maimai.party');
  await expect(page.locator('.support-button-provider')).not.toHaveAttribute('hidden');
  await expect(page.locator('.support-button-provider img')).toHaveAttribute('alt', 'Stripe');
  await expect(page.locator('.support-invitation')).toHaveText('maimai.party is free for everyone. If you’d like to help with hosting and domain costs, a few dollars is more than enough.');
  await expect(page.locator('#support-dialog-title .party-suffix')).toHaveText('.party');
  await expect(page.locator('.support-secure-hint')).toHaveCount(0);
  await expect(page.locator('.creator-support-via')).toHaveCount(0);
  await expect(page.locator('.support-amount-form')).toHaveCount(0);
  await expect(page.locator('#support-checkout-dialog')).not.toContainText('Buy Me a Coffee');
  await expect(page.locator('.support-payment-details')).toHaveCount(0);
  expect((await new AxeBuilder({page}).include('#support-checkout-dialog').analyze()).violations).toEqual([]);
  await page.locator('#support-checkout-dialog').screenshot({path: testInfo.outputPath('stripe-embedded-shell.png')});
  expect(state.sessions.size).toBe(1); expect(state.api.filter(x => x.path.endsWith('checkout'))).toHaveLength(1);
  // Provider-owned amount changes stay inside Stripe's frame, not our API/storage.
  await frame(page).getByRole('textbox', {name: 'Amount (test fixture only)'}).fill('7.25');
  expect(state.api[0].data.amount).toBeUndefined();
  expect(await page.evaluate(key => sessionStorage.getItem(key), storageKey)).not.toContain('7.25');
  await frame(page).getByRole('button', {name: 'Decline test payment'}).click();
  await expect(frame(page).getByRole('status')).toContainText('declined');
  await expect(page.locator('.support-stripe-status')).not.toContainText('Thank you');
  const box = await page.locator('#support-checkout-dialog').boundingBox();
  expect(box.width).toBeLessThanOrEqual(page.viewportSize().width);
  expect(await page.locator('.support-stripe-body').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  state.status = 'paid'; await payment(page).click();
  await expect(page.locator('.support-stripe-status')).toContainText('Thank you');
  expect(state.api.at(-1).path).toBe('/api/support/status');
  expect(await page.evaluate(() => window.dataLayer)).toBeUndefined();
  for (const row of state.api) {
    expect(Object.keys(row.data).sort()).toEqual((row.data.session ? ['project', 'attempt', 'session'] : ['project', 'attempt']).sort());
    expect(row.headers.referer).toBeUndefined();
    expect(row.headers.cookie).toBeUndefined();
    expect(row.url).not.toMatch(/PRIVATE|cs_test/);
  }
  expect(JSON.stringify([...state.api, ...state.external])).not.toContain('PRIVATE');
  await page.keyboard.press('Escape'); await expect(page.locator('#support-open')).toBeFocused();
  await page.locator('.project-actions').screenshot({path: testInfo.outputPath('support-actions.png')});
});

test('failed creation, repeated opens, close, reload and back resume one attempt', async ({page, context}) => {
  const state = await hosted(context, {failCreate: 1});
  await page.goto('https://maimai.party/'); await open(page);
  await expect(page.getByRole('button', {name: 'Try again', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Try again', exact: true}).click(); await expect(payment(page)).toBeVisible();
  expect(state.api[0].data).toEqual(state.api[1].data);
  await page.evaluate(() => { document.getElementById('support-open').click(); document.getElementById('support-open').click(); });
  expect(state.api.filter(x => x.path.endsWith('checkout'))).toHaveLength(2);
  await page.keyboard.press('Escape'); await page.locator('#support-open').click(); await expect(payment(page)).toBeVisible();
  await page.reload();
  await expect(page.locator('#support-checkout-dialog')).toBeHidden();
  await open(page); await expect(payment(page)).toBeVisible();
  await page.goto('https://maimai.party/support-return.html');
  await expect(page.locator('#support-return-status')).toContainText('unfinished');
  await page.goBack(); await open(page); await expect(payment(page)).toBeVisible();
  expect(state.sessions.size).toBe(1);
});

test('return page distinguishes pending, cancellation, verified success and missing state', async ({page, context}) => {
  const state = await hosted(context);
  await page.goto('https://maimai.party/'); await open(page);
  await expect(payment(page)).toBeVisible();
  state.status = 'pending';
  await page.goto('https://maimai.party/support-return.html?success=true#PRIVATE');
  await expect(page).toHaveURL('https://maimai.party/support-return.html');
  await expect(page.getByRole('status')).toContainText('processing');
  expect(await page.locator('script[src*="analytics"]').count()).toBe(0);
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(policy).not.toContain('stripe.com'); expect(policy).not.toContain('cloudflare');
  state.status = 'open'; await page.getByRole('button', {name: 'Check again'}).click();
  await expect(page.getByRole('status')).toContainText('unfinished');
  await page.getByRole('link', {name: 'Return to checkout'}).click(); await expect(payment(page)).toBeVisible();
  state.status = 'paid'; await page.goto('https://maimai.party/support-return.html');
  await expect(page.getByRole('status')).toContainText('Thank you');
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  await page.evaluate(key => sessionStorage.removeItem(key), storageKey); await page.reload();
  await expect(page.getByRole('status')).toContainText('could not find');
  await expect(page.getByRole('status')).not.toContainText('Thank you');
});

test('Stripe load failure offers retry and temporary-storage failure creates no session', async ({page, context}) => {
  const state = await hosted(context, {failScript: true});
  await page.goto('https://maimai.party/'); await open(page);
  await expect(page.locator('.support-stripe-status')).toContainText('could not load');
  await expect(page.getByRole('button', {name: 'Try again', exact: true})).toBeVisible();
  await expect(page.locator('#support-checkout-dialog')).not.toContainText('Buy Me a Coffee');
  expect(state.api).toEqual([]);
  await page.evaluate(key => sessionStorage.removeItem(key), storageKey);
  await page.reload();
  await page.evaluate(() => {Storage.prototype.setItem = () => {throw new DOMException('denied', 'SecurityError');};});
  await open(page, {keepNotice: true});
  await expect(page.locator('.support-stripe-status')).toContainText('temporary storage');
  expect(state.api).toEqual([]);
});

test('support analytics accepts only fixed events after consent and never queues past events', async ({page, context}) => {
  await hosted(context);
  await page.goto('https://maimai.party/'); await open(page, {keepNotice: true}); await expect(payment(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#analytics-notice [data-analytics-choice=granted]').click();
  await page.locator('#support-open').click();
  await expect(payment(page)).toBeVisible();
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('maimai:support', {detail: {name: 'support_opened', amount: 500, session: 'PRIVATE'}}));
    window.dispatchEvent(new CustomEvent('maimai:support', {detail: 'PRIVATE_PLAYER'}));
  });
  const events = await page.evaluate(() => window.dataLayer.filter(x => x[0] === 'event').map(x => Array.from(x)));
  expect(events.filter(x => x[1] === 'support_opened')).toHaveLength(1);
  expect(JSON.stringify(events)).not.toMatch(/PRIVATE|amount|cs_test/);
  await page.keyboard.press('Escape');
  await page.locator('#settings-toggle').click(); await page.locator('#analytics-settings').click();
  await page.locator('#analytics-dialog [data-analytics-choice=denied]').click();
  await page.locator('#support-open').click();
  expect(await page.evaluate(() => window.dataLayer.filter(x => x[0] === 'event').length)).toBe(events.length);
});

test('unconfirmed completion is retried before success; expiry allows a new checkout', async ({page, context}) => {
  const state = await hosted(context);
  await page.goto('https://maimai.party/'); await open(page);
  await expect(payment(page)).toBeVisible();
  state.failStatus = true; await payment(page).click();
  await expect(page.getByRole('button', {name: 'Try again', exact: true})).toBeVisible();
  await expect(page.locator('.support-stripe-status')).not.toContainText('Thank you');
  state.failStatus = false; state.status = 'pending';
  await page.getByRole('button', {name: 'Try again', exact: true}).click();
  await expect(page.locator('.support-stripe-status')).toContainText('processing');
  await expect(page.getByRole('button', {name: 'Start a new checkout'})).toBeHidden();
  state.status = 'expired'; await page.getByRole('button', {name: 'Check payment status'}).click();
  await expect(page.locator('.support-stripe-status')).toContainText('expired');
  state.status = 'open'; await page.getByRole('button', {name: 'Start a new checkout', exact: true}).click();
  await expect(payment(page)).toBeVisible(); expect(state.sessions.size).toBe(2);
});

test('disabling the public feature hides support without a fallback while existing returns still work', async ({page, context}) => {
  const state = await hosted(context, {enabled: false});
  await page.goto('https://maimai.party/');
  await page.locator('#about-tab').click();
  await expect(page.locator('.support-button-group')).toBeHidden();
  await expect(page.locator('#support-open')).not.toHaveAttribute('data-checkout-ready');
  await expect(page.locator('#support-checkout-dialog')).toHaveCount(0);
  await expect(page.locator('a[href*="buymeacoffee"],script[src*="support-checkout.js"]')).toHaveCount(0);
  await expect(page.locator('.support-button-provider')).toHaveAttribute('hidden', '');
  expect(state.external).toEqual([]); expect(state.api).toEqual([]);
  await page.evaluate(key => sessionStorage.setItem(key, JSON.stringify({attempt: crypto.randomUUID(),
    created: Date.now(), session: 'cs_test_abcdefghijk12345'})), storageKey);
  state.status = 'paid'; await page.goto('https://maimai.party/support-return.html');
  await expect(page.getByRole('status')).toContainText('Thank you');
  expect(state.external).toEqual([]);
});

for (const signal of ['globalPrivacyControl', 'doNotTrack']) test('support events respect ' + signal, async ({page, context}) => {
  await hosted(context);
  await page.addInitScript(signal => {
    Object.defineProperty(navigator, signal, {value: signal === 'globalPrivacyControl' ? true : '1'});
    localStorage.setItem('maimai.party.analytics.v1', JSON.stringify({choice: 'granted', expires: Date.now() + 86400000}));
  }, signal);
  await page.goto('https://maimai.party/'); await open(page);
  await expect(payment(page)).toBeVisible();
  expect(await page.evaluate(() => window.dataLayer)).toBeUndefined();
});

test('a stalled embedded SDK times out with retry and retains the same attempt', async ({page, context}) => {
  const state = await hosted(context, {stallInit: true});
  await page.clock.install();
  await page.goto('https://maimai.party/'); await open(page);
  await page.waitForFunction(() => window.__stripeInitWaiting);
  await page.clock.fastForward(21000);
  await expect(page.locator('.support-stripe-status')).toContainText('taking too long');
  await expect(page.locator('#support-checkout-dialog')).not.toContainText('Buy Me a Coffee');
  await page.getByRole('button', {name: 'Try again', exact: true}).click();
  await expect.poll(() => state.api.filter(row => row.path.endsWith('/checkout')).length).toBe(2);
  expect(state.sessions.size).toBe(1);
});


test('Indonesian site-owned checkout, unfinished return and paid status stay localized',async({page,context})=>{
  const state=await hosted(context);
  await context.addInitScript(()=>localStorage.setItem('maimai-language-v1','id'));
  await page.goto('https://maimai.party/');await open(page);
  const dialog=page.locator('#support-checkout-dialog');
  await expect(dialog.locator('.support-dialog-title')).toHaveAccessibleName('Dukung maimai.party');
  await expect(dialog.locator('.language-controls [data-language=id]')).toHaveAccessibleName('Bahasa Indonesia');
  await expect(dialog.getByRole('button',{name:'Tutup checkout dukungan',exact:true})).toBeVisible();
  await expect(frame(page).getByRole('heading')).toBeVisible();
  await page.goto('https://maimai.party/support-return.html');
  await expect(page.locator('html')).toHaveAttribute('lang','id');
  await expect(page.getByRole('link',{name:'Kembali ke checkout',exact:true})).toBeVisible();
  await expect(page.locator('body')).toContainText('Checkout Anda belum selesai.');
  await page.getByRole('link',{name:'Kembali ke checkout',exact:true}).click();
  await expect(frame(page).getByRole('heading')).toBeVisible();
  state.status='paid';await payment(page).click();
  await expect(dialog).toHaveAttribute('data-stage','result');
  await expect(dialog).toContainText('Terima kasih telah mendukung maimai.party!');
  await expect(dialog.getByRole('button',{name:'Dukung lagi',exact:true})).toBeVisible();
  expect(state.sessions.size).toBe(1);
});
