// Manual local workerd measurement. Never scheduled or part of deterministic CI.
// Live wire bodies and CPU profiles stay in RAM; output contains aggregates only.
import {Miniflare,convertV4MiniflareOptions,Log,LogLevel} from 'miniflare';
import {readFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {createService,PATH,boundedJSON} from './index.mjs';
import {FUNCTIONS,ORIGIN} from './contract.mjs';
import {wire,publicProfile} from './fixtures.mjs';
import '../src/maimai_intelligence/assets/player-maishift.js';

const maximum=4*1024*1024, root=fileURLToPath(new URL('.',import.meta.url));
const moduleNames=['worker.mjs','index.mjs','contract.mjs','coordinator.mjs'];
const modules=moduleNames.map(name=>({type:'ESModule',path:fileURLToPath(new URL(name,import.meta.url)),contents:readFileSync(new URL(name,import.meta.url),'utf8')}));
const fingerprint=createHash('sha256').update(modules.map(m=>m.contents).join('\n')).digest('hex');
const headers={'Origin':'https://maimai.party','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1'};
const json=body=>new Response(body,{headers:{'Content-Type':'application/json'}});
const round=n=>Math.round(n*100)/100;
function field(node,key) {
  const i=node?.p?.k?.indexOf(key);if(i==null||i<0)throw Error('Unexpected wire shape');return node.p.v[i];
}
function fictionalHandle(body,handle) {
  const copy=JSON.parse(body);field(field(copy,'result'),'handle').s=handle;return JSON.stringify(copy);
}
async function sample() {
  if(process.env.MAISHIFT_BENCHMARK_LIVE!=='true') {
    const count=Number(process.env.MAISHIFT_BENCHMARK_CHARTS||6443);
    if(!Number.isInteger(count)||count<1||count>20000)throw Error('Invalid synthetic count');
    const difficulties=['BASIC','ADVANCED','EXPERT','MASTER','RE_MASTER'];
    const data={songs:[{title:'Fictional Standard',artist:'Fictional Artist',type:'STANDARD'},{title:'Fictional DX',artist:'Fictional Artist',type:'DX'}],
      tracks:Array.from({length:count},(_,i)=>({s:i%2,i:i+1,d:difficulties[i%5],l:130,r:{a:987654,d:1234,m:1800,g:200.1234,c:'FULL_COMBO',y:'FULL_SYNC'}}))};
    return {mode:'synthetic',input:{handle:'fictional-player',region:'intl',manual:true},bodies:[publicProfile(),data,publicProfile()].map(v=>JSON.stringify(wire(v))),upstreamRequests:0};
  }
  if(process.env.MAISHIFT_CANARY_APPROVED!=='true')throw Error('Explicit canary approval required');
  const location=globalThis.maimaiPlayerMaishift.location(process.env.MAISHIFT_CANARY_URL||'',process.env.MAISHIFT_CANARY_REGION);
  const input={handle:location.handle,region:location.region,manual:true},bodies=[];
  // Exactly the production service's three sequential bounded public reads.
  const service=createService({fetcher:async(url,options)=>{
    if(bodies.length>=3)throw Error('Request bound exceeded');
    const upstream=await fetch(url,options);if(!upstream.ok){await upstream.body?.cancel();throw Error('Upstream unavailable');}
    const body=JSON.stringify(await boundedJSON(upstream,maximum,options.signal));bodies.push(body);return json(body);
  }});
  const response=await service.fetch(new Request('https://maimai.party'+PATH,{method:'POST',headers,body:JSON.stringify(input)}),{
    MAISHIFT_ENABLED:'true',CLIENT_LIMITER:{limit:async()=>({success:true})},
    PROFILE_LIMITER:{getByName:()=>({claim:async()=>({id:'approved-single-read'}),finish:async()=>{}})},
  });
  if(!response.ok||bodies.length!==3)throw Error('Live snapshot validation failed');
  const expected=await response.json();
  return {mode:'approved-live-memory-replay',input,bodies,upstreamRequests:3,expected};
}

async function inspector(mf) {
  const url=await mf.getInspectorURL();url.protocol='http:';
  const targets=await (await fetch(new URL('/json/list',url))).json();
  const target=targets.find(t=>t.id?.endsWith(':maishift-benchmark'));
  if(!target)throw Error('Worker inspector target missing');
  const socket=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();let next=0;
  socket.addEventListener('message',event=>{
    const value=JSON.parse(event.data),item=pending.get(value.id);if(!item)return;
    pending.delete(value.id);clearTimeout(item.timer);
    if(value.error)item.reject(Error('Inspector method failed: '+item.method));else item.resolve(value.result);
  });
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',()=>reject(Error('Inspector unavailable')),{once:true});});
  return {call(method,params={}){return new Promise((resolve,reject)=>{
    const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('Inspector timeout: '+method));},10000);
    pending.set(id,{resolve,reject,timer,method});socket.send(JSON.stringify({id,method,params}));
  });},close(){for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('Inspector closed'));}pending.clear();socket.close();}};
}
function cpuSummary(profile) {
  // Samples are local elapsed intervals, not Cloudflare billing CPU. Idle and
  // unattributed '(program)' samples must not be labeled application CPU.
  const nodes=new Map(profile.nodes.map(n=>[n.id,n.callFrame]));
  const totals={application:0,gc:0,idle:0,unattributed:0};
  profile.samples.forEach((id,i)=>{
    const frame=nodes.get(id),name=frame?.functionName||'',delta=profile.timeDeltas[i]||0;
    const key=name==='(idle)'?'idle':name==='(garbage collector)'?'gc':frame?.url?.includes('maishift-benchmark')||frame?.url?.endsWith('.mjs')?'application':'unattributed';
    totals[key]+=delta;
  });
  return Object.fromEntries(Object.entries(totals).map(([key,value])=>[key+'SampledMs',round(value/1000)]));
}
async function main() {
  // This manual Windows harness must run from the approved disposable copy.
  // Miniflare otherwise stages SQLite/runtime files under the OS temp folder.
  const cache=root.replaceAll('\\','/').match(/^(C:\/DevCache\/projects\/maimai-chart-browser-registry\/[^/]+)\/workspaces\/[^/]+\/player-import-worker\/$/i);
  if(!cache)throw Error('Run from the registry DevCache workspace');
  // The short per-project temp path also avoids Windows SQLite path limits.
  const temporary=join(cache[1],'temp');
  mkdirSync(temporary,{recursive:true});
  process.env.TEMP=temporary;process.env.TMP=temporary;process.env.TMPDIR=temporary;
  const source=await sample();
  if(source.bodies.some(b=>Buffer.byteLength(b)>maximum))throw Error('Fixture exceeds response limit');
  let calls=0,serial=0,cdp;
  const counts=new Map();
  const mf=new Miniflare(convertV4MiniflareOptions({name:'maishift-benchmark',modules,modulesRoot:root,compatibilityDate:'2026-09-21',
    host:'127.0.0.1',inspectorHost:'127.0.0.1',inspectorPort:0,log:new Log(LogLevel.NONE),
    bindings:{MAISHIFT_ENABLED:'true'},durableObjects:{PROFILE_LIMITER:{className:'ProfileLimiter',useSQLite:true}},
    ratelimits:{CLIENT_LIMITER:{namespace_id:'1',simple:{limit:10,period:60}}},
    outboundService:async request=>{
      const url=new URL(request.url);
      if(url.origin!==ORIGIN||request.method!=='GET'||['cookie','authorization','referer'].some(h=>request.headers.has(h)))throw Error('Unexpected outbound request');
      const payload=JSON.parse(url.searchParams.get('payload')),handle=field(field(payload.t,'data'),'handle').s;
      const index=counts.get(handle)||0;counts.set(handle,index+1);calls++;
      if(index>2||url.pathname!=='/_serverFn/'+FUNCTIONS[index===1?'tracks':'profile'])throw Error('Unexpected RPC sequence');
      return json(index===1?source.bodies[1]:fictionalHandle(source.bodies[index],handle));
    }}));
  try {
    await mf.ready;cdp=await inspector(mf);
    await cdp.call('Profiler.enable');await cdp.call('Profiler.setSamplingInterval',{interval:100});
    const baseline=await cdp.call('Runtime.getHeapUsage');
    const rows=[];
    for(const concurrency of [1,1,1,4,8]) {
      const started=performance.now();await cdp.call('Profiler.start');
      let peak=await cdp.call('Runtime.getHeapUsage'),sampling=true;
      const poll=(async()=>{while(sampling){const usage=await cdp.call('Runtime.getHeapUsage');if(usage.usedSize>peak.usedSize)peak=usage;await new Promise(r=>setTimeout(r,10));}})();
      const requests=Array.from({length:concurrency},async()=>{
        const number=++serial,handle='fictional-replay-'+number;
        const response=await mf.dispatchFetch('https://maimai.party'+PATH,{method:'POST',headers:{...headers,'CF-Connecting-IP':'192.0.2.'+number},body:JSON.stringify({...source.input,handle})});
        if(response.status===429) {
          if(response.headers.get('Retry-After')!=='30'||counts.has(handle))throw Error('Capacity rejection was not early/bounded');
          return {limited:true};
        }
        if(response.status!==200)throw Error('Runtime import failed: '+response.status);
        const text=await response.text(),payload=JSON.parse(text);
        if(counts.get(handle)!==3)throw Error('Request count mismatch');
        if(source.expected&&JSON.stringify({...payload,identity:{...payload.identity,handle:source.input.handle}})!==JSON.stringify(source.expected))throw Error('Runtime result differs from validated source');
        return {bytes:Buffer.byteLength(text),charts:payload.coverage.totalCharts,pbs:payload.records.length,excluded:payload.coverage.diagnosticCount};
      });
      let values;
      try{values=await Promise.all(requests);}finally{sampling=false;await poll;}
      const cpu=cpuSummary((await cdp.call('Profiler.stop')).profile),after=await cdp.call('Runtime.getHeapUsage');
      if(after.usedSize>peak.usedSize)peak=after;
      const accepted=values.filter(v=>!v.limited);
      if(accepted.length!==Math.min(concurrency,2))throw Error('Unexpected admitted workload');
      rows.push({concurrency,accepted:accepted.length,limited:concurrency-accepted.length,localWallMs:round(performance.now()-started),...cpu,sampledHeapBytes:peak.usedSize,sampledBackingBytes:peak.backingStorageSize??null,sampledEmbedderBytes:peak.embedderHeapUsedSize??null,...accepted[0]});
    }
    const retained=await cdp.call('Runtime.getHeapUsage');
    console.log(JSON.stringify({mode:source.mode,region:source.input.region,workerSourceSha256:fingerprint,node:process.version,
      miniflare:JSON.parse(readFileSync(new URL('node_modules/miniflare/package.json',import.meta.url))).version,
      workerd:JSON.parse(readFileSync(new URL('node_modules/workerd/package.json',import.meta.url))).version,
      upstreamRequests:source.upstreamRequests,localReplayRequests:serial,localRPCs:calls,wireBytes:source.bodies.map(b=>Buffer.byteLength(b)),
      baselineHeapBytes:baseline.usedSize,retainedHeapBytes:retained.usedSize,rows,
      limitation:'Local sampled timing and heap only; not billed CPU, enforced platform limits, total isolate memory, deployed upstream access or a release approval.'}));
  }finally{cdp?.close();await mf.dispose();}
}
main().catch(error=>{
  console.error('Maishift local benchmark failed; no live payload logged.');
  if(process.env.MAISHIFT_BENCHMARK_LIVE!=='true')console.error(error.message);
  process.exitCode=1;
});
