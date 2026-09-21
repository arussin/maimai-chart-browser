import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createService,PATH,boundedJSON} from './index.mjs';
import {decode,profile,minimize,upstreamURL,FUNCTIONS} from './contract.mjs';
import {wire,tracks,publicProfile} from './fixtures.mjs';
import '../src/maimai_intelligence/assets/player-data-core.js';
import '../src/maimai_intelligence/assets/player-maishift.js';
const adapter=globalThis.maimaiPlayerMaishift,core=globalThis.maimaiPlayerData;
const input={handle:'fictional-player',region:'intl',manual:true};

test('shared multibyte song metadata cannot expand beyond the browser response limit',async()=>{
  const data={songs:[{title:'界'.repeat(512),artist:'語'.repeat(512),type:'STANDARD'}],
    tracks:Array.from({length:2000},(_,i)=>({s:0,i:i+1,d:'MASTER',r:{a:1000000}}))};
  assert.ok(new TextEncoder().encode(JSON.stringify(wire(data))).byteLength<4*1024*1024);
  assert.throws(()=>minimize(data,{handle:'fictional-player'}),{code:'response_too_large'});
  const state=setup({responses:[publicProfile(),data,publicProfile()]});
  const response=await state.service.fetch(request(),state.env);
  assert.equal(response.status,502);assert.deepEqual(await response.json(),{error:'response_too_large'});
  assert.equal(state.calls.length,2);assert.equal(state.finishes.length,1);
});

test('response limit also includes identity, coverage and bounded diagnostics',async()=>{
  const data={songs:[{title:'界'.repeat(512),artist:'語'.repeat(512),type:'STANDARD'}],tracks:[]};
  // Find the last whole record which fits the records-only budget. The bounded
  // diagnostic envelope is larger than one record, so it crosses the final cap.
  let low=1,high=2000;
  const fill=count=>Array.from({length:count},(_,i)=>({s:0,i:i+1,d:'MASTER',r:{a:1000000}}));
  while(low<high){const mid=Math.ceil((low+high)/2);data.tracks=fill(mid);
    try{minimize(data,{});low=mid;}catch(error){assert.equal(error.code,'response_too_large');high=mid-1;}}
  data.tracks=fill(low).concat(Array.from({length:100},()=>({r:{}})));
  const payload=minimize(data,profile(decode(wire(publicProfile())),input));
  assert.ok(new TextEncoder().encode(JSON.stringify(payload)).byteLength>4*1024*1024);
  const state=setup({responses:[publicProfile(),data,publicProfile()]});
  const response=await state.service.fetch(request(),state.env);
  assert.equal(response.status,502);assert.deepEqual(await response.json(),{error:'response_too_large'});
  assert.equal(state.calls.length,3);assert.equal(state.finishes.length,1);
});

test('isolate capacity rejects excess work before upstream reads and releases failed reservations',async()=>{
  let reads=0,release;
  const paused=new Promise(resolve=>{release=resolve;});
  const state=setup({fetcher:async()=>{reads++;await paused;return new Response('unavailable',{status:503});}});
  const first=state.service.fetch(request(),state.env),second=state.service.fetch(request(),state.env);
  while(reads<2)await new Promise(resolve=>setTimeout(resolve,1));
  const excess=await state.service.fetch(request(),state.env);
  assert.equal(excess.status,429);assert.equal(excess.headers.get('Retry-After'),'30');assert.equal(reads,2);
  release();assert.deepEqual((await Promise.all([first,second])).map(r=>r.status),[503,503]);
  state.coordinator.finish=async()=>{throw Error('Fictional coordination failure');};
  assert.equal((await state.service.fetch(request(),state.env)).status,503);assert.equal(reads,3);
  assert.equal((await state.service.fetch(request(),state.env)).status,503);assert.equal(reads,4);
  assert.equal((await state.service.fetch(request(),state.env)).status,503);assert.equal(reads,5);
});
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
test('transport escapes preserve exact chart text without executing or recursively decoding it',()=>{
  const envelope=s=>({t:10,p:{k:['result','error'],v:[{t:1,s},{t:2,s:1}]}});
  assert.equal(decode(envelope('Fictional \\"Quote\\" \\x3Cmix>')),'Fictional "Quote" <mix>');
  assert.equal(decode(envelope('literal \\\\x3C')),'literal \\x3C');
  assert.equal(decode(envelope('\\n\\r\\b\\t\\f\\u2028\\u2029')),'\n\r\b\t\f\u2028\u2029');
  assert.equal(decode(envelope('\\u0061')),'\\u0061');
  const inert='</script><script>throw new Error("never execute")</script>';
  assert.equal(decode(wire(inert)),inert);
  const result=decode(wire({'Fictional "key" <': 'Fictional \\ title'}));
  assert.equal(result['Fictional "key" <'],'Fictional \\ title');
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
  for(const suffix of ['', '/', '/home', '/home/'])assert.equal(adapter.location('https://maimai.shiftpsh.com/en/profile/fictional-player'+suffix,'intl').handle,input.handle);
  assert.equal(adapter.location('https://maimai.shiftpsh.com/ja/profile/fictional-player/home','intl').region,'intl');
  assert.equal(adapter.location('https://maimai.shiftpsh.com/en@na/profile/fictional-player/records','intl').handle,input.handle);
  for(const url of ['https://evil.example/en/profile/x/home','https://maimai.shiftpsh.com/en@jp/profile/x','https://maimai.shiftpsh.com/en@jp/profile/x/home','https://maimai.shiftpsh.com/en/profile/x:1/home','https://maimai.shiftpsh.com/en/profile/x/home?foo=1','https://maimai.shiftpsh.com/en/profile/x/unknown','https://maimai.shiftpsh.com/en/profile/x#secret'])assert.throws(()=>adapter.location(url,'intl'));
});
test('a known region fallback stops before reading tracks and is never relabeled',async()=>{
  const s=setup({responses:[publicProfile('JAPAN')]});
  const result=await s.service.fetch(request(),s.env);assert.equal(result.status,409);
  assert.deepEqual(await result.json(),{error:'region_mismatch'});assert.equal(s.calls.length,1);
});
