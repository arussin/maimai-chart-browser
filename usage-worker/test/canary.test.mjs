import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runCanary} from '../tools/canary.mjs';
import {validateBatch} from '../../web/src/usage-contract.ts';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('owner canary sends exactly one valid anonymous request and requires all receipt conditions',async()=>{
 for(const [status,headers,success] of [
  [204,{'X-Maimai-Usage-Receipt':'stored'},true],
  [204,{},false],[200,{'X-Maimai-Usage-Receipt':'stored'},false],
  [204,{'X-Maimai-Usage-Receipt':'stored','X-Maimai-Usage-Limiter':'unavailable'},false],
  [429,{},false],[503,{'X-Maimai-Usage-Limiter':'unavailable'},false],
 ]){
  let calls=0;
  const result=runCanary('https://canary.invalid/__usage',async(url,options)=>{
   calls++;assert.equal(url,'https://canary.invalid/__usage');assert.equal(options.method,'POST');
   assert.equal(options.headers.Origin,'https://canary.invalid');assert.equal(options.headers['Content-Type'],'application/json');
   assert.deepEqual(Object.keys(options.headers).sort(),['Content-Type','Origin']);
   assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');
   assert.ok(validateBatch(JSON.parse(options.body)));assert.equal(JSON.parse(options.body).events[0].count,1);
   return new Response(null,{status,headers});
  });
  if(success)await result;else await assert.rejects(result);
  assert.equal(calls,1);
 }
});
test('canary validates the endpoint before sending and never retries a failed transport',async()=>{
 for(const url of ['', 'https://user:password@canary.invalid/__usage','https://canary.invalid/','https://canary.invalid/__usage?q=1','https://canary.invalid/__usage#fragment','ftp://canary.invalid/__usage']){
  let calls=0;await assert.rejects(runCanary(url,async()=>{calls++;throw Error('must not send');}));assert.equal(calls,0);
 }
 let calls=0;await assert.rejects(runCanary('https://canary.invalid/__usage',async()=>{calls++;throw Error('offline');}));assert.equal(calls,1);
});
test('rollout documentation requires the binding in deployed Wrangler configuration and an owner canary',async()=>{
 const readme=await readFile(new URL('../README.md',import.meta.url),'utf8');
 assert.match(readme,/dashboard-only binding[^.]*removed/i);
 assert.match(readme,/deployed Wrangler configuration/);
 assert.match(readme,/node tools\/canary\.mjs/);
});
test('canary CLI exit code gates rollout without echoing private errors or making network requests',()=>{
 const script=fileURLToPath(new URL('../tools/canary.mjs',import.meta.url));
 for(const [fixture,status] of [
  ["new Response(null,{status:204,headers:{'X-Maimai-Usage-Receipt':'stored'}})",0],
  ['new Response(null,{status:204})',1],
  ["new Response(null,{status:204,headers:{'X-Maimai-Usage-Receipt':'stored','X-Maimai-Usage-Limiter':'unavailable'}})",1],
  ["Promise.reject(Error('PRIVATE-SENTINEL'))",1],
 ]){
  const preload='data:text/javascript,'+encodeURIComponent('globalThis.fetch=async()=>'+fixture+';');
  const result=spawnSync(process.execPath,['--import',preload,script,'https://canary.invalid/__usage'],{encoding:'utf8'});
  assert.equal(result.status,status,result.stderr);assert.doesNotMatch(result.stdout+result.stderr,/PRIVATE-SENTINEL|canary\.invalid/);
 }
});
