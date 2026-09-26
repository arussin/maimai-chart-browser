import {test,expect} from './fixtures.js';
test.beforeEach(async({fixtureOrigins})=>{for(const origin of ["https://maimai.party"])fixtureOrigins.synthetic(origin);});
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
const root=resolve(process.env.MAIMAI_BROWSER_OUTPUT||'../../output/browser-tests');
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
test('retired Cloudflare browser beacon is blocked by the candidate CSP',async({page,context})=>{
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
