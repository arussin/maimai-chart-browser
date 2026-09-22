/** Local comparative benchmark. Source assets are never edited; external traffic is denied. */
import http from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {createRequire} from 'node:module';
import os from 'node:os';
const argv=process.argv.slice(2),arg=(name,fallback)=>{const i=argv.indexOf('--'+name);return i<0?fallback:argv[i+1];};
const baseline=resolve(arg('baseline')),candidate=resolve(arg('candidate')),runtime=resolve(arg('runtime')),output=resolve(arg('output'));
const candidateRegistry=arg('candidate-registry')?resolve(arg('candidate-registry')):null;
const deepOnly=argv.includes('--deep-only'),rootsOnly=argv.includes('--roots-only'),actualOnly=argv.includes('--actual-only');
const actualBaseline=arg('actual-baseline')?resolve(arg('actual-baseline')):null;
const actualCandidate=arg('actual-candidate')?resolve(arg('actual-candidate')):null;
const actualManifest=arg('actual-manifest')?resolve(arg('actual-manifest')):null;
if([actualBaseline,actualCandidate,actualManifest].some(Boolean)&&![actualBaseline,actualCandidate,actualManifest].every(Boolean))throw Error('Supply all three actual corpus paths together');
const iterations=Number(arg('iterations','5'));
if(!Number.isInteger(iterations)||iterations<1||iterations>10)throw Error('iterations must be 1 to 10');
const require=createRequire(resolve(runtime,'package.json')),{chromium}=require('playwright');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'};
const rows=[],blocked=[],errors=[],adaptations=[];let current,origin,activeRequests;
const cache=new Map();
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,origin||'http://127.0.0.1');
  if(url.origin!==origin){blocked.push({host:url.hostname,path:url.pathname});res.writeHead(204);res.end();return;}
  if(url.pathname==='/__usage'){
   let body='';for await(const chunk of req){body+=chunk;if(body.length>4096)throw Error('Oversized fixture usage');}
   const parsed=JSON.parse(body);if(parsed.version!==1||!Array.isArray(parsed.events))throw Error('Usage adaptation failed');
   activeRequests.push({path:url.pathname,status:204,bodyBytes:Buffer.byteLength(body),usage:true,events:parsed.events});res.writeHead(204,{'Cache-Control':'no-store'});res.end();return;
  }
  const decoded=decodeURIComponent(url.pathname),name=decoded.endsWith('/')?decoded+'index.html':decoded;
  let fileRoot=current.root;
  if(current.dataRoot&&/^\/(?:catalogs|catalog-index|catalog-parts|chart-details|integration|media)\//.test(name))fileRoot=current.dataRoot;
  else if(current.runtimeRoot&&/^\/[^/]+\.(?:html|js|css|svg|png|ico)$/.test(name))fileRoot=current.runtimeRoot;
  const virtualManifest=name==='/manifest.json'&&current.manifestPath;
  const path=virtualManifest?current.manifestPath:resolve(fileRoot,'.'+name);if(!virtualManifest&&!path.startsWith(fileRoot+sep))throw Error('Escaped fixture root');
  const key=current.config+'|'+path;
  let item=cache.get(key);
  if(!item){
   let bytes=await readFile(path),extension=extname(path);const sourceSha=sha(bytes);
   if(current.config==='seo-only'&&extension==='.html')bytes=Buffer.from(bytes.toString().replace(/<script\b[^>]*\bsrc=["'][^"']*\busage\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>/g,''));
   if(current.config==='seo-usage'&&path.endsWith(sep+'usage.js')){
    const source=bytes.toString(),needle='location.protocol==="https:"&&location.hostname==="maimai.party"';
    if(source.split(needle).length!==2)throw Error('Exact eligibility-only benchmark adaptation did not match once');
    bytes=Buffer.from(source.replace(needle,'location.origin==='+JSON.stringify(origin)));
    adaptations.push({source:path,source_sha256:sha(source),served_sha256:sha(bytes),change:'Only exact production origin predicate changed to this localhost origin'});
   }
   const compress=['.html','.js','.json','.css','.svg'].includes(extension),encoded=compress?gzipSync(bytes):bytes;
   item={bytes,encoded,compress,extension,sourceSha,etag:'"'+sha(bytes)+'"'};cache.set(key,item);
  }
  const headers={'Content-Type':types[item.extension]||'application/octet-stream','ETag':item.etag,'Cache-Control':item.extension==='.html'||name.endsWith('/manifest.json')?'no-cache':'public, max-age=3600','X-Content-Type-Options':'nosniff'};
  if(req.headers['if-none-match']===item.etag){activeRequests.push({path:url.pathname,status:304,bodyBytes:0,source_sha256:item.sourceSha,served_sha256:item.etag.slice(1,-1)});res.writeHead(304,headers);res.end();return;}
  if(item.compress)headers['Content-Encoding']='gzip';headers['Content-Length']=item.encoded.length;
  activeRequests.push({path:url.pathname,status:200,bodyBytes:item.encoded.length,rawBytes:item.bytes.length,source_sha256:item.sourceSha,served_sha256:item.etag.slice(1,-1)});res.writeHead(200,headers);res.end(item.encoded);
 }catch(error){errors.push({path:req.url,message:String(error.message)});res.writeHead(404,{'Cache-Control':'no-store'});res.end('Fixture resource unavailable');}
});
// Chromium's proxy sends all non-loopback HTTP here; CONNECT is denied without opening sockets.
server.on('connect',(req,socket)=>{blocked.push({host:req.url,connect:true});socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
await mkdir(output,{recursive:true});
const datasets=[{id:'authored-6',folder:'progressive'},{id:'registry-26',folder:'registry'},{id:'capacity-7000',folder:'progressive-capacity'}];
if(actualBaseline)datasets.push({id:'public-retained-7251',actual:true},{id:'public-enriched',actual:true,enriched:true,configs:['seo-usage']});
if(actualOnly){if(!actualBaseline)throw Error('actual-only requires actual corpus paths');datasets.splice(0,3);}
const datasetRoot=(config,dataset)=>dataset.actual?(config==='baseline'?actualBaseline:actualCandidate):config!=='baseline'&&dataset.id==='registry-26'&&candidateRegistry?candidateRegistry:resolve(config==='baseline'?baseline:candidate,dataset.folder);
const settings=(config,dataset)=>({config,root:datasetRoot(config,dataset),...(dataset.actual&&config!=='baseline'?{runtimeRoot:resolve(candidate,'registry'),dataRoot:dataset.enriched?null:actualBaseline,manifestPath:dataset.enriched?actualManifest:resolve(actualBaseline,'manifest.json')}:{})});
const fixtureProof=[];
async function catalog(root,manifestPath=resolve(root,'manifest.json')){const manifest=JSON.parse(await readFile(manifestPath,'utf8')); const release=manifest.releases.find(r=>r.version===manifest.default);let bytes;try{bytes=await readFile(resolve(root,release.path));}catch{bytes=Buffer.concat(await Promise.all(release.parts.map(p=>readFile(resolve(root,p.path)))));}if(sha(bytes)!==release.sha256)throw Error('Catalog integrity mismatch');return {release,data:JSON.parse(bytes)};}
for(const dataset of datasets){
 const b=await catalog(datasetRoot('baseline',dataset));
 const candidateSettings=settings('seo-usage',dataset);
 const c=dataset.actual&&!dataset.enriched?b:await catalog(candidateSettings.root,candidateSettings.manifestPath);
 const identity=value=>JSON.stringify(value.catalog.map(r=>[...(dataset.id==='registry-26'&&!candidateRegistry?[]:[r.chart_id,r.song_id]),r.title,r.artist,r.format,r.difficulty,r.level,r.demand]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
 if(!dataset.enriched&&identity(b.data)!==identity(c.data))throw Error('Baseline and candidate chart identities differ: '+dataset.id);
 fixtureProof.push({dataset:dataset.id,charts:c.data.catalog.length,comparison:dataset.enriched?'Separate enriched candidate, not a same-data comparison':'Same-data comparison',identity_sha256:sha(identity(c.data)),identity_comparison:dataset.id==='registry-26'&&!candidateRegistry?'Equivalent title/artist/slot/level/demand; independently generated random fixture UUIDs differ':'Exact identities/title/artist/slot/level/demand',baseline_catalog_sha256:b.release.sha256,candidate_catalog_sha256:c.release.sha256});
 dataset.query=dataset.id==='capacity-7000'?'Capacity study 0000':b.data.catalog.find(r=>r.title?.trim()).title;
}
const browser=await chromium.launch({headless:true,proxy:{server:origin},args:['--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-sync','--metrics-recording-only','--no-first-run']});
function instrument(){
 const state=window.__bench={ready:null,staticReady:null,longTasks:[],shifts:[],actions:[]};
 localStorage.setItem('maimai-catalog-filters-collapsed','0');
 for(const type of ['longtask','layout-shift'])try{new PerformanceObserver(list=>{for(const entry of list.getEntries())if(type==='longtask')state.longTasks.push({start:entry.startTime,duration:entry.duration});else state.shifts.push({start:entry.startTime,value:entry.value,recent:entry.hadRecentInput});}).observe({type,buffered:true});}catch{}
 const check=()=>{if(state.staticReady===null&&document.querySelector('main[data-seo-page]'))state.staticReady=performance.now();if(state.ready===null&&window.maimaiResearchCatalog&&document.querySelector('#songs .song-row')&&!document.getElementById('lab-status')?.textContent.trim())state.ready=performance.now();};
 new MutationObserver(check).observe(document,{childList:true,subtree:true,characterData:true});
}
async function settle(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function snapshot(page){return page.evaluate(()=>{
 const navigation=performance.getEntriesByType('navigation')[0],resources=performance.getEntriesByType('resource');
 return {ready_ms:window.__bench.ready,static_ready_ms:window.__bench.staticReady,dom_content_ms:navigation.domContentLoadedEventEnd,load_ms:navigation.loadEventEnd,
  transfer_bytes:[navigation,...resources].reduce((n,r)=>n+r.transferSize,0),encoded_body_bytes:[navigation,...resources].reduce((n,r)=>n+r.encodedBodySize,0),decoded_body_bytes:[navigation,...resources].reduce((n,r)=>n+r.decodedBodySize,0),resource_entries:resources.length,
  cached_resources:resources.filter(r=>r.transferSize===0&&r.decodedBodySize>0).length,
  long_tasks:window.__bench.longTasks.slice(),cls:window.__bench.shifts.filter(r=>!r.recent).reduce((n,r)=>n+r.value,0),all_layout_shifts:window.__bench.shifts.reduce((n,r)=>n+r.value,0),
  details_requested:resources.filter(r=>/chart-details|shared-details/.test(r.name)).map(r=>new URL(r.name).pathname),
  catalogs_requested:resources.filter(r=>/catalogs\/|catalog-parts\//.test(r.name)).map(r=>new URL(r.name).pathname),
  rendered_rows:document.querySelectorAll('#songs .song-row').length};});}
async function action(page,name,operation,value){
 const measurement=await page.evaluate(async({operation,value})=>{
  const start=performance.now();
  if(operation==='search'){const el=document.getElementById('search');el.value=value;el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));}
  else document.querySelector(operation)?.click();
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return performance.now()-start;
 },{operation,value});return {name,ms:measurement};
}
async function oneRoot(page,dataset,temperature){
 activeRequests=[];await page.goto(origin+'/',{waitUntil:'load'});await page.waitForFunction(()=>window.__bench?.ready!==null,{timeout:30000});await settle(page);await page.waitForTimeout(150);
 const startup=await snapshot(page),startupRequests=activeRequests.slice();
 if(startup.rendered_rows===0)throw Error('No browser results');
 if(current.config==='seo-only'&&startupRequests.some(r=>/\busage\.js$/.test(r.path)))throw Error('SEO-only unexpectedly loaded usage module');
 const interactions=[];interactions.push(await action(page,'search','search',dataset.query));interactions.push(await action(page,'clear-search','search',''));interactions.push(await action(page,'sort','[data-sort-key="peak"]'));
 interactions.push(await action(page,'expand-chart','#songs .chart-row'));
 await page.waitForTimeout(100);await settle(page);
 const expanded=await snapshot(page);
 const compare=page.locator('#songs .song-row').first().getByRole('button',{name:'Compare this chart',exact:true});
 if(await compare.count()){
  const started=await page.evaluate(()=>performance.now());await compare.click();await settle(page);interactions.push({name:'choose-comparison',ms:await page.evaluate(start=>performance.now()-start,started)});
  if(await page.locator('#find-similar').isEnabled()){interactions.push(await action(page,'similar','#find-similar'));await page.waitForFunction(()=>document.querySelectorAll('#similar-results .similar-chart').length>0);}
 }
 await page.evaluate(async()=>{await window.maimaiUsage?.flush();});
 const usage=activeRequests.filter(r=>r.usage);
 if(current.config==='seo-usage'&&usage.length===0)throw Error('Usage eligibility adaptation did not emit a local batch');
 if(current.config!=='seo-usage'&&usage.length)throw Error('Usage unexpectedly active');
 return {temperature,startup,startup_requests:startupRequests,interactions,after_expansion:expanded,usage_batches:usage,server_requests:activeRequests.slice()};
}
async function arrival(page,kind,slug){
 const path='/en/'+(kind==='song'?'songs':'versions')+'/'+encodeURIComponent(slug)+'/';activeRequests=[];
 await page.goto(origin+path,{waitUntil:'load'});
 await page.locator('main[data-seo-page="'+kind+'"]').waitFor({state:'attached'});
 if(kind==='version')await page.waitForFunction(()=>!!window.maimaiBrowserState&&document.querySelector('[data-version-browser]')?.hidden===false);
 await settle(page);await page.waitForTimeout(150);const result={path,...await snapshot(page),requests:activeRequests.slice()};
 if(kind==='song'&&(result.catalogs_requested.length||result.details_requested.length||result.requests.some(r=>r.path.includes('catalog-index'))))throw Error('Lightweight song arrival loaded catalog');
 return result;
}
async function returnNavigation(page){
 const result={};activeRequests=[];await page.goto(origin+'/',{waitUntil:'load'});await page.waitForFunction(()=>window.__bench.ready!==null);
 await page.locator('#songs .chart-row').first().click();const link=page.locator('#songs .song-row').first().locator('a[data-song-page]');await link.waitFor({state:'visible'});
 const before=activeRequests.filter(r=>r.path.includes('catalog-index')).length;
 const start=await page.evaluate(()=>performance.now());await link.click();await page.locator('#seo-route-view').waitFor({state:'visible'});await settle(page);result.open_song_ms=await page.evaluate(t=>performance.now()-t,start);
 const back=await page.evaluate(()=>performance.now());await page.goBack();await page.locator('#songs').waitFor({state:'visible'});await page.waitForFunction(()=>{const state=history.state?.maimaiBrowserState;return !!state&&(!state.focus||document.activeElement?.id===state.focus)&&(!Array.isArray(state.scroll)||Math.abs(scrollX-state.scroll[0])<2&&Math.abs(scrollY-state.scroll[1])<2);});await settle(page);result.back_ms=await page.evaluate(t=>performance.now()-t,back);
 result.return_catalog_refetches=activeRequests.filter(r=>r.path.includes('catalog-index')).length-before;
 result.navigation_cls=(await snapshot(page)).cls;await page.evaluate(async()=>{await window.maimaiUsage?.flush();});return result;
}
async function deepConfiguration(config,iteration){
 current={config,root:resolve(candidate,'registry')};
 const map=JSON.parse(await readFile(resolve(current.root,'permalinks.json'),'utf8'));
 const song=Object.values(map.songs).find(s=>/[^\x00-\x7f]/.test(s))||Object.values(map.songs)[0],version=Object.values(map.versions)[0];
 const pair={cold:{iteration,config,temperature:'cold'},warm:{iteration,config,temperature:'warm'}};
 // Every arrival type has its own fresh context. A preceding song cannot warm a version arrival.
 for(const [kind,slug]of [['song',song],['version',version],['navigation',null]]){
  const context=await browser.newContext({viewport:{width:1280,height:900},locale:'en-US',reducedMotion:'reduce',serviceWorkers:'block'});await context.addInitScript(instrument);const page=await context.newPage();
  page.on('pageerror',error=>errors.push({dataset:'deep-'+kind,config,message:error.message}));
  for(const temperature of ['cold','warm']){
   if(kind==='navigation')Object.assign(pair[temperature],await returnNavigation(page));
   else pair[temperature][kind]=await arrival(page,kind,slug);
  }
  await context.close();
 }
 return Object.values(pair);
}
const configurations=['baseline','seo-only','seo-usage'];
try{
 // Populate only the local server's filesystem/gzip cache before measured cold browser contexts.
 for(const config of deepOnly?[]:configurations)for(const dataset of datasets){
  if(dataset.configs&&!dataset.configs.includes(config))continue;current=settings(config,dataset);const context=await browser.newContext({viewport:{width:1280,height:900},locale:'en-US',reducedMotion:'reduce',serviceWorkers:'block'});await context.addInitScript(instrument);const page=await context.newPage();activeRequests=[];
  await page.goto(origin+'/',{waitUntil:'load'});await page.waitForFunction(()=>window.__bench.ready!==null);await page.waitForTimeout(150);await context.close();
 }

 for(let iteration=0;iteration<(deepOnly?0:iterations);iteration++){
  const order=configurations.slice(iteration%3).concat(configurations.slice(0,iteration%3));
  for(const config of order)for(const dataset of datasets){
   if(dataset.configs&&!dataset.configs.includes(config))continue;current=settings(config,dataset);
   const context=await browser.newContext({viewport:{width:1280,height:900},locale:'en-US',reducedMotion:'reduce',serviceWorkers:'block'});await context.addInitScript(instrument);
   const page=await context.newPage();page.on('pageerror',error=>errors.push({dataset:dataset.id,config,message:error.message}));
   for(const temperature of ['cold','warm']){
    const measured=await oneRoot(page,dataset,temperature);rows.push({iteration:iteration+1,config,dataset:dataset.id,...measured});
    process.stdout.write(JSON.stringify({iteration:iteration+1,config,dataset:dataset.id,temperature,ready_ms:measured.startup.ready_ms,transfer_bytes:measured.startup.transfer_bytes})+'\n');
   }
   await context.close();
  }
 }
 const deep=[];
 for(const config of rootsOnly?[]:['seo-only','seo-usage'])await deepConfiguration(config,0);
 for(let iteration=0;iteration<(rootsOnly?0:iterations);iteration++)for(const config of iteration%2?['seo-usage','seo-only']:['seo-only','seo-usage']){
  deep.push(...await deepConfiguration(config,iteration+1));process.stdout.write(JSON.stringify({deep_iteration:iteration+1,config})+'\n');
 }
 const result={schema_version:'architecture-performance-1',created_at:new Date().toISOString(),harness_sha256:sha(await readFile(new URL(import.meta.url))),baseline,candidate,candidateRegistry,runtime,iterations,deepOnly,rootsOnly,actualOnly,actualBaseline,actualCandidate,actualManifest,browser:browser.version(),environment:{platform:os.platform(),release:os.release(),cpu:os.cpus()[0]?.model,cpu_threads:os.cpus().length,memory_gib:os.totalmem()/2**30},method:{same_origin:origin,gzip:true,cache:'HTML/manifest revalidated; public assets max-age=3600. Local server filesystem/gzip cache primed outside measurement. Fresh browser context cold; immediate same-context repeat warm.',network:'Local server; browser outbound proxy refuses every nonlocal HTTP host and every HTTPS CONNECT; no external requests forwarded.',usage:'SEO-only omits only usage.js script tags. SEO+usage substitutes exact production origin eligibility with this localhost origin only; generated asset hash and served hash retained.',timing:'No CPU or bandwidth throttle. Startup from MutationObserver readiness; actions to second animation frame; browser/OS and cross-run code caches are not cleared.',deep_contexts:'Separate fresh contexts for song, version, and root-to-song navigation; warm repeats retain only that same flow cache. Back completion requires the saved focus and scroll position, then two animation frames.',scope:actualBaseline?'Synthetic comparisons plus retained public runtime comparison and separately identified enriched public data. No personal data or hosted provider calls.':'Three synthetic datasets. No real catalog, personal data, or hosted provider calls.',actual_overlay:actualBaseline?'For new-runtime public comparisons only root-level HTML/JS/CSS/SVG/PNG/ICO come from final synthetic public runtime assets; manifest and data are pinned separately. The review manifest is served virtually and never written into planned-assets.':null},fixtureProof,adaptations:[...new Map(adaptations.map(r=>[r.source,r])).values()],rows,deep,blocked,errors};
 await writeFile(resolve(output,'measurements.json'),JSON.stringify(result,null,2)+'\n');
 if(errors.length)throw Error('Benchmark saw resource/page errors; inspect measurements.json');
 process.stdout.write(JSON.stringify({complete:true,output:resolve(output,'measurements.json'),runs:rows.length,deep_runs:deep.length})+'\n');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
