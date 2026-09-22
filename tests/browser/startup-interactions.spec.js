import {test,expect} from './fixtures.js';

test('settings and private import remain usable while the public catalog is delayed',async({page})=>{
  let release,observed;
  const hold=new Promise(resolve=>release=resolve),requested=new Promise(resolve=>observed=resolve);
  await page.route(/\/(?:catalogs|catalog-index|catalog-index-parts|catalog-parts)\//,async route=>{observed();await hold;await route.continue();});
  try {
    await page.goto('/lab/',{waitUntil:'domcontentloaded'});await requested;
    await expect.poll(()=>page.locator('#settings-toggle').evaluate(node=>typeof node.onclick==='function')).toBe(true);
    await page.locator('#settings-toggle').click();await expect(page.locator('#settings-menu')).toBeVisible();
    await expect(page.locator('#player-import')).toBeVisible();await page.locator('#player-import').click();
    await expect(page.locator('#player-import-dialog')).toBeVisible();
    await expect(page.locator('#songs .song-row')).toHaveCount(0);
  } finally {release();}
  await expect(page.locator('#songs .song-row')).toHaveCount(6);
});


test('a public catalog failure does not disable private imports or settings',async({page})=>{
  await page.route(/\/(?:catalogs|catalog-index|catalog-index-parts|catalog-parts)\//,route=>route.fulfill({status:503,body:'Fixture unavailable'}));
  await page.goto('/lab/');await expect(page.locator('#lab-status')).not.toHaveText('');
  await expect.poll(()=>page.locator('#settings-toggle').evaluate(node=>typeof node.onclick==='function')).toBe(true);
  await page.locator('#settings-toggle').click();await expect(page.locator('#player-import')).toBeVisible();
  await page.locator('#player-import').click();await expect(page.locator('#player-import-dialog')).toBeVisible();
});
