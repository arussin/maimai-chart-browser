import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnosticReport,diagnosticMarkdown} from '../diagnostics-report.mjs';
import {makeDashboardData} from '../dashboard-model.mjs';
import {summarize,markdown} from '../report.mjs';
import {importMethods,importDiagnosticRows} from './provider-usage-fixture.mjs';
const now=new Date('2026-10-16T12:00:00.000Z');
const row={day:'2026-10-15',version:2,operation:'refresh',stage:'transport',reason:'worker_timeout',outcome:'failed',source:'maishift',mode:'automatic',duration:'over_10s',instrumentation:'diagnostics-1',count:7,first_received_at:'2026-10-15T12:00:00.000Z',last_received_at:'2026-10-15T13:00:00.000Z'};
const old={day:'2026-10-09',version:1,event:'import_failed',page:'charts',detail:'maishift',failure:'unavailable',count:7};
const input={schema_version:'usage-export-2',query_status:'ok',activation:'2026-10-03',totals:[old,{...old,day:'2026-10-13',count:2}],coverage:[{day:'2026-10-15',version:1,status:'complete'}],diagnostics:[row]};
test('historical unavailable rows retain exact labels and counts alongside new diagnostics',()=>{
 const report=summarize(input,{from:'2026-10-08',to:'2026-10-15',now});
 assert.deepEqual(report.totals,input.totals.map(r=>({...r,first_received_at:null,last_received_at:null})));assert.equal(report.diagnostics[0].reason,'worker_timeout');
 const dashboard=makeDashboardData(input,{now,capturedAt:now.toISOString()});
 assert.equal(dashboard.diagnostic_health.schema,'diagnostics-1');assert.equal(dashboard.diagnostic_health.collector,'unknown');assert.equal(dashboard.diagnostic_health.coverage,'incomplete');
 assert.equal(dashboard.action_labels.search_used,'Search interactions');
 const text=markdown(report);assert(text.includes('not unique people'));assert(text.includes('Current collector write health: unknown'));assert(text.includes('worker_timeout'));
});
test('old exports keep unknown diagnostic schema and no rows means unknown coverage',()=>{
 const {diagnostics,...legacy}=input;
 const dashboard=makeDashboardData({...legacy,schema_version:'usage-export-1'},{now,capturedAt:now.toISOString()});
 assert.equal(dashboard.diagnostic_health.schema,'unknown');assert.equal(dashboard.diagnostic_health.last_receipt,null);
 assert(diagnosticMarkdown(diagnosticReport([],now)).includes('unknown, not zero'));
});

test('all twelve import methods preserve action receipts beside operation diagnostics and unknown health',()=>{
 const receipt={first_received_at:row.first_received_at,last_received_at:row.last_received_at};
 const totals=importMethods.map(detail=>({day:row.day,version:1,event:'import_completed',page:'charts',detail,failure:'',count:1,...receipt}));
 const diagnostics=importDiagnosticRows.map(value=>({day:row.day,version:2,...value,...receipt}));
 const both={...input,totals,diagnostics};
 const report=summarize(both,{from:row.day,to:row.day,now});
 const dashboard=makeDashboardData(both,{now,capturedAt:now.toISOString()});
 for(const result of [report,dashboard]){
  assert.equal(result.imports.summaries.length,12);
  assert.equal(result.diagnostics.length,48);
  for(const method of importMethods){
   const summary=result.imports.summaries.find(value=>value.provider===method);
   assert.equal(summary.completed,1);assert.equal(summary.latest_completed_at,row.last_received_at);
   assert.equal(summary.failed,null,'Storage and import diagnostics must not be added to action failures');
   assert.equal(result.diagnostics.filter(value=>value.source===method).length,4);
  }
  assert.equal(result.diagnostic_health.last_receipt,row.last_received_at);
  assert.equal(result.diagnostic_health.collector,'unknown');
  assert.equal(result.diagnostic_health.coverage,'incomplete');
 }
 const text=markdown(report);assert(text.includes('Saved locally'));assert(text.includes('Current collector write health: unknown'));
 for(const method of importMethods)assert(text.includes('| '+method+' |'));
 for(const field of ['filename','accountID','token','score','message']){
  const invalid={...both,diagnostics:[diagnostics[0],{...diagnostics[1],[field]:'PRIVATE-SENTINEL'}]};
  assert.throws(()=>summarize(invalid,{from:row.day,to:row.day,now}));
  assert.throws(()=>makeDashboardData(invalid,{now,capturedAt:now.toISOString()}));
 }
});
test('private fields, incompatible versions and malformed receipt bounds are rejected',()=>{
 for(const change of [{version:3},{instrumentation:'PRIVATE'},{url:'PRIVATE'},{reason:'PRIVATE'},{count:Infinity},{first_received_at:'2026-10-14T12:00:00.000Z'},{last_received_at:'2026-10-15T11:00:00.000Z'},{last_received_at:'2026-10-20T12:00:00.000Z'}])assert.throws(()=>diagnosticReport([{...row,...change}],now));
 assert.throws(()=>diagnosticReport([row,row],now));
 assert.throws(()=>makeDashboardData(input,{now,capturedAt:'2026-10-15T12:00:00.000Z'}));
 assert.throws(()=>makeDashboardData({...input,diagnostics:undefined},{now,capturedAt:now.toISOString()}));
});
