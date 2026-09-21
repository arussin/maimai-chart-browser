/* Source locations are local connection metadata, never portable player data. */
(()=>{'use strict';
if(globalThis.maimaiPlayerSources)return;
const core=globalThis.maimaiPlayerData;
const capabilities=Object.freeze({file:true,report:true,maishift:false});
const AUTO_INTERVAL=15*60*1000,MANUAL_INTERVAL=30000;
function reportURL(value){
  let url;try{url=new URL(value);}catch{throw new Error('Enter a complete HTTPS Session Report URL.');}
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash||value.length>2048)throw new Error('Enter a complete HTTPS Session Report URL.');
  // The installed report uses exactly one installation-prefix segment. Never
  // discover endpoints by crawling HTML or guessing parents of arbitrary paths.
  const match=/^\/([A-Za-z0-9_-]+)\/(?:party\/latest\.json|index\.html)?$/.exec(url.pathname);
  return {url:url.href,manifest:match?url.origin+'/'+match[1]+'/party/latest.json':null};
}
function validateSource(source,playerKey){
  if(source===null)return null;
  if(!source||source.schemaVersion!==1||!['report','maishift'].includes(source.type)||source.adapterVersion!==1||source.playerKey!==playerKey||source.autoRefresh!==true||!Number.isSafeInteger(source.generation)||source.generation<0)throw new Error('Invalid saved source connection.');
  if(source.type==='report'){
    const parsed=reportURL(source.url);
    if(!parsed.manifest||parsed.manifest!==source.url)throw new Error('Invalid saved source connection.');
  }else{
    const parsed=globalThis.maimaiPlayerMaishift.location(source.url,source.region);
    if(parsed.url!==source.url||parsed.handle!==source.handle||playerKey!=='maishift:maimaidx:'+source.region+':'+encodeURIComponent(source.handle)||!Number.isSafeInteger(source.profileCreatedAt)||source.profileCreatedAt<0||!/^[a-f0-9]{64}$/.test(source.contentRevision)||!Array.isArray(source.diagnostics)||source.diagnostics.length>100||!Number.isSafeInteger(source.diagnosticCount)||source.diagnosticCount<source.diagnostics.length||source.diagnosticCount>20000)throw new Error('Invalid saved source connection.');
    if(source.diagnostics.some(d=>!Number.isSafeInteger(d.rowIndex)||d.rowIndex<0||d.rowIndex>=20000||d.reason!=='insufficient_chart_identity'))throw new Error('Invalid saved source connection.');
  }
  for(const name of ['lastAttempt','lastChecked','lastSuccess','sourceUpdatedAt','retryAt'])if(source[name]!==null&&(!Number.isSafeInteger(source[name])||source[name]<0))throw new Error('Invalid saved source connection.');
  if(!/^[a-f0-9]{64}$/.test(source.sourceRevision))throw new Error('Invalid saved source connection.');
  return source;
}
function connection(url,data,now=Date.now()){
  return {schemaVersion:1,type:'report',url,playerKey:data.player.key,adapterVersion:1,autoRefresh:true,generation:0,lastAttempt:now,lastChecked:now,lastSuccess:now,sourceUpdatedAt:core.offer(data).capturedAt||null,sourceRevision:data.revision,retryAt:null};
}
function retryAfter(value,now=Date.now()){
  if(!value)return now+AUTO_INTERVAL;
  const until=/^\d+$/.test(value)?now+Number(value)*1000:Date.parse(value);
  return Number.isSafeInteger(until)?Math.max(now+MANUAL_INTERVAL,until):now+AUTO_INTERVAL;
}
async function request(url,maximum,signal,timeout){
  const response=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(timeout)])});
  if(!response.ok){const error=new Error('The public source could not be read. Open the report to use its import or download controls.');if(response.status===429||response.status===503)error.retryAt=retryAfter(response.headers.get('Retry-After'));throw error;}
  const size=Number(response.headers.get('Content-Length'));if(size>maximum)throw new Error('The source response exceeds its size limit.');
  return {response,bytes:await core.bounded(response.body,maximum)};
}
async function readReport(value,{signal=new AbortController().signal,expectedPlayer=null}={}){
  const parsed=reportURL(value);if(!parsed.manifest)throw new Error('This report link needs assisted import. Open the report and choose Open in Party, or download its player file.');
  const {response,bytes:raw}=await request(parsed.manifest,1024*1024,signal,10000);
  if(!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:;|$)/i.test(response.headers.get('Content-Type')||''))throw new Error('The source did not return player data. Open the report to sign in or download a player file.');
  let meta;try{meta=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{throw new Error('The source did not return valid player data.');}
  core.validateOffer(meta);const ref=meta.object,prefix=new URL(parsed.manifest).pathname.slice(0,-'latest.json'.length);
  if(!ref||!/^[a-f0-9]{64}$/.test(ref.sha256)||ref.path!==prefix+'data/'+ref.sha256+'.gz'||!Number.isSafeInteger(ref.bytes)||ref.bytes<1||ref.bytes>core.MAX_COMPRESSED)throw new Error('Invalid player data reference.');
  if(expectedPlayer&&meta.player.key!==expectedPlayer)throw new Error('The source now identifies a different player. Import it again to confirm the switch.');
  const {bytes}=await request(new URL(ref.path,parsed.manifest).href,ref.bytes,signal,30000);
  if(bytes.length!==ref.bytes||await core.hash(bytes)!==ref.sha256)throw new Error('Player file integrity check failed.');
  const data=await core.decode(bytes),offer=core.offer(data);
  if(!Object.entries(offer).every(([key,value])=>key==='profile'&&!Object.hasOwn(meta,key)||core.canonical(value)===core.canonical(meta[key])))throw new Error('The report sent a different dataset from the one offered.');
  signal.throwIfAborted();return {data,source:connection(parsed.manifest,data)};
}
async function readMaishift(value,{signal=new AbortController().signal,manual=true,expectedPlayer=null,previous=null}={}){
  if(!capabilities.maishift)throw new Error('Maishift import is not available yet. Full record access and exact chart matching are still being verified.');
  const adapter=globalThis.maimaiPlayerMaishift,selected=adapter.location(value.url||value.handle,value.region);
  const response=await fetch('/api/player-import/maishift',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({handle:selected.handle,region:selected.region,manual}),credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(45000)])});
  if(!response.ok){const error=new Error('Maishift could not be read. Your saved data was kept. Try again later or open your public profile.');if(response.status===429||response.status===503)error.retryAt=retryAfter(response.headers.get('Retry-After'));throw error;}
  if(!/^application\/json(?:;|$)/i.test(response.headers.get('Content-Type')||'')||Number(response.headers.get('Content-Length'))>4*1024*1024)throw new Error('Maishift returned an unsupported response. Your saved data was kept.');
  const raw=await core.bounded(response.body,4*1024*1024);let envelope;try{envelope=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{throw new Error('Maishift returned an unsupported response. Your saved data was kept.');}
  const result=await adapter.normalize(envelope,selected),data=result.data;
  if(expectedPlayer&&data.player.key!==expectedPlayer||previous&&result.createdAt!==previous.profileCreatedAt)throw new Error('The source now identifies a different player. Import it again to confirm the switch.');
  const source={...connection(selected.url,data),type:'maishift',handle:selected.handle,region:selected.region,profileCreatedAt:result.createdAt,sourceUpdatedAt:result.updatedAt,contentRevision:await core.digest({charts:data.charts,records:data.records}),diagnostics:result.diagnostics,diagnosticCount:result.coverage.diagnosticCount};
  signal.throwIfAborted();return {data,source};
}
function readSource(source,options={}){return source.type==='maishift'?readMaishift(source,{...options,previous:source.profileCreatedAt===undefined?null:source}):readReport(source.url,options);}
globalThis.maimaiPlayerSources=Object.freeze({capabilities,reportURL,validateSource,connection,readReport,readMaishift,readSource,AUTO_INTERVAL,MANUAL_INTERVAL,retryAfter});
})();
