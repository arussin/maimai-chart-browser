import {pathToFileURL,fileURLToPath} from 'node:url';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
const args=process.argv.slice(2);
if(args.length!==2 || args[0]!=='--output') throw Error('Use --output ABSOLUTE_OUTPUT.mjs outside source.');
const output=resolve(args[1]);
const root=fileURLToPath(new URL('../../',import.meta.url));
if(output.startsWith(root)) throw Error('Build output must be outside the source repository.');
const esbuildPath=process.env.MAIMAI_ESBUILD_MODULE || fileURLToPath(new URL('../../web/node_modules/esbuild/lib/main.js',import.meta.url));
const {build}=await import(pathToFileURL(esbuildPath));
await mkdir(dirname(output),{recursive:true});
await build({entryPoints:[fileURLToPath(new URL('entry.mjs',import.meta.url))],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:output,
  loader:{'.html':'text','.css':'text'}, plugins:[{name:'shared-dashboard-script',setup(b){
    b.onResolve({filter:/dashboard-client\.js\.txt$/},a=>({path:resolve(a.resolveDir,a.path.replace(/\.txt$/, '')),namespace:'dashboard-script'}));
    b.onLoad({filter:/.*/,namespace:'dashboard-script'},async a=>({contents:await readFile(a.path,'utf8'),loader:'text'}));
  }}]});
console.log(JSON.stringify({status:'private_dashboard_built',output,cloud_mutations:0}));
