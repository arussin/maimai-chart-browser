/* Sealed review; no network, account access, automatic storage or imported scores. */
(()=>{'use strict';
const data=JSON.parse(document.getElementById('challenge-data').textContent);
const byId=new Map(data.catalog.map(c=>[c.chart_id,c]));
const el=id=>document.getElementById(id),make=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const names={cadence:'Input speed',rhythm:'Rhythm',coordination:'Simultaneous inputs',holds:'Hold interactions',slides:'Slide timing',spatial:'Layout'};
const judgments=new Map();let cleanup=[],sort='genre',visible=40,folder='all',format='all',folderOptions=[];
const navigation=data.navigation||{charts:{},genres:[],versions:[]};
function folderValue(c,mode=sort){
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
function field(snippet,label){const box=make('div',undefined,'field');box.append(make('h4',label));const svg=svgNode('svg',{viewBox:'-1.35 -1.35 2.7 2.7',role:'img','aria-label':label+' chart passage'});box.append(svg);const note=make('p','', 'muted');box.append(note);
function draw(t){svg.replaceChildren();svg.append(svgNode('circle',{cx:0,cy:0,r:1,fill:'none',stroke:'#cfc4e8','stroke-width':.025}));for(let n=1;n<=8;n++){let[x,y]=xy(n);svg.append(svgNode('circle',{cx:x,cy:y,r:.09,fill:'white',stroke:'#aa9dc3','stroke-width':.012}));const tx=svgNode('text',{x,y:y+.036,'text-anchor':'middle','font-size':.11,fill:'#65577d'});tx.textContent=n;svg.append(tx);}
let unknown=0;
for(const s of snippet.slides){if(t<s.wait_start_us||t>s.movement_end_us)continue;if(!s.geometry){unknown++;continue;}const points=s.geometry.points,waiting=t<s.movement_start_us;svg.append(svgNode('polyline',{points:points.map(p=>p.join(',')).join(' '),fill:'none',stroke:waiting?'#987500':'#007d88','stroke-width':.05,'stroke-dasharray':waiting?'.07 .04':'none'}));if(!waiting){let u=Math.min(1,(t-s.movement_start_us)/(s.movement_end_us-s.movement_start_us));let lengths=points.slice(1).map((p,i)=>Math.hypot(p[0]-points[i][0],p[1]-points[i][1]));let distance=u*lengths.reduce((a,b)=>a+b,0),i=0;while(i<lengths.length-1&&distance>lengths[i])distance-=lengths[i++];let v=lengths[i]?distance/lengths[i]:0;let p=[points[i][0]+v*(points[i+1][0]-points[i][0]),points[i][1]+v*(points[i+1][1]-points[i][1])];svg.append(svgNode('circle',{cx:p[0],cy:p[1],r:.065,fill:'#007d88'}));}}
for(const h of snippet.holds){let p=xy(h.position);if(p&&t>=h.start_us&&t<h.end_us)svg.append(svgNode('circle',{cx:p[0],cy:p[1],r:.16,fill:'none',stroke:'#b55812','stroke-width':.05}));}
for(const e of snippet.events){let dt=e.time_us-t;if(dt< -120000||dt>600000)continue;let p=xy(e.position);if(!p)continue;let r=Math.max(.05,Math.min(.16,.16-dt/600000*.10));svg.append(svgNode('circle',{cx:p[0],cy:p[1],r,fill:e.role==='star_tap'?'#007d88':'#b82d75',opacity:dt<0?.5:1}));}
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
  for(const n of ['compare','catalog']){
    el(n).hidden=n!==name;
    el(n+'-tab').setAttribute('aria-pressed',String(n===name));
  }
  if(name==='catalog')catalog();else render();
}
function openSample(index){
  el('query').value=String(index);
  selectView('compare');
  el('query').focus();
}
function render(){
  stopPlayers();
  const item=data.review[+el('query').value];
  el('matches').replaceChildren();el('query-card').replaceChildren();
  if(!item){el('matches').append(make('p','No recommendation samples are prepared in this package yet.'));return;}
  const q=byId.get(item.query_id),query=make('article',undefined,'card source-card');
  query.append(make('span','STARTING CHART','eyebrow'),make('h3',displayTitle(q)),meta(q));
  el('query-card').append(query);
  const feedback=el('feedback').checked,blind=feedback&&el('blind').checked;
  let candidates=[...item.candidates];
  if(blind)candidates.sort((a,b)=>a.chart_id.localeCompare(b.chart_id));
  el('matches').append(make('h3',blind?'Candidates to compare':'Suggested charts'));
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
function songGroups(charts){
  const groups=new Map();
  for(const c of charts){
    const key=JSON.stringify([c.title.normalize('NFKC').toLowerCase(),c.artist.normalize('NFKC').toLowerCase()]);
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(c);
  }
  return [...groups.values()];
}
function catalog(){
  const search=el('search').value.normalize('NFKC').toLowerCase();
  const available=data.catalog.filter(c=>(format==='all'||c.format===format)&&(c.title+' '+c.artist).normalize('NFKC').toLowerCase().includes(search));
  renderFolders(available);
  const charts=available.filter(c=>sort==='title'||folder==='all'||folderValue(c)===folder);
  const songs=songGroups(charts);
  songs.sort((a,b)=>a[0].title.localeCompare(b[0].title));
  el('songs').replaceChildren();
  for(const [rowIndex,group] of songs.slice(0,visible).entries()){
    const row=make('article',undefined,'song-row');row.append(make('h3',displayTitle(group[0])),make('p',group[0].artist,'muted'));
    const variants=make('div',undefined,'variants'),panel=make('div',undefined,'chart-measurements');
    panel.id='chart-'+rowIndex;panel.hidden=true;
    for(const c of group){
      const v=make('button',undefined,'variant');
      v.dataset.chartId=c.chart_id;
      v.append(make('span',c.format+' '+c.difficulty,'badge '+c.difficulty.replace(':','')),make('span','Lv. '+(c.level||'?')));
      v.setAttribute('aria-expanded','false');v.setAttribute('aria-controls',panel.id);
      v.onclick=()=>{
        const wasOpen=v.getAttribute('aria-expanded')==='true';
        for(const b of variants.querySelectorAll('button'))b.setAttribute('aria-expanded','false');
        panel.hidden=wasOpen;if(wasOpen)return;
        v.setAttribute('aria-expanded','true');panel.replaceChildren();
        panel.append(make('h4',c.format+' '+c.difficulty+' measurements'),metrics(c),make('p','No personal scores loaded. Named-pattern labels are not validated yet.','muted'));
        const sample=data.review.findIndex(r=>r.query_id===c.chart_id);
        if(sample>=0){const b=make('button','Show recommendation sample');b.onclick=()=>openSample(sample);panel.append(b);}
        else panel.append(make('p','Recommendations for this chart are not prepared yet. Try one of the starting charts in Recommendation samples.','muted'));
      };
      variants.append(v);
    }
    row.append(variants,panel);el('songs').append(row);
  }
  el('catalog-count').textContent=songs.length.toLocaleString()+' song groups · '+charts.length.toLocaleString()+' chart variants'+(folder!=='all'?' · Matching variants shown':'');
  if(!songs.length)el('songs').append(make('p','No songs match this search.'));
  el('more').hidden=songs.length<=visible;
}
function chooseFolder(value,focus=false){
  folder=value;visible=40;catalog();
  const button=[...el('folders').children].find(b=>b.dataset.folder===value);
  if(button){button.scrollIntoView({block:'nearest',inline:'nearest'});if(focus)button.focus({preventScroll:true});}
}
function renderFolders(charts){
  el('folder-navigation').hidden=sort==='title';
  if(sort==='title'){el('folder-heading').textContent='All songs';return;}
  const present=new Map();
  for(const c of charts){const key=folderValue(c);if(!present.has(key))present.set(key,[]);present.get(key).push(c);}
  const genres=navigation.genres||[],versions=navigation.versions||[];
  let values=sort==='genre'?genres.map(g=>g.id):sort==='version'?versions:[...present.keys()].filter(k=>k!=='unknown').sort((a,b)=>(parseFloat(a)+(a.endsWith('+')?.5:0))-(parseFloat(b)+(b.endsWith('+')?.5:0)));
  values=values.filter(k=>k!=='unknown'&&present.has(k));
  if(present.has('unknown'))values.push('unknown');
  const label=key=>key==='unknown'?'Uncategorized':sort==='genre'?(genres.find(g=>g.id===key)?.label||key):sort==='level'?'Lv. '+key:key.replace(/^maimai DX /,'').replace(/^maimai /,'');
  folderOptions=[{id:'all',label:'All '+({genre:'genres',level:'levels',version:'versions'}[sort])},...values.map(id=>({id,label:label(id)}))];
  if(!folderOptions.some(o=>o.id===folder))folder='all';
  const scroll=el('folders').scrollLeft;
  el('folders').replaceChildren();
  for(const option of folderOptions){
    const b=make('button',undefined,'folder');b.dataset.folder=option.id;
    b.setAttribute('aria-pressed',String(folder===option.id));
    b.append(make('strong',option.label),make('span',songGroups(option.id==='all'?charts:present.get(option.id)).length.toLocaleString()+' songs'));
    b.onclick=()=>chooseFolder(option.id,true);el('folders').append(b);
  }
  el('folders').scrollLeft=scroll;
  el('folder-heading').textContent=folderOptions.find(o=>o.id===folder).label;
  el('folder-prev').disabled=el('folder-next').disabled=folderOptions.length<=1;
}
const modes={genre:'browse-genre',level:'sort-level',version:'browse-version',title:'sort-title'};
for(const [mode,id]of Object.entries(modes))el(id).onclick=()=>{
  sort=mode;folder='all';visible=40;el('folders').scrollLeft=0;
  for(const [key,button]of Object.entries(modes))el(button).setAttribute('aria-pressed',String(key===mode));catalog();
};
for(const key of ['all','STD','DX'])el('format-'+key).onclick=()=>{
  format=key;visible=40;for(const value of ['all','STD','DX'])el('format-'+value).setAttribute('aria-pressed',String(value===key));catalog();
};
for(const [id,step]of [['folder-prev',-1],['folder-next',1]])el(id).onclick=()=>{
  const index=folderOptions.findIndex(o=>o.id===folder);chooseFolder(folderOptions[(index+step+folderOptions.length)%folderOptions.length].id);
};
data.review.forEach((r,i)=>{const c=byId.get(r.query_id);el('query').append(new Option(displayTitle(c)+' · '+c.format+' '+c.difficulty+' · Lv. '+(c.level||'?'),String(i)));});
el('query').onchange=render;el('blind').onchange=render;
el('feedback').onchange=()=>{el('blind').disabled=!el('feedback').checked;el('download').disabled=!el('feedback').checked;render();};
el('search').oninput=()=>{visible=40;folder='all';catalog();};
el('more').onclick=()=>{visible+=40;catalog();};
for(const name of ['compare','catalog'])el(name+'-tab').onclick=()=>selectView(name);
el('download').onclick=()=>{const blob=new Blob([JSON.stringify({version:'challenge-judgments-1',benchmark_hash:data.benchmark_hash,policy:data.package.retrieval_policy,judgments:[...judgments.values()]},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=make('a');a.href=url;a.download='challenge-judgments.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
el('coverage').textContent=data.catalog.length+' chart profiles · '+data.review.length+' prepared review queries · '+data.package.status.replaceAll('_',' ');el('credit').textContent=data.package.source.credit;el('notice').textContent=data.package.source.notice;el('revision').textContent=data.package.source.revision;
el('loaded-count').textContent=data.catalog.length.toLocaleString();
el('sample-count').textContent=String(data.review.length);
el('sample-intro').textContent=data.review.length+' prepared starting charts. Experimental suggestions span difficulties and are not personalized Targets.';
if(data.package.outcomes){const o=data.package.outcomes;el('coverage').textContent+=' · '+o.excluded+' Utage slots excluded · '+o.unavailable+' source container unavailable.';}
catalog();status();
})();
