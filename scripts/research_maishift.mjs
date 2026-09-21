// Explicit, bounded research of one owner-approved public canary. No raw profile
// or PB data is retained. Output metadata contains no played flags or scores.
import fs from 'node:fs/promises';
import path from 'node:path';
import {upstreamURL,decode,FUNCTIONS,profile as validateProfile} from '../player-import-worker/contract.mjs';
import {boundedJSON,hash} from '../player-import-worker/index.mjs';
const approved=process.env.MAISHIFT_CANARY_APPROVED==='true',handle=process.env.MAISHIFT_CANARY_HANDLE;
const output=process.env.MAISHIFT_RESEARCH_OUTPUT;
if(!approved||!handle||!/^[A-Za-z0-9_-]{1,64}$/.test(handle)||!output||!path.resolve(output).startsWith('C:\\DevCache\\'))throw new Error('An explicitly approved canary and DevCache output directory are required.');
await fs.mkdir(output,{recursive:true});
const charts=JSON.parse(await fs.readFile('registry/charts.json','utf8')),songs=JSON.parse(await fs.readFile('registry/songs.json','utf8'));
const ordinary=Object.values(charts).filter(c=>c.variant_id==='ordinary').map(c=>({...c,...songs[c.song_id]?.metadata}));
const normalize=v=>(v||'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
function key(c,normal=false){return JSON.stringify([normal?normalize(c.title):c.title,normal?normalize(c.artist):c.artist,c.format,c.difficulty]);}
function index(normal){const map=new Map();for(const c of ordinary){const k=key(c,normal);map.set(k,[...map.get(k)||[],c.chart_id]);}return map;}
const exact=index(false),normalized=index(true),summaries={},dates={};
// Observed in the public export route loader. Research only: this endpoint is
// deliberately not added to the production proxy's two-destination allowlist.
const exportFunction='ca4efd7b63caa72a7c873fad22347161ae254a3562ed2006800d903e45c4a271';
const canonical=v=>JSON.stringify(v,(_k,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])):value);
const rows=data=>data.tracks.map(t=>canonical({...t,s:data.songs[t.s]})).sort();
const group=rows=>rows.reduce((counts,t)=>{const k=t.d;counts[k]=(counts[k]||0)+1;return counts;},{});
for(const region of ['intl','jp']){
  const input={handle,region,manual:true};
  async function read(kind){const url=kind==='export'?upstreamURL('tracks',input).replace(FUNCTIONS.tracks,exportFunction):upstreamURL(kind,input);const signal=AbortSignal.timeout(20000);const r=await fetch(url,{headers:{Accept:'application/json','x-tsr-serverFn':'true'},redirect:'manual',credentials:'omit',referrerPolicy:'no-referrer',signal});if(!r.ok)throw new Error('upstream_unavailable');return decode(await boundedJSON(r,4*1024*1024,signal));}
  try{
    const profile=await read('profile'),data=await read('tracks'),exported=await read('export'),after=await read('profile');
    const identity=validateProfile(profile,input),afterIdentity=validateProfile(after,input);
    dates[region]={createdAt:identity.createdAt,updatedAt:identity.updatedAt};
    const counts={charts:data.tracks.length,played:0,strictUnique:0,normalizedUnique:0,ambiguous:0,unmatched:0,playedStrictUnique:0,playedNormalizedUnique:0,playedAmbiguous:0,playedUnmatched:0},metadata=[],unmatched=[];
    for(const t of data.tracks){
      const s=data.songs[t.s],row={id:t.i,title:s?.title??'',artist:s?.artist??'',format:s?.type==='STANDARD'?'STD':s?.type,difficulty:t.d==='RE_MASTER'?'RE:MASTER':t.d,constant:t.x===0?null:t.l??null};
      if(t.r)counts.played++;
      const strict=row.title&&row.artist?exact.get(key(row))||[]:[],loose=row.title&&row.artist?normalized.get(key(row,true))||[]:[];
      const state=strict.length===1?'strictUnique':loose.length===1?'normalizedUnique':strict.length>1||loose.length>1?'ambiguous':'unmatched';counts[state]++;if(t.r)counts['played'+state[0].toUpperCase()+state.slice(1)]++;
      // Only public song metadata used in the identity investigation is saved.
      metadata.push({...row,sourceSongMetadata:{title:s.title,artist:s.artist,type:s.type,jacketUrl:s.jacketUrl},candidateChartIDs:strict.length?strict:loose,candidateBasis:state});
      if(state==='unmatched'||state==='ambiguous')unmatched.push(row);
    }
    const p=profile?.userRecord?.profile;
    summaries[region]={counts,profileFields:Object.keys(profile||{}),userRecordFields:Object.keys(profile?.userRecord||{}),profileMetadataFields:Object.keys(p||{}),tracksComplete:profile?.userRecord?.tracksComplete??null,profileSummary:{keys:Object.keys(profile?.userRecord?.tracks||{}),songs:Array.isArray(profile?.userRecord?.tracks?.songs)?profile.userRecord.tracks.songs.length:null,charts:Array.isArray(profile?.userRecord?.tracks?.tracks)?profile.userRecord.tracks.tracks.length:null,played:Array.isArray(profile?.userRecord?.tracks?.tracks)?profile.userRecord.tracks.tracks.filter(t=>t.r).length:null},
      sourceStableDuringRead:canonical(identity)===canonical(afterIdentity),exportMatchesFullTracks:canonical(rows(data))===canonical(rows(exported.packed)),exportCharts:exported.packed.tracks.length,exportPlayed:exported.packed.tracks.filter(t=>t.r).length,
      playedByDifficulty:group(data.tracks.filter(t=>t.r)),playedByFormat:Object.fromEntries(['STANDARD','DX'].map(format=>[format,data.tracks.filter(t=>t.r&&data.songs[t.s].type===format).length])),
      chartMetadataDigest:await hash(JSON.stringify(metadata)),chartIdUnique:new Set(metadata.map(c=>c.id)).size===metadata.length,unmatchedMetadataExamples:unmatched.slice(0,8)};
    await fs.writeFile(path.join(output,'catalog-'+region+'.json'),JSON.stringify(metadata));
  }catch{summaries[region]={failure:'bounded_public_contract_read_failed'};}
}
try{if(!summaries.intl.counts||!summaries.jp.counts)throw new Error('Incomplete regional reads');const intl=JSON.parse(await fs.readFile(path.join(output,'catalog-intl.json'),'utf8')),jp=JSON.parse(await fs.readFile(path.join(output,'catalog-jp.json'),'utf8')),byId=new Map(jp.map(c=>[c.id,c]));let shared=0,same=0;for(const c of intl){const other=byId.get(c.id);if(other){shared++;if(key(c)===key(other))same++;}}summaries.regionComparison={sharedIDs:shared,identicalMetadata:same,profileCreatedAtEqual:dates.intl?.createdAt===dates.jp?.createdAt,profileUpdatedAtEqual:dates.intl?.updatedAt===dates.jp?.updatedAt};}catch{}
await fs.writeFile(path.join(output,'summary.json'),JSON.stringify(summaries,null,2));
console.log(JSON.stringify(summaries,null,2));
if(Object.values(summaries).some(s=>s.failure))process.exitCode=1;
