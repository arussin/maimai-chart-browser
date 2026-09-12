/* Public definitions and authored schematic demos. No chart tagging or player data. */
(()=>{'use strict';
const definitions=JSON.parse(document.getElementById('pattern-data').textContent);
const el=id=>document.getElementById(id),make=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
const normalize=value=>value.normalize('NFKC').toLowerCase();
const visuals=window.maimaiChartVisuals,hasDemo=p=>Boolean(visuals.patternSummary(p.pattern_id));
const aliases=p=>p.aliases.map(a=>typeof a==='string'?a:a.text).join(' · ');
const dialog=el('pattern-dialog');let dispose=()=>{},opener=null,onNavigate=()=>{};
function drawArt(p){const wrapper=make('div',undefined,'pattern-art');wrapper.innerHTML=visuals.patternSvg(p.pattern_id);return wrapper;}
function render(){
  const search=normalize(el('pattern-search').value),scope=el('pattern-scope').value;
  const shown=definitions.filter(p=>normalize([p.display_name,aliases(p),p.definition].join(' ')).includes(search)&&(scope==='all'||hasDemo(p)===(scope==='demo')));
  shown.sort((a,b)=>Number(hasDemo(b))-Number(hasDemo(a))||Number(a.kind==='trait')-Number(b.kind==='trait')||definitions.indexOf(a)-definitions.indexOf(b));
  const root=el('pattern-list');root.replaceChildren();
  el('pattern-count').textContent=shown.length+' of '+definitions.length+' definitions · '+definitions.filter(hasDemo).length+' illustrated demos';
  for(const p of shown){
    const card=make('article',undefined,'pattern-card');card.dataset.patternId=p.pattern_id;
    const type=make('p',p.kind==='trait'?'CHART TRAIT':'PATTERN','eyebrow'),heading=make('h2',p.display_name);
    const open=make('button',hasDemo(p)?'Open demo →':'Read definition →','text-button');open.dataset.openPattern=p.pattern_id;
    open.setAttribute('aria-label',(hasDemo(p)?'Open demo: ':'Read definition: ')+p.display_name);open.onclick=()=>show(p.pattern_id,open);
    card.append(type,heading,make('p',hasDemo(p)?visuals.patternSummary(p.pattern_id):'Definition under review. An accurate demo is still pending.','pattern-description'));
    if(hasDemo(p))card.append(drawArt(p));else card.append(make('p',aliases(p)||p.family.replaceAll('_',' '),'definition-alias'));
    card.append(open);root.append(card);
  }
  if(!shown.length)root.append(make('p','No definitions match this search.','empty-state'));
}
function schematic(id){
  // Authored input sequences illustrate only the existing project definitions.
  // x coordinates match the accompanying timeline, not a real chart or BPM.
  const result={events:[],holds:[],slides:[]},time=x=>(x-22)/264*4000000;
  const point=n=>{const a=(n-.5)*Math.PI/4;return[Math.sin(a),-Math.cos(a)];};
  const tap=(x,position,role='tap')=>result.events.push({time_us:time(x),position,role});
  const slide=(start,wait,end,from,to,head=true)=>{if(head)tap(start,from,'star_tap');result.slides.push({wait_start_us:time(start),movement_start_us:time(wait),movement_end_us:time(end),geometry:{points:[point(from),point(to)]}});};
  switch(id){
    case 'pattern.two_position_alternation':[40,86,132,178,224,270].forEach((x,i)=>tap(x,i%2?5:1));break;
    case 'pattern.same_position_repetition':[40,86,132,178,224,270].forEach(x=>tap(x,1));break;
    case 'pattern.simultaneous_group':[65,155,245].forEach(x=>{tap(x,1);tap(x,5);});break;
    case 'pattern.same_head_slide_fan':slide(60,67,266,1,3);slide(60,67,266,1,7,false);break;
    case 'pattern.moving_slide_overlap':slide(35,98,260,1,3);slide(85,148,281,5,7);break;
    case 'pattern.slide_tap_interleave':slide(36,116,276,1,3);tap(162,5);tap(237,5);break;
    case 'pattern.delayed_slide_interleave':slide(36,178,276,1,3);tap(106,5);break;
    case 'pattern.connected_slide_chain':tap(38,1,'star_tap');result.slides.push({wait_start_us:time(38),movement_start_us:time(38),movement_end_us:time(275),geometry:{points:[1,3,5,7].map(point)}});break;
    case 'pattern.hold_tap_interleave':tap(39,1);result.holds.push({position:1,start_us:time(39),end_us:time(270)});tap(119,5);tap(199,5);break;
    case 'trait.slide_occupancy':slide(35,65,178,1,3);slide(142,173,278,5,7);break;
    default:return null;
  }
  return result;
}
function demo(p){
  const root=make('div',undefined,'pattern-demo'),art=drawArt(p),controls=make('div',undefined,'play-controls'),stage=make('div',undefined,'demo-stage');stage.append(art);root.append(stage);
  const snippet=schematic(p.pattern_id),cabinet=snippet&&window.maimaiPreviewField?.(snippet,'Button layout',1);
  if(cabinet){stage.append(cabinet.box);stage.classList.add('with-cabinet');}
  const svg=art.querySelector('svg'),ns='http://www.w3.org/2000/svg',cursor=document.createElementNS(ns,'line');
  cursor.setAttribute('y1','8');cursor.setAttribute('y2','73');cursor.setAttribute('class','demo-playhead');cursor.setAttribute('aria-hidden','true');svg.append(cursor);
  const play=make('button','Play demo'),step=make('button','Step'),restart=make('button','Restart'),rate=make('select'),rateLabel=make('label','Speed');
  rate.setAttribute('aria-label','Demo speed');rate.append(new Option('0.5×','0.5'),new Option('1×','1'));rate.value='1';rateLabel.append(rate);
  const scrub=make('input');scrub.type='range';scrub.min='0';scrub.max='100';scrub.value='0';scrub.setAttribute('aria-label','Demo progress');
  const progress=make('span','0%','demo-progress');progress.setAttribute('aria-live','off');controls.append(play,step,restart,rateLabel,scrub,progress);root.append(controls);
  root.append(make('p','Follow the playhead from left to right. Circles mark taps; stars start slides; dashed lines show waiting. In the two-lane examples, A = button 1 and B = button 5. The button layout is a simplified illustration, without audio.','muted'));
  let position=0,playing=false,raf=0,last=0;
  function draw(){const x=22+position*264;cursor.setAttribute('x1',x);cursor.setAttribute('x2',x);scrub.value=String(Math.round(position*100));progress.textContent=Math.round(position*100)+'%';cabinet?.draw(position*4000000);
    for(const mark of svg.querySelectorAll('.pattern-example-tap')){const left=mark.getBBox().x;mark.classList.toggle('demo-passed',left<=x);}}
  function stop(){playing=false;cancelAnimationFrame(raf);play.textContent='Play demo';}
  function tick(now){if(!playing)return;position+=(now-last)/5000*Number(rate.value);last=now;if(position>=1){position=1;stop();}draw();if(playing)raf=requestAnimationFrame(tick);}
  play.onclick=()=>{if(playing){stop();return;}if(position>=1)position=0;playing=true;play.textContent='Pause demo';last=performance.now();raf=requestAnimationFrame(tick);};
  const steps=snippet?[...new Set([...snippet.events.map(e=>e.time_us),...snippet.holds.flatMap(h=>[h.start_us,h.end_us]),...snippet.slides.flatMap(s=>[s.movement_start_us,s.movement_end_us])].map(t=>t/4000000))].sort((a,b)=>a-b):[.125,.25,.375,.5,.625,.75,.875,1];
  step.onclick=()=>{stop();position=steps.find(t=>t>position+.000001)??0;draw();};restart.onclick=()=>{stop();position=0;draw();};scrub.oninput=()=>{stop();position=Number(scrub.value)/100;draw();};
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){play.hidden=true;root.append(make('p','Reduced motion is on. Use Step or the progress slider.','muted'));}
  document.addEventListener('visibilitychange',stop);
  dispose=()=>{stop();document.removeEventListener('visibilitychange',stop);};
  // SVG geometry is available after insertion into the open dialog.
  requestAnimationFrame(()=>{if(dialog.open)draw();});return root;
}
function show(id,button=null,navigate=true){
  const p=definitions.find(p=>p.pattern_id===id);if(!p)return false;dispose();opener=button||opener;dialog.replaceChildren();
  const header=make('header'),identity=make('div'),title=make('h2',p.display_name);title.id='pattern-title';identity.append(make('p',p.kind==='trait'?'CHART TRAIT':'PATTERN','eyebrow'),title,make('p',aliases(p),'muted'));
  const close=make('button','Close');close.setAttribute('aria-label','Close pattern');close.onclick=()=>dialog.close();header.append(identity,close);dialog.append(header);
  if(!dialog.open)dialog.showModal();
  if(hasDemo(p))dialog.append(make('p',visuals.patternSummary(p.pattern_id),'demo-summary'),demo(p));
  else dialog.append(make('p','A demo is awaiting review. We have kept the definition visible without inventing a visual for it.','reference-note'));
  const details=make('details'),summary=make('summary','Definition and limits');details.append(summary,make('p',p.definition));
  const list=make('ul');for(const limit of p.counterexamples_and_limits)list.append(make('li',limit));details.append(list);
  details.append(make('p',(p.name_origin==='community_attested'?'Community-attested name. ':'Project/descriptive definition. ')+'No verified chart examples are claimed here.','muted'));
  if(!hasDemo(p))details.open=true;dialog.append(details);close.focus();if(navigate)onNavigate(p.pattern_id);return true;
}
dialog.addEventListener('close',()=>{dispose();if(opener?.isConnected)opener.focus();onNavigate(null);});
el('pattern-search').oninput=render;el('pattern-scope').onchange=render;
window.maimaiPatternLibrary={render,show,stop:()=>dispose(),setNavigation:callback=>{onNavigate=callback;},has:id=>definitions.some(p=>p.pattern_id===id)};
})();
