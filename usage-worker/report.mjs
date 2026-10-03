/** Owner-run report over an explicit aggregate export. Never queries a public endpoint. */
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {validateRow} from './worker.mjs';
export const zone='America/New_York';
const dayFormat=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'});
export const dayKey=date=>dayFormat.format(date);
const validDay=day=>typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day+'T00:00:00Z'))&&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day;
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const validVersion=version=>Number.isSafeInteger(version)&&version>=1;
const tuple=row=>JSON.stringify([row.day,row.version,row.event,row.page,row.detail,row.failure]);
export function addDay(day,n){return new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);}
export function startUTC(day){
 if(!validDay(day))throw Error('Invalid report day');
 let low=Date.parse(day+'T00:00:00Z')-86400000,high=low+3*86400000;
 while(high-low>60000){const middle=Math.floor((low+high)/120000)*60000;if(dayKey(new Date(middle))<day)low=middle;else high=middle;}
 return new Date(high).toISOString();
}
export function summarize(input,{from,to,now=new Date()}={}){
 if(!input||input.schema_version!=='usage-export-1'||!Array.isArray(input.totals)||!Array.isArray(input.coverage)||input.query_status!=='ok')throw Error('Missing or failed aggregate query; counts are unknown.');
 to??=addDay(dayKey(now),-1);from??=addDay(to,-29);
 if(!validDay(from)||!validDay(to)||from>to||to>=dayKey(now))throw Error('Choose a valid range of completed New York days.');
 const days=[];for(let d=from;d<=to;d=addDay(d,1)){if(days.length>=3660)throw Error('Report range exceeds 10 years');days.push(d);}
 const totalKeys=new Set();
 const totals=input.totals.map(r=>{
  if(!record(r)||!validDay(r.day)||!validVersion(r.version)||!Number.isSafeInteger(r.count)||r.count<0)throw Error('Invalid aggregate row');
  const safe=validateRow({event:r.event,page:r.page,detail:r.detail,failure:r.failure,count:1});
  if(!safe)throw Error('Invalid aggregate row');
  const row={day:r.day,version:r.version,event:safe.event,page:safe.page,detail:safe.detail,failure:safe.failure,count:r.count},key=tuple(row);
  if(totalKeys.has(key))throw Error('Duplicate aggregate row');
  totalKeys.add(key);return row;
 }).filter(r=>r.day>=from&&r.day<=to);
 const ledgerKeys=new Set();
 const ledger=input.coverage.map(r=>{
  if(!record(r)||Object.keys(r).sort().join(',')!=='day,status,version'||!validDay(r.day)||!validVersion(r.version)||
    !['complete','partial','off','unknown'].includes(r.status))throw Error('Invalid coverage row');
  const key=JSON.stringify([r.day,r.version]);if(ledgerKeys.has(key))throw Error('Conflicting coverage ledger');
  ledgerKeys.add(key);return {day:r.day,version:r.version,status:r.status};
 }).filter(r=>r.day>=from&&r.day<=to);
 if(input.activation!==undefined&&input.activation!==null&&!validDay(input.activation))throw Error('Invalid activation day');
 totals.sort((a,b)=>tuple(a).localeCompare(tuple(b)));
 const versions=[...new Set([...totals,...ledger].map(r=>r.version))].sort((a,b)=>a-b);
 const coverage=days.flatMap(day=>versions.length?versions.map(version=>{
  const entries=ledger.filter(r=>r.day===day&&r.version===version);
  if(entries.length>1)throw Error('Conflicting coverage ledger');
  const status=entries[0]?.status??'unknown';
  if(!['complete','partial','off','unknown'].includes(status))throw Error('Invalid coverage state');
  return {day,version,status,count:totals.filter(r=>r.day===day&&r.version===version).reduce((n,r)=>n+r.count,0),zero_is_measured:status==='complete'};
 }):[{day,version:null,status:'unknown',count:0,zero_is_measured:false}]);
 return {schema_version:'usage-report-1',timezone:zone,from,to,utc_start:startUTC(from),utc_end_exclusive:startUTC(addDay(to,1)),activation:input.activation??null,coverage,totals,
  limitations:['Counts describe actions, not unique people or sessions.','No funnels, visitor sources, owner exclusion or retention are available.','Opt-outs, blocked requests and dropped batches are not measurable.','Only days marked complete distinguish measured zero from unknown coverage.']};
}
export function queryDatabase(database,{remote=false,persistTo,activation=null,from,to,now=new Date(),run=spawnSync}={}){
 if(!/^[a-zA-Z0-9_-]{1,80}$/.test(database))throw Error('Invalid database name');
 const cli=fileURLToPath(new URL('./node_modules/wrangler/bin/wrangler.js',import.meta.url));
 to??=addDay(dayKey(now),-1);from??=addDay(to,-29);
 if(!validDay(from)||!validDay(to)||from>to||to>=dayKey(now))throw Error('Choose completed New York days');
 const where=" WHERE day>='"+from+"' AND day<='"+to+"'";
 const sql='SELECT day,version,event,page,detail,failure,count FROM usage_daily'+where+'; SELECT day,version,status FROM usage_coverage'+where+';';
 const args=[cli,'d1','execute',database,remote?'--remote':'--local','--json','--command',sql];
 if(persistTo&&!remote)args.push('--persist-to',persistTo);
 const result=run(process.execPath,args,{encoding:'utf8',maxBuffer:32*1024*1024,env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
 if(result.status!==0)throw Error('Aggregate query failed');
 const parsed=JSON.parse(result.stdout);
 if(!Array.isArray(parsed)||parsed.length!==2||parsed.some(r=>r.success!==true||!Array.isArray(r.results)))throw Error('Aggregate query incomplete');
 if(activation!==null&&!validDay(activation))throw Error('Invalid activation day');
 return {schema_version:'usage-export-1',query_status:'ok',activation,totals:parsed[0].results,coverage:parsed[1].results};
}
export function markdown(report){
 return ['# maimai.party usage totals','',report.from+' through '+report.to+' ('+zone+')',
  'Activation: '+(report.activation??'unknown'),
  'UTC interval: '+report.utc_start+' to '+report.utc_end_exclusive+' (exclusive)','',
  '| Day | Instrumentation | Coverage | Count |','|---|---:|---|---:|',
  ...report.coverage.map(r=>'| '+r.day+' | '+(r.version??'unknown')+' | '+r.status+' | '+(r.count||r.zero_is_measured?r.count:'unknown')+' |'),'',
  '| Day | Instrumentation | Event | Page | Detail | Failure | Count |','|---|---:|---|---|---|---|---:|',
  ...report.totals.map(r=>'| '+[r.day,r.version,r.event,r.page,r.detail||'—',r.failure||'—',r.count].join(' | ')+' |'),'',
  ...report.limitations.map(s=>'- '+s),''].join('\n');
}
export function csv(report){const keys=['day','version','event','page','detail','failure','count'];return [keys.join(','),...report.totals.map(r=>keys.map(k=>JSON.stringify(r[k]??'')).join(','))].join('\n')+'\n';}
export function coverageCSV(report){
 const keys=['day','version','coverage','received_count','zero_is_measurable','utc_start','utc_end_exclusive','activation'];
 return [keys.join(','),...report.coverage.map(r=>[r.day,r.version??'unknown',r.status,
  r.count||r.zero_is_measured?r.count:'unknown',r.zero_is_measured,startUTC(r.day),startUTC(addDay(r.day,1)),report.activation??'unknown']
  .map(value=>JSON.stringify(value)).join(','))].join('\n')+'\n';
}
async function main(){
 const args=process.argv.slice(2),value=key=>args[args.indexOf(key)+1];
 if(args.includes('--input')===args.includes('--database')||!args.includes('--output'))throw Error('Specify exactly one --input or --database, and --output.');
 const input=args.includes('--input')?JSON.parse(await readFile(value('--input'),'utf8')):queryDatabase(value('--database'),{
   remote:args.includes('--remote'),persistTo:args.includes('--persist-to')?value('--persist-to'):undefined,activation:args.includes('--activated')?value('--activated'):null,from:args.includes('--from')?value('--from'):undefined,to:args.includes('--to')?value('--to'):undefined});
 const report=summarize(input,{from:args.includes('--from')?value('--from'):undefined,to:args.includes('--to')?value('--to'):undefined});
 const prefix=value('--output');await writeFile(prefix+'.json',JSON.stringify(report,null,2)+'\n');await writeFile(prefix+'.md',markdown(report));await writeFile(prefix+'.csv',csv(report));await writeFile(prefix+'.coverage.csv',coverageCSV(report));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{process.stderr.write('Usage report failed; no complete report is available. Check the explicit input, completed-day range and output directory.\n');process.exitCode=1;});
