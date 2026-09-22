/** Existing DOM behavior with explicit module dependencies. */
export function createRegistryBrowser(ports) {
let registry;
/* Regional data preference never restricts catalog membership. */
(()=>{'use strict';
const i18n=ports.localization||{text:(node,value)=>node.textContent=value,attribute:(node,key,value)=>node.setAttribute(key,value),option:(...args)=>new Option(...args),literal:(node,value)=>node.textContent=value};

const make=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)i18n.text(n, text);return n;};
const known=value=>value!=null&&value!==''&&value!=='unknown';
// Explicit JP/INTL aliases; shared regression vectors: tests/fixtures/genre-aliases.json.
const genres=[
  ['POPSアニメ','POPS & ANIME',['POPS＆アニメ','POPS＆ANIME']],
  ['niconicoボーカロイド','niconico & VOCALOID™',['niconico＆ボーカロイド','niconico＆VOCALOID','niconico＆VOCALOID™','niconico & VOCALOID']],
  ['東方Project','東方Project',['Touhou Project']],
  ['ゲームバラエティ','GAME & VARIETY',['ゲーム＆バラエティ','GAME＆VARIETY']],
  ['maimai','maimai',[]],
  ['オンゲキCHUNITHM','オンゲキ & CHUNITHM',['オンゲキ＆CHUNITHM','ONGEKI＆CHUNITHM','ONGEKI & CHUNITHM']]
];
const labels=new Map(genres.map(([id,label])=>[id,label]));
const aliases=new Map(genres.flatMap(([id,label,raw])=>[id,label,...raw].map(value=>[value.normalize('NFKC').trim(),id])));
function genreId(value){
  const id=typeof value==='string'&&aliases.get(value.replace(/^sega:/,'').normalize('NFKC').trim());
  if(!id)throw new Error('This catalog contains an unrecognized genre and needs review.');
  return id;
}
function normalize(data){
  if(data.schema_version!=='maimai-browser-catalog-2'||!data.navigation)return data;
  const navigation=data.navigation,referenced=new Set(),remapped=[];
  for(const item of navigation.genres||[])genreId(item.id);
  function remap(row){const id=genreId(row.genre);remapped.push([row,id]);referenced.add(id);}
  for(const row of Object.values(navigation.charts||{}))remap(row);
  // The metadata toggle must not reintroduce a historical alias after normalization.
  for(const chart of data.catalog||[]){
    if(chart.chart_id!==undefined)genreId(navigation.charts?.[chart.chart_id]?.genre);
    for(const region of Object.values(chart.regional||{})){
      if(Object.hasOwn(region,'genre'))remap(region);
      if(Object.hasOwn(region.metadata||{},'catcode'))genreId(region.metadata.catcode);
    }
  }
  // Validate everything before mutating any in-memory chart.
  for(const [row,id]of remapped)row.genre=id;
  navigation.genres=[...referenced].sort().map(id=>({id,label:labels.get(id)}));
  return data;
}
function matchesRegion(chart,region){return !region||chart.regional?.[region]?.listing==='listed';}
function resolve(data,id){return data.legacy_ids?.[id]||id;}
function mount(data,changed){
  if(data.schema_version!=='maimai-browser-catalog-2')return;
  const label=make('label'),checkbox=make('input');checkbox.type='checkbox';checkbox.id='use-international-data';checkbox.checked=false;
  label.className='check international-data-option';label.append(checkbox,make('span','Use maimai international data'));
  const controls=document.getElementById('regional-controls');controls.append(label);controls.hidden=false;
  const buttons=[...document.querySelectorAll('#filter-region>button')];
  const regionLabels={'':'All regions',JP:'JP',INTL:'International'};
  const region=ports.browserState.region;
  function selectRegion(value){
    ports.browserState.setRegion(value);
    checkbox.checked=region.international;
    for(const button of buttons){const selected=button.dataset.region===value;button.setAttribute('aria-checked',String(selected));button.tabIndex=selected?0:-1;}
  }
  const navigation=new Map(Object.entries(data.navigation.charts).map(([id,row])=>[id,{...row}]));
  const originals=new Map(data.catalog.map(c=>[c.chart_id,{...c}]));
  function apply(notify=true){
    for(const chart of data.catalog){
      const projected=ports.catalogQuery.regionalValues(originals.get(chart.chart_id),navigation.get(chart.chart_id),region.international);
      Object.assign(chart,projected.fields);Object.assign(data.navigation.charts[chart.chart_id],projected.navigation);
    }
    if(notify)changed();
  }
  checkbox.onchange=()=>{region.international=checkbox.checked;apply();ports.usage?.emit('filter_first_used',undefined,'international');};
  buttons.forEach((button,index)=>{
    button.onclick=()=>{selectRegion(button.dataset.region);apply();ports.usage?.emit('filter_first_used',undefined,'region');};
    button.onkeydown=event=>{
      const offset={ArrowRight:1,ArrowDown:1,ArrowLeft:-1,ArrowUp:-1}[event.key];
      const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:offset?(index+offset+buttons.length)%buttons.length:null;
      if(next===null)return;
      event.preventDefault();buttons[next].focus();buttons[next].click();
    };
  });
  return {value:()=>region.availability,label:()=>regionLabels[region.availability],clear:(notify=true)=>{selectRegion('');apply(notify);},
    snapshot:()=>({...region}),
    sync:()=>{const saved={...region};selectRegion(saved.availability);region.international=saved.international;checkbox.checked=region.international;apply(false);},
    restore:saved=>{ports.browserState.restoreRegion(saved);checkbox.checked=region.international;apply(false);}};
}
registry=Object.freeze({resolve,mount,normalize,matchesRegion});
})();

return registry;
}
