import {test,expect} from './fixtures.js';

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
