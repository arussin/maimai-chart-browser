// Explicitly invoked, logged-out transport probe. Never logs a canary identity,
// score payload, response body, network trace, or browser screenshot.
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(path.join(process.env.MAIMAI_NODE_MODULES_ROOT||process.cwd(),'tests/browser/package.json'));
const {chromium}=require('playwright');
const value=process.env.MAISHIFT_CANARY_URL;
let url;try{url=new URL(value);}catch{throw new Error('An approved public canary URL is required.');}
if(process.env.MAISHIFT_CANARY_APPROVED!=='true'||url.protocol!=='https:'||url.hostname!=='maimai.shiftpsh.com'||url.port||url.username||url.password||url.search||url.hash||!/^\/(?:en|ko|ja)(?:@(?:na|intl|jp))?\/profile\/[A-Za-z0-9_%.-]+\/(?:home|records)$/.test(url.pathname))throw new Error('Canary approval or URL validation failed.');
const summary={adapterVersion:0,contract:'blocked-unverified',server:null,browser:null};
try{
  const response=await fetch(url,{redirect:'manual',headers:{Origin:'https://maimai.party'},signal:AbortSignal.timeout(15000)});
  let bytes=0;for await(const part of response.body){bytes+=part.length;if(bytes>4*1024*1024)throw new Error('Size limit');}
  summary.server={status:response.status,contentType:response.headers.get('content-type'),allowOrigin:response.headers.get('access-control-allow-origin'),bytes};
}catch{summary.server={failure:'transport-or-limit'};}
const browser=await chromium.launch();
try{
  const context=await browser.newContext();const page=await context.newPage();
  // A synthetic document on the actual Party origin isolates the browser CORS
  // decision without loading production scripts, analytics, or personal state.
  await page.route('https://maimai.party/__contract_probe__',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Contract probe</title>'}));
  await page.goto('https://maimai.party/__contract_probe__');
  summary.browser=await page.evaluate(async target=>{
    try{const r=await fetch(target,{credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});const reader=r.body.getReader();let bytes=0;for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>4*1024*1024){await reader.cancel();return {failure:'size-limit'};}}return {readable:true,status:r.status,contentType:r.headers.get('content-type'),bytes};}
    catch{return {readable:false,failure:'cors-or-transport'};}
  },url.href);
}finally{await browser.close();}
console.log(JSON.stringify(summary,null,2));
// Fetchability is not full PB coverage, chart mapping, or normalization success.
process.exitCode=2;
