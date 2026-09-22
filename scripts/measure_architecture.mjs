/** Commit- and artifact-bound, same-corpus local performance comparison. */
import http from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import os from 'node:os';
import {startIsolationProxy} from '../tests/browser/isolation.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'};

export function distribution(values){
 const v=[...values].sort((a,b)=>a-b),middle=Math.floor(v.length/2);
 if(!v.length||v.some(n=>!Number.isFinite(n)))throw Error('Finite measurements are required');
 return {n:v.length,min:v[0],median:v.length%2?v[middle]:(v[middle-1]+v[middle])/2,p95:v[Math.ceil(v.length*.95)-1],max:v.at(-1),values:v};
}

export async function bindArtifact(config){
 if(!/^[a-f0-9]{40}$/.test(config.commit||''))throw Error('Exact product source commits are required');
 const bytes=await readFile(config.provenance),receipt=JSON.parse(bytes);
 if(receipt.schema_version!=='maimai-full-review-reproduction-2'||receipt.passed!==true||receipt.published!==false||receipt.source?.commit!==config.commit||receipt.candidate_commit!==config.commit)throw Error('Artifact receipt does not verify the requested source commit');
 const buildOptions=receipt.build_options||(receipt.verifier?.commit==='4d5584b43e2ef1f4cfd1398739aa80e8acb74136'?{player_maishift:false}:null);
 if(!buildOptions||typeof buildOptions.player_maishift!=='boolean'||Object.keys(buildOptions).length!==1)throw Error('Explicit build options are required');
 const build=receipt.builds?.find(b=>resolve(b.directory,'review','planned-assets')===config.root&&resolve(b.directory,'review','planned-manifest.json')===config.manifest);
 if(!build?.files||!receipt.source?.inventory_sha256||!receipt.verifier?.commit)throw Error('Artifact root is not bound by a complete reproduction receipt');
 const expected={};
 for(const [name,value] of Object.entries(build.files))if(name.startsWith('planned-assets/'))expected['/'+name.slice('planned-assets/'.length)]=value;
 expected['/manifest.json']=build.files['planned-manifest.json'];
 if(!expected['/manifest.json']||!expected['/index.html'])throw Error('Receipt omits required artifact files');
 const manifest=await readFile(config.manifest);
 verifyBytes('/manifest.json',manifest,expected);
 return {expected,build_options:buildOptions,receipt_sha256:sha(bytes),source_inventory_sha256:receipt.source.inventory_sha256,verifier_commit:receipt.verifier.commit};
}

export function validateExperiment(experiment,configs,catalogs){
 if(!['runtime','enrichment'].includes(experiment))throw Error('Experiment must be runtime or enrichment');
 const [left,right]=configs;
 if(JSON.stringify(left.binding.build_options)!==JSON.stringify(right.binding.build_options))throw Error('Comparisons require identical build options');
 if(experiment==='runtime'){
  if(catalogs[0].release.sha256!==catalogs[1].release.sha256)throw Error('Runtime comparison requires byte-identical accepted catalogs; measure enrichment separately');
 }else{
  if(left.commit!==right.commit)throw Error('Enrichment comparison requires the same product commit');
  const runtimeFiles=config=>Object.fromEntries(Object.entries(config.binding.expected).filter(([name])=>/\.(?:js|css|woff2?|ttf)$/.test(name)||/\/(?:browser-assets|player-import-config|support-config)\.json$/.test(name)).sort(([a],[b])=>a.localeCompare(b)));
  if(JSON.stringify(runtimeFiles(left))!==JSON.stringify(runtimeFiles(right)))throw Error('Enrichment comparison requires byte-identical runtime assets');
 }
}
export function verifyBytes(name,raw,expected){
 const item=expected[name];
 if(!item||item.sha256!==sha(raw)||item.bytes!==raw.length)throw Error('Served artifact differs from committed build receipt: '+name);
}

async function catalog(config){
 const raw=await readFile(config.manifest);verifyBytes('/manifest.json',raw,config.binding.expected);
 const manifest=JSON.parse(raw),release=manifest.releases.find(r=>r.version===manifest.default);
 const load=async reference=>{
  const name='/'+reference.path,path=resolve(config.root,reference.path);
  if(!path.startsWith(config.root+sep))throw Error('Catalog path escapes the verified artifact');
  const bytes=await readFile(path);verifyBytes(name,bytes,config.binding.expected);return bytes;
 };
 const bytes=release.parts?Buffer.concat(await Promise.all(release.parts.map(load))):await load(release);
 if(sha(bytes)!==release.sha256)throw Error('Catalog integrity mismatch');
 return {release,data:JSON.parse(bytes),manifest_sha256:sha(raw)};
}

function instrument(){
 localStorage.clear();localStorage.setItem('maimai-catalog-filters-collapsed','0');
 const state=window.__measurement={ready:null,longTasks:[],shifts:[]};
 for(const type of ['longtask','layout-shift'])new PerformanceObserver(list=>{for(const e of list.getEntries())if(type==='longtask')state.longTasks.push(e.duration);else if(!e.hadRecentInput)state.shifts.push(e.value);}).observe({type,buffered:true});
 const check=()=>{if(state.ready===null&&document.querySelector('#songs .song-row')&&document.querySelector('#catalog-count')?.textContent.trim()&&!document.querySelector('#lab-status')?.textContent.trim())state.ready=performance.now();};
 new MutationObserver(check).observe(document,{childList:true,subtree:true,characterData:true});
}
const frames=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const ready=page=>page.waitForFunction(()=>Number.isFinite(window.__measurement?.ready));
async function timing(page,operation){const start=await page.evaluate(()=>performance.now());await operation();await frames(page);return page.evaluate(start=>performance.now()-start,start);}
async function search(page,value){
 await page.evaluate(value=>{const el=document.querySelector('#search');el.value=value;el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));},value);
}

/** Observe application attempts without routing, so HTTP cache behavior stays native. */
export function observeApplicationNetwork(context,origin,attempts){
 const record=(kind,value)=>{
  const url=new URL(value);
  if(['data:','blob:','about:'].includes(url.protocol))return;
  const target=url.origin.replace(/^ws:/,'http:').replace(/^wss:/,'https:');
  if(target!==origin)attempts.push({kind,target});
 };
 context.on('request',request=>record(request.resourceType(),request.url()));
 const observePage=page=>page.on('websocket',socket=>record('websocket',socket.url()));
 context.on('page',observePage);for(const page of context.pages())observePage(page);
}

export async function main(argv=process.argv.slice(2)){
 const arg=(key,fallback)=>{const i=argv.indexOf('--'+key);return i<0?fallback:argv[i+1];};
 const runtime=resolve(arg('runtime')),output=resolve(arg('output')),iterations=Number(arg('iterations','7'));
 if(!Number.isInteger(iterations)||iterations<3||iterations>30)throw Error('Use 3 to 30 paired iterations');
 const configs=[];
 for(const id of ['baseline','candidate']){
  const root=resolve(arg(id)),config={id,root,manifest:resolve(arg(id+'-manifest',resolve(root,'manifest.json'))),commit:arg(id+'-commit'),provenance:resolve(arg(id+'-provenance'))};
  config.binding=await bindArtifact(config);configs.push(config);
 }
 const catalogs=await Promise.all(configs.map(catalog));

 const experiment=arg('experiment','runtime');validateExperiment(experiment,configs,catalogs);
 const query=catalogs[0].data.catalog.find(c=>c.title?.trim()&&c.artist?.trim()).title;
 let current=configs[0],origin,requests=[];const applicationOutbound=[];const content=new Map(),errors=[],rows=[];
 const server=http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,origin),decoded=decodeURIComponent(url.pathname),name=decoded.endsWith('/')?decoded+'index.html':decoded;
   if(url.origin!==origin)throw Error('Foreign origin');
   const path=name==='/manifest.json'?current.manifest:resolve(current.root,'.'+name);
   if(path!==current.manifest&&!path.startsWith(current.root+sep))throw Error('Escaped public root');
   const key=current.id+'|'+path;let file=content.get(key);
   if(!file){
    const raw=await readFile(path);verifyBytes(name,raw,current.binding.expected);
    const extension=extname(path),compressed=['.html','.json','.js','.css','.svg'].includes(extension);
    file={raw,extension,compressed,body:compressed?gzipSync(raw):raw,etag:'"'+sha(raw)+'"',name,config:current.id};content.set(key,file);
   }
   const immutable=/^\/(catalog-parts|catalog-index|catalog-index-parts|chart-details|integration|media)\//.test(name);
   const headers={'Content-Type':types[file.extension]||'application/octet-stream','Cache-Control':immutable?'public,max-age=31536000,immutable':'no-cache','ETag':file.etag,'X-Content-Type-Options':'nosniff'};
   if(req.headers['if-none-match']===file.etag){requests.push({path:name,status:304,bytes:0,sha256:file.etag.slice(1,-1)});res.writeHead(304,headers).end();return;}
   if(file.compressed)headers['Content-Encoding']='gzip';headers['Content-Length']=file.body.length;
   requests.push({path:name,status:200,bytes:file.body.length,sha256:file.etag.slice(1,-1)});res.writeHead(200,headers).end(file.body);
  }catch(error){if(req.url!='/favicon.ico'||error.code!=='ENOENT')errors.push({config:current.id,url:req.url,error:error.message});res.writeHead(404).end();}
 });

 const require=createRequire(resolve(runtime,'package.json'));
 const lockBytes=await readFile(resolve(runtime,'package-lock.json')),lock=JSON.parse(lockBytes);
 const packagePath=require.resolve('playwright/package.json');
 if(!packagePath.startsWith(resolve(runtime,'node_modules')+sep))throw Error('Playwright must come from the explicit prepared runtime');
 const installed=JSON.parse(await readFile(packagePath));
 if(installed.version!==lock.packages?.['node_modules/playwright']?.version)throw Error('Playwright runtime differs from its lock');
 const {chromium}=require('playwright');
 const runtimeBinding={node:process.version,executable:process.execPath,executable_sha256:sha(await readFile(process.execPath)),playwright_version:installed.version,playwright_lock_sha256:sha(lockBytes),chromium_sha256:sha(await readFile(chromium.executablePath()))};
 await mkdir(output,{recursive:false});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 const proxy=await startIsolationProxy({origins:[origin],contextRouting:true});
 let browser;
 async function one(page,temperature,session){
  requests=[];await session.send('Performance.enable');const before=(await session.send('Performance.getMetrics')).metrics;
  await page.goto(origin+'/',{waitUntil:'load'});await ready(page);await page.evaluate(()=>document.fonts.ready.then(()=>true));await frames(page);
  const startup=await page.evaluate(()=>{const sample=document.querySelector('#songs .song-row')||document.body,style=getComputedStyle(sample);const all=[...performance.getEntriesByType('navigation'),...performance.getEntriesByType('resource')];return {fonts:{status:document.fonts.status,sample_family:style.fontFamily,sample_size:style.fontSize,sample_weight:style.fontWeight,faces:[...document.fonts].map(font=>({family:font.family,style:font.style,weight:font.weight,status:font.status}))},ready_ms:window.__measurement.ready,transfer_bytes:all.reduce((n,e)=>n+e.transferSize,0),encoded_bytes:all.reduce((n,e)=>n+e.encodedBodySize,0),cached_resources:all.filter(e=>e.transferSize===0&&e.decodedBodySize>0).length,rows:document.querySelectorAll('#songs .song-row').length,long_task_ms:window.__measurement.longTasks.reduce((a,b)=>a+b,0),cls:window.__measurement.shifts.reduce((a,b)=>a+b,0)};});
  const metrics=(await session.send('Performance.getMetrics')).metrics;for(const name of ['ScriptDuration','TaskDuration'])startup[name+'_ms']=1000*((metrics.find(v=>v.name===name)?.value||0)-(before.find(v=>v.name===name)?.value||0));
  const startupRequests=requests.slice(),search_ms=await timing(page,()=>search(page,query));
  if(await page.locator('#songs .song-row').count()===0)throw Error('Search failed');
  await search(page,'');await frames(page);
  await page.locator('#songs .chart-row').first().click();const link=page.locator('#songs .song-row').first().locator('a[data-song-page]');await link.waitFor({state:'visible'});await link.focus();
  const beforeCatalog=requests.filter(r=>r.path.includes('catalog-index')).length;
  const song_ms=await timing(page,async()=>{await link.click();await page.locator('#seo-route-view').waitFor({state:'visible'});});
  const back_ms=await timing(page,async()=>{await page.goBack();await page.locator('#songs').waitFor({state:'visible'});await page.waitForFunction(()=>{const s=history.state?.maimaiBrowserState;return s&&(!s.focus||document.activeElement?.id===s.focus)&&(!s.scroll||Math.abs(scrollY-s.scroll[1])<2&&Math.abs(scrollX-s.scroll[0])<2);});});
  const return_catalog_refetches=requests.filter(r=>r.path.includes('catalog-index')).length-beforeCatalog;
  const comparison_ms=await timing(page,async()=>{
   // Include activation and any deferred module initialization in the user-visible cost.
   await page.locator('#compare-tab').click();
   const inputs=[page.getByRole('combobox',{name:'First chart',exact:true}),page.getByRole('combobox',{name:'Second chart',exact:true})];
   for(const [index,input] of inputs.entries()){await input.fill(query);await page.locator('#comparison-pickers').getByRole('option').nth(index).waitFor();await input.press('ArrowDown');if(index)await input.press('ArrowDown');await input.press('Enter');}
   await page.locator('#direct-comparison .metric-comparison').waitFor({state:'visible'});
  });
  return {temperature,startup,search_ms,song_ms,back_ms,comparison_ms,return_catalog_refetches,startup_requests:startupRequests,requests:requests.slice()};
 }
 try{
  browser=await chromium.launch({headless:true,executablePath:chromium.executablePath(),proxy:{server:proxy.server},args:['--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-sync','--no-first-run']});
  const contextOptions={viewport:{width:1280,height:900},locale:'en-US',reducedMotion:'reduce',serviceWorkers:'block'};
  // Prime the full journey's filesystem and compression work, never a retained browser cache.
  for(const config of configs){
   current=config;const context=await browser.newContext(contextOptions);observeApplicationNetwork(context,origin,applicationOutbound);await context.addInitScript(instrument);
   const page=await context.newPage();page.on('pageerror',e=>errors.push({config:config.id,phase:'prime',error:e.message}));
   await one(page,'prime',await context.newCDPSession(page));await context.close();
  }
  for(let iteration=0;iteration<iterations;iteration++)for(const config of iteration%2?[...configs].reverse():configs){
   current=config;const context=await browser.newContext(contextOptions);observeApplicationNetwork(context,origin,applicationOutbound);await context.addInitScript(instrument);
   for(const temperature of ['cold','warm']){
    const page=await context.newPage(),session=await context.newCDPSession(page);page.on('pageerror',e=>errors.push({config:config.id,error:e.message}));
    const row={iteration:iteration+1,config:config.id,...await one(page,temperature,session)};rows.push(row);
    process.stdout.write(JSON.stringify({iteration:row.iteration,config:row.config,temperature,ready_ms:row.startup.ready_ms,transfer_bytes:row.startup.transfer_bytes})+'\n');await page.close();
   }
   await context.close();
  }
  const summaries=[];
  for(const config of configs)for(const temperature of ['cold','warm']){
   const selected=rows.filter(r=>r.config===config.id&&r.temperature===temperature),entry={config:config.id,temperature};
   for(const key of ['ready_ms','transfer_bytes','encoded_bytes','cached_resources','ScriptDuration_ms','TaskDuration_ms','long_task_ms','cls'])entry[key]=distribution(selected.map(r=>r.startup[key]));
   for(const key of ['search_ms','song_ms','back_ms','comparison_ms'])entry[key]=distribution(selected.map(r=>r[key]));summaries.push(entry);
  }
  const browserVersion=browser.version();await browser.close();browser=null;await proxy.close();
  const receipt={schema:'architecture-performance-3',experiment,passed:errors.length===0&&applicationOutbound.length===0,created_at:new Date().toISOString(),harness_sha256:sha(await readFile(new URL(import.meta.url))),configs:configs.map(({binding,...config})=>({...config,binding:{receipt_sha256:binding.receipt_sha256,source_inventory_sha256:binding.source_inventory_sha256,verifier_commit:binding.verifier_commit,build_options:binding.build_options}})),verified_served_files:[...content.values()].map(f=>({config:f.config,path:f.name,bytes:f.raw.length,sha256:sha(f.raw)})),catalogs:catalogs.map(c=>({sha256:c.release.sha256,manifest_sha256:c.manifest_sha256,charts:c.data.catalog.length})),query,iterations,browser:browserVersion,runtime:runtimeBinding,platform:{os:os.platform(),release:os.release(),cpu:os.cpus()[0]?.model,threads:os.cpus().length},method:{routing:false,outbound:'Exact loopback proxy only; all other origins denied. Observation-only request/WebSocket audit fails application attempts; unattributed browser transports are retained separately',cache:'Production-like immutable data; other assets revalidated. A new page in the same context gives the immediate warm repeat; a fresh context gives cold readiness. Full measured journey filesystem/gzip primed in discarded browser contexts. No artificial network or CPU throttle.',readiness:'First populated catalog DOM observed (ready_ms is not a paint metric); action completion includes two animation frames. Search dispatches the synchronous input event. Comparison includes tab activation and deferred initialization.',usage:'Collector remains suppressed by the unchanged nonproduction origin predicate.',execution:'CDP TaskDuration includes renderer task work through two animation frames after catalog and font readiness. ScriptDuration is retained diagnostically, not compared as total JS execution because async-module work is excluded by this engine metric',limitations:'Explicit full Chromium executable on this Windows/font platform only. Web font bytes are verified served assets; operating-system fallback font files are not individually hashed; local-server latency, not internet Core Web Vitals. Concurrent host load is uncontrolled; paired order alternates.'},rows,summaries,errors,applicationOutbound,blockedTransports:proxy.blockedTransports};
  await writeFile(resolve(output,'measurements.json'),JSON.stringify(receipt,null,2)+'\n');
  if(!receipt.passed)throw Error('Invalid measurement: resource, application or outbound errors');
 }finally{
  if(browser)await browser.close();await proxy.close();server.closeAllConnections();await new Promise(r=>server.close(r));
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
