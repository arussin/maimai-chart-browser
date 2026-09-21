import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPreview} from '../scripts/serve_maishift_pilot.mjs';
import {wire,publicProfile,tracks} from './fixtures.mjs';
const origin='http://127.0.0.1:8895',input={handle:'fictional-player',region:'intl',manual:true};
const request=(body=input,headers={})=>new Request(origin+'/api/player-import/maishift',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
function setup(approved=input){let time=1e12,calls=0;const assets=new Map([['/pilot/maishift/index.html',{bytes:'fictional page',type:'text/html'}]]);
  const run=createPreview({assets,origin,approved,now:()=>time,fetcher:async(_url,options)=>{assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');return Response.json(wire(++calls%3===2?tracks():publicProfile()));}});
  return {run,advance:()=>{time+=31000;},calls:()=>calls};}
test('local preview serves the page and fails clearly when the reader is disabled',async()=>{
  const s=setup(null),page=await s.run(new Request(origin+'/pilot/maishift/'));assert.equal(page.status,200);assert.equal(page.headers.get('cache-control'),'no-store');
  assert.equal((await s.run(request())).status,503);assert.equal(s.calls(),0);
});
test('local preview rejects foreign origins, profiles, credentials, URLs and oversized bodies before fetching',async()=>{
  const s=setup();for(const req of [request(input,{Origin:'https://unrelated.example'}),request(input,{Cookie:'private'}),request(input,{Referer:origin}),request({...input,handle:'other-player'}),request({...input,region:'jp'}),request({...input,url:'https://unrelated.example'}),request({text:'x'.repeat(2049)}),new Request(origin+'/api/player-import/maishift?handle=someone')])assert.ok((await s.run(req)).status>=400);
  assert.equal(s.calls(),0);
});
test('local preview uses the real contract with six reads and shared cooldown across tabs',async()=>{
  const s=setup();for(let i=0;i<6;i++){const response=await s.run(request());assert.equal(response.status,200);assert.equal((await response.json()).records.length,3);assert.equal((await s.run(request())).status,429);s.advance();}
  assert.equal((await s.run(request())).status,429);assert.equal(s.calls(),18);
});
test('local preview respects upstream retry timing and keeps response failures sanitized',async()=>{
  let calls=0;const run=createPreview({assets:new Map(),origin,approved:input,fetcher:async()=>{calls++;return new Response('private source details',{status:429,headers:{'Retry-After':'120'}});}});
  const failed=await run(request());assert.equal(failed.status,503);assert.ok(Number(failed.headers.get('Retry-After'))>=119);assert.ok(!(await failed.text()).includes('private'));
  assert.equal((await run(request())).status,429);assert.equal(calls,1);
});
