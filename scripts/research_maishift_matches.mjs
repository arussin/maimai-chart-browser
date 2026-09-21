// Offline candidate review. Reads public chart metadata only and never writes
// registry mappings or enables the connector. Output remains in DevCache.
import fs from 'node:fs/promises';
import path from 'node:path';
import {hash} from '../player-import-worker/index.mjs';
const dir=process.env.MAISHIFT_RESEARCH_OUTPUT;
if(!dir||!path.resolve(dir).startsWith('C:\\DevCache\\'))throw new Error('DevCache research directory required');
const charts=JSON.parse(await fs.readFile('registry/charts.json','utf8'));
const mappings=JSON.parse(await fs.readFile('registry/mappings.json','utf8'));
const chartSlots=new Map();
for(const c of Object.values(charts).filter(c=>c.variant_id==='ordinary')){
  const key=JSON.stringify([c.song_id,c.format,c.difficulty]);
  chartSlots.set(key,[...chartSlots.get(key)||[],c.chart_id]);
}
const jacket=value=>{
  // A filename is only evidence on the observed official regional jacket host.
  try{const url=new URL(value);return ['https://maimaidx-eng.com','https://maimaidx.jp'].includes(url.origin)&&/^\/maimai-mobile\/img\/Music\/[0-9a-f]+\.png$/.test(url.pathname)&&!url.search&&!url.hash?url.pathname.split('/').pop():null;}catch{return null;}
};
const title=value=>(value||'').normalize('NFKC').trim();
const summaries={};
for(const region of ['intl','jp']){
  const rows=JSON.parse(await fs.readFile(path.join(dir,'catalog-'+region+'.json'),'utf8'));
  const accepted=Object.values(mappings).filter(m=>m.provider==='sega-'+region&&m.state==='accepted'&&m.acceptance_basis==='reviewed');
  const candidates=[];
  for(const row of rows){
    const evidence=accepted.filter(m=>m.assertion.image_url===jacket(row.sourceSongMetadata.jacketUrl)&&title(m.assertion.title)===title(row.title))
      .flatMap(m=>(chartSlots.get(JSON.stringify([m.subject_id,row.format,row.difficulty]))||[]).map(chartID=>({chartID,snapshotID:m.snapshot_id,record:m.evidence.record,artist:m.assertion.artist,artistEqual:title(m.assertion.artist)===title(row.artist)})));
    const reviewedIDs=[...new Set(evidence.map(e=>e.chartID))],strictIDs=row.candidateBasis==='strictUnique'?row.candidateChartIDs:[];
    const conflict=reviewedIDs.length>1||strictIDs.length>0&&reviewedIDs.length===1&&strictIDs[0]!==reviewedIDs[0];
    const IDs=conflict?[]:strictIDs.length?strictIDs:reviewedIDs;
    const basis=conflict?'conflict':strictIDs.length?'exact-title-artist-format-difficulty':reviewedIDs.length===1?(evidence.every(e=>e.artistEqual)?'regional-SEGA-title-artist-jacket-and-slot':'regional-SEGA-title-jacket-slot-needs-artist-review'):'unresolved';
    candidates.push({providerChartID:row.id,chartIDs:IDs,basis,evidence:reviewedIDs.length?evidence:[],metadata:{title:row.title,artist:row.artist,format:row.format,difficulty:row.difficulty,jacketUrl:row.sourceSongMetadata.jacketUrl}});
  }
  const matched=candidates.filter(c=>c.chartIDs.length===1),targets=matched.map(c=>c.chartIDs[0]);
  const summary={charts:rows.length,uniqueCandidates:matched.length,targetCollisions:targets.length-new Set(targets).size,byBasis:Object.fromEntries([...new Set(candidates.map(c=>c.basis))].map(b=>[b,candidates.filter(c=>c.basis===b).length])),unresolved:candidates.filter(c=>c.chartIDs.length!==1),candidateDigest:await hash(JSON.stringify(candidates))};
  summaries[region]=summary;
  await fs.writeFile(path.join(dir,'candidate-crosswalk-'+region+'.json'),JSON.stringify(candidates));
}
await fs.writeFile(path.join(dir,'matching-summary.json'),JSON.stringify(summaries,null,2));
console.log(JSON.stringify(Object.fromEntries(Object.entries(summaries).map(([region,s])=>[region,{...s,unresolved:s.unresolved.length}])),null,2));
