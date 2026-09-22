import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import worker,{dayKey} from '../worker.mjs';
let mf,db;
before(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("local fixture")}}',compatibilityDate:'2026-09-22',d1Databases:['USAGE_DB'],outboundService:()=>{throw Error('No external requests allowed')}}));
 db=await mf.getD1Database('USAGE_DB');
 for(const sql of (await readFile(new URL('../migrations/0001_daily.sql',import.meta.url),'utf8')).replace(/--[^\n]*/g,'').split(';').filter(s=>s.trim()))await db.prepare(sql).run();
});
after(async()=>{await mf?.dispose();});
const row={event:'page_view',page:'charts',detail:'',count:1};
const req=(body={version:1,events:[row]},opts={})=>new Request(opts.url||'https://maimai.party/__usage',{method:opts.method||'POST',headers:{Origin:'https://maimai.party','Content-Type':'application/json',...opts.headers},...(opts.method==='GET'?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
const call=(request,enabled='true')=>worker.fetch(request,{USAGE_DB:db,USAGE_ENABLED:enabled});
test('only finite aggregate fields are stored and concurrent increments sum',async()=>{
 await db.prepare('DELETE FROM usage_daily').run();
 const responses=await Promise.all(Array.from({length:20},()=>call(req())));
 assert.ok(responses.every(r=>r.status===204));
 const {results}=await db.prepare('SELECT * FROM usage_daily').all();assert.equal(results.length,1);assert.equal(results[0].count,20);
 assert.deepEqual(Object.keys(results[0]).sort(),['count','day','detail','event','failure','page','version']);
});
test('invalid batch is rejected whole; private sentinel never reaches D1',async()=>{
 const count=await db.prepare('SELECT SUM(count) AS n FROM usage_daily').first();
 for(const body of [{version:1,events:[row,{...row,url:'PRIVATE-SENTINEL'}]},{version:1,events:[{...row,page:'PRIVATE-SENTINEL'}]},{version:1,events:[{...row,count:101}]},{version:1,events:[{...row,event:'constructor'}]},{version:1,events:[{...row,failure:'invalid'}]},{version:1,events:Array(17).fill(row)},'x'.repeat(4097)]){
  assert.equal((await call(req(body))).status,400);
 }
 assert.deepEqual(await db.prepare('SELECT SUM(count) AS n FROM usage_daily').first(),count);
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
 const before=await db.prepare('SELECT SUM(count) AS n FROM usage_daily').first();
 await assert.rejects(db.batch([db.prepare('UPDATE usage_daily SET count=count+1'),db.prepare('INSERT INTO usage_daily VALUES(?,?,?,?,?,?,?)').bind('2026-09-22',1,'x','charts','','',-1)]));
 assert.deepEqual(await db.prepare('SELECT SUM(count) AS n FROM usage_daily').first(),before);
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
