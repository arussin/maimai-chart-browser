import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {OAUTH_PREFIX,PROVIDERS} from './provider-oauth.mjs';
import {CONNECTOR_FLAGS_KEY,parseConnectorFlags} from './connector-flags.mjs';

test('public connector flags read real KV and change without restarting the Worker',async()=>{
  const root=fileURLToPath(new URL('.',import.meta.url));
  const names=['provider-oauth-worker.mjs','provider-oauth.mjs','provider-oauth-session.mjs','provider-oauth-session-core.mjs','connector-flags.mjs'];
  const modules=names.map(name=>({type:'ESModule',path:fileURLToPath(new URL(name,import.meta.url)),contents:readFileSync(new URL(name,import.meta.url),'utf8')}));
  const mf=new Miniflare(convertV4MiniflareOptions({modules,modulesRoot:root,compatibilityDate:'2026-09-21',
    kvNamespaces:['IMPORT_CONNECTOR_FLAGS'],
    outboundService:()=>{throw Error('Flags must never contact an upstream provider');}}));
  try {
    const call=()=>mf.dispatchFetch('https://maimai.party'+OAUTH_PREFIX+'/connectors');
    assert.equal((await call()).status,503);
    const kv=await mf.getKVNamespace('IMPORT_CONNECTOR_FLAGS');
    const value=JSON.stringify({schemaVersion:1,methods:{file:true,'file:tomomai':true}});
    await kv.put(CONNECTOR_FLAGS_KEY,value);
    const response=await call();
    assert.equal(response.status,200);assert.deepEqual(await response.json(),parseConnectorFlags(value));
    assert.match(response.headers.get('Cache-Control'),/no-store/);assert.equal(response.headers.has('Set-Cookie'),false);
    await kv.put(CONNECTOR_FLAGS_KEY,JSON.stringify({schemaVersion:1,methods:{file:true}}));
    assert.equal((await(await call()).json()).methods['file:tomomai'],false);
    await kv.put(CONNECTOR_FLAGS_KEY,'invalid fixture');
    const invalid=await call();assert.equal(invalid.status,503);assert.deepEqual(await invalid.json(),{error:'connectors_unavailable'});
  } finally { await mf.dispose(); }
});

for (const provider of ['diving-fish','lxns']) test(provider + ' OAuth standalone workerd uses SQLite session binding, fixed upstreams and conditional logout',async()=>{
  const root=fileURLToPath(new URL('.',import.meta.url));
  const names=['provider-oauth-worker.mjs','provider-oauth.mjs','provider-oauth-session.mjs','provider-oauth-session-core.mjs','connector-flags.mjs'];
  const modules=names.map(name=>({type:'ESModule',path:fileURLToPath(new URL(name,import.meta.url)),contents:readFileSync(new URL(name,import.meta.url),'utf8')}));
  const calls=[];
  const mf=new Miniflare(convertV4MiniflareOptions({modules,modulesRoot:root,compatibilityDate:'2026-09-21',
    bindings:{PROVIDER_OAUTH_ENABLED:'true',DIVING_FISH_OAUTH_ENABLED:'true',LXNS_OAUTH_ENABLED:'true',
      DIVING_FISH_OAUTH_CLIENT_ID:'fictional-client',DIVING_FISH_OAUTH_CLIENT_SECRET:'fictional-secret',
      LXNS_OAUTH_CLIENT_ID:'fictional-client',LXNS_OAUTH_CLIENT_SECRET:'fictional-secret',PROVIDER_OAUTH_ENCRYPTION_KEY:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'},
    durableObjects:{PROVIDER_OAUTH_SESSIONS:{className:'ProviderOAuthSession',useSQLite:true}},
    ratelimits:{PROVIDER_OAUTH_LIMITER:{namespace_id:'2',simple:{limit:60,period:60}}},
    outboundService:async request=>{
      calls.push({url:request.url,body:request.method==='POST'?await request.text():null,headers:request.headers});
      let value;
      const p=PROVIDERS[provider];
      if(request.url===p.discovery)value={issuer:p.issuer,authorization_endpoint:p.authorize,token_endpoint:p.token,userinfo_endpoint:p.userinfo,revocation_endpoint:p.revoke,code_challenge_methods_supported:['S256']};
      else if(request.url===p.token)value={access_token:'fictional-access',refresh_token:'fictional-refresh',token_type:'Bearer',expires_in:900,scope:p.scopes.join(' ')};
      else if(request.url===p.userinfo)value={sub:'fictional-subject',name:'Fictional player'};
      else if(request.url===p.player)value={success:true,code:200,data:{name:'Fictional player',friend_code:123456}};
      else if(request.url===p.records)value=provider==='diving-fish'?{nickname:'Fictional player',records:[{song_id:1,title:'Fictional song',type:'DX',level_index:3,achievements:100,dxScore:1000}]}:{success:true,code:200,data:[{id:1,song_name:'Fictional song',type:'dx',level_index:3,achievements:100,dx_score:1000,dx_rating:300.9}]};
      else if(request.url===p.best50)value=provider==='diving-fish'?{charts:{sd:[{song_id:1,title:'Fictional song',type:'DX',level_index:3,achievements:100,dxScore:1000,ra:300}],dx:[]}}:{success:true,code:200,data:{standard:[{id:1,song_name:'Fictional song',type:'dx',level_index:3,achievements:100,dx_score:1000,dx_rating:300.9}],dx:[]}};
      else if(request.url===p.revoke)return new Response(null,{status:200});
      else throw Error('unexpected network request in deterministic fixture');
      return new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
    }}));
  try{
    let cookie='';
    const call=async(path,input={},method='POST')=>{
      const r=await mf.dispatchFetch('https://maimai.party'+OAUTH_PREFIX+path,{method,headers:{Origin:'https://maimai.party','Content-Type':'application/json','X-Party-Import':'1','CF-Connecting-IP':'192.0.2.2',...(cookie?{Cookie:cookie}:{})},...(method==='POST'?{body:JSON.stringify(input)}:{})});
      if(r.headers.has('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return r;
    };
    const capabilities=await(await call('/capabilities',{},'GET')).json();assert.deepEqual(capabilities.providers,{'diving-fish':{enabled:true},lxns:{enabled:true}});
    assert.equal((await call('/aqua/start',{nonce:crypto.randomUUID()})).status,404);
    const prefix='/' + provider;
    const nonce=crypto.randomUUID(),start=await call(prefix+'/start',{nonce,...(provider==='diving-fish'?{maskingDisabled:true}:{})});assert.equal(start.status,200);const url=new URL((await start.json()).authorizationURL);
    const cb=await call(prefix+'/callback?state='+url.searchParams.get('state')+'&code=fictional-code',{},'GET');assert.match(await cb.text(),/"status":"connected"/);
    const status=await(await call('/status')).json(),c=status.connections[0];assert.equal(c.flowNonce,nonce);assert.equal(c.accountID.length,64);
    const data=await(await call(prefix+'/read',{connectionID:c.connectionID})).json(),records=provider==='diving-fish'?data.data.records:data.data.data;assert.equal(records[0].achievements,100);assert.equal(records.length,1);
    assert.deepEqual(data.warnings,provider==='diving-fish'?['fish_masking_unverified']:[]);
    assert.equal(data.data.best50.old.length,1);assert.equal(data.data.best50.new.length,0);
    assert.equal(calls.find(c=>c.url===PROVIDERS[provider].best50).body,provider==='diving-fish'?'{"b50":true}':null);
    assert.equal(calls.length,5);assert.ok(calls.every(c=>!c.headers.has('cookie')));assert.equal(new URLSearchParams(calls.find(c=>c.url===PROVIDERS[provider].token).body).get('client_secret'),'fictional-secret');
    assert.equal((await call(prefix+'/read',{connectionID:c.connectionID})).status,429);
    const disconnected=await call(prefix+'/disconnect',{connectionID:c.connectionID});assert.equal(disconnected.status,200);assert.equal((await disconnected.json()).revocation,provider==='diving-fish'?'requested':'unavailable');assert.deepEqual((await(await call('/status')).json()).connections,[]);
  }finally{await mf.dispose();}
});
