import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const badge=fileURLToPath(new URL('../',import.meta.url));
const script=fileURLToPath(new URL('../tools/check-policy-sync.mjs',import.meta.url));
const names=['traffic-policy.mjs','traffic-networks.mjs'];
const run=source=>spawnSync(process.execPath,[script,source],{cwd:badge,encoding:'utf8'});
test('policy guard rejects its own real directory, including a relative alias',()=>{
 for(const source of [badge,'.',join(badge,'tools','..')])assert.notEqual(run(source).status,0);
});
test('policy guard accepts equal bytes and rejects differences, missing files and copied badges',async()=>{
 const root=await mkdtemp(join(tmpdir(),'badge-policy-test-'));
 try{
  for(const scenario of ['match','diff','missing','badge-copy']){
   const dir=join(root,scenario);await mkdir(dir);
   for(const name of names){
    if(scenario==='missing'&&name===names[1])continue;
    const bytes=await readFile(new URL('../'+name,import.meta.url));
    await writeFile(join(dir,name),scenario==='diff'&&name===names[1]?Buffer.concat([bytes,Buffer.from(' ')]):bytes);
   }
   if(scenario==='badge-copy')await writeFile(join(dir,'render.mjs'),'// copied badge marker');
   const result=run(dir);assert.equal(result.status,scenario==='match'?0:1,scenario+': '+result.stderr);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
