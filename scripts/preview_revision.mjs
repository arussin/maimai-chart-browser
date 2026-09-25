/** Fictional review only: fresh profile, no outbound network, clipboard or real payment. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {launchIsolated} from '../tests/browser/isolation.mjs';

const sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Reuse the prepared fixture/runtime without copying or editing its frozen source.
const root=path.resolve(process.env.MAIMAI_NODE_MODULES_ROOT||sourceRoot);
if(process.platform==='win32'&&!root.toLowerCase().startsWith('c:\\devcache\\'))throw new Error('Run from the prepared disposable DevCache workspace, not source.');
const args=process.argv.slice(2);
if(args.some(value=>value!=='--headed'))throw new Error('Usage: node scripts/preview_revision.mjs [--headed]');
const headed=args.includes('--headed');
const require=createRequire(path.join(root,'tests/browser/package.json'));
const {chromium,expect}=require('@playwright/test');
const assets=path.resolve(process.env.MAIMAI_BROWSER_OUTPUT||path.join(root,'output/browser-tests'),'registry');
const manifest=JSON.parse(await fs.readFile(path.join(assets,'manifest.json'),'utf8'));
const fixture=JSON.parse(await fs.readFile(path.join(root,'output/reconciliation-fixture.json'),'utf8'));
if(manifest.default!=='registry-fixture'||fixture.player?.key!=='kamaitachi:maimaidx:fixture')throw new Error('Only the generated fictional registry/player fixture is accepted.');
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'};
const site='https://maimai.party',report='https://fictional-report.example',control='https://preview.example.invalid';
const sharing=new Set(['https://www.addtoany.com','https://share.naver.com']);
const run=await launchIsolated(chromium,{origins:[],launch:{headless:!headed}});
for(const origin of [site,report,control,'https://js.stripe.com',...sharing])run.synthetic(origin);
const state={support:0,imports:0,shares:0,clipboard:0,handoff:0},pageErrors=[];
let bytes,offer,object,status='open';
const hashes=new Map();
const sdk=`window.Stripe=()=>({createEmbeddedCheckoutPage:async options=>{await options.fetchClientSecret();let button;return {mount:node=>{button=document.createElement('button');button.textContent='Simulate successful support (no payment)';button.onclick=()=>{fetch('/api/support/simulated-complete',{method:'POST'}).then(()=>options.onComplete());};node.append(button);},destroy:()=>button?.remove()};}});`;
function controls(){return `<!doctype html><title>Fictional architecture preview</title><h1>Isolated fictional preview</h1><p>No live services, payment, real clipboard, saved browser profile or personal export is used.</p><p>The browser tab shows synthetic songs. File import automatically selects the fictional test file.</p><a href="${site}/" target="_blank">Open browser</a> <button id="handoff">Simulate Session Report handoff</button><p>Hosted import example: ${report}/fixture/party/latest.json</p><p id="status"></p><script>
const protocol='maimai-player-handoff/1';let recipient,nonce;
document.querySelector('#handoff').onclick=()=>{nonce=crypto.randomUUID();recipient=open('${site}/#party-import='+nonce,'fixture-handoff');};
addEventListener('message',event=>{if(event.source!==recipient||event.origin!=='${site}'||event.data?.protocol!==protocol||event.data?.type!=='ready'||event.data?.nonce!==nonce)return;const channel=new MessageChannel();channel.port1.onmessage=e=>{document.querySelector('#status').textContent='Synthetic transfer: '+e.data.type;if(e.data.type==='accept'){const bytes=Uint8Array.from(atob('${bytes?.toString('base64')||''}'),c=>c.charCodeAt(0)).buffer;channel.port1.postMessage({type:'data',bytes},[bytes]);}};channel.port1.start();recipient.postMessage({protocol,type:'offer',nonce,offer:${JSON.stringify(offer||null)}},'${site}',[channel.port2]);});</script>`;}
await run.context.exposeFunction('__previewSimulation',kind=>{state[kind]++;});
await run.context.addInitScript(()=>{
  Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>window.__previewSimulation('clipboard'),readText:async()=>''}});
  Object.defineProperty(navigator,'share',{value:async()=>window.__previewSimulation('shares')});
  Object.defineProperty(navigator,'canShare',{value:()=>true});
});
run.context.on('page',page=>{page.on('pageerror',error=>pageErrors.push(error.message));page.on('filechooser',chooser=>chooser.setFiles({name:'fictional-player.gz',mimeType:'application/gzip',buffer:bytes}));});
await run.context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin===control){state.handoff++;return route.fulfill({contentType:'text/html',body:controls()});}
  if(url.origin==='https://js.stripe.com'&&url.pathname==='/dahlia/stripe.js')return route.fulfill({contentType:'application/javascript',body:sdk});
  if(sharing.has(url.origin)){state.shares++;return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Sharing simulation</title><h1>Sharing simulation</h1><p>No post was sent.</p>'});}
  if(url.origin===report&&url.pathname==='/fixture/party/latest.json'){state.imports++;return route.fulfill({json:{...offer,object},headers:{'Access-Control-Allow-Origin':site}});}
  if(url.origin===report&&url.pathname===object?.path)return route.fulfill({contentType:'application/gzip',body:bytes,headers:{'Access-Control-Allow-Origin':site}});
  if(url.origin!==site)return route.fallback();
  if(url.pathname==='/__usage')return route.fulfill({status:204,body:''});
  if(url.pathname.startsWith('/api/support/')){state.support++;if(url.pathname.endsWith('/simulated-complete'))status='paid';return route.fulfill({json:{status,session:'cs_test_FictionalPreviewOnly12345',clientSecret:'fixture_no_payment'}});}
  const target=path.resolve(assets,'.'+decodeURIComponent(url.pathname)+(url.pathname.endsWith('/')?'index.html':''));
  if(!target.startsWith(assets+path.sep))return route.abort();
  try{
    let body=await fs.readFile(target);hashes.set(path.relative(assets,target),createHash('sha256').update(body).digest('hex'));
    if(url.pathname==='/support-config.js')body=Buffer.from(body.toString().replace(/enabled: (?:true|false)/,'enabled: true').replace(/publishableKey: '[^']*'/,"publishableKey: 'pk_test_fixture'"));
    return route.fulfill({contentType:mime[path.extname(target)]||'application/octet-stream',body});
  }catch{return route.fulfill({status:404,body:'Missing synthetic fixture'});}
});
async function applicationEntry(page){
  const entry=page.locator('script[type=module][data-maimai-browser]');
  await expect(entry).toHaveCount(1);
  const src=await entry.getAttribute('src');
  if(!src)throw new Error('Composed browser entry has no source');
  const url=new URL(src,page.url());
  if(url.origin!==site)throw new Error('Composed browser entry must use the synthetic site origin');
  return url.href;
}
let receipt;
try{
  const page=await run.context.newPage();await page.goto(site+'/');await expect(page.locator('#songs .song-row').first()).toBeVisible();
  const entry=await applicationEntry(page);
  const prepared=await page.evaluate(async({entry,data})=>{
    const {loadApplication}=await import(entry),app=await loadApplication();
    if(app!==await loadApplication())throw new Error('Composed application initialized twice');
    await app.services.personal.ready;
    const value=await app.services.playerCore.reconcile(data);
    return {data:value,offer:app.services.playerCore.offer(value)};
  },{entry,data:fixture});
  offer=prepared.offer;bytes=gzipSync(Buffer.from(JSON.stringify(prepared.data)));const sha=createHash('sha256').update(bytes).digest('hex');object={path:'/fixture/party/data/'+sha+'.gz',bytes:bytes.length,sha256:sha};
  const panel=await run.context.newPage();await panel.goto(control+'/');
  if(headed){console.log('Fictional preview ready. All remote services and clipboard actions are simulations. Close this browser to finish.');await new Promise(resolve=>run.browser.on('disconnected',resolve));}
  else{
    const sourceKey=await page.evaluate(async({entry,origin})=>{const {loadApplication}=await import(entry);return (await (await loadApplication()).services.playerSources.readReport(origin+'/fixture/')).data.player.key;},{entry,origin:report});
    expect(sourceKey).toBe('kamaitachi:maimaidx:fixture');
    await page.locator('input[type=file]').setInputFiles({name:'fictional-player.gz',mimeType:'application/gzip',buffer:bytes});
    await expect(page.locator('.player-dialog')).toContainText('Fixture');
    await page.locator('.player-dialog .player-actions button').first().click();
    await expect(page.locator('.player-dialog')).not.toBeVisible();
    const popup=run.context.waitForEvent('page');await panel.locator('#handoff').click();const recipient=await popup;
    await expect(recipient.locator('.player-dialog')).toContainText('Fixture');
    await recipient.locator('.player-dialog .player-actions button').first().click();
    const recipientEntry=await applicationEntry(recipient);
    await expect.poll(()=>recipient.evaluate(async entry=>{const {loadApplication}=await import(entry);return (await loadApplication()).services.personal.enabled();},recipientEntry)).toBe(true);
    await expect(panel.locator('#status')).toHaveText('Synthetic transfer: imported');
    await page.evaluate(()=>navigator.clipboard.writeText('fictional only'));
    await page.evaluate(()=>navigator.share({title:'fictional only'}));
    await page.locator('#about-tab').click();await page.locator('#support-open').click();
    await page.getByRole('button',{name:'Simulate successful support (no payment)'}).click();
    await expect(page.locator('#support-checkout-dialog')).toHaveAttribute('data-stage','result');
  }
  receipt={schema_version:'maimai-fictional-preview-1',mode:headed?'headed':'headless-smoke',fixture:'registry-fixture',application_entry:entry,application_singleton:true,simulations:state,served_file_sha256:Object.fromEntries(hashes),blocked_transports:run.blockedTransports,unexpected:run.unexpected,page_errors:pageErrors};
}finally{await run.close();}
const destination=path.join(root,'output','preview-revision-'+Date.now()+'.json');await fs.writeFile(destination,JSON.stringify(receipt,null,2)+'\n');
if(pageErrors.length)throw new Error('Preview page errors: '+JSON.stringify(pageErrors));
if(run.unexpected.length)throw new Error('Unexpected fixture network attempts: '+JSON.stringify(run.unexpected));
console.log(JSON.stringify({passed:true,receipt:destination,mode:receipt.mode}));
