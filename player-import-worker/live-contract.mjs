// Manually invoked only. Explicit per-run canary approval; aggregate output only.
import {createService,PATH} from './index.mjs';
import {readFile} from 'node:fs/promises';
import '../src/maimai_intelligence/assets/player-data-core.js';
import '../src/maimai_intelligence/assets/player-maishift.js';
const adapter=globalThis.maimaiPlayerMaishift,core=globalThis.maimaiPlayerData;
let selected;
try{
  if(process.env.MAISHIFT_CANARY_APPROVED!=='true')throw new Error();
  selected=adapter.location(process.env.MAISHIFT_CANARY_URL||'',process.env.MAISHIFT_CANARY_REGION);
}catch{console.error('An explicitly approved public canary URL and game region are required.');process.exit(2);}
const request=new Request('https://maimai.party'+PATH,{method:'POST',headers:{Origin:'https://maimai.party','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1'},body:JSON.stringify({...selected,url:undefined,manual:true})});
// Invocation is one bounded import, not a deployed route or scheduler. The
// deterministic tests exercise the real coordinator separately.
const service=createService();
const response=await service.fetch(request,{MAISHIFT_ENABLED:'true',CLIENT_LIMITER:{limit:async()=>({success:true})},PROFILE_LIMITER:{getByName:()=>({claim:async()=>({id:'manual-canary'}),finish:async()=>{}})}});
if(!response.ok){console.log(JSON.stringify({adapterVersion:1,transport:'server',status:response.status,error:(await response.json()).error,releaseGate:'incomplete'}));process.exitCode=2;}
else{
  try{
    const payload=await response.json(),result=await adapter.normalize(payload,selected);await core.validate(result.data);
    const mappings=JSON.parse(await readFile(new URL('../registry/mappings.json',import.meta.url))),charts=JSON.parse(await readFile(new URL('../registry/charts.json',import.meta.url)));
    const lookup=new Map(Object.values(mappings).filter(m=>m.provider==='maishift'&&m.game==='maimaidx'&&m.state==='accepted').map(m=>['maishift:'+m.provider_id,{...m,chart_id:m.subject_id}]));
    const matched=Object.values(result.data.charts).filter(c=>{const row=lookup.get(c.chartID);return adapter.matchChart(result.data.player,c,row,charts[row?.chart_id]);}).length;
    console.log(JSON.stringify({adapterVersion:1,transport:'server',normalized:true,totalCharts:payload.coverage.totalCharts,playedCharts:payload.coverage.playedCharts,importedCharts:payload.coverage.importedCharts,diagnosticCount:payload.coverage.diagnosticCount,complete:false,matchedCharts:matched,unmatchedCharts:payload.coverage.importedCharts-matched,plays:0,releaseGate:'incomplete'}));
    if(matched!==payload.coverage.importedCharts||payload.coverage.diagnosticCount)process.exitCode=2;
  }catch{console.log(JSON.stringify({adapterVersion:1,transport:'server',error:'normalization_failed',releaseGate:'incomplete'}));process.exitCode=2;}
}
