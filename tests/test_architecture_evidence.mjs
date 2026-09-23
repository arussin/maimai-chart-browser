import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {bindArtifact,distribution,optionalDistribution,verifyBytes,validateExperiment,observeApplicationNetwork} from '../scripts/measure_architecture.mjs';
const record=raw=>({bytes:Buffer.byteLength(raw),sha256:createHash('sha256').update(raw).digest('hex')});

test('distribution uses both central samples and rejects incomplete data',()=>{
 assert.equal(distribution([4,1,3,2]).median,2.5);
 assert.equal(distribution([4,1,3]).median,3);
 assert.throws(()=>distribution([1,NaN]),/Finite/);
});

test('all served bytes, including undeclared assets, fail closed against provenance',()=>{
 const expected={'/app.js':record('known')};
 verifyBytes('/app.js',Buffer.from('known'),expected);
 assert.throws(()=>verifyBytes('/app.js',Buffer.from('changed'),expected),/differs/);
 assert.throws(()=>verifyBytes('/unexpected.js',Buffer.from('known'),expected),/differs/);
});

test('commit labels and a matching corpus cannot substitute for artifact provenance',async()=>{
 const root=await mkdtemp(join(tmpdir(),'maimai-evidence-'));
 try{
  const directory=join(root,'build-1'),assets=join(directory,'review','planned-assets'),manifest=join(directory,'review','planned-manifest.json');
  await mkdir(assets,{recursive:true});await writeFile(manifest,'{}');
  const receipt={schema_version:'maimai-full-review-reproduction-2',passed:true,published:false,build_options:{player_maishift:false},candidate_commit:'a'.repeat(40),source:{commit:'a'.repeat(40),inventory_sha256:'b'.repeat(64)},verifier:{commit:'c'.repeat(40)},builds:[{directory,files:{'planned-manifest.json':record('{}'),'planned-assets/index.html':record('<html>')}}]};
  const provenance=join(root,'receipt.json');await writeFile(provenance,JSON.stringify(receipt));
  const config={root:resolve(assets),manifest:resolve(manifest),commit:'a'.repeat(40),provenance};
  assert.equal((await bindArtifact(config)).verifier_commit,'c'.repeat(40));
  await assert.rejects(bindArtifact({...config,commit:'d'.repeat(40)}),/commit/);
  await assert.rejects(bindArtifact({...config,root:resolve(root,'different')}),/not bound/);
  await writeFile(manifest,'{"modified":true}');
  await assert.rejects(bindArtifact(config),/differs/);
  await writeFile(manifest,'{}');receipt.passed=false;await writeFile(provenance,JSON.stringify(receipt));
  await assert.rejects(bindArtifact(config),/does not verify/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('runtime and enrichment experiments reject every confounded comparison',()=>{
 const config=(commit='a',flag=false,js='runtime')=>({commit:commit.repeat(40),binding:{build_options:{player_maishift:flag},expected:{'/app.js':record(js),'/app.css':record('style'),'/player-import-config.js':record(String(flag))}}});
 const catalogs=[{release:{sha256:'old'}},{release:{sha256:'old'}}];
 validateExperiment('runtime',[config('a'),config('b')],catalogs);
 assert.throws(()=>validateExperiment('runtime',[config('a'),config('b',true)],catalogs),/build options/);
 catalogs[1].release.sha256='enriched';
 assert.throws(()=>validateExperiment('runtime',[config('a'),config('b')],catalogs),/byte-identical/);
 validateExperiment('enrichment',[config('a'),config('a')],catalogs);
 assert.throws(()=>validateExperiment('enrichment',[config('a'),config('b')],catalogs),/same product commit/);
 assert.throws(()=>validateExperiment('enrichment',[config('a'),config('a',true)],catalogs),/build options/);
 assert.throws(()=>validateExperiment('enrichment',[config('a'),config('a',false,'different')],catalogs),/runtime assets/);
 assert.throws(()=>validateExperiment('other',[config(),config()],catalogs),/Experiment/);
});

test('performance network audit records app attempts without installing routes',()=>{
 const context=new EventEmitter(),page=new EventEmitter(),attempts=[];
 context.pages=()=>[page];
 context.route=()=>{throw Error('Performance must retain native browser caching');};
 observeApplicationNetwork(context,'http://127.0.0.1:1234',attempts);
 const request=(type,url)=>context.emit('request',{resourceType:()=>type,url:()=>url});
 request('fetch','http://127.0.0.1:1234/catalog.json');
 request('image','data:image/png;base64,fixture');
 assert.equal(attempts.length,0);
 request('fetch','https://accounts.google.com/fixture-only');
 request('document','https://redirect.example.invalid/');
 page.emit('websocket',{url:()=> 'wss://clients2.google.com/fixture-only'});
 const popup=new EventEmitter();context.emit('page',popup);
 popup.emit('websocket',{url:()=> 'wss://popup.example.invalid/'});
 assert.deepEqual(attempts.map(item=>item.target),['https://accounts.google.com','https://redirect.example.invalid','https://clients2.google.com','https://popup.example.invalid']);
});

test('unsupported historical journeys are explicit and never mixed with measurements',()=>{
 assert.deepEqual(optionalDistribution([null,null]),{status:'unsupported',n:0});
 assert.equal(optionalDistribution([12,20]).status,'measured');
 assert.equal(optionalDistribution([12,20]).median,16);
 assert.throws(()=>optionalDistribution([null,12]),/Inconsistent/);
 assert.throws(()=>optionalDistribution([12,NaN]),/Finite/);
});
