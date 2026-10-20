import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import worker,{dayKey} from '../worker.mjs';
import staging from '../staging.mjs';
import {fileImportMethods,providerUsageRows,importMethods,importDiagnosticRows} from './provider-usage-fixture.mjs';
import {DETAILS} from '../../web/src/usage-contract.ts';
let mf,db,stageDB,legacyDB;
async function migrate(database,name){
 for(const sql of (await readFile(new URL('../migrations/'+name,import.meta.url),'utf8')).replace(/--[^\n]*/g,'').split(';').filter(s=>s.trim()))await database.prepare(sql).run();
}
before(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("local fixture")}}',compatibilityDate:'2026-09-22',d1Databases:['USAGE_DB','STAGING_DB','LEGACY_DB'],outboundService:()=>{throw Error('No external requests allowed')}}));
 db=await mf.getD1Database('USAGE_DB');stageDB=await mf.getD1Database('STAGING_DB');legacyDB=await mf.getD1Database('LEGACY_DB');
 for(const database of [db,stageDB,legacyDB])await migrate(database,'0001_daily.sql');
 for(const database of [db,stageDB])await migrate(database,'0002_import_receipts.sql');
 for(const database of [db,stageDB])await migrate(database,'0003_diagnostics.sql');
 await migrate(legacyDB,'0003_diagnostics.sql');
});
after(async()=>{await mf?.dispose();});
const row={event:'page_view',page:'charts',detail:'',count:1};
const diagnostic={operation:'refresh',stage:'transport',reason:'worker_timeout',outcome:'failed',source:'maishift',mode:'automatic',duration:'over_10s',instrumentation:'diagnostics-1',count:1};
const req=(body={version:1,events:[row]},opts={})=>new Request(opts.url||'https://maimai.party/__usage',{method:opts.method||'POST',headers:{Origin:'https://maimai.party','Content-Type':'application/json',...opts.headers},...(opts.method==='GET'?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
const call=(request,enabled='true')=>worker.fetch(request,{USAGE_DB:db,USAGE_ENABLED:enabled});
test('version 2 diagnostics coexist with old actions and acknowledge only stored batches',async()=>{
 await db.prepare('DELETE FROM usage_diagnostics_daily').run();
 const body={version:2,events:[diagnostic]};
 const responses=await Promise.all(Array.from({length:4},()=>call(req(body))));
 assert(responses.every(r=>r.status===204&&r.headers.get('X-Maimai-Usage-Receipt')==='stored'&&r.headers.get('X-Maimai-Usage-Schema')==='1,2'));
 const rows=(await db.prepare('SELECT * FROM usage_diagnostics_daily').all()).results;
 assert.equal(rows.length,1);assert.equal(rows[0].count,4);assert.equal(rows[0].reason,'worker_timeout');assert(rows[0].first_received_at<=rows[0].last_received_at);
 for(const opts of [{headers:{DNT:'1'}},{headers:{'Sec-GPC':'1'}}]){
  const response=await call(req(body,opts));assert.equal(response.status,204);assert.equal(response.headers.get('X-Maimai-Usage-Receipt'),null);
 }
 assert.equal((await call(req(body),'false')).headers.get('X-Maimai-Usage-Receipt'),null);
 for(const field of ['operation','stage','reason','outcome','source','mode','duration','instrumentation','url','stack','player','query'])assert.equal((await call(req({version:2,events:[diagnostic,{...diagnostic,[field]:'PRIVATE-SENTINEL'}]}))).status,400);
 assert.deepEqual((await db.prepare('SELECT * FROM usage_diagnostics_daily').all()).results,rows);
 const failed=await worker.fetch(req(body),{USAGE_ENABLED:'true',USAGE_DB:{prepare(){return {bind(){return {}}}},batch(){throw Error('PRIVATE')}}});
 assert.equal(failed.status,503);assert.equal(failed.headers.get('X-Maimai-Usage-Receipt'),null);assert.equal(await failed.text(),'');
 assert.equal((await call(req())).status,204);
});

test('all twelve import methods store separate diagnostic outcomes and reject private siblings atomically',async()=>{
 await db.prepare('DELETE FROM usage_diagnostics_daily').run();
 const priorActions=(await db.prepare('SELECT * FROM usage_daily ORDER BY day,version,event,page,detail,failure').all()).results;
 for(let offset=0;offset<importDiagnosticRows.length;offset+=8){
  const body={version:2,events:importDiagnosticRows.slice(offset,offset+8)};
  assert(Buffer.byteLength(JSON.stringify(body))<=4096);
  const response=await call(req(body));assert.equal(response.status,204);assert.equal(response.headers.get('X-Maimai-Usage-Receipt'),'stored');
 }
 const rows=(await db.prepare('SELECT * FROM usage_diagnostics_daily ORDER BY source,stage,outcome').all()).results;
 const dimensions=rows=>rows.map(({day,version,first_received_at,last_received_at,...row})=>JSON.stringify(Object.keys(row).sort().map(key=>[key,row[key]]))).sort();
 assert.deepEqual(dimensions(rows),dimensions(importDiagnosticRows));
 for(const source of importMethods)assert.equal(rows.filter(row=>row.source===source).length,4);
 for(const field of ['filename','accountID','connectionID','url','token','score','message','first_received_at']){
  const response=await call(req({version:2,events:[importDiagnosticRows[0],{...importDiagnosticRows[0],[field]:'PRIVATE-SENTINEL'}]}));
  assert.equal(response.status,400);assert.equal(response.headers.get('X-Maimai-Usage-Receipt'),null);
 }
 for(const source of ['tomomai','file:unknown','file:tomomai:PRIVATE-SENTINEL'])
  assert.equal((await call(req({version:2,events:[{...importDiagnosticRows[0],source}]}))).status,400);
 assert.deepEqual((await db.prepare('SELECT * FROM usage_diagnostics_daily ORDER BY source,stage,outcome').all()).results,rows);
 assert.deepEqual((await db.prepare('SELECT * FROM usage_daily ORDER BY day,version,event,page,detail,failure').all()).results,priorActions);
 for(const headers of [{DNT:'1'},{'Sec-GPC':'1'}]){
  const response=await call(req({version:2,events:importDiagnosticRows.slice(0,8)},{headers}));
  assert.equal(response.status,204);assert.equal(response.headers.get('X-Maimai-Usage-Receipt'),null);
 }
 assert.deepEqual((await db.prepare('SELECT * FROM usage_diagnostics_daily ORDER BY source,stage,outcome').all()).results,rows);
});

test('authorization, cleanup and visibility failures retain finite diagnostic boundaries without inventing action rows',async()=>{
 const base={...diagnostic,mode:'manual',duration:'under_1s'};
 const events=[
  ...['diving-fish','lxns'].flatMap(source=>['popup_blocked','authorization_failed','connection_expired','agreement_required'].map(reason=>({...base,source,operation:'provider_connect',stage:'authorization',reason}))),
  {...base,source:'diving-fish',operation:'provider_disconnect',stage:'transport',reason:'cleanup_required'},
  {...base,source:'lxns',operation:'provider_cleanup',stage:'transport',reason:'network'},
  {...base,source:'lxns',operation:'import',stage:'normalize',reason:'empty_scores'},
  {...base,source:'none',operation:'connector_config',stage:'response',reason:'configuration_unavailable',mode:'automatic'},
 ];
 const before=(await db.prepare('SELECT SUM(count) AS n FROM usage_daily').first()).n;
 for(let offset=0;offset<events.length;offset+=8)assert.equal((await call(req({version:2,events:events.slice(offset,offset+8)}))).status,204);
 for(const event of events){
  const row=await db.prepare('SELECT count FROM usage_diagnostics_daily WHERE operation=? AND source=? AND reason=?').bind(event.operation,event.source,event.reason).first();
  assert.equal(row.count,1);
 }
 assert.equal((await db.prepare('SELECT SUM(count) AS n FROM usage_daily').first()).n,before);
 for(const event of [
  {...events[0],source:'file:tomomai'},
  {...events[0],source:'kamaitachi'},
  {...events.at(-1),source:'lxns'},
  {...events[0],reason:'PRIVATE-ERROR'},
 ])assert.equal((await call(req({version:2,events:[events[0],event]}))).status,400);
});
test('only finite aggregate fields and server receipt bounds are stored; concurrent increments sum',async(t)=>{
 await db.prepare('DELETE FROM usage_daily').run();
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-12T16:00:00.123Z')});
 const responses=await Promise.all(Array.from({length:20},()=>call(req())));
 assert.ok(responses.every(r=>r.status===204&&r.headers.get('X-Maimai-Usage-Receipt')==='stored'));
 const {results}=await db.prepare('SELECT * FROM usage_daily').all();assert.equal(results.length,1);assert.equal(results[0].count,20);
 assert.equal(results[0].first_received_at,'2026-10-12T16:00:00.123Z');
 assert.equal(results[0].last_received_at,'2026-10-12T16:00:00.123Z');
 assert.deepEqual(Object.keys(results[0]).sort(),['count','day','detail','event','failure','first_received_at','last_received_at','page','version']);
 t.mock.timers.setTime(Date.parse('2026-10-12T15:00:00.456Z'));
 assert.equal((await call(req())).status,204);
 t.mock.timers.setTime(Date.parse('2026-10-12T17:00:00.789Z'));
 assert.equal((await call(req())).status,204);
 t.mock.timers.setTime(Date.parse('2026-10-12T16:30:00.000Z'));
 assert.equal((await call(req())).status,204);
 const stored=await db.prepare('SELECT * FROM usage_daily').first();
 assert.equal(stored.count,23);
 assert.equal(stored.first_received_at,'2026-10-12T15:00:00.456Z');
 assert.equal(stored.last_received_at,'2026-10-12T17:00:00.789Z');
 t.mock.timers.reset();
});

test('migration preserves historical counts and null receipt bounds until a new receipt',async(t)=>{
 await legacyDB.prepare('INSERT INTO usage_daily(day,version,event,page,detail,failure,count) VALUES(?,?,?,?,?,?,?)').bind('2026-10-12',1,'page_view','charts','','',7).run();
 // Production already has 0003. Receipt migration 0002 is still additive and
 // required: an incompatible write must not falsely acknowledge storage.
 const missing=await worker.fetch(req(),{USAGE_DB:legacyDB,USAGE_ENABLED:'true'});
 assert.equal(missing.status,503);assert.equal(missing.headers.get('X-Maimai-Usage-Receipt'),null);
 await migrate(legacyDB,'0002_import_receipts.sql');
 const historical=await legacyDB.prepare('SELECT * FROM usage_daily').first();
 assert.equal(historical.count,7);assert.equal(historical.first_received_at,null);assert.equal(historical.last_received_at,null);
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-12T18:00:00.000Z')});
 assert.equal((await worker.fetch(req(),{USAGE_DB:legacyDB,USAGE_ENABLED:'true'})).status,204);
 const updated=await legacyDB.prepare('SELECT * FROM usage_daily').first();
 assert.equal(updated.count,8);assert.equal(updated.first_received_at,'2026-10-12T18:00:00.000Z');assert.equal(updated.last_received_at,'2026-10-12T18:00:00.000Z');
 const diagnosed=await worker.fetch(req({version:2,events:[diagnostic]}),{USAGE_DB:legacyDB,USAGE_ENABLED:'true'});
 assert.equal(diagnosed.status,204);assert.equal(diagnosed.headers.get('X-Maimai-Usage-Receipt'),'stored');
 assert.equal((await legacyDB.prepare('SELECT COUNT(*) AS n FROM usage_diagnostics_daily').first()).n,1);
 t.mock.timers.reset();
});

test('compiled collector stores every finite file import, provider lifecycle and tracker-link counter and rejects private siblings atomically',async()=>{
 await db.prepare('DELETE FROM usage_daily').run();
 for(let i=0;i<providerUsageRows.length;i+=16)
  assert.equal((await call(req({version:1,events:providerUsageRows.slice(i,i+16)}))).status,204);
 const {results}=await db.prepare('SELECT event,page,detail,failure,count FROM usage_daily').all();
 const ordered=rows=>rows.map(r=>JSON.stringify([r.event,r.page,r.detail,r.failure,r.count])).sort();
 assert.deepEqual(ordered(results),ordered(providerUsageRows));
 const valid=providerUsageRows[0],prior=await db.prepare('SELECT SUM(count) AS n FROM usage_daily').first();
 for(const invalid of [
  {...valid,accountID:'PRIVATE-ACCOUNT'}, {...valid,connectionID:'PRIVATE-GRANT'},
  {...valid,url:'https://provider.invalid/PRIVATE'}, {...valid,token:'PRIVATE-TOKEN'},
  {...valid,score:100.1234}, {...valid,name:'PRIVATE-NAME'}, {...valid,detail:'PRIVATE-ACCOUNT'},
  {...valid,detail:'tomomai'}, {...valid,event:'file_import_started',detail:'portable'},
  {...valid,event:'provider_file_fallback_clicked'},
  {...valid,event:'resource_opened',detail:'https://www.diving-fish.com/PRIVATE'},
  {...valid,event:'provider_refresh_auto_completed'}, {...valid,event:'provider_status_completed'},
  {...valid,event:'provider_connect_failed',failure:'PRIVATE-ERROR'},
  {...valid,event:'provider_connect_failed',failure:''}, {...valid,failure:'unavailable'}
 ])assert.equal((await call(req({version:1,events:[valid,invalid]}))).status,400);
 for(const detail of fileImportMethods){
  for(const event of ['provider_connect_started','provider_read_started','provider_refresh_started'])
   assert.equal((await call(req({version:1,events:[valid,{event,page:'charts',detail,failure:'',count:1}]}))).status,400);
  assert.equal((await call(req({version:1,events:[valid,{event:'import_started',page:'charts',detail:detail+':PRIVATE-FILENAME',failure:'',count:1}]}))).status,400);
 }
 assert.deepEqual(await db.prepare('SELECT SUM(count) AS n FROM usage_daily').first(),prior);
 for(const headers of [{DNT:'1'},{'Sec-GPC':'1'}])assert.equal((await call(req({version:1,events:[valid]},{headers}))).status,204);
 assert.equal((await call(req({version:1,events:[valid]}),'false')).status,204);
 assert.deepEqual(await db.prepare('SELECT SUM(count) AS n FROM usage_daily').first(),prior);
});
test('invalid batch is rejected whole; private sentinel never reaches D1',async()=>{
 const count=await db.prepare('SELECT SUM(count) AS n FROM usage_daily').first();
 for(const body of [{version:1,events:[row,{...row,url:'PRIVATE-SENTINEL'}]},{version:1,events:[{...row,page:'PRIVATE-SENTINEL'}]},{version:1,events:[{...row,count:101}]},{version:1,events:[{...row,event:'constructor'}]},{version:1,events:[{...row,failure:'invalid'}]},{version:1,events:Array(17).fill(row)},'x'.repeat(4097)]){
  assert.equal((await call(req(body))).status,400);
 }
 assert.deepEqual(await db.prepare('SELECT SUM(count) AS n FROM usage_daily').first(),count);
});

test('client receipt timestamps are rejected and opt-outs cannot alter aggregate receipt bounds',async()=>{
 const read=async()=>(await db.prepare('SELECT * FROM usage_daily ORDER BY day,version,event,page,detail,failure').all()).results;
 const before=await read(),value='2026-01-01T00:00:00.000Z';
 for(const field of ['first_received_at','last_received_at','receivedAt','timestamp']){
  assert.equal((await call(req({version:1,events:[row,{...row,[field]:value}]}))).status,400);
  assert.equal((await call(req({version:1,events:[row],[field]:value}))).status,400);
 }
 for(const headers of [{DNT:'1'},{'Sec-GPC':'1'}])assert.equal((await call(req(undefined,{headers}))).status,204);
 assert.equal((await call(req(),'false')).status,204);
 assert.deepEqual(await read(),before);
});
test('export actions reach D1 only as the maintained finite categories',async()=>{
 const rows=Object.entries(DETAILS).filter(([event])=>event.startsWith('score_export_')).flatMap(([event,details])=>details.map(detail=>({event,page:'song',detail,failure:'',count:1})));
 for(let offset=0;offset<rows.length;offset+=16)assert.equal((await call(req({version:1,events:rows.slice(offset,offset+16)}))).status,204);
 const before=await db.prepare("SELECT * FROM usage_daily WHERE event LIKE 'score_export_%' ORDER BY event,detail").all();
 assert.equal(before.results.length,17);assert(before.results.every(row=>row.count===1));
 for(const change of [{detail:'kanadera-magical'},{detail:'prismplus'},{detail:'PRIVATE-SENTINEL'},{failure:'PRIVATE-SENTINEL'},{song:'PRIVATE-SENTINEL'}])assert.equal((await call(req({version:1,events:[{...rows[0],...change}]}))).status,400);
 const after=await db.prepare("SELECT * FROM usage_daily WHERE event LIKE 'score_export_%' ORDER BY event,detail").all();
 assert.deepEqual(after.results,before.results);
 assert(!JSON.stringify(before).includes('PRIVATE-SENTINEL'));
});

test('exact route, origin, method, type and opt-out controls fail closed',async()=>{
 for(const url of ['https://preview.invalid/__usage','https://maimai.party/__usage?x=1','https://maimai.party/__usage/','https://maimai.party/__usage%2f','https://maimai.party/api/support/checkout'])assert.equal((await call(req(undefined,{url}))).status,404);
 assert.equal((await call(req(undefined,{method:'GET'}))).status,405);
 assert.equal((await call(req(undefined,{headers:{Origin:'https://other.invalid'}}))).status,400);
 assert.equal((await call(req(undefined,{headers:{'Content-Type':'text/plain'}}))).status,400);
 const prior=await db.prepare('SELECT SUM(count) AS n FROM usage_daily').first();
 for(const headers of [{'DNT':'1'},{'Sec-GPC':'1'}])assert.equal((await call(req(undefined,{headers}))).status,204);
 assert.equal((await call(req(),'false')).status,204);
 assert.deepEqual(await db.prepare('SELECT SUM(count) AS n FROM usage_daily').first(),prior);
});
test('database failure has no leaked error details and batch rollback is atomic',async()=>{
 const response=await worker.fetch(req(),{USAGE_ENABLED:'true',USAGE_DB:{prepare(){return {bind(){return {}}}},batch(){throw Error('PRIVATE-SENTINEL')}}});
 assert.equal(response.status,503);assert.equal(await response.text(),'');
 const before=(await db.prepare('SELECT * FROM usage_daily ORDER BY day,version,event,page,detail,failure').all()).results;
 await assert.rejects(db.batch([db.prepare("UPDATE usage_daily SET count=count+1,last_received_at='2026-12-31T23:59:59.999Z'"),db.prepare('INSERT INTO usage_daily(day,version,event,page,detail,failure,count) VALUES(?,?,?,?,?,?,?)').bind('2026-09-22',1,'x','charts','','',-1)]));
 assert.deepEqual((await db.prepare('SELECT * FROM usage_daily ORDER BY day,version,event,page,detail,failure').all()).results,before);
 // Exercise the collector's real D1 batch too: the second valid tuple fails
 // storage, rolling back the first tuple's count and receipt bounds together.
 await db.prepare("CREATE TRIGGER fixture_reject_receipt BEFORE INSERT ON usage_daily WHEN NEW.event='settings_opened' BEGIN SELECT RAISE(ABORT,'fictional storage failure'); END").run();
 try{
  const failed=await call(req({version:1,events:[row,{...row,event:'settings_opened'}]}));
  assert.equal(failed.status,503);assert.equal(await failed.text(),'');
 }finally{await db.prepare('DROP TRIGGER fixture_reject_receipt').run();}
 assert.deepEqual((await db.prepare('SELECT * FROM usage_daily ORDER BY day,version,event,page,detail,failure').all()).results,before);
});
test('New York boundary follows DST rather than UTC day',()=>{
 assert.equal(dayKey(new Date('2026-03-08T04:59:59Z')),'2026-03-07');
 assert.equal(dayKey(new Date('2026-03-08T05:00:00Z')),'2026-03-08');
 assert.equal(dayKey(new Date('2026-11-01T04:00:00Z')),'2026-11-01');
 assert.equal(dayKey(new Date('2026-11-02T04:59:59Z')),'2026-11-01');
});


test('stream limits ignore forged length and reject malformed bytes before any database write',async()=>{
 const before=await db.prepare('SELECT SUM(count) AS n FROM usage_daily').first();
 const headers={Origin:'https://maimai.party','Content-Type':'application/json'};
 const malformed=new Request('https://maimai.party/__usage',{method:'POST',headers,body:new Uint8Array([0xc3,0x28])});
 assert.equal((await call(malformed)).status,400);
 let cancelled=false,chunk=0;
 const body=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(++chunk===1?4096:1));},cancel(){cancelled=true;}});
 const oversized=new Request('https://maimai.party/__usage',{method:'POST',headers:{...headers,'Content-Length':'1'},body,duplex:'half'});
 assert.equal((await call(oversized)).status,400);assert.equal(cancelled,true);
 for(const batch of [
  {version:1,events:[row],context:'PRIVATE-SENTINEL'},
  {version:1,events:[{...row,detail:'PRIVATE-SENTINEL'}]},
  {version:1,events:[{event:'import_failed',page:'charts',detail:'file',failure:'PRIVATE-SENTINEL',count:1}]},
  {version:1,events:[{...row,count:1.5}]}
 ])assert.equal((await call(req(batch))).status,400);
 assert.deepEqual(await db.prepare('SELECT SUM(count) AS n FROM usage_daily').first(),before);
});


test('staging and production origins cannot cross their collector boundary',async()=>{
 const origin='https://maimai-party-staging.pages.dev';
 const stageRequest=()=>req(undefined,{url:origin+'/__usage',headers:{Origin:origin}});
 const prior=await db.prepare('SELECT SUM(count) AS n FROM usage_daily').first();
 await stageDB.prepare('DELETE FROM usage_daily').run();
 const stageEnv={USAGE_DB:stageDB,USAGE_ENABLED:'true'};
 assert.equal((await worker.fetch(stageRequest(),{USAGE_DB:db,USAGE_ENABLED:'true'})).status,404);
 assert.equal((await staging.fetch(req(),stageEnv)).status,404);
 assert.equal((await staging.fetch(stageRequest(),stageEnv)).status,204);
 assert.equal((await stageDB.prepare('SELECT SUM(count) AS n FROM usage_daily').first()).n,1);
 assert.deepEqual(await db.prepare('SELECT SUM(count) AS n FROM usage_daily').first(),prior);
 assert.equal((await staging.fetch(req(undefined,{url:origin+'/__usage'}),stageEnv)).status,400);
 assert.equal((await staging.fetch(req(undefined,{url:origin+'/__usage',headers:{Origin:origin,DNT:'1'}}),stageEnv)).status,204);
 assert.equal((await stageDB.prepare('SELECT SUM(count) AS n FROM usage_daily').first()).n,1);
});
