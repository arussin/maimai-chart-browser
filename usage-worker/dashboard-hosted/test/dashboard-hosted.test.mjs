import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {generateKeyPair,exportJWK,SignJWT,createLocalJWKSet} from 'jose';
import {createAccessVerifier} from '../access.mjs';
import {createHandler,QUERIES} from '../handler.mjs';
import {renderHosted} from '../render.mjs';
const issuer='https://fixture.cloudflareaccess.com',aud='a'.repeat(64),owner='owner@example.test';
const env={ACCESS_ISSUER:issuer,ACCESS_AUD:aud,OWNER_EMAIL:owner};
const pair=await generateKeyPair('RS256');
const jwk=await exportJWK(pair.publicKey);jwk.kid='fixture';
const verify=createAccessVerifier({keysForIssuer:()=>createLocalJWKSet({keys:[jwk]})});
async function token(options={}){
 const claims={email:owner,...options.claims};
 return new SignJWT(claims).setProtectedHeader({alg:'RS256',kid:'fixture'}).setIssuer(options.issuer??issuer)
   .setAudience(options.aud??aud).setSubject('fictional-owner').setIssuedAt()
   .setExpirationTime(options.exp??'5m').sign(pair.privateKey);
}
const request=(t,url='https://adamrussin.com/maimai-dash',method='GET')=>new Request(url,{method,headers:t?{'cf-access-jwt-assertion':t}:{}});
test('cryptographically verifies the exact owner, issuer and audience',async()=>{
 assert.equal(await verify(request(await token()),env),true);
 for(const options of [{aud:'b'.repeat(64)},{issuer:'https://other.cloudflareaccess.com'},{claims:{email:'other@example.test'}},{exp:Math.floor(Date.now()/1000)-60},{claims:{email:null}}])
   assert.equal(await verify(request(await token(options)),env),false);
});
test('fails closed for absent/malformed/forged tokens and incomplete config',async()=>{
 assert.equal(await verify(request(),env),false);
 assert.equal(await verify(request('not-a-token'),env),false);
 const t=await token(),parts=t.split('.');parts[1]=Buffer.from(JSON.stringify({email:owner,exp:9999999999})).toString('base64url');
 assert.equal(await verify(request(parts.join('.')),env),false);
 assert.equal(await verify(request(t),{...env,ACCESS_AUD:''}),false);
 assert.equal(await verify(request(t),{...env,ACCESS_ISSUER:'https://evil.example'}),false);
 assert.equal(await verify(request(t),{...env,OWNER_EMAIL:''}),false);
});
test('rejects unsigned tokens, service tokens without email and unavailable signing keys',async()=>{
 const unsigned=Buffer.from('{"alg":"none"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({email:owner,iss:issuer,aud,exp:9999999999})).toString('base64url')+'.';
 assert.equal(await verify(request(unsigned),env),false);
 const unavailable=createAccessVerifier({keysForIssuer:()=>{throw Error('unavailable')}});
 assert.equal(await unavailable(request(await token()),env),false);
});
function dbFixture(){
 let count=0;const statements=[];
 return {get reads(){return count},statements,
  prepare(sql){statements.push(sql);return {sql}},
  async batch(){count++;return [{success:true,results:[{day:'2026-10-03',version:1,event:'page_view',page:'charts',detail:'',failure:'',count}]},{success:true,results:[]}]},
 };
}
const assets={
 template:await readFile(new URL('../../dashboard.html',import.meta.url),'utf8'),
 script:await readFile(new URL('../../dashboard-client.js',import.meta.url),'utf8'),
 style:await readFile(new URL('../../dashboard.css',import.meta.url),'utf8'),
};
const render=(data,at)=>renderHosted(data,at,assets);
test('signed-out and wrong-owner requests never touch the database',async()=>{
 const db=dbFixture(),handler=createHandler({authenticate:verify,render});
 assert.equal((await handler.fetch(request(),{...env,USAGE_DB:db})).status,403);
 assert.equal((await handler.fetch(request(await token({claims:{email:'other@example.test'}})),{...env,USAGE_DB:db})).status,403);
 assert.equal(db.reads,0);assert.equal(db.statements.length,0);
});
test('each authenticated page load queries fresh counters with fixed SELECT statements',async()=>{
 const db=dbFixture(),handler=createHandler({authenticate:verify,render}),t=await token();
 const a=await handler.fetch(request(t),{...env,USAGE_DB:db});
 const b=await handler.fetch(request(t),{...env,USAGE_DB:db});
 assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(db.reads,2);
 assert.deepEqual(db.statements,[...QUERIES,...QUERIES]);
 assert.match(await a.text(),/"count":1/);assert.match(await b.text(),/"count":2/);
});
test('all responses deny indexing and caching; successful HTML has restrictive CSP',async()=>{
 const handler=createHandler({authenticate:verify,render}),db=dbFixture();
 for(const req of [request(),request(await token())]){
  const r=await handler.fetch(req,{...env,USAGE_DB:db});
  assert.match(r.headers.get('cache-control'),/no-store/);
  assert.equal(r.headers.get('x-robots-tag'),'noindex, nofollow, noarchive');
  assert.equal(r.headers.get('x-frame-options'),'DENY');
  assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.equal(r.headers.get('access-control-allow-origin'),null);
 }
});
test('wrong host, extra path, query strings and write methods cannot query data',async()=>{
 const db=dbFixture(),handler=createHandler({authenticate:verify,render}),t=await token();
 for(const [url,method,status] of [
  ['https://evil.example/maimai-dash','GET',404],
  ['https://adamrussin.com/maimai','GET',404],
  ['https://adamrussin.com/maimai-dash/api','GET',404],
  ['https://adamrussin.com/maimai-dash?sql=DROP','GET',400],
  ['https://adamrussin.com/maimai-dash','POST',405],
  ['https://adamrussin.com/maimai-dash','OPTIONS',405],
 ]){
  assert.equal((await handler.fetch(request(t,url,method),{...env,USAGE_DB:db})).status,status);
 }
 assert.equal(db.reads,0);assert.equal(db.statements.length,0);
});
test('authenticated HEAD has no data and no query; trailing slash is supported',async()=>{
 const db=dbFixture(),handler=createHandler({authenticate:verify,render}),t=await token();
 const head=await handler.fetch(request(t,undefined,'HEAD'),{...env,USAGE_DB:db});
 assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(db.reads,0);
 assert.equal((await handler.fetch(request(t,'https://adamrussin.com/maimai-dash/'),{...env,USAGE_DB:db})).status,200);
});
test('failed, malformed or truncated data never renders an apparently empty successful dashboard',async()=>{
 const t=await token(),handler=createHandler({authenticate:verify,render});
 for(const response of [
  [{success:false,results:[]},{success:true,results:[]}],
  [{success:true,results:[{secret:'never-render-this'}]},{success:true,results:[]}],
  [{success:true,results:Array(50001).fill({})},{success:true,results:[]}],
  [],
 ]){
  const r=await handler.fetch(request(t),{...env,USAGE_DB:{prepare:sql=>({sql}),batch:async()=>response}});
  assert.equal(r.status,503);const body=await r.text();assert.match(body,/missing data is not zero/);assert.doesNotMatch(body,/never-render-this/);
 }
});
test('hosted renderer reuses dashboard controls, explains fresh-on-load and retains unknown coverage',async()=>{
 const r=await render({schema_version:'usage-export-1',query_status:'ok',activation:'2026-10-03',totals:[],coverage:[]},new Date().toISOString());
 assert.match(r.html,/Authenticated private dashboard/);assert.match(r.html,/Refresh latest data/);
 assert.match(r.html,/Each page load queries the latest aggregate/);
 assert.doesNotMatch(r.html,/Use your local refresh command/);
 assert.match(r.csp,/connect-src 'none'/);assert.match(r.csp,/script-src 'sha256-/);
 assert.match(r.html,/"coverage":\[\]/);
 for(const placeholder of ['__CSP__','__STYLE__','__DATA__','__SCRIPT__']) assert(!r.html.includes(placeholder));
});
