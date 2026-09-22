import {build} from 'esbuild';
import {readFile,writeFile,mkdir,readdir,unlink} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const base=dirname(fileURLToPath(import.meta.url)),root=resolve(base,'..'),assets=resolve(root,'src/maimai_intelligence/assets');
const checking=process.argv.includes('--check');let stale=false;
const common={bundle:true,write:false,target:'es2022',minify:true,legalComments:'none',charset:'utf8'};
const digest=bytes=>({sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
async function output(path,bytes){if(checking){try{if(!Buffer.from(bytes).equals(await readFile(path)))stale=true;}catch{stale=true;}}else{await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes);}}
const compatibility={version:1,tool:'esbuild-0.28.2',assets:{}};
for(const name of ['localization','song-search','support-config','support-client','support-stripe','settings-menu','player-data-core','player-maishift','chart-visuals','challenge-matching','chart-overview','analytics']){
 const result=await build({...common,entryPoints:[resolve(base,'src/compat',name+'.ts')],format:'iife'});
 const bytes=result.outputFiles[0].contents;compatibility.assets[name+'.js']=digest(bytes);await output(resolve(assets,name+'.js'),bytes);
}
await output(resolve(base,'generated-assets.json'),JSON.stringify(compatibility,null,2)+'\n');
const manifest={version:1,tool:'esbuild-0.28.2',entries:{hosted:'browser/browser-entry.js',offline:'browser/browser-offline.js'},assets:{},replaces:['settings-menu.js', 'player-import-config.js', 'player-ranges.js', 'player-data-core.js', 'player-maishift.js', 'player-sources.js', 'player-storage.js', 'player-session.js', 'player-data.js', 'usage.js', 'seo-navigation.js', 'feature-announcements.js', 'analytics.js', 'catalog-query.js', 'view-navigation.js', 'challenge-review.js', 'lab-loader.js']};
const hosted=await build({...common,entryPoints:[resolve(base,'src/browser-entry.ts')],format:'esm',splitting:true,outdir:resolve(assets,'browser'),chunkNames:'[name]-[hash]',metafile:true});
const offline=await build({...common,entryPoints:[resolve(base,'src/browser-offline.ts')],format:'iife',outfile:resolve(assets,'browser/browser-offline.js')});
for(const file of [...hosted.outputFiles,...offline.outputFiles]){const path=relative(assets,file.path).replaceAll('\\','/');manifest.assets[path]=digest(file.contents);await output(file.path,file.contents);}
// This directory is generated exclusively by this build. Reject or prune stale JS chunks.
const generatedRoot=resolve(assets,'browser');
for(const name of await readdir(generatedRoot,{recursive:true}).catch(()=>[])){
 const path=resolve(generatedRoot,name);
 if(!path.startsWith(generatedRoot+'/')&&!path.startsWith(generatedRoot+'\\'))throw Error('Invalid generated output path');
 if(!name.endsWith('.js')||manifest.assets['browser/'+name.replaceAll('\\','/')])continue;
 if(checking)stale=true;else await unlink(path);
}
await output(resolve(assets,'browser-assets.json'),JSON.stringify(manifest,null,2)+'\n');
if(stale)throw Error('Generated browser assets are stale; build in the approved workspace, then promote reviewed generated files.');
