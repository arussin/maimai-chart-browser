/* maimai-player-data v1. No network or application dependencies. */
(()=>{'use strict';if(globalThis.maimaiPlayerData)return;
const MAX_COMPRESSED=32*1024*1024,MAX_DECODED=128*1024*1024,HEX=/^[a-f0-9]{64}$/;
const fail=message=>{throw new Error(message);};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const keys=(value,names)=>object(value)&&Object.keys(value).sort().join('|')===[...names].sort().join('|');
const text=(v,max=512,empty=false)=>typeof v==='string'&&v.length<=max&&(empty||v.length>0)&&!/[\x00-\x1f\uD800-\uDFFF]/u.test(v);
const integer=(v,max=Number.MAX_SAFE_INTEGER,nullable=false)=>(nullable&&v===null)||(Number.isSafeInteger(v)&&v>=0&&v<=max);
function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(object(v))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v);}
async function hash(v){const bytes=typeof v==='string'?new TextEncoder().encode(v):v;return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');}
const digest=v=>hash(canonical(v));
const recordFields=['chartID','achievement','grade','rate','lamp','sync','constant','displayVersion','timeAchieved','dxScore','maxDxScore','maxCombo','fast','slow','miss','good','great','perfect','pcrit'];
const chartFields=['chartID','songID','title','artist','format','difficulty','level','constant','displayVersion','inGameID'];
function structure(d){
  if(!keys(d,['format','schemaVersion','revision','player','charts','records','plays','snapshots','captures'])||d.format!=='maimai-player-data'||d.schemaVersion!==1)fail('Unsupported player file. Choose a maimai-player-data v1 export.');
  const p=d.player;if(!keys(p,['key','provider','game','username','displayName'])||!Object.values(p).every(v=>text(v,200))||p.provider!=='kamaitachi'||p.game!=='maimaidx'||p.key!=='kamaitachi:maimaidx:'+p.username.toLowerCase())fail('Invalid player identity.');
  for(const name of ['charts','records','plays','snapshots','captures'])if(!object(d[name])||Object.keys(d[name]).length>1000000||!Object.keys(d[name]).every(k=>text(k,256)&&!["__proto__","constructor","prototype"].includes(k)))fail('Invalid or oversized player collection.');
  for(const [id,c]of Object.entries(d.charts))if(!keys(c,chartFields)||c.chartID!==id||!['STD','DX'].includes(c.format)||!['chartID','songID','format','difficulty'].every(k=>text(c[k],256))||!['title','artist','level','displayVersion'].every(k=>text(c[k],512,true))||!integer(c.constant,200,true)||!integer(c.inGameID,undefined,true))fail('Invalid chart reference.');
  for(const [id,r]of Object.entries(d.records)){
    if(!HEX.test(id)||!keys(r,recordFields)||typeof r.chartID!=="string"||!Object.hasOwn(d.charts,r.chartID)||!integer(r.achievement,1010000,true)||!integer(r.constant,200,true))fail('Invalid score observation.');
    for(const k of ['grade','lamp','sync','displayVersion'])if(!text(r[k],512,true))fail('Invalid score text.');
    for(const k of recordFields.filter(k=>!['chartID','achievement','constant','grade','lamp','sync','displayVersion'].includes(k)))if(!integer(r[k],undefined,true))fail('Invalid score measurement.');
  }
  for(const ref of Object.values(d.plays))if(typeof ref!=='string'||!Object.hasOwn(d.records,ref))fail('Missing play observation.');
  for(const [id,s]of Object.entries(d.snapshots)){
    if(!HEX.test(id)||!keys(s,['capturedAt','phase','complete','versions','pbs'])||!integer(s.capturedAt)||!['before','after'].includes(s.phase)||typeof s.complete!=='boolean'||!Array.isArray(s.versions)||!s.versions.every(v=>text(v))||!object(s.pbs))fail('Invalid PB snapshot.');
    for(const [cid,ref]of Object.entries(s.pbs))if(typeof ref!=="string"||!Object.hasOwn(d.records,ref)||d.records[ref].chartID!==cid)fail('PB chart mismatch.');
  }
  for(const [id,c]of Object.entries(d.captures)){
    if(!HEX.test(id)||!keys(c,['capturedAt','sourceKind','sourceID','sessionID','historyCoverage','playIDs','snapshotIDs'])||!integer(c.capturedAt)||!['sourceKind','sourceID','sessionID','historyCoverage'].every(k=>text(c[k],512,true)))fail('Invalid capture.');
    for(const [k,collection]of [['playIDs','plays'],['snapshotIDs','snapshots']])if(!Array.isArray(c[k])||new Set(c[k]).size!==c[k].length||!c[k].every(ref=>typeof ref==="string"&&Object.hasOwn(d[collection],ref)))fail('Missing capture observations.');
  }
  if(!HEX.test(d.revision))fail('Invalid dataset revision.');return d;
}
async function validate(d){structure(d);const {revision,...body}=d;if(await digest(body)!==revision)fail('Player file integrity check failed.');
  for(const name of ['records','snapshots','captures']){const rows=Object.entries(d[name]);for(let i=0;i<rows.length;i+=128)await Promise.all(rows.slice(i,i+128).map(async([id,row])=>{if(await digest(row)!==id)fail('Observation integrity check failed.');}));}return d;
}
async function bounded(stream,maximum){const reader=stream.getReader(),chunks=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maximum)fail('Player history exceeds its size limit; nothing was replaced.');chunks.push(value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return bytes;}
async function decode(input){const bytes=input instanceof Uint8Array?input:new Uint8Array(input);if(bytes.length>MAX_COMPRESSED)fail('Player file exceeds 32 MiB.');if(typeof DecompressionStream==='undefined')fail('This browser cannot read compressed player files. Please update your browser.');try{const raw=await bounded(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),MAX_DECODED);return await validate(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)));}catch(e){throw new Error(e.message||'Invalid compressed player file.');}}
async function encode(d){structure(d);const raw=new TextEncoder().encode(canonical(d));if(raw.length>MAX_DECODED)fail('Expanded player history exceeds 128 MiB.');return bounded(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip')),MAX_COMPRESSED);}
function current(d){let refs={},snapshot=null;for(const [id,s]of Object.entries(d.snapshots).sort(([a,x],[b,y])=>x.capturedAt-y.capturedAt||Number(x.phase==='after')-Number(y.phase==='after')||(a<b?-1:a>b?1:0))){if(s.complete)refs={};Object.assign(refs,s.pbs);snapshot=s;}return {pbs:new Map(Object.entries(refs).map(([cid,ref])=>[cid,d.records[ref]])),snapshot};}
function offer(d){const {pbs,snapshot}=current(d);return {format:d.format,schemaVersion:1,revision:d.revision,player:d.player,capturedAt:snapshot?.capturedAt||0,pbCount:pbs.size,pbCoverage:snapshot?.complete?'complete':'partial',playCount:Object.keys(d.plays).length,snapshotIDs:Object.keys(d.snapshots).sort(),captureIDs:Object.keys(d.captures).sort(),historyCoverage:'retained-only'};}
function validateOffer(o){if(!object(o)||o.format!=='maimai-player-data'||o.schemaVersion!==1||!HEX.test(o.revision)||!keys(o.player,['key','provider','game','username','displayName'])||!Object.values(o.player).every(v=>text(v,200))||o.player.provider!=='kamaitachi'||o.player.game!=='maimaidx'||o.player.key!=='kamaitachi:maimaidx:'+o.player.username.toLowerCase()||!integer(o.capturedAt)||!integer(o.pbCount,1000000)||!['complete','partial'].includes(o.pbCoverage)||o.historyCoverage!=='retained-only'||!integer(o.playCount,1000000))fail('Invalid report data offer.');for(const k of ['snapshotIDs','captureIDs'])if(!Array.isArray(o[k])||o[k].length>100000||!o[k].every(x=>typeof x==='string'&&HEX.test(x)))fail('Invalid report history offer.');return o;}
function needsUpdate(d,o){validateOffer(o);if(!d||d.player.key!==o.player.key)return true;if(d.revision===o.revision)return false;return o.snapshotIDs.some(id=>!Object.hasOwn(d.snapshots,id))||o.captureIDs.some(id=>!Object.hasOwn(d.captures,id));}
function observationDates(d){const dates={charts:{},plays:{}};for(const c of Object.values(d.captures))for(const id of c.playIDs)dates.plays[id]=Math.max(dates.plays[id]||0,c.capturedAt);for(const [id,time]of Object.entries(dates.plays)){const cid=d.records[d.plays[id]].chartID;dates.charts[cid]=Math.max(dates.charts[cid]||0,time);}for(const s of Object.values(d.snapshots))for(const cid of Object.keys(s.pbs))dates.charts[cid]=Math.max(dates.charts[cid]||0,s.capturedAt);return dates;}
async function merge(a,b){structure(a);structure(b);if(a.player.key!==b.player.key)fail('Different players cannot be merged.');const d=structuredClone(a),at=offer(a).capturedAt,bt=offer(b).capturedAt,ad=observationDates(a),bd=observationDates(b);if(bt>at||(bt===at&&canonical(b.player)>=canonical(a.player)))d.player=structuredClone(b.player);
  for(const name of ['records','snapshots','captures'])for(const [id,row]of Object.entries(b[name])){if(Object.hasOwn(d[name],id)&&canonical(d[name][id])!==canonical(row))fail('Conflicting retained observation.');d[name][id]=row;}
  for(const name of ['charts','plays'])for(const [id,row]of Object.entries(b[name])){const old=d[name][id];if(old===undefined||(bd[name][id]||0)>(ad[name][id]||0)||((bd[name][id]||0)===(ad[name][id]||0)&&canonical(row)>=canonical(old)))d[name][id]=row;}
  const {revision,...body}=d;d.revision=await digest(body);return structure(d);
}
globalThis.maimaiPlayerData=Object.freeze({validate,structure,decode,encode,current,offer,validateOffer,needsUpdate,merge,hash,digest,canonical,bounded,MAX_COMPRESSED,MAX_DECODED});
})();
