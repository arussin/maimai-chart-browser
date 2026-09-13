/* Personal achievements stay in this browser; the public catalog remains independent. */
(()=>{'use strict';if(window.maimaiPersonal)return;
const core=window.maimaiPlayerData,make=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const protocol='maimai-player-handoff/1',grades=['D','C','B','BB','BBB','A','AA','AAA','S','S+','SS','SS+','SSS','SSS+'];
let active=null,remembered=false,storedRevision=null,visible=true,pbs=new Map(),pbDates=new Map(),catalog=null,mapping=null,reverse=new Map(),lastTimes=new Map(),busy=false;
try{visible=sessionStorage.getItem('maimai-generic')!=='1';}catch{}
const state={recorded:'',grade:new Set(),min:'',max:'',rateMin:'',rateMax:'',lamp:'',sync:''};
const status=make('div','','player-status');status.id='player-status';status.setAttribute('role','status');status.hidden=true;
const dialog=make('dialog',undefined,'player-dialog');dialog.setAttribute('aria-labelledby','player-dialog-title');document.body.append(dialog);
const input=make('input');input.type='file';input.accept='.gz,application/gzip';input.hidden=true;document.body.append(input);
let hideButton,forgetButton;
const menu=document.getElementById('settings-menu');menu?.append(status);
function menuItem(id,label,run){const b=make('button',label);b.id=id;b.type='button';b.setAttribute('role','menuitem');b.tabIndex=-1;b.onclick=()=>{window.maimaiSettings?.close();run();};menu?.prepend(b);return b;}
forgetButton=menuItem('player-forget','Forget remembered player data',()=>forget());
hideButton=menuItem('player-toggle','Hide player data',()=>{visible=!visible;saveVisibility();changed();});
const importButton=menuItem('player-import','Import player data',()=>{if(!busy)input.click();});
const importRow=make('div',undefined,'player-import-row'),help=make('a','?','player-import-help');
help.href='https://github.com/arussin/maimai-session-report/blob/main/docs/PLAYER_FILE.md';help.target='_blank';help.rel='noopener noreferrer';help.referrerPolicy='no-referrer';help.setAttribute('role','menuitem');help.tabIndex=-1;help.setAttribute('aria-label','About player files — Session Report guide');help.title='Bring scores and retained history from Session Report into this browser. Read the player-file guide.';
importButton.before(importRow);importRow.append(importButton,help);
function saveVisibility(){try{if(visible)sessionStorage.removeItem('maimai-generic');else sessionStorage.setItem('maimai-generic','1');}catch{}}
function db(){return new Promise((resolve,reject)=>{const q=indexedDB.open('maimai-player-data',1);q.onupgradeneeded=()=>q.result.createObjectStore('datasets');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(new Error('Device storage is unavailable.'));q.onblocked=()=>reject(new Error('Close other maimai.party tabs to update device storage.'));});}
async function stored(){const d=await db();try{return await new Promise((resolve,reject)=>{const t=d.transaction('datasets','readonly'),q=t.objectStore('datasets').get('active');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}finally{d.close();}}
async function persist(value){const d=await db();try{await new Promise((resolve,reject)=>{const t=d.transaction('datasets','readwrite'),s=t.objectStore('datasets'),q=s.get('active');let conflict=false;q.onsuccess=()=>{if((q.result?.revision??null)!==storedRevision){conflict=true;t.abort();return;}if(value)s.put(value,'active');else s.delete('active');};t.oncomplete=resolve;t.onabort=()=>reject(new Error(conflict?'Player data changed in another tab. Reload before importing again.':'Device storage could not be updated. Nothing was replaced.'));t.onerror=()=>{};});storedRevision=value?.revision??null;}finally{d.close();}}
function saveTab(bytes){let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));try{sessionStorage.setItem('maimai-player-session',btoa(text));}catch{throw new Error('This tab’s temporary storage is full or unavailable. Nothing was replaced. You can choose “Remember on this device” to use device storage.');}}
function date(ms){return ms==null||ms===0?'Date unknown':new Date(ms).toLocaleString();}
function changed(){pbs=active?core.current(active).pbs:new Map();pbDates=new Map();if(active)for(const s of Object.values(active.snapshots))for(const cid of Object.keys(s.pbs))pbDates.set(cid,Math.max(pbDates.get(cid)||0,s.capturedAt));lastTimes=new Map();if(active)for(const ref of Object.values(active.plays)){const r=active.records[ref];if(r.timeAchieved!=null)lastTimes.set(r.chartID,Math.max(lastTimes.get(r.chartID)||0,r.timeAchieved));}hideButton.hidden=!active;forgetButton.hidden=!storedRevision;hideButton.textContent=visible?'Hide player data':'Show player data';
  status.hidden=!active;if(active){const o=core.offer(active);const card=profileCard(o);card.classList.add('player-profile-compact');card.title=`Captured ${date(o.capturedAt)} · ${o.pbCoverage==='complete'?'Complete PB snapshot':'Partial PB collection'} · Earlier history may be missing`;status.replaceChildren(card,make('small',`${visible?'': 'Hidden · '}${remembered?'Remembered on this device':'This tab only'}`,'player-storage-label'));}
  document.querySelectorAll('[data-personal-controls]').forEach(n=>n.hidden=!active||!visible);window.dispatchEvent(new Event('maimai-personal-change'));
}
function message(title,body,{success=false}={}){
  dialog.replaceChildren();dialog.classList.add('player-message');dialog.setAttribute('aria-describedby','player-message-body');
  const icon=make('span',success?'✓':'i','player-message-icon'),h=make('h2',title),copy=make('p',body),actions=make('div',undefined,'player-message-actions'),close=make('button',success?'Okay!':'Close');
  icon.setAttribute('aria-hidden','true');h.id='player-dialog-title';copy.id='player-message-body';close.type='button';close.onclick=()=>{dialog.close();window.maimaiSettings?.focus();};actions.append(close);dialog.append(icon,h,copy,actions);if(!dialog.open)dialog.showModal();close.focus();
}
function profileCard(offer){
  const card=make('div',undefined,'player-profile'),name=make('strong',offer.player.displayName,'player-profile-name');card.append(name);
  const rating=offer.profile?.rating;
  if(rating!=null){
    const tiers=[[0,'white'],[1000,'blue'],[2000,'green'],[4000,'yellow'],[7000,'red'],[10000,'purple'],[12000,'bronze'],[13000,'silver'],[14000,'gold'],[14500,'platinum'],[15000,'rainbow'],[16000,'rainbow-ex']],badge=make('div',undefined,rating<=99999?'player-rating':'player-rating-plain');
    badge.dataset.tier=tiers.findLast(([floor])=>rating>=floor)[1];badge.setAttribute('role','img');badge.setAttribute('aria-label','Reconstructed rating '+rating);
    const digits=make('strong');digits.setAttribute('aria-hidden','true');
    if(rating<=99999)for(const digit of String(rating).padStart(5,' '))digits.append(make('span',digit===' '?'':digit));else digits.textContent=String(rating);
    badge.append(digits);card.append(badge,make('small','Reconstructed rating','player-profile-rating-label'));
  }
  const count=offer.profile?.sessionCount;
  card.append(make('span',count?`${count.toLocaleString()} retained ${count===1?'session':'sessions'}`:`${offer.playCount.toLocaleString()} retained plays`,'player-profile-history'));
  return card;
}
function ask(offer,{file=false,stale=false}={}){return new Promise(resolve=>{dialog.replaceChildren();dialog.classList.remove('player-message');dialog.removeAttribute('aria-describedby');const h=make('h2','Import this profile?');h.id='player-dialog-title';dialog.append(h,profileCard(offer),make('p',`Captured ${date(offer.capturedAt)}`,'player-capture-date'));
  if(stale)dialog.append(make('p','The hosted update was unavailable. This is the snapshot saved in the report.'));
  if(active&&active.player.key!==offer.player.key)dialog.append(make('p','This switches the active player. Different players’ records will not be combined.'));
  if(active&&active.player.key===offer.player.key&&core.offer(active).capturedAt>offer.capturedAt)dialog.append(make('p','Your newer results will be kept. This adds any missing retained history.'));
  const label=make('label',undefined,'player-remember'),check=make('input');check.type='checkbox';check.checked=remembered&&active?.player.key===offer.player.key;label.append(check,make('span','Remember on this device'));dialog.append(label,make('p','Stored only in your browser.','player-import-privacy'));
  const actions=make('div',undefined,'player-actions'),yes=make('button','Import data'),no=make('button',file?'Cancel':'Not now');actions.append(yes,no);dialog.append(actions);
  let finished=false;function finish(accept){if(finished)return;finished=true;dialog.removeEventListener('cancel',cancel);dialog.close();resolve({accept,remember:check.checked});}function cancel(e){e.preventDefault();finish(false);}dialog.addEventListener('cancel',cancel);yes.onclick=()=>finish(true);no.onclick=()=>finish(false);if(!dialog.open)dialog.showModal();yes.focus();
});}
async function commit(data,remember){const next=active?.player.key===data.player.key?await core.merge(active,data):data;const bytes=await core.encode(next);if(remember){await persist({revision:next.revision,bytes});try{sessionStorage.removeItem('maimai-player-session');}catch{}}else saveTab(bytes);active=next;remembered=remember;visible=true;saveVisibility();changed();}
async function forget(){if(busy)return;busy=true;try{await persist(null);remembered=false;changed();message('Player data forgotten','Your saved profile has been removed from this device. You can keep using it in this tab.',{success:true});}catch(e){message('Could not forget data',e.message);}finally{busy=false;}}
const ready=(async()=>{let failed=false,saved;try{saved=await stored();storedRevision=saved?.revision??null;}catch{failed=true;}try{const temporary=sessionStorage.getItem('maimai-player-session');if(temporary){if(temporary.length>Math.ceil(core.MAX_COMPRESSED*4/3)+4)throw new Error('Oversized temporary data');active=await core.decode(Uint8Array.from(atob(temporary),c=>c.charCodeAt(0)));}else if(saved){active=await core.decode(saved.bytes);remembered=true;}}catch{failed=true;}changed();if(failed&&!active){status.hidden=false;status.textContent='Saved data could not be loaded. You can still import a player file for this tab.';}})();
input.onchange=async()=>{const file=input.files[0];input.value='';if(!file||busy)return;busy=true;try{await ready;if(file.size>core.MAX_COMPRESSED)throw new Error('Player file exceeds 32 MiB.');const data=await core.decode(await file.arrayBuffer()),choice=await ask(core.offer(data),{file:true});if(choice.accept)await commit(data,choice.remember);}catch(e){message('Player data could not be imported',e.message);}finally{busy=false;}};

// An opener is only given readiness/acceptance. No remembered scores or account
// details are returned to an originating report. Payload arrives over a port.
const url=new URL(location.href),fragment=new URLSearchParams(url.hash.slice(1)),nonce=fragment.get('party-import');
if(nonce&&/^[a-f0-9-]{36}$/.test(nonce)&&window.opener){
  fragment.delete('party-import');url.hash=fragment.toString();history.replaceState(null,'',url);
  const opener=window.opener;let connected=false,tries=0;const announce=()=>{if(!connected&&tries++<40)opener.postMessage({protocol,type:'ready',nonce},'*');else clearInterval(timer);};const timer=setInterval(announce,500);
  window.addEventListener('message',async function receive(event){if((event.origin!=='null'&&!/^https?:\/\//.test(event.origin))||connected||event.source!==opener||event.data?.protocol!==protocol||event.data?.type!=='offer'||event.data?.nonce!==nonce||!event.ports[0])return;
    connected=true;clearInterval(timer);window.removeEventListener('message',receive);const port=event.ports[0];port.start();let ownsImport=false;
    try{await ready;if(busy)throw new Error('Another import is in progress. Please try again.');busy=true;ownsImport=true;const offer=core.validateOffer(event.data.offer);
      if(active&&!core.needsUpdate(active,offer)){visible=true;saveVisibility();changed();port.postMessage({type:'reused'});port.close();busy=false;return;}
      const choice=await ask(offer,{stale:event.data.stale===true});if(!choice.accept){visible=false;saveVisibility();changed();port.postMessage({type:'declined'});port.close();busy=false;return;}
      const bytes=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('The transfer was interrupted. Download the player file from the report and import it here.')),45000);port.onmessage=e=>{if(e.data?.type==='data'&&e.data.bytes instanceof ArrayBuffer){clearTimeout(timeout);resolve(e.data.bytes);}else if(e.data?.type==='error'){clearTimeout(timeout);reject(new Error('The latest data could not be transferred. Please try again.'));}};port.postMessage({type:'accept'});});
      const data=await core.decode(bytes);if(!Object.entries(core.offer(data)).every(([key,value])=>key==='profile'&&!Object.hasOwn(offer,key)||core.canonical(value)===core.canonical(offer[key])))throw new Error('The report sent a different dataset from the one offered.');await commit(data,choice.remember);port.postMessage({type:'imported'});
    }catch(e){port.postMessage({type:'error'});message('Player data could not be imported',e.message);}finally{port.close();if(ownsImport)busy=false;}
  });announce();
}

function configure(data,providerMapping){catalog=data;mapping=providerMapping||data.provider_mapping||null;reverse=new Map();const byId=new Map(data.catalog.map(c=>[c.chart_id,c]));
  if(mapping?.schema_version==='provider-mapping-1')for(const [cid,row]of Object.entries(mapping.charts||{})){const c=byId.get(row.chart_id);if(c&&c.source_hash===row.source_hash){if(!reverse.has(c.chart_id))reverse.set(c.chart_id,[]);reverse.get(c.chart_id).push(cid);}}
  changed();
}
function providerID(c){const ids=reverse.get(c.chart_id)||[];return ids.filter(id=>pbs.has(id)).sort((a,b)=>(pbDates.get(b)||0)-(pbDates.get(a)||0)||Number(!!mapping.charts[a].aliasOf)-Number(!!mapping.charts[b].aliasOf)||a.localeCompare(b))[0]||ids[0]||null;}
function record(c){return visible&&active?pbs.get(providerID(c))||null:null;}
function lastPlayed(c){if(!visible||!active)return null;const times=(reverse.get(c.chart_id)||[]).map(id=>lastTimes.get(id)).filter(v=>v!=null);return times.length?Math.max(...times):null;}
function gradeNode(value){
  const kind=/^SSS/.test(value)?'rainbow':/^S/.test(value)?'gold':/^A/.test(value)?'red':/^B/.test(value)?'blue':'unknown';
  const node=make('span',undefined,'player-grade grade-'+kind);node.setAttribute('aria-label',value||'Grade unknown');
  if(kind==='rainbow')for(const letter of value){const part=make('span',letter);part.setAttribute('aria-hidden','true');node.append(part);}else node.textContent=value||'—';return node;
}
function syncKey(value){return ({'FULL SYNC':'FS','FULL SYNC+':'FS+','FULL SYNC DX':'FSD','FULL SYNC DX+':'FSD+','FDX':'FSD','FDX+':'FSD+','SYNC PLAY':'SYNC'})[String(value).toUpperCase()]||String(value).toUpperCase();}
function badges(r){
  const fragment=document.createDocumentFragment(),lamp={'FULL COMBO':['fc','Full combo'],'FULL COMBO+':['fc+','Full combo+'],'ALL PERFECT':['ap','All perfect'],'ALL PERFECT+':['ap+','All perfect+']},sync={'FS':['fs','Full sync'],'FS+':['fs+','Full sync+'],'FSD':['fdx','Full sync DX'],'FSD+':['fdx+','Full sync DX+'],'SYNC':['sync','Sync play']};
  for(const entry of [lamp[r.lamp],sync[syncKey(r.sync)]])if(entry){const icon=make('span',undefined,'player-icon');icon.dataset.icon=entry[0];icon.setAttribute('role','img');icon.setAttribute('aria-label',entry[1]);icon.title=entry[1];fragment.append(icon);}return fragment;
}
function summary(c){const root=make('div',undefined,'player-achievement');root.hidden=!active||!visible;if(root.hidden)return root;root.append(make('span','You','player-personal-label'));const r=record(c);if(!r){root.append(make('span',providerID(c)?'No recorded PB':'Personal chart match unavailable'));return root;}
  const score=make('span',undefined,'player-score'),achievement=make(r.achievement==null?'span':'strong',r.achievement==null?'Achievement unknown':undefined,'player-achievement-value');
  if(r.achievement!=null){const [whole,fraction]=(r.achievement/10000).toFixed(4).split('.');achievement.append(make('span',whole),make('span','.'+fraction,'player-achievement-decimal'),make('span','%','player-score-unit'));}
  score.append(achievement,gradeNode(r.grade));
  const rating=make(r.rate==null?'span':'strong',r.rate==null?'Rating unknown':String(r.rate),'player-chart-rating');
  if(r.rate!=null){rating.append(document.createTextNode(' '),make('span','RT','player-score-unit'));rating.title='Chart rating';}
  root.append(score,rating,badges(r));return root;
}
function details(c){const group=window.maimaiChartOverview.section('player','Your data'),root=group.root,body=group.content;root.classList.add('player-history');root.hidden=!active||!visible;if(root.hidden)return root;body.append(summary(c));const cid=providerID(c);if(!cid)return root;
  const entries=[];for(const [id,ref]of Object.entries(active.plays)){const r=active.records[ref];if((reverse.get(c.chart_id)||[]).includes(r.chartID))entries.push({kind:'Recorded play',time:r.timeAchieved,r,id});}
  for(const [id,s]of Object.entries(active.snapshots))for(const pid of reverse.get(c.chart_id)||[]){const ref=s.pbs[pid];if(ref)entries.push({kind:s.phase==='before'?'PB before capture':'PB at capture',time:s.capturedAt,r:active.records[ref],id});}
  entries.sort((a,b)=>(b.time??-1)-(a.time??-1)||a.id.localeCompare(b.id));body.append(make('p',`${entries.filter(e=>e.kind==='Recorded play').length} retained plays. PB captures are observations, not extra plays. Earlier history may be missing.`,'muted'));
  const points=entries.filter(e=>e.kind==='Recorded play'&&e.time!=null&&e.r.achievement!=null).slice().reverse();
  if(points.length>1){const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 400 100');svg.setAttribute('role','img');svg.setAttribute('aria-label','Achievement progress across retained plays');const line=document.createElementNS(ns,'polyline'),lo=points.reduce((v,p)=>Math.min(v,p.r.achievement),1010000),hi=points.reduce((v,p)=>Math.max(v,p.r.achievement),lo+10000);line.setAttribute('points',points.map((p,i)=>`${8+i*384/(points.length-1)},${92-(p.r.achievement-lo)*84/(hi-lo)}`).join(' '));line.setAttribute('fill','none');line.setAttribute('stroke','currentColor');line.setAttribute('stroke-width','2');svg.append(line);body.append(svg,make('p',`Retained play achievement: ${(lo/10000).toFixed(2)}%–${(points.reduce((v,p)=>Math.max(v,p.r.achievement),0)/10000).toFixed(2)}%. Spacing shows play order.`,'muted'));}
  const table=make('table'),head=make('tr');for(const label of ['When','Observation','Achievement','Grade','Chart rating','Badges']){const th=make('th',label);th.scope='col';head.append(th);}const thead=make('thead');thead.append(head);const tbody=make('tbody');table.append(thead,tbody);let shown=0;
  const more=make('button','Show more history');const show=()=>{for(const e of entries.slice(shown,shown+50)){const row=make('tr');for(const v of [date(e.time),e.kind,e.r.achievement==null?'Unknown':(e.r.achievement/10000).toFixed(4)+'%'])row.append(make('td',String(v)));const grade=make('td'),icons=make('td');grade.append(gradeNode(e.r.grade));icons.append(badges(e.r));row.append(grade,make('td',String(e.r.rate??'—')),icons);tbody.append(row);}shown+=50;more.hidden=shown>=entries.length;};more.onclick=show;show();const scroll=make('div',undefined,'player-history-table');scroll.append(table);body.append(scroll,more);return root;
}
function matches(c){if(!active||!visible)return true;const r=record(c);if(state.recorded==='yes'&&!r||state.recorded==='no'&&r)return false;if(state.grade.size&&!state.grade.has(r?.grade))return false;if(state.lamp&&r?.lamp!==state.lamp||state.sync&&syncKey(r?.sync)!==state.sync)return false;for(const [key,value,minimum]of [['min',r?.achievement==null?null:r.achievement/10000,true],['max',r?.achievement==null?null:r.achievement/10000,false],['rateMin',r?.rate,true],['rateMax',r?.rate,false]])if(state[key]!==''&&(value==null||(minimum?value<Number(state[key]):value>Number(state[key]))))return false;return true;}
function controls(parent,onchange){const root=make('fieldset',undefined,'player-filters');root.dataset.personalControls='';
  const legend=make('legend'),toggle=make('button',undefined,'player-filter-toggle'),title=make('span','Your results'),count=make('small','','player-filter-count'),chevron=make('span','','player-filter-chevron');toggle.type='button';toggle.append(title,count,chevron);chevron.setAttribute('aria-hidden','true');toggle.setAttribute('aria-controls','personal-filter-content');legend.append(toggle);root.append(legend);
  const reveal=make('div',undefined,'player-filter-reveal'),body=make('div',undefined,'player-filter-body'),fields=make('div',undefined,'player-filter-fields');reveal.id='personal-filter-content';body.append(fields);reveal.append(body);root.append(reveal);let expanded=true;try{expanded=sessionStorage.getItem('maimai-personal-filters-collapsed')!=='1';}catch{}
  function expansion(){toggle.setAttribute('aria-expanded',String(expanded));root.classList.toggle('is-collapsed',!expanded);body.inert=!expanded;try{sessionStorage.setItem('maimai-personal-filters-collapsed',expanded?'0':'1');}catch{}}toggle.onclick=()=>{expanded=!expanded;expansion();};expansion();
  function change(){const n=Object.values(state).filter(v=>v instanceof Set?v.size>0:v!=='').length;count.textContent=n?`${n} active`:'';onchange();}
  const sorting=make('div',undefined,'player-sorting');sorting.setAttribute('role','group');sorting.setAttribute('aria-label','Sort personal results');sorting.append(make('span','Sort by'));
  for(const [key,label]of [['achievement','Achievement'],['grade','Grade'],['rating','Chart rating'],['lastPlayed','Last recorded play']]){const button=make('button',label);button.type='button';button.dataset.sortKey=key;sorting.append(button);}fields.append(sorting);
  const gradeGroup=make('div',undefined,'player-grade-options');gradeGroup.setAttribute('role','group');gradeGroup.setAttribute('aria-label','Filter by grade');gradeGroup.append(make('span','Grade'));gradeGroup.title='Select one or more grades';
  function gradeSelection(){gradeGroup.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.grade?state.grade.has(b.dataset.grade):state.grade.size===0)));}
  for(const grade of ['',...grades.slice().reverse()]){const b=make('button');b.type='button';b.dataset.grade=grade;b.setAttribute('aria-label',grade||'Any grade');b.append(grade?gradeNode(grade):make('span','Any'));b.onclick=()=>{if(!grade)state.grade.clear();else if(state.grade.has(grade))state.grade.delete(grade);else state.grade.add(grade);gradeSelection();change();};gradeGroup.append(b);}gradeSelection();fields.append(gradeGroup);
  const selects=[['recorded','Recorded PB',[['','Any'],['yes','Recorded PB'],['no','No recorded PB']]],['lamp','Combo',[['','Any'],...['FULL COMBO','FULL COMBO+','ALL PERFECT','ALL PERFECT+'].map(g=>[g,g])]],['sync','Sync',[['','Any'],['FS','Full sync'],['FS+','Full sync+'],['FSD','Full sync DX'],['FSD+','Full sync DX+'],['SYNC','Sync play']]]];
  for(const [key,title,options]of selects){const label=make('label',title),select=make('select');select.id='personal-'+key;for(const [value,text]of options)select.append(new Option(text,value));select.value=state[key];select.onchange=()=>{state[key]=select.value;change();};label.append(select);fields.append(label);}
  for(const [key,title]of [['min','Achievement from %'],['max','Achievement to %'],['rateMin','Chart rating from'],['rateMax','Chart rating to']]){const label=make('label',title),field=make('input');field.type='number';field.min='0';if(['min','max'].includes(key)){field.max='101';field.step='.0001';}field.id='personal-'+key;field.value=state[key];field.oninput=()=>{state[key]=field.value;change();};label.append(field);fields.append(label);}
  const clear=make('button','Clear personal filters');clear.type='button';clear.className='player-clear-filters';clear.onclick=()=>{for(const k in state)if(state[k] instanceof Set)state[k].clear();else state[k]='';root.querySelectorAll('select,input').forEach(n=>n.value='');gradeSelection();change();};fields.append(clear);const toolbar=parent.querySelector('.sort-toolbar');if(toolbar)toolbar.before(root);else parent.append(root);root.hidden=!active||!visible;return {clear:()=>clear.click()};
}
window.maimaiPersonal=Object.freeze({configure,record,summary,details,matches,controls,lastPlayed,enabled:()=>!!active&&visible,gradeIndex:c=>{const r=record(c);return r&&grades.includes(r.grade)?grades.indexOf(r.grade):null;},ready});
})();
