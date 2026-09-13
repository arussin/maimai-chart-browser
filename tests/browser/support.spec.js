import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {readFile} from 'node:fs/promises';

const origin='https://buymeacoffee.com';
const fixture='<!doctype html><html lang="en"><title>Checkout fixture</title><main><h1>Checkout fixture</h1><button>Fixture action</button></main></html>';

for(const personal of [false,true])test(`support checkout is lazy, isolated and keyboard accessible (${personal?'personal':'public'})`,async({page,context},testInfo)=>{
  const requests=[];let release;
  const gate=new Promise(resolve=>{release=resolve;});
  await context.route(origin+'/**',async route=>{
    const request=route.request();
    requests.push({url:request.url(),headers:await request.allHeaders(),body:request.postData()});
    await gate;await route.fulfill({contentType:'text/html',body:fixture});
  });
  await page.goto(personal?'/?search=PRIVATE_SEARCH#PRIVATE_HASH':'/lab/?view=about&search=PRIVATE_SEARCH#PRIVATE_HASH');
  if(personal){
    await expect(page.locator('#explore-search')).toBeVisible();
    const data=JSON.parse(await readFile(new URL('../../output/personal-fixture.json',import.meta.url),'utf8'));
    data.overlay.entries[0].attempts[0].attempt_id='PRIVATE_SUPPORT_ATTEMPT';
    await page.locator('#site-import').setInputFiles({name:'PRIVATE_PLAYER.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
    await expect(page.locator('#site-clear')).toBeVisible();
  }else await expect(page.locator('#loaded-count')).toHaveText('6');
  const opener=page.locator('#support-open'),dialog=page.locator('#support-checkout-dialog');
  await expect(opener).toHaveAttribute('aria-haspopup','dialog');
  await expect(page.locator('.support-frame')).not.toHaveAttribute('src');expect(requests).toEqual([]);
  await opener.focus();await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();await expect(page.locator('.support-loading')).toBeVisible();
  await expect(page.getByRole('button',{name:'Close support checkout'})).toBeFocused();
  await expect.poll(()=>requests.length).toBe(1);
  const destination=new URL(requests[0].url);
  expect(destination.origin).toBe(origin);expect(destination.pathname).toBe('/widget/page/russin');
  expect(Object.fromEntries(destination.searchParams)).toEqual({description:'Support maimai.party',color:'#5F7FFF'});
  expect(requests[0].headers.referer).toBeUndefined();expect(requests[0].body).toBeNull();
  await expect(page.locator('.support-frame')).toHaveAttribute('allow','payment '+origin);
  await expect(page.locator('.support-frame')).toHaveAttribute('referrerpolicy','no-referrer');
  const fallback=page.locator('.support-fallback');
  await expect(fallback).toBeHidden();await expect(fallback).toHaveAttribute('href',origin+'/russin');
  await expect(fallback).toHaveAttribute('rel','noopener noreferrer');
  await expect(fallback).toHaveAttribute('referrerpolicy','no-referrer');
  release();await expect(page.locator('.support-loading')).toBeHidden();
  await expect(fallback).toBeHidden();
  await expect(page.frameLocator('.support-frame').getByRole('heading',{name:'Checkout fixture'})).toBeVisible();
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  expect(await dialog.evaluate(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&node.scrollWidth<=node.clientWidth;})).toBe(true);
  await page.screenshot({path:testInfo.outputPath('support-checkout.png')});
  await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(opener).toBeFocused();
  expect(await page.locator('body').evaluate(node=>node.classList.contains('support-dialog-open'))).toBe(false);
  await opener.click();await expect(dialog).toBeVisible();expect(requests).toHaveLength(1);
  await page.getByRole('button',{name:'Close support checkout'}).click();await expect(opener).toBeFocused();
  if(personal)await expect(page.locator('#site-clear')).toBeVisible();
  expect(JSON.stringify(requests)).not.toContain('PRIVATE_');
});

test('support remains available after catalog failure and offers a fallback only when checkout stalls',async({page,context})=>{
  await page.route('**/manifest.json',route=>route.fulfill({status:503,body:'Unavailable'}));
  let release;const gate=new Promise(resolve=>{release=resolve;});
  await context.route(origin+'/**',async route=>{await gate;await route.abort();});
  await page.goto('/lab/?view=about');await expect(page.locator('#lab-status')).toContainText('could not be loaded');
  await page.locator('#support-open').click();await expect(page.locator('#support-checkout-dialog')).toBeVisible();
  const fallback=page.getByRole('link',{name:'Open on Buy Me a Coffee'});
  await expect(fallback).toBeHidden();await expect(fallback).toBeVisible({timeout:15000});
  await context.route(origin+'/russin',route=>route.fulfill({contentType:'text/html',body:fixture}));
  const opened=context.waitForEvent('page');await fallback.click();const popup=await opened;
  await expect(popup).toHaveURL(origin+'/russin');await popup.close();
  await page.getByRole('button',{name:'Close support checkout'}).click();await expect(page.locator('#support-open')).toBeFocused();
  release();
});
