import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {bindArtifact,distribution,verifyBytes,validateExperiment} from '../scripts/measure_architecture.mjs';
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