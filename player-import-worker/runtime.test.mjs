import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {PATH} from './index.mjs';
import {wire,publicProfile,tracks} from './fixtures.mjs';

test('real workerd starts disabled and serializes per-profile leases through SQLite storage',async()=>{
  const root=fileURLToPath(new URL('.',import.meta.url));
  const modules=['worker.mjs','index.mjs','contract.mjs','coordinator.mjs'].map(name=>({type:'ESModule',path:fileURLToPath(new URL(name,import.meta.url)),contents:readFileSync(new URL(name,import.meta.url),'utf8')}));
  const mf=new Miniflare(convertV4MiniflareOptions({modules,modulesRoot:root,compatibilityDate:'2026-09-21',
    bindings:{MAISHIFT_ENABLED:'false'},durableObjects:{PROFILE_LIMITER:{className:'ProfileLimiter',useSQLite:true}},
    outboundService:()=>{throw new Error('Unexpected external request during deterministic test');}}));
  try{
    const response=await mf.dispatchFetch('https://maimai.party'+PATH,{method:'POST',headers:{Origin:'https://maimai.party'}});
    assert.equal(response.status,503);assert.equal((await response.json()).error,'integration_disabled');
    const namespace=await mf.getDurableObjectNamespace('PROFILE_LIMITER');
    const stub=namespace.getByName('fictional-digest');
    const leases=await Promise.all([stub.claim(true),stub.claim(true),stub.claim(false)]);
    assert.equal(leases.filter(l=>l.id).length,1);const lease=leases.find(l=>l.id);
    await stub.finish(lease.id,Date.now()+120000);
    const retry=await stub.claim(true);assert.equal(retry.id,undefined);assert.ok(retry.retryAt>Date.now()+110000);
    await stub.finish('stale-lease',0);assert.ok((await stub.claim(true)).retryAt>Date.now()+110000);
    // Separate provider regions must not share identity or coordination state.
    assert.ok((await namespace.getByName('fictional-jp-digest').claim(true)).id);
  }finally{await mf.dispose();}
});

test('enabled workerd route reads only the fixed public RPCs and returns minimized data',async()=>{
  const root=fileURLToPath(new URL('.',import.meta.url));
  const modules=['worker.mjs','index.mjs','contract.mjs','coordinator.mjs'].map(name=>({type:'ESModule',path:fileURLToPath(new URL(name,import.meta.url)),contents:readFileSync(new URL(name,import.meta.url),'utf8')}));
  const values=[publicProfile(),tracks(),publicProfile()],calls=[];
  const mf=new Miniflare(convertV4MiniflareOptions({modules,modulesRoot:root,compatibilityDate:'2026-09-21',
    bindings:{MAISHIFT_ENABLED:'true'},durableObjects:{PROFILE_LIMITER:{className:'ProfileLimiter',useSQLite:true}},
    ratelimits:{CLIENT_LIMITER:{namespace_id:'1',simple:{limit:10,period:60}}},
    outboundService:request=>{calls.push(request);assert.equal(new URL(request.url).origin,'https://maimai.shiftpsh.com');return new Response(JSON.stringify(wire(values.shift())),{headers:{'Content-Type':'application/json'}});}}));
  try{
    const options={method:'POST',headers:{Origin:'https://maimai.party','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1'},body:JSON.stringify({handle:'fictional-player',region:'intl',manual:true})};
    const response=await mf.dispatchFetch('https://maimai.party'+PATH,options);const raw=await response.text();assert.equal(response.status,200,JSON.stringify({raw,calls:calls.length}));const body=JSON.parse(raw);assert.equal(body.records.length,3);assert.equal(calls.length,3);
    assert.ok(calls.every(r=>!r.headers.has('cookie')&&!r.headers.has('authorization')&&!r.headers.has('referer')));
    const duplicate=await mf.dispatchFetch('https://maimai.party'+PATH,options);assert.equal(duplicate.status,429);assert.equal(calls.length,3);
  }finally{await mf.dispose();}
});
