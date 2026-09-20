/* Regional data preference never restricts catalog membership. */
(()=>{'use strict';
const i18n=window.maimaiI18n||{text:(node,value)=>node.textContent=value,attribute:(node,key,value)=>node.setAttribute(key,value),option:(...args)=>new Option(...args),literal:(node,value)=>node.textContent=value};

const make=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)i18n.text(n, text);return n;};
const known=value=>value!=null&&value!==''&&value!=='unknown';
function resolve(data,id){return data.legacy_ids?.[id]||id;}
function mount(data,changed){
  if(data.schema_version!=='maimai-browser-catalog-2')return;
  const label=make('label'),checkbox=make('input');checkbox.type='checkbox';checkbox.id='use-international-data';checkbox.checked=false;
  label.className='check international-data-option';label.append(checkbox,make('span','Use maimai international data'));
  document.getElementById('filter-genre').closest('.filter-row').before(label);
  const navigation=new Map(Object.entries(data.navigation.charts).map(([id,row])=>[id,{...row}]));
  const originals=new Map(data.catalog.map(c=>[c.chart_id,{title:c.title,artist:c.artist,level:c.level,metadata_region:c.metadata_region}]));
  function apply(){
    for(const c of data.catalog){
      Object.assign(c,originals.get(c.chart_id));
      const nav=data.navigation.charts[c.chart_id],original=navigation.get(c.chart_id);
      Object.assign(nav,original);
      if(!checkbox.checked)continue;
      const entry=c.regional?.INTL;
      for(const field of ['title','artist'])if(known(entry?.metadata?.[field]))c[field]=entry.metadata[field];
      if(known(entry?.metadata?.title))c.metadata_region='INTL';
      if(known(entry?.level))c.level=entry.level;
      for(const field of ['genre','version'])if(known(entry?.metadata?.[field==='genre'?'catcode':'version'])&&known(entry?.[field]))nav[field]=entry[field];
      for(const [field,scopes] of Object.entries(original.regional_metrics||{})){
        if(!known(scopes.INTL))continue;
        nav[field]=scopes.INTL;
        const source=original.regional_metric_sources?.[field]?.INTL;
        if(source)nav.metric_sources={...nav.metric_sources,[field]:source};
      }
    }
    changed();
  }
  checkbox.onchange=apply;
  document.getElementById('reset-filters').addEventListener('click',()=>{checkbox.checked=false;apply();});
}
window.maimaiRegistryBrowser=Object.freeze({resolve,mount});
})();
