import {PositionRestorer} from '../runtime/position';
import {effectiveSortRules} from '../runtime/browser-state';
/** Existing DOM behavior with explicit module dependencies. */
export function createChallengeReview(ports) {
let browserState,previewField;
/* Public chart browsing and authored pattern previews. */
(()=>{'use strict';
const i18n=ports.localization||{text:(node,value)=>node.textContent=value,attribute:(node,key,value)=>node.setAttribute(key,value),option:(...args)=>new Option(...args),original:node=>node.textContent,verbatim:value=>value,parts:(values,separator)=>values.join(separator),message:(source,values)=>source.replace(/\{(\d+)\}/g,(_,n)=>values[n]),literal:(node,value)=>node.textContent=value};

let data=ports.publicData??=JSON.parse(document.getElementById('challenge-data').textContent);
try{
  // Preserve the adapter's in-place normalization contract on a detached application view.
  if(data.schema_version==='maimai-browser-catalog-2')data=ports.catalogQuery.createView(data);
  data=ports.registry.normalize(data);
}catch(error){
  let status=document.getElementById('lab-status');
  if(!status){status=document.createElement('p');status.id='lab-status';status.setAttribute('role','alert');document.getElementById('catalog').prepend(status);}
  status.dataset.catalogError='genre';i18n.text(status,error.message);ports.publicData=undefined;return;
}
ports.chartLinks.configure(data.mai_notes);
const byId=new Map(data.catalog.map(c=>[c.chart_id,c]));
const el=id=>document.getElementById(id),make=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)i18n.text(e, text);if(cls)e.className=cls;return e;};
const state=ports.browserState;state.configure(data);let comparisonUI=null;
const navigation=data.navigation||{charts:{},genres:[],versions:[]};
const overview=ports.overview;
const personal=ports.personal;personal?.configure(data,data.provider_mapping);
function folderValue(c,mode){
  if(mode==='level')return c.level||'unknown';
  const n=navigation.charts[c.chart_id];
  return n&&n.source_hash===c.source_hash?(n[mode]||'unknown'):'unknown';
}
const displayTitle=c=>ports.catalogQuery?.titleLabel(c,i18n.locale)|| (c.title.trim()?c.title:'〈Blank title〉');
function metrics(c){const root=make('div',undefined,'demand');for(const [group,key,label,unit] of [['cadence','mean_onsets_s','Average input speed',' /s'],['cadence','peak_onsets_s','Busiest 1 s',' inputs'],['coordination','simultaneous_fraction','Simultaneous inputs','%'],['holds','occupancy','Avg active holds',''],['slides','occupancy','Avg moving slides',''],['spatial','single_step_buttons','Single-input spacing',' buttons']]){let value=c.demand?.[group]?.[key];if(value!=null&&unit==='%')value*=100;const e=make('div',label,'metric');e.append(make('strong',value==null?'Unknown':value.toFixed(1)+unit));root.append(e);}return root;}
function xy(pos){if(pos==='C')return[0,0];let n,r=1,offset=0;if(typeof pos==='number')n=pos;else if(/^[ABDE][1-8]$/.test(pos||'')){n=+pos[1];r='BE'.includes(pos[0])?.55:1;offset='DE'.includes(pos[0])?-.5:0;}else return null;let a=(n-.5+offset)*Math.PI/4;return[Math.sin(a)*r,-Math.cos(a)*r];}
const ns='http://www.w3.org/2000/svg';
function svgNode(tag,attrs){const e=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))i18n.attribute(e,k,String(v));return e;}
function field(snippet,label,lead=600000){const box=make('div',undefined,'field');box.append(make('h4',label));const svg=svgNode('svg',{viewBox:'-1.35 -1.35 2.7 2.7',role:'img','aria-label':label+' chart passage'});box.append(svg);const note=make('p','', 'muted');box.append(note);
function draw(t){svg.replaceChildren();svg.append(svgNode('circle',{cx:0,cy:0,r:1,fill:'none',stroke:'#cfc4e8','stroke-width':.025}));for(let n=1;n<=8;n++){let[x,y]=xy(n);svg.append(svgNode('circle',{cx:x,cy:y,r:.09,fill:'white',stroke:'#aa9dc3','stroke-width':.012}));const tx=svgNode('text',{x,y:y+.036,'text-anchor':'middle','font-size':.11,fill:'#65577d'});i18n.text(tx, n);svg.append(tx);}
let unknown=0;
for(const s of snippet.slides){if(t<s.wait_start_us||t>s.movement_end_us)continue;if(!s.geometry){unknown++;continue;}const points=s.geometry.points,waiting=t<s.movement_start_us;svg.append(svgNode('polyline',{points:points.map(p=>p.join(',')).join(' '),fill:'none',stroke:waiting?'#987500':'#007d88','stroke-width':.05,'stroke-dasharray':waiting?'.07 .04':'none'}));if(!waiting){let u=Math.min(1,(t-s.movement_start_us)/(s.movement_end_us-s.movement_start_us));let lengths=points.slice(1).map((p,i)=>Math.hypot(p[0]-points[i][0],p[1]-points[i][1]));let distance=u*lengths.reduce((a,b)=>a+b,0),i=0;while(i<lengths.length-1&&distance>lengths[i])distance-=lengths[i++];let v=lengths[i]?distance/lengths[i]:0;let p=[points[i][0]+v*(points[i+1][0]-points[i][0]),points[i][1]+v*(points[i+1][1]-points[i][1])];svg.append(svgNode('circle',{cx:p[0],cy:p[1],r:.065,fill:'#007d88'}));}}
for(const h of snippet.holds){let p=xy(h.position);if(p&&t>=h.start_us&&t<h.end_us)svg.append(svgNode('circle',{cx:p[0],cy:p[1],r:.16,fill:'none',stroke:h.simultaneous?'#947000':'#b55812','stroke-width':.05}));}
for(const e of snippet.events){let dt=e.time_us-t;if(dt< -120000||dt>lead)continue;let p=xy(e.position);if(!p)continue;let r=Math.max(.05,Math.min(.16,.16-dt/600000*.10));svg.append(svgNode('circle',{cx:p[0],cy:p[1],r,fill:e.simultaneous?'#f4c430':e.role==='star_tap'?'#007d88':'#b82d75',stroke:e.simultaneous?'#947000':'none','stroke-width':.025,opacity:dt<0?.5:1}));}
i18n.text(note, (t/1000000).toFixed(2)+' s · '+(unknown?unknown+' active path(s) not rendered':'Wait: dashed gold · Move: solid teal'));}
return{box,draw};}
function selectView(name){
  ports.views.show(name);
  ports.patternLibrary.stop();
  if(name==='catalog')catalog();else if(name==='compare')comparisonUI?.render();else if(name==='patterns')ports.patternLibrary.render();
}
const difficultyOrder=['BASIC','ADVANCED','EXPERT','MASTER','RE:MASTER'];
const difficultyRank=c=>{const rank=difficultyOrder.indexOf(c.difficulty.toUpperCase());return rank<0?null:rank;};
const collator=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
const chartConstant=c=>{const record=navigation.charts?.[c.chart_id],value=record?.chart_constant;return (c.variant_id?record?.chart_id===c.chart_id:record?.source_hash===c.source_hash)&&Number.isFinite(value)&&value>0&&value<=15?value:null;};
const constantLabel=c=>chartConstant(c)==null?'—':chartConstant(c).toFixed(1);
const sortFields={title:'Title',artist:'Artist',constant:'Source constant',bpm:'BPM',difficulty:'Difficulty',format:'Format',genre:'Genre',version:'Version',speed:'Inputs / s',peak:'Peak inputs / s'};

const personalSorts={rating:'Your RT',achievement:'Your achievement',grade:'Your grade',lastPlayed:'Last recorded play'};
const filters=['genre'];
let chartFilters,patternFilter,regionFilter;
const versionLabel=value=>value.replace(/^maimai DX /,'DX ').replace(/^maimai /,'');
const genreLabel=value=>(navigation.genres||[]).find(g=>g.id===value)?.label||'Uncategorized';
const values={title:c=>displayTitle(c),artist:c=>c.artist,constant:chartConstant,bpm:c=>navigation.charts?.[c.chart_id]?.bpm??null,difficulty:c=>ports.catalogFilters.levelNumber(c.level),format:c=>c.format,genre:c=>genreLabel(folderValue(c,'genre')),version:c=>{const v=(navigation.versions||[]).indexOf(folderValue(c,'version'));return v<0?null:v;},speed:c=>c.demand?.cadence?.mean_onsets_s??null,peak:c=>{const record=overview.get(c);if(record&&Object.hasOwn(record,'flow_peak'))return record.flow_peak;const peaks=(record?.segments||[]).filter(s=>s[3]!=null&&s[4]>0).map(s=>s[3]);return peaks.length?Math.max(...peaks):null;}};
Object.assign(values,{achievement:c=>personal?.record(c)?.achievement??null,grade:c=>personal?.gradeIndex(c)??null,rating:c=>personal?.record(c)?.rate??null,lastPlayed:c=>personal?.lastPlayed(c)??null});


const rowKey=c=>JSON.stringify([c.variant_id?c.song_id:(navigation.charts?.[c.chart_id]?.source_path||c.source_container_id||c.song_id),c.format,c.variant_id||'ordinary']);
function compareCharts(a,b,rules){
  for(const rule of rules){if(!rule.key)continue;const av=values[rule.key](a),bv=values[rule.key](b);
    // Unknown measurements stay at the end in either direction.
    if(av==null||bv==null){if(av!==bv)return av==null?1:-1;continue;}
    const diff=typeof av==='number'?av-bv:collator.compare(av,bv);if(diff)return diff*rule.direction;
  }
  const title=collator.compare(displayTitle(a),displayTitle(b));if(title)return title;
  const al=values.difficulty(a),bl=values.difficulty(b);
  if(al!==bl){if(al==null||bl==null)return al==null?1:-1;return bl-al;}
  return (difficultyRank(b)??-1)-(difficultyRank(a)??-1)||collator.compare(a.format,b.format)||a.chart_id.localeCompare(b.chart_id);
}
function sortLabel(rule){return (sortFields[rule.key]||personalSorts[rule.key])+(['title','artist','genre','format'].includes(rule.key)?(rule.direction===1?' A–Z':' Z–A'):(rule.direction===1?' ↑':' ↓'));}

function renderSort(){
  const root=el('sort-rules');root.replaceChildren();
  state.sortRules.forEach((rule,index)=>{const b=make('button',(index+1)+'. '+sortLabel(rule)+' ×','filter-chip');i18n.attribute(b, 'aria-label', 'Remove '+(sortFields[rule.key]||personalSorts[rule.key])+' sort priority');b.onclick=()=>{state.removeSort(index);renderSort();catalog();document.querySelector('[data-sort-key="'+rule.key+'"]').focus();};root.append(b);});
  for(const button of document.querySelectorAll('[data-sort-key]')){
    const key=button.dataset.sortKey,index=state.sortRules.findIndex(r=>r.key===key),rule=state.sortRules[index],label=key==='title'?'Song / artist':key==='peak'?'Flow · peak':sortFields[key];
    const indicator=make('span',rule?(rule.direction===1?'↑':'↓'):'↕','sort-indicator');indicator.setAttribute('aria-hidden','true');
    if(rule)indicator.append(make('span',String(index+1),'sort-priority'));
    button.replaceChildren(make('span',label,'sort-label'),indicator);button.setAttribute('aria-pressed',String(!!rule));
    i18n.attribute(button, 'aria-label', label+(rule?', priority '+(index+1)+', '+(rule.direction===1?'ascending':'descending'):' unsorted'));
    button.onclick=event=>{state.changeSort(key,event.shiftKey||el('sort-keep').checked);renderSort();catalog();button.focus();};
  }
}
function initializeFilters(){
  ports.filterDisclosure(el('catalog-filters'),el('catalog-filters-toggle'),el('catalog-filter-content').firstElementChild,'maimai-catalog-filters-collapsed');
  chartFilters=ports.catalogFilters.mount(data.catalog,()=>{state.visible=40;catalog();});
  patternFilter=ports.patternFilter.mount(overview,()=>{state.visible=40;writePatternFilter();catalog();});
  for(const id of filters){const select=el('filter-'+id);let options=[];
    if(id==='genre')options=(navigation.genres||[]).map(g=>[g.id,g.label]);
    for(const [value,label]of options){const option=i18n.option(label, value);select.append(option);}
    select.onchange=()=>{ports.usage?.emit('filter_first_used',undefined,'genre');state.visible=40;catalog();};
  }
  for(const key of ['all','STD','DX'])el('format-'+key).onclick=()=>{ports.usage?.emit('filter_first_used',undefined,'format');state.format=key;state.visible=40;updateFormat();catalog();};
  for(const version of navigation.versions||[]){
    const label=make('label'),checkbox=make('input');checkbox.type='checkbox';checkbox.value=version;
    checkbox.onchange=()=>{ports.usage?.emit('filter_first_used',undefined,'version');if(checkbox.checked)state.selectedVersions.add(version);else state.selectedVersions.delete(version);state.visible=40;updateVersions();catalog();};
    const text=make('span',i18n.verbatim(versionLabel(version)),'version-name'),detail=make('small','','version-count');detail.setAttribute('aria-hidden','true');text.append(detail);
    label.append(checkbox,ports.artwork.version(version),text);el('version-options').append(label);
  }
  updateVersionCounts();
  el('version-clear').onclick=()=>{state.selectedVersions.clear();state.visible=40;updateVersions();catalog();};
  el('version-filter').addEventListener('keydown',event=>{if(event.key==='Escape'){el('version-filter').open=false;el('version-summary').focus();event.stopPropagation();}});
  document.addEventListener('click',event=>{if(!el('version-filter').contains(event.target))el('version-filter').open=false;});
  el('reset-filters').onclick=()=>{ports.usage?.emit('filters_reset',undefined,'catalog');for(const id of filters)el('filter-'+id).value='';regionFilter?.clear(false);state.selectedVersions.clear();updateVersions();updateVersionCounts();chartFilters.clear();patternFilter.clear();el('search').value='';state.format='all';state.visible=40;writePatternFilter();updateFormat();catalog();comparisonUI?.render();};
  renderSort();
}
function writePatternFilter(){const url=new URL(location.href);url.searchParams.delete('pattern-filter');for(const id of patternFilter.ids())url.searchParams.append('pattern-filter',id);ports.historyPort.replaceState(history.state,'',url);}
function updateVersionCounts(){
  const counts=new Map();
  for(const chart of data.catalog){const version=folderValue(chart,'version');if(!counts.has(version))counts.set(version,{charts:0,songs:new Set()});const count=counts.get(version);count.charts++;count.songs.add(rowKey(chart));}
  for(const label of el('version-options').querySelectorAll('label')){
    const count=counts.get(label.querySelector('input').value),songs=count?.songs.size||0,charts=count?.charts||0;
    i18n.text(label.querySelector('.version-count'), songs+' song'+(songs===1?'':'s')+' · '+charts+' charts');
    i18n.attribute(label, 'title', songs+' song / format entries, '+charts+' charts');
  }
}
function updateVersions(){
  i18n.text(el('version-summary'), state.selectedVersions.size===0?'All versions':state.selectedVersions.size===1?i18n.verbatim(versionLabel([...state.selectedVersions][0])):state.selectedVersions.size+' versions selected');
  for(const input of el('version-options').querySelectorAll('input'))input.checked=state.selectedVersions.has(input.value);
}
function updateFormat(){for(const key of ['all','STD','DX'])el('format-'+key).setAttribute('aria-pressed',String(key===state.format));}
function activeFilters(){
  const root=el('active-filters'),chips=[];
  const count=Number(!!el('search').value.trim())+Number(state.format!=='all')+Number(state.selectedVersions.size>0)+chartFilters.activeCount()+Number(patternFilter.ids().length>0)+Number(!!el('filter-genre').value)+Number(!!regionFilter?.value())+Number(!!el('use-international-data')?.checked);
  i18n.text(el('catalog-filter-count'),count?`${count} active`:'');
  el('catalog-filters-empty').hidden=count>0;el('reset-filters').hidden=count===0;
  function chip(label,remove){const button=make('button',label+' ×','filter-chip');i18n.attribute(button,'aria-label','Remove '+label+' filter');button.onclick=remove;chips.push(button);}
  if(el('search').value.trim())chip(`Search: ${el('search').value.trim()}`,()=>{el('search').value='';state.visible=40;catalog();});
  if(state.format!=='all')chip(state.format,()=>{state.format='all';updateFormat();state.visible=40;catalog();});
  const international=el('use-international-data');
  if(international?.checked)chip('Use maimai international data',()=>international.click());
  if(regionFilter?.value())chip(regionFilter.label(),()=>regionFilter.clear());
  for(const version of state.selectedVersions){
    const button=make('button',i18n.verbatim(versionLabel(version)+' ×'),'filter-chip');i18n.attribute(button, 'aria-label', i18n.message('Remove version {0}',[i18n.verbatim(versionLabel(version))]));
    button.onclick=()=>{state.selectedVersions.delete(version);state.visible=40;updateVersions();catalog();el('version-summary').focus();};chips.push(button);
  }
  chips.push(...chartFilters.chips(),...patternFilter.chips());
  for(const id of filters){const select=el('filter-'+id);if(!select.value)continue;
    const button=make('button',i18n.original(select.selectedOptions[0])+' ×','filter-chip');
    i18n.attribute(button, 'aria-label', 'Remove '+i18n.original(select.parentElement.firstChild)+' filter');
    button.onclick=()=>{select.value='';state.visible=40;catalog();select.focus();};chips.push(button);
  }
  // Preserve controls during text-field blur so a pending pointer click lands
  // on the same chip after the level filter updates.
  const existing=new Map([...root.children].map(node=>[node.getAttribute('aria-label'),node]));
  chips.forEach((candidate,index)=>{const key=candidate.getAttribute('aria-label'),node=existing.get(key)||candidate;existing.delete(key);i18n.text(node, i18n.original(candidate));node.onclick=candidate.onclick;if(root.children[index]!==node)root.insertBefore(node,root.children[index]||null);});
  for(const node of existing.values())node.remove();
}
function catalog(focusKey=null){
  state.search=el('search').value;state.genre=el('filter-genre').value;
  const matchesSearch=ports.songSearch.query(state.search);
  const selected=Object.fromEntries(filters.map(id=>[id,el('filter-'+id).value]));
  const region=regionFilter?.value();
  const charts=data.catalog.filter(c=>{
    if(state.format!=='all'&&c.format!==state.format)return false;
    if(!matchesSearch(c))return false;
    if(selected.genre&&folderValue(c,'genre')!==selected.genre)return false;
    if(!ports.registry.matchesRegion(c,region))return false;
    if(state.selectedVersions.size&&!state.selectedVersions.has(folderValue(c,'version')))return false;
    if(!chartFilters.matches(c))return false;
    if(!patternFilter.matches(c))return false;
    if(personal&&!personal.matches(c))return false;
    return true;
  });
  // Each matching chart owns a stable row. A local difficulty change only
  // replaces that row's contents; it must not reorder or hide other charts.
  const grouped=new Map();
  for(const chart of charts){const key=rowKey(chart);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(chart);}
  const rules=effectiveSortRules(state.sortRules,personal?.enabled()===true);
  const rows=charts.map(chart=>({key:chart.chart_id,chart})).sort((a,b)=>compareCharts(a.chart,b.chart,rules));
  if(focusKey){state.selectedCharts.delete(focusKey);state.visible=Math.max(state.visible,rows.findIndex(row=>row.key===focusKey)+1);}
  el('songs').replaceChildren();activeFilters();
  for(const [index,{key,chart}]of rows.slice(0,state.visible).entries()){
    const choices=grouped.get(rowKey(chart));
    const selected=choices.find(c=>c.chart_id===state.selectedCharts.get(key));
    if(!selected)state.selectedCharts.delete(key);
    function renderRow(c){
    const row=make('article',undefined,'song-row');row.dataset.rowKey=key;row.dataset.chartId=c.chart_id;row.dataset.level=c.level||'';row.dataset.constant=chartConstant(c)??'';row.dataset.title=c.title;row.dataset.difficulty=c.difficulty;row.dataset.genre=folderValue(c,'genre');row.dataset.version=folderValue(c,'version');
    const header=make('div',undefined,'chart-summary');
    const summary=make('button',undefined,'chart-row'),identity=make('span',undefined,'song-identity'),title=make('span',i18n.verbatim(displayTitle(c)),'song-title');summary.type='button';
    const titleLine=make('span',undefined,'song-title-line'),reading=ports.songSearch.romaji(c);titleLine.append(title);
    if(reading){const roman=make('span',i18n.verbatim(reading),'song-romaji');roman.lang='ja-Latn';titleLine.append(roman);}
    identity.append(titleLine,make('span',i18n.parts([c.artist?i18n.verbatim(c.artist):'Artist not provided',i18n.verbatim(c.format)],' · '),'muted'));summary.append(identity);
    i18n.attribute(summary, 'aria-label', i18n.message(chartConstant(c)==null?'Open {0} · {1} · Chart constant unknown':'Open {0} · {1} · Chart constant {2}',[i18n.verbatim(displayTitle(c)),i18n.parts([i18n.verbatim(c.format),c.difficulty],' '),i18n.verbatim(constantLabel(c))]));
    const heading=make('div',undefined,'chart-row-heading'),videoLink=ports.chartLinks.group(c);
    heading.append(ports.artwork.jacket(c),summary,overview.chips(c,3,patternFilter.ids()));if(videoLink)heading.append(videoLink);
    const picker=make('select',undefined,'row-difficulty');picker.id='row-difficulty-'+index;i18n.attribute(picker,'aria-label','Difficulty for '+displayTitle(c)+' '+c.format);
    for(const choice of [...choices].sort((a,b)=>(difficultyRank(b)??-1)-(difficultyRank(a)??-1)||a.chart_id.localeCompare(b.chart_id)))picker.append(i18n.option(i18n.parts([choice.difficulty,i18n.verbatim(choice.level||'?')],' · '),choice.chart_id));
    picker.value=c.chart_id;
    picker.onchange=()=>{const next=choices.find(choice=>choice.chart_id===picker.value);if(!next)return;if(state.expandedRows.has(key))ports.usage?.emit('chart_opened');state.selectedCharts.set(key,next.chart_id);const replacement=renderRow(next);row.replaceWith(replacement);replacement.querySelector('.row-difficulty').focus({preventScroll:true});};
    const level=make('span',constantLabel(c),'chart-level chart-constant'),bpm=make('span',values.bpm(c)==null?'—':String(values.bpm(c)),'chart-bpm'),speed=make('span',values.speed(c)==null?'—':values.speed(c).toFixed(1),'chart-speed');
    i18n.attribute(bpm, 'aria-label', values.bpm(c)==null?'BPM unknown':values.bpm(c)+' BPM');i18n.attribute(bpm, 'title', 'Source song BPM; individual passages may change tempo.');
    i18n.attribute(level, 'aria-label', 'Chart constant '+(chartConstant(c)==null?'unknown':constantLabel(c)));i18n.attribute(level, 'title', chartConstant(c)==null?'No verified source constant is available for this context.':(()=>{const source=navigation.charts?.[c.chart_id]?.metric_sources?.chart_constant;return source?[source.provider,source.region,source.release||'game version unspecified'].filter(Boolean).join(' · '):'Neskol source constant · regional and game-version scope unspecified.';})());i18n.attribute(speed, 'aria-label', (values.speed(c)==null?'Unknown':values.speed(c).toFixed(1))+' inputs per second');
    const flow=overview.graph(c,{compact:true});header.append(heading,picker,level,bpm,speed,flow);
    const footer=make('div',undefined,'chart-card-footer'),version=folderValue(c,'version'),metadata=make('div',undefined,'chart-card-metadata');
    const versionArt=ports.artwork.version(version);i18n.attribute(versionArt, 'title', i18n.verbatim(version));
    metadata.append(versionArt,make('span',genreLabel(folderValue(c,'genre')),'chart-card-genre'),make('span',i18n.verbatim(version),'chart-card-version'));
    const actions=make('div',undefined,'chart-detail-actions'),compareButton=make('button','Compare this chart'),similarButton=make('button','Find similar');
    compareButton.type=similarButton.type='button';
    compareButton.onclick=()=>{selectView('compare');if(comparisonUI.first()&&comparisonUI.first()!==c.chart_id)comparisonUI.useAsSecond(c.chart_id);else comparisonUI.useAsFirst(c.chart_id);};
    similarButton.disabled=!c.demand;i18n.attribute(similarButton, 'title', c.demand?'Find charts with comparable measurements':'Similarity needs prepared analysis');
    similarButton.onclick=()=>{selectView('compare');comparisonUI.useAsFirst(c.chart_id,true);};actions.append(compareButton,similarButton);footer.append(metadata,actions);header.append(footer);
    if(personal)header.append(personal.summary(c));
    header.onclick=event=>{if(!event.target.closest('button,select,label,input,a'))summary.click();};
    const panel=make('div',undefined,'chart-measurements');panel.id='chart-'+index;panel.hidden=!state.expandedRows.has(key);row.classList.toggle('is-expanded',!panel.hidden);summary.setAttribute('aria-expanded',String(!panel.hidden));summary.setAttribute('aria-controls',panel.id);
    const renderDetails=()=>{
      const identity=make('span',undefined,'chart-detail-identity'),formatBadge=make('span',c.format,'chart-format-badge');formatBadge.dataset.format=c.format;
      identity.append(formatBadge,make('span',c.difficulty,'chart-difficulty-badge'),make('span',c.level||'?','chart-detail-level'));
      const track=overview.section('chart','Chart details',identity);track.content.append(metrics(c),overview.details(c));
      panel.replaceChildren(track.root);if(ports.songPages)track.content.append(ports.songPages.link(c.song_id,c.chart_id));if(personal)panel.append(personal.details(c));
    };
    summary.onclick=()=>{panel.hidden=!panel.hidden;row.classList.toggle('is-expanded',!panel.hidden);summary.setAttribute('aria-expanded',String(!panel.hidden));if(panel.hidden)state.expandedRows.delete(key);else{state.expandedRows.add(key);renderDetails();ports.usage?.emit('chart_opened');}};
    if(!panel.hidden)renderDetails();row.append(header,panel);return row;
    }
    el('songs').append(renderRow(selected||chart));
  }
  const count=el('catalog-count'),number=document.createElement('strong'),unit=document.createElement('span');number.textContent=charts.length.toLocaleString();i18n.text(unit,'charts');count.replaceChildren(number,document.createTextNode(' '),unit);
  if(!charts.length)el('songs').append(make('p','No charts match this combination. Remove a filter or try another search.','empty-state'));
  el('more').hidden=rows.length<=state.visible;
}

el('search').oninput=event=>{state.search=el('search').value;if(event.isComposing)return;ports.usage?.emit('search_used',undefined,'charts');state.visible=40;catalog();};el('search').addEventListener('compositionend',()=>{ports.usage?.emit('search_used',undefined,'charts');state.visible=40;catalog();});
el('more').onclick=()=>{state.visible+=40;catalog();};
for(const name of ['compare','catalog','patterns','about'])el(name+'-tab').onclick=()=>selectView(name);
previewField=field;ports.onPreviewField(field);
initializeFilters();
regionFilter=ports.registry.mount(data,()=>{updateVersionCounts();state.visible=40;catalog();comparisonUI?.render();});
const personalControls=personal?.controls(el('catalog'),()=>{state.visible=40;catalog();});
function personalChanged(){for(const key of Object.keys(personalSorts))delete sortFields[key];if(personal?.enabled())Object.assign(sortFields,personalSorts);;if(!state.sortRules.length)state.sortRules=[{key:'title',direction:1}];renderSort();catalog();comparisonUI?.render();}
personal?.subscribe(personalChanged);personalChanged();
comparisonUI=ports.comparison.mount({data,eligibleIds:()=>data.catalog.filter(c=>{
  if(state.format!=='all'&&c.format!==state.format)return false;
  if(state.selectedVersions.size&&!state.selectedVersions.has(folderValue(c,'version')))return false;
  if(!patternFilter.matches(c))return false;
    if(personal&&!personal.matches(c))return false;
  if(el('filter-genre').value&&folderValue(c,'genre')!==el('filter-genre').value)return false;
  if(!ports.registry.matchesRegion(c,regionFilter?.value()))return false;
  return chartFilters.matches(c);
}).map(c=>c.chart_id)});
const params=new URLSearchParams(location.search),initialView=params.get('view'),initialPattern=params.get('pattern');
ports.patternLibrary.setDiscovery(id=>{ports.usage?.emit('filter_first_used',undefined,'pattern');if(ports.usage?.suspend)ports.usage.suspend(()=>el('reset-filters').click());else el('reset-filters').click();patternFilter.set([id]);writePatternFilter();selectView('catalog');catalog();el('pattern-filter-summary').focus();});
ports.patternLibrary.setNavigation(id=>{const url=new URL(location.href);if(id)url.searchParams.set('pattern',id);else url.searchParams.delete('pattern');ports.historyPort.replaceState(history.state,'',url);});
function applyRoute(){const p=new URLSearchParams(location.search),id=ports.registry.resolve(data,p.get('chart'));if(id&&p.get('view')==='catalog'){const c=byId.get(id);if(c){state.expandedRows.add(id);selectView('catalog');catalog(id);const findRow=()=>[...el('songs').children].find(n=>n.dataset.rowKey===id);let row=findRow();if(!row){el('reset-filters').click();personalControls?.clear();catalog(id);row=findRow();}row?.scrollIntoView({block:'center'});}else{i18n.text(el('catalog-count'), 'The linked chart is unavailable in this catalog version. Search for the song below.');}}else if(['catalog','patterns','compare','about'].includes(p.get('view')))selectView(p.get('view'));if(p.get('search')){el('search').value=p.get('search');catalog();}}
const restoreRoute=()=>ports.usage?.suspend?ports.usage.suspend(applyRoute):applyRoute();
restoreRoute();
const position=new PositionRestorer({history:ports.historyPort,playerReady:personal.ready,linksReady:()=>ports.songPages.ready()});
// DOM translation only; the typed owner validates and commits public snapshots.
browserState=state.bind({
 readTransient:()=>({
  auxiliary:{sortKeep:el('sort-keep').checked,patternSearch:el('pattern-filter-search').value,menus:['version-filter','difficulty-filter','pattern-filter'].map(id=>[id,el(id).open])},
  scroll:[scrollX,scrollY],focus:document.activeElement?.id||null,locale:ports.localization.locale,
 }),
 writeControls(value){
  el('search').value=value.search;el('filter-genre').value=value.genre;
  chartFilters.sync();patternFilter.sync();regionFilter?.sync();personalControls?.sync();
 },
 render(){updateFormat();updateVersions();updateVersionCounts();renderSort();catalog();comparisonUI?.sync();},
 writeDisclosures(value){
  ports.filterDisclosure.sync();
  if(value.auxiliary){el('sort-keep').checked=value.auxiliary.sortKeep;el('pattern-filter-search').value=value.auxiliary.patternSearch;el('pattern-filter-search').dispatchEvent(new Event('input'));for(const [id,open]of value.auxiliary.menus)el(id).open=open;}
  for(const id of value.history){const toggle=el(id)?.previousElementSibling;if(toggle?.classList.contains('player-pb-toggle')&&toggle.getAttribute('aria-expanded')==='false')toggle.click();}
 },
 openRoute:restoreRoute,versionChanged(){updateVersions();catalog();},position,localization:ports.localization,usage:ports.usage,
});

if(initialPattern&&ports.patternLibrary.has(initialPattern)){ports.patternLibrary.show(initialPattern);}
})();

return {browserState,previewField};
}
