import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
const root=resolve(process.env.MAIMAI_BROWSER_OUTPUT||'../../output/browser-tests');
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.ico':'image/x-icon'};
async function hosted(context,{gpc=false,dnt=false,disabled=false,fail=false}={}){
 const counts=[],external=[];
 await context.addInitScript(({gpc,dnt,disabled})=>{
  Object.defineProperty(navigator,'globalPrivacyControl',{value:gpc});Object.defineProperty(navigator,'doNotTrack',{value:dnt?'1':'0'});
  window.maimaiUsageEnabled=!disabled;
  localStorage.setItem('maimai.party.analytics.v1',JSON.stringify({choice:'denied',expires:Date.now()+86400000}));
 },{gpc,dnt,disabled});
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.hostname!=='maimai.party'){external.push(url.href);return route.fulfill({status:204,body:''});}
  if(url.pathname==='/__usage'){counts.push(JSON.parse(request.postData()));return fail?route.abort():route.fulfill({status:204,body:''});}
  const file=resolve(root,'lab','.'+decodeURIComponent(url.pathname)+(url.pathname.endsWith('/')?'index.html':''));
  if(!file.startsWith(root+sep))return route.abort();
  try{await route.fulfill({contentType:types[extname(file)]||'application/octet-stream',body:await readFile(file)});}
  catch{await route.fulfill({status:404,body:''});}
 });
 return {counts,external};
}
test('actual user hooks produce only finite page/actions after GA refusal',async({page,context})=>{
 const {counts,external}=await hosted(context);
 await page.goto('https://maimai.party/');await expect(page.locator('#catalog-count strong')).toHaveText('6');
 await page.locator('#search').fill('PRIVATE-SENTINEL');await page.locator('#search').fill('');
 await page.locator('#settings-toggle').click();await page.locator('#settings-toggle').click();
 await page.locator('#about-tab').click();await page.locator('#catalog-tab').click();
 await page.evaluate(()=>maimaiUsage.flush());
 const rows=counts.flatMap(b=>b.events);expect(rows.some(r=>r.event==='page_view')).toBe(true);expect(rows.some(r=>r.event==='settings_opened')).toBe(true);expect(rows.some(r=>r.event==='search_used')).toBe(true);
 expect(JSON.stringify(counts)).not.toContain('PRIVATE-SENTINEL');expect(external).toEqual([]);
 expect(await page.evaluate(()=>window.dataLayer)).toBeUndefined();
 for(const row of rows)expect(Object.keys(row).sort()).toEqual(['count','detail','event','failure','page']);
 const persisted=await page.evaluate(()=>[...Object.keys(localStorage),...Object.keys(sessionStorage)].filter(k=>/usage/i.test(k)));expect(persisted).toEqual([]);
});
for(const option of [{gpc:true},{dnt:true},{disabled:true}])test('collection suppression '+JSON.stringify(option),async({page,context})=>{
 const {counts}=await hosted(context,option);await page.goto('https://maimai.party/');await expect(page.locator('#catalog-count strong')).toHaveText('6');
 await page.locator('#settings-toggle').click();await page.evaluate(()=>maimaiUsage.flush());expect(counts).toEqual([]);
});
test('collector failure and restoration leave the browser usable without replay',async({page,context})=>{
 const {counts}=await hosted(context,{fail:true});await page.goto('https://maimai.party/');await expect(page.locator('#catalog-count strong')).toHaveText('6');
 await page.evaluate(()=>maimaiUsage.flush());const before=counts.length;await page.evaluate(()=>maimaiUsage.flush());expect(counts).toHaveLength(before);
 await page.evaluate(()=>maimaiUsage.suspend(()=>maimaiUsage.emit('settings_opened')));await page.evaluate(()=>maimaiUsage.flush());expect(counts).toHaveLength(before);
 await page.locator('#search').fill('Fictional study 0');await expect(page.locator('#catalog-count strong')).toHaveText('1');
});
