// Local development only. No Cloudflare configuration, accounts or routes change.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createService,PATH} from '../player-import-worker/index.mjs';
import {validInput} from '../player-import-worker/contract.mjs';
import '../src/maimai_intelligence/assets/player-maishift.js';

const PREFIX='/pilot/maishift/';
const policy={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',
  'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"};
const json=(status,error,extra={})=>Response.json({error},{status,headers:{...policy,...extra}});
export async function loadAssets(directory){
  const root=resolve(directory);
  if(!/^C:\\DevCache\\/i.test(root))throw Error('DevCache artifact required');
  const manifest=JSON.parse(await readFile(join(root,'pilot-artifact.json'),'utf8')),assets=new Map();
  if(manifest.schemaVersion!=='maishift-pilot-artifact-1')throw Error('Invalid pilot artifact');
  const names=new Set(['index.html','pilot.css','pilot.js','pilot-core.js','player-data-core.js','player-maishift.js','localization.css','localization.js','mapping.json']);
  for(const [name,digest]of Object.entries(manifest.files)){
    if(name==='_headers')continue;
    if(!name.startsWith(PREFIX.slice(1))||!names.delete(name.slice(PREFIX.length-1)))throw Error('Invalid artifact file');
    const bytes=await readFile(join(root,name));
    if(createHash('sha256').update(bytes).digest('hex')!==digest)throw Error('Artifact integrity failed');
    const type=name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'application/json';
    assets.set('/'+name,{bytes,type});
  }
  if(names.size)throw Error('Incomplete artifact');
  return assets;
}

export function createPreview({assets,origin,approved=null,fetcher=fetch,now=Date.now}){
  if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw Error('Loopback origin required');
  const service=createService({fetcher,now});let attempts=0,lastAttempt=null,lease=null,leaseUntil=0,retryAt=0;
  // Explicit local equivalents, not a claim of deployed Durable Object behavior.
  const coordinator={
    async claim(){const until=Math.max(retryAt,leaseUntil,lastAttempt===null?0:lastAttempt+30000);if(until>now())return {retryAt:until};lastAttempt=now();lease=crypto.randomUUID();leaseUntil=now()+45000;return {id:lease};},
    async finish(id,retry){if(id===lease){leaseUntil=0;retryAt=Number.isSafeInteger(retry)?retry:0;}},
  };
  return async request=>{
    const url=new URL(request.url);
    if(url.origin!==origin||url.search||url.hash)return json(404,'not_found');
    if(url.pathname!==PATH){
      if(!['GET','HEAD'].includes(request.method))return json(405,'method_not_allowed');
      const asset=assets.get(url.pathname===PREFIX?PREFIX+'index.html':url.pathname);
      return asset?new Response(request.method==='HEAD'?null:asset.bytes,{headers:{...policy,'Content-Type':asset.type+'; charset=utf-8'}}):json(404,'not_found');
    }
    if(request.method!=='POST')return json(405,'method_not_allowed');
    if(request.headers.get('origin')!==origin||['cross-site','none'].includes(request.headers.get('sec-fetch-site'))||['cookie','authorization','referer'].some(k=>request.headers.has(k)))return json(403,'origin_not_allowed');
    if(!approved)return json(503,'integration_disabled');
    if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||'')||Number(request.headers.get('content-length'))>2048)return json(400,'invalid_request');
    const reader=request.body?.getReader();if(!reader)return json(400,'invalid_request');
    const chunks=[];let size=0,input;
    try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>2048)return json(413,'invalid_request');chunks.push(value);}input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
    catch{return json(400,'invalid_request');}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    if(!validInput(input)||!input.manual)return json(400,'invalid_request');
    if(input.handle!==approved.handle||input.region!==approved.region)return json(403,'profile_not_approved');
    if(attempts>=6)return json(429,'rate_limited',{'Retry-After':'3600'});
    const until=Math.max(retryAt,leaseUntil,lastAttempt===null?0:lastAttempt+30000);
    if(until>now())return json(429,'rate_limited',{'Retry-After':String(Math.ceil((until-now())/1000))});
    attempts++;
    // Translate only the strictly checked local development request. Production
    // origin validation stays unchanged and never accepts localhost directly.
    return service.fetch(new Request('https://maimai.party'+PATH,{method:'POST',headers:{Origin:'https://maimai.party','Content-Type':'application/json','CF-Connecting-IP':'127.0.0.1'},body:JSON.stringify(input),signal:request.signal}),
      {MAISHIFT_ENABLED:'true',CLIENT_LIMITER:{limit:async()=>({success:true})},PROFILE_LIMITER:{getByName:()=>coordinator}});
  };
}

export async function startPreview({artifact,port=8895,approved=null,fetcher=fetch}){
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid preview port');
  const origin='http://127.0.0.1:'+port,handle=createPreview({assets:await loadAssets(artifact),origin,approved,fetcher});
  const server=createServer({requestTimeout:5000,headersTimeout:5000},async(req,res)=>{
    const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});
    try{
      if(req.headers.host!=='127.0.0.1:'+port||!req.url?.startsWith('/')||req.url.startsWith('//')){res.writeHead(403,policy);res.end();return;}
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2048){res.writeHead(413,policy);res.end();return;}chunks.push(chunk);}
      const response=await handle(new Request(origin+req.url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks),signal:controller.signal}));
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
    }catch{if(!res.headersSent)res.writeHead(502,policy);res.end();}
  });
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',ok);});return server;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    let approved=null;
    if(process.env.MAISHIFT_PREVIEW_LIVE==='true'){
      if(process.env.MAISHIFT_CANARY_APPROVED!=='true')throw Error('Explicit profile approval required');
      approved=maimaiPlayerMaishift.location(process.env.MAISHIFT_CANARY_URL||'',process.env.MAISHIFT_CANARY_REGION);
    }
    const port=Number(process.env.MAISHIFT_PREVIEW_PORT||8895);
    const server=await startPreview({artifact:process.env.MAISHIFT_PREVIEW_ARTIFACT||'',port,approved});
    console.log(JSON.stringify({preview:'http://127.0.0.1:'+port+PREFIX,liveReads:!!approved,maximumReads:6,public:false}));
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.close();server.closeAllConnections();});
  }catch{console.error('Local pilot could not start. Check the artifact, port and explicit profile approval.');process.exitCode=1;}
}
