/* Opt-in pilot evidence stays in tab memory. This never enables normal imports. */
(()=>{'use strict';
const core=globalThis.maimaiPlayerData,adapter=globalThis.maimaiPlayerMaishift;
const PATH='/api/player-import/maishift',MAX=4*1024*1024;
const measures=['achievement','dxScore','maxDxScore','rate','lamp','sync'];
function compare(before,after){
  const a=core.current(before).pbs,b=core.current(after).pbs;
  const result={added:0,removed:0,changed:0,lowerAchievements:0,unknownTransitions:0,metadataChanged:0,
    timeOrder:core.offer(after).capturedAt>core.offer(before).capturedAt?'advanced':core.offer(after).capturedAt===core.offer(before).capturedAt?'equal':'regressed'};
  for(const [id,row]of b){
    const old=a.get(id);if(!old){result.added++;continue;}
    if(measures.some(k=>row[k]!==old[k]))result.changed++;
    if(row.achievement!==null&&old.achievement!==null&&row.achievement<old.achievement)result.lowerAchievements++;
    if(measures.some(k=>(row[k]===null)!==(old[k]===null)))result.unknownTransitions++;
    if(core.canonical(before.charts[id])!==core.canonical(after.charts[id]))result.metadataChanged++;
  }
  for(const id of a.keys())if(!b.has(id))result.removed++;
  return result;
}
const same=delta=>['added','removed','changed','metadataChanged'].every(k=>delta[k]===0);
function assess(baseline,updated,confirmed,kind){
  if(!baseline)return 'needs_baseline';
  if([baseline,updated,confirmed].filter(Boolean).some(s=>s.summary.unmatched||s.summary.excluded))return 'mapping_or_coverage_review';
  if(!baseline.summary.played)return 'needs_played_profile';
  if(!updated)return 'needs_changed_upload';
  const change=compare(baseline.data,updated.data);
  if(!same(change)&&change.timeOrder!=='advanced')return 'timestamp_failed';
  if(change.removed)return 'missing_records_review';
  if(!change.added&&!change.changed)return 'needs_changed_upload';
  if(kind==='correction'&&!change.lowerAchievements)return 'needs_lower_correction';
  if(!confirmed)return 'needs_stable_check';
  const stability=compare(updated.data,confirmed.data);
  if(!same(stability)||stability.timeOrder==='regressed')return 'snapshot_changed_again';
  return 'observed_pass';
}
function create({mapping,targets,build,fetcher=fetch,now=Date.now}){
  let baseline=null,updated=null,confirmed=null,selected=null,kind='upload',controller=null,generation=0,busy=false,attempts=0,retryAt=0,lastError=null;
  function report(){
    return {schemaVersion:'maishift-pilot-report-1',build,region:selected?.region??null,declaredChange:kind,
      attempts,lastError,outcome:lastError?'read_failed':assess(baseline,updated,confirmed,kind),
      baseline:baseline?.summary??null,updated:updated?.summary??null,confirmed:confirmed?.summary??null,
      changes:baseline&&updated?compare(baseline.data,updated.data):null,
      stability:updated&&confirmed?compare(updated.data,confirmed.data):null,
      releaseReady:false,scope:'one-profile-observation',versionTransition:'tester-declared',remainingChecks:['storage','deployed-resources']};
  }
  async function capture({value,region,consent=false,phase,changeKind='upload'}={}){
    if(busy)throw Error('busy');
    if(attempts>=6)throw Error('attempt_limit');
    if(now()<retryAt)throw Error('cooldown');
    if(!['baseline','updated','confirmed'].includes(phase)||!['upload','correction','version'].includes(changeKind))throw Error('invalid_step');
    if(phase==='baseline'&&baseline||phase!=='baseline'&&!baseline||phase==='confirmed'&&!updated)throw Error('invalid_step');
    let location;
    if(phase==='baseline'){
      if(!consent)throw Error('consent_required');
      try{location=adapter.location(value,region);}catch{throw Error('invalid_profile');}
    }else location=selected;
    const expected=generation;controller=new AbortController();const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(45000)]);
    busy=true;attempts++;retryAt=now()+30000;lastError=null;
    try{
      const response=await fetcher(PATH,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({handle:location.handle,region:location.region,manual:true}),credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',cache:'no-store',signal});
      if(!response.ok){
        if(response.status===429||response.status===503){const raw=response.headers.get('Retry-After'),time=/^\d+$/.test(raw||'')?now()+Number(raw)*1000:Date.parse(raw||'');retryAt=Math.max(retryAt,Number.isSafeInteger(time)?time:now()+900000);}
        let regionMismatch=false;
        if(response.status===409&&/^application\/json(?:;|$)/i.test(response.headers.get('Content-Type')||''))try{const bytes=await core.bounded(response.body,2048);regionMismatch=JSON.parse(new TextDecoder().decode(bytes)).error==='region_mismatch';}catch{}
        await response.body?.cancel().catch(()=>{});throw Error(regionMismatch?'region_mismatch':response.status===429?'cooldown':[405,501,503].includes(response.status)?'service_unavailable':'source_failed');
      }
      if(!/^application\/json(?:;|$)/i.test(response.headers.get('Content-Type')||'')||Number(response.headers.get('Content-Length'))>MAX){await response.body?.cancel();throw Error('invalid_response');}
      const reader=response.body?.getReader();if(!reader)throw Error('invalid_response');
      const chunks=[];let size=0;
      const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
      try{for(;;){const {value,done}=await reader.read();signal.throwIfAborted();if(done)break;size+=value.length;if(size>MAX)throw Error('invalid_response');chunks.push(value);}}
      finally{signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
      const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
      let normalized;try{normalized=await adapter.normalize(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),location);}catch{throw Error('invalid_response');}
      signal.throwIfAborted();if(expected!==generation)throw Error('cancelled');
      const data=normalized.data;let matched=0;const variants={};
      for(const chart of Object.values(data.charts)){
        const row=mapping.charts[chart.chartID];if(adapter.matchChart(data.player,chart,row,targets[row?.chart_id]))matched++;
        const variant=chart.format+':'+chart.difficulty;variants[variant]=(variants[variant]||0)+1;
      }
      const snapshot={data,summary:{catalog:normalized.coverage.totalCharts,played:normalized.coverage.playedCharts,
        imported:Object.keys(data.charts).length,matched,unmatched:Object.keys(data.charts).length-matched,
        excluded:normalized.coverage.diagnosticCount,plays:Object.keys(data.plays).length,variants}};
      if(phase==='baseline'){baseline=snapshot;selected=location;}
      if(phase==='updated'){updated=snapshot;confirmed=null;kind=changeKind;}
      if(phase==='confirmed')confirmed=snapshot;
      return report();
    }catch(error){
      const safe=['cooldown','service_unavailable','source_failed','invalid_response','cancelled','region_mismatch'];
      const code=signal.aborted||expected!==generation?'cancelled':safe.includes(error.message)?error.message:'source_failed';
      if(expected===generation)lastError=code;
      throw Error(code);
    }finally{if(expected===generation){busy=false;controller=null;}}
  }
  function clear(){generation++;controller?.abort();controller=null;busy=false;baseline=null;updated=null;confirmed=null;selected=null;kind='upload';lastError=null;}
  return Object.freeze({capture,clear,report,status:()=>({busy,attempts,retryAt,hasBaseline:!!baseline,hasUpdated:!!updated})});
}
globalThis.maimaiMaishiftPilot=Object.freeze({create,compare,assess});
})();
