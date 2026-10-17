import test from 'node:test';
import assert from 'node:assert/strict';
import {dayKey,makeDashboardData,validateExport} from '../dashboard-model.mjs';
import {renderDashboard,safeJSON} from '../dashboard.mjs';
import {fileImportMethods,providerUsageRows} from './provider-usage-fixture.mjs';
import {DETAILS} from '../../web/src/usage-contract.ts';
import {runInNewContext} from 'node:vm';
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

test('offline dashboard embeds every finite provider lifecycle and tracker-link counter and retains its limits',async()=>{
 const totals=providerUsageRows.map(r=>({...r,day:row.day,version:1}));
 const input={...fixture(),totals};
 const data=makeDashboardData(input,{now,capturedAt:now.toISOString()});
 assert.deepEqual(data.totals,totals.map(r=>({...r,first_received_at:null,last_received_at:null})));assert.ok(data.limitations.some(text=>text.includes('Automatic refresh')));
 for(const method of fileImportMethods){
  assert.equal(data.imports.summaries.find(row=>row.provider===method).completed,1);
  assert.equal(data.imports.failures.filter(row=>row.provider===method).length,16);
  assert(data.action_labels[method].endsWith(' file'));
 }
 const html=await renderDashboard(input,{now,capturedAt:now.toISOString()});
 for(const event of new Set(totals.map(r=>r.event)))assert.ok(html.includes(event),event);
 assert(html.includes("connect-src 'none'"));
 for(const change of [{accountID:'PRIVATE'},{displayName:'PRIVATE'},{url:'https://provider.invalid/PRIVATE'},{token:'PRIVATE'},{score:100.1234},{detail:'tomomai'},{event:'file_import_started',detail:'portable'},{event:'provider_file_fallback_clicked'}])
  assert.throws(()=>validateExport({...input,totals:[{...totals[0],...change}]},now));
});
test('private dashboard labels and export section cover every new finite counter',async()=>{
 const totals=Object.entries(DETAILS).filter(([event])=>event.startsWith('score_export_')).flatMap(([event,details])=>details.map(detail=>({...row,event,detail,count:1})));
 const input={...fixture(),totals},data=makeDashboardData(input,{now,capturedAt:now.toISOString()});
 assert.equal(data.totals.length,17);
 for(const row of totals)assert(data.action_labels[row.event]);
 assert.equal(data.action_labels.achievement_pb,'Personal best image');
 assert.equal(data.action_labels.achievement_play,'Recorded play image');
 assert.equal(data.action_labels.clear,'Forget / clear player data');
 const html=await renderDashboard(input,{now,capturedAt:now.toISOString()});
 assert(html.includes('id="score-exports"'));assert(html.includes('Best 50 and achievement images'));
 assert(html.includes('Download clicks do not confirm a saved file'));
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

test('receipt bounds use the collector clock, preserve legacy nulls, and cannot exceed capture time',()=>{
 const bounds={first_received_at:'2026-10-03T12:00:00.000Z',last_received_at:'2026-10-03T12:30:00.000Z'};
 const input={...fixture(),totals:[{...row,...bounds}]};
 assert.deepEqual(validateExport(input,now).totals[0],{...row,...bounds});
 assert.equal(validateExport(fixture(),now).totals[0].last_received_at,null);
 for(const change of [
  {first_received_at:'2026-10-03T12:40:00Z'}, {last_received_at:null},
  {last_received_at:'2026-10-03T14:00:00Z'}, {first_received_at:'2026-10-03T03:59:59Z'},
  {first_received_at:'2026-10-03 12:00:00'}, {first_received_at:42},
  {first_received_at:'2026-02-30T12:00:00Z'},
 ])assert.throws(()=>validateExport({...input,totals:[{...row,...bounds,...change}]},now),/receipt/);
 assert.throws(()=>makeDashboardData(input,{now,capturedAt:'2026-10-03T12:00:00Z'}),/receipt/);
});

test('rendered dashboard executes import summaries, page filters, partial-day coverage and receipt CSV',async()=>{
 const base={...row,event:'import_started',detail:'diving-fish',count:4,first_received_at:'2026-10-03T12:00:00.000Z',last_received_at:'2026-10-03T12:30:00.000Z'};
 const input={...fixture(),totals:[base,{...base,event:'import_completed',count:2},{...base,event:'provider_disconnect_failed',failure:'cleanup_required',count:1},{...base,detail:'lxns',page:'song',event:'provider_read_failed',failure:'empty_scores',count:1}],coverage:[{day:row.day,version:1,status:'complete'}]};
 const html=await renderDashboard(input,{now,capturedAt:now.toISOString()});
 const json=html.match(/<script type="application\/json" id="dashboard-data">([\s\S]*?)<\/script>/)[1],script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 const elements=new Map();
 const make=()=>({children:[],events:{},value:'',textContent:'',append(...values){this.children.push(...values);},replaceChildren(...values){this.children=values;},setAttribute(){},addEventListener(name,fn){this.events[name]=fn;},showModal(){this.open=true;},close(){this.open=false;}});
 const el=id=>{if(!elements.has(id))elements.set(id,make());return elements.get(id);};
 el('dashboard-data').textContent=json;el('range').value='today';
 class FixedDate extends Date {constructor(...args){super(...(args.length?args:[now.getTime()]));}static now(){return now.getTime();}}
 runInNewContext(script,{document:{getElementById:el,createElement:make},Date:FixedDate,Intl,Blob,URL:{createObjectURL:()=> 'blob:fixture',revokeObjectURL(){}},location:{reload(){}}});
 const values=element=>element.children.map(tr=>tr.children.map(td=>td.textContent));
 assert.deepEqual(values(el('imports'))[0],['Diving-Fish','4','—','—','2','—','—']);
 assert.deepEqual(values(el('import-receipts'))[0],['Diving-Fish',base.first_received_at,base.last_received_at,base.last_received_at,base.last_received_at,base.last_received_at]);
 assert.equal(el('imports').children.length,2);assert.equal(el('import-failures').children.length,2);
 assert.equal(values(el('coverage'))[0][1],'Incomplete day');
 assert.equal(values(el('import-failures')).some(r=>r.includes('Connection cleanup required')),true);
 el('page').value='charts';el('page').events.change();assert.equal(el('imports').children.length,1);assert.equal(el('import-failures').children.length,1);
 el('download').events.click();assert.match(el('csv-preview').value,/"first_received_at","last_received_at"/);assert.match(el('csv-preview').value,/2026-10-03T12:30:00.000Z/);assert.doesNotMatch(el('csv-preview').value,/"lxns"/);
 el('search').value='import completed';el('search').events.input();assert.equal(values(el('imports'))[0][4],'2');assert.equal(values(el('imports'))[0][1],'—');assert.equal(el('import-failures-empty').hidden,false);
 el('search').value='no matching action';el('search').events.input();assert.equal(el('imports-empty').hidden,false);
});
