/* Exact-source research observations and Flow; no accounts or external requests. */
(()=>{'use strict';
const data=window.maimaiResearchCatalog??=JSON.parse(document.getElementById('challenge-data').textContent),pack=data.analysis;
const definitions=new Map(JSON.parse(document.getElementById('pattern-data').textContent).map(p=>[p.pattern_id,p]));
const make=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const svg=(tag,attrs,text)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,String(v));if(text!==undefined)n.textContent=text;return n;};
const get=c=>['research-overview-1','research-overview-2'].includes(pack?.version)&&[undefined,'sparse-tags-1','sparse-tags-2','sparse-tags-3'].includes(pack?.representation)&&pack.charts[c.chart_id]?.source_hash===c.source_hash?pack.charts[c.chart_id]:null;
const name=id=>definitions.get(id)?.display_name||id;
const clock=us=>{const s=us/1e6;return Math.floor(s/60)+':'+(s%60).toFixed(1).padStart(4,'0');};
function tags(c){const record=get(c);if(!record)return[];let rows=record.tags;if(['sparse-tags-2','sparse-tags-3'].includes(pack.representation))rows=rows.map(t=>[t[0],['unknown','detected','not-detected-with-supported-coverage'][t[1]&3],t[2],t[3],t[1]&4?'complete':'partial',!!(t[1]&8),t[4],pack.evidence_pool?t[5].map(i=>pack.evidence_pool[i]):t[5]]);if(pack.representation?.startsWith('sparse-tags-')){const present=new Map(rows.map(t=>[t[0],t])),absent=new Set(record.absent||[]);rows=pack.patterns.map((_,i)=>present.get(i)||(absent.has(i)?[i,'not-detected-with-supported-coverage',0,0,'complete',false,[]]:[i,'unknown',null,null,'partial',false,[]]));}return rows.map(t=>({id:pack.patterns[t[0]],status:t[1],count:t[2],prevalence:t[3],coverage:t[4],truncated:t[5],spans:t[6],evidence:t[7]||[]}));}
const detected=c=>tags(c).filter(t=>t.status==='detected').sort((a,b)=>Number(a.id.startsWith('trait.'))-Number(b.id.startsWith('trait.'))||b.prevalence-a.prevalence||b.count-a.count||a.id.localeCompare(b.id));
const rate=(c,t)=>{const span=get(c)?.span;return span&&span[1]>span[0]&&t?.count!=null?t.count*60e6/(span[1]-span[0]):null;};
const delivery=window.maimaiCatalogDetails,pendingGraphs=new Map();let graphFrame=0;
const observer=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){const run=pendingGraphs.get(entry.target);pendingGraphs.delete(entry.target);observer.unobserve(entry.target);run?.();}},{rootMargin:'160px'});
function onVisible(box,run){
  pendingGraphs.set(box,run);
  if(!graphFrame)graphFrame=requestAnimationFrame(()=>{graphFrame=0;for(const [node,start]of pendingGraphs){if(!node.isConnected){pendingGraphs.delete(node);observer?.unobserve(node);}else if(observer)observer.observe(node);else{pendingGraphs.delete(node);start();}}});
}
function loadInto(box,c,render,priority=false){
  const compact=box.classList.contains('compact');
  const run=()=>{box.replaceChildren(make('p',compact?'Loading activity…':'Loading chart evidence…','muted'));delivery.ensure(c,priority).then(()=>{if(box.isConnected)box.replaceWith(render());}).catch(()=>{const retry=make('button','Retry loading chart');retry.type='button';retry.onclick=run;box.replaceChildren(make('p',compact?'Activity could not load.':'Chart evidence could not be loaded. Search and filters are still available.','muted'),retry);});};
  return run;
}
function patternButton(id,text=name(id)){const b=make('button',text,'pattern-chip');b.type='button';b.dataset.pattern=id;b.onclick=()=>window.maimaiPatternLibrary.show(id,b);return b;}
function chips(c,limit=3,focus=null){const box=make('div',undefined,'chart-patterns'),found=detected(c);const priorities=new Set(Array.isArray(focus)?focus:focus?[focus]:[]);if(priorities.size)found.sort((a,b)=>Number(priorities.has(b.id))-Number(priorities.has(a.id)));for(const t of found.slice(0,limit)){const b=patternButton(t.id);b.title=t.count+' observed occurrences · experimental detection';box.append(b);}if(found.length>limit)box.append(make('span','+'+(found.length-limit),'muted'));if(!found.length)box.append(make('span',get(c)?'No patterns detected in supported coverage':'Patterns not prepared for this release','muted'));return box;}
function graph(c,{compact=false,maximum=null,span=null}={}){
  const record=get(c),box=make('figure',undefined,'chart-flow'+(compact?' compact':''));
  if(record&&delivery&&!delivery.ready(c)){box.append(make('span','Loading activity…','muted'));onVisible(box,loadInto(box,c,()=>graph(c,{compact,maximum,span})));return box;}
  if(!record?.segments.length){box.append(make('span','Flow unavailable','muted'));return box;}
  const segments=record.segments;if(!segments.some(s=>s[2]!=null&&s[3]!=null&&s[4]>0)){box.append(make('span','Flow unavailable','muted'));return box;}const peak=Math.max(0,...segments.map(s=>s[3]||0)),max=maximum??Math.max(1,peak),height=compact?42:110,left=compact?0:30,right=240,bottom=compact?40:88,top=4,width=(right-left)/segments.length;
  const title='Input activity through '+(c.title.trim()||'untitled chart')+' '+c.difficulty;
  const art=svg('svg',{viewBox:'0 0 244 '+height,role:'img',preserveAspectRatio:compact?'none':'xMidYMid meet','aria-label':title+'. '+clock(record.span[0])+' to '+clock(record.span[1])+'. Peak '+peak.toFixed(1)+' inputs per second.'});
  art.append(svg('title',{},title));
  if(!compact)for(const y of [0,max/2,max])art.append(svg('text',{x:26,y:bottom-y/max*(bottom-top)+3,'text-anchor':'end','class':'flow-axis'},Number(y.toFixed(1))));
  segments.forEach((s,i)=>{
    const x=left+i*width+1,valid=s[2]!=null&&s[4]>0,y=v=>bottom-v/max*(bottom-top),highlight=span&&s[0]<span[1]&&s[1]>span[0];
    const bar=svg('rect',{x,y:valid?y(s[2]):top,width:Math.max(1,width-2),height:valid?Math.max(.7,bottom-y(s[2])):bottom-top,'class':!valid?'flow-unknown':highlight?'flow-highlight':'flow-bar',opacity:s[4]<1?.45:1});
    bar.append(svg('title',{},clock(s[0])+'–'+clock(s[1])+': '+(valid?s[2].toFixed(1)+' mean, '+s[3].toFixed(1)+' peak inputs/s · '+Math.round(s[4]*100)+'% coverage':'Unknown')));art.append(bar);
    if(valid)art.append(svg('line',{x1:x,x2:x+width-2,y1:y(s[3]),y2:y(s[3]),'class':'flow-peak'}));
  });
  if(!compact){art.append(svg('text',{x:left,y:105,'class':'flow-axis'},clock(record.span[0])),svg('text',{x:right,y:105,'text-anchor':'end','class':'flow-axis'},clock(record.span[1])));}
  box.append(art);box.append(make('figcaption',compact?'Peak '+peak.toFixed(1)+' /s · own scale': 'Inputs / s · mean bars, 250 ms peak marks · chart time','muted'));return box;
}
function details(c){
  const box=make('section',undefined,'chart-pattern-detail');box.append(make('h3','Patterns & activity'));
  if(delivery&&!delivery.ready(c)){loadInto(box,c,()=>details(c),true)();return box;}
  const found=detected(c),flow=make('div'),reading=make('p','','flow-reading');flow.append(graph(c));reading.setAttribute('role','status');box.append(flow,reading);
  box.append(make('p','Experimental detections from this exact chart transcription. Counts describe observed occurrences; unsupported patterns remain unknown.','muted'));
  if(!get(c)){box.append(make('p','This catalog release has no prepared pattern mappings.'));return box;}
  if(!found.length)box.append(make('p','No patterns detected in supported coverage. This does not establish that other dictionary patterns are absent.','muted'));
  for(const tag of found){const row=make('div',undefined,'pattern-evidence');row.append(patternButton(tag.id),make('span',tag.count+' observed'+(tag.coverage==='partial'||tag.truncated?' · partial coverage':'') ,'muted'));
    const seen=new Set();tag.spans.forEach((span,i)=>{const evidence=tag.evidence[i]||{},target=evidence.target_pattern_id,key=span.join(':')+':'+(target||'');if(seen.has(key))return;seen.add(key);const label=(target?name(target)+' · ':'')+clock(span[0])+'–'+clock(span[1]),button=make('button',label,'span-button');button.type='button';button.setAttribute('aria-label','Highlight '+name(tag.id)+' · '+label);button.onclick=()=>{flow.replaceChildren(graph(c,{span}));reading.textContent=name(tag.id)+' · '+label+' · highlighted in activity chart';};row.append(button);});
    if(tag.id==='pattern.umiyuri')row.append(make('span','Recurring-pair form · other variants may not be detected','muted'));
    box.append(row);}
  return box;
}
function compare(left,right){
  const a=new Map(tags(left).map(t=>[t.id,t])),b=new Map(tags(right).map(t=>[t.id,t]));
  const shared=[],first=[],second=[],unknown=[];let difference=0,union=0,known=0;
  for(const id of pack?.patterns||[]){const x=a.get(id),y=b.get(id),xd=x?.status==='detected',yd=y?.status==='detected';
    if(xd&&yd)shared.push(id);else if(xd||yd){const other=xd?y:x;if(other?.status==='not-detected-with-supported-coverage')(xd?first:second).push(id);else unknown.push(id);}
    if(x&&y&&x.status!=='unknown'&&y.status!=='unknown'&&x.coverage==='complete'&&y.coverage==='complete'){
      known++;if(xd||yd){const weight=1/Math.max(1,frequency.get(id)||1),rx=id.startsWith('trait.')?Number(xd):rate(left,x),ry=id.startsWith('trait.')?Number(yd):rate(right,y),rateDifference=rx+ry?Math.abs(rx-ry)/(rx+ry):0;union+=weight;difference+=weight*(.5*Number(xd!==yd)+.3*rateDifference+.2*Math.abs((x.prevalence||0)-(y.prevalence||0)));}
    }
  }
  return{shared,first,second,unknown,coverage:known,patternDistance:union&&known>=4?difference/union:null};
}
const frequency=new Map(),coverage=new Map();for(const c of data.catalog)for(const tag of tags(c)){if(tag.status!=='unknown')coverage.set(tag.id,(coverage.get(tag.id)||0)+1);if(tag.status==='detected')frequency.set(tag.id,(frequency.get(tag.id)||0)+1);}
function pair(left,right){
  const box=make('section',undefined,'pattern-comparison'),result=compare(left,right);box.append(make('h2','Patterns in common'));if(!get(left)||!get(right))box.append(make('p','Pattern mappings are unavailable for one or both charts in this release.','muted'));
  for(const [title,ids]of [['Shared patterns',result.shared],['Detected only in first',result.first],['Detected only in second',result.second],['Other chart coverage unknown',result.unknown]]){
    if(!ids.length&&title==='Other chart coverage unknown')continue;const group=make('div',undefined,'pattern-comparison-group');group.append(make('h3',title));for(const id of ids)group.append(patternButton(id));if(!ids.length)group.append(make('span','None detected','muted'));box.append(group);
  }
  const ids=[...new Set([...result.shared,...result.first,...result.second,...result.unknown])].filter(id=>id.startsWith('pattern.'));
  if(ids.length){const table=make('table',undefined,'pattern-metrics'),head=make('thead'),labels=make('tr');for(const text of ['Pattern frequency',left.title+' · '+left.difficulty,right.title+' · '+right.difficulty]){const th=make('th',text);th.scope='col';labels.append(th);}head.append(labels);table.append(head);const body=make('tbody');
    for(const id of ids){const row=make('tr'),label=make('th');label.scope='row';label.append(patternButton(id));row.append(label);for(const c of [left,right]){const t=tags(c).find(t=>t.id===id),cell=make('td');if(!t||t.status==='unknown')cell.textContent='Unknown';else{cell.append(make('strong',String(t.count)),make('span',(rate(c,t)??0).toFixed(1)+' / min'+(t.coverage==='partial'||t.truncated?' · lower bound':''),'muted'));}row.append(cell);}body.append(row);}table.append(body);box.append(table);}
  box.append(make('h2','Activity through each chart'));const graphs=make('div',undefined,'flow-comparison');
  const max=Math.max(1,...[left,right].map(c=>get(c)?.flow_peak??Math.max(0,...(get(c)?.segments||[]).map(s=>s[3]||0))));
  for(const c of [left,right]){const figure=make('div');figure.append(make('h3',(c.title.trim()||'Untitled')+' · '+c.difficulty),graph(c,{maximum:max}));graphs.append(figure);}box.append(graphs);return box;
}
window.maimaiChartOverview=Object.freeze({get,tags,detected,name,chips,graph,details,compare,pair,frequency,coverage,patternIds:pack?.patterns||[],definition:id=>pack?.definitions?.[id]||null});
})();
