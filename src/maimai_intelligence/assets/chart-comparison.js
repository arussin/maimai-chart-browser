/* Choose any public chart pair or find similar measured demands, entirely locally. */
(()=>{'use strict';
const groups={cadence:'Input speed',rhythm:'Rhythm',coordination:'Simultaneous inputs',holds:'Holds',slides:'Slides',spatial:'Layout'};
const measurements=[
  ['cadence','mean_onsets_s','Average inputs / s',''],['cadence','peak_onsets_s','Busiest second',''],['cadence','p90_onsets_s','90th-percentile inputs / s',''],
  ['rhythm','gap_beats','Average gap between inputs',' beats'],['rhythm','gap_variation','Variation in input spacing',''],
  ['coordination','simultaneous_fraction','Inputs played together','%'],['coordination','maximum_group','Largest simultaneous group',''],
  ['holds','occupancy','Average active holds',''],['slides','occupancy','Average moving slides',''],['slides','wait_occupancy','Average waiting slides',''],
  ['spatial','single_step_buttons','Average spacing between single inputs',' buttons'],['spatial','simultaneous_span_buttons','Simultaneous-input span',' buttons'],['spatial','touch_fraction','Touch inputs','%'],
];
function mount({data,comparison,stopPlayers,eligibleIds}){
  const el=id=>document.getElementById(id),make=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
  const byId=new Map(data.catalog.map(c=>[c.chart_id,c])),state={left:null,right:null},pickers={},searchIndex=data.catalog.map(c=>({chart:c,text:(c.title+' '+c.artist+' '+c.format+' '+c.difficulty).normalize('NFKC').toLowerCase()}));
  const name=c=>c.title.trim()||'〈Blank title〉',label=c=>name(c)+' · '+c.format+' '+c.difficulty+' · Lv. '+(c.level||'?');
  let index=null,matches=null;
  const getIndex=()=>index||(index=window.maimaiChallengeMatching.createIndex(data.catalog));
  function identity(c){const box=make('div',undefined,'chosen-chart');box.append(make('strong',name(c)),make('p',c.format+' '+c.difficulty+' · Lv. '+(c.level||'?'),'muted'),make('p',c.artist,'muted'));return box;}
  function writeLink(){const url=new URL(location.href);for(const side of ['left','right']){if(state[side])url.searchParams.set(side,state[side]);else url.searchParams.delete(side);}history.replaceState(null,'',url);}
  function choose(side,id){
    if(!byId.has(id))return;
    if(side==='left'&&state.left!==id)matches=null;
    state[side]=id;const picker=pickers[side];picker.input.value=name(byId.get(id));picker.results.hidden=true;picker.status.textContent='';picker.selection.replaceChildren(identity(byId.get(id)));
    render();writeLink();
  }
  for(const [side,title]of [['left','First chart'],['right','Second chart']]){
    const container=make('div',undefined,'chart-picker'),labelNode=make('label',title),input=make('input'),selection=make('div'),results=make('div',undefined,'chart-choices'),status=make('p','','muted');
    input.type='search';input.id='compare-'+side+'-search';input.placeholder='Search any song or artist…';input.autocomplete='off';results.id='compare-'+side+'-choices';results.hidden=true;input.setAttribute('aria-controls',results.id);labelNode.append(input);
    results.setAttribute('role','group');results.setAttribute('aria-label',title+' search results');status.setAttribute('role','status');container.append(labelNode,results,status,selection);el('comparison-pickers').append(container);
    pickers[side]={input,results,status,selection};
    function search(){
      const query=input.value.normalize('NFKC').toLowerCase().trim(),found=searchIndex.filter(x=>x.text.includes(query));
      results.replaceChildren();results.hidden=false;
      for(const {chart}of found.slice(0,30)){const button=make('button',label(chart),'chart-choice');button.type='button';button.dataset.choice=chart.chart_id;button.onclick=()=>{choose(side,chart.chart_id);input.focus();};results.append(button);}
      status.textContent=found.length?(found.length>30?'Showing 30 matches. Keep typing to narrow the list.':found.length+' matching charts'):'No matching charts.';
    }
    input.oninput=()=>{if(side==='left')matches=null;state[side]=null;selection.replaceChildren();render();writeLink();search();};
    input.onfocus=()=>{if(!state[side])search();};
    input.onkeydown=event=>{if(event.key==='ArrowDown'){if(results.hidden)search();results.querySelector('button')?.focus();event.preventDefault();}else if(event.key==='Enter'&&!results.hidden){results.querySelector('button')?.click();event.preventDefault();}else if(event.key==='Escape'){results.hidden=true;status.textContent='';}};
    results.onkeydown=event=>{const buttons=[...results.querySelectorAll('button')],position=buttons.indexOf(document.activeElement);if(event.key==='ArrowDown'||event.key==='ArrowUp'){buttons[(position+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();event.preventDefault();}else if(event.key==='Escape'){input.focus();results.hidden=true;status.textContent='';}};
  }
  function prepared(left,right){
    const direct=data.review.find(r=>r.query_id===left)?.candidates.find(c=>c.chart_id===right);if(direct)return direct.passages;
    const reverse=data.review.find(r=>r.query_id===right)?.candidates.find(c=>c.chart_id===left);return reverse?.passages.map(p=>({...p,query_window:p.candidate_window,candidate_window:p.query_window}))||[];
  }
  function renderPair(){
    const root=el('direct-comparison');root.replaceChildren();
    if(!state.left||!state.right||state.left===state.right)return;
    const left=byId.get(state.left),right=byId.get(state.right),result=getIndex().compare(state.left,state.right),heading=make('h2','Chart measurements');root.append(heading);
    if(result)root.append(make('p','Closest in '+result.closest_groups.map(g=>groups[g].toLowerCase()).join(' and ')+'. Largest difference: '+groups[result.largest_difference].toLowerCase()+'.','comparison-summary'));
    else root.append(make('p','There is not enough shared measurement coverage for a similarity summary.','muted'));
    const table=make('table',undefined,'metric-comparison'),head=make('thead'),tr=make('tr');
    for(const text of ['Measurement',label(left),label(right)]){const th=make('th',text);th.scope='col';tr.append(th);}head.append(tr);table.append(head);
    const body=make('tbody');let lastGroup='';
    for(const [group,key,title,unit]of measurements){
      if(lastGroup!==group){const row=make('tr',undefined,'metric-group'),cell=make('th',groups[group]);cell.colSpan=3;cell.scope='rowgroup';row.append(cell);body.append(row);lastGroup=group;}
      const row=make('tr'),titleCell=make('th',title);titleCell.scope='row';row.append(titleCell);
      for(const chart of [left,right]){let value=chart.demand[group]?.[key];if(unit==='%'&&value!=null)value*=100;const text=value==null?'Unknown':(Number.isInteger(value)?String(value):value.toFixed(2))+unit;row.append(make('td',text));}body.append(row);
    }
    table.append(body);root.append(table);
    const passages=prepared(state.left,state.right);
    if(passages.length){const details=make('details',undefined,'pair-passages');details.append(make('summary','Play available passage animations'));let initialized=false;
      details.ontoggle=()=>{if(details.open&&!initialized){details.append(comparison(state.left,state.right,passages));initialized=true;}if(!details.open)stopPlayers(false);};root.append(details);
    }else root.append(make('p','A passage animation has not been prepared for this pair. The measurements above cover both charts.','muted pair-coverage'));
  }
  function renderMatches(){
    const root=el('similar-results');root.replaceChildren();if(matches===null)return;
    root.append(make('h2','Similar chart demands'),make('p',matches.length+' matches · one chart per song family · select a match to compare both charts.','muted'));
    if(!matches.length)root.append(make('p','No other song families match the selected filters with enough measurement coverage. Try widening the chart filters.','empty-state'));
    for(const match of matches){const c=byId.get(match.chart_id),card=make('article',undefined,'similar-chart');card.append(identity(c));
      card.append(make('p','Similar '+match.closest_groups.map(g=>groups[g].toLowerCase()).join(' and '),'muted'));
      const button=make('button',state.right===c.chart_id?'Comparing':'Compare');button.setAttribute('aria-label','Compare with '+label(c));button.dataset.compareChart=c.chart_id;button.onclick=()=>{choose('right',c.chart_id);el('direct-comparison').scrollIntoView({block:'start',behavior:'instant'});el('direct-comparison').tabIndex=-1;el('direct-comparison').focus({preventScroll:true});};card.append(button);root.append(card);
    }
  }
  function render(){
    stopPlayers();el('find-similar').disabled=!state.left;
    el('comparison-status').textContent=state.left&&state.right?(state.left===state.right?'Both selections are the same chart. Choose another chart to compare.':'Comparing '+label(byId.get(state.left))+' with '+label(byId.get(state.right))):state.left?'Choose a second chart or find similar chart demands.':'Choose a first chart to begin.';
    renderPair();renderMatches();
  }
  function find(){if(!state.left)return;matches=getIndex().similar(state.left,{limit:8,eligibleIds:el('similar-use-filters').checked?eligibleIds():null});render();el('similar-results').scrollIntoView({block:'start',behavior:'instant'});}
  el('find-similar').onclick=find;el('similar-use-filters').onchange=()=>{if(matches!==null)find();};
  el('comparison-clear').onclick=()=>{state.left=state.right=null;matches=null;for(const picker of Object.values(pickers)){picker.input.value='';picker.selection.replaceChildren();picker.results.hidden=true;picker.status.textContent='';}render();writeLink();pickers.left.input.focus();};
  const params=new URLSearchParams(location.search);let missing=false;
  for(const side of ['left','right']){const id=params.get(side);if(id){if(byId.has(id))choose(side,id);else missing=true;}}
  render();if(missing)el('comparison-status').textContent='A linked chart is not available in this catalog version. Choose a chart below.';
  return{render,first:()=>state.left,useAsFirst:(id,findNow=false)=>{state.right=null;pickers.right.input.value='';pickers.right.selection.replaceChildren();choose('left',id);if(findNow)find();},useAsSecond:id=>choose('right',id)};
}
window.maimaiChartComparison=Object.freeze({mount});
})();
