import test from 'node:test';
import assert from 'node:assert/strict';
import {dayKey,makeDashboardData,validateExport} from '../dashboard-model.mjs';
import {renderDashboard,safeJSON} from '../dashboard.mjs';
const now=new Date('2026-10-03T13:00:00Z');
const row={day:'2026-10-03',version:1,event:'page_view',page:'charts',detail:'',failure:'',count:7};
const fixture=()=>({schema_version:'usage-export-1',query_status:'ok',activation:'2026-10-03',totals:[{...row}],coverage:[]});
test('New York date boundary and DST use the named timezone',()=>{
 assert.equal(dayKey(new Date('2026-10-03T03:59:59Z')),'2026-10-02');
 assert.equal(dayKey(new Date('2026-10-03T04:00:00Z')),'2026-10-03');
 assert.equal(dayKey(new Date('2026-03-08T06:59:59Z')),'2026-03-08');
 assert.equal(dayKey(new Date('2026-03-08T07:00:00Z')),'2026-03-08');
});
test('received counts and missing coverage are preserved without inventing completeness',()=>{
 const result=makeDashboardData(fixture(),{now,capturedAt:now.toISOString()});
 assert.equal(result.schema_version,'usage-dashboard-1');assert.equal(result.today,'2026-10-03');
 assert.equal(result.totals[0].count,7);assert.deepEqual(result.coverage,[]);
});
test('failed and malformed exports cannot become zero dashboards',()=>{
 for(const change of [{query_status:'failed'},{totals:null},{activation:'2026-02-30'},{credential:'unexpected'}])assert.throws(()=>validateExport({...fixture(),...change},now));
 assert.throws(()=>validateExport({...fixture(),totals:[row,row]},now),/Duplicate/);
 assert.throws(()=>validateExport({...fixture(),totals:[{...row,version:2}]},now),/unsupported/);
 assert.throws(()=>validateExport({...fixture(),totals:[{...row,count:-1}]},now));
 assert.throws(()=>validateExport({...fixture(),totals:[{...row,count:Number.MAX_SAFE_INTEGER},{...row,event:'settings_opened',count:1}]},now),/safe integer/);
});
test('maintained contract rejects sensitive or invented fields and event combinations',()=>{
 for(const change of [{url:'https://example.invalid/private'},{event:'<script>alert(1)</script>'},{detail:'private search'},{failure:'arbitrary error'}])assert.throws(()=>validateExport({...fixture(),totals:[{...row,...change}]},now));
});
test('coverage conflicts, future dates and impossible timestamps are errors',()=>{
 assert.throws(()=>validateExport({...fixture(),coverage:[{day:row.day,version:1,status:'complete'},{day:row.day,version:1,status:'partial'}]},now),/Duplicate/);
 assert.throws(()=>validateExport({...fixture(),totals:[{...row,day:'2026-10-04'}]},now));
 assert.throws(()=>makeDashboardData(fixture(),{now,capturedAt:'2026-10-04T13:00:00Z'}));
});
test('render is a self-contained private snapshot with enforced no-network policy',async()=>{
 const html=await renderDashboard(fixture(),{now,capturedAt:now.toISOString()});
 assert(html.includes("connect-src 'none'"));assert(html.includes("default-src 'none'"));
 assert(html.includes("script-src 'sha256-"));assert(html.includes('Private local snapshot'));
 assert(!/<script[^>]+src=/.test(html));assert(!/<link[^>]+href=/.test(html));
 assert(!html.includes('__DATA__'));assert(!html.includes('__STYLE__'));assert(!html.includes('__SCRIPT__'));
});
test('embedded JSON cannot terminate its script element',()=>{
 const escaped=safeJSON({value:'</script><script>bad</script>\u2028&'});
 assert(!escaped.includes('<'));assert(!escaped.includes('&'));assert.deepEqual(JSON.parse(escaped),{value:'</script><script>bad</script>\u2028&'});
});
