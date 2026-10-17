/** Optional read-only dependency reuse for bounded DevCache validation. No links or installs. */
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const manifest=JSON.parse(readFileSync(process.env.MAIMAI_VALIDATION_DEPENDENCIES,'utf8'));
const resolvers=Object.entries(manifest).sort(([a],[b])=>b.length-a.length).map(([name,path])=>[name,pathToFileURL(path+'/package.json').href]);
registerHooks({resolve(specifier,context,next){
  try{return next(specifier,context);}catch(error){
    if(!['ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND'].includes(error.code)||specifier.startsWith('.')||specifier.includes(':')||specifier.startsWith('/'))throw error;
    const selected=resolvers.find(([name])=>context.parentURL?.includes('/'+name+'/'))??resolvers[0];
    try{return next(specifier,{...context,parentURL:selected[1]});}catch{throw error;}
  }
}});
