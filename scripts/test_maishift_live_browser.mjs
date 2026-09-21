// Manual approved-canary integration test. No profile/PB fixtures, screenshots,
// traces or browser storage are retained. Only aggregate pass/fail output.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {createService,PATH} from '../player-import-worker/index.mjs';
import '../src/maimai_intelligence/assets/player-data-core.js';
import '../src/maimai_intelligence/assets/player-maishift.js';

const root=path.resolve(process.env.MAISHIFT_PREVIEW_ROOT||'.');
const modules=process.env.MAIMAI_NODE_MODULES_ROOT;
const synthetic=process.env.MAISHIFT_SYNTHETIC==='true';
const check=(condition,code)=>{if(!condition)throw new Error(code);};
check(process.env.MAISHIFT_CANARY_APPROVED==='true'&&root.toLowerCase().startsWith('c:\\devcache\\')&&modules,'explicit_canary_and_devcache_required');
const selected=maimaiPlayerMaishift.location(process.env.MAISHIFT_CANARY_URL||'',process.env.MAISHIFT_CANARY_REGION);
check(!process.env.MAISHIFT_BROWSER||['Chrome','Edge','Firefox','WebKit narrow'].includes(process.env.MAISHIFT_BROWSER),'invalid_browser');
check(!synthetic||selected.handle==='fictional-player','fictional_handle_required');
const {chromium,firefox,webkit}=await import(pathToFileURL(path.join(modules,'node_modules/playwright/index.mjs')));
const manifest=JSON.parse(await readFile(path.join(root,'manifest.json'))),release=manifest.releases.find(r=>r.version===manifest.default);
const catalog=JSON.parse(await readFile(path.join(root,release.startup?.path||release.path))),mapping=catalog.maishift_mapping;
check(mapping?.schema_version==='maishift-mapping-1','missing_mapping');
let upstreamRequests=0;
const service=createService({fetcher:async(...args)=>{upstreamRequests++;return fetch(...args);}});
const syntheticRows=synthetic?Object.entries(mapping.charts).filter(([id])=>id.startsWith('maishift:'+selected.region+':')).map(([id,row])=>({id:id.split(':')[2],...row.expected_source,level:'',constant:null,achievement:987654,dxScore:null,maxDxScore:null,rate:null,lamp:'',sync:''})):[];
const response=synthetic?Response.json({schemaVersion:1,adapterVersion:1,provider:'maishift',identity:{handle:selected.handle,region:selected.region,displayName:'Fictional Player',createdAt:Date.UTC(2026,0,1),updatedAt:Date.UTC(2026,8,21)},coverage:{kind:'partial',totalCharts:syntheticRows.length,playedCharts:syntheticRows.length,importedCharts:syntheticRows.length,diagnosticCount:0},diagnostics:[],records:syntheticRows}):await service.fetch(new Request('https://maimai.party'+PATH,{method:'POST',headers:{Origin:'https://maimai.party','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1'},body:JSON.stringify({handle:selected.handle,region:selected.region,manual:true})}),{MAISHIFT_ENABLED:'true',CLIENT_LIMITER:{limit:async()=>({success:true})},PROFILE_LIMITER:{getByName:()=>({claim:async()=>({id:'approved-local-canary'}),finish:async()=>{}})}});
check(response.ok,'live_proxy_read_failed_'+response.status);
const payload=await response.json(),normalized=await maimaiPlayerMaishift.normalize(payload,selected),expected=[];
for(const record of Object.values(normalized.data.records)){
  const source=normalized.data.charts[record.chartID],row=mapping.charts[record.chartID],target=catalog.catalog.find(c=>c.chart_id===row?.chart_id);
  check(maimaiPlayerMaishift.matchChart(normalized.data.player,source,row,target),'live_source_identity_unmatched');
  expected.push({chartID:target.chart_id,sourceID:record.chartID,record,format:source.format,difficulty:source.difficulty});
}
check(expected.length>0&&expected.length===payload.coverage.playedCharts&&payload.coverage.diagnosticCount===0,'coverage_incomplete');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://127.0.0.1'),relative=decodeURIComponent(url.pathname).replace(/^\/+/,''),file=path.resolve(root,relative.endsWith('/')||!relative?relative+'index.html':relative);
    if(!file.startsWith(root+path.sep)){res.writeHead(404).end();return;}
    const raw=await readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(raw);
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port,results=[];let stage='start',diagnostics={};
try{
  for(const [name,engine,options,viewport]of [['Chrome',chromium,{channel:'chrome'},{width:1280,height:900}],['Edge',chromium,{channel:'msedge'},{width:1280,height:900}],['Firefox',firefox,{}, {width:1280,height:900}],['WebKit narrow',webkit,{}, {width:320,height:800}]]){
    if(process.env.MAISHIFT_BROWSER&&process.env.MAISHIFT_BROWSER!==name)continue;
    stage=name+':launch';const browser=await engine.launch({headless:true,...options});
    try{
      const context=await browser.newContext({viewport}),page=await context.newPage();page.setDefaultTimeout(90000);let requests=0,pageErrors=0,unexpectedExternal=0;
      page.on('pageerror',()=>pageErrors++);
      await context.addInitScript(()=>{localStorage.setItem('maimai-language-v1','en');sessionStorage.setItem('maimai-announcement:player-import-sources-v1','seen');});
      if(synthetic)await context.addInitScript(()=>{globalThis.testDigestCalls=0;const original=crypto.subtle.digest.bind(crypto.subtle);crypto.subtle.digest=(...args)=>{testDigestCalls++;return original(...args);};});
      await context.route('**/*',async route=>{
        const request=route.request(),url=new URL(request.url());
        if(url.origin!==origin){unexpectedExternal++;await route.abort();return;}
        if(url.pathname===PATH){
          requests++;const body=request.postDataJSON();check(body.handle===selected.handle&&body.region===selected.region,'unexpected_profile_request');
          await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)});return;
        }
        if(url.pathname.endsWith('/player-sources.js')){const asset=await route.fetch();await route.fulfill({response:asset,body:(await asset.text()).replace('maishift:false','maishift:true')});return;}
        await route.continue();
      });
      stage=name+':load';await page.goto(origin+'/');await page.waitForFunction(()=>!!globalThis.maimaiResearchCatalog&&!!globalThis.maimaiPersonal);await page.evaluate(()=>maimaiPersonal.ready);
      stage=name+':source-selection';
      await page.locator('#settings-toggle').click();await page.locator('#player-import').click();await page.locator('input[value=maishift]').check();
      await page.locator('#player-maishift-url').fill(selected.handle);await page.locator('.player-source-fields select').selectOption(selected.region);
      stage=name+':preview';const previewStarted=Date.now();await page.getByRole('button',{name:'Continue',exact:true}).click();
      try{await page.getByRole('button',{name:'Import & remember',exact:true}).waitFor({timeout:15000});}
      catch(error){diagnostics=await page.evaluate(synthetic=>({heading:document.getElementById('player-dialog-title')?.textContent,hashesStarted:globalThis.testDigestCalls,syntheticMessage:synthetic?document.querySelector('.player-dialog')?.textContent.slice(0,600):undefined}),synthetic);throw error;}
      const previewMs=Date.now()-previewStarted;
      check(!(await page.locator('.player-dialog').textContent()).includes('Unmatched PB charts'),'preview_unmatched');
      stage=name+':commit';await page.getByRole('button',{name:'Import & remember',exact:true}).click();await page.waitForFunction(()=>maimaiPersonal.enabled());
      const counts=await page.evaluate(async expected=>{
        const state=await maimaiPlayerStorage.read(),data=await maimaiPlayerData.decode(state.active.bytes),current=maimaiPlayerData.current(data).pbs;
        let matched=0,exact=0;
        for(const e of expected){const c=maimaiResearchCatalog.catalog.find(c=>c.chart_id===e.chartID),r=maimaiPersonal.record(c);if(r)matched++;if(maimaiPlayerData.canonical(r)===maimaiPlayerData.canonical(e.record))exact++;}
        return {matched,exact,portablePBs:current.size,plays:Object.keys(data.plays).length,snapshots:Object.keys(data.snapshots).length,autoRefresh:state.active.source.autoRefresh,revision:data.revision};
      },expected);
      check(counts.matched===expected.length&&counts.exact===expected.length&&counts.portablePBs===expected.length&&counts.plays===0&&counts.snapshots===1&&counts.autoRefresh,'committed_score_mismatch');
      stage=name+':reload';await page.reload();await page.waitForFunction(()=>!!globalThis.maimaiResearchCatalog&&!!globalThis.maimaiPersonal);await page.evaluate(()=>maimaiPersonal.ready);await page.locator('#songs .song-row').first().waitFor();
      const variants=[...new Map(expected.filter(e=>e.record.achievement!==null).map(e=>[e.format+':'+e.difficulty,e])).values()];
      for(const e of variants){
        stage=name+':render-'+e.format+'-'+e.difficulty;
        await page.evaluate(id=>{const url=new URL(location.href);url.searchParams.set('view','catalog');url.searchParams.set('chart',id);history.replaceState(null,'',url);dispatchEvent(new PopStateEvent('popstate'));},e.chartID);
        const row=page.locator('#songs .song-row[data-chart-id="'+e.chartID+'"]');
        await page.waitForFunction(()=>!!globalThis.maimaiResearchCatalog&&!!globalThis.maimaiPersonal);await page.evaluate(()=>maimaiPersonal.ready);
        diagnostics=await page.evaluate(id=>({enabled:maimaiPersonal.enabled(),catalog:maimaiResearchCatalog.catalog.length,rows:document.querySelectorAll('#songs .song-row').length,selectedRows:document.querySelectorAll('#songs .song-row[data-chart-id="'+id+'"]').length,scoreNodes:document.querySelectorAll('#songs .song-row[data-chart-id="'+id+'"] .player-achievement-value').length,matched:!!maimaiPersonal.record(maimaiResearchCatalog.catalog.find(c=>c.chart_id===id))}),e.chartID);
        await row.locator('.player-achievement-value:visible').first().waitFor();
        check((await row.locator('.player-achievement-value:visible').first().textContent())===(e.record.achievement/10000).toFixed(4)+'%','rendered_precision_mismatch');
        check((await row.locator('.player-history').textContent()).includes('No recorded plays for this chart.'),'fabricated_play_history');
      }
      stage=name+':restore';const restored=await page.evaluate(async()=>{const s=await maimaiPlayerStorage.read();return {revision:s.active.revision,fits:document.documentElement.scrollWidth<=innerWidth+1};});
      check(restored.revision===counts.revision&&restored.fits&&requests===1&&pageErrors===0&&unexpectedExternal===0,'restore_layout_or_request_mismatch');
      stage=name+':hide-forget';await page.locator('#settings-toggle').click();await page.locator('#player-toggle').click();
      check(await page.evaluate(()=>!maimaiPersonal.enabled()),'hidden_data_failure');
      await page.locator('#settings-toggle').click();await page.locator('#player-forget').click();
      check(await page.evaluate(async()=>(await maimaiPlayerStorage.read()).active===null),'forget_failure');
      results.push({browser:name,matched:counts.matched,renderedVariants:variants.length,previewMs,plays:0,rememberedRestore:true,forgotten:true});console.log(JSON.stringify({browser:name,passed:true,previewMs,synthetic}));
      await context.close();
    }finally{await browser.close();}
  }
  console.log(JSON.stringify({synthetic,region:selected.region,totalCharts:payload.coverage.totalCharts,playedCharts:expected.length,unmatched:0,excluded:0,upstreamRequests,results,releaseEnabled:false}));
}catch(error){console.error(JSON.stringify({stage,error:error.message?.match(/^[a-z_0-9]+$/)?.[0]||'browser_assertion_failed',type:error.name,diagnostics}));process.exitCode=2;}
finally{await new Promise(resolve=>server.close(resolve));}
