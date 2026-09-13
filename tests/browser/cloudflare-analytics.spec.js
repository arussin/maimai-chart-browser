import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../output/browser-tests/',import.meta.url));
const cfOrigin='https://static.cloudflareinsights.com';
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};

for(const path of ['/','/lab/'])for(const suffix of ['/beacon.min.js','/beacon.min.js/vsynthetic']){
  test('native Cloudflare CSP and Google refusal: '+path+' '+suffix,async({page,context})=>{
    const external=[],collected=[];
    // Intercept EVERY request: neither a provider nor the live site receives test data.
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.origin===cfOrigin){
        external.push(url.href);
        return route.fulfill({contentType:'application/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:
          "window.__cfStubLoaded=true;fetch('/cdn-cgi/rum',{method:'POST',body:'synthetic-traffic-count'}).then(r=>{window.__cfStubCollected=r.ok;});"});
      }
      if(url.origin!=='https://maimai.party'){
        external.push(url.href);return route.fulfill({status:204,body:''});
      }
      if(url.pathname==='/cdn-cgi/rum'){
        collected.push({method:request.method(),body:request.postData()});
        return route.fulfill({status:204,body:''});
      }
      const file=resolve(root,'.'+decodeURIComponent(url.pathname)+(url.pathname.endsWith('/')?'index.html':''));
      if(!file.startsWith(root.replace(/[\\/]$/,'')+sep))return route.abort();
      try{return await route.fulfill({contentType:mime[extname(file)]||'application/octet-stream',body:await readFile(file)});}
      catch{return route.fulfill({status:404,body:'Missing fixture'});}
    });
    await page.goto('https://maimai.party'+path,{waitUntil:'domcontentloaded'});
    if(path==='/lab/')await expect(page.locator('#loaded-count')).toHaveText('6');
    else await expect(page.locator('#explore-search')).toBeVisible();
    await page.locator('#analytics-notice [data-analytics-choice=denied]').click();
    expect(external).toEqual([]);
    expect(await context.cookies()).toEqual([]);
    // Model the host-injected module. Actual vendor payload auditing is a release check.
    await page.evaluate(src=>{
      const script=document.createElement('script');script.type='module';script.src=src;
      document.body.append(script);
    },cfOrigin+suffix);
    await page.waitForFunction(()=>window.__cfStubCollected===true);
    expect(external).toEqual([cfOrigin+suffix]);
    expect(collected).toEqual([{method:'POST',body:'synthetic-traffic-count'}]);
    expect(await page.evaluate(()=>!!window.dataLayer)).toBe(false);
    expect(await page.evaluate(()=>window['ga-disable-G-FP9V9NF63J'])).toBe(true);
    expect(await context.cookies()).toEqual([]);
    expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('maimai.party.analytics.v1')).choice)).toBe('denied');
    await page.locator('#settings-toggle').click();await page.locator('#analytics-settings').click();
    await expect(page.locator('#analytics-title')).toHaveText('Google Analytics settings');
    await expect(page.locator('#analytics-dialog')).toContainText('does not control it');
  });
}
