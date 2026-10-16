import {validateBatch} from '../web/src/usage-contract';
import {validateDiagnosticBatch} from '../web/src/diagnostic-contract';
const headers={'Cache-Control':'no-store','Content-Type':'text/plain; charset=utf-8','X-Content-Type-Options':'nosniff'};
const answer=(status:number,stored=false)=>new Response(null,{status,headers:{...headers,'X-Maimai-Usage-Schema':'1,2',...(stored?{'X-Maimai-Usage-Receipt':'stored'}:{})}});
export function dayKey(now:Date):string{
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
async function readBody(request:Request):Promise<unknown>{
  const length=request.headers.get('Content-Length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>4096))throw Error('size');
  if(!request.body)throw Error('empty');
  const reader=request.body.getReader(),parts:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096)throw Error('size');parts.push(value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
/** Only separately built entry points choose a collector origin. */
export function createCollector(origin: 'https://maimai.party' | 'https://maimai-party-staging.pages.dev') {
return {
  async fetch(request:Request,env:Env):Promise<Response>{
    const url=new URL(request.url);
    if(url.origin!==origin||url.pathname!=='/__usage'||request.url.includes('?'))return answer(404);
    if(request.method!=='POST')return answer(405);
    if(request.headers.get('Origin')!==origin||request.headers.get('Content-Type')!=='application/json')return answer(400);
    if(request.headers.get('Sec-GPC')==='1'||request.headers.get('DNT')==='1'||String(env.USAGE_ENABLED)!=='true')return answer(204);
    let batch;try{const body=await readBody(request);batch=validateBatch(body)??validateDiagnosticBatch(body);}catch{return answer(400);}
    if(!batch)return answer(400);
    if(!env.USAGE_DB)return answer(503);
    const now=new Date(),day=dayKey(now),received=now.toISOString();
    try{
      if(batch.version===2)await env.USAGE_DB.batch(batch.events.map(row=>env.USAGE_DB.prepare(
        'INSERT INTO usage_diagnostics_daily(day,version,instrumentation,operation,stage,reason,outcome,source,mode,duration,count,first_received_at,last_received_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(day,version,instrumentation,operation,stage,reason,outcome,source,mode,duration) DO UPDATE SET count=count+excluded.count,last_received_at=MAX(last_received_at,excluded.last_received_at),first_received_at=MIN(first_received_at,excluded.first_received_at)'
      ).bind(day,2,row.instrumentation,row.operation,row.stage,row.reason,row.outcome,row.source,row.mode,row.duration,row.count,received,received)));
      else await env.USAGE_DB.batch(batch.events.map(row=>env.USAGE_DB.prepare(
        'INSERT INTO usage_daily(day,version,event,page,detail,failure,count) VALUES(?,?,?,?,?,?,?) ON CONFLICT(day,version,event,page,detail,failure) DO UPDATE SET count=count+excluded.count'
      ).bind(day,batch.version,row.event,row.page,row.detail,row.failure,row.count)));
      return answer(204,true);
    }catch{return answer(503);}
  }
} satisfies ExportedHandler<Env>;

}
