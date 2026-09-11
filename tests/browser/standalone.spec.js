import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {readFile} from 'node:fs/promises';
// Resolve fixtures from repository root rather than the browser's served directory.
const fixtureURL=new URL('../../output/personal-fixture.json',import.meta.url);
async function personal(){return JSON.parse(await readFile(fixtureURL,'utf8'));}
async function open(page){await page.goto('/');await expect(page.locator('#explore-search')).toBeVisible();}
async function importValue(page,value){await page.locator('#site-import').setInputFiles({name:'results.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});}

test('search, filtering, detail and keyboard close remain usable',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await open(page);
  await page.locator('#explore-search').fill('orbit');await expect(page.locator('#explore-count')).toContainText('2 matching');
  await page.locator('#explore-list [data-chart]').first().click();await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.locator('#explore-reset').click();await expect(page.locator('#explore-count')).toContainText('7 matching');
  expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('personal file renders prepared cards, makes no requests, clears and reloads cleanly',async({page})=>{
  await open(page);const requests=[];page.on('request',r=>requests.push(r.url()));
  await importValue(page,await personal());await expect(page.getByRole('button',{name:'My results',exact:true})).toBeVisible();
  await expect(page.locator('#personal-targets .explore-target').first()).toBeVisible();
  expect(requests).toEqual([]);expect(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length}))).toEqual({local:0,session:0});
  await page.locator('#site-clear').click();await expect(page.getByRole('button',{name:'My results',exact:true})).toHaveCount(0);
  await expect(page.locator('#personal-targets')).toBeHidden();await importValue(page,await personal());await page.reload();
  await expect(page.locator('#explore-search')).toBeVisible();await expect(page.locator('#site-clear')).toBeHidden();
});
test('invalid versions, missing charts and duplicate attempts fail without replacing valid data',async({page})=>{
  await open(page);await importValue(page,await personal());
  for(const edit of [x=>x.schema_version='9.0.0',x=>x.catalog.version='wrong',x=>x.overlay.entries[0].chart_id='missing',x=>x.overlay.entries[0].attempts.push(x.overlay.entries[0].attempts[0])]){
    const data=await personal();edit(data);await importValue(page,data);await expect(page.locator('#site-status')).toHaveAttribute('data-error','true');
    await expect(page.getByRole('button',{name:'My results',exact:true})).toBeVisible();
  }
});
test('versioned chart links open exact details and missing releases are recoverable',async({page})=>{
  const data=await personal(),id=data.overlay.entries[0].chart_id;
  await page.goto('/?'+new URLSearchParams({catalog:data.catalog.id,version:data.catalog.version,chart:id}));
  await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByRole('dialog')).toContainText(id);
  await page.goto('/?catalog=gone&version=old');await expect(page.locator('#site-status')).toContainText('not available');
  await page.locator('#site-catalog').selectOption('1');await expect(page.locator('#explore-search')).toBeVisible();
  await page.goto('/?'+new URLSearchParams({catalog:data.catalog.id,version:data.catalog.version,chart:'missing'}));
  await expect(page.locator('#site-status')).toContainText('not present');await expect(page.locator('#explore-search')).toBeVisible();
});
test('accessible controls and mobile reflow with personal cards',async({page})=>{
  await open(page);await importValue(page,await personal());await expect(page.locator('#site-clear')).toBeVisible();
  const results=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(results.violations).toEqual([]);
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('Challenge Lab keeps game-style folders and comparison samples',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/lab/?version=fixture-v1');await expect(page.locator('#loaded-count')).toHaveText('6');
  await page.locator('#search').fill('Fictional study 0');await expect(page.locator('#songs')).toContainText('Fictional study 0');
  await page.locator('#search').fill('');await page.locator('#browse-version').click();await expect(page.locator('#folders')).toContainText('PRiSM PLUS');
  await page.locator('#sort-level').click();await expect(page.locator('#folders')).toContainText('10');
  await page.locator('#compare-tab').click();await expect(page.locator('#query-card')).toBeVisible();
  expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
