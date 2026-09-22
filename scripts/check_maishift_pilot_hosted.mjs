// Owner-run after a separately approved deployment. One approved profile read.
// No screenshots, traces, browser-state files, score dumps or scheduled retries.
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import '../src/maimai_intelligence/assets/player-maishift.js';
const URL='https://maimai.party/pilot/maishift/',API='/api/player-import/maishift';
const check=(value,code)=>{if(!value)throw Error(code);};
let browser;
try{
  check(process.env.MAISHIFT_CANARY_APPROVED==='true','explicit_approval_required');
  check(/^[a-f0-9]{64}$/.test(process.env.MAISHIFT_PILOT_BUILD||''),'approved_build_required');
  const selected=maimaiPlayerMaishift.location(process.env.MAISHIFT_CANARY_URL||'',process.env.MAISHIFT_CANARY_REGION);
  const dependencyRoot=resolve(process.env.MAIMAI_NODE_MODULES_ROOT||'');
  check(/^C:\\DevCache\\/i.test(dependencyRoot)&&/^C:\\DevCache\\/i.test(process.env.TEMP||''),'devcache_environment_required');
  const require=createRequire(resolve(dependencyRoot,'tests/browser/package.json'));
  const {chromium}=require('playwright');browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({acceptDownloads:true}),page=await context.newPage();let calls=0,unexpected=0;
  await context.addInitScript(()=>localStorage.setItem('maimai-language-v1','en'));
  await context.route('**/*',async route=>{
    const request=route.request(),target=new globalThis.URL(request.url());
    if(target.origin!=='https://maimai.party'||target.search||target.hash||!target.pathname.startsWith('/pilot/maishift/')&&target.pathname!==API){unexpected++;await route.abort();return;}
    if(target.pathname===API){
      const headers=await request.allHeaders();let body;try{body=request.postDataJSON();}catch{}
      if(++calls>1||request.method()!=='POST'||body?.handle!==selected.handle||body?.region!==selected.region||['cookie','authorization','referer'].some(k=>headers[k])){unexpected++;await route.abort();return;}
    }
    await route.continue();
  });
  const response=await page.goto(URL,{waitUntil:'domcontentloaded'});check(response?.ok(),'pilot_not_published');
  const policy=await response.allHeaders();
  check(policy['referrer-policy']==='no-referrer'&&policy['cache-control']?.includes('no-store')&&policy['x-robots-tag']?.includes('noindex')&&policy['content-security-policy']?.includes("connect-src 'self'"),'pilot_headers_missing');
  await page.locator('#baseline').waitFor();await page.locator('#profile').fill(selected.handle);await page.locator('#region').selectOption(selected.region);await page.locator('#consent').check();
  await page.locator('#baseline').click();await page.waitForFunction(()=>document.getElementById('status')?.textContent.includes('Read complete.'),null,{timeout:60000});
  const pending=page.waitForEvent('download');await page.locator('#download').click();const stream=await (await pending).createReadStream(),chunks=[];let size=0;
  for await(const chunk of stream){size+=chunk.length;check(size<16384,'invalid_summary');chunks.push(chunk);}
  const result=JSON.parse(Buffer.concat(chunks).toString()),baseline=result.baseline;
  check(result.schemaVersion==='maishift-pilot-report-1'&&result.build===process.env.MAISHIFT_PILOT_BUILD&&result.releaseReady===false&&result.region===selected.region,'invalid_summary');
  check(['catalog','played','imported','matched','unmatched','excluded','plays'].every(k=>Number.isSafeInteger(baseline?.[k])&&baseline[k]>=0&&baseline[k]<=20000),'invalid_counts');
  check(calls===1&&unexpected===0&&baseline.played>0&&baseline.matched===baseline.imported&&baseline.unmatched===0&&baseline.excluded===0&&baseline.plays===0,'baseline_checks_failed');
  await page.locator('#clear').click();
  console.log(JSON.stringify({schemaVersion:'maishift-hosted-smoke-1',build:result.build,region:selected.region,deployedBrowserRead:true,requests:calls,played:baseline.played,matched:baseline.matched,excluded:0,plays:0,changedUploadVerified:false,releaseReady:false}));
}catch{console.error('Hosted pilot check failed. No profile data was logged; deployment or baseline acceptance remains incomplete.');process.exitCode=2;}
finally{await browser?.close().catch(()=>{});}
