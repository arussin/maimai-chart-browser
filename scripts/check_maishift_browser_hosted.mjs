// Owner-run, explicit canary only. No profile dumps, screenshots, traces or saved browser state.
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import '../src/maimai_intelligence/assets/player-maishift.js';

const origin='https://maimai.party',entry='/pilot/maishift/browser/',api='/api/player-import/maishift';
const check=value=>{if(!value)throw Error('check_failed');};
let browser,phase='approval',calls=0,unexpected=0,lastRequest=0;
try{
  check(process.env.MAISHIFT_CANARY_APPROVED==='true');
  const manifestSha=process.env.MAISHIFT_BROWSER_MANIFEST_SHA256||'';
  check(/^[a-f0-9]{64}$/.test(manifestSha));
  const selected=maimaiPlayerMaishift.location(process.env.MAISHIFT_CANARY_URL||'',process.env.MAISHIFT_CANARY_REGION);
  const dependencyRoot=resolve(process.env.MAIMAI_NODE_MODULES_ROOT||'');
  check(/^C:\\DevCache\\/i.test(dependencyRoot)&&/^C:\\DevCache\\/i.test(process.env.TEMP||''));
  const require=createRequire(resolve(dependencyRoot,'tests/browser/package.json'));
  const {chromium,expect}=require('@playwright/test');
  browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext(),page=await context.newPage();
  await context.addInitScript(()=>localStorage.setItem('maimai-language-v1','en'));
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==origin||url.hash||!url.pathname.startsWith(entry)&&url.pathname!==api){unexpected++;await route.abort();return;}
    if(url.pathname===api){
      const headers=await request.allHeaders();let body;try{body=request.postDataJSON();}catch{}
      if(++calls>2||url.search||request.method()!=='POST'||body?.handle!==selected.handle||body?.region!==selected.region||body?.manual!==true||['cookie','authorization','referer'].some(k=>headers[k])){unexpected++;await route.abort();return;}
      lastRequest=Date.now();
    }
    await route.continue();
  });
  phase='published_assets';
  const manifestResponse=page.waitForResponse(response=>response.url()===origin+entry+'manifest.json');
  const response=await page.goto(origin+entry,{waitUntil:'domcontentloaded'});
  check(response?.ok());const headers=await response.allHeaders();
  check(headers['referrer-policy']==='no-referrer'&&headers['cache-control']?.includes('no-store')&&headers['x-robots-tag']?.includes('noindex'));
  const manifest=await manifestResponse;
  check(manifest.ok()&&createHash('sha256').update(await manifest.body()).digest('hex')===manifestSha);
  await expect(page.locator('#lab-status')).toBeHidden({timeout:60000});
  await page.evaluate(()=>maimaiPersonal.ready);
  phase='real_import';
  await page.locator('#player-import-header, #maishift-browser-pilot button').click();
  await page.locator('input[value=maishift]').check();
  await page.locator('#player-maishift-url').fill(selected.url);
  await page.locator('.player-dialog .player-actions button').first().click();
  await expect(page.getByRole('heading',{name:'Import this profile?',exact:true})).toBeVisible({timeout:60000});
  await expect(page.locator('.player-dialog .player-profile-link')).toHaveAttribute('href',selected.url);
  await page.locator('.player-dialog .player-remember input').check();
  await page.locator('.player-dialog .player-actions button').first().click();
  await expect.poll(()=>page.evaluate(()=>maimaiPersonal.enabled())).toBe(true);
  const summary=()=>page.evaluate(async()=>{
    const active=(await maimaiPlayerStorage.read()).active,d=await maimaiPlayerData.decode(active.bytes);
    const records=maimaiResearchCatalog.catalog.map(c=>maimaiPersonal.record(c)).filter(Boolean);
    return {revision:d.revision,records:records.length,grades:records.filter(r=>r.grade).length,plays:Object.keys(d.plays).length,snapshots:Object.keys(d.snapshots).length,lastImportedAt:active.lastImportedAt};
  });
  const before=await summary();check(calls===1&&before.records>0&&before.grades>0&&before.plays===0);
  await page.getByRole('button',{name:'My PBs',exact:true}).click();
  await expect(page.locator('.player-grade:not(.grade-unknown)').first()).toBeVisible();
  await expect(page.locator('.player-chart-rating').first()).toBeVisible();
  phase='remembered_restore';
  await page.reload();await page.evaluate(()=>maimaiPersonal.ready);await expect(page.locator('#lab-status')).toBeHidden({timeout:60000});
  check((await summary()).revision===before.revision&&calls===1);
  const other=await context.newPage();await other.goto(origin+entry);await other.evaluate(()=>maimaiPersonal.ready);
  await expect(other.locator('#lab-status')).toBeHidden({timeout:60000});
  await expect.poll(()=>other.evaluate(()=>maimaiPersonal.enabled())).toBe(true);
  check(calls===1);
  // A single deliberate refresh after the real service's repeat-click cooldown.
  await page.waitForTimeout(Math.max(0,31000-(Date.now()-Math.max(lastRequest,before.lastImportedAt))));
  phase='manual_refresh';
  await page.bringToFront();
  await expect.poll(()=>page.evaluate(()=>document.visibilityState)).toBe('visible');
  await page.locator('#settings-toggle').click();await page.locator('#player-refresh').click();
  await expect.poll(async()=>(await summary()).lastImportedAt,{timeout:60000}).toBeGreaterThan(before.lastImportedAt);
  const after=await summary();check(calls===2&&after.plays===0);
  if(after.revision===before.revision)check(after.snapshots===before.snapshots);
  phase='cross_tab_forget';
  await other.bringToFront();
  await other.locator('#settings-toggle').click();await other.locator('#player-forget').click();
  await other.getByRole('button',{name:'Okay!',exact:true}).click();
  await expect.poll(()=>page.evaluate(async()=>(await maimaiPlayerStorage.read()).active)).toBeNull();
  await page.reload();await page.evaluate(()=>maimaiPersonal.ready);
  check(!await page.evaluate(()=>maimaiPersonal.enabled()));
  await other.reload();await other.evaluate(()=>maimaiPersonal.ready);
  check(!await other.evaluate(()=>maimaiPersonal.enabled())&&calls===2&&unexpected===0);
  console.log(JSON.stringify({schemaVersion:'maishift-hosted-browser-smoke-1',manifestSha256:manifestSha,requests:calls,matched:before.records,grades:before.grades,ratingsVisible:true,plays:0,rememberedRestore:true,manualRefresh:true,unchangedRefresh:after.revision===before.revision,crossTabForget:true,unexpectedRequests:0,releaseReady:false}));
}catch{
  console.error(JSON.stringify({error:'hosted_browser_check_failed',phase,requests:calls,unexpectedRequests:unexpected,profileDataLogged:false}));process.exitCode=2;
}finally{await browser?.close().catch(()=>{});}
