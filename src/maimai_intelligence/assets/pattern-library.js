/* Authored teaching lessons. Examples and contrasts never assign tags to charts. */
(()=>{'use strict';
const definitions=JSON.parse(document.getElementById('pattern-data').textContent),book=__MAIMAI_PATTERN_LESSONS__,lessons=book.lessons;
const el=id=>document.getElementById(id),make=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const ns='http://www.w3.org/2000/svg',svgNode=(tag,attrs={},text)=>{const n=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,String(v));if(text!==undefined)n.textContent=text;return n;};
const aliases=p=>p.aliases.map(a=>typeof a==='string'?a:a.text).join(' · '),normalize=s=>s.normalize('NFKC').toLowerCase();
const dialog=el('pattern-dialog');let dispose=()=>{},opener=null,onNavigate=()=>{},onDiscover=()=>{};
const eventTimes=model=>model.kind==='bars'?Array.from({length:model.duration+1},(_,i)=>i):[...new Set([0,model.duration,...model.notes.map(n=>n[0]),...model.holds.flatMap(h=>h.slice(0,2)),...model.slides.flatMap(s=>s.slice(0,3))])].sort((a,b)=>a-b);
const positionLabel=p=>typeof p==='number'?'Button '+p:'Touch '+p;
function simultaneousTimes(model){
  const groups=new Map();
  for(const[t,position]of model.notes||[]){if(!groups.has(t))groups.set(t,new Set());groups.get(t).add(position);}
  return new Set([...groups].filter(([,positions])=>positions.size>1).map(([t])=>t));
}
function chartArt(model,label,{animated=false,maximum=null}={}){
  const each=simultaneousTimes(model);
  const left=74,right=456,x=t=>left+t/model.duration*(right-left),positions=model.kind==='notes'?[...new Set(model.notes.map(n=>n[1]))].sort((a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true})):[];
  const rows=positions.length+(model.slides?.length||0),height=model.kind==='notes'?Math.max(120,rows*26+68+(model.bands.length?24:0)):190+model.bands.length*22;
  const svg=svgNode('svg',{viewBox:'0 0 480 '+height,role:'img','aria-label':label+' Authored illustration.','class':'lesson-art'});svg.append(svgNode('title',{},label));
  const plotBottom=model.kind==='notes'?height-30-(model.bands.length?24:0):142;
  for(let t=0;t<=model.duration;t++){svg.append(svgNode('line',{x1:x(t),x2:x(t),y1:20,y2:plotBottom,'class':'lesson-grid'}),svgNode('text',{x:x(t),y:height-7,'text-anchor':'middle','class':'lesson-axis'},t));}
  svg.append(svgNode('text',{x:8,y:height-7,'class':'lesson-axis'},model.unit));
  if(model.kind==='notes'){
    const y=p=>32+positions.indexOf(p)*26;
    positions.forEach(p=>svg.append(svgNode('text',{x:5,y:y(p)+4,'class':'lesson-label'},positionLabel(p))));
    for(const[start,end,p]of model.holds)svg.append(svgNode('rect',{x:x(start),y:y(p)-6,width:x(end)-x(start),height:12,rx:4,'class':'lesson-hold'+(each.has(start)?' lesson-each':'')}));
    model.slides.forEach(([head,start,end,path],i)=>{
      const sy=32+(positions.length+i)*26;
      svg.append(svgNode('text',{x:5,y:sy+4,'class':'lesson-label'},path.join('→')+(model.slide_labels?.[i]?' '+model.slide_labels[i]:'')),
        svgNode('line',{x1:x(head),x2:x(start),y1:sy,y2:sy,'class':'lesson-wait'}),
        svgNode('line',{x1:x(start),x2:x(end),y1:sy,y2:sy,'class':'lesson-move'}),
        svgNode('path',{d:`M${x(end)-5} ${sy-5}L${x(end)} ${sy}L${x(end)-5} ${sy+5}`,'class':'lesson-arrow'}));
    });
    for(const[t,p,role]of model.notes){
      const sx=x(t),sy=y(p),attrs={'class':'lesson-note lesson-'+role+(each.has(t)?' lesson-each':''),'data-time':t};
      if(role==='star')svg.append(svgNode('polygon',{...attrs,points:[[0,-8],[2,-2],[8,-2],[3,2],[5,8],[0,4],[-5,8],[-3,2],[-8,-2],[-2,-2]].map(([dx,dy])=>`${sx+dx},${sy+dy}`).join(' ')}));
      else if(role==='touch')svg.append(svgNode('rect',{...attrs,x:sx-5,y:sy-5,width:10,height:10,rx:1}));
      else svg.append(svgNode('circle',{...attrs,cx:sx,cy:sy,r:5}));
    }
  }else{
    const max=maximum||Math.max(1,...model.series.flatMap(s=>s.values)),y=value=>142-value/max*112,width=(right-left)/model.duration;
    for(const value of [0,max/2,max])svg.append(svgNode('text',{x:left-8,y:y(value)+4,'text-anchor':'end','class':'lesson-axis'},Number(value.toFixed(1))));
    model.series.forEach((series,j)=>series.values.forEach((value,i)=>svg.append(svgNode('rect',{x:x(i)+width*(j?.3:.1),y:y(value),width:width*(j?.4:.8),height:142-y(value),'class':j?'lesson-break-bar':'lesson-bar','data-bin':i}))));
    svg.append(svgNode('text',{x:left,y:12,'class':'lesson-axis'},model.series.map(s=>s.label).join(' · ')));
  }
  model.bands.forEach(([start,end,text],i)=>{const y=model.kind==='notes'?height-48:164+i*22;svg.append(svgNode('rect',{x:x(start),y:y-9,width:x(end)-x(start),height:17,rx:3,'class':'lesson-band'}),svgNode('text',{x:(x(start)+x(end))/2,y:y+3,'text-anchor':'middle','class':'lesson-band-label'},text));});
  const cursor=svgNode('line',{x1:left,x2:left,y1:17,y2:height-23,'class':'lesson-playhead','aria-hidden':'true'});if(animated)svg.append(cursor);
  return{svg,draw:t=>{cursor.setAttribute('x1',x(t));cursor.setAttribute('x2',x(t));for(const note of svg.querySelectorAll('[data-time]'))note.classList.toggle('lesson-passed',Number(note.dataset.time)<=t);for(const bar of svg.querySelectorAll('[data-bin]'))bar.classList.toggle('lesson-current',Math.floor(t)===Number(bar.dataset.bin));}};
}
function cabinetModel(model){
  const each=simultaneousTimes(model),unit=500000,point=p=>{const a=(p-.5)*Math.PI/4;return[Math.sin(a),-Math.cos(a)];};
  return{events:model.notes.map(([t,position,role])=>({time_us:t*unit,position,role:role==='star'?'star_tap':'tap',simultaneous:each.has(t)})),holds:model.holds.map(([start,end,position])=>({start_us:start*unit,end_us:end*unit,position,simultaneous:each.has(start)})),slides:model.slides.map(([head,start,end,path],i)=>({wait_start_us:head*unit,movement_start_us:start*unit,movement_end_us:end*unit,geometry:{points:model.slide_points?.[i]||path.map(point)}}))};
}
function render(){
  const search=normalize(el('pattern-search').value),scope=el('pattern-scope').value;
  const shown=definitions.filter(p=>normalize([p.display_name,aliases(p),lessons[p.pattern_id].summary,p.definition].join(' ')).includes(search)&&(scope==='all'||(p.kind==='trait')===(scope==='traits')));
  shown.sort((a,b)=>a.display_name.localeCompare(b.display_name,'en',{sensitivity:'base'}));
  const root=el('pattern-list');root.replaceChildren();el('pattern-count').textContent=shown.length+' lessons found';
  for(const p of shown){const lesson=lessons[p.pattern_id],card=make('article',undefined,'pattern-card');card.dataset.patternId=p.pattern_id;
    const open=make('button','Open lesson →','text-button');open.dataset.openPattern=p.pattern_id;open.setAttribute('aria-label','Open lesson: '+p.display_name);open.onclick=()=>show(p.pattern_id,open);
    const art=make('div',undefined,'pattern-art');art.append(chartArt(lesson.example,lesson.summary).svg);
    card.append(make('p',p.kind==='trait'?'CHART TRAIT':'PATTERN','eyebrow'),make('h2',p.display_name),make('p',lesson.summary,'pattern-description'),art);
    const overview=window.maimaiChartOverview,count=overview?.frequency.get(p.pattern_id)||0,covered=!!overview?.coverage.get(p.pattern_id);
    const actions=make('div',undefined,'pattern-actions'),find=make('button',covered?'Find charts · '+count:'Find charts','text-button');
    find.dataset.findPattern=p.pattern_id;find.disabled=!covered;find.onclick=()=>onDiscover(p.pattern_id);
    if(!covered){const reason=make('span','Chart matching unavailable','sr-only');reason.id='unavailable-'+p.pattern_id;find.setAttribute('aria-describedby',reason.id);find.title=reason.textContent;actions.append(reason);}
    actions.append(open,find);card.append(actions);root.append(card);
  }
  if(!shown.length)root.append(make('p','No lessons match this search.','empty-state'));
}
function demo(lesson){
  const root=make('div',undefined,'pattern-demo'),stage=make('div',undefined,'demo-stage'),caption=make('p',lesson.watch,'lesson-caption'),reading=make('p','','lesson-reading');caption.setAttribute('role','status');reading.setAttribute('role','status');
  const controls=make('div',undefined,'play-controls'),play=make('button','Play demo'),step=make('button','Step'),restart=make('button','Restart'),rate=make('select'),rateLabel=make('label','Speed'),scrub=make('input'),progress=make('span','','demo-progress');
  rate.setAttribute('aria-label','Demo speed');rate.append(new Option('0.1×','0.1'),new Option('0.25×','0.25'),new Option('0.5×','0.5'),new Option('1×','1'));rate.value='1';rateLabel.append(rate);scrub.type='range';scrub.min='0';scrub.max='1000';scrub.step='1';scrub.value='0';scrub.setAttribute('aria-label','Demo progress');progress.setAttribute('aria-live','off');
  controls.append(play,step,restart,rateLabel,scrub,progress);root.append(caption,stage,controls,reading);
  let model=lesson.example,time=0,playing=false,raf=0,last=0,art,cabinet;
  function stop(){playing=false;cancelAnimationFrame(raf);play.textContent='Play demo';}
  function draw(){
    art.draw(time);cabinet?.draw(time*500000);scrub.value=String(Math.round(time/model.duration*1000));progress.textContent=Math.round(time/model.duration*100)+'% · '+Number(time.toFixed(2))+' '+(time===1?model.unit.slice(0,-1):model.unit);
    let text;
    if(model.kind==='bars'){const bin=Math.min(model.duration-1,Math.floor(time));text='Section '+bin+'–'+(bin+1)+' s: '+model.series.map(s=>s.values[bin]+' '+s.label.toLowerCase()).join(' · ');}
    else{
      const notes=model.notes.filter(n=>n[0]<=time+1e-8&&n[0]>time-.2).map(n=>n[2]+' at '+positionLabel(n[1]).toLowerCase());
      const ongoing=[...model.slides.filter(s=>s[0]<=time&&time<s[2]).map(s=>(time<s[1]?'Waiting: ':'Moving: ')+s[3].join('→')),...model.holds.filter(h=>h[0]<=time&&time<h[1]).map(h=>'Holding '+positionLabel(h[2]).toLowerCase())];
      text=[notes.join(' + ')||'No new input',...ongoing].join(' · ');
    }
    reading.setAttribute('aria-live',playing?'off':'polite');reading.textContent=text;scrub.setAttribute('aria-valuetext',progress.textContent+' · '+text);
  }
  function setup(){
    stop();time=0;
    if(model.kind==='bars')root.append(make('p','Bars count new inputs in equal one-second sections. Labeled bands show ongoing movement.'+(model.series.length>1?' Gold inset bars are break inputs already included in the total.':''),'lesson-legend'));
    stage.replaceChildren();const max=model.kind==='bars'?Math.max(1,...model.series.flatMap(s=>s.values)):null;
    art=chartArt(model,'Example: '+lesson.summary,{animated:true,maximum:max});stage.append(art.svg);
    cabinet=model.kind==='notes'?window.maimaiPreviewField(cabinetModel(model),'Input positions',1):null;
    stage.classList.toggle('with-cabinet',!!cabinet);if(cabinet){cabinet.box.querySelector('svg').setAttribute('aria-label','Authored input positions');stage.append(cabinet.box);}draw();
  }
  function tick(now){if(!playing)return;time+=(now-last)/1000*Number(rate.value)*(model.unit==='beats'?2:1);last=now;if(time>=model.duration){time=model.duration;stop();}draw();if(playing)raf=requestAnimationFrame(tick);}
  play.onclick=()=>{if(playing){stop();return;}if(time>=model.duration)time=0;playing=true;play.textContent='Pause demo';last=performance.now();raf=requestAnimationFrame(tick);};
  step.onclick=()=>{stop();time=eventTimes(model).find(t=>t>time+1e-7)??0;draw();};restart.onclick=()=>{stop();time=0;draw();};scrub.oninput=()=>{stop();time=Number(scrub.value)/1000*model.duration;draw();};
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){play.hidden=true;root.append(make('p','Reduced motion is on. Use Step or the progress slider.','muted'));}
  document.addEventListener('visibilitychange',stop);dispose=()=>{stop();document.removeEventListener('visibilitychange',stop);};setup();return root;
}
function show(id,button=null,navigate=true){
  const p=definitions.find(p=>p.pattern_id===id);if(!p)return false;const lesson=lessons[id];dispose();opener=button||opener;dialog.replaceChildren();
  const header=make('header'),identity=make('div'),title=make('h2',p.display_name);title.id='pattern-title';identity.append(make('p',p.kind==='trait'?'CHART TRAIT':'PATTERN','eyebrow'),title,make('p',aliases(p),'muted'));
  const close=make('button','Close');close.setAttribute('aria-label','Close pattern');close.onclick=()=>dialog.close();header.append(identity,close);dialog.append(header);if(!dialog.open)dialog.showModal();
  dialog.append(make('p',lesson.summary,'demo-summary'),demo(lesson));
  if(window.maimaiChartOverview?.coverage.get(id)){const find=make('button','Find charts with this pattern');find.onclick=()=>{dialog.close();onDiscover(id);};dialog.append(find);}
  close.focus();if(navigate)onNavigate(id);return true;
}
dialog.addEventListener('close',()=>{dispose();if(opener?.isConnected)opener.focus();onNavigate(null);});el('pattern-search').oninput=render;el('pattern-scope').onchange=render;
window.maimaiPatternLibrary={render,show,stop:()=>dispose(),setNavigation:callback=>{onNavigate=callback;},setDiscovery:callback=>{onDiscover=callback;},has:id=>definitions.some(p=>p.pattern_id===id)};
})();
