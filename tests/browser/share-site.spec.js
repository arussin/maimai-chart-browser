import {test, expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {readFile} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(process.env.MAIMAI_BROWSER_OUTPUT || fileURLToPath(new URL('../../output/browser-tests/', import.meta.url)));
const siteURL = 'https://maimai.party/';
const mime = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
async function hosted(context, {native = 'absent', mobile = false, clipboard = 'ok', canShare = 'true'} = {}) {
  const external = [];
  await context.addInitScript(({native, mobile, clipboard, canShare}) => {
    window.__shares = []; window.__copies = [];
    Object.defineProperty(navigator, 'userAgent', {configurable:true, value:mobile ? 'Mozilla/5.0 (Linux; Android 15) Mobile' : 'Desktop test'});
    Object.defineProperty(navigator, 'userAgentData', {configurable:true, value:{mobile}});
    Object.defineProperty(navigator, 'platform', {configurable:true, value:mobile ? 'Linux armv8l' : 'Win32'});
    Object.defineProperty(navigator, 'share', {configurable:true, value:native === 'absent' ? undefined : data => {
      window.__shares.push(data);
      if (native === 'pending') return new Promise(resolve => { window.__finishShare = resolve; });
      if (native === 'cancel') return Promise.reject(new DOMException('Canceled', 'AbortError'));
      if (native === 'fail') return Promise.reject(new DOMException('Blocked', 'NotAllowedError'));
      if (native === 'throw') throw new TypeError('Rejected');
      return Promise.resolve();
    }});
    Object.defineProperty(navigator, 'canShare', {configurable:true, value:canShare === 'absent' ? undefined : () => {
      if (canShare === 'throw') throw new TypeError('Rejected');
      return canShare !== 'false';
    }});
    Object.defineProperty(navigator, 'clipboard', {configurable:true, value:clipboard === 'absent' ? undefined : {writeText:text => {
      if (clipboard === 'fail') return Promise.reject(new DOMException('Denied', 'NotAllowedError'));
      window.__copies.push(text); return Promise.resolve();
    }}});
  }, {native, mobile, clipboard, canShare});
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (!['maimai.party', 'preview.invalid'].includes(url.hostname)) {
      external.push({url:request.url(), headers:await request.allHeaders(), body:request.postData()});
      return route.fulfill({contentType:'text/html', body:'<!doctype html><title>Share destination fixture</title>'});
    }
    const path = resolve(root, '.' + decodeURIComponent(url.pathname) + (url.pathname.endsWith('/') ? 'index.html' : ''));
    if (!path.startsWith(root + sep)) return route.abort();
    try { return route.fulfill({contentType:mime[extname(path)] || 'application/octet-stream', body:await readFile(path)}); }
    catch { return route.fulfill({status:404, body:'Missing fixture'}); }
  });
  return external;
}
async function ready(page, path='/registry/?q=PRIVATE_SEARCH#PRIVATE_IMPORT') {
  await page.goto('https://maimai.party' + path, {waitUntil:'domcontentloaded'});
  await expect(page.locator('#site-share')).toBeAttached();
}
async function open(page) {
  await page.locator('#settings-toggle').click();
  await page.locator('#site-share').click();
}

test('share is the final settings action above the imported player badge, with an icon', async ({page, context}, info) => {
  const external = await hosted(context); await ready(page, '/lab/');
  await page.locator('input[type=file]').setInputFiles(fileURLToPath(new URL('../../output/player-accessibility.gz', import.meta.url)));
  await page.getByRole('button', {name:'Import data', exact:true}).click();
  await expect(page.locator('.player-dialog')).toBeHidden();
  await page.locator('#settings-toggle').click();
  await expect(page.locator('#settings-actions [role=menuitem]').last()).toHaveAttribute('id','site-share');
  await expect(page.locator('#site-share svg')).toBeVisible();
  await expect(page.locator('#site-share')).toHaveText('Share this site');
  await expect(page.locator('#player-status')).toBeVisible();
  expect(await page.locator('#site-share').evaluate(el => el.getBoundingClientRect().bottom <= document.getElementById('player-status').getBoundingClientRect().top)).toBe(true);
  await page.screenshot({path:info.outputPath('share-settings.png')});
  await page.locator('#site-share').click(); await expect(page.locator('#site-share-dialog')).toBeVisible();
  await expect(page.locator('#settings-menu')).toBeHidden();
  await expect(page.locator('#site-share-copy')).toBeFocused();
  expect(external).toEqual([]);
});

test('localized shortcuts follow the selected site language and never contact services before a click', async ({page, context}, info) => {
  const external = await hosted(context); await ready(page);
  await page.waitForFunction(() => !!window.maimaiI18n); await open(page);
  const locales = [
    ['en', 'Share this site', ['facebook','whatsapp','reddit','x','facebook_messenger']],
    ['ja', 'このサイトを共有', ['line','x','hatena']],
    ['ko', '이 사이트 공유하기', ['kakao','naver']],
    ['zh-Hans', '分享本站', ['wechat','sina_weibo','qzone']]
  ];
  for (const [locale, label, services] of locales) {
    await page.evaluate(locale => window.maimaiI18n.setLocale(locale), locale);
    await expect(page.locator('#site-share-title')).toHaveText(label);
    await expect(page.locator('#site-share span')).toHaveText(label);
    expect(await page.locator('.site-share-services a').evaluateAll(nodes => nodes.map(n => n.dataset.shareService))).toEqual(services);
    await expect(page.locator('#site-share-url')).toHaveValue(siteURL);
    expect(await page.locator('#site-share-dialog').evaluate(el => {
      const r=el.getBoundingClientRect(); return el.scrollWidth<=el.clientWidth && r.left>=0 && r.right<=innerWidth && r.bottom<=innerHeight;
    })).toBe(true);
    expect((await new AxeBuilder({page}).include('#site-share-dialog').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
    await page.screenshot({path:info.outputPath('share-'+locale+'.png')});
  }
  expect(external).toEqual([]);
  expect(await page.locator('script[src*="addtoany"]').count()).toBe(0);
  expect(await context.cookies()).toEqual([]);
});

test('desktop uses the local picker even when native sharing exists; native remains available inside', async ({page, context}) => {
  const external = await hosted(context, {native:'ok'}); await ready(page); await open(page);
  await expect(page.locator('#site-share-dialog')).toBeVisible();
  expect(await page.evaluate(() => window.__shares)).toEqual([]);
  await page.locator('#site-share-native').click();
  await expect(page.locator('#site-share-dialog')).toBeHidden();
  expect(await page.evaluate(() => window.__shares)).toEqual([{url:siteURL,title:'maimai.party',text:'Explore maimai charts, patterns, and personal progress.'}]);
  expect(external).toEqual([]);
});

for (const canShare of ['true','absent']) test('mobile invokes native sharing immediately with a clean homepage: '+canShare, async ({page, context}) => {
  const external = await hosted(context, {native:'ok',mobile:true,canShare}); await ready(page); await open(page);
  await expect(page.locator('#site-share-dialog')).toBeHidden();
  await expect(page.locator('#settings-toggle')).toBeFocused();
  expect(await page.evaluate(() => window.__shares)).toEqual([{url:siteURL,title:'maimai.party',text:'Explore maimai charts, patterns, and personal progress.'}]);
  expect(external).toEqual([]);
});

test('native cancellation closes quietly without fallback, error, or success claims', async ({page, context}) => {
  await hosted(context, {native:'cancel', mobile:true}); await ready(page); await open(page);
  await expect(page.locator('#site-share-dialog')).toBeHidden();
  await expect(page.locator('#settings-toggle')).toBeFocused();
  expect(await page.evaluate(() => window.__shares.length)).toBe(1);
  await expect(page.locator('#site-share')).toBeEnabled();
});

for (const options of [
  {native:'absent'}, {native:'fail'}, {native:'throw'},
  {native:'ok',canShare:'false'}, {native:'ok',canShare:'throw'}
]) test('native unavailable or rejected falls back without losing the user: '+JSON.stringify(options), async ({page, context}) => {
  await hosted(context, {...options, mobile:true}); await ready(page); await open(page);
  await expect(page.locator('#site-share-dialog')).toBeVisible();
  await expect(page.locator('#site-share-copy')).toBeFocused();
  await expect(page.locator('#site-share')).toBeEnabled();
});

test('an in-flight native share is not invoked twice', async ({page, context}) => {
  await hosted(context, {native:'pending', mobile:true}); await ready(page); await open(page);
  await page.evaluate(() => document.getElementById('site-share').click());
  expect(await page.evaluate(() => window.__shares.length)).toBe(1);
  await expect(page.locator('#site-share')).toBeDisabled();
  await page.evaluate(() => window.__finishShare());
  await expect(page.locator('#site-share')).toBeEnabled();
});

for (const clipboard of ['ok','fail','absent']) test('copy link handles '+clipboard+' clipboard without leaking page state', async ({page, context}) => {
  const external = await hosted(context, {clipboard}); await ready(page); await open(page);
  await page.locator('#site-share-copy').click();
  if (clipboard === 'ok') {
    await expect(page.locator('#site-share-status')).toHaveText('Link copied');
    expect(await page.evaluate(() => window.__copies)).toEqual([siteURL]);
  } else {
    await expect(page.locator('#site-share-status')).toHaveText('Copy the selected link using your device’s copy command.');
    await expect(page.locator('#site-share-url')).toBeFocused();
    await expect(page.locator('#site-share-url')).toHaveValue(siteURL);
  }
  expect(external).toEqual([]);
  await expect(page.locator('#site-share-copy')).toBeEnabled();
});

test('every provider and More link contains only the public URL and title, with no referrer or opener', async ({page, context}) => {
  const external = await hosted(context); await ready(page); await page.waitForFunction(() => !!window.maimaiI18n); await open(page);
  for (const locale of ['en','ja','ko','zh-Hans']) {
    await page.evaluate(locale => window.maimaiI18n.setLocale(locale), locale);
    const links = await page.locator('#site-share-dialog a').evaluateAll(nodes => nodes.map(n => ({href:n.href,service:n.dataset.shareService,rel:n.rel,policy:n.referrerPolicy})));
    for (const row of links) {
      const url = new URL(row.href), naver = row.service === 'naver';
      expect(url.hostname).toBe(naver ? 'share.naver.com' : 'www.addtoany.com');
      expect([...url.searchParams.entries()]).toEqual(naver ? [['url',siteURL],['title','maimai.party']] : [['linkurl',siteURL],['linkname','maimai.party']]);
      expect(row.rel).toBe('noopener noreferrer'); expect(row.policy).toBe('no-referrer');
    }
  }
  for (const service of ['wechat','more','naver']) {
    if (service==='naver') await page.evaluate(() => window.maimaiI18n.setLocale('ko'));
    const opened = context.waitForEvent('page');
    await page.locator('[data-share-service='+service+']').click();
    const popup = await opened; await expect(popup).toHaveTitle('Share destination fixture');
    expect(await popup.evaluate(() => window.opener === null)).toBe(true); await popup.close();
  }
  expect(external).toHaveLength(3);
  expect(external.every(r => !r.headers.referer && !r.body)).toBe(true);
  expect(JSON.stringify(external)).not.toContain('PRIVATE_');
});

test('share is keyboard reachable, traps dialog focus and returns focus on Escape or Close', async ({page, context}) => {
  await hosted(context); await ready(page);
  await page.locator('#settings-toggle').press('ArrowUp'); await expect(page.locator('#site-share')).toBeFocused();
  await page.keyboard.press('Enter'); await expect(page.locator('#site-share-copy')).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.locator('#site-share-more')).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.locator('#site-share-close')).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(page.locator('#site-share-more')).toBeFocused();
  await page.keyboard.press('Escape'); await expect(page.locator('#site-share-dialog')).toBeHidden();
  await expect(page.locator('#settings-toggle')).toBeFocused();
  await open(page); await page.locator('#site-share-close').click();
  await expect(page.locator('#settings-toggle')).toBeFocused();
});

test('share survives a catalog failure and is present on the older standalone page too', async ({page, context}) => {
  await hosted(context);
  await page.route('**/manifest.json', route => route.fulfill({status:503,body:'Offline fixture'}));
  for (const path of ['/lab/','/']) {
    await ready(page,path); await open(page);
    await expect(page.locator('#site-share-dialog')).toBeVisible();
    await expect(page.locator('#site-share-url')).toHaveValue(siteURL);
    await page.keyboard.press('Escape');
  }
});


test('reloading the settings asset does not duplicate the share dialog or listeners', async ({page, context}) => {
  await hosted(context); await ready(page);
  const src = await page.locator('script[src*="settings-menu.js"]').first().getAttribute('src');
  await page.addScriptTag({url:new URL(src, page.url()).href});
  await expect(page.locator('#site-share-dialog')).toHaveCount(1);
  await open(page); await expect(page.locator('#site-share-dialog')).toBeVisible();
  await page.locator('#site-share-copy').click();
  expect(await page.evaluate(() => window.__copies)).toEqual([siteURL]);
});
