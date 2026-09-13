import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../output/browser-tests/',import.meta.url));
const host='https://maimai.party';
const beacon='https://static.cloudflareinsights.com/beacon.min.js';
const storageKey='maimai.party.analytics.v1';
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};

// Mimic hosting insertion, not Cloudflare's vendor implementation. All requests
// are intercepted: no real token, production beacon, or live visitor is created.
async function hosted(context,{src=beacon,collector=host+'/cdn-cgi/rum',blocked=false}={}){
  const external=[],collections=[];
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(request.url()===collector){
      collections.push({url:request.url(),body:request.postData(),method:request.method()});
      return route.fulfill({status:204,headers:{'access-control-allow-origin':'*'},body:''});
    }
    if(url.origin!==host){
      external.push(request.url());
      if(request.url()===src){
        if(blocked)return route.abort('blockedbyclient');
        return route.fulfill({contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},body:
          `fetch(${JSON.stringify(collector)},{method:'POST',headers:{'Content-Type':'text/plain'},body:'synthetic-csp-check'}).then(response=>{window.__cloudflareTestComplete=response.ok;});`});
      }
      return route.fulfill({status:204,body:''});
    }
    const path=resolve(root,'.'+decodeURIComponent(url.pathname)+(url.pathname.endsWith('/')?'index.html':''));
    if(!path.startsWith(root.replace(/[\\/]$/,'')+sep))return route.abort();
    try{
      let body=await readFile(path);
      if(extname(path)==='.html'){
        const html=body.toString('utf8');
        expect(html).not.toContain('data-cf-beacon');
        body=Buffer.from(html.replace('</body>',`<script type="module" src="${src}" data-cf-beacon='{"token":"synthetic-test-only"}'></script></body>`));
      }
      return route.fulfill({contentType:mime[extname(path)]||'application/octet-stream',body});
    }catch{return route.fulfill({status:404,body:'Missing fixture'});}
  });
  return {external,collections};
}

for(const path of ['/','/lab/']){
  for(const [label,src,collector] of [
    ['plain beacon and external collector',beacon,'https://cloudflareinsights.com/cdn-cgi/rum'],
    ['versioned beacon and same-origin collector',beacon+'/v-synthetic',host+'/cdn-cgi/rum'],
  ])test('hosting Cloudflare works independently of GA refusal: '+path+' '+label,async({page,context})=>{
    const observed=await hosted(context,{src,collector});
    await page.goto(host+path,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__cloudflareTestComplete===true);
    await expect(page.locator('#analytics-notice')).toBeVisible();
    expect(observed.external).toEqual([src]);
    expect(observed.collections).toEqual([{url:collector,body:'synthetic-csp-check',method:'POST'}]);
    expect(await page.evaluate(()=>!!window.dataLayer)).toBe(false);
    expect(await context.cookies()).toEqual([]);
    await page.locator('#analytics-notice [data-analytics-choice=denied]').click();
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__cloudflareTestComplete===true);
    await expect(page.locator('#analytics-notice')).toBeHidden();
    await expect(page.locator('#analytics-status')).toHaveText('Google Analytics is off.');
    expect(observed.external).toEqual([src,src]);
    expect(observed.collections).toHaveLength(2);
    expect(await page.evaluate(()=>!!window.dataLayer)).toBe(false);
    expect(await context.cookies()).toEqual([]);
    expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).choice,storageKey)).toBe('denied');
    await expect(page.locator('script[src*="static.cloudflareinsights.com"]')).toHaveCount(1);
  });

  test('Cloudflare failure does not break browsing or broaden script permissions: '+path,async({page,context})=>{
    const observed=await hosted(context,{blocked:true});
    await page.goto(host+path,{waitUntil:'domcontentloaded'});
    const search=page.locator(path==='/lab/'?'#search':'#explore-search');
    await expect(search).toBeVisible();
    await search.fill('Fictional');
    await page.locator('#analytics-notice [data-analytics-choice=denied]').click();
    await expect(page.locator('#analytics-status')).toHaveText('Google Analytics is off.');
    expect(observed.collections).toEqual([]);
    expect(await page.evaluate(()=>!!window.dataLayer)).toBe(false);
    const violation=await page.evaluate(()=>new Promise(resolve=>{
      document.addEventListener('securitypolicyviolation',event=>{
        if(event.blockedURI==='https://static.cloudflareinsights.com/unrelated.js')resolve(event.effectiveDirective);
      });
      const script=document.createElement('script');
      script.src='https://static.cloudflareinsights.com/unrelated.js';
      document.head.append(script);
    }));
    expect(violation).toMatch(/^script-src/);
    expect(observed.external).not.toContain('https://static.cloudflareinsights.com/unrelated.js');
  });
}
