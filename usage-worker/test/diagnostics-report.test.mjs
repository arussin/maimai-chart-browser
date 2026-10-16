import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnosticReport,diagnosticMarkdown} from '../diagnostics-report.mjs';
import {makeDashboardData} from '../dashboard-model.mjs';
import {summarize,markdown} from '../report.mjs';
const now=new Date('2026-10-16T12:00:00.000Z');
const row={day:'2026-10-15',version:2,operation:'refresh',stage:'transport',reason:'worker_timeout',outcome:'failed',source:'maishift',mode:'automatic',duration:'over_10s',instrumentation:'diagnostics-1',count:7,first_received_at:'2026-10-15T12:00:00.000Z',last_received_at:'2026-10-15T13:00:00.000Z'};
const old={day:'2026-10-09',version:1,event:'import_failed',page:'charts',detail:'maishift',failure:'unavailable',count:7};
const input={schema_version:'usage-export-2',query_status:'ok',activation:'2026-10-03',totals:[old,{...old,day:'2026-10-13',count:2}],coverage:[{day:'2026-10-15',version:1,status:'complete'}],diagnostics:[row]};
test('historical unavailable rows retain exact labels and counts alongside new diagnostics',()=>{
 const report=summarize(input,{from:'2026-10-08',to:'2026-10-15',now});
 assert.deepEqual(report.totals,input.totals);assert.equal(report.diagnostics[0].reason,'worker_timeout');
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
test('private fields, incompatible versions and malformed receipt bounds are rejected',()=>{
 for(const change of [{version:3},{instrumentation:'PRIVATE'},{url:'PRIVATE'},{reason:'PRIVATE'},{count:Infinity},{first_received_at:'2026-10-14T12:00:00.000Z'},{last_received_at:'2026-10-15T11:00:00.000Z'},{last_received_at:'2026-10-20T12:00:00.000Z'}])assert.throws(()=>diagnosticReport([{...row,...change}],now));
 assert.throws(()=>diagnosticReport([row,row],now));
 assert.throws(()=>makeDashboardData(input,{now,capturedAt:'2026-10-15T12:00:00.000Z'}));
 assert.throws(()=>makeDashboardData({...input,diagnostics:undefined},{now,capturedAt:now.toISOString()}));
});
