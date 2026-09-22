import {test,expect} from '@playwright/test';
for(const locale of ['en','ja','ko','zh-Hans'])for(const width of [320,768,1280]){
 test('existing catalog appearance '+locale+' '+width,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.addInitScript(()=>{localStorage.setItem('maimai-catalog-filters-collapsed','0');localStorage.setItem('maimai-personal-filters-collapsed','0');});
  await page.goto('/registry/');await expect(page.locator('#catalog-count')).toHaveText('26 charts');
  await page.locator('.site-header [data-language="'+locale+'"]').click();
  await page.evaluate(()=>document.fonts.ready);
  await expect(page).toHaveScreenshot(locale+'-'+width+'-catalog.png',{fullPage:true});
  await page.locator('#use-international-data').check();
  await expect(page).toHaveScreenshot(locale+'-'+width+'-international.png',{fullPage:true});
  await page.locator('#settings-toggle').click();
  await expect(page).toHaveScreenshot(locale+'-'+width+'-settings.png');
 });
}
