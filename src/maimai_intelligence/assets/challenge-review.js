/* Public chart browsing and authored pattern previews. */
(()=>{'use strict';
const data=window.maimaiResearchCatalog??=JSON.parse(document.getElementById('challenge-data').textContent);
window.maimaiChartLinks.configure(data.mai_notes);
const byId=new Map(data.catalog.map(c=>[c.chart_id,c]));
const el=id=>document.getElementById(id),make=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
let visible=40,format='all',comparisonUI=null;
const navigation=data.navigation||{charts:{},genres:[],versions:[]};
const overview=window.maimaiChartOverview;
function folderValue(c,mode){
  if(mode==='level')return c.level||'unknown';
  const n=navigation.charts[c.chart_id];
  return n&&n.source_hash===c.source_hash?(n[mode]||'unknown'):'unknown';
}
const displayTitle=c=>c.title.trim()?c.title:'〈Blank title〉';
function metrics(c){const root=make('div',undefined,'demand');for(const [group,key,label,unit] of [['cadence','mean_onsets_s','Average input speed',' /s'],['cadence','peak_onsets_s','Busiest 1 s',' inputs'],['coordination','simultaneous_fraction','Simultaneous inputs','%'],['holds','occupancy','Avg active holds',''],['slides','occupancy','Avg moving slides',''],['spatial','single_step_buttons','Single-input spacing',' buttons']]){let value=c.demand[group][key];if(value!==undefined&&unit==='%')value*=100;const e=make('div',label,'metric');e.append(make('strong',value===undefined?'Unknown':value.toFixed(1)+unit));root.append(e);}return root;}
function xy(pos){if(pos==='C')return[0,0];let n,r=1,offset=0;if(typeof pos==='number')n=pos;else if(/^[ABDE][1-8]$/.test(pos||'')){n=+pos[1];r='BE'.includes(pos[0])?.55:1;offset='DE'.includes(pos[0])?-.5:0;}else return null;let a=(n-.5+offset)*Math.PI/4;return[Math.sin(a)*r,-Math.cos(a)*r];}
const ns='http://www.w3.org/2000/svg';
function svgNode(tag,attrs){const e=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,String(v));return e;}
function field(snippet,label,lead=600000){const box=make('div',undefined,'field');box.append(make('h4',label));const svg=svgNode('svg',{viewBox:'-1.35 -1.35 2.7 2.7',role:'img','aria-label':label+' chart passage'});box.append(svg);const note=make('p','', 'muted');box.append(note);
function draw(t){svg.replaceChildren();svg.append(svgNode('circle',{cx:0,cy:0,r:1,fill:'none',stroke:'#cfc4e8','stroke-width':.025}));for(let n=1;n<=8;n++){let[x,y]=xy(n);svg.append(svgNode('circle',{cx:x,cy:y,r:.09,fill:'white',stroke:'#aa9dc3','stroke-width':.012}));const tx=svgNode('text',{x,y:y+.036,'text-anchor':'middle','font-size':.11,fill:'#65577d'});tx.textContent=n;svg.append(tx);}
let unknown=0;
for(const s of snippet.slides){if(t<s.wait_start_us||t>s.movement_end_us)continue;if(!s.geometry){unknown++;continue;}const points=s.geometry.points,waiting=t<s.movement_start_us;svg.append(svgNode('polyline',{points:points.map(p=>p.join(',')).join(' '),fill:'none',stroke:waiting?'#987500':'#007d88','stroke-width':.05,'stroke-dasharray':waiting?'.07 .04':'none'}));if(!waiting){let u=Math.min(1,(t-s.movement_start_us)/(s.movement_end_us-s.movement_start_us));let lengths=points.slice(1).map((p,i)=>Math.hypot(p[0]-points[i][0],p[1]-points[i][1]));let distance=u*lengths.reduce((a,b)=>a+b,0),i=0;while(i<lengths.length-1&&distance>lengths[i])distance-=lengths[i++];let v=lengths[i]?distance/lengths[i]:0;let p=[points[i][0]+v*(points[i+1][0]-points[i][0]),points[i][1]+v*(points[i+1][1]-points[i][1])];svg.append(svgNode('circle',{cx:p[0],cy:p[1],r:.065,fill:'#007d88'}));}}
for(const h of snippet.holds){let p=xy(h.position);if(p&&t>=h.start_us&&t<h.end_us)svg.append(svgNode('circle',{cx:p[0],cy:p[1],r:.16,fill:'none',stroke:h.simultaneous?'#947000':'#b55812','stroke-width':.05}));}
for(const e of snippet.events){let dt=e.time_us-t;if(dt< -120000||dt>lead)continue;let p=xy(e.position);if(!p)continue;let r=Math.max(.05,Math.min(.16,.16-dt/600000*.10));svg.append(svgNode('circle',{cx:p[0],cy:p[1],r,fill:e.simultaneous?'#f4c430':e.role==='star_tap'?'#007d88':'#b82d75',stroke:e.simultaneous?'#947000':'none','stroke-width':.025,opacity:dt<0?.5:1}));}
note.textContent=(t/1000000).toFixed(2)+' s · '+(unknown?unknown+' active path(s) not rendered':'Wait: dashed gold · Move: solid teal');}
return{box,draw};}
function selectView(name){
  window.maimaiViews.show(name);
  window.maimaiPatternLibrary.stop();
  if(name==='catalog')catalog();else if(name==='compare')comparisonUI?.render();else if(name==='patterns')window.maimaiPatternLibrary.render();
}
const difficultyOrder=['BASIC','ADVANCED','EXPERT','MASTER','RE:MASTER'];
const collator=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
const chartConstant=c=>{const record=navigation.charts?.[c.chart_id],value=record?.chart_constant;return record?.source_hash===c.source_hash&&Number.isFinite(value)&&value>0&&value<=15?value:null;};
const constantLabel=c=>chartConstant(c)==null?'—':chartConstant(c).toFixed(1);
const sortFields={title:'Title',artist:'Artist',constant:'Constant',bpm:'BPM',difficulty:'Difficulty',format:'Format',genre:'Genre',version:'Version',speed:'Inputs / s',peak:'Peak inputs / s'};
let sortRules=[{key:'title',direction:1}];
const filters=['genre'],selectedVersions=new Set();
let chartFilters,patternFilter;
const versionLabel=value=>value.replace(/^maimai DX /,'DX ').replace(/^maimai /,'');
const genreLabel=value=>(navigation.genres||[]).find(g=>g.id===value)?.label||'Uncategorized';
const values={title:c=>displayTitle(c),artist:c=>c.artist,constant:chartConstant,bpm:c=>navigation.charts?.[c.chart_id]?.bpm??null,difficulty:c=>{const rank=difficultyOrder.indexOf(c.difficulty.toUpperCase());return rank<0?null:rank;},format:c=>c.format,genre:c=>genreLabel(folderValue(c,'genre')),version:c=>{const v=(navigation.versions||[]).indexOf(folderValue(c,'version'));return v<0?null:v;},speed:c=>c.demand.cadence.mean_onsets_s??null,peak:c=>{const record=overview.get(c);if(record&&Object.hasOwn(record,'flow_peak'))return record.flow_peak;const peaks=(record?.segments||[]).filter(s=>s[3]!=null&&s[4]>0).map(s=>s[3]);return peaks.length?Math.max(...peaks):null;}};
const selectedCharts=new Map(),expandedRows=new Set();
const rowKey=c=>JSON.stringify([navigation.charts?.[c.chart_id]?.source_path||c.source_container_id||c.song_id,c.format]);
function compareCharts(a,b){
  for(const rule of sortRules){if(!rule.key)continue;const av=values[rule.key](a),bv=values[rule.key](b);
    // Unknown measurements stay at the end in either direction.
    if(av==null||bv==null){if(av!==bv)return av==null?1:-1;continue;}
    const diff=typeof av==='number'?av-bv:collator.compare(av,bv);if(diff)return diff*rule.direction;
  }
  return collator.compare(displayTitle(a),displayTitle(b))||a.chart_id.localeCompare(b.chart_id);
}
function sortLabel(rule){return sortFields[rule.key]+(['title','artist','genre','format'].includes(rule.key)?(rule.direction===1?' A–Z':' Z–A'):(rule.direction===1?' ↑':' ↓'));}
function renderSort(){
  const root=el('sort-rules');root.replaceChildren();
  sortRules.forEach((rule,index)=>{const b=make('button',(index+1)+'. '+sortLabel(rule)+' ×','filter-chip');b.setAttribute('aria-label','Remove '+sortFields[rule.key]+' sort priority');b.onclick=()=>{sortRules.splice(index,1);if(!sortRules.length)sortRules=[{key:'title',direction:1}];renderSort();catalog();document.querySelector('[data-sort-key="'+rule.key+'"]').focus();};root.append(b);});
  for(const button of document.querySelectorAll('[data-sort-key]')){
    const key=button.dataset.sortKey,index=sortRules.findIndex(r=>r.key===key),rule=sortRules[index],label=key==='title'?'Song / artist':key==='peak'?'Flow · peak':sortFields[key];
    const indicator=make('span',rule?(rule.direction===1?'↑':'↓'):'↕','sort-indicator');indicator.setAttribute('aria-hidden','true');
    if(rule)indicator.append(make('span',String(index+1),'sort-priority'));
    button.replaceChildren(make('span',label,'sort-label'),indicator);button.setAttribute('aria-pressed',String(!!rule));
    button.setAttribute('aria-label',label+(rule?', priority '+(index+1)+', '+(rule.direction===1?'ascending':'descending'):' unsorted'));
    button.onclick=event=>{const keep=event.shiftKey||el('sort-keep').checked,prior=sortRules.find(r=>r.key===key);if(keep){if(prior)prior.direction*=-1;else sortRules.push({key,direction:1});}else sortRules=[{key,direction:prior&&sortRules[0]===prior?-prior.direction:1}];visible=40;renderSort();catalog();button.focus();};
  }
}
function initializeFilters(){
  chartFilters=window.maimaiCatalogFilters.mount(data.catalog,()=>{visible=40;catalog();});
  patternFilter=window.maimaiPatternFilter.mount(overview,()=>{visible=40;writePatternFilter();catalog();});
  for(const id of filters){const select=el('filter-'+id);let options=[];
    if(id==='genre')options=(navigation.genres||[]).map(g=>[g.id,g.label]);
    for(const [value,label]of options){const option=new Option(label,value);select.append(option);}
    select.onchange=()=>{visible=40;catalog();};
  }
  for(const key of ['all','STD','DX'])el('format-'+key).onclick=()=>{format=key;visible=40;updateFormat();catalog();};
  for(const version of navigation.versions||[]){
    const label=make('label'),checkbox=make('input');checkbox.type='checkbox';checkbox.value=version;
    checkbox.onchange=()=>{if(checkbox.checked)selectedVersions.add(version);else selectedVersions.delete(version);visible=40;updateVersions();catalog();};
    const charts=data.catalog.filter(c=>folderValue(c,'version')===version),count=new Set(charts.map(rowKey)).size;
    const text=make('span',versionLabel(version),'version-name'),detail=make('small',count+' song'+(count===1?'':'s')+' · '+charts.length+' charts','version-count');detail.setAttribute('aria-hidden','true');text.append(detail);
    label.title=count+' song / format entries, '+charts.length+' analyzed charts';label.append(checkbox,window.maimaiChartArtwork.version(version),text);el('version-options').append(label);
  }
  el('version-clear').onclick=()=>{selectedVersions.clear();visible=40;updateVersions();catalog();};
  el('version-filter').addEventListener('keydown',event=>{if(event.key==='Escape'){el('version-filter').open=false;el('version-summary').focus();event.stopPropagation();}});
  document.addEventListener('click',event=>{if(!el('version-filter').contains(event.target))el('version-filter').open=false;});
  el('reset-filters').onclick=()=>{for(const id of filters)el('filter-'+id).value='';selectedVersions.clear();updateVersions();chartFilters.clear();patternFilter.clear();el('search').value='';format='all';visible=40;writePatternFilter();updateFormat();catalog();};
  renderSort();
  const newest=(navigation.versions||[]).find(v=>data.catalog.some(c=>folderValue(c,'version')===v));el('catalog-era').textContent=newest?'Through '+versionLabel(newest):'Research catalog';
}
function writePatternFilter(){const url=new URL(location.href);url.searchParams.delete('pattern-filter');for(const id of patternFilter.ids())url.searchParams.append('pattern-filter',id);history.replaceState(null,'',url);}
function updateVersions(){
  el('version-summary').textContent=selectedVersions.size===0?'All versions':selectedVersions.size===1?versionLabel([...selectedVersions][0]):selectedVersions.size+' versions selected';
  for(const input of el('version-options').querySelectorAll('input'))input.checked=selectedVersions.has(input.value);
}
function updateFormat(){for(const key of ['all','STD','DX'])el('format-'+key).setAttribute('aria-pressed',String(key===format));}
function activeFilters(){
  const root=el('active-filters'),chips=[];
  for(const version of selectedVersions){
    const button=make('button',versionLabel(version)+' ×','filter-chip');button.setAttribute('aria-label','Remove version '+versionLabel(version));
    button.onclick=()=>{selectedVersions.delete(version);visible=40;updateVersions();catalog();el('version-summary').focus();};chips.push(button);
  }
  chips.push(...chartFilters.chips(),...patternFilter.chips());
  for(const id of filters){const select=el('filter-'+id);if(!select.value)continue;
    const button=make('button',select.selectedOptions[0].text+' ×','filter-chip');
    button.setAttribute('aria-label','Remove '+select.parentElement.firstChild.textContent+' filter');
    button.onclick=()=>{select.value='';visible=40;catalog();select.focus();};chips.push(button);
  }
  // Preserve controls during text-field blur so a pending pointer click lands
  // on the same chip after the level filter updates.
  const existing=new Map([...root.children].map(node=>[node.getAttribute('aria-label'),node]));
  chips.forEach((candidate,index)=>{const key=candidate.getAttribute('aria-label'),node=existing.get(key)||candidate;existing.delete(key);node.textContent=candidate.textContent;node.onclick=candidate.onclick;if(root.children[index]!==node)root.insertBefore(node,root.children[index]||null);});
  for(const node of existing.values())node.remove();
}
function catalog(focusKey=null){
  const matchesSearch=window.maimaiSongSearch.query(el('search').value);
  const selected=Object.fromEntries(filters.map(id=>[id,el('filter-'+id).value]));
  const charts=data.catalog.filter(c=>{
    if(format!=='all'&&c.format!==format)return false;
    if(!matchesSearch(c))return false;
    if(selected.genre&&folderValue(c,'genre')!==selected.genre)return false;
    if(selectedVersions.size&&!selectedVersions.has(folderValue(c,'version')))return false;
    if(!chartFilters.matches(c))return false;
    if(!patternFilter.matches(c))return false;
    return true;
  });
  const grouped=new Map();
  for(const chart of charts){const key=rowKey(chart);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(chart);}
  const rows=[...grouped].map(([key,choices])=>({key,choices,chart:choices.find(c=>c.chart_id===selectedCharts.get(key))||[...choices].sort((a,b)=>(values.difficulty(a)??99)-(values.difficulty(b)??99)||a.chart_id.localeCompare(b.chart_id))[0]})).sort((a,b)=>compareCharts(a.chart,b.chart));
  if(focusKey)visible=Math.max(visible,rows.findIndex(row=>row.key===focusKey)+1);
  el('songs').replaceChildren();activeFilters();
  for(const [index,{key,choices,chart:c}]of rows.slice(0,visible).entries()){
    const row=make('article',undefined,'song-row');row.dataset.chartId=c.chart_id;row.dataset.level=c.level||'';row.dataset.constant=chartConstant(c)??'';row.dataset.title=c.title;row.dataset.difficulty=c.difficulty;row.dataset.genre=folderValue(c,'genre');row.dataset.version=folderValue(c,'version');
    const header=make('div',undefined,'chart-summary');
    const summary=make('button',undefined,'chart-row'),identity=make('span',undefined,'song-identity'),title=make('span',displayTitle(c),'song-title');summary.type='button';
    identity.append(title,make('span',(c.artist||'Artist not provided')+' · '+c.format,'muted'));summary.append(identity);
    summary.setAttribute('aria-label','Open '+displayTitle(c)+' · '+c.format+' '+c.difficulty+' · Chart constant '+(chartConstant(c)==null?'unknown':constantLabel(c)));
    const heading=make('div',undefined,'chart-row-heading'),videoLink=window.maimaiChartLinks.group(c);
    heading.append(window.maimaiChartArtwork.jacket(c),summary,overview.chips(c,3,patternFilter.ids()));if(videoLink)heading.append(videoLink);
    const picker=make('select');picker.className='row-difficulty';picker.id='row-difficulty-'+index;picker.setAttribute('aria-label','Difficulty for '+displayTitle(c)+' '+c.format);
    for(const choice of [...choices].sort((a,b)=>(values.difficulty(a)??99)-(values.difficulty(b)??99)||a.chart_id.localeCompare(b.chart_id)))picker.append(new Option(choice.difficulty+' · '+(choice.level||'?'),choice.chart_id));
    picker.value=c.chart_id;
    picker.onchange=()=>{selectedCharts.set(key,picker.value);catalog(key);[...el('songs').querySelectorAll('.row-difficulty')].find(p=>p.value===selectedCharts.get(key))?.focus();};
    const level=make('span',constantLabel(c),'chart-level chart-constant'),bpm=make('span',values.bpm(c)==null?'—':String(values.bpm(c)),'chart-bpm'),speed=make('span',values.speed(c)==null?'—':values.speed(c).toFixed(1),'chart-speed');
    bpm.setAttribute('aria-label',values.bpm(c)==null?'BPM unknown':values.bpm(c)+' BPM');bpm.title='Source song BPM; individual passages may change tempo.';
    level.setAttribute('aria-label','Chart constant '+(chartConstant(c)==null?'unknown':constantLabel(c)));level.title=chartConstant(c)==null?'No decimal constant is available in this catalog release.':'Chart constant from the retained source revision; game updates may change it.';speed.setAttribute('aria-label',(values.speed(c)==null?'Unknown':values.speed(c).toFixed(1))+' inputs per second');
    const flow=overview.graph(c,{compact:true});header.append(heading,picker,level,bpm,speed,flow);
    header.onclick=event=>{if(!event.target.closest('button,select,label,input,a'))summary.click();};
    const panel=make('div',undefined,'chart-measurements');panel.id='chart-'+index;panel.hidden=!expandedRows.has(key);summary.setAttribute('aria-expanded',String(!panel.hidden));summary.setAttribute('aria-controls',panel.id);
    const renderDetails=()=>{
      panel.replaceChildren();panel.append(make('h3',c.format+' '+c.difficulty+' · Lv. '+(c.level||'?')),metrics(c));
      panel.append(make('p','Chart constant '+(chartConstant(c)==null?'not available':constantLabel(c))+' · '+(chartConstant(c)==null?'This catalog has no retained decimal value.':'From the retained source revision.'),'muted'));
      panel.append(make('p',genreLabel(folderValue(c,'genre'))+' · '+folderValue(c,'version')+' · '+(values.bpm(c)==null?'BPM unknown':values.bpm(c)+' BPM'),'muted'));
      panel.append(overview.details(c));
      const actions=make('div',undefined,'chart-detail-actions'),compareButton=make('button','Compare this chart'),similarButton=make('button','Find similar');
      compareButton.onclick=()=>{selectView('compare');if(comparisonUI.first()&&comparisonUI.first()!==c.chart_id)comparisonUI.useAsSecond(c.chart_id);else comparisonUI.useAsFirst(c.chart_id);};
      similarButton.onclick=()=>{selectView('compare');comparisonUI.useAsFirst(c.chart_id,true);};actions.append(compareButton,similarButton);panel.append(actions);
      const link=make('button','Explore the pattern dictionary','text-button');link.onclick=()=>selectView('patterns');panel.append(link);
    };
    summary.onclick=()=>{panel.hidden=!panel.hidden;summary.setAttribute('aria-expanded',String(!panel.hidden));if(panel.hidden)expandedRows.delete(key);else{expandedRows.add(key);renderDetails();}};
    if(!panel.hidden)renderDetails();row.append(header,panel);el('songs').append(row);
  }
  el('catalog-count').textContent=charts.length.toLocaleString()+' charts found';
  if(!charts.length)el('songs').append(make('p','No charts match this combination. Remove a filter or try another search.','empty-state'));
  el('more').hidden=rows.length<=visible;
}

el('search').oninput=()=>{visible=40;catalog();};
el('more').onclick=()=>{visible+=40;catalog();};
for(const name of ['compare','catalog','patterns','about'])el(name+'-tab').onclick=()=>selectView(name);
el('loaded-count').textContent=data.catalog.length.toLocaleString();
window.maimaiPreviewField=field;
initializeFilters();catalog();
comparisonUI=window.maimaiChartComparison.mount({data,eligibleIds:()=>data.catalog.filter(c=>{
  if(format!=='all'&&c.format!==format)return false;
  if(selectedVersions.size&&!selectedVersions.has(folderValue(c,'version')))return false;
  if(!patternFilter.matches(c))return false;
  if(el('filter-genre').value&&folderValue(c,'genre')!==el('filter-genre').value)return false;
  return chartFilters.matches(c);
}).map(c=>c.chart_id)});
const params=new URLSearchParams(location.search),initialView=params.get('view'),initialPattern=params.get('pattern');
window.maimaiPatternLibrary.setDiscovery(id=>{el('reset-filters').click();patternFilter.set([id]);writePatternFilter();selectView('catalog');catalog();el('pattern-filter-summary').focus();});
window.maimaiPatternLibrary.setNavigation(id=>{const url=new URL(location.href);if(id)url.searchParams.set('pattern',id);else url.searchParams.delete('pattern');history.replaceState(null,'',url);});
if(['catalog','patterns','compare','about'].includes(initialView))selectView(initialView);
if(initialPattern&&window.maimaiPatternLibrary.has(initialPattern)){window.maimaiPatternLibrary.show(initialPattern);}
})();
