/* Inventory context and explicit absence of optional prepared measurements. */
(()=>{'use strict';
let region='';
const make=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
function resolve(data,id){return data.legacy_ids?.[id]||id;}
function matches(chart){return !region||chart.regional?.[region]?.listing==='listed';}
function mount(data,changed){
  if(data.schema_version!=='maimai-browser-catalog-2')return;
  const label=make('label','Listing context'),select=make('select');select.id='filter-region';
  for(const [value,title]of [['','All known'],['JP','Japan listing'],['INTL','International listing']])select.append(new Option(title,value));
  label.append(select);document.getElementById('filter-genre').parentElement.after(label);
  label.parentElement.classList.add('registry-filters');
  const navigation=new Map(Object.entries(data.navigation.charts).map(([id,row])=>[id,{...row}]));
  const originals=new Map(data.catalog.map(c=>[c.chart_id,{title:c.title,artist:c.artist,level:c.level,metadata_region:c.metadata_region}]));
  function apply(){region=select.value;for(const c of data.catalog){const original=originals.get(c.chart_id),entry=c.regional?.[region];Object.assign(c,original);const nav=data.navigation.charts[c.chart_id];Object.assign(nav,navigation.get(c.chart_id));if(region){for(const[field,scopes]of Object.entries(nav.regional_metrics||{}))nav[field]=scopes[region]??null;nav.genre=entry?.genre||'unknown';nav.version=entry?.version||'unknown';c.level=entry?.level??null;if(entry?.metadata?.title){c.title=entry.metadata.title;c.artist=entry.metadata.artist;c.metadata_region=region;}}}changed();}
  select.onchange=apply;
  document.getElementById('reset-filters').addEventListener('click',()=>{select.value='';apply();});
}
window.maimaiRegistryBrowser=Object.freeze({resolve,matches,mount});
})();
