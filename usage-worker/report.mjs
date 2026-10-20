/** Owner-run report over an explicit aggregate export. Never queries a public endpoint. */
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {validateRow} from '../web/src/usage-contract.ts';
import {aggregateKeys,receiptTimes} from './dashboard-model.mjs';
import {actionLabel,isScoreExport,summarizeImports} from './action-labels.mjs';
import {diagnosticReport,diagnosticQuery,diagnosticMarkdown} from './diagnostics-report.mjs';
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
export function summarize(input,{from,to,now=new Date(),includeToday=false}={}){
 if(!record(input)||!['usage-export-1','usage-export-2'].includes(input.schema_version)||Object.keys(input).some(k=>!['schema_version','query_status','activation','totals','coverage',...(input.schema_version==='usage-export-2'?['diagnostics']:[])].includes(k))||!Array.isArray(input.totals)||!Array.isArray(input.coverage)||input.query_status!=='ok'||input.schema_version==='usage-export-2'&&!Array.isArray(input.diagnostics))throw Error('Missing or failed aggregate query; counts are unknown.');
 to??=addDay(dayKey(now),includeToday?0:-1);from??=addDay(to,-29);
 if(!validDay(from)||!validDay(to)||from>to||to>dayKey(now)||(!includeToday&&to===dayKey(now)))throw Error('Choose completed New York days, or explicitly include today as partial.');
 const days=[];for(let d=from;d<=to;d=addDay(d,1)){if(days.length>=3660)throw Error('Report range exceeds 10 years');days.push(d);}
 const totalKeys=new Set();
 const totals=input.totals.map(r=>{
  if(!aggregateKeys(r)||!validDay(r.day)||!validVersion(r.version)||!Number.isSafeInteger(r.count)||r.count<0)throw Error('Invalid aggregate row');
  const safe=validateRow({event:r.event,page:r.page,detail:r.detail,failure:r.failure,count:1});
  if(!safe)throw Error('Invalid aggregate row');
  const row={day:r.day,version:r.version,event:safe.event,page:safe.page,detail:safe.detail,failure:safe.failure,count:r.count,...receiptTimes(r,now)},key=tuple(row);
  if(totalKeys.has(key))throw Error('Duplicate aggregate row');
  totalKeys.add(key);return row;
 }).filter(r=>r.day>=from&&r.day<=to);
 if(!Number.isSafeInteger(totals.reduce((n,r)=>n+r.count,0)))throw Error('Aggregate sum exceeds safe integer range.');
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
  const status=day===dayKey(now)?'partial':entries[0]?.status??'unknown';
  if(!['complete','partial','off','unknown'].includes(status))throw Error('Invalid coverage state');
  return {day,version,status,count:totals.filter(r=>r.day===day&&r.version===version).reduce((n,r)=>n+r.count,0),zero_is_measured:status==='complete'};
 }):[{day,version:null,status:day===dayKey(now)?'partial':'unknown',count:0,zero_is_measured:false}]);
 const diagnostic=diagnosticReport(input.diagnostics,now);diagnostic.diagnostics=diagnostic.diagnostics.filter(r=>r.day>=from&&r.day<=to);
 return {schema_version:'usage-report-1',timezone:zone,from,to,utc_start:startUTC(from),utc_end_exclusive:startUTC(addDay(to,1)),activation:input.activation??null,partial_day:to===dayKey(now),coverage,totals,...diagnostic,imports:summarizeImports(totals),
  limitations:['Counts describe actions, not unique people or sessions.','Provider lifecycle stages are separate counters, not distinct imports or a linked funnel; version-1 actions exclude automatic refresh and background status/cleanup. Version-2 diagnostics separately describe automatic operation outcomes.','Import completed means local data was committed; a later connection cleanup failure is a separate outcome.','First/latest known receipts are collector UTC times, not exact user-event times. Legacy rows have unknown receipt times.','No funnels, visitor sources, owner exclusion or retention are available.','Opt-outs, blocked requests and dropped batches are not measurable.','Only completed days marked complete distinguish measured zero from unknown coverage. New counters absent before rollout are unknown.']};
}
export function queryDatabase(database,{remote=false,persistTo,activation=null,from,to,now=new Date(),includeToday=false,run=spawnSync}={}){
 if(!/^[a-zA-Z0-9_-]{1,80}$/.test(database))throw Error('Invalid database name');
 const cli=fileURLToPath(new URL('bin/wrangler.js',import.meta.resolve('wrangler/package.json')));
 to??=addDay(dayKey(now),includeToday?0:-1);from??=addDay(to,-29);
 if(!validDay(from)||!validDay(to)||from>to||to>dayKey(now)||(!includeToday&&to===dayKey(now)))throw Error('Choose completed New York days, or explicitly include today as partial.');
 const where=" WHERE day>='"+from+"' AND day<='"+to+"'";
 const sql='SELECT day,version,event,page,detail,failure,count,first_received_at,last_received_at FROM usage_daily'+where+'; SELECT day,version,status FROM usage_coverage'+where+'; '+diagnosticQuery+where+' LIMIT 50001;';
 const args=[cli,'d1','execute',database,remote?'--remote':'--local','--json','--command',sql];
 if(persistTo&&!remote)args.push('--persist-to',persistTo);
 const result=run(process.execPath,args,{encoding:'utf8',maxBuffer:32*1024*1024,env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
 if(result.status!==0)throw Error('Aggregate query failed');
 const parsed=JSON.parse(result.stdout);
 if(!Array.isArray(parsed)||parsed.length!==3||parsed.some(r=>r.success!==true||!Array.isArray(r.results))||parsed[2].results.length>50000)throw Error('Aggregate query incomplete');
 if(activation!==null&&!validDay(activation))throw Error('Invalid activation day');
 return {schema_version:'usage-export-2',query_status:'ok',activation,totals:parsed[0].results,coverage:parsed[1].results,diagnostics:parsed[2].results};
}
export function markdown(report){
 const imports=summarizeImports(report.totals),value=v=>v??'unknown';
 return ['# maimai.party usage totals','',diagnosticMarkdown(report),report.from+' through '+report.to+' ('+zone+')',
  ...(report.partial_day?['Today is partial. Counts cover received activity so far, not a completed day.']:[]),
  'Activation: '+(report.activation??'unknown'),
  'UTC interval: '+report.utc_start+' to '+report.utc_end_exclusive+' (exclusive)','',
  '| Day | Instrumentation | Coverage | Count |','|---|---:|---|---:|',
  ...report.coverage.map(r=>'| '+r.day+' | '+(r.version??'unknown')+' | '+r.status+' | '+(r.count||r.zero_is_measured?r.count:'unknown')+' |'),'',
  '## Imports','',
  'Attempts, previews, confirmations and local commits are independent received counters, not people or a linked funnel. A cleanup failure does not undo a local commit. Unknown means no received counter, not measured zero. Receipt ranges include import and provider connection actions; legacy receipt times remain unknown.','',
  '| Service / method | Attempts | Previewed | Confirmed | Saved locally | Cancelled | Import failures |','|---|---:|---:|---:|---:|---:|---:|',
  ...imports.summaries.map(r=>'| '+[actionLabel(r.provider),...['started','previewed','confirmed','completed','cancelled','failed'].map(k=>value(r[k]))].join(' | ')+' |'),'',
  '### Latest known collector receipts (UTC)','',
  'These timestamps show when counters reached the collector. Latest saved locally is the received import-completion counter; it is not a connection or cleanup result. Legacy receipts may be unknown.','',
  '| Service / method | First activity | Latest activity | Latest attempt | Latest saved locally | Latest failure (any stage) |','|---|---|---|---|---|---|',
  ...imports.summaries.map(r=>'| '+[actionLabel(r.provider),...['first_received_at','last_received_at','latest_attempt_at','latest_completed_at','latest_failure_at'].map(k=>value(r[k]))].join(' | ')+' |'),'',
  '### Import and connection failures','',
  'Stages can describe the same failed attempt. Do not add this table to import failures above. Reasons are fixed categories, never provider error text.','',
  '| Service / method | Stage | Reason | Received | First known receipt (UTC) | Latest known receipt (UTC) |','|---|---|---|---:|---|---|',
  ...imports.failures.map(r=>'| '+[actionLabel(r.provider),actionLabel(r.event),actionLabel(r.failure),r.count,value(r.first_received_at),value(r.last_received_at)].join(' | ')+' |'),'',
  '## All received counters','',
  '| Day | Instrumentation | Event | Page | Detail | Failure | Count | First known receipt (UTC) | Latest known receipt (UTC) |','|---|---:|---|---|---|---|---:|---|---|',
  ...report.totals.map(r=>'| '+[r.day,r.version,r.event==='search_used'?actionLabel(r.event):r.event,r.page,r.event==='data_action'&&r.detail==='clear'?actionLabel(r.detail):r.detail||'—',r.failure||'—',r.count,value(r.first_received_at),value(r.last_received_at)].join(' | ')+' |'),'',
  '## Image exports','',
  'Received actions only. PNG download clicks do not confirm a saved file. Earlier missing counters are not measured zero.','',
  '| Day | Action | Page | Export or option | Count |','|---|---|---|---|---:|',
  ...report.totals.filter(r=>isScoreExport(r.event)).map(r=>'| '+[r.day,actionLabel(r.event),actionLabel(r.page),actionLabel(r.detail),r.count].join(' | ')+' |'),'',
  ...report.limitations.map(s=>'- '+s),''].join('\n');
}
export function csv(report){const keys=['day','version','event','page','detail','failure','count','first_received_at','last_received_at'];return [keys.join(','),...report.totals.map(r=>keys.map(k=>JSON.stringify(r[k]??'')).join(','))].join('\n')+'\n';}
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
   remote:args.includes('--remote'),includeToday:args.includes('--include-today'),persistTo:args.includes('--persist-to')?value('--persist-to'):undefined,activation:args.includes('--activated')?value('--activated'):null,from:args.includes('--from')?value('--from'):undefined,to:args.includes('--to')?value('--to'):undefined});
 const report=summarize(input,{includeToday:args.includes('--include-today'),from:args.includes('--from')?value('--from'):undefined,to:args.includes('--to')?value('--to'):undefined});
 const prefix=value('--output');await writeFile(prefix+'.json',JSON.stringify(report,null,2)+'\n');await writeFile(prefix+'.md',markdown(report));await writeFile(prefix+'.csv',csv(report));await writeFile(prefix+'.coverage.csv',coverageCSV(report));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{process.stderr.write('Usage report failed; no complete report is available. Check the explicit input, completed-day range and output directory.\n');process.exitCode=1;});
