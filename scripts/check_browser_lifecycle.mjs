/** Real browser lifecycle proof on a local fixture; no synthetic lifecycle events. */
import http from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {startIsolationProxy} from '../tests/browser/isolation.mjs';
const argv=process.argv.slice(2),arg=key=>argv[argv.indexOf('--'+key)+1];
const root=resolve(arg('public')),runtime=resolve(arg('runtime')),output=resolve(arg('output'));
const require=createRequire(resolve(runtime,'package.json')),{chromium}=require('playwright');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),events=[],requests=[],errors=[],applicationOutbound=[];
const probe=`(()=>{const p=window.__lifecycle={id:crypto.randomUUID(),initialPrerendering:document.prerendering,shows:[],activations:[],changes:0};const report=kind=>fetch('/__probe',{method:'POST',body:JSON.stringify({kind,path:location.pathname,activationStart:performance.getEntriesByType('navigation')[0]?.activationStart||0,...p})});addEventListener('pageshow',e=>{p.shows.push(e.persisted);report('show')});addEventListener('maimai:navigation',e=>{p.activations.push(e.detail.page);report('activation')});document.addEventListener('prerenderingchange',()=>{p.changes++;report('prerender-activated')});report('init');})();`;
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.ico':'image/x-icon'};
let origin;
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,origin);requests.push({path:url.pathname,purpose:req.headers['sec-purpose']||req.headers.purpose||null});
  if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  if(url.pathname==='/__probe'){let body='';for await(const chunk of req){body+=chunk;if(body.length>4096)throw Error('Oversized probe');}events.push(JSON.parse(body));res.writeHead(204).end();return;}
  if(url.pathname==='/__lifecycle.js'){res.setHeader('Content-Type','text/javascript');res.end(probe);return;}
  if(url.pathname==='/__prerender_ready'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(events.some(e=>e.initialPrerendering)));return;}
  if(url.pathname==='/__seed_auto'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Local prerender seed</title><script type="speculationrules">'+JSON.stringify({prerender:[{source:'list',urls:[origin+'/'],eagerness:'immediate'}]})+'</script><script>(async()=>{for(let i=0;i<80;i++){if(await (await fetch("/__prerender_ready")).json())break;await new Promise(r=>setTimeout(r,100));}await new Promise(r=>setTimeout(r,500));location.href="/";})();</script>');return;}
  if(url.pathname==='/__away'||url.pathname==='/__seed'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Local lifecycle seed</title><a id="activate" href="/">Activate browser</a>');return;}
  const name=decodeURIComponent(url.pathname)+(url.pathname.endsWith('/')?'index.html':''),path=resolve(root,'.'+name);
  if(!path.startsWith(root+sep))throw Error('Escaped root');let bytes=await readFile(path);
  if(extname(path)==='.html')bytes=Buffer.from(bytes.toString().replace('<head>','<head><script src="/__lifecycle.js"></script>'));
  res.setHeader('Content-Type',mime[extname(path)]||'application/octet-stream');res.setHeader('Cache-Control','max-age=60');res.end(bytes);
 }catch(error){errors.push({path:req.url,error:error.message});res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
const proxy=await startIsolationProxy({origins:[origin]});
const browser=await chromium.launch({channel:'chromium',headless:true,proxy:{server:proxy.server},ignoreDefaultArgs:['--disable-back-forward-cache'],args:['--disable-background-networking','--disable-component-update','--enable-features=Prerender2']});
function observe(context){context.on('request',request=>{if(new URL(request.url()).origin!==origin)applicationOutbound.push(request.url());});}
const receipt={schema:'browser-lifecycle-proof-1',created_at:new Date().toISOString(),root,browser:browser.version(),node:process.version,harness_sha256:sha(await readFile(new URL(import.meta.url))),method:'Real navigation and speculation rules, no route interception, no dispatched pageshow/prerenderingchange. Observation-only external script injected before application scripts. Full Chromium with BFCache enabled; a separate fresh Chromium process exercises prerender without a DevTools attachment. Exact loopback proxy blocks all outbound, including browser background services; application requests are separately audited.'};
await mkdir(output,{recursive:true});
try{
 const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();observe(context);
 page.on('pageerror',e=>errors.push({phase:'bfcache',error:e.message}));
 const cdp=await context.newCDPSession(page),notRestored=[];await cdp.send('Page.enable');cdp.on('Page.backForwardCacheNotUsed',e=>notRestored.push(e));
 await page.goto(origin);await page.locator('#songs .song-row').first().waitFor();await page.waitForTimeout(100);
 const before=await page.evaluate(()=>window.__lifecycle);
 await page.evaluate(()=>{const link=document.createElement('a');link.id='keyboard-away';link.href='/__away';link.textContent='Local keyboard navigation';document.body.append(link);});
 await page.locator('#keyboard-away').focus();await page.keyboard.down('Enter');await page.waitForURL(origin+'/__away');await page.keyboard.up('Enter');await page.evaluate(()=>history.back());await page.waitForFunction(()=>location.pathname==='/'&&window.__lifecycle?.shows.length>0);await page.locator('#songs .song-row').first().waitFor();await page.waitForTimeout(100);
 const after=await page.evaluate(()=>window.__lifecycle),restored=before.id===after.id&&after.shows.includes(true);
 receipt.bfcache={status:restored?'passed':'not-exercised',same_document:before.id===after.id,before,after,notRestored};
 if(restored&&after.activations.length!==before.activations.length+1)throw Error('BFCache restoration did not activate exactly once');
 // Keyup belongs to the away document. Cached navigation must discard the old held-key state.
 await page.locator('#songs .song-row').first().locator('.chart-row').click();
 const link=page.locator('#songs a[data-song-page]').first();await link.waitFor();await link.click();
 await page.locator('#seo-route-view .song-workspace').waitFor({timeout:5000});
 receipt.bfcache.navigation_after_held_key=true;

 await context.close();
 // No DevTools connection: attached automation itself disables prerender in this engine.
 const eventStart=events.length,profile=resolve(output,'prerender-profile');await mkdir(profile);
 const native=spawn(chromium.executablePath(),['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--disable-default-apps','--proxy-server='+proxy.server,'--proxy-bypass-list=<-loopback>','--user-data-dir='+profile,origin+'/__seed_auto'],{stdio:'ignore',windowsHide:true});
 let nativeError;native.on('error',error=>{nativeError=error.message;});
 let activated;
 try {for(let attempt=0;attempt<150;attempt++){activated=events.slice(eventStart).find(e=>e.kind==='activation'&&e.changes===1&&e.initialPrerendering);if(activated||nativeError)break;await new Promise(r=>setTimeout(r,100));}}
 finally {native.kill();}
 const prerendered=events.slice(eventStart).find(e=>e.kind==='init'&&e.initialPrerendering),real=!!prerendered&&activated?.id===prerendered.id&&activated.activationStart>0;
 receipt.prerender={status:real?'passed':'not-exercised',method:'Fresh full Chromium headless process without DevTools attached; native speculation rules and document signals only',nativeError,prerendered,activated,prerender_requests:requests.filter(r=>r.purpose?.includes('prerender'))};
 if(real&&activated.activations.length!==1)throw Error('Prerender activation did not activate exactly once');
 receipt.passed=restored&&real&&!errors.length&&!applicationOutbound.length;
} catch(error){receipt.passed=false;receipt.failure=error.message;}
finally{receipt.errors=errors;receipt.blocked=proxy.unexpected;receipt.applicationOutbound=applicationOutbound;receipt.events=events;await writeFile(resolve(output,'lifecycle.json'),JSON.stringify(receipt,null,2)+'\n');await browser.close();await proxy.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
console.log(JSON.stringify({passed:receipt.passed,bfcache:receipt.bfcache?.status,prerender:receipt.prerender?.status,failure:receipt.failure,receipt:resolve(output,'lifecycle.json')}));
if(!receipt.passed)process.exitCode=1;
