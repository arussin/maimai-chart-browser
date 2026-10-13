import {test} from 'node:test';import assert from 'node:assert/strict';import {startUTC,summarize,markdown,csv,coverageCSV,queryDatabase} from '../report.mjs';
import {fileImportMethods,providerUsageRows} from './provider-usage-fixture.mjs';
import {DETAILS} from '../../web/src/usage-contract.ts';
import {actionLabel,summarizeImports} from '../action-labels.mjs';

test('owner JSON Markdown and CSV preserve all finite provider lifecycle and tracker-link counters',()=>{
 const totals=providerUsageRows.map(row=>({...row,day:'2026-10-11',version:1}));
 const input={schema_version:'usage-export-1',query_status:'ok',totals,coverage:[]};
 const options={from:'2026-10-11',to:'2026-10-11',now:new Date('2026-10-13T12:00:00Z')};
 const report=summarize(input,options),md=markdown(report),rows=csv(report).trim().split('\n');
 assert.equal(report.totals.length,totals.length);assert.equal(rows.length,totals.length+1);
 for(const row of totals){
  assert.ok(md.includes('| '+[row.day,row.version,row.event,row.page,row.detail,row.failure||'—',row.count].join(' | ')+' |'));
  assert.ok(rows.includes([row.day,row.version,row.event,row.page,row.detail,row.failure,row.count,'',''].map(v=>JSON.stringify(v)).join(',')));
 }
 assert.ok(md.includes('automatic refresh'));assert.ok(md.includes('not distinct imports'));
 for(const change of [{accountID:'PRIVATE-ACCOUNT'},{token:'PRIVATE-TOKEN'},{score:100.1234},{detail:'PRIVATE-ACCOUNT'},{detail:'tomomai'},{event:'file_import_started',detail:'portable'},{event:'provider_file_fallback_clicked'},{failure:'PRIVATE-ERROR'}])
  assert.throws(()=>summarize({...input,totals:[{...totals[0],...change}]},options),/Invalid aggregate/);
 assert.throws(()=>summarize({...input,token:'PRIVATE-TOKEN'},options),/Missing or failed/);
});

test('owner report includes readable export actions while CSV preserves finite keys',()=>{
 const rows=Object.entries(DETAILS).filter(([event])=>event.startsWith('score_export_')).flatMap(([event,details])=>details.map(detail=>({day:'2026-10-11',version:1,event,page:'song',detail,failure:'',count:2})));
 const report=summarize({schema_version:'usage-export-1',query_status:'ok',totals:rows,coverage:[]},{from:'2026-10-11',to:'2026-10-11',now:new Date('2026-10-13T12:00:00Z')});
 const md=markdown(report), table=csv(report);
 assert(md.includes('## Image exports'));assert(md.includes('do not confirm a saved file'));assert(md.includes('Earlier missing counters are not measured zero'));
 for(const row of rows){assert(md.includes(actionLabel(row.event)));assert(md.includes(actionLabel(row.detail)));assert(table.includes(row.event));assert(table.includes(row.detail));}
 assert.equal(report.totals.length,17);
 const cleared={...report,totals:[{...rows[0],event:'data_action',detail:'clear'}]};
 assert(markdown(cleared).includes('Forget / clear player data'));assert(csv(cleared).includes('"clear"'));
});
test('report uses completed NY days and exact DST UTC intervals',()=>{
 assert.equal(startUTC('2026-03-08'),'2026-03-08T05:00:00.000Z');assert.equal(startUTC('2026-03-09'),'2026-03-09T04:00:00.000Z');
 assert.equal(startUTC('2026-11-01'),'2026-11-01T04:00:00.000Z');assert.equal(startUTC('2026-11-02'),'2026-11-02T05:00:00.000Z');
 const report=summarize({schema_version:'usage-export-1',query_status:'ok',totals:[],coverage:[{day:'2026-09-20',version:1,status:'complete'}]},{now:new Date('2026-09-22T02:00:00Z')});
 assert.equal(report.to,'2026-09-20');assert.equal(report.from,'2026-08-22');assert.equal(report.coverage.at(-1).zero_is_measured,true);assert.equal(report.coverage[0].zero_is_measured,false);
 assert.ok(markdown(report).includes('unknown'));assert.equal(csv(report).split('\n')[0],'day,version,event,page,detail,failure,count,first_received_at,last_received_at');
});
test('failed query cannot become zero and incomplete current day cannot be requested',()=>{
 assert.throws(()=>summarize({schema_version:'usage-export-1',query_status:'failed',totals:[],coverage:[]}));
 assert.throws(()=>summarize({schema_version:'usage-export-1',query_status:'ok',totals:[],coverage:[]},{from:'2026-09-22',to:'2026-09-22',now:new Date('2026-09-22T12:00:00Z')}));
});

test('owner query is read-only, no public endpoint, and failed query is not reported as zero',()=>{
 let command;
 const input=queryDatabase('local_usage',{run:(exe,args)=>{command=args;return {status:0,stdout:JSON.stringify([{success:true,results:[]},{success:true,results:[]}])}}});
 assert.equal(input.query_status,'ok');assert.ok(command.includes('--local'));assert.ok(!command.includes('--remote'));
 assert.ok(command.at(-1).startsWith('SELECT '));assert.ok(!command.at(-1).includes('INSERT'));
 assert.ok(command.at(-1).includes('count,first_received_at,last_received_at FROM usage_daily'));
 assert.throws(()=>queryDatabase('private/path'));assert.throws(()=>queryDatabase('local_usage',{run:()=>({status:1})}));
});

test('import summary counts local commits separately from connection success and cleanup failure',()=>{
 const base={day:'2026-10-11',version:1,page:'charts',detail:'diving-fish',failure:'',count:1};
 const first='2026-10-11T12:00:00.000Z',last='2026-10-11T12:10:00.000Z';
 const rows=[
  {...base,event:'import_started',count:4,first_received_at:first,last_received_at:last},
  {...base,event:'import_previewed',count:3}, {...base,event:'import_confirmed',count:2},
  {...base,event:'import_completed'}, {...base,event:'import_cancelled'},
  {...base,event:'import_failed',failure:'storage'},
  {...base,event:'provider_connect_completed',count:3},
  {...base,event:'provider_disconnect_failed',failure:'cleanup_required',first_received_at:last,last_received_at:last},
  {...base,detail:'lxns',event:'provider_read_failed',failure:'empty_scores'},
 ];
 const report=summarize({schema_version:'usage-export-1',query_status:'ok',totals:rows,coverage:[]},{from:base.day,to:base.day,now:new Date('2026-10-12T12:00:00Z')});
 const fish=report.imports.summaries.find(r=>r.provider==='diving-fish');
 assert.deepEqual(fish,{provider:'diving-fish',started:4,previewed:3,confirmed:2,completed:1,cancelled:1,failed:1,first_received_at:first,last_received_at:last,latest_attempt_at:last,latest_completed_at:null,latest_failure_at:last});
 const lxns=report.imports.summaries.find(r=>r.provider==='lxns');assert.equal(lxns.completed,null);assert.equal(lxns.failed,null);
 assert.equal(report.imports.failures.length,3);assert.equal(report.imports.failures.find(r=>r.failure==='cleanup_required').event,'provider_disconnect_failed');
 const md=markdown(report);assert.match(md,/## Imports/);assert.match(md,/Saved locally/);assert.match(md,/Local storage/);assert.match(md,/No supported scores/);assert.match(md,/Connection cleanup required/);
 assert.match(md,/not exact user-event times/);assert.match(csv(report),/2026-10-11T12:00:00.000Z/);
 const all=summarizeImports(['file','report','maishift','kamaitachi','diving-fish','lxns'].map(detail=>({...base,detail,event:'import_started'})));
 assert.equal(all.summaries.length,6);assert.equal(all.failures.length,0);assert.ok(all.summaries.every(r=>r.completed===null));
});

test('each provider file has a separate labeled summary, receipts and failures without changing portable history',()=>{
 const at='2026-10-11T12:00:00.000Z',later='2026-10-11T13:00:00.000Z';
 const base={day:'2026-10-11',version:1,page:'charts',failure:'',count:1};
 const totals=[{...base,event:'import_completed',detail:'file',count:7},...fileImportMethods.flatMap(detail=>[
  {...base,event:'import_started',detail,count:3,first_received_at:at,last_received_at:later},
  {...base,event:'import_completed',detail,count:2,first_received_at:later,last_received_at:later},
  {...base,event:'import_failed',detail,failure:'invalid',first_received_at:later,last_received_at:later},
 ])];
 const input={schema_version:'usage-export-1',query_status:'ok',totals,coverage:[]};
 const report=summarize(input,{from:base.day,to:base.day,now:new Date('2026-10-12T12:00:00Z')});
 assert.equal(report.imports.summaries.length,7);
 assert.equal(report.imports.summaries.find(row=>row.provider==='file').completed,7);
 assert.equal(actionLabel('file'),'Session Report file');
 const md=markdown(report),table=csv(report);
 for(const method of fileImportMethods){
  const summary=report.imports.summaries.find(row=>row.provider===method);
  assert.equal(summary.started,3);assert.equal(summary.completed,2);assert.equal(summary.failed,1);
  assert.equal(summary.latest_attempt_at,later);assert.equal(summary.latest_completed_at,later);assert.equal(summary.latest_failure_at,later);
  assert.equal(report.imports.failures.find(row=>row.provider===method).failure,'invalid');
  assert(md.includes('| '+actionLabel(method)+' | 3 | unknown | unknown | 2 | unknown | 1 |'));
  assert(table.includes('"'+method+'"'));
 }
 for(const detail of ['tomomai','file:unknown','file:tomomai:PRIVATE-FILENAME'])
  assert.throws(()=>summarize({...input,totals:[{...totals[0],detail}]},{from:base.day,to:base.day,now:new Date('2026-10-12T12:00:00Z')}),/aggregate/);
});

test('today requires explicit inclusion and stays partial even with a complete ledger',()=>{
 const now=new Date('2026-10-12T02:30:00.000Z'),day='2026-10-11';
 const input={schema_version:'usage-export-1',query_status:'ok',totals:[],coverage:[{day,version:1,status:'complete'}]};
 assert.equal(summarize(input,{now}).to,'2026-10-10');
 const report=summarize(input,{now,from:day,includeToday:true});
 assert.equal(report.to,day);assert.equal(report.partial_day,true);assert.equal(report.coverage[0].status,'partial');assert.equal(report.coverage[0].zero_is_measured,false);
 const empty=summarize({...input,coverage:[]},{now,from:day,includeToday:true});assert.equal(empty.coverage[0].status,'partial');assert.equal(empty.coverage[0].zero_is_measured,false);
 assert.match(markdown(report),/Today is partial/);assert.match(coverageCSV(report),/"partial","unknown",false/);
 assert.throws(()=>summarize(input,{now,to:'2026-10-12',includeToday:true}));
 let sql;queryDatabase('local_usage',{now,from:day,includeToday:true,run:(_exe,args)=>{sql=args.at(-1);return{status:0,stdout:JSON.stringify([{success:true,results:[]},{success:true,results:[]}])}}});
 assert.match(sql,/day<='2026-10-11'/);
});

test('report preserves legacy unknown receipts and rejects invalid or private receipt payloads',()=>{
 const row={day:'2026-10-11',version:1,event:'import_started',page:'charts',detail:'lxns',failure:'',count:1};
 const options={from:row.day,to:row.day,now:new Date('2026-10-12T12:00:00Z')};
 const input={schema_version:'usage-export-1',query_status:'ok',totals:[row],coverage:[]};
 assert.equal(summarize(input,options).totals[0].first_received_at,null);
 for(const receipt of [
  {first_received_at:'2026-10-11T12:00:00Z'},
  {first_received_at:'2026-10-11T12:00:00Z',last_received_at:'2026-10-11T11:00:00Z'},
  {first_received_at:'2026-10-11T12:00:00+00:00',last_received_at:'2026-10-11T12:00:00+00:00'},
  {first_received_at:'2026-10-12T12:00:00Z',last_received_at:'2026-10-12T12:00:00Z'},
  {first_received_at:'2026-02-30T12:00:00Z',last_received_at:'2026-02-30T12:00:00Z'},
  {first_received_at:'PRIVATE',last_received_at:'PRIVATE'},
  {first_received_at:null,last_received_at:null,client_timestamp:'PRIVATE'},
 ])assert.throws(()=>summarize({...input,totals:[{...row,...receipt}]},options),/aggregate/);
});


test('aggregate keys are unique and every coverage ledger row has a finite valid shape',()=>{
 const row={day:'2026-09-20',version:1,event:'page_view',page:'charts',detail:'',failure:'',count:2};
 const input={schema_version:'usage-export-1',query_status:'ok',totals:[row],coverage:[]};
 const options={from:'2026-09-20',to:'2026-09-20',now:new Date('2026-09-22T12:00:00Z')};
 assert.throws(()=>summarize({...input,totals:[row,{...row}]},options),/Duplicate aggregate/);
 for(const coverage of [
  [{day:'2026-09-20',version:'PRIVATE-SENTINEL',status:'complete'}],
  [{day:'2026-09-20',version:0,status:'complete'}],
  [{day:'2026-09-20',version:1.5,status:'complete'}],
  [{day:'2026-02-30',version:1,status:'complete'}],
  [{day:'2026-13-20',version:1,status:'complete'}],
  [{day:'2026-09-20',version:1,status:'PRIVATE-SENTINEL'}],
  [{day:'2026-09-20',version:1,status:'complete',request:'PRIVATE-SENTINEL'}],
  [null],
  [{day:'2026-09-20',version:1,status:'complete'},{day:'2026-09-20',version:1,status:'off'}]
 ])assert.throws(()=>summarize({...input,coverage},options),/coverage/);
});

test('daily and instrumentation identity remains visible in Markdown and unknown stays unknown',()=>{
 const row={event:'page_view',page:'charts',detail:'',failure:'',count:2};
 const report=summarize({schema_version:'usage-export-1',query_status:'ok',totals:[
  {...row,day:'2026-09-20',version:1},{...row,day:'2026-09-20',version:2},{...row,day:'2026-09-21',version:2}
 ],coverage:[{day:'2026-09-20',version:1,status:'complete'}]},
 {from:'2026-09-20',to:'2026-09-21',now:new Date('2026-09-22T12:00:00Z')});
 const output=markdown(report);
 assert.ok(output.includes('| Day | Instrumentation | Event |'));
 for(const [day,version] of [['2026-09-20',1],['2026-09-20',2],['2026-09-21',2]])assert.ok(output.includes('| '+day+' | '+version+' | page_view |'));
 assert.equal(report.coverage.find(r=>r.day==='2026-09-21'&&r.version===1).zero_is_measured,false);
 assert.ok(output.includes('| 2026-09-21 | 1 | unknown | unknown |'));
});


test('coverage CSV preserves unknown versus measured zero and daily UTC boundaries',()=>{
 const report=summarize({schema_version:'usage-export-1',query_status:'ok',activation:'2026-03-07',totals:[],coverage:[{day:'2026-03-08',version:1,status:'complete'}]},
  {from:'2026-03-07',to:'2026-03-08',now:new Date('2026-03-10T12:00:00Z')});
 const output=coverageCSV(report);
 assert.ok(output.includes('"2026-03-07",1,"unknown","unknown",false'));
 assert.ok(output.includes('"2026-03-08",1,"complete",0,true,"2026-03-08T05:00:00.000Z","2026-03-09T04:00:00.000Z"'));
 assert.ok(markdown(report).includes('Activation: 2026-03-07'));
});
