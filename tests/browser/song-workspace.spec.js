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
  const row=page.locator('#seo-route-view .song-row').first();
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
 let release,requested=false;
 const held=new Promise(resolve=>{release=resolve;});
 const asset=dependency==='song'?'**/song-catalog/**':await browserResourceURL('seoStyle');
 await page.route(asset,async route=>{
  if(dependency==='stylesheet'&&route.request().resourceType()!=='fetch')return route.fallback();
  requested=true;await held;await route.fallback();
 });
 await page.goto('/en/songs/'+encodeURIComponent(slug)+'/');
 await expect.poll(()=>requested).toBe(true);
 const link=page.locator('body>main[data-seo-page=song] '+target);
 const box=await link.boundingBox();
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
 await page.mouse.down();
 const response=page.waitForResponse(response=>dependency==='song'?response.url().includes('/song-catalog/'):response.url()===asset&&response.request().resourceType()==='fetch');
 release();await response;
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 try {await expect(link).toBeVisible();} finally {await page.mouse.up();}
 await expect(page.locator('#songs')).toBeVisible();
 await expect(page.locator('#catalog-count')).toHaveText('26 charts');
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
