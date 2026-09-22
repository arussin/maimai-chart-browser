import {build} from 'esbuild';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const base=dirname(fileURLToPath(import.meta.url)), root=resolve(base,'..');
const entries=['usage','player-session','catalog-query'];
const checking=process.argv.includes('--check');
let stale=false;
const manifest={version:1,tool:'esbuild-0.28.2',assets:{}};
for(const name of entries){
  const result=await build({entryPoints:[resolve(base,'src',name+'.ts')],bundle:true,write:false,format:'iife',target:'es2022',minify:true,legalComments:'none',charset:'utf8'});
  const bytes=result.outputFiles[0].contents,path=resolve(root,'src/maimai_intelligence/assets',name+'.js');
  manifest.assets[name+'.js']={sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
  if(checking){try{if(!Buffer.from(bytes).equals(await readFile(path)))stale=true;}catch{stale=true;}}
  else {await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes);}
}
const path=resolve(base,'generated-assets.json'),body=JSON.stringify(manifest,null,2)+'\n';
if(checking){try{if(await readFile(path,'utf8')!==body)stale=true;}catch{stale=true;}if(stale)throw Error('Generated browser assets are stale; run npm run build in the approved build workspace, then explicitly promote reviewed generated files.');}
else await writeFile(path,body);
