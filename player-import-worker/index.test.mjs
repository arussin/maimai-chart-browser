import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createService,PATH,boundedJSON} from './index.mjs';
import {decode,profile,minimize,upstreamURL,FUNCTIONS} from './contract.mjs';
import {wire,tracks,publicProfile} from './fixtures.mjs';
import '../src/maimai_intelligence/assets/player-data-core.js';
import '../src/maimai_intelligence/assets/player-maishift.js';
const adapter=globalThis.maimaiPlayerMaishift,core=globalThis.maimaiPlayerData;
const input={handle:'fictional-player',region:'intl',manual:true};
const request=(body=input,options={})=>new Request('https://maimai.party'+PATH,{method:'POST',headers:{Origin:'https://maimai.party','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.10'},body:JSON.stringify(body),...options});
const response=value=>new Response(JSON.stringify(wire(value)),{headers:{'Content-Type':'application/json'}});
function setup({responses=[publicProfile(),tracks(),publicProfile()],fetcher,timeoutMs}={}){
  const calls=[],finishes=[],keys=[];
  const coordinator={claim:async()=>({id:'fictional-lease'}),finish:async(...args)=>finishes.push(args)};
  const env={MAISHIFT_ENABLED:'true',CLIENT_LIMITER:{limit:async({key})=>{keys.push(key);return {success:true};}},PROFILE_LIMITER:{getByName:key=>{keys.push(key);return coordinator;}}};
  const service=createService({timeoutMs,fetcher:fetcher|| (async(url,options)=>{calls.push({url,options});const value=responses.shift();return value instanceof Response?value:response(value);})});
  return {env,service,calls,finishes,keys,coordinator};
}
test('frozen wire constants, dates and request serialization',()=>{
  assert.equal(decode(wire(null)),null);assert.equal(decode(wire(false)),false);
  assert.equal(decode(wire(new Date('2026-01-01T00:00:00Z'))),'2026-01-01T00:00:00.000Z');
  const url=new URL(upstreamURL('tracks',input));assert.equal(url.origin,'https://maimai.shiftpsh.com');assert.equal(url.pathname,'/_serverFn/'+FUNCTIONS.tracks);
  assert.equal(JSON.parse(url.searchParams.get('payload')).t.p.v[0].p.v[1].s,'ASIA');
  for(const value of [{t:99},{t:10,p:{k:['__proto__'],v:[{t:2,s:0}]}},{t:10,p:{k:['a','a'],v:[{t:2,s:0},{t:2,s:0}]}},{t:2,s:5}])assert.throws(()=>decode(value));
});
test('public import minimizes fields, bounds requests and normalizes without invented history',async()=>{
  const s=setup(),r=await s.service.fetch(request(),s.env),body=await r.json();assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store, private');
  assert.equal(s.calls.length,3);assert.ok(s.calls.every(c=>c.options.credentials==='omit'&&c.options.referrerPolicy==='no-referrer'&&c.options.redirect==='manual'&&!c.options.headers.Cookie&&!c.options.headers.Authorization));
  assert.ok(s.keys.every(k=>/^[a-f0-9]{64}$/.test(k)));assert.equal(s.finishes.length,1);
  assert.equal(body.records.length,3);assert.equal(body.records[0].achievement,987654);assert.equal(body.records[2].constant,null);
  assert.equal(body.records[0].rate,null);
  assert.doesNotMatch(JSON.stringify(body),/friendCode|SYNTHETIC-PRIVATE|private\.example|jacketUrl|playCount/);
  const first=await adapter.normalize(body,input),again=await adapter.normalize(body,input);assert.equal(first.data.revision,again.data.revision);
  assert.deepEqual(first.data.plays,{});assert.equal(core.offer(first.data).pbCoverage,'partial');assert.equal(Object.values(first.data.records)[0].timeAchieved,null);assert.equal(Object.values(first.data.charts)[0].inGameID,null);
  const corrected=structuredClone(body);corrected.records[0].achievement=950000;corrected.identity.updatedAt+=1000;
  const next=await adapter.normalize(corrected,input),merged=await core.merge(first.data,next.data);assert.equal(core.current(merged).pbs.get('maishift:intl:1').achievement,950000);assert.equal(Object.keys(merged.plays).length,0);
  const jp=structuredClone(body);jp.identity.region='jp';const isolated=await adapter.normalize(jp,{...input,region:'jp'});await assert.rejects(core.merge(first.data,isolated.data),/Different players/);
});
test('diagnostics are bounded and excluded from portable data; duplicates fail closed',async()=>{
  const t=tracks();for(let i=0;i<105;i++)t.tracks.push({s:99999,r:{a:987654}});
  const payload=minimize(t,profile(decode(wire(publicProfile())),input));assert.equal(payload.coverage.diagnosticCount,105);assert.equal(payload.diagnostics.length,100);
  const result=await adapter.normalize(payload,input);assert.equal(Object.keys(result.data.charts).length,3);assert.equal(result.diagnostics.length,100);
  assert.ok(!JSON.stringify(result.data).includes('diagnostic'));t.tracks.push(t.tracks[0]);assert.throws(()=>minimize(t,payload.identity));
});
test('unknown measurements remain unknown; malformed supplied values cannot replace scores',()=>{
  for(const patch of [{a:1010001},{a:9876.5},{d:-1},{m:1},{c:'FUTURE_COMBO'},{y:'FUTURE_SYNC'}]){const t=tracks();Object.assign(t.tracks[0].r,patch);assert.throws(()=>minimize(t,{}));}
});
test('a provider chart ID remains importable when display titles or artists are empty',async()=>{
  const t=tracks();t.songs[0].title='';t.songs[0].artist='';const p=minimize(t,profile(decode(wire(publicProfile())),input));
  assert.equal(p.coverage.diagnosticCount,0);const result=await adapter.normalize(p,input);assert.equal(result.data.charts['maishift:intl:1'].title,'');assert.equal(Object.keys(result.data.charts).length,3);
});
test('endpoint is closed by default, same-origin only, fixed-path and bounded-input',async()=>{
  for(const change of [e=>e.MAISHIFT_ENABLED='false',e=>delete e.CLIENT_LIMITER,e=>delete e.PROFILE_LIMITER]){const s=setup();change(s.env);assert.equal((await s.service.fetch(request(),s.env)).status,503);assert.equal(s.calls.length,0);}
  const s=setup();for(const r of [request(input,{headers:{Origin:'https://other.example'}}),new Request('https://maimai.party'+PATH+'?handle=x'),request({...input,url:'https://other.example'}),request({...input,handle:'../evil'}),request({...input,region:'na'}),request({large:'x'.repeat(3000)})]){assert.ok((await s.service.fetch(r,s.env)).status>=400);}assert.equal(s.calls.length,0);
});
test('login HTML, missing/private profile, profile switch and interrupted snapshot fail without partial success',async()=>{
  const changed=publicProfile();changed.userRecord.profile.updatedAt=new Date('2026-09-21T00:00:00Z');
  const wrong=publicProfile('JAPAN');
  for(const responses of [[new Response('<html>login</html>',{headers:{'Content-Type':'text/html'}})],[null],[wrong],[publicProfile(),tracks(),changed],[new Response('',{status:403})],[new Response('',{status:302,headers:{Location:'https://unapproved.example/'}})],[publicProfile(),new Response('',{status:500})]]){
    const s=setup({responses}),r=await s.service.fetch(request(),s.env);assert.ok(r.status>=400);assert.deepEqual(Object.keys(await r.json()),['error']);assert.equal(s.finishes.length,1);
  }
});
test('upstream Retry-After, simultaneous attempt limits and client rate limits propagate safely',async()=>{
  const s=setup({responses:[new Response('',{status:429,headers:{'Retry-After':'120'}})]}),r=await s.service.fetch(request(),s.env);assert.equal(r.status,503);assert.ok(Number(r.headers.get('Retry-After'))>=119);assert.ok(s.finishes[0][1]>Date.now());
  const blocked=setup();blocked.coordinator.claim=async()=>({retryAt:Date.now()+90000});assert.equal((await blocked.service.fetch(request(),blocked.env)).status,429);assert.equal(blocked.calls.length,0);
  const rate=setup();rate.env.CLIENT_LIMITER.limit=async()=>({success:false});assert.equal((await rate.service.fetch(request(),rate.env)).status,429);assert.equal(rate.calls.length,0);
});
test('size and time bounds cancel streams, and thrown upstream details stay private',async()=>{
  const controller=new AbortController();let cancelled=false;
  const stream=new ReadableStream({cancel(){cancelled=true;}}),reading=boundedJSON(new Response(stream,{headers:{'Content-Type':'application/json'}}),100,controller.signal);controller.abort();await assert.rejects(reading);assert.equal(cancelled,true);
  await assert.rejects(boundedJSON(new Response('x'.repeat(101),{headers:{'Content-Type':'application/json'}}),100,new AbortController().signal));
  const s=setup({fetcher:async()=>{throw new Error('secret source URL and player data');}}),r=await s.service.fetch(request(),s.env);assert.equal(await r.text(),'{"error":"source_unavailable"}');
  const slow=setup({timeoutMs:5,fetcher:async(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason)))});
  // A referenced timer keeps Node alive while testing AbortSignal.timeout.
  const hold=setTimeout(()=>{},1000);try{assert.equal((await slow.service.fetch(request(),slow.env)).status,502);}finally{clearTimeout(hold);}
});
test('conservative handles and region-specific URLs never infer region from language',()=>{
  assert.equal(adapter.location('https://maimai.shiftpsh.com/ja/profile/fictional-player/home','intl').region,'intl');
  assert.equal(adapter.location('https://maimai.shiftpsh.com/en@na/profile/fictional-player/records','intl').handle,input.handle);
  for(const url of ['https://evil.example/en/profile/x/home','https://maimai.shiftpsh.com/en@jp/profile/x/home','https://maimai.shiftpsh.com/en/profile/x:1/home','https://maimai.shiftpsh.com/en/profile/x/home?foo=1'])assert.throws(()=>adapter.location(url,'intl'));
});
