export {validateRow} from '../web/src/usage-contract';
import {validateBatch} from '../web/src/usage-contract';
const headers={'Cache-Control':'no-store','Content-Type':'text/plain; charset=utf-8','X-Content-Type-Options':'nosniff'};
const answer=(status:number)=>new Response(null,{status,headers});
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
export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    const url=new URL(request.url);
    if(url.protocol!=='https:'||url.host!=='maimai.party'||url.pathname!=='/__usage'||request.url.includes('?'))return answer(404);
    if(request.method!=='POST')return answer(405);
    if(request.headers.get('Origin')!=='https://maimai.party'||request.headers.get('Content-Type')!=='application/json')return answer(400);
    if(request.headers.get('Sec-GPC')==='1'||request.headers.get('DNT')==='1'||String(env.USAGE_ENABLED)!=='true')return answer(204);
    let batch;try{batch=validateBatch(await readBody(request));}catch{return answer(400);}
    if(!batch)return answer(400);
    if(!env.USAGE_DB)return answer(503);
    const day=dayKey(new Date());
    try{
      await env.USAGE_DB.batch(batch.events.map(row=>env.USAGE_DB.prepare(
        'INSERT INTO usage_daily(day,version,event,page,detail,failure,count) VALUES(?,?,?,?,?,?,?) ON CONFLICT(day,version,event,page,detail,failure) DO UPDATE SET count=count+excluded.count'
      ).bind(day,batch.version,row.event,row.page,row.detail,row.failure,row.count)));
      return answer(204);
    }catch{return answer(503);}
  }
} satisfies ExportedHandler<Env>;
