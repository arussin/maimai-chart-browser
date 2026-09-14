/* Multiple difficulties and an inclusive level interval, shared with comparison filtering. */
(()=>{'use strict';
const el=id=>document.getElementById(id);
const number=value=>{
  const text=String(value??'').normalize('NFKC').trim();
  if(!/^\d+(?:\+|\.5|\.0)?$/.test(text))return null;
  return parseFloat(text)+(text.endsWith('+')?.5:0);
};
function mount(charts,onChange){
  const order=['BASIC','ADVANCED','EXPERT','MASTER','RE:MASTER'];
  const selected=new Set(),difficulties=[...new Set(charts.map(c=>c.difficulty))].sort((a,b)=>order.indexOf(a.toUpperCase())-order.indexOf(b.toUpperCase()));
  const levels=[...new Set(charts.map(c=>number(c.level)).filter(n=>n!=null))].sort((a,b)=>a-b);
  const label=n=>Number.isInteger(n)?String(n):Math.floor(n)+'+';
  let low=0,high=Math.max(0,levels.length-1),drag=null;
  const fields=[el('filter-min'),el('filter-max')],sliders=[el('level-min-slider'),el('level-max-slider')];
  const menu=el('difficulty-filter'),summary=el('difficulty-summary');
  function updateDifficulties(){
    summary.textContent=selected.size===0?'All difficulties':selected.size===1?[...selected][0]:selected.size+' difficulties selected';
    for(const checkbox of el('difficulty-options').querySelectorAll('input'))checkbox.checked=selected.has(checkbox.value);
  }
  for(const difficulty of difficulties){
    const row=document.createElement('label'),input=document.createElement('input'),text=document.createElement('span');
    row.dataset.difficulty=difficulty;input.type='checkbox';input.value=difficulty;text.textContent=difficulty;
    input.onchange=()=>{if(input.checked)selected.add(difficulty);else selected.delete(difficulty);updateDifficulties();onChange();};
    row.append(input,text);el('difficulty-options').append(row);
  }
  el('difficulty-clear').onclick=()=>{selected.clear();updateDifficulties();onChange();};
  menu.addEventListener('keydown',event=>{if(event.key==='Escape'){menu.open=false;summary.focus();event.stopPropagation();}});
  menu.addEventListener('toggle',()=>{if(menu.open)el('version-filter').open=false;});
  el('version-filter').addEventListener('toggle',()=>{if(el('version-filter').open)menu.open=false;});
  document.addEventListener('click',event=>{if(!menu.contains(event.target))menu.open=false;});
  function sync(){
    el('level-error').textContent='';
    fields.forEach((field,i)=>{field.value=levels.length?label(levels[i?high:low]):'';field.removeAttribute('aria-invalid');});
    sliders.forEach((slider,i)=>{slider.value=String(i?high:low);slider.setAttribute('aria-valuetext',levels.length?'Level '+label(levels[i?high:low]):'No levels available');});
    sliders[0].setAttribute('aria-valuemax',String(high));sliders[1].setAttribute('aria-valuemin',String(low));
    const scale=Math.max(1,levels.length-1);
    el('level-range').style.setProperty('--level-low',low/scale*100+'%');
    el('level-range').style.setProperty('--level-high',high/scale*100+'%');
    el('level-clear').disabled=!levels.length||low===0&&high===levels.length-1;
  }
  function clearLevels(){low=0;high=Math.max(0,levels.length-1);sync();}
  function setSlider(side,index){
    index=Math.max(0,Math.min(levels.length-1,index));
    if(side===0)low=Math.min(index,high);else high=Math.max(index,low);
    sync();onChange();
  }
  function commit(side){
    const text=fields[side].value.trim(),value=number(text),index=text===''?(side?levels.length-1:0):levels.indexOf(value);
    if(index<0){
      fields[side].setAttribute('aria-invalid','true');
      el('level-error').textContent='Enter an available level from '+label(levels[0])+' to '+label(levels.at(-1))+'. Use + for a plus level.';
      return;
    }
    // Enter followed by blur must not render a second time and discard the
    // button receiving the click that moved focus out of the text field.
    if(index===(side?high:low)){sync();return;}
    if(side===0){low=index;if(low>high)high=low;}else{high=index;if(high<low)low=high;}
    sync();onChange();
  }
  fields.forEach((field,i)=>{
    field.disabled=!levels.length;
    field.onblur=()=>commit(i);
    field.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();commit(i);}else if(event.key==='Escape'){event.preventDefault();sync();}};
  });
  sliders.forEach((slider,i)=>{
    slider.min='0';slider.max=String(Math.max(0,levels.length-1));slider.step='1';slider.disabled=levels.length<2;
    slider.oninput=()=>setSlider(i,Number(slider.value));
  });
  // Track taps choose the nearer handle. Equal handles can be separated to either
  // side by tapping the track; both native handles also remain in the tab order.
  const track=el('level-range');
  function trackIndex(event){const box=track.getBoundingClientRect();return Math.round(Math.max(0,Math.min(1,(event.clientX-box.left-12)/(box.width-24)))*(levels.length-1));}
  track.onpointerdown=event=>{
    if(event.target.tagName==='INPUT'||levels.length<2||event.button!==0)return;
    const index=trackIndex(event),side=Math.abs(index-low)<Math.abs(index-high)?0:Math.abs(index-low)>Math.abs(index-high)?1:index<=low?0:1;
    drag=side;track.setPointerCapture(event.pointerId);sliders[side].focus();setSlider(side,index);event.preventDefault();
  };
  track.onpointermove=event=>{if(drag!=null)setSlider(drag,trackIndex(event));};
  track.onpointerup=track.onpointercancel=()=>{drag=null;};
  el('level-clear').onclick=()=>{clearLevels();onChange();fields[0].focus();};
  updateDifficulties();sync();
  return {
    matches(chart){
      if(selected.size&&!selected.has(chart.difficulty))return false;
      if(low===0&&high===levels.length-1||!levels.length)return true;
      const value=number(chart.level);return value!=null&&value>=levels[low]&&value<=levels[high];
    },
    clear(){selected.clear();updateDifficulties();clearLevels();},
    chips(){
      const result=[];
      function chip(text,aria,remove){const button=document.createElement('button');button.className='filter-chip';button.textContent=text+' ×';button.setAttribute('aria-label',aria);button.onclick=remove;result.push(button);}
      for(const difficulty of selected)chip(difficulty,'Remove difficulty '+difficulty,()=>{selected.delete(difficulty);updateDifficulties();onChange();summary.focus();});
      if(low>0)chip('From level '+label(levels[low]),'Remove minimum level filter',()=>{low=0;sync();onChange();fields[0].focus();});
      if(high<levels.length-1)chip('To level '+label(levels[high]),'Remove maximum level filter',()=>{high=levels.length-1;sync();onChange();fields[1].focus();});
      return result;
    }
  };
}
window.maimaiCatalogFilters=Object.freeze({mount,levelNumber:number});
})();
