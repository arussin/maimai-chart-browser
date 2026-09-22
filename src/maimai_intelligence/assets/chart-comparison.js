/* Choose any public chart pair or find similar measured demands, entirely locally. */
(()=>{'use strict';
const i18n=window.maimaiI18n||{text:(node,value)=>node.textContent=value,attribute:(node,key,value)=>node.setAttribute(key,value),option:(...args)=>new Option(...args),verbatim:value=>value,searchTerms:value=>value,parts:(values,separator)=>values.join(separator),message:(source,values)=>source.replace(/\{(\d+)\}/g,(_,n)=>values[n]),literal:(node,value)=>node.textContent=value};

const groups={cadence:'Input speed',rhythm:'Rhythm',coordination:'Simultaneous inputs',holds:'Holds',slides:'Slides',spatial:'Layout'};
const measurements=[
  ['cadence','mean_onsets_s','Average inputs / s',''],['cadence','peak_onsets_s','Busiest second',''],['cadence','p90_onsets_s','90th-percentile inputs / s',''],
  ['rhythm','gap_beats','Average gap between inputs',' beats'],['rhythm','gap_variation','Variation in input spacing',''],
  ['coordination','simultaneous_fraction','Inputs played together','%'],['coordination','maximum_group','Largest simultaneous group',''],
  ['holds','occupancy','Average active holds',''],['slides','occupancy','Average moving slides',''],['slides','wait_occupancy','Average waiting slides',''],
  ['spatial','single_step_buttons','Average spacing between single inputs',' buttons'],['spatial','simultaneous_span_buttons','Simultaneous-input span',' buttons'],['spatial','touch_fraction','Touch inputs','%'],
];
function mount({data,eligibleIds}){
  const overview=window.maimaiChartOverview;
  const el=id=>document.getElementById(id),make=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)i18n.text(node, text);if(cls)node.className=cls;return node;};
  const byId=new Map(data.catalog.map(c=>[c.chart_id,c])),state={left:null,right:null},pickers={};
  const name=c=>window.maimaiCatalogQuery?.titleLabel(c,i18n.locale)||c.title.trim()||'〈Blank title〉';
  const chartType=c=>i18n.parts([i18n.verbatim(c.format),c.difficulty],' ');
  const label=c=>i18n.parts([i18n.verbatim(name(c)),chartType(c),i18n.verbatim('Lv. '+(c.level||'?'))],' · ');
  const collator=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'}),difficultyOrder=['BASIC','ADVANCED','EXPERT','MASTER','RE:MASTER'];
  const bpm=c=>data.navigation?.charts?.[c.chart_id]?.bpm??null,bpmText=c=>bpm(c)==null?'BPM unknown':bpm(c)+' BPM';
  let index=null,matches=null;
  const getIndex=()=>index||(index=window.maimaiChallengeMatching.createIndex(data.catalog));
  function identity(c){const box=make('div',undefined,'chosen-chart');box.append(window.maimaiChartArtwork.jacket(c),make('strong',i18n.verbatim(name(c))),make('p',i18n.parts([chartType(c),i18n.verbatim('Lv. '+(c.level||'?')),bpmText(c)],' · '),'muted'),make('p',i18n.verbatim(c.artist),'muted'),overview.chips(c),overview.graph(c,{compact:true}));const videoLink=window.maimaiChartLinks.group(c);if(videoLink)box.append(videoLink);if(window.maimaiPersonal)box.append(window.maimaiPersonal.summary(c));return box;}
  function writeLink(){const url=new URL(location.href);for(const side of ['left','right']){if(state[side])url.searchParams.set(side,state[side]);else url.searchParams.delete(side);}history.replaceState(history.state,'',url);}
  function choose(side,id,write=true){
    id=window.maimaiRegistryBrowser.resolve(data,id);
    if(!byId.has(id))return;
    if(side==='left'&&state.left!==id)matches=null;
    const deliberate=write&&!!(side==='right'?state.left:state.right)&&(side==='right'?state.left:state.right)!==id;if(deliberate)window.maimaiUsage?.emit('compare_requested');
    state[side]=id;const picker=pickers[side];picker.input.value=name(byId.get(id));picker.close();picker.selection.replaceChildren(identity(byId.get(id)));
    render();if(deliberate)window.maimaiUsage?.emit('compare_loaded');if(write)writeLink();
  }
  for(const [side,title]of [['left','First chart'],['right','Second chart']]){
    const container=make('div',undefined,'chart-picker'),labelNode=make('label',title),input=make('input'),selection=make('div'),results=make('div',undefined,'chart-choices'),more=make('button','Show more matches','chart-choices-more'),status=make('p','','muted');
    input.type='search';input.id='compare-'+side+'-search';i18n.attribute(input, 'placeholder', 'Song, romaji title or artist…');input.autocomplete='off';results.id='compare-'+side+'-choices';results.hidden=true;input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-expanded','false');input.setAttribute('aria-controls',results.id);labelNode.append(input);
    results.setAttribute('role','listbox');i18n.attribute(results, 'aria-label', title+' search results');more.type='button';more.hidden=true;more.setAttribute('aria-controls',results.id);status.id='compare-'+side+'-search-status';status.setAttribute('role','status');input.setAttribute('aria-describedby',status.id);container.append(labelNode,results,more,status,selection);el('comparison-pickers').append(container);
    let found=[],shown=0,active=-1;
    const hint='Search all '+data.catalog.length.toLocaleString()+' charts by song, artist or difficulty.';
    function close(){results.hidden=true;more.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;i18n.text(status, state[side]?'':hint);}
    function activate(position){
      active=position;[...results.children].forEach((option,index)=>option.setAttribute('aria-selected',String(index===active)));
      const option=results.children[active];if(option){input.setAttribute('aria-activedescendant',option.id);option.scrollIntoView({block:'nearest'});}else input.removeAttribute('aria-activedescendant');
    }
    function appendMatches(){
      const end=Math.min(shown+20,found.length);
      for(let index=shown;index<end;index++){
        const chart=found[index],option=make('div',label(chart),'chart-choice');option.id=results.id+'-'+index;option.dataset.choice=chart.chart_id;option.setAttribute('role','option');option.setAttribute('aria-selected','false');option.setAttribute('aria-posinset',String(index+1));option.setAttribute('aria-setsize',String(found.length));
        option.onmousedown=event=>event.preventDefault();option.onclick=()=>{choose(side,chart.chart_id);input.focus();};results.append(option);
      }
      shown=end;more.hidden=shown>=found.length;i18n.text(status, found.length?(shown<found.length?'Showing '+shown+' of '+found.length.toLocaleString()+' matching charts. Keep typing or show more.':found.length.toLocaleString()+' matching charts.'):'No matching charts. Try another song, artist or difficulty.');
    }
    pickers[side]={input,results,status,selection,close};close();
    function search(){
      results.replaceChildren();found=[];shown=0;active=-1;input.removeAttribute('aria-activedescendant');
      if(!input.value.trim()){close();return;}
      const matchesSearch=window.maimaiSongSearch.query(input.value),query=input.value.normalize('NFKC').toLowerCase().trim();
      const rank=c=>{const title=name(c).normalize('NFKC').toLowerCase();return title===query?0:title.startsWith(query)?1:2;};
      found=data.catalog.filter(c=>matchesSearch(c,[c.format,i18n.searchTerms(c.difficulty),c.level]));
      found.sort((a,b)=>rank(a)-rank(b)||collator.compare(name(a),name(b))||collator.compare(a.format,b.format)||difficultyOrder.indexOf(a.difficulty)-difficultyOrder.indexOf(b.difficulty)||a.chart_id.localeCompare(b.chart_id));
      results.hidden=!found.length;input.setAttribute('aria-expanded',String(!!found.length));appendMatches();
    }
    input.oninput=event=>{if(event.isComposing)return;window.maimaiUsage?.emit('search_used',undefined,'compare');if(side==='left')matches=null;state[side]=null;selection.replaceChildren();render();writeLink();search();};
    input.addEventListener('compositionend',()=>input.oninput({isComposing:false}));input.onfocus=()=>{if(!state[side]&&results.hidden)search();};
    input.onkeydown=event=>{
      if(event.isComposing)return;
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){
        if(results.hidden)search();if(!found.length)return;
        const next=active<0?(event.key==='ArrowDown'?0:shown-1):Math.max(0,Math.min(found.length-1,active+(event.key==='ArrowDown'?1:-1)));
        if(next>=shown)appendMatches();activate(next);event.preventDefault();
      }else if(event.key==='Enter'&&!results.hidden&&active>=0){choose(side,found[active].chart_id);event.preventDefault();}
      else if(event.key==='Escape'){close();event.preventDefault();}
    };
    // Keep input focus through a click without suppressing Safari's touch-generated click.
    more.onmousedown=event=>event.preventDefault();
    more.onclick=()=>{const next=shown;appendMatches();input.focus();activate(next);};
    container.addEventListener('focusout',event=>{if(!container.contains(event.relatedTarget))close();});
    document.addEventListener('pointerdown',event=>{if(!container.contains(event.target))close();});
  }
  function renderPair(){
    const root=el('direct-comparison');root.replaceChildren();
    if(!state.left||!state.right||state.left===state.right)return;
    const left=byId.get(state.left),right=byId.get(state.right),result=left.demand&&right.demand?getIndex().compare(state.left,state.right):null,heading=make('h2','Chart measurements');root.append(overview.pair(left,right),heading);
    if(result){
      const summary=make('div',undefined,'comparison-summary');
      for(const [title,value,kind]of [['Closest in',i18n.parts(result.closest_groups.map(g=>groups[g].toLowerCase()),' and '),'closest'],['Furthest in',groups[result.largest_difference].toLowerCase(),'furthest']]){
        const item=make('p',undefined,'comparison-'+kind);item.append(make('strong',title),make('span',value));summary.append(item);
      }root.append(summary);
    }
    else root.append(make('p','There is not enough shared measurement coverage for a similarity summary.','muted'));
    const table=make('table',undefined,'metric-comparison'),head=make('thead'),tr=make('tr');
    for(const text of ['Measurement',label(left),label(right)]){const th=make('th',text);th.scope='col';tr.append(th);}head.append(tr);table.append(head);
    const body=make('tbody');let lastGroup='';
    const tempoRow=make('tr'),tempoLabel=make('th','Source song BPM');tempoLabel.scope='row';tempoRow.append(tempoLabel);for(const chart of [left,right])tempoRow.append(make('td',bpm(chart)==null?'Unknown':String(bpm(chart))));body.append(tempoRow);
    for(const [group,key,title,unit]of measurements){
      if(lastGroup!==group){const row=make('tr',undefined,'metric-group'),cell=make('th',groups[group]);cell.colSpan=3;cell.scope='rowgroup';row.append(cell);body.append(row);lastGroup=group;}
      const row=make('tr'),titleCell=make('th',title);titleCell.scope='row';row.append(titleCell);
      for(const chart of [left,right]){let value=chart.demand?.[group]?.[key];if(unit==='%'&&value!=null)value*=100;const text=value==null?'Unknown':(Number.isInteger(value)?String(value):value.toFixed(2))+unit;row.append(make('td',text));}body.append(row);
    }
    table.append(body);root.append(table);
  }
  function renderMatches(){
    const root=el('similar-results');root.replaceChildren();if(matches===null)return;
    root.append(make('h2',el('similar-priority').value==='patterns'?'Similar patterns & demands':'Similar chart demands'),make('p',matches.length+' matches · one chart per song family · select a match to compare both charts.','muted'));
    if(!matches.length)root.append(make('p','No other song families match the selected filters with enough measurement coverage. Try widening the chart filters.','empty-state'));
    for(const match of matches){const c=byId.get(match.chart_id),card=make('article',undefined,'similar-chart');card.append(identity(c));
      card.append(make('p',i18n.message('Similar {0}',[i18n.parts(match.closest_groups.map(g=>groups[g].toLowerCase()),' and ')]),'muted'));
      if(match.patterns){const shared=match.patterns.shared;card.append(make('p',shared.length?i18n.message('Shared: {0}',[i18n.parts(shared.map(overview.name),' · ')]):'No shared detections in supported coverage','match-patterns'));if(match.patternDistance==null)card.append(make('p','Pattern coverage insufficient; ranked by measurements','muted'));}
      const button=make('button',state.right===c.chart_id?'Comparing':'Compare');i18n.attribute(button, 'aria-label', i18n.message('Compare with {0}',[label(c)]));button.dataset.compareChart=c.chart_id;button.onclick=()=>{choose('right',c.chart_id);el('direct-comparison').scrollIntoView({block:'start',behavior:'instant'});el('direct-comparison').tabIndex=-1;el('direct-comparison').focus({preventScroll:true});};card.append(button);root.append(card);
    }
  }
  function render(){
    for(const side of ['left','right'])if(state[side])pickers[side].selection.replaceChildren(identity(byId.get(state[side])));
    el('find-similar').disabled=!state.left||!byId.get(state.left)?.demand;
    i18n.text(el('comparison-status'), state.left&&state.right?(state.left===state.right?'Both selections are the same chart. Choose another chart to compare.':i18n.message('Comparing {0} with {1}',[label(byId.get(state.left)),label(byId.get(state.right))])):state.left?'Choose a second chart or find similar chart demands.':'Choose a first chart to begin.');
    renderPair();renderMatches();
  }
  function find(){if(!state.left||!byId.get(state.left)?.demand)return;matches=getIndex().similar(state.left,{limit:8,eligibleIds:el('similar-use-filters').checked?eligibleIds():null,patternCompare:el('similar-priority').value==='patterns'?overview.compare:null});render();el('similar-results').scrollIntoView({block:'start',behavior:'instant'});}
  el('similar-priority').onchange=()=>{if(matches!==null){window.maimaiUsage?.emit('similar_requested');find();}};
  el('find-similar').onclick=()=>{window.maimaiUsage?.emit('similar_requested');const u=new URL(location.href);u.searchParams.set('similar','1');history.replaceState(history.state,'',u);find();};el('similar-use-filters').onchange=()=>{if(matches!==null){window.maimaiUsage?.emit('similar_requested');find();}};
  el('comparison-clear').onclick=()=>{state.left=state.right=null;matches=null;for(const picker of Object.values(pickers)){picker.input.value='';picker.selection.replaceChildren();picker.close();}render();writeLink();pickers.left.input.focus();};
  function restore(){const params=new URLSearchParams(location.search);let missing=false;matches=null;
    for(const side of ['left','right']){const id=window.maimaiRegistryBrowser.resolve(data,params.get(side));state[side]=null;pickers[side].input.value='';pickers[side].selection.replaceChildren();pickers[side].close();if(id){if(byId.has(id))choose(side,id,false);else missing=true;}}
    render();if(params.get('similar')==='1'&&state.left)find();if(missing)i18n.text(el('comparison-status'), 'A linked chart is not available in this catalog version. Choose a chart below.');
  }
  window.addEventListener('popstate',restore);restore();
  return{render,first:()=>state.left,useAsFirst:(id,findNow=false)=>{state.right=null;pickers.right.input.value='';pickers.right.selection.replaceChildren();pickers.right.close();choose('left',id);if(findNow){window.maimaiUsage?.emit('similar_requested');const u=new URL(location.href);u.searchParams.set('similar','1');history.replaceState(history.state,'',u);find();}},useAsSecond:id=>choose('right',id)};
}
window.maimaiChartComparison=Object.freeze({mount});
})();
