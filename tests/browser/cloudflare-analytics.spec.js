import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../output/browser-tests/',import.meta.url));
const cfOrigin='https://static.cloudflareinsights.com';
const collector='https://cloudflareinsights.com/cdn-cgi/rum';
const storageKey='maimai.party.analytics.v1';
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
const paths=['/','/lab/'];

// Every request is intercepted, including the real vendor audit. No live traffic.
async function hosted(context,{inject=false,suffix='/beacon.min.js',endpoint=collector,sdk,release=false}={}){
  const external=[],collected=[];
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin===cfOrigin){
      external.push(url.href);
      return route.fulfill({contentType:'application/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:sdk||
        `window.__cfStubLoaded=true;window.__cfSample=()=>fetch(${JSON.stringify(endpoint)},{method:'POST',body:'synthetic-traffic-count'});window.__cfSample().then(r=>{window.__cfStubCollected=r.ok;});`});
    }
    if(url.href===collector||(url.origin==='https://maimai.party'&&url.pathname==='/cdn-cgi/rum')){
      collected.push({url:url.href,method:request.method(),body:request.postData()||'',headers:await request.allHeaders()});
      return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'https://maimai.party','Access-Control-Allow-Credentials':'true'},body:''});
    }
    if(!['maimai.party','preview.invalid','127.0.0.1'].includes(url.hostname)){
      external.push(url.href);return route.fulfill({status:204,body:''});
    }
    const file=resolve(root,release?'progressive':'.','.'+decodeURIComponent(url.pathname)+(url.pathname.endsWith('/')?'index.html':''));
    if(!file.startsWith(root.replace(/[\\/]$/,'')+sep))return route.abort();
    try{
      let body=await readFile(file);
      if(inject&&extname(file)==='.html'){
        // Match Pages' native token-only, deferred script, inserted before parsing.
        body=Buffer.from(body.toString().replace('</body>',`<script defer src="${cfOrigin+suffix}" data-cf-beacon='{"token":"00000000000000000000000000000000"}'></script></body>`));
      }
      return route.fulfill({contentType:mime[extname(file)]||'application/octet-stream',body});
    }catch{return route.fulfill({status:404,body:'Missing fixture'});}
  });
  return {external,collected};
}
async function ready(page,path='/',origin='https://maimai.party'){
  await page.goto(origin+path,{waitUntil:'load'});
  if(path.startsWith('/lab'))await expect(page.locator('#loaded-count')).toHaveText('6');
  else await expect(page.locator('#explore-search')).toBeVisible();
}
async function settings(page){await page.locator('#settings-toggle').click();await page.locator('#analytics-settings').click();}

for(const path of paths)for(const [suffix,endpoint] of [['/beacon.min.js',collector],['/beacon.min.js/vsynthetic','/cdn-cgi/rum']]){
  test('native Cloudflare works before and after Google refusal: '+path+' '+suffix,async({page,context})=>{
    const {external,collected}=await hosted(context,{inject:true,suffix,endpoint});
    await ready(page,path);await page.waitForFunction(()=>window.__cfStubCollected===true);
    expect(external).toEqual([cfOrigin+suffix]);expect(await context.cookies()).toEqual([]);
    expect(await page.evaluate(()=>!!window.dataLayer)).toBe(false);
    await page.locator('#analytics-notice [data-analytics-choice=denied]').click();
    await page.evaluate(()=>window.__cfSample());
    expect(collected).toHaveLength(2);
    expect(collected.every(row=>row.method==='POST'&&row.body==='synthetic-traffic-count')).toBe(true);
    expect(external).toEqual([cfOrigin+suffix]);expect(await context.cookies()).toEqual([]);
    expect(await page.evaluate(()=>!!window.dataLayer)).toBe(false);
    expect(await page.evaluate(()=>window['ga-disable-G-FP9V9NF63J'])).toBe(true);
    await page.reload();await page.waitForFunction(()=>window.__cfStubCollected===true);
    expect(collected).toHaveLength(3);expect(external).toEqual([cfOrigin+suffix,cfOrigin+suffix]);
    expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).choice,storageKey)).toBe('denied');
    expect(await context.cookies()).toEqual([]);
    await settings(page);await expect(page.locator('#analytics-title')).toHaveText('Google Analytics settings');
    await expect(page.locator('#analytics-dialog')).toContainText('does not control it');
  });
}

for(const origin of ['https://preview.invalid','http://127.0.0.1'])for(const path of paths){
  test('CSP alone does not install analytics: '+origin+path,async({page,context})=>{
    const {external,collected}=await hosted(context);
    await ready(page,path,origin);await page.goto('about:blank');
    expect(external).toEqual([]);expect(collected).toEqual([]);expect(await context.cookies()).toEqual([]);
  });
}

test('public lab redirect cannot execute an injected beacon before the destination',async({page,context})=>{
  const {external,collected}=await hosted(context,{inject:true,release:true});
  await page.goto('https://maimai.party/lab/?view=patterns&version=fixture-v5#synthetic-hash');
  await expect(page).toHaveURL('https://maimai.party/?view=patterns&version=fixture-v5#synthetic-hash');
  await page.waitForFunction(()=>window.__cfStubCollected===true);
  expect(external).toEqual([cfOrigin+'/beacon.min.js']);expect(collected).toHaveLength(1);
  expect(await context.cookies()).toEqual([]);
});

for(const path of paths)test('real Cloudflare payload audit stays independent and excludes private inputs: '+path,async({page,context})=>{
  test.skip(!process.env.CF_SDK_PATH,'Optional audit of a downloaded vendor script; all collection is intercepted.');
  const sdk=await readFile(process.env.CF_SDK_PATH,'utf8');
  const {external,collected}=await hosted(context,{inject:true,sdk});
  await ready(page,path+'?search=PRIVATE_SEARCH&email=PRIVATE_EMAIL#PRIVATE_HASH');
  await expect.poll(()=>collected.length).toBeGreaterThan(0);
  await page.locator('#analytics-notice [data-analytics-choice=denied]').click();
  if(path==='/'){
    const data=JSON.parse(await readFile(new URL('../../output/personal-fixture.json',import.meta.url),'utf8'));
    data.overlay.entries[0].attempts[0].attempt_id='PRIVATE_ATTEMPT';
    await page.locator('#site-import').setInputFiles({name:'PRIVATE_FILENAME.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
    await expect(page.locator('#site-clear')).toBeVisible();
    await page.locator('#explore-search').fill('PRIVATE_SEARCH');
  }else{
    await page.locator('#search').fill('PRIVATE_SEARCH');await page.locator('#search').fill('');
    await page.locator('#songs .chart-row').first().click();
    await page.locator('#patterns-tab').click();await page.locator('#compare-tab').click();
  }
  await settings(page);await page.locator('#analytics-dialog [data-analytics-choice=granted]').click();
  await expect.poll(()=>external.filter(url=>url.includes('googletagmanager')).length).toBe(1);
  await settings(page);await page.locator('#analytics-dialog [data-analytics-choice=denied]').click();
  const before=collected.length;
  // Exercise the vendor's visibility/exit handler while this document is alive;
  // headless about:blank navigation alone need not deliver visibilitychange.
  await page.evaluate(()=>{
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(()=>collected.length).toBeGreaterThan(before);
  await page.goto('about:blank');
  expect(await context.cookies()).toEqual([]);
  expect(external.filter(url=>url.startsWith(cfOrigin))).toHaveLength(1);
  expect(decodeURIComponent(JSON.stringify(collected))).not.toMatch(/PRIVATE_|Fictional|fixture-v|attempt_id|achievement|player_id/);
  expect(collected.every(row=>!row.headers.referer&&row.method==='POST')).toBe(true);
  // This audits today's downloaded SDK, never guarantees future vendor payloads.
});
