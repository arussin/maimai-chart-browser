import {test} from 'node:test';
import assert from 'node:assert/strict';
import {wire,publicProfile,tracks} from './fixtures.mjs';
import {decode,minimize,profile} from './contract.mjs';
import '../src/maimai_intelligence/assets/player-data-core.js';
import '../src/maimai_intelligence/assets/player-maishift.js';
import '../src/maimai_intelligence/assets/maishift-pilot-core.js';
const input={handle:'fictional-player',region:'intl',manual:true},build='a'.repeat(64);
function fixture(){
  const p=publicProfile(),t=tracks(),mapping={charts:{}},targets={};let now=1e12;
  const payload=()=>minimize(t,profile(decode(wire(p)),input));
  for(const row of payload().records){const id='target-'+row.id;mapping.charts['maishift:intl:'+row.id]={chart_id:id,acceptance_basis:'reviewed',expected_source:{title:row.title,artist:row.artist,format:row.format,difficulty:row.difficulty}};targets[id]={chart_id:id,format:row.format,difficulty:row.difficulty};}
  const calls=[];let fetcher=async(url,options)=>{calls.push({url,options});return Response.json(payload());};
  const pilot=maimaiMaishiftPilot.create({mapping,targets,build,now:()=>now,fetcher:(...args)=>fetcher(...args)});
  const capture=(phase='baseline',changeKind='upload')=>{now+=31000;return pilot.capture({value:input.handle,region:'intl',consent:true,phase,changeKind});};
  return {p,t,mapping,targets,pilot,capture,calls,setFetch:value=>{fetcher=value;},advance:()=>{now+=31000;}};
}
test('pilot uses one explicit same-origin POST and exports no profile data',async()=>{
  const f=fixture();await assert.rejects(f.pilot.capture({phase:'baseline'}),/consent_required/);assert.equal(f.calls.length,0);
  const report=await f.capture();assert.equal(report.outcome,'needs_changed_upload');assert.equal(report.baseline.matched,3);
  const call=f.calls[0];assert.equal(call.url,'/api/player-import/maishift');assert.equal(call.options.credentials,'omit');assert.equal(call.options.referrerPolicy,'no-referrer');
  const serialized=JSON.stringify(report);for(const value of ['fictional-player','Fictional Player','Fictional Song','987654','maishift:intl:1','2026-09-20'])assert.ok(!serialized.includes(value));assert.equal(report.releaseReady,false);
});
test('unchanged data cannot pass chronology; real newer changes require a stable confirmation',async()=>{
  const f=fixture();await f.capture();assert.equal((await f.capture('updated')).outcome,'needs_changed_upload');
  f.t.tracks[0].r.a=990001;f.p.userRecord.profile.updatedAt=new Date('2026-09-21T00:00:00Z');
  assert.equal((await f.capture('updated')).outcome,'needs_stable_check');
  const result=await f.capture('confirmed');assert.equal(result.outcome,'observed_pass');assert.equal(result.changes.changed,1);assert.equal(result.confirmed.plays,0);
});
test('equal and older timestamps, missing records and false correction claims cannot pass',async()=>{
  for(const time of ['2026-09-20T00:00:00Z','2026-09-19T00:00:00Z']){const f=fixture();await f.capture();f.t.tracks[0].r.a=900000;f.p.userRecord.profile.updatedAt=new Date(time);assert.equal((await f.capture('updated')).outcome,'timestamp_failed');}
  const f=fixture();await f.capture();f.p.userRecord.profile.updatedAt=new Date('2026-09-21T00:00:00Z');f.t.tracks[0].r.a=990000;
  assert.equal((await f.capture('updated','correction')).outcome,'needs_lower_correction');
  f.t.tracks[0].r.a=900000;assert.equal((await f.capture('updated','correction')).outcome,'needs_stable_check');
  f.t.tracks.splice(1,1);assert.equal((await f.capture('confirmed')).outcome,'snapshot_changed_again');
});
test('unmatched, excluded and empty profiles produce explicit incomplete results',async()=>{
  const a=fixture();delete a.mapping.charts['maishift:intl:1'];assert.equal((await a.capture()).outcome,'mapping_or_coverage_review');
  const b=fixture();b.t.tracks.push({s:9999,r:{a:1}});assert.equal((await b.capture()).baseline.excluded,1);
  const c=fixture();c.t.tracks=[];assert.equal((await c.capture()).outcome,'needs_played_profile');
});
test('clearing during a read aborts it and prevents late results from restoring data',async()=>{
  const f=fixture();let release;f.setFetch((url,options)=>new Promise(resolve=>{release=()=>resolve(Response.json(minimize(f.t,profile(decode(wire(f.p)),input))));assert.equal(options.signal.aborted,false);}));
  const pending=f.capture();f.pilot.clear();release();await assert.rejects(pending,/cancelled/);assert.equal(f.pilot.report().baseline,null);assert.equal(f.pilot.report().region,null);
});
test('retry timing, six-attempt bound, HTML and malformed data preserve previous evidence',async()=>{
  const f=fixture();await f.capture();f.setFetch(async()=>new Response('busy',{status:429,headers:{'Retry-After':'120'}}));
  await assert.rejects(f.capture('updated'),/cooldown/);const attempts=f.pilot.report().attempts;await assert.rejects(f.pilot.capture({phase:'updated'}),/cooldown/);assert.equal(f.pilot.report().attempts,attempts);assert.equal(f.pilot.report().baseline.played,3);
  const html=fixture();html.setFetch(async()=>new Response('<html>Login</html>',{headers:{'Content-Type':'text/html'}}));await assert.rejects(html.capture(),/invalid_response/);
  const many=fixture();await many.capture();for(let i=0;i<5;i++)await many.capture('updated');await assert.rejects(many.capture('updated'),/attempt_limit/);many.pilot.clear();await assert.rejects(many.capture(),/attempt_limit/);
});

test('oversize, malformed and wrong-identity responses never replace the baseline',async()=>{
  for(const response of [
    ()=>new Response('{"bad":true}',{headers:{'Content-Type':'application/json'}}),
    ()=>new Response(' '.repeat(4*1024*1024+1),{headers:{'Content-Type':'application/json'}}),
    f=>{const value=minimize(f.t,profile(decode(wire(f.p)),input));value.identity.handle='other-player';return Response.json(value);},
  ]){
    const f=fixture();await f.capture();const before=f.pilot.report().baseline;
    f.setFetch(async()=>response(f));await assert.rejects(f.capture('updated'),/invalid_response/);
    assert.deepEqual(f.pilot.report().baseline,before);assert.equal(f.pilot.report().updated,null);
    assert.equal(f.pilot.report().outcome,'read_failed');
  }
});

test('selected source stays fixed and version transitions are only tester-declared',async()=>{
  const f=fixture();await f.capture();f.advance();
  await f.pilot.capture({phase:'updated',value:'other-player',region:'jp',changeKind:'version'});
  assert.deepEqual(JSON.parse(f.calls[1].options.body),input);
  assert.equal(f.pilot.report().declaredChange,'version');assert.equal(f.pilot.report().versionTransition,'tester-declared');
  assert.equal(f.pilot.report().outcome,'needs_changed_upload');
});
