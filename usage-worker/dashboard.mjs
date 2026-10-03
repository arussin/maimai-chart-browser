/** Render a self-contained private dashboard; no network, server or credentials. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {makeDashboardData} from './dashboard-model.mjs';
export const safeJSON = value => JSON.stringify(value).replaceAll('<','\\u003c').replaceAll('>','\\u003e').replaceAll('&','\\u0026').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029');
const hash = text => createHash('sha256').update(text).digest('base64');
export async function renderDashboard(input, options) {
  const data=makeDashboardData(input,options);
  const [template,script,style]=await Promise.all(['dashboard.html','dashboard-client.js','dashboard.css'].map(name=>readFile(new URL(name,import.meta.url),'utf8')));
  const csp="default-src 'none'; connect-src 'none'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; script-src 'sha256-"+hash(script)+"'; style-src 'sha256-"+hash(style)+"'";
  return template.replace('__CSP__',csp).replace('__STYLE__',()=>style).replace('__DATA__',()=>safeJSON(data)).replace('__SCRIPT__',()=>script);
}
async function main(){
  const args=process.argv.slice(2), allowed=['--input','--output','--captured-at'];
  if(args.length!==6 || args.some((arg,i)=>i%2===0&&!allowed.includes(arg)) || new Set(args.filter((_,i)=>i%2===0)).size!==3) throw Error('Use --input EXPORT.json --output PRIVATE.html --captured-at ISO_TIMESTAMP');
  const value=key=>args[args.indexOf(key)+1];
  if(!value('--output').endsWith('.html'))throw Error('Output must be a private .html file.');
  const input=JSON.parse(await readFile(value('--input'),'utf8'));
  const html=await renderDashboard(input,{capturedAt:value('--captured-at')});
  await writeFile(value('--output'),html,'utf8');
  console.log(JSON.stringify({status:'private_dashboard_written',output:value('--output'),cloud_mutations:0}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error('Dashboard failed: '+error.message);process.exitCode=1;});
