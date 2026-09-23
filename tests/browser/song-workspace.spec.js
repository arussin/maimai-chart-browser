import {test,expect} from './fixtures.js';
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';

// Synthetic corpus only. Every request stays on the isolated loopback fixture server.
test.beforeEach(async({page,baseURL})=>{
 await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!==baseURL){await route.abort();return;}const response=await route.fetch({url:baseURL+'/registry'+url.pathname+url.search});await route.fulfill({response});});
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
  await expect(page.locator('#lab-status')).toBeEmpty();
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

for(const selector of ['.chart-row','.row-difficulty','.chart-detail-actions button:first-child','#settings-toggle']){
 test('delayed player readiness preserves song keyboard focus '+selector,async({page,request})=>{
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
  await page.goto('/en/songs/'+encodeURIComponent(slug)+'/');
  const row=page.locator('#seo-route-view .song-row').first(),control=selector==='#settings-toggle'?page.locator(selector):row.locator(selector);
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
 await page.route('**/manifest.json',async route=>{
  catalogs.push(route.request().url());await held;await route.fallback();
 });
 await page.goto('/en/songs/'+encodeURIComponent(slug)+'/');
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
 await page.route('**/manifest.json',async route=>{await held;if(failure)await route.fulfill({status:503,body:'unavailable'});else await route.fallback();});
 await page.goto('/en/songs/'+encodeURIComponent(slug)+'/');
 await expect(page.locator('#seo-route-view .song-workspace')).toBeVisible();
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

test('song import, lazy comparison and Forget share one player session',async({page,request})=>{
 const map=await(await request.get('/registry/permalinks.json')).json();
 const slug=Object.values(map.songs).find(value=>value.includes('ソテリア'));
 const data=JSON.parse(await readFile(new URL('../../output/reconciliation-fixture.json',import.meta.url),'utf8'));
 await page.goto('/en/songs/'+encodeURIComponent(slug)+'/');
 await expect(page.locator('#seo-route-view .song-workspace')).toBeVisible();
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
 await page.route('**/manifest.json',async route=>{requests++;await held;await route.fallback();});
 await page.goto('/en/songs/'+encodeURIComponent(slug)+'/');
 await expect(page.locator('#seo-route-view .song-workspace')).toBeVisible();
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
