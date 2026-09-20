/* Searchable public pattern filters. Multiple selections match any selected pattern. */
(()=>{'use strict';
const i18n=window.maimaiI18n||{text:(node,value)=>node.textContent=value,attribute:(node,key,value)=>node.setAttribute(key,value),option:(...args)=>new Option(...args),searchTerms:value=>value,literal:(node,value)=>node.textContent=value};

const el=id=>document.getElementById(id),normalize=value=>String(value??'').normalize('NFKC').toLowerCase().trim();
function mount(overview,onChange){
  const definitions=new Map(JSON.parse(el('pattern-data').textContent).map(p=>[p.pattern_id,p]));
  const ids=[...overview.patternIds],selected=new Set(),rows=[];
  const menu=el('pattern-filter'),summary=el('pattern-filter-summary'),search=el('pattern-filter-search');
  const keepVisible=()=>requestAnimationFrame(()=>{if(menu.open)menu.querySelector('.pattern-filter-panel').scrollIntoView({block:'nearest',inline:'nearest'});});
  const make=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)i18n.text(node, text);if(cls)node.className=cls;return node;};
  function update(){
    i18n.text(summary, selected.size===0?'All patterns':selected.size===1?overview.name([...selected][0]):selected.size+' patterns selected');
    el('pattern-filter-clear').disabled=!selected.size;
    const terms=normalize(search.value).split(/\s+/).filter(Boolean);let count=0;
    for(const row of rows){row.input.checked=selected.has(row.id);row.label.hidden=!terms.every(term=>row.text.includes(term));if(!row.label.hidden)count++;}
    i18n.text(el('pattern-filter-count'), ids.length?count+' of '+ids.length+' patterns and traits':'No pattern data in this catalog release.');
    el('pattern-filter-empty').hidden=count>0||!ids.length;
    if(menu.open)keepVisible();
  }
  for(const [index,id] of ids.entries()){
    const definition=definitions.get(id),label=make('label'),input=make('input'),text=make('span'),name=make('span',overview.name(id));
    input.type='checkbox';input.value=id;input.dataset.patternFilter=id;input.disabled=!overview.coverage.get(id);
    const detail=make('small',input.disabled?'No supported chart coverage':(overview.frequency.get(id)||0)+' charts');detail.id='pattern-filter-option-help-'+index;
    detail.setAttribute('aria-hidden','true');input.setAttribute('aria-describedby',detail.id);
    text.append(name,detail);label.append(input,text);
    input.onchange=()=>{if(input.checked)selected.add(id);else selected.delete(id);update();onChange();};
    const aliases=(definition?.aliases||[]).map(alias=>typeof alias==='string'?alias:alias.text);
    rows.push({id,input,label,text:normalize([overview.name(id),id,...aliases].map(i18n.searchTerms).join(' '))});
    el('pattern-filter-options').append(label);
  }
  const visibleInputs=()=>rows.filter(row=>!row.label.hidden&&!row.input.disabled).map(row=>row.input);
  search.oninput=update;
  menu.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();menu.open=false;summary.focus();return;}
    if(!['ArrowDown','ArrowUp'].includes(event.key))return;
    const inputs=visibleInputs(),index=inputs.indexOf(event.target);
    if(event.target!==search&&index<0)return;
    const next=event.target===search?(event.key==='ArrowDown'?0:inputs.length-1):Math.max(0,Math.min(inputs.length-1,index+(event.key==='ArrowDown'?1:-1)));
    if(inputs[next]){event.preventDefault();inputs[next].focus();}
  });
  const otherMenus=[el('version-filter'),el('difficulty-filter')];
  menu.addEventListener('toggle',()=>{if(menu.open){
    for(const other of otherMenus)other.open=false;
    const rect=summary.getBoundingClientRect(),below=innerHeight-rect.bottom,height=menu.querySelector('.pattern-filter-panel').getBoundingClientRect().height;
    menu.classList.toggle('opens-up',below<height&&rect.top>below);
    search.focus({preventScroll:true});
    keepVisible();
  }});
  for(const other of otherMenus)other.addEventListener('toggle',()=>{if(other.open)menu.open=false;});
  document.addEventListener('click',event=>{if(!menu.contains(event.target))menu.open=false;});
  el('pattern-filter-clear').onclick=()=>{selected.clear();update();onChange();search.focus();};
  function set(values){selected.clear();for(const id of values)if(ids.includes(id))selected.add(id);search.value='';update();}
  set(new URLSearchParams(location.search).getAll('pattern-filter'));
  return {
    ids:()=>[...selected],
    set,
    clear(){set([]);},
    matches:chart=>!selected.size||overview.detected(chart).some(tag=>selected.has(tag.id)),
    chips:()=>[...selected].map(id=>{
      const button=make('button',overview.name(id)+' ×','filter-chip');i18n.attribute(button, 'aria-label', 'Remove pattern '+overview.name(id));
      button.onclick=()=>{selected.delete(id);update();onChange();summary.focus();};return button;
    })
  };
}
window.maimaiPatternFilter=Object.freeze({mount});
})();
