import {test,expect} from './fixtures.js';
test.beforeEach(async({fixtureOrigins})=>{for(const origin of ["https://maimai.party"])fixtureOrigins.synthetic(origin);});
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
const root=resolve(process.env.MAIMAI_BROWSER_OUTPUT||'../../output/browser-tests');
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
test('default local and staging policy blocks the Cloudflare browser beacon',async({page,context})=>{
 const external=[];
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname!=='maimai.party'){external.push(url.href);return route.fulfill({contentType:'application/javascript',body:'window.retiredBeaconExecuted=true;'});}
  const file=resolve(root,'lab','.'+url.pathname+(url.pathname.endsWith('/')?'index.html':''));
  if(!file.startsWith(root+sep))return route.abort();
  try{let body=await readFile(file);if(extname(file)==='.html')body=Buffer.from(body.toString().replace('</body>','<script src="https://static.cloudflareinsights.com/beacon.min.js"></script></body>'));await route.fulfill({contentType:types[extname(file)]||'application/octet-stream',body});}
  catch{await route.fulfill({status:404,body:''});}
 });
 await page.goto('https://maimai.party/');await expect(page.locator('#catalog-count strong')).toHaveText('6');
 expect(await page.evaluate(()=>window.retiredBeaconExecuted)).toBeUndefined();expect(external).toEqual([]);
 await page.locator('#settings-toggle').click();await page.locator('#analytics-settings').click();
 await expect(page.locator('#analytics-dialog')).toContainText('Separate daily feature counts');
});

test('production preservation permits one native beacon while Google remains opt-in',async({page,context,fixtureOrigins})=>{
 for(const origin of ['https://static.cloudflareinsights.com','https://cloudflareinsights.com'])fixtureOrigins.synthetic(origin);
 const calls=[];
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname==='static.cloudflareinsights.com'){
   calls.push('beacon');
   return route.fulfill({contentType:'application/javascript',body:`window.nativeBeaconLoaded=(window.nativeBeaconLoaded||0)+1;window.emitNativeBeacon=()=>fetch('https://cloudflareinsights.com/cdn-cgi/rum',{method:'POST',body:'fictional-rum'});window.emitNativeBeacon();`});
  }
  if(url.hostname==='cloudflareinsights.com'){
   calls.push('rum');return route.fulfill({status:204,headers:{'access-control-allow-origin':'https://maimai.party'},body:''});
  }
  if(url.hostname!=='maimai.party'){calls.push(url.hostname);return route.abort();}
  if(url.pathname==='/__usage')return route.fulfill({status:204,body:''});
  const file=resolve(root,'public-analytics','.'+url.pathname+(url.pathname.endsWith('/')?'index.html':''));
  if(!file.startsWith(root+sep))return route.abort();
  try{let body=await readFile(file);if(extname(file)==='.html')body=Buffer.from(body.toString().replace('</body>','<script src="https://static.cloudflareinsights.com/beacon.min.js"></script></body>'));await route.fulfill({contentType:types[extname(file)]||'application/octet-stream',body});}
  catch{await route.fulfill({status:404,body:''});}
 });
 await page.goto('https://maimai.party/');await expect(page.locator('#catalog-count strong')).toHaveText('6');
 await expect.poll(()=>calls.filter(x=>x==='rum').length).toBe(1);
 expect(await page.evaluate(()=>window.nativeBeaconLoaded)).toBe(1);
 await page.getByRole('button',{name:'No thanks',exact:true}).click();
 await page.evaluate(()=>window.emitNativeBeacon());
 await expect.poll(()=>calls.filter(x=>x==='rum').length).toBe(2);
 expect(calls.filter(x=>!['beacon','rum'].includes(x))).toEqual([]);
 expect((await context.cookies()).some(c=>c.name.startsWith('_ga'))).toBe(false);
 await page.locator('#settings-toggle').click();await page.locator('#analytics-settings').click();
 await expect(page.locator('#analytics-dialog')).toContainText('Separate daily feature counts');
 await page.locator('#analytics-close').click();
 await page.locator('#about-tab').click();
 const disclosures={"en": "Cloudflare Web Analytics also measures traffic and page performance on the public site, separately from Google Analytics and the daily feature counts. The Google choice and the daily-count privacy controls do not control this vendor-managed beacon.", "ja": "公開サイトでは、Cloudflare Web Analyticsもトラフィックとページのパフォーマンスを測定します。これはGoogle Analyticsや日次の機能利用集計とは別の仕組みです。Googleの設定や日次集計のプライバシー設定は、Cloudflareが管理するこのビーコンには適用されません。", "ko": "공개 사이트에서는 Cloudflare Web Analytics도 트래픽과 페이지 성능을 측정합니다. 이는 Google Analytics 및 일별 기능 사용 집계와 별개입니다. Google 선택 설정과 일별 집계의 개인정보 보호 설정은 Cloudflare가 관리하는 이 비콘을 제어하지 않습니다.", "zh-Hans": "Cloudflare Web Analytics也会衡量公开网站的流量和页面性能，与Google Analytics及每日功能使用计数相互独立。Google选项和每日计数的隐私控制不会控制这个由Cloudflare管理的信标。"};
 for(const [locale,description]of Object.entries(disclosures)){
  await page.locator('.site-header [data-language="'+locale+'"]').click();
  await page.locator('#privacy').evaluate(node=>{node.open=true;});
  const paragraph=page.locator('#privacy p').filter({hasText:'Cloudflare Web Analytics'});
  await expect(paragraph).toHaveText(description);
  await expect(paragraph).toBeVisible();
  expect(await paragraph.evaluate(node=>node.scrollWidth<=node.clientWidth+1&&node.scrollHeight<=node.clientHeight+1)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 }

});
