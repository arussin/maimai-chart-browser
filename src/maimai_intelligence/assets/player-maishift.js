/* Public Maishift observations. Connection locations never enter portable data. */
(()=>{'use strict';if(globalThis.maimaiPlayerMaishift)return;
const core=globalThis.maimaiPlayerData;
const fail=()=>{throw new Error('Maishift returned an unsupported response. Your saved data was kept.');};
function location(value,region){
  if(!['intl','jp'].includes(region))throw new Error('Choose the game region for this profile.');
  let handle=value.trim(),url;
  if(handle.includes('://')){
    try{url=new URL(handle);}catch{throw new Error('Enter a Maishift handle or a public profile URL.');}
    const match=/^\/(?:en|ko|ja|zh-TW)(?:@(na|intl|jp))?\/profile\/([A-Za-z0-9_-]{1,64})\/(?:home|records|export)$/.exec(url.pathname);
    if(url.origin!=='https://maimai.shiftpsh.com'||url.username||url.password||url.port||url.search||url.hash||!match)throw new Error('Enter a Maishift handle or a public profile URL.');
    if(match[1]&&(match[1]==='jp'?'jp':'intl')!==region)throw new Error('The profile URL and selected game region do not match.');
    handle=match[2];
  }
  if(!/^[A-Za-z0-9_-]{1,64}$/.test(handle))throw new Error('Enter a Maishift handle or a public profile URL.');
  return {handle,region,url:'https://maimai.shiftpsh.com/en@'+region+'/profile/'+handle+'/home'};
}
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const integer=(v,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
const text=(v,max=512)=>typeof v==='string'&&v.length<=max&&!/[\x00-\x1f\uD800-\uDFFF]/u.test(v);
async function normalize(envelope,selected){
  if(!object(envelope)||envelope.schemaVersion!==1||envelope.adapterVersion!==1||envelope.provider!=='maishift')fail();
  const p=envelope.identity,c=envelope.coverage;
  if(!object(p)||p.handle!==selected.handle||p.region!==selected.region||!text(p.displayName,200)||!p.displayName||!integer(p.createdAt)||!integer(p.updatedAt)||p.updatedAt<p.createdAt)fail();
  if(!object(c)||c.kind!=='partial'||!['totalCharts','playedCharts','importedCharts','diagnosticCount'].every(k=>integer(c[k],20000))||c.playedCharts>c.totalCharts||c.importedCharts+c.diagnosticCount!==c.playedCharts)fail();
  if(!Array.isArray(envelope.records)||envelope.records.length!==c.importedCharts||!Array.isArray(envelope.diagnostics)||envelope.diagnostics.length!==Math.min(100,c.diagnosticCount))fail();
  const diagnostics=envelope.diagnostics.map(d=>{if(!object(d)||!integer(d.rowIndex,19999)||d.rowIndex>=c.totalCharts||d.reason!=='insufficient_chart_identity')fail();return {rowIndex:d.rowIndex,reason:d.reason};});
  const player={key:'maishift:maimaidx:'+p.region+':'+encodeURIComponent(p.handle),provider:'maishift',game:'maimaidx',username:p.handle,displayName:p.displayName};
  const data={format:'maimai-player-data',schemaVersion:1,player,charts:{},records:{},plays:{},snapshots:{},captures:{}},pbs={},records=[];
  for(const row of envelope.records){
    if(!object(row)||!/^\d{1,16}$/.test(row.id)||!integer(Number(row.id))||Number(row.id)===0||String(Number(row.id))!==row.id||!['STD','DX'].includes(row.format)||!['BASIC','ADVANCED','EXPERT','MASTER','RE:MASTER'].includes(row.difficulty))fail();
    if(!['title','artist','level','lamp','sync'].every(k=>text(row[k]))||row.achievement!==null&&!integer(row.achievement,1010000)||row.constant!==null&&!integer(row.constant,200))fail();
    if(!['dxScore','maxDxScore','rate'].every(k=>row[k]===null||integer(row[k])))fail();
    const chartID='maishift:'+p.region+':'+row.id;if(Object.hasOwn(data.charts,chartID))fail();
    // Portable records retain provider IDs. A reviewed crosswalk is applied
    // only when displaying them, without rewriting or dropping source data.
    data.charts[chartID]={chartID,songID:chartID,title:row.title,artist:row.artist,format:row.format,difficulty:row.difficulty,level:row.level,constant:row.constant,displayVersion:'',inGameID:null};
    const record={chartID,achievement:row.achievement,grade:'',rate:row.rate,lamp:row.lamp,sync:row.sync,constant:row.constant,displayVersion:'',timeAchieved:null,dxScore:row.dxScore,maxDxScore:row.maxDxScore,
      maxCombo:null,fast:null,slow:null,miss:null,good:null,great:null,perfect:null,pcrit:null};
    records.push(record);
  }
  // WebKit's individual WebCrypto round trips make thousands of serial hashes
  // slow. Match the validator's bounded batches while retaining identical IDs.
  for(let start=0;start<records.length;start+=128){
    const batch=records.slice(start,start+128),ids=await Promise.all(batch.map(record=>core.digest(record)));
    batch.forEach((record,i)=>{data.records[ids[i]]=record;pbs[record.chartID]=ids[i];});
  }
  const snapshot={capturedAt:p.updatedAt,phase:'after',complete:false,versions:[],pbs},sid=await core.digest(snapshot);data.snapshots[sid]=snapshot;
  const capture={capturedAt:p.updatedAt,sourceKind:'maishift-public-pbs',sourceID:player.key,sessionID:'',historyCoverage:'none',playIDs:[],snapshotIDs:[sid]};data.captures[await core.digest(capture)]=capture;
  data.revision=await core.digest(data);await core.validate(data);
  return {data,diagnostics,coverage:{...c},createdAt:p.createdAt,updatedAt:p.updatedAt};
}
function matchChart(player,chart,row,target){
  if(!row||!target||!chart||player?.provider!=='maishift')return false;
  const identity=player.key.split(':'),source=row.expected_source;
  return identity.length===4&&identity[0]==='maishift'&&identity[1]==='maimaidx'&&['intl','jp'].includes(identity[2])&&
    new RegExp('^maishift:'+identity[2]+':[1-9][0-9]{0,15}$').test(chart.chartID)&&row.acceptance_basis==='reviewed'&&row.chart_id===target.chart_id&&
    ['title','artist','format','difficulty'].every(k=>typeof source?.[k]==='string'&&source[k]===chart[k])&&['format','difficulty'].every(k=>source[k]===target[k]);
}
globalThis.maimaiPlayerMaishift=Object.freeze({location,normalize,matchChart});
})();
