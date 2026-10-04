import {browserResourceURL} from './browser-configuration-fixture.mjs';
import {test,expect} from './fixtures.js';
import {mountRegistryPage} from './registry-page-mount.mjs';
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';

// Synthetic corpus only. Every request stays on the isolated loopback fixture server.
const mounts=new WeakMap();
test.beforeEach(async({page,baseURL})=>{
 mounts.set(page,await mountRegistryPage(page,baseURL));
});
// Keep remapping installed until the page stops requesting, then finish API fetches.
test.afterEach(async({page})=>{await mounts.get(page)?.close();});

const detailHeadings={en:'Chart details','zh-Hans':'谱面详情',ko:'채보 상세',ja:'譜面詳細'};
for(const locale of Object.keys(detailHeadings))for(const width of [280,320,390,740,741,800,801,1280])test('static chart details and flow fit '+locale+' at '+width,async({page})=>{
 await page.setViewportSize({width,height:900});
 await page.goto('/?search=Fictional%20study&lang='+locale);
 await expect(page.locator('html')).toHaveAttribute('lang',locale);
 // This layout/keyboard matrix starts after profile initialization; startup races have separate coverage.
 await expect.poll(()=>page.evaluate(()=>!!window.maimaiPersonal)).toBe(true);await page.evaluate(()=>maimaiPersonal.ready);
 const row=page.locator('#songs .song-row').first(),outer=row.locator('.chart-row'),compact=row.locator('.chart-summary>.chart-flow.compact');
 await expect(compact).toBeVisible();await expect(row.locator('.chart-summary .chart-patterns')).toHaveCount(0);
 await outer.focus();await expect(outer).toBeFocused();await page.keyboard.press('Enter');
 const section=row.locator('[data-chart-section=chart]'),heading=section.locator('.chart-section-heading');
 await expect(heading).toBeVisible();await expect(section.locator('.chart-section-toggle')).toHaveCount(0);
 await expect(section.locator('.chart-section-body')).toHaveJSProperty('inert',false);
 await expect(section.locator('.chart-flow svg')).toBeVisible();
 if(width<=800)await expect(compact).toBeHidden();else await expect(compact).toBeVisible();
 expect(await heading.evaluate(n=>n.scrollWidth<=n.clientWidth+1)).toBe(true);
 const songLink=row.locator('.chart-summary [data-song-page]');await expect(songLink).toBeVisible();
 const fit=await row.evaluate(r=>{const a=r.querySelector('[data-song-page]'),b=r.querySelector('.chart-detail-actions'),yt=r.querySelector('.youtube-search:not(.chart-song-page)'),ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();return{below:ar.top>=br.bottom-1,right:Math.abs(ar.right-br.right)<1,font:getComputedStyle(a).fontSize,videoFont:yt?getComputedStyle(yt).fontSize:null,overflow:r.scrollWidth>r.clientWidth+1};});
 expect(fit.below).toBe(true);expect(fit.right).toBe(true);expect(fit.font).toBe('12px');if(fit.videoFont)expect(fit.font).toBe(fit.videoFont);expect(fit.overflow).toBe(false);
 await outer.focus();await page.keyboard.press('Space');await expect(row.locator('.chart-measurements')).toBeHidden();await expect(outer).toBeFocused();await expect(compact).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('obsolete inner-disclosure preferences cannot hide details or steal focus',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('maimai-chart-sections-v1',JSON.stringify({chart:false,player:false})));
 await page.goto('/?search=Fictional%20study&lang=en');const row=page.locator('#songs .song-row').first();await row.locator('.chart-row').click();
 const body=row.locator('[data-chart-section=chart] .chart-section-body');await expect(body).toBeVisible();await expect(body).toHaveJSProperty('inert',false);
 const link=row.locator('[data-song-page]');await link.focus();
 await page.evaluate(()=>dispatchEvent(new StorageEvent('storage',{key:'maimai-chart-sections-v1',newValue:JSON.stringify({chart:false,player:false})})));
 await expect(link).toBeFocused();await expect(body).toBeVisible();await expect(row.locator('.chart-section-toggle')).toHaveCount(0);
 await page.reload();await row.locator('.chart-row').click();await expect(body).toBeVisible();
});

for(const locale of ['en','ja','ko','zh-hans'])for(const width of [320,768,1280]){
 test('direct song workspace '+locale+' '+width,async({page,request},testInfo)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width,height:900});
  const map=await(await request.get('/registry/permalinks.json')).json();
  const slug=Object.values(map.songs).find(value=>value.includes('ソテリア'))||Object.values(map.songs)[0];
  const url='/'+locale+'/songs/'+encodeURIComponent(slug)+'/';
  const staticPage=await(await request.get('/registry'+url)).text();
  expect(staticPage).toContain('data-song-id=');expect(staticPage).toContain('class="seo-table"');
  await page.goto(url);
  await expect(page.locator('#seo-route-view .song-workspace .song-row').first()).toBeVisible();
  await expect(page.locator('#settings-toggle')).toBeVisible();
  await expect(page.locator('#seo-route-view [data-back-results]')).toBeHidden();
  await expect(page.locator('#seo-route-view .seo-actions [data-open-browser]')).toBeVisible();
  await expect(page.locator('#seo-route-view [data-seo-version-links] a:visible').first()).toBeVisible();
  await expect(page.locator('#seo-route-view .seo-document > ul')).toHaveCount(0);
  await expect(page.locator('#lab-status')).toBeEmpty();
  await expect(page.locator('#seo-route-view .song-row .chart-row[aria-expanded=true]')).toHaveCount(0);
  const order=await page.locator('#seo-route-view .song-row').evaluateAll(rows=>rows.map(row=>({id:row.dataset.chartId,difficulty:row.dataset.difficulty})));
  expect(order.map(row=>row.difficulty)).toEqual(['BASIC','ADVANCED','EXPERT','MASTER']);
  expect(order.map(row=>row.id)).toEqual(await page.locator('#seo-route-view .seo-table tbody tr').evaluateAll(rows=>rows.map(row=>decodeURIComponent(row.id.slice(6)))));
  await page.locator('#seo-route-view .song-row .chart-row').first().click();
  await expect(page.locator('#seo-route-view .song-row').first().locator('.chart-measurements')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang',locale==='zh-hans'?'zh-Hans':locale);
  if(locale==='en'&&width===1280){await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:testInfo.outputPath('song-workspace.png'),fullPage:true});}
  const count=await page.locator('#seo-route-view .song-row').count();
  await page.locator('#seo-route-view [data-seo-international]').check();
  expect(await page.locator('#seo-route-view .song-row').count()).toBe(count);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.locator('#seo-route-view .chart-detail-actions button').first().click();
  await expect(page.locator('#compare')).toBeVisible();
  await expect(page.locator('#compare-left-search')).not.toHaveValue('');
  expect(errors).toEqual([]);
 });
}
test('song choices cannot overwrite browser filters and personal sort intent',async({page})=>{
 await page.goto('/');await expect(page.locator('#catalog-count')).toHaveText('26 charts');
 await page.locator('#search').fill('ソテリア');
 const original=await page.evaluate(()=>window.maimaiBrowserState.capture());
 const row=page.locator('#songs .song-row').first();await row.locator('.chart-row').click();
 await expect(row.locator('a[data-song-page]')).toBeVisible();await row.locator('a[data-song-page]').click();
 await expect(page.locator('#seo-route-view .song-workspace')).toBeVisible();
 await page.locator('#seo-route-view [data-seo-international]').check();
 await page.locator('#seo-route-view .row-difficulty').first().selectOption({index:1});
 await page.locator('#seo-route-view [data-back-results]').click();
 const restored=await page.evaluate(()=>window.maimaiBrowserState.capture());
 for(const key of ['search','genre','format','versions','sortRules','region','personal'])expect(restored[key],key).toEqual(original[key]);
 await expect(page.locator('#search')).toHaveValue('ソテリア');
});

test('song regional preference restores base values after international browser navigation', async ({ page }) => {
  await page.goto('/?lang=en');
  await expect(page.locator('#catalog-count')).toHaveText('26 charts');
  await page.locator('#search').fill('ソテリア');
  await expect(page.locator('#catalog-count')).toHaveText('4 charts');
  const initial = page.locator('#songs .song-row[data-difficulty="ADVANCED"]').filter({ hasText: 'ソテリア' });
  await expect(initial).toHaveCount(1);
  const chartID = await initial.getAttribute('data-chart-id');
  expect(chartID).toBeTruthy();
  const browserRow = page.locator('#songs .song-row[data-chart-id=' + JSON.stringify(chartID) + ']');
  await expect(browserRow.locator('.chart-constant')).toHaveText('8.2');
  await expect(browserRow.locator('.chart-constant')).toHaveAttribute('title', /\bJP\b/);
  await expect(browserRow).toHaveAttribute('data-level', '8');
  const filters = page.locator('#catalog-filters-toggle');
  if (await filters.getAttribute('aria-expanded') !== 'true') await filters.click();
  await expect(filters).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#use-international-data').check();
  await expect(browserRow.locator('.chart-constant')).toHaveText('7.4');
  await expect(browserRow.locator('.chart-constant')).toHaveAttribute('title', /\bINTL\b/);
  await expect(browserRow).toHaveAttribute('data-level', '7');
  await expect(browserRow.locator('.song-title')).toHaveText('Soteria fixture');
  await browserRow.locator('.chart-row').click();
  const link = browserRow.locator('a[data-song-page]');
  await expect(link).toBeVisible();
  const saved = await page.evaluate(() => window.maimaiBrowserState.capture());
  expect(saved.region.international).toBe(true);
  await link.click();
  const songRow = page.locator('#seo-route-view .song-row[data-chart-id=' + JSON.stringify(chartID) + ']');
  const preference = page.locator('#seo-route-view [data-seo-international]');
  await expect(songRow).toHaveCount(1);
  await expect(preference).toBeChecked();
  await expect(songRow.locator('.chart-constant')).toHaveText('7.4');
  await preference.uncheck();
  await expect(songRow.locator('.chart-constant')).toHaveText('8.2');
  await expect(songRow.locator('.chart-constant')).toHaveAttribute('title', /\bJP\b/);
  await expect(songRow).toHaveAttribute('data-level', '8');
  await expect(songRow.locator('.song-title')).toHaveText('ソテリア');
  await preference.check();
  await expect(songRow.locator('.chart-constant')).toHaveText('7.4');
  await expect(songRow.locator('.chart-constant')).toHaveAttribute('title', /\bINTL\b/);
  await expect(songRow).toHaveAttribute('data-level', '7');
  await expect(songRow.locator('.song-title')).toHaveText('Soteria fixture');
  // Leave the song preference different from the saved browser preference.
  await preference.uncheck();
  await expect(songRow.locator('.chart-constant')).toHaveText('8.2');
  await page.locator('#seo-route-view [data-back-results]').click();
  await expect(page.locator('#songs')).toBeVisible();
  await expect(page.locator('#use-international-data')).toBeChecked();
  await expect(browserRow.locator('.chart-constant')).toHaveText('7.4');
  const keys = ['search', 'genre', 'format', 'versions', 'sortRules', 'chartFilters', 'patterns', 'region', 'personal', 'selectedCharts', 'expandedRows'];
  const expected = Object.fromEntries(keys.map(key => [key, saved[key]]));
  await expect.poll(async () => {
    const restored = await page.evaluate(() => window.maimaiBrowserState.capture());
    return Object.fromEntries(keys.map(key => [key, restored[key]]));
  }).toEqual(expected);
});

test('direct song international preference follows the exact chart into comparison', async ({ page, request }) => {
  const map = await (await request.get('/registry/permalinks.json')).json();
  const entry = Object.entries(map.songs).find(([, slug]) => slug.includes('ソテリア'));
  expect(entry).toBeTruthy();
  const [songID, slug] = entry;
  await page.goto('/en/songs/' + encodeURIComponent(slug) + '/');
  await expect(page.locator('#seo-route-view [data-song-id]')).toHaveAttribute('data-song-id', songID);
  const initial = page.locator('#seo-route-view .song-row[data-difficulty="ADVANCED"]');
  await expect(initial).toHaveCount(1);
  const chartID = await initial.getAttribute('data-chart-id');
  expect(chartID).toBeTruthy();
  const row = page.locator('#seo-route-view .song-row[data-chart-id=' + JSON.stringify(chartID) + ']');
  await expect(row.locator('.chart-constant')).toHaveText('8.2');
  await expect(row).toHaveAttribute('data-level', '8');
  await expect(row.locator('.song-title')).toHaveText('ソテリア');
  await page.locator('#seo-route-view [data-seo-international]').check();
  await expect(row.locator('.chart-constant')).toHaveText('7.4');
  await expect(row.locator('.chart-constant')).toHaveAttribute('title', /\bINTL\b/);
  await expect(row).toHaveAttribute('data-level', '7');
  await expect(row.locator('.song-title')).toHaveText('Soteria fixture');
  await row.locator('.chart-row').click();
  await row.getByRole('button', { name: 'Compare this chart', exact: true }).click();
  await expect(page.locator('#compare')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('left')).toBe(chartID);
  await expect(page.locator('#compare-left-search')).toHaveValue('Soteria fixture');
  const chosen = page.locator('#comparison-pickers .chart-picker')
    .filter({ has: page.locator('#compare-left-search') }).locator('.chosen-chart');
  await expect(chosen).toHaveCount(1);
  await expect(chosen.locator(':scope > strong')).toHaveText('Soteria fixture');
  await expect(chosen.locator(':scope > p').first()).toContainText('DX ADVANCED');
  await expect(chosen.locator(':scope > p').first()).toContainText(/\bLv\. 7(?:\s|·|$)/);
});


test('lazy song comparison uses the regional preference changed during catalog acquisition', async ({ page, request }) => {
  const map = await (await request.get('/registry/permalinks.json')).json();
  const entry = Object.entries(map.songs).find(([, slug]) => slug.includes('ソテリア'));
  expect(entry).toBeTruthy();
  const [songID, slug] = entry;
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let requests = 0;
  await page.route(await browserResourceURL('catalog'), async route => {
    requests++;
    await held;
    await route.fallback();
  });
  try {
    await page.goto('/en/songs/' + encodeURIComponent(slug) + '/');
    await expect(page.locator('#seo-route-view [data-song-id]')).toHaveAttribute('data-song-id', songID);
    const initial = page.locator('#seo-route-view .song-row[data-difficulty="ADVANCED"]');
    await expect(initial).toHaveCount(1);
    const chartID = await initial.getAttribute('data-chart-id');
    expect(chartID).toBeTruthy();
    const row = page.locator('#seo-route-view .song-row[data-chart-id=' + JSON.stringify(chartID) + ']');
    const preference = page.locator('#seo-route-view [data-seo-international]');
    await expect(preference).not.toBeChecked();
    await expect(row.locator('.chart-constant')).toHaveText('8.2');
    expect(requests).toBe(0);
    await row.locator('.chart-row').click();
    await row.getByRole('button', { name: 'Compare this chart', exact: true }).click();
    await expect.poll(() => requests).toBe(1);
    await expect(page.locator('[data-catalog-progress]')).toBeVisible();
    await preference.check();
    await expect(row.locator('.chart-constant')).toHaveText('7.4');
    await expect(row.locator('.song-title')).toHaveText('Soteria fixture');
    release();
    await expect(page.locator('#compare')).toBeVisible();
    await expect(page.locator('[data-catalog-progress]')).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get('left')).toBe(chartID);
    await expect(page.locator('#compare-left-search')).toHaveValue('Soteria fixture');
    const chosen = page.locator('#comparison-pickers .chart-picker')
      .filter({ has: page.locator('#compare-left-search') }).locator('.chosen-chart');
    await expect(chosen.locator(':scope > strong')).toHaveText('Soteria fixture');
    await expect(chosen.locator(':scope > p').first()).toContainText('DX ADVANCED');
    await expect(chosen.locator(':scope > p').first()).toContainText(/\bLv\. 7(?:\s|·|$)/);
    expect(requests).toBe(1);
  } finally {
    release();
  }
});

test('song comparison updates both regional identities without changing its saved browser return', async ({ page }) => {
  await page.goto('/?lang=en');
  await expect(page.locator('#catalog-count')).toHaveText('26 charts');
  await page.locator('#search').fill('ソテリア');
  await expect(page.locator('#catalog-count')).toHaveText('4 charts');
  const first = page.locator('#songs .song-row[data-difficulty="ADVANCED"]');
  await expect(first).toHaveCount(1);
  const firstID = await first.getAttribute('data-chart-id');
  expect(firstID).toBeTruthy();
  await expect(first.locator('.chart-constant')).toHaveText('8.2');
  await first.locator('.chart-row').click();
  await first.getByRole('button', { name: 'Compare this chart', exact: true }).click();
  await expect(page.locator('#compare')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('left')).toBe(firstID);
  await expect(page.locator('#compare-left-search')).toHaveValue('ソテリア');
  const left = page.locator('#comparison-pickers .chart-picker')
    .filter({ has: page.locator('#compare-left-search') }).locator('.chosen-chart');
  await expect(left.locator(':scope > p').first()).toContainText(/\bLv\. 8(?:\s|·|$)/);
  await page.locator('#catalog-tab').click();
  await expect(page.locator('#songs')).toBeVisible();
  const second = page.locator('#songs .song-row[data-difficulty="EXPERT"]');
  await expect(second).toHaveCount(1);
  const secondID = await second.getAttribute('data-chart-id');
  expect(secondID).toBeTruthy();
  expect(secondID).not.toBe(firstID);
  await second.locator('.chart-row').click();
  const link = second.locator('a[data-song-page]');
  await expect(link).toBeVisible();
  await link.click();
  const songRow = page.locator('#seo-route-view .song-row[data-chart-id=' + JSON.stringify(secondID) + ']');
  await expect(songRow).toHaveCount(1);
  const saved = await page.evaluate(() => history.state.maimaiReturn);
  expect(new URL(saved.url).searchParams.get('view')).toBe('catalog');
  expect(saved.snapshot.region.international).toBe(false);
  expect(saved.snapshot.comparison.left).toBe(firstID);
  expect(saved.snapshot.comparison.right).toBeNull();
  await page.locator('#seo-route-view [data-seo-international]').check();
  await expect(songRow.locator('.song-title')).toHaveText('Soteria fixture');
  await expect(songRow).toHaveAttribute('data-level', '12');
  await expect(songRow.locator('.chart-constant')).toHaveText('12.1');
  await expect(songRow.locator('.chart-constant')).toHaveAttribute('title', /\bJP\b/);
  // The clicked browser chart is already expanded by its public fragment.
  await expect(songRow.locator('.chart-row')).toHaveAttribute('aria-expanded', 'true');
  await songRow.getByRole('button', { name: 'Compare this chart', exact: true }).click();
  await expect(page.locator('#compare')).toBeVisible();
  const url = new URL(page.url());
  expect(url.searchParams.get('left')).toBe(firstID);
  expect(url.searchParams.get('right')).toBe(secondID);
  for (const side of ['left', 'right']) {
    await expect(page.locator('#compare-' + side + '-search')).toHaveValue('Soteria fixture');
    const chosen = page.locator('#comparison-pickers .chart-picker')
      .filter({ has: page.locator('#compare-' + side + '-search') }).locator('.chosen-chart');
    await expect(chosen).toHaveCount(1);
    await expect(chosen.locator(':scope > strong')).toHaveText('Soteria fixture');
    await expect(chosen.locator(':scope > p').first()).toContainText(side === 'left' ? 'DX ADVANCED' : 'DX EXPERT');
    await expect(chosen.locator(':scope > p').first()).toContainText(side === 'left' ? /\bLv\. 7(?:\s|·|$)/ : /\bLv\. 12(?:\s|·|$)/);
  }
  expect(await page.evaluate(() => history.state.maimaiReturn)).toEqual(saved);
  await page.goBack();
  await expect(page).toHaveURL(saved.url);
  await expect(page.locator('#songs')).toBeVisible();
  await expect(page.locator('#use-international-data')).not.toBeChecked();
  const keys = ['search', 'genre', 'format', 'versions', 'sortRules', 'chartFilters', 'patterns', 'region', 'personal', 'selectedCharts', 'expandedRows', 'comparison'];
  const expected = Object.fromEntries(keys.map(key => [key, saved.snapshot[key]]));
  await expect.poll(async () => {
    const restored = await page.evaluate(() => window.maimaiBrowserState.capture());
    return Object.fromEntries(keys.map(key => [key, restored[key]]));
  }).toEqual(expected);
});


for(const place of ['browser','song'])for(const selector of ['.chart-row','.row-difficulty','.chart-detail-actions button:first-child','#settings-toggle']){
 test('delayed player readiness preserves '+place+' keyboard focus '+selector,async({page,request})=>{
  await page.addInitScript(()=>{
   const open=IDBFactory.prototype.open;
   IDBFactory.prototype.open=function(...args){
    const request=open.apply(this,args),descriptor=Object.getOwnPropertyDescriptor(IDBRequest.prototype,'onsuccess');
    Object.defineProperty(request,'onsuccess',{configurable:true,set(handler){descriptor.set.call(request,async event=>{
     window.fixtureStorageHeld=true;await new Promise(resolve=>window.fixtureReleaseStorage=resolve);handler?.call(request,event);
    });}});
    return request;
   };
  });
  const map=await(await request.get('/registry/permalinks.json')).json();
  const slug=Object.values(map.songs).find(value=>value.includes('ソテリア'));
  await page.goto(place==='song'?'/en/songs/'+encodeURIComponent(slug)+'/':'/');
  const row=page.locator(place==='song'?'#seo-route-view .song-row':'#songs .song-row').first();
  await row.locator('.chart-row').click();
  const control=selector==='#settings-toggle'?page.locator(selector):row.locator(selector);
  await expect(control).toBeVisible();await expect.poll(()=>page.evaluate(()=>window.fixtureStorageHeld)).toBe(true);
  await control.focus();await expect(control).toBeFocused();
  await page.evaluate(async()=>{fixtureReleaseStorage();await maimaiPersonal.ready;});
  await expect(control).toBeFocused();
  await expect(row.locator('.chart-measurements')).toBeVisible();
 });
}

// Direct arrivals must not depend on the corpus-wide index. Comparison requests it once.
test('song is usable before the comparison catalog is requested',async({page,request})=>{
 const map=await(await request.get('/registry/permalinks.json')).json();
 const slug=Object.values(map.songs).find(value=>value.includes('ソテリア'));
 const catalogs=[];
 let release;
 const held=new Promise(resolve=>{release=resolve;});
 await page.route(await browserResourceURL('catalog'),async route=>{
  catalogs.push(route.request().url());await held;await route.fallback();
 });
 await page.goto('/en/songs/'+encodeURIComponent(slug)+'/');
 await page.locator('#seo-route-view .song-row .chart-row').first().click();
 await expect(page.locator('#seo-route-view .song-workspace .chart-measurements').first()).toBeVisible();
 expect(catalogs).toEqual([]);
 await page.locator('#seo-route-view .chart-detail-actions button').first().click();
 await expect.poll(()=>catalogs.length).toBe(1);
 await expect(page.locator('#seo-route-view .song-workspace')).toBeVisible();
 release();
 await expect(page.locator('#compare')).toBeVisible();
 await expect(page.locator('#compare-left-search')).not.toHaveValue('');
 expect(catalogs).toHaveLength(1);
});

for (const failure of [false,true]) test('lazy comparison '+(failure?'failure preserves song':'cannot override a newer song navigation'),async({page,request})=>{
 const map=await(await request.get('/registry/permalinks.json')).json();
 const slug=Object.values(map.songs).find(value=>value.includes('ソテリア'));
 let release;
 const held=new Promise(resolve=>{release=resolve;});
 await page.route(await browserResourceURL('catalog'),async route=>{await held;if(failure)await route.fulfill({status:503,body:'unavailable'});else await route.fallback();});
 await page.goto('/en/songs/'+encodeURIComponent(slug)+'/');
 await expect(page.locator('#seo-route-view .song-workspace')).toBeVisible();
 await page.locator('#seo-route-view .song-row .chart-row').first().click();
 await page.locator('#seo-route-view .chart-detail-actions button').first().click();
 await expect(page.locator('[data-catalog-progress]')).toBeVisible();
 if (!failure) {
  await page.evaluate(()=>window.maimaiSongPages.route(new URL(location.href.replace('/en/','/ja/')), {push:true}));
  await expect(page.locator('html')).toHaveAttribute('lang','ja');
 }
 release();
 await expect(page.locator('[data-catalog-progress]')).toHaveCount(0);
 await expect(page.locator('#seo-route-view .song-workspace')).toBeVisible();
 await expect(page.locator('#compare')).toBeHidden();
 if (failure) await expect(page.locator('[data-diagnostic="catalog_unavailable"]')).toBeVisible();
 else await expect(page).toHaveURL(/\/ja\/songs\//);
});

for (const locale of ['en','ja','ko','zh-hans']) test('comparison recovers after one failed catalog request '+locale,async({page,request})=>{
 const map=await(await request.get('/registry/permalinks.json')).json();
 const slug=Object.values(map.songs).find(value=>value.includes('ソテリア'));
 let requests=0;
 await page.route(await browserResourceURL('catalog'),async route=>{
  requests++;
  if(requests===1) await route.fulfill({status:503,body:'unavailable'});
  else await route.fallback();
 });
 await page.goto('/'+locale+'/songs/'+encodeURIComponent(slug)+'/');
 await expect(page.locator('#seo-route-view .song-workspace')).toBeVisible();
 await page.locator('#seo-route-view .song-row .chart-row').first().click();
 await expect.poll(()=>page.evaluate(()=>!!window.maimaiPersonal)).toBe(true);
 await page.evaluate(()=>{
  window.fixtureOriginalSession=maimaiPersonal;
  window.fixtureBrowserInitializations=0;
  addEventListener('maimai:browser-ready',()=>fixtureBrowserInitializations++);
 });
 const compare=page.locator('#seo-route-view .chart-detail-actions button').first();
 await compare.click();
 await expect(page.locator('[data-diagnostic="catalog_unavailable"]')).toBeVisible();
 expect(requests).toBe(1);
 await compare.click();
 await expect(page.locator('#compare')).toBeVisible();
 await expect(page.locator('#compare-left-search')).not.toHaveValue('');
 await page.locator('#catalog-tab').click();
 await expect(page.locator('#songs .song-row').first()).toBeVisible();
 expect(requests).toBe(2);
 expect(await page.evaluate(()=>fixtureOriginalSession===maimaiPersonal)).toBe(true);
 expect(await page.evaluate(()=>fixtureBrowserInitializations)).toBe(1);
});

test('concurrent recovery shares acquisition and commits only the latest action',async({page,request})=>{
 const map=await(await request.get('/registry/permalinks.json')).json();
 const slug=Object.values(map.songs).find(value=>value.includes('ソテリア'));
 let requests=0,release;
 const held=new Promise(resolve=>{release=resolve;});
 await page.route(await browserResourceURL('catalog'),async route=>{
  requests++;
  if(requests===1) await route.fulfill({status:503,body:'unavailable'});
  else {await held;await route.fallback();}
 });
 await page.goto('/en/songs/'+encodeURIComponent(slug)+'/');
 await expect(page.locator('#seo-route-view .song-workspace')).toBeVisible();
 await page.locator('#seo-route-view .song-row .chart-row').first().click();
 const compare=page.locator('#seo-route-view .chart-detail-actions button').first();
 await compare.click();
 await expect(page.locator('[data-diagnostic="catalog_unavailable"]')).toBeVisible();
 await compare.click();
 await expect.poll(()=>requests).toBe(2);
 await page.locator('#patterns-tab').click();
 release();
 await expect(page.locator('#patterns')).toBeVisible();
 await expect(page.locator('#compare')).toBeHidden();
 await expect(page.locator('[data-catalog-progress]')).toHaveCount(0);
 expect(requests).toBe(2);
});

test('song import, lazy comparison and Forget share one player session',async({page,request})=>{
 const map=await(await request.get('/registry/permalinks.json')).json();
 const slug=Object.values(map.songs).find(value=>value.includes('ソテリア'));
 const data=JSON.parse(await readFile(new URL('../../output/reconciliation-fixture.json',import.meta.url),'utf8'));
 await page.goto('/en/songs/'+encodeURIComponent(slug)+'/');
 await expect(page.locator('#seo-route-view .song-workspace')).toBeVisible();
 await page.locator('#seo-route-view .song-row .chart-row').first().click();
 await page.evaluate(()=>{window.fixtureSongPlayer=maimaiPersonal;});
 await page.locator('input[type=file]').setInputFiles({name:'fictional.gz',mimeType:'application/gzip',buffer:gzipSync(Buffer.from(JSON.stringify(data)))});
 await page.getByLabel('Remember on this device',{exact:true}).check();
 await page.getByRole('button',{name:'Import data',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>maimaiPersonal.enabled())).toBe(true);
 const revision=await page.evaluate(async()=>(await maimaiPlayerStorage.read()).active.revision);
 await page.locator('#seo-route-view .chart-detail-actions button').first().click();
 await expect(page.locator('#compare')).toBeVisible();
 expect(await page.evaluate(()=>fixtureSongPlayer===maimaiPersonal)).toBe(true);
 expect(await page.evaluate(async()=>(await maimaiPlayerStorage.read()).active.revision)).toBe(revision);
 await page.locator('#settings-toggle').click();await page.locator('#player-forget').click();
 await expect.poll(()=>page.evaluate(async()=>(await maimaiPlayerStorage.read()).active)).toBeNull();
 expect(await page.evaluate(()=>maimaiPersonal.enabled())).toBe(true);
});
test('tampered song data preserves readable public information and reports failure',async({page,request})=>{
 const map=await(await request.get('/registry/permalinks.json')).json();
 const slug=Object.values(map.songs)[0];
 await page.route('**/song-catalog/**',route=>route.fulfill({status:200,contentType:'application/json',body:'{}'}));
 await page.goto('/en/songs/'+encodeURIComponent(slug)+'/');
 await expect(page.locator('main[data-seo-page="song"] .seo-table')).toBeVisible();
 await expect(page.locator('[data-diagnostic="catalog_unavailable"]')).toBeVisible();
 await expect(page.locator('.song-workspace')).toHaveCount(0);
});


test('About stays available and supersedes a pending comparison catalog',async({page,request})=>{
 const map=await(await request.get('/registry/permalinks.json')).json();
 const slug=Object.values(map.songs).find(value=>value.includes('ソテリア'));
 let release;
 const held=new Promise(resolve=>{release=resolve;});
 let requests=0;
 await page.route(await browserResourceURL('catalog'),async route=>{requests++;await held;await route.fallback();});
 await page.goto('/en/songs/'+encodeURIComponent(slug)+'/');
 await expect(page.locator('#seo-route-view .song-workspace')).toBeVisible();
 await page.locator('#seo-route-view .song-row .chart-row').first().click();
 expect(requests).toBe(0);
 await page.locator('#seo-route-view .chart-detail-actions button').first().click();
 await expect(page.locator('[data-catalog-progress]')).toBeVisible();
 await page.locator('#about-tab').click();
 await expect(page.locator('#about')).toBeVisible();
 await expect(page).toHaveURL(/view=about/);
 release();
 await expect(page.locator('[data-catalog-progress]')).toHaveCount(0);
 await expect(page.locator('#about')).toBeVisible();
 await expect(page.locator('#compare')).toBeHidden();
 await page.locator('#catalog-tab').click();
 await expect(page.locator('#catalog-count')).toHaveText('26 charts');
 expect(requests).toBe(1);
});


for(const dependency of ['song','stylesheet'])for(const target of ['.seo-primary[data-open-browser]','[data-back-results]'])test('static song navigation survives enhancement during a pointer press ('+dependency+') '+target,async({page,request})=>{
 const map=await(await request.get('/registry/permalinks.json')).json();
 const slug=Object.values(map.songs).find(value=>value.includes('ソテリア'));
 const restoring=target==='[data-back-results]';
 if(restoring){
  // A return link exists only for a real saved browser search. Retain that
  // history entry across reload while enhancement is deliberately delayed.
  await page.goto('/?lang=en');
  await expect(page.locator('#catalog-count')).toHaveText('26 charts');
  await page.locator('#search').fill('ソテリア');
  const row=page.locator('#songs .song-row').first();
  await row.locator('.chart-row').click();await row.locator('a[data-song-page]').click();
  await expect(page.locator('#seo-route-view .song-workspace')).toBeVisible();
  await expect(page.locator('#seo-route-view [data-back-results]')).toBeVisible();
 }
 let release,requested=false;
 const held=new Promise(resolve=>{release=resolve;});
 const asset=dependency==='song'?'**/song-catalog/**':await browserResourceURL('seoStyle');
 await page.route(asset,async route=>{
  if(dependency==='stylesheet'&&route.request().resourceType()!=='fetch')return route.fallback();
  requested=true;await held;await route.fallback();
 });
 if(restoring)await page.reload();
 else await page.goto('/en/songs/'+encodeURIComponent(slug)+'/');
 await expect.poll(()=>requested).toBe(true);
 const link=page.locator('body>main[data-seo-page=song] '+target);
 await expect(link).toBeVisible();
 if(!restoring)await expect(page.locator('body>main[data-seo-page=song] [data-back-results]')).toBeHidden();
 const box=await link.boundingBox();
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
 await page.mouse.down();
 const response=page.waitForResponse(response=>dependency==='song'?response.url().includes('/song-catalog/'):response.url()===asset&&response.request().resourceType()==='fetch');
 release();await response;
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 try {await expect(link).toBeVisible();} finally {await page.mouse.up();}
 await expect(page.locator('#songs')).toBeVisible();
 await expect(page.locator('#catalog-count')).toHaveText(restoring?'4 charts':'26 charts');
 if(restoring)await expect(page.locator('#search')).toHaveValue('ソテリア');
 expect(new URL(page.url()).pathname).toBe('/');
});

for(const mode of ['legacy','stale','forged'])test('song release binding '+mode,async({page,request,baseURL})=>{
 const map=await(await request.get('/registry/permalinks.json')).json();
 const slug=Object.values(map.songs).find(value=>value.includes('ソテリア'));
 const path='/en/songs/'+encodeURIComponent(slug)+'/';
 let html=await(await request.get('/registry'+path)).text();
 const attribute=html.match(/data-song-binding="([^"]+)"/)[0];
 const binding=JSON.parse(attribute.slice(19,-1).replaceAll('&quot;','"').replaceAll('&#x27;',"'").replaceAll('&amp;','&'));
 if(mode==='legacy'){
  const content=await(await request.get('/registry/'+binding.path)).json();
  content.schema_version='maimai-song-catalog-1';content.data.source_catalog_sha256=binding.source_catalog_sha256;
  const body=Buffer.from(JSON.stringify(content));
  const {createHash}=await import('node:crypto');const digest=createHash('sha256').update(body).digest('hex');
  html=html.replace(attribute,`data-song-catalog="song-catalog/${digest}.json" data-song-sha256="${digest}" data-song-bytes="${body.length}"`);
  await page.route('**/song-catalog/'+digest+'.json',route=>route.fulfill({contentType:'application/json',body}));
 }else{
  if(mode==='stale')binding.source_catalog_sha256='0'.repeat(64);
  else binding.song_id='unrelated-canonical-song';
  html=html.replace(attribute,'data-song-binding="'+JSON.stringify(binding).replaceAll('&','&amp;').replaceAll('"','&quot;')+'"');
 }
 await page.route(baseURL+path,route=>route.fulfill({contentType:'text/html',body:html}));
 await page.goto(path);
 if(mode==='legacy'){
  await page.locator('#seo-route-view .song-row .chart-row').first().click();
  await expect(page.locator('#seo-route-view .song-workspace .chart-measurements').first()).toBeVisible();
  await expect(page.locator('#lab-status')).toBeEmpty();
 }else{
  await expect(page.locator('main[data-seo-page="song"] .seo-table')).toBeVisible();
  await expect(page.locator('[data-diagnostic="catalog_unavailable"]')).toBeVisible();
  await expect(page.locator('.song-workspace')).toHaveCount(0);
 }
});

for(const locale of ['en','ja','ko','zh-hans'])for(const width of [320,768,1280]){
 test('browser opens only the selected song difficulty '+locale+' '+width,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.goto('/?lang='+locale);await expect(page.locator('#catalog-count')).toHaveText(/26/);
  await page.locator('#search').fill('ソテリア');
  const row=page.locator('#songs .song-row').first();
  // Explicitly choose a non-first difficulty before opening its song page.
  const selected=await row.locator('.row-difficulty option').evaluateAll(options=>options[0].value);
  await row.locator('.row-difficulty').selectOption(selected);
  await expect(row).toHaveAttribute('data-difficulty','MASTER');await row.locator('.chart-row').click();
  const link=row.locator('a[data-song-page]');await expect(link).toBeVisible();
  expect(new URL(await link.getAttribute('href'),page.url()).hash).toBe('#chart-'+encodeURIComponent(selected));
  await link.click();
  const expanded=page.locator('#seo-route-view .song-row').filter({has:page.locator('.chart-row[aria-expanded=true]')});
  await expect(expanded).toHaveCount(1);await expect(expanded).toHaveAttribute('data-chart-id',selected);
  await page.locator('#seo-route-view [data-seo-international]').check();
  await expect(expanded).toHaveCount(1);await expect(expanded).toHaveAttribute('data-chart-id',selected);
  const target=page.url();
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href','https://maimai.party'+new URL(target).pathname);
  await page.goBack();await expect(page.locator('#search')).toHaveValue('ソテリア');
  await page.goForward();await expect(expanded).toHaveCount(1);await expect(expanded).toHaveAttribute('data-chart-id',selected);
  await page.reload();await expect(expanded).toHaveCount(1);await expect(expanded).toHaveAttribute('data-chart-id',selected);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await expanded.locator('.chart-detail-actions button').first().click();
  await expect(page.locator('#compare')).toBeVisible();expect(new URL(page.url()).hash).toBe('');
 });
}
for(const fragment of ['', '#chart-not-in-this-song', '#chart-%E0%A4%A', '#privacy'])test('song arrival starts collapsed without a valid chart '+fragment,async({page,request})=>{
 const map=await(await request.get('/registry/permalinks.json')).json();
 const slug=Object.values(map.songs).find(value=>value.includes('ソテリア'));
 await page.goto('/en/songs/'+encodeURIComponent(slug)+'/'+fragment);
 await expect(page.locator('#seo-route-view .song-workspace .song-row').first()).toBeVisible();
 await expect(page.locator('#seo-route-view .chart-row[aria-expanded=true]')).toHaveCount(0);
 await page.locator('#seo-route-view [data-seo-international]').check();
 await expect(page.locator('#seo-route-view .chart-row[aria-expanded=true]')).toHaveCount(0);
});

test('delayed player readiness cannot reopen a linked chart after the user collapses it',async({page,request})=>{
 await page.addInitScript(()=>{
  const open=IDBFactory.prototype.open;
  IDBFactory.prototype.open=function(...args){
   const request=open.apply(this,args),descriptor=Object.getOwnPropertyDescriptor(IDBRequest.prototype,'onsuccess');
   Object.defineProperty(request,'onsuccess',{configurable:true,set(handler){descriptor.set.call(request,async event=>{
    window.fixtureStorageHeld=true;await new Promise(resolve=>window.fixtureReleaseStorage=resolve);handler?.call(request,event);
   });}});
   return request;
  };
 });
 const map=await(await request.get('/registry/permalinks.json')).json();
 const slug=Object.values(map.songs).find(value=>value.includes('ソテリア'));
 const path='/en/songs/'+encodeURIComponent(slug)+'/';
 const html=await(await request.get('/registry'+path)).text();
 const ids=[...html.matchAll(/<tr id="chart-([^"<>]+)"/g)].map(match=>decodeURIComponent(match[1]));
 const selected=ids.at(-1);expect(selected).toBeTruthy();
 await page.goto(path+'#chart-'+encodeURIComponent(selected));
 const expanded=page.locator('#seo-route-view .song-row').filter({has:page.locator('.chart-row[aria-expanded=true]')});
 await expect(expanded).toHaveCount(1);await expect(expanded).toHaveAttribute('data-chart-id',selected);
 await expect.poll(()=>page.evaluate(()=>window.fixtureStorageHeld)).toBe(true);
 await expanded.locator('.chart-row').click();
 await page.evaluate(async()=>{fixtureReleaseStorage();await maimaiPersonal.ready;});
 await expect(expanded).toHaveCount(0);
 await page.locator('#seo-route-view [data-seo-international]').check();
 await expect(expanded).toHaveCount(0);
});
