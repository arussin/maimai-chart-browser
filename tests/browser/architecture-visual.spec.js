import {browserResourceURL} from './browser-configuration-fixture.mjs';
import os from 'node:os';
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {test,expect} from './fixtures.js';
for(const locale of ['en','ja','ko','zh-Hans'])for(const width of [320,768,1280]){
 test('existing catalog appearance '+locale+' '+width,async({page,browser},testInfo)=>{
  await page.setViewportSize({width,height:900});await page.clock.setFixedTime(new Date('2026-09-22T12:00:00Z'));
  await page.addInitScript(()=>{localStorage.setItem('maimai-catalog-filters-collapsed','0');localStorage.setItem('maimai-personal-filters-collapsed','0');});
  await page.goto('/registry/');await expect(page.locator('#catalog-count')).toHaveText('26 charts');
  await page.locator('.site-header [data-language="'+locale+'"]').click();
  await page.evaluate(()=>document.fonts.ready);await environment(page,browser,testInfo);
  await decodedImages(page);await expect(page).toHaveScreenshot(locale+'-'+width+'-catalog.png',{fullPage:true});
  await page.locator('#use-international-data').check();
  await decodedImages(page);await expect(page).toHaveScreenshot(locale+'-'+width+'-international.png',{fullPage:true});
  await page.locator('#settings-toggle').click();
  await decodedImages(page);await expect(page).toHaveScreenshot(locale+'-'+width+'-settings.png');
 });
}

// Shared public fixture identity is held constant between the retained and new runtime.
for(const locale of ['en','ja','ko','zh-Hans'])for(const width of [320,768,1280]){
 test('existing detailed interactions '+locale+' '+width,async({page,baseURL,browser},testInfo)=>{
  await page.setViewportSize({width,height:900});await page.clock.setFixedTime(new Date('2026-09-22T12:00:00Z'));
  await page.addInitScript(()=>{localStorage.setItem('maimai-catalog-filters-collapsed','0');localStorage.setItem('maimai-personal-filters-collapsed','0');});
  const routeResources=await Promise.all(['permalinks','seoStyle'].map(role=>browserResourceURL(role,{origin:baseURL})));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin===baseURL&&(/^\/(en|ja|ko|zh-hans)\//.test(url.pathname)||routeResources.includes(url.href))){const response=await route.fetch({url:baseURL+'/registry'+url.pathname+url.search});await route.fulfill({response});}
   else await route.continue();
  });
  await page.goto('/registry/?search=ソテリア');await expect(page.locator('#songs .song-row')).toHaveCount(4);
  await page.locator('.site-header [data-language="'+locale+'"]').click();await page.evaluate(()=>document.fonts.ready);await environment(page,browser,testInfo);
  const first=page.locator('#songs .song-row').first();await first.locator('.chart-row').click();
  await expect(first.locator('.chart-pattern-detail')).toBeVisible();
  await decodedImages(page);await expect(page).toHaveScreenshot(locale+'-'+width+'-expanded.png',{fullPage:true});
  const bytes=gzipSync(Buffer.from(await readFile(new URL('../../output/reconciliation-fixture.json',import.meta.url))));
  await page.locator('input[type=file]').setInputFiles({name:'fictional-profile.gz',mimeType:'application/gzip',buffer:bytes});
  await expect(page.locator('.player-dialog')).toBeVisible();
  await decodedImages(page);await expect(page).toHaveScreenshot(locale+'-'+width+'-import-dialog.png');
  await page.locator('.player-remember input').uncheck();await page.locator('.player-dialog .player-actions button').first().click();
  await expect(page.locator('.player-dialog')).not.toBeVisible();await expect(page.locator('.player-filters')).toBeVisible();
  await decodedImages(page);await expect(page).toHaveScreenshot(locale+'-'+width+'-personal.png',{fullPage:true});
  const link=page.locator('#songs a[data-song-page]').first();await expect(link).toBeVisible();await link.focus();
  await link.click();await expect(page.locator('#seo-route-view')).toBeVisible();await page.locator('#seo-route-view [data-back-results]').click();
  await expect(link).toBeFocused();await expect(page.locator('#seo-route-view')).not.toBeVisible();
  // The song workspace has its own layout. Compare restored focus with the pointer outside controls.
  await page.mouse.move(0,0);
  await decodedImages(page);await expect(page).toHaveScreenshot(locale+'-'+width+'-return.png',{fullPage:true});
  await page.locator('#compare-tab').click();await page.locator('#compare-left-search').fill('ソテリア');await page.locator('#compare-left-search').press('ArrowDown');await page.locator('#compare-left-search').press('Enter');
  await page.locator('#compare-right-search').fill('ソテリア');await page.locator('#compare-right-search').press('ArrowDown');await page.locator('#compare-right-search').press('ArrowDown');await page.locator('#compare-right-search').press('Enter');
  await expect(page.locator('#direct-comparison')).not.toBeEmpty();
  await decodedImages(page);await expect(page).toHaveScreenshot(locale+'-'+width+'-comparison.png',{fullPage:true});
 });
}

async function environment(page,browser,testInfo){
 const computed=await page.locator('body').evaluate(body=>[body,...body.querySelectorAll('h1,h2,button,input,.song-title')].slice(0,30).map(node=>{const value=getComputedStyle(node);return {tag:node.tagName,family:value.fontFamily,size:value.fontSize,weight:value.fontWeight};}));
 let actualFonts=null,actualFontStatus='unavailable: this engine does not expose resolved platform fonts';
 if(testInfo.project.name==='chromium'){
  const session=await page.context().newCDPSession(page);await session.send('DOM.enable');await session.send('CSS.enable');
  const {root}=await session.send('DOM.getDocument'),{nodeId}=await session.send('DOM.querySelector',{nodeId:root.nodeId,selector:'body'});
  const {fonts}=await session.send('CSS.getPlatformFontsForNode',{nodeId});await session.detach();actualFonts=fonts;actualFontStatus='CDP platform font report';
 }
 await testInfo.attach('visual-platform-fonts',{body:JSON.stringify({browser:browser.version(),engine:testInfo.project.name,platform:process.platform,release:os.release(),arch:process.arch,actualFonts,actualFontStatus,computed}),contentType:'application/json'});
}

// Full-page screenshots include offscreen lazy artwork. Decode it in both inputs
// so capture order cannot decide whether the same version logo is painted.
async function decodedImages(page){
 await page.evaluate(async()=>{
  const images=[...document.images];
  images.forEach(image=>{image.loading='eager';});
  await Promise.all(images.map(image=>image.decode().catch(()=>{})));
  await document.fonts.ready;
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 });
}
