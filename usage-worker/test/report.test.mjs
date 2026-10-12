import {test} from 'node:test';import assert from 'node:assert/strict';import {startUTC,summarize,markdown,csv,coverageCSV,queryDatabase} from '../report.mjs';
import {providerUsageRows} from './provider-usage-fixture.mjs';
import {DETAILS} from '../../web/src/usage-contract.ts';
import {actionLabel} from '../action-labels.mjs';

test('owner JSON Markdown and CSV preserve all finite provider lifecycle and tracker-link counters',()=>{
 const totals=providerUsageRows.map(row=>({...row,day:'2026-10-11',version:1}));
 const input={schema_version:'usage-export-1',query_status:'ok',totals,coverage:[]};
 const options={from:'2026-10-11',to:'2026-10-11',now:new Date('2026-10-13T12:00:00Z')};
 const report=summarize(input,options),md=markdown(report),rows=csv(report).trim().split('\n');
 assert.equal(report.totals.length,totals.length);assert.equal(rows.length,totals.length+1);
 for(const row of totals){
  assert.ok(md.includes('| '+[row.day,row.version,row.event,row.page,row.detail,row.failure||'—',row.count].join(' | ')+' |'));
  assert.ok(rows.includes([row.day,row.version,row.event,row.page,row.detail,row.failure,row.count].map(v=>JSON.stringify(v)).join(',')));
 }
 assert.ok(md.includes('automatic refresh'));assert.ok(md.includes('not distinct imports'));
 for(const change of [{accountID:'PRIVATE-ACCOUNT'},{token:'PRIVATE-TOKEN'},{score:100.1234},{detail:'PRIVATE-ACCOUNT'},{detail:'lxns'},{event:'file_import_started',detail:'portable'},{event:'provider_file_fallback_clicked'},{failure:'PRIVATE-ERROR'}])
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
 assert.ok(markdown(report).includes('unknown'));assert.equal(csv(report).split('\n')[0],'day,version,event,page,detail,failure,count');
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
 assert.throws(()=>queryDatabase('private/path'));assert.throws(()=>queryDatabase('local_usage',{run:()=>({status:1})}));
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
