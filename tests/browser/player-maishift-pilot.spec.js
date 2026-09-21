import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createService,PATH} from '../../player-import-worker/index.mjs';
import {publicProfile,wire} from '../../player-import-worker/fixtures.mjs';
const entry='/maishift-pilot/pilot/maishift/';
const artifact=()=>path.join(process.env.MAIMAI_BROWSER_OUTPUT||'../../output/browser-tests','maishift-pilot');
async function setup(page,context,locale='en'){
  const config=JSON.parse(await readFile(path.join(artifact(),'pilot/maishift/mapping.json'),'utf8'));
  const [id,row]=Object.entries(config.mapping.charts).find(([id])=>id.startsWith('maishift:intl:'));
  const profile=publicProfile(),tracks={songs:[{...row.expected_source,type:row.expected_source.format==='STD'?'STANDARD':'DX'}],tracks:[{s:0,i:Number(id.split(':')[2]),d:row.expected_source.difficulty.replace('RE:MASTER','RE_MASTER'),r:{a:987654,d:100,m:300}}]};
  const state={calls:0,profile,tracks,hold:null,status:200,external:[]};
  await context.addCookies([{name:'unrelated-session',value:'fictional-cookie',url:'http://127.0.0.1:'+(process.env.MAIMAI_TEST_PORT||8766)}]);
  await context.addInitScript(locale=>{localStorage.setItem('maimai-language-v1',locale);localStorage.setItem('unrelated-player-sentinel','keep');},locale);
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.hostname!=='127.0.0.1'){state.external.push(url.origin);await route.abort();return;}
    if(url.pathname!==PATH){await route.continue();return;}
    const headers=await request.allHeaders();for(const name of ['cookie','authorization','referer'])expect(headers[name]).toBeUndefined();
    state.calls++;if(state.hold)await state.hold;
    if(state.status!==200){await route.fulfill({status:state.status,contentType:'application/json',headers:{'Retry-After':'120'},body:'{"error":"upstream_busy"}'});return;}
    const values=[profile,tracks,profile],service=createService({fetcher:async()=>Response.json(wire(values.shift()))});
    const response=await service.fetch(new Request('https://maimai.party'+PATH,{method:'POST',headers:{Origin:'https://maimai.party','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1'},body:request.postData()}),{MAISHIFT_ENABLED:'true',CLIENT_LIMITER:{limit:async()=>({success:true})},PROFILE_LIMITER:{getByName:()=>({claim:async()=>({id:'fictional'}),finish:async()=>{}})}});
    await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
  });
  await page.clock.install();await page.goto(entry);await expect(page.locator('#baseline')).toBeEnabled();
  await page.locator('#profile').fill('https://maimai.shiftpsh.com/en/profile/fictional-player');return state;
}
async function capture(page,id){await page.locator('#'+id).click();await expect(page.locator('#status')).toContainText('Read complete.');}
async function summary(page){const pending=page.waitForEvent('download');await page.locator('#download').click();const download=await pending,stream=await download.createReadStream(),parts=[];for await(const part of stream)parts.push(part);return JSON.parse(Buffer.concat(parts).toString());}
test('hosted pilot completes genuine-change steps with sanitized evidence and no player storage',async({page,context},testInfo)=>{
  const state=await setup(page,context);await page.locator('#baseline').click();expect(state.calls).toBe(0);
  await page.locator('#consent').check();await capture(page,'baseline');expect((await summary(page)).outcome).toBe('needs_changed_upload');
  await page.clock.fastForward(31000);await capture(page,'updated');expect((await summary(page)).outcome).toBe('needs_changed_upload');
  state.tracks.tracks[0].r.a=990001;state.profile.userRecord.profile.updatedAt=new Date('2026-09-21T00:00:00Z');
  await page.clock.fastForward(31000);await capture(page,'updated');expect((await summary(page)).outcome).toBe('needs_stable_check');
  await page.clock.fastForward(31000);await capture(page,'confirmed');const report=await summary(page);expect(report.outcome).toBe('observed_pass');expect(report.releaseReady).toBe(false);
  for(const value of ['fictional-player','Fictional Player','987654','990001','maishift:intl:'])expect(JSON.stringify(report)).not.toContain(value);
  expect(state.external).toEqual([]);expect(state.calls).toBe(4);
  await expect(page.locator('#sharing-notice')).toContainText('only available on this computer');
  expect(await page.evaluate(async()=>({dbs:(await indexedDB.databases()).map(d=>d.name),sentinel:localStorage.getItem('unrelated-player-sentinel')}))).toEqual({dbs:[],sentinel:'keep'});
  await page.screenshot({path:testInfo.outputPath('maishift-pilot.png'),fullPage:true});
  await page.locator('#clear').click();expect((await summary(page)).baseline).toBeNull();
});
test('clear aborts a delayed read; throttling keeps prior evidence and honors retry timing',async({page,context})=>{
  const state=await setup(page,context);await page.locator('#consent').check();await capture(page,'baseline');
  state.status=429;await page.clock.fastForward(31000);await page.locator('#updated').click();await expect(page.locator('#status')).toContainText('Please wait');
  expect((await summary(page)).baseline.played).toBe(1);expect((await summary(page)).outcome).toBe('read_failed');
  await page.clock.fastForward(31000);await expect(page.locator('#updated')).toBeDisabled();
  await page.clock.fastForward(90000);await expect(page.locator('#updated')).toBeEnabled();
  state.status=200;let release;state.hold=new Promise(resolve=>{release=resolve;});await page.locator('#updated').click();await expect.poll(()=>state.calls).toBe(3);
  await page.locator('#clear').click();release();await expect(page.locator('#results')).toBeHidden();expect((await summary(page)).baseline).toBeNull();
});
for(const locale of ['en','zh-Hans','ko','ja'])test(`pilot ${locale} controls fit at 320px and support the keyboard`,async({page,context})=>{
  await page.setViewportSize({width:320,height:800});const state=await setup(page,context,locale);await expect(page.locator('html')).toHaveAttribute('lang',locale);
  if(locale!=='en')await expect(page.locator('h1')).not.toHaveText('Maishift pilot test');
  await page.locator('#consent').focus();await page.keyboard.press('Space');await page.keyboard.press('Tab');await page.keyboard.press('Enter');await expect(page.locator('#results')).toBeVisible();
  expect(state.calls).toBe(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  // A long URL scrolls inside its native single-line field; control labels must fit.
  const clipping=await page.locator('button,select').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().width&&n.scrollWidth>n.clientWidth+2).length);expect(clipping).toBe(0);
  await expect(page.locator('#profile')).toHaveValue('https://maimai.shiftpsh.com/en/profile/fictional-player');
  expect(await page.locator('#profile').evaluate(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})).toBe(true);
  expect(await page.locator('.language-controls button').evaluateAll(nodes=>nodes.every(n=>n.getBoundingClientRect().width>=44&&n.getBoundingClientRect().height>=44))).toBe(true);
  state.profile.region='JAPAN';await page.clock.fastForward(31000);await page.locator('#updated').click();
  const source='Maishift returned a different game region. Try the other region.';
  const catalog=JSON.parse(await readFile(new URL('../../src/maimai_intelligence/assets/locales/maishift-pilot.json',import.meta.url),'utf8'));
  await expect(page.locator('#status')).toHaveText(locale==='en'?source:catalog.messages[source][locale]);
  await expect(page.locator('#results')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
