/* Inventory context and explicit absence of optional prepared measurements. */
(()=>{'use strict';
let region='';
const make=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
function resolve(data,id){return data.legacy_ids?.[id]||id;}
function matches(chart){return !region||chart.regional?.[region]?.listing==='listed';}
function details(chart,data){
  const root=make('div');root.className='registry-metadata';if(!chart.capabilities)return root;
  const source=chart.metadata_region==='JP'?'SEGA Japan':chart.metadata_region==='INTL'?'SEGA International':'Retained historical metadata';
  root.append(make('p','Metadata: '+source));
  const listingLabels={listed:'Listed',not_observed_in_latest_capture:'Not observed in the latest listing',announced:'Announced',removed:'Removed with official evidence',unknown:'No listing observation'};
  for(const [key,label]of [['JP','Japan'],['INTL','International']]){
    const entry=chart.regional?.[key];if(!entry)continue;
    const record=data.sources?.[entry.snapshot_id],modified=Date.parse(record?.http?.['Last-Modified']);
    root.append(make('p',label+': '+(listingLabels[entry.listing]||'Unknown')+(entry.level?' · Lv. '+entry.level+(entry.listing!=='listed'&&entry.level_observed_at?' (last observed '+entry.level_observed_at.slice(0,10)+')':''):'')+(entry.observed_at?' · observed '+entry.observed_at.slice(0,10):'')+(Number.isFinite(modified)?' · source updated '+new Date(modified).toISOString().slice(0,10):'')));
  }
  if(!chart.demand)root.append(make('p',chart.capabilities.similarity==='unsupported'?'The selected transcription uses notation the analyzer does not support. Flow, patterns, and similarity are unavailable.':'Chart analysis is not prepared. Flow, patterns, and similarity need an accepted transcription and analysis.'));
  if(chart.capabilities.constant==='available')root.append(make('p','Source constant: Neskol revision e164add85213bab150e1487d5eb15ccb631aedb9. Regional and game-release scope unknown.'));
  return root;
}
function mount(data,changed){
  if(data.schema_version!=='maimai-browser-catalog-2')return;
  const label=make('label','Listing context'),select=make('select');select.id='filter-region';
  for(const [value,title]of [['','All known'],['JP','Japan listing'],['INTL','International listing']])select.append(new Option(title,value));
  label.append(select);document.getElementById('filter-genre').parentElement.after(label);
  label.parentElement.classList.add('registry-filters');
  const navigation=new Map(Object.entries(data.navigation.charts).map(([id,row])=>[id,{...row}]));
  const originals=new Map(data.catalog.map(c=>[c.chart_id,{title:c.title,artist:c.artist,level:c.level,metadata_region:c.metadata_region}]));
  function apply(){region=select.value;for(const c of data.catalog){const original=originals.get(c.chart_id),entry=c.regional?.[region];Object.assign(c,original);const nav=data.navigation.charts[c.chart_id];Object.assign(nav,navigation.get(c.chart_id));if(region){nav.genre=entry?.genre||'unknown';nav.version=entry?.version||'unknown';c.level=entry?.level??null;if(entry?.metadata?.title){c.title=entry.metadata.title;c.artist=entry.metadata.artist;c.metadata_region=region;}}}changed();}
  select.onchange=apply;
  document.getElementById('reset-filters').addEventListener('click',()=>{select.value='';apply();});
}
window.maimaiRegistryBrowser=Object.freeze({resolve,matches,details,mount});
})();
