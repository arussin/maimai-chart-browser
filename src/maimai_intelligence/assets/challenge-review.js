/* Sealed review; no network, account access, automatic storage or imported scores. */
(()=>{'use strict';
const data=JSON.parse(document.getElementById('challenge-data').textContent);
const byId=new Map(data.catalog.map(c=>[c.chart_id,c]));
const el=id=>document.getElementById(id),make=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const names={cadence:'Input speed',rhythm:'Rhythm',coordination:'Simultaneous inputs',holds:'Hold interactions',slides:'Slide timing',spatial:'Layout'};
const judgments=new Map();let cleanup=[],visible=40,format='all',comparisonUI=null;
const navigation=data.navigation||{charts:{},genres:[],versions:[]};
const overview=window.maimaiChartOverview;
function folderValue(c,mode){
  if(mode==='level')return c.level||'unknown';
  const n=navigation.charts[c.chart_id];
  return n&&n.source_hash===c.source_hash?(n[mode]||'unknown'):'unknown';
}
const displayTitle=c=>c.title.trim()?c.title:'〈Blank title〉';
function meta(c){const e=make('div',undefined,'meta');e.append(make('span',c.format,'badge'),make('span',c.difficulty,'badge '+c.difficulty.replace(':','')),make('span','Lv. '+(c.level||'?')));return e;}
function metrics(c){const root=make('div',undefined,'demand');for(const [group,key,label,unit] of [['cadence','mean_onsets_s','Average input speed',' /s'],['cadence','peak_onsets_s','Busiest 1 s',' inputs'],['coordination','simultaneous_fraction','Simultaneous inputs','%'],['holds','occupancy','Avg active holds',''],['slides','occupancy','Avg moving slides',''],['spatial','single_step_buttons','Single-input spacing',' buttons']]){let value=c.demand[group][key];if(value!==undefined&&unit==='%')value*=100;const e=make('div',label,'metric');e.append(make('strong',value===undefined?'Unknown':value.toFixed(1)+unit));root.append(e);}return root;}
function xy(pos){if(pos==='C')return[0,0];let n,r=1,offset=0;if(typeof pos==='number')n=pos;else if(/^[ABDE][1-8]$/.test(pos||'')){n=+pos[1];r='BE'.includes(pos[0])?.55:1;offset='DE'.includes(pos[0])?-.5:0;}else return null;let a=(n-.5+offset)*Math.PI/4;return[Math.sin(a)*r,-Math.cos(a)*r];}
const ns='http://www.w3.org/2000/svg';
function svgNode(tag,attrs){const e=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,String(v));return e;}
function field(snippet,label,lead=600000){const box=make('div',undefined,'field');box.append(make('h4',label));const svg=svgNode('svg',{viewBox:'-1.35 -1.35 2.7 2.7',role:'img','aria-label':label+' chart passage'});box.append(svg);const note=make('p','', 'muted');box.append(note);
function draw(t){svg.replaceChildren();svg.append(svgNode('circle',{cx:0,cy:0,r:1,fill:'none',stroke:'#cfc4e8','stroke-width':.025}));for(let n=1;n<=8;n++){let[x,y]=xy(n);svg.append(svgNode('circle',{cx:x,cy:y,r:.09,fill:'white',stroke:'#aa9dc3','stroke-width':.012}));const tx=svgNode('text',{x,y:y+.036,'text-anchor':'middle','font-size':.11,fill:'#65577d'});tx.textContent=n;svg.append(tx);}
let unknown=0;
for(const s of snippet.slides){if(t<s.wait_start_us||t>s.movement_end_us)continue;if(!s.geometry){unknown++;continue;}const points=s.geometry.points,waiting=t<s.movement_start_us;svg.append(svgNode('polyline',{points:points.map(p=>p.join(',')).join(' '),fill:'none',stroke:waiting?'#987500':'#007d88','stroke-width':.05,'stroke-dasharray':waiting?'.07 .04':'none'}));if(!waiting){let u=Math.min(1,(t-s.movement_start_us)/(s.movement_end_us-s.movement_start_us));let lengths=points.slice(1).map((p,i)=>Math.hypot(p[0]-points[i][0],p[1]-points[i][1]));let distance=u*lengths.reduce((a,b)=>a+b,0),i=0;while(i<lengths.length-1&&distance>lengths[i])distance-=lengths[i++];let v=lengths[i]?distance/lengths[i]:0;let p=[points[i][0]+v*(points[i+1][0]-points[i][0]),points[i][1]+v*(points[i+1][1]-points[i][1])];svg.append(svgNode('circle',{cx:p[0],cy:p[1],r:.065,fill:'#007d88'}));}}
for(const h of snippet.holds){let p=xy(h.position);if(p&&t>=h.start_us&&t<h.end_us)svg.append(svgNode('circle',{cx:p[0],cy:p[1],r:.16,fill:'none',stroke:'#b55812','stroke-width':.05}));}
for(const e of snippet.events){let dt=e.time_us-t;if(dt< -120000||dt>lead)continue;let p=xy(e.position);if(!p)continue;let r=Math.max(.05,Math.min(.16,.16-dt/600000*.10));svg.append(svgNode('circle',{cx:p[0],cy:p[1],r,fill:e.role==='star_tap'?'#007d88':'#b82d75',opacity:dt<0?.5:1}));}
note.textContent=(t/1000000).toFixed(2)+' s · '+(unknown?unknown+' active path(s) not rendered':'Wait: dashed gold · Move: solid teal');}
return{box,draw};}
function beatAt(s,t){let a=s.bpm_segments[0];for(const x of s.bpm_segments){if(x.time_us>t)break;a=x;}return Number(a.beat[0])/Number(a.beat[1])+(t-a.time_us)/60000000*Number(a.bpm[0])/Number(a.bpm[1]);}
function timeAt(s,b){let a=s.bpm_segments[0];for(const x of s.bpm_segments){if(Number(x.beat[0])/Number(x.beat[1])>b)break;a=x;}return a.time_us+(b-Number(a.beat[0])/Number(a.beat[1]))*60000000/(Number(a.bpm[0])/Number(a.bpm[1]));}
function comparison(qid,cid,pairs){const container=make('div');if(!pairs.length){container.append(make('p','No supporting passage is available.'));return container;}
let selected=0,playing=false,position=0,previous=0,raf=0,speed=1,beatSync=true;const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const selector=make('select');selector.setAttribute('aria-label','Supporting passage');pairs.forEach((p,i)=>selector.append(new Option('Passage '+(i+1),String(i))));
const controls=make('div',undefined,'play-controls'),play=make('button','Play'),step=make('button','Step'),rate=make('button','0.5×'),sync=make('button','Beat sync'),range=make('input');range.type='range';range.min='0';range.max='1000';range.value='0';range.setAttribute('aria-label','Passage position');sync.setAttribute('aria-pressed','true');controls.append(selector,play,step,rate,sync,range);container.append(controls);const pairbox=make('div',undefined,'pair');container.append(pairbox);let q,c,left,right;
function setup(){playing=false;play.textContent='Play';position=0;const p=pairs[selected];q=data.snippets[qid]?.[p.query_window];c=data.snippets[cid]?.[p.candidate_window];pairbox.replaceChildren();if(!q||!c)return;left=field(q,'Selected chart');right=field(c,'Candidate chart');pairbox.append(left.box,right.box);draw();}
function draw(){if(!q||!c)return;let qt=q.start_us+position;let ct=beatSync?timeAt(c,beatAt(c,c.start_us)+beatAt(q,qt)-beatAt(q,q.start_us)):c.start_us+position;left.draw(Math.min(qt,q.end_us));right.draw(Math.min(ct,c.end_us));range.value=String(position/(q.end_us-q.start_us)*1000);}
function tick(now){if(!playing)return;position+=(now-previous)*1000*speed;previous=now;position%=q.end_us-q.start_us;draw();raf=requestAnimationFrame(tick);}
play.onclick=()=>{if(!q)return;playing=!playing;play.textContent=playing?'Pause':'Play';cancelAnimationFrame(raf);if(playing){previous=performance.now();raf=requestAnimationFrame(tick);}};step.onclick=()=>{playing=false;play.textContent='Play';position=(position+125000)%(q.end_us-q.start_us);draw();};rate.onclick=()=>{speed=speed===1?.5:1;rate.textContent=speed===1?'0.5×':'1×';};sync.onclick=()=>{beatSync=!beatSync;sync.setAttribute('aria-pressed',String(beatSync));draw();};range.oninput=()=>{playing=false;play.textContent='Play';position=+range.value/1000*(q.end_us-q.start_us);draw();};selector.onchange=()=>{selected=+selector.value;setup();};cleanup.push(()=>{playing=false;play.textContent='Play';cancelAnimationFrame(raf);});setup();if(reduced){container.append(make('p','Reduced motion: paused diagrams; use Step to inspect.','muted'));play.hidden=true;}return container;}
function status(){el('review-status').textContent=judgments.size+' / '+data.review.reduce((n,q)=>n+q.candidates.length,0)+' pairs judged · judgments stay here until you save them.';}
function stopPlayers(clear=true){cleanup.forEach(f=>f());if(clear)cleanup=[];}
function selectView(name){
  stopPlayers();
  for(const n of ['compare','catalog','patterns']){
    el(n).hidden=n!==name;
    el(n+'-tab').setAttribute('aria-pressed',String(n===name));
  }
  window.maimaiPatternLibrary.stop();
  if(name==='catalog')catalog();else if(name==='compare'){render();comparisonUI?.render();}else window.maimaiPatternLibrary.render();
  const url=new URL(location.href);url.searchParams.set('view',name);url.searchParams.delete('pattern');history.replaceState(null,'',url);
}
function openSample(index){
  el('query').value=String(index);
  selectView('compare');
  el('prepared-examples').open=true;
  el('query').focus();
}
function render(){
  stopPlayers();
  const item=data.review[+el('query').value];
  el('matches').replaceChildren();el('query-card').replaceChildren();
  if(!item){el('matches').append(make('p','No chart comparisons are prepared in this catalog yet.'));return;}
  const q=byId.get(item.query_id),query=make('article',undefined,'card source-card');
  query.append(make('span','STARTING CHART','eyebrow'),make('h3',displayTitle(q)),meta(q));
  el('query-card').append(query);
  const feedback=el('feedback').checked,blind=feedback&&el('blind').checked;
  let candidates=[...item.candidates];
  if(blind)candidates.sort((a,b)=>a.chart_id.localeCompare(b.chart_id));
  el('matches').append(make('h3',blind?'Charts to compare':'Charts with similar passages'));
  if(!candidates.length)el('matches').append(make('p','No candidates are prepared for this starting chart.'));
  candidates.forEach((m,i)=>{
    const c=byId.get(m.chart_id),card=make('article',undefined,'card candidate');
    const heading=make('div',undefined,'candidate-heading');
    heading.append(make('span',blind?String.fromCharCode(65+i):String(i+1),'rank'));
    const identity=make('div');identity.append(make('h4',displayTitle(c)),meta(c));heading.append(identity);card.append(heading);
    if(!blind){
      const pills=make('div',undefined,'pills');
      m.closest_groups.slice(0,2).forEach(g=>pills.append(make('span','Similar '+names[g].toLowerCase(),'pill')));
      card.append(pills,make('p','Main difference: '+names[m.largest_difference].toLowerCase()+'.','muted'));
    }
    const toggle=make('button','Compare passages'),panel=make('div',undefined,'passage-panel');
    panel.id='passages-'+i;panel.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls',panel.id);
    let initialized=false;
    toggle.onclick=()=>{
      panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden));
      toggle.textContent=panel.hidden?'Compare passages':'Close comparison';
      if(!panel.hidden&&!initialized){
        const demands=make('div',undefined,'pair measurement-pair');
        for(const [chart,label] of [[q,'Starting chart'],[c,'Suggested chart']]){
          const box=make('div');box.append(make('h5',label+' · '+displayTitle(chart)),metrics(chart));demands.append(box);
        }
        panel.append(comparison(q.chart_id,c.chart_id,m.passages),demands);initialized=true;
      }
      if(panel.hidden)stopPlayers(false);
    };
    card.append(toggle,panel);
    if(feedback){
      const controls=make('div',undefined,'judgment');controls.append(make('span','Similar challenge?'));
      const key=q.chart_id+'|'+c.chart_id;
      for(const label of ['Useful','Partly','Not useful','Uncertain']){
        const b=make('button',label);b.setAttribute('aria-pressed',String(judgments.get(key)?.judgment===label));
        b.onclick=()=>{judgments.set(key,{query_id:q.chart_id,candidate_id:c.chart_id,judgment:label});
          for(const x of controls.querySelectorAll('button'))x.setAttribute('aria-pressed',String(x===b));status();};
        controls.append(b);
      }
      card.append(controls);
    }
    el('matches').append(card);
  });
  status();
}
const difficultyOrder=['BASIC','ADVANCED','EXPERT','MASTER','RE:MASTER'];
const collator=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
const levelNumber=value=>value&&Number.isFinite(parseFloat(value))?parseFloat(value)+(value.endsWith('+')?.5:0):null;
const sortFields={title:'Title',artist:'Artist',level:'Level',bpm:'BPM',difficulty:'Difficulty',format:'Format',genre:'Genre',version:'Version',speed:'Inputs / s',peak:'Peak inputs / s'};
let sortRules=[{key:'title',direction:1}];
const filters=['genre','difficulty','min','max','pattern'],selectedVersions=new Set();
const versionLabel=value=>value.replace(/^maimai DX /,'DX ').replace(/^maimai /,'');
const genreLabel=value=>(navigation.genres||[]).find(g=>g.id===value)?.label||'Uncategorized';
const values={title:c=>displayTitle(c),artist:c=>c.artist,level:c=>levelNumber(c.level),bpm:c=>navigation.charts?.[c.chart_id]?.bpm??null,difficulty:c=>{const rank=difficultyOrder.indexOf(c.difficulty.toUpperCase());return rank<0?null:rank;},format:c=>c.format,genre:c=>genreLabel(folderValue(c,'genre')),version:c=>{const v=(navigation.versions||[]).indexOf(folderValue(c,'version'));return v<0?null:v;},speed:c=>c.demand.cadence.mean_onsets_s??null,peak:c=>{const peaks=(overview.get(c)?.segments||[]).filter(s=>s[3]!=null&&s[4]>0).map(s=>s[3]);return peaks.length?Math.max(...peaks):null;}};
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
    button.textContent=label+(rule?' '+(rule.direction===1?'↑':'↓')+' '+(index+1):' ↕');button.setAttribute('aria-pressed',String(!!rule));
    button.setAttribute('aria-label',label+(rule?', priority '+(index+1)+', '+(rule.direction===1?'ascending':'descending'):' unsorted'));
    button.onclick=event=>{const keep=event.shiftKey||el('sort-keep').checked,prior=sortRules.find(r=>r.key===key);if(keep){if(prior)prior.direction*=-1;else sortRules.push({key,direction:1});}else sortRules=[{key,direction:prior&&sortRules[0]===prior?-prior.direction:1}];visible=40;renderSort();catalog();button.focus();};
  }
}
function initializeFilters(){
  for(const id of filters){const select=el('filter-'+id);let options=[];
    if(id==='genre')options=(navigation.genres||[]).map(g=>[g.id,g.label]);
    if(id==='difficulty')options=[...new Set(data.catalog.map(c=>c.difficulty))].sort((a,b)=>difficultyOrder.indexOf(a.toUpperCase())-difficultyOrder.indexOf(b.toUpperCase())).map(d=>[d,d]);
    if(id==='pattern')options=overview.patternIds.map(p=>[p,overview.name(p)+(overview.coverage.get(p)?' ('+(overview.frequency.get(p)||0)+')':' · not covered')]);
    if(id==='min'||id==='max')options=[...new Set(data.catalog.map(c=>c.level).filter(v=>levelNumber(v)!=null))].sort((a,b)=>levelNumber(a)-levelNumber(b)).map(v=>[v,v]);
    for(const [value,label]of options){const option=new Option(label,value);if(id==='pattern'&&!overview.coverage.get(value))option.disabled=true;select.append(option);}
    select.onchange=()=>{visible=40;catalog();if(id==='pattern')writePatternFilter();};
  }
  for(const key of ['all','STD','DX'])el('format-'+key).onclick=()=>{format=key;visible=40;updateFormat();catalog();};
  for(const version of navigation.versions||[]){
    const label=make('label'),checkbox=make('input');checkbox.type='checkbox';checkbox.value=version;
    checkbox.onchange=()=>{if(checkbox.checked)selectedVersions.add(version);else selectedVersions.delete(version);visible=40;updateVersions();catalog();};
    label.append(checkbox,make('span',versionLabel(version)));el('version-options').append(label);
  }
  el('version-clear').onclick=()=>{selectedVersions.clear();visible=40;updateVersions();catalog();};
  el('version-filter').addEventListener('keydown',event=>{if(event.key==='Escape'){el('version-filter').open=false;el('version-summary').focus();event.stopPropagation();}});
  document.addEventListener('click',event=>{if(!el('version-filter').contains(event.target))el('version-filter').open=false;});
  el('reset-filters').onclick=()=>{for(const id of filters)el('filter-'+id).value='';selectedVersions.clear();updateVersions();el('search').value='';format='all';visible=40;writePatternFilter();updateFormat();catalog();};
  renderSort();
  el('mapping-note').textContent=overview.patternIds.length?overview.coverage.size+' experimental pattern / trait types with supported coverage · click a tag to open its lesson.':'Pattern and Flow mappings are not available in this catalog release.';
}
function writePatternFilter(){const url=new URL(location.href),id=el('filter-pattern').value;if(id)url.searchParams.set('pattern-filter',id);else url.searchParams.delete('pattern-filter');history.replaceState(null,'',url);}
function updateVersions(){
  el('version-summary').textContent=selectedVersions.size===0?'All versions':selectedVersions.size===1?versionLabel([...selectedVersions][0]):selectedVersions.size+' versions selected';
  for(const input of el('version-options').querySelectorAll('input'))input.checked=selectedVersions.has(input.value);
}
function updateFormat(){for(const key of ['all','STD','DX'])el('format-'+key).setAttribute('aria-pressed',String(key===format));}
function activeFilters(){
  const root=el('active-filters');root.replaceChildren();
  for(const version of selectedVersions){
    const button=make('button',versionLabel(version)+' ×','filter-chip');button.setAttribute('aria-label','Remove version '+versionLabel(version));
    button.onclick=()=>{selectedVersions.delete(version);visible=40;updateVersions();catalog();el('version-summary').focus();};root.append(button);
  }
  for(const id of filters){const select=el('filter-'+id);if(!select.value)continue;
    const button=make('button',({min:'From level ',max:'To level '}[id]||'')+select.selectedOptions[0].text+' ×','filter-chip');
    button.setAttribute('aria-label','Remove '+select.parentElement.firstChild.textContent+' filter');
    button.onclick=()=>{select.value='';visible=40;catalog();if(id==='pattern')writePatternFilter();select.focus();};root.append(button);
  }
}
function catalog(focusKey=null){
  const search=el('search').value.normalize('NFKC').toLowerCase();
  const selected=Object.fromEntries(filters.map(id=>[id,el('filter-'+id).value]));
  const charts=data.catalog.filter(c=>{
    if(format!=='all'&&c.format!==format)return false;
    if(!(c.title+' '+c.artist).normalize('NFKC').toLowerCase().includes(search))return false;
    if(selected.genre&&folderValue(c,'genre')!==selected.genre)return false;
    if(selectedVersions.size&&!selectedVersions.has(folderValue(c,'version')))return false;
    if(selected.difficulty&&c.difficulty!==selected.difficulty)return false;
    if(selected.pattern&&!overview.detected(c).some(t=>t.id===selected.pattern))return false;
    const level=levelNumber(c.level);
    if(selected.min&&(level==null||level<levelNumber(selected.min)))return false;
    if(selected.max&&(level==null||level>levelNumber(selected.max)))return false;
    return true;
  }).sort(compareCharts);
  const grouped=new Map();
  for(const chart of charts){const key=rowKey(chart);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(chart);}
  const rows=[...grouped].map(([key,choices])=>({key,choices,chart:choices.find(c=>c.chart_id===selectedCharts.get(key))||[...choices].sort((a,b)=>(values.difficulty(a)??99)-(values.difficulty(b)??99)||a.chart_id.localeCompare(b.chart_id))[0]})).sort((a,b)=>compareCharts(a.chart,b.chart));
  if(focusKey)visible=Math.max(visible,rows.findIndex(row=>row.key===focusKey)+1);
  el('songs').replaceChildren();activeFilters();
  for(const [index,{key,choices,chart:c}]of rows.slice(0,visible).entries()){
    const row=make('article',undefined,'song-row');row.dataset.chartId=c.chart_id;row.dataset.level=c.level||'';row.dataset.title=c.title;row.dataset.difficulty=c.difficulty;row.dataset.genre=folderValue(c,'genre');row.dataset.version=folderValue(c,'version');
    const header=make('div',undefined,'chart-summary');
    const summary=make('button',undefined,'chart-row'),identity=make('span',undefined,'song-identity'),title=make('span',displayTitle(c),'song-title');summary.type='button';
    identity.append(title,make('span',(c.artist||'Artist not provided')+' · '+c.format,'muted'));summary.append(identity);
    summary.setAttribute('aria-label','Open '+displayTitle(c)+' · '+c.format+' '+c.difficulty+' · Level '+(c.level||'unknown'));
    const heading=make('div',undefined,'chart-row-heading'),videoLink=window.maimaiChartLinks.youtube(c);
    heading.append(summary,overview.chips(c,3,selected.pattern));if(videoLink)heading.append(videoLink);
    const picker=make('select');picker.className='row-difficulty';picker.id='row-difficulty-'+index;picker.setAttribute('aria-label','Difficulty for '+displayTitle(c)+' '+c.format);
    for(const choice of [...choices].sort((a,b)=>(values.difficulty(a)??99)-(values.difficulty(b)??99)||a.chart_id.localeCompare(b.chart_id)))picker.append(new Option(choice.difficulty+' · '+(choice.level||'?'),choice.chart_id));
    picker.value=c.chart_id;
    picker.onchange=()=>{selectedCharts.set(key,picker.value);catalog(key);[...el('songs').querySelectorAll('.row-difficulty')].find(p=>p.value===selectedCharts.get(key))?.focus();};
    const level=make('span',c.level||'—','chart-level'),bpm=make('span',values.bpm(c)==null?'—':String(values.bpm(c)),'chart-bpm'),speed=make('span',values.speed(c)==null?'—':values.speed(c).toFixed(1),'chart-speed');
    bpm.setAttribute('aria-label',values.bpm(c)==null?'BPM unknown':values.bpm(c)+' BPM');bpm.title='Source song BPM; individual passages may change tempo.';
    level.setAttribute('aria-label','Level '+(c.level||'unknown'));speed.setAttribute('aria-label',(values.speed(c)==null?'Unknown':values.speed(c).toFixed(1))+' inputs per second');
    const flow=overview.graph(c,{compact:true});header.append(heading,picker,level,bpm,speed,flow);
    header.onclick=event=>{if(!event.target.closest('button,select,label,input,a'))summary.click();};
    const panel=make('div',undefined,'chart-measurements');panel.id='chart-'+index;panel.hidden=!expandedRows.has(key);summary.setAttribute('aria-expanded',String(!panel.hidden));summary.setAttribute('aria-controls',panel.id);
    const renderDetails=()=>{
      panel.replaceChildren();panel.append(make('h3',c.format+' '+c.difficulty+' · Lv. '+(c.level||'?')),metrics(c));
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
  el('catalog-count').textContent=charts.length.toLocaleString()+' matching charts in '+rows.length.toLocaleString()+' song / format rows';
  if(!charts.length)el('songs').append(make('p',selected.min&&selected.max&&levelNumber(selected.min)>levelNumber(selected.max)?'The minimum level is above the maximum. Adjust either level filter.':'No charts match this combination. Remove a filter or try another search.','empty-state'));
  el('more').hidden=rows.length<=visible;
}

data.review.forEach((r,i)=>{const c=byId.get(r.query_id);el('query').append(new Option(displayTitle(c)+' · '+c.format+' '+c.difficulty+' · Lv. '+(c.level||'?'),String(i)));});
el('query').onchange=render;el('blind').onchange=render;
el('feedback').onchange=()=>{el('blind').disabled=!el('feedback').checked;el('download').disabled=!el('feedback').checked;render();};
el('search').oninput=()=>{visible=40;catalog();};
el('more').onclick=()=>{visible+=40;catalog();};
for(const name of ['compare','catalog','patterns'])el(name+'-tab').onclick=()=>selectView(name);
el('download').onclick=()=>{const blob=new Blob([JSON.stringify({version:'challenge-judgments-1',benchmark_hash:data.benchmark_hash,policy:data.package.retrieval_policy,judgments:[...judgments.values()]},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=make('a');a.href=url;a.download='challenge-judgments.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
el('coverage').textContent=data.catalog.length+' chart profiles · '+data.review.length+' prepared review queries · '+data.package.status.replaceAll('_',' ');el('credit').textContent=data.package.source.credit;el('notice').textContent=data.package.source.notice;el('revision').textContent=data.package.source.revision;
el('loaded-count').textContent=data.catalog.length.toLocaleString();
el('sample-intro').textContent='Choose from '+data.review.length+' prepared starting charts to inspect side-by-side passage demos. These are examples of structural similarity, not recommendations based on your scores.';
if(data.package.outcomes){const o=data.package.outcomes;el('coverage').textContent+=' · '+o.excluded+' Utage slots excluded · '+o.unavailable+' source container unavailable.';}
window.maimaiPreviewField=field;
initializeFilters();catalog();status();
comparisonUI=window.maimaiChartComparison.mount({data,comparison,stopPlayers,eligibleIds:()=>data.catalog.filter(c=>{
  if(format!=='all'&&c.format!==format)return false;
  if(selectedVersions.size&&!selectedVersions.has(folderValue(c,'version')))return false;
  if(el('filter-pattern').value&&!overview.detected(c).some(t=>t.id===el('filter-pattern').value))return false;
  for(const key of ['genre','difficulty']){const selected=el('filter-'+key).value;if(selected&&(key==='genre'?folderValue(c,key):c.difficulty)!==selected)return false;}
  const level=levelNumber(c.level),min=el('filter-min').value,max=el('filter-max').value;
  return(!min||(level!=null&&level>=levelNumber(min)))&&(!max||(level!=null&&level<=levelNumber(max)));
}).map(c=>c.chart_id)});
const params=new URLSearchParams(location.search),initialView=params.get('view'),initialPattern=params.get('pattern');
window.maimaiPatternLibrary.setDiscovery(id=>{el('reset-filters').click();el('filter-pattern').value=id;writePatternFilter();selectView('catalog');catalog();el('filter-pattern').focus();});
if(overview.patternIds.includes(params.get('pattern-filter'))){el('filter-pattern').value=params.get('pattern-filter');catalog();}
window.maimaiPatternLibrary.setNavigation(id=>{const url=new URL(location.href);if(id)url.searchParams.set('pattern',id);else url.searchParams.delete('pattern');history.replaceState(null,'',url);});
if(['catalog','patterns','compare'].includes(initialView))selectView(initialView);
if(initialPattern&&window.maimaiPatternLibrary.has(initialPattern)){window.maimaiPatternLibrary.show(initialPattern);}
})();
