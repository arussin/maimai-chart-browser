import {ImportCoordinator} from '../runtime/import-coordinator';
import {createSessionBrowser} from '../runtime/player-session-browser';
/** Existing DOM behavior with explicit module dependencies. */
export function createPlayerData(ports) {
let personal;
const subscribers=new Set();
const notifyChange=()=>{for(const listener of subscribers)listener();};
/* Personal achievements stay in this browser; the public catalog remains independent. */
(()=>{'use strict';
const i18n=ports.localization||{text:(node,value)=>node.textContent=value,attribute:(node,key,value)=>node.setAttribute(key,value),option:(...args)=>new Option(...args),verbatim:value=>value,literal:(node,value)=>node.textContent=value};

const core=ports.playerCore,sources=ports.playerSources,make=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)i18n.text(n, text);if(cls)n.className=cls;return n;};
const storageKey=ports.playerContext?.key||(name=>name);
const session=ports.playerDomain;
const usage=(event,detail='',failure='')=>ports.usage?.emit(event,undefined,detail,failure);
const grades=['D','C','B','BB','BBB','A','AA','AAA','S','S+','SS','SS+','SSS','SSS+'];
let visible=true,pbs=new Map(),pbDates=new Map(),catalog=null,mapping=null,reverse=new Map(),lastTimes=new Map();
let maishiftMapping=null,maishiftReverse=new Map(),catalogByID=new Map();
const browserSession=createSessionBrowser(storageKey);
const player=new ImportCoordinator({core,sources,storage:ports.playerStorage,maishift:ports.maishift,
  temporary:browserSession.temporary,key:storageKey,
  refreshAllowed:()=>document.visibilityState==='visible'&&navigator.onLine&&!document.querySelector('dialog[open]'),
  effects:{changed,show:()=>{visible=true;saveVisibility();},hide:()=>{visible=false;saveVisibility();},
    loadedFailure:()=>{status.hidden=false;i18n.text(status,'Saved data could not be loaded. You can still import a player file for this tab.');},
    invalidate:()=>{refreshButton.disabled=false;},ask,reading,message,recovery:reportRecovery,usage,
    notify:browserSession.notify,unmatched:unmatchedPBs}});
const ready=player.ready;
try{visible=sessionStorage.getItem(storageKey('maimai-generic'))!=='1';}catch{}
const state=ports.browserState.personal;
const status=make('div','','player-status');status.id='player-status';status.setAttribute('role','status');status.hidden=true;
const dialog=make('dialog',undefined,'player-dialog');dialog.id='player-import-dialog';dialog.setAttribute('aria-labelledby','player-dialog-title');document.body.append(dialog);
let dialogTrigger=document.getElementById('settings-toggle');
function focusDialogTrigger(){dialogTrigger?.focus({preventScroll:true});}
dialog.addEventListener('close',()=>{if(!dialog.open)focusDialogTrigger();});
const input=make('input');input.type='file';input.accept='.gz,application/gzip';input.hidden=true;document.body.append(input);
let hideButton,forgetButton,clearButton;
const menu=document.getElementById('settings-actions');document.getElementById('settings-menu')?.append(status);
function menuItem(id,label,run){const b=make('button',label);b.id=id;b.type='button';b.setAttribute('role','menuitem');b.tabIndex=-1;b.onclick=()=>{dialogTrigger=document.getElementById('settings-toggle');ports.settings?.close();run();};menu?.prepend(b);return b;}
clearButton=menuItem('player-clear','Clear player data',()=>player.clear());
forgetButton=menuItem('player-forget','Forget remembered player data',()=>player.forget());
hideButton=menuItem('player-toggle','Hide player data',()=>{visible=!visible;saveVisibility();changed();usage('data_action',visible?'show':'hide');});
const refreshButton=menuItem('player-refresh','Refresh now',()=>player.refresh(true));refreshButton.hidden=true;
const importButton=menuItem('player-import','Import player data',()=>{if(!player.busy)selectSource();});
const header=document.querySelector('.catalog-heading-actions');
if(header){
  const launch=make('button',undefined,'player-import-primary');launch.id='player-import-primary';launch.type='button';launch.setAttribute('aria-haspopup','dialog');launch.setAttribute('aria-controls',dialog.id);
  launch.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/></svg>';
  launch.append(make('span','Import player data'));launch.onclick=()=>{if(!player.busy){dialogTrigger=launch;ports.settings?.close();selectSource();}};
  header.append(launch);
}
function helpLink(section,label){const link=external('?', '');link.className='player-source-help';link.dataset.importHelp=section;link.onclick=()=>usage('resource_opened','import_help');i18n.attribute(link,'aria-label',label);i18n.attribute(link,'title',label);updateHelpLink(link);return link;}
function updateHelpLink(link){const path='player-import-help.'+(ports.localization?.locale||'en')+'.html#'+link.dataset.importHelp;link.href=ports.songPages?.asset(path)??path;}
window.addEventListener('maimai-language-change',()=>document.querySelectorAll('[data-import-help]').forEach(updateHelpLink));
function saveVisibility(){try{if(visible)sessionStorage.removeItem(storageKey('maimai-generic'));else sessionStorage.setItem(storageKey('maimai-generic'),'1');}catch{}}
function date(ms){return ms==null||ms===0?'Date unknown':new Date(ms).toLocaleString();}
function changed(redraw=true){const scroll=[scrollX,scrollY],expandedHistory=[...document.querySelectorAll('.player-pb-toggle[aria-expanded="true"]')].map(node=>node.getAttribute('aria-controls'));pbs=player.active?core.current(player.active).pbs:new Map();pbDates=new Map();if(player.active)for(const s of Object.values(player.active.snapshots))for(const cid of Object.keys(s.pbs))pbDates.set(cid,Math.max(pbDates.get(cid)||0,s.capturedAt));lastTimes=new Map();if(player.active)for(const ref of Object.values(player.active.plays)){const r=player.active.records[ref];if(r.timeAchieved!=null)lastTimes.set(r.chartID,Math.max(lastTimes.get(r.chartID)||0,r.timeAchieved));}hideButton.hidden=!player.active;forgetButton.hidden=!player.storedRevision;i18n.text(hideButton, visible?'Hide player data':'Show player data');
  clearButton.hidden=!player.active&&!player.storedRevision;
  status.hidden=!player.active;if(player.active){const o=core.offer(player.active);const card=profileCard(o,player.sourceRating);card.classList.add('player-profile-compact');if(player.source?.type==='report'){const link=external('Session Report',player.source.url);link.className='player-profile-history player-profile-link';card.append(link);}status.replaceChildren(card,make('small',ports.localization.message('Last Updated: {0}',[date(player.lastImportedAt)]),'player-storage-label'));}else status.replaceChildren();
  refreshButton.hidden=!player.source?.autoRefresh;refreshButton.disabled=player.refreshing;
  if(player.refreshText&&player.active)status.append(make('small',player.refreshText));
  document.querySelectorAll('[data-personal-controls]').forEach(n=>n.hidden=!player.active||!visible);if(redraw){notifyChange();for(const id of expandedHistory){const toggle=document.getElementById(id)?.previousElementSibling;if(toggle?.classList.contains('player-pb-toggle')&&toggle.getAttribute('aria-expanded')==='false')toggle.click();}scrollTo(...scroll);}
}
function message(title,body,{success=false}={}){
  dialog.replaceChildren();dialog.classList.add('player-message');dialog.setAttribute('aria-describedby','player-message-body');
  const icon=make('span',success?'✓':'i','player-message-icon'),h=make('h2',title),copy=make('p',body),actions=make('div',undefined,'player-message-actions'),close=make('button',success?'Okay!':'Close');
  icon.setAttribute('aria-hidden','true');h.id='player-dialog-title';copy.id='player-message-body';close.type='button';close.onclick=()=>{dialog.close();focusDialogTrigger();};actions.append(close);dialog.append(icon,h,copy,actions);if(!dialog.open)dialog.showModal();close.focus();
}
function profileCard(offer,reportedRating=null){
  const card=make('div',undefined,'player-profile'),name=make('strong',i18n.verbatim(offer.player.displayName),'player-profile-name');card.append(name);
  const reported=offer.player.provider==='maishift'&&reportedRating!=null,rating=reported?reportedRating:offer.profile?.rating,label=reported?'Maishift rating':rating==null?'Rating unknown':'Reconstructed rating';
  {
    const tiers=[[0,'white'],[1000,'blue'],[2000,'green'],[4000,'yellow'],[7000,'red'],[10000,'purple'],[12000,'bronze'],[13000,'silver'],[14000,'gold'],[14500,'platinum'],[15000,'rainbow'],[16000,'rainbow-ex']],badge=make('div',undefined,rating==null||rating<=99999?'player-rating':'player-rating-plain');
    if(rating==null)badge.classList.add('player-rating-unknown');else badge.dataset.tier=tiers.findLast(([floor])=>rating>=floor)[1];
    badge.setAttribute('role','img');i18n.attribute(badge, 'aria-label', rating==null?'Rating unknown':reported?ports.localization.message('Maishift rating {0}',[String(rating)]):'Reconstructed rating '+rating);
    const digits=make('strong');digits.setAttribute('aria-hidden','true');
    if(rating==null)for(let i=0;i<5;i++)digits.append(make('span','–'));
    else if(rating<=99999)for(const digit of String(rating).padStart(5,' '))digits.append(make('span',digit===' '?'':digit));else i18n.text(digits, String(rating));
    badge.append(digits);card.append(badge,make('small',label,'player-profile-rating-label'));
  }
  if(offer.player.provider==='maishift'){
    let username=make('span',i18n.verbatim(offer.player.username),'player-profile-history');
    // Portable identities are broader than the verified public URL grammar.
    try{username=external(i18n.verbatim(offer.player.username),ports.maishift.location(offer.player.username,offer.player.key.split(':')[2]).url);username.className='player-profile-history player-profile-link';}catch{}
    card.append(username,make('span',ports.localization.message('{0} PBs',[offer.pbCount.toLocaleString()]),'player-profile-history'));return card;
  }
  const count=offer.profile?.sessionCount;
  card.append(make('span',count?`${count.toLocaleString()} retained ${count===1?'session':'sessions'}`:`${offer.playCount.toLocaleString()} retained ${offer.playCount===1?'play':'plays'}`,'player-profile-history'));
  return card;
}
function ask(offer,{file=false,stale=false,connection=null,rememberDefault=true,unmatched=null}={},signal){return new Promise(resolve=>{if(signal.aborted){resolve({accept:false,remember:false});return;}dialog.replaceChildren();dialog.classList.remove('player-message');dialog.removeAttribute('aria-describedby');const h=make('h2','Import this profile?');h.id='player-dialog-title';dialog.append(h,profileCard(offer,connection?.profileRating),make('p',`Captured ${date(offer.capturedAt)}`,'player-capture-date'));
  if(stale)dialog.append(make('p','The hosted update was unavailable. This is the snapshot saved in the report.'));
  if(player.active&&player.active.player.key!==offer.player.key)dialog.append(make('p','Importing will overwrite data from the currently imported account.','player-import-replace-warning'));
  if(connection){
    if(unmatched>0)dialog.append(make('p',ports.localization.message('Unmatched PB charts: {0}',[String(unmatched)]),'player-import-warning'));
    if(connection.diagnosticCount>0)dialog.append(make('p',ports.localization.message('Records excluded for missing chart identity: {0}',[String(connection.diagnosticCount)]),'player-import-warning'));
  }
  const label=make('label',undefined,'player-remember'),check=make('input');check.type='checkbox';check.checked=connection?rememberDefault:player.remembered&&player.active?.player.key===offer.player.key;label.append(check,make('span',connection?'Remember and refresh':'Remember on this device'));dialog.append(label,make('p','Stored only in your browser.','player-import-privacy'));
  const actions=make('div',undefined,'player-actions'),yes=make('button','Import data'),no=make('button',file?'Cancel':'Not now');actions.append(yes,no);dialog.append(actions);
  if(connection){const label=()=>i18n.text(yes,check.checked?'Import & remember':'Import once');check.onchange=label;label();}
  let finished=false;function finish(accept){if(finished)return;finished=true;signal.removeEventListener('abort',aborted);dialog.removeEventListener('cancel',cancel);dialog.close();resolve({accept,remember:check.checked});}function cancel(e){e.preventDefault();finish(false);}const aborted=()=>finish(false);signal.addEventListener('abort',aborted,{once:true});dialog.addEventListener('cancel',cancel);yes.onclick=()=>finish(true);no.onclick=()=>finish(false);if(!dialog.open)dialog.showModal();yes.focus();
});}
input.onchange=()=>{const file=input.files[0];input.value='';if(file)void player.importFile(file);};
function reading(cancel){
  message('Reading public player data','You can cancel this request.');
  const close=dialog.querySelector('button');close.addEventListener('click',cancel);dialog.addEventListener('cancel',cancel);dialog.addEventListener('close',cancel);
  return ()=>{close.removeEventListener('click',cancel);dialog.removeEventListener('cancel',cancel);dialog.removeEventListener('close',cancel);};
}

function external(label,url){const link=make('a',label);link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.referrerPolicy='no-referrer';const resource=label==='Maishift'?'maishift':label==='Open report'?'session_report':null;if(resource)link.addEventListener('click',()=>usage('resource_opened',resource));return link;}
function unmatchedPBs(data){const ids=new Set([...reverse.values()].flat());return [...core.current(data).pbs.keys()].filter(id=>data.player.provider==='maishift'?!maishiftMatch(data,id):data.player.provider!=='kamaitachi'||!ids.has(id)).length;}
async function selectSource(){
  usage('import_opened');await ready;
  player.cancel();dialog.replaceChildren();dialog.classList.remove('player-message');dialog.removeAttribute('aria-describedby');
  const heading=make('h2','Import player data');heading.id='player-dialog-title';
  const group=make('fieldset',undefined,'player-source-options');group.append(make('legend','Choose a source'));
  const reports=make('div',undefined,'player-source-group'),reportRows=make('div',undefined,'player-source-rows'),maishift=make('div',undefined,'player-source-group');
  reports.append(reportRows,helpLink('session-report','About Session Report imports'));group.append(reports,maishift);
  const fields=make('div',undefined,'player-source-fields'),actions=make('div',undefined,'player-actions'),next=make('button','Continue'),cancel=make('button','Cancel');
  let selected=player.source?.type||'file',rememberChoice=true;
  for(const [value,label]of [['file','Upload a file'],['report','Hosted Session Report'],['maishift','Maishift']]){
    const row=make('label'),radio=make('input'),icon=make('img');radio.type='radio';radio.name='player-source';radio.value=value;radio.checked=value===selected;radio.onchange=()=>{selected=value;render();};
    icon.alt='';icon.width=22;icon.height=22;icon.setAttribute('aria-hidden','true');icon.src=value==='maishift'?(ports.songPages?.asset('maishift-favicon.ico')??'maishift-favicon.ico'):document.querySelector('link[rel=icon][sizes="32x32"]')?.href||document.querySelector('link[rel=icon]')?.href||'';
    row.append(radio,icon,make('span',label));(value==='maishift'?maishift:reportRows).append(row);
  }
  maishift.append(helpLink('maishift','About Maishift imports'));
  function render(){fields.replaceChildren();next.disabled=selected==='maishift'&&!sources.capabilities.maishift;
    if(selected==='file'){fields.append(make('p','Choose a compressed player file exported by Session Report.'));next.onclick=()=>{dialog.close();input.click();};}
    else if(selected==='maishift'&&!sources.capabilities.maishift)fields.append(make('p','Maishift import is not available yet. Full record access and exact chart matching are still being verified.'),external('Maishift','https://maimai.shiftpsh.com/en'));
    else if(selected==='maishift'){
      const label=make('label','Maishift handle or profile URL'),url=make('input');url.type='text';url.id='player-maishift-url';url.autocomplete='off';url.spellcheck=false;url.maxLength=2048;url.value=player.source?.type==='maishift'?player.source.url:'';label.append(url);
      const remember=make('label',undefined,'player-remember'),check=make('input');check.type='checkbox';check.checked=rememberChoice;check.onchange=()=>rememberChoice=check.checked;remember.append(check,make('span','Remember and refresh'));
      fields.append(label,make('p','Public profiles only. Party reads your scores; saving stays in your browser.'),remember);
      next.onclick=()=>{let selected;try{selected=ports.maishift.location(url.value);}catch(e){message('Player data could not be imported',e.message);return;}importReport(selected,rememberChoice);};
    }
    else{
      const label=make('label','Hosted Session Report URL'),url=make('input');url.type='url';url.id='player-report-url';url.autocomplete='off';url.spellcheck=false;url.maxLength=2048;url.value=player.source?.type==='report'?player.source.url:'';label.append(url);
      const remember=make('label',undefined,'player-remember'),check=make('input');check.type='checkbox';check.checked=rememberChoice;check.onchange=()=>rememberChoice=check.checked;remember.append(check,make('span','Remember and refresh'));
      fields.append(label,make('p','For private reports, use Open in Party from your report.'),remember);
      next.onclick=()=>importReport(url.value,rememberChoice);
    }
  }
  cancel.onclick=()=>{dialog.close();focusDialogTrigger();};actions.append(next,cancel);dialog.append(heading);if(player.active)dialog.append(make('p','Importing will overwrite data from the currently imported account.','player-import-replace-warning'));dialog.append(group,fields,actions);render();if(!dialog.open)dialog.showModal();group.querySelector(':checked')?.focus();
}
function importReport(value,rememberChoice){void player.importSource(value,rememberChoice);}
function reportRecovery(url){message('Open your Session Report','The public source could not be read. Open the report to use its import or download controls.');const link=external('Open report',url);link.tabIndex=0;dialog.querySelector('.player-message-actions').prepend(link);}
browserSession.connect(player,ports.historyPort);

function configure(data,providerMapping){
  catalog=data;mapping=providerMapping||data.provider_mapping||null;
  const index=session.providerIndex(data,mapping);
  reverse=index.kamaitachi;catalogByID=index.byId;maishiftReverse=index.maishift;maishiftMapping=data.maishift_mapping;
  changed();
}
function maishiftMatch(data,id){const row=maishiftMapping?.charts?.[id],c=catalogByID.get(row?.chart_id);return maishiftReverse.get(data.player.key.split(':')[2]+':'+c?.chart_id)===id&&ports.maishift.matchChart(data.player,data.charts[id],row,c);}
function providerIDs(c){if(player.active?.player.provider==='kamaitachi')return reverse.get(c.chart_id)||[];if(player.active?.player.provider!=='maishift')return [];const id=maishiftReverse.get(player.active.player.key.split(':')[2]+':'+c.chart_id);return id&&maishiftMatch(player.active,id)?[id]:[];}
function providerID(c){return session.preferredProviderID(providerIDs(c),pbs,pbDates,mapping);}

function displayRecord(r){return r&&player.active?.player.provider==='maishift'&&!r.grade?{...r,grade:ports.maishift.grade(r.achievement)}:r;}
function record(c){return visible&&player.active?displayRecord(pbs.get(providerID(c)))||null:null;}
function lastPlayed(c){if(!visible||!player.active||player.active.player.provider!=='kamaitachi')return null;const times=(reverse.get(c.chart_id)||[]).map(id=>lastTimes.get(id)).filter(v=>v!=null);return times.length?Math.max(...times):null;}
function gradeNode(value){
  const kind=/^SSS/.test(value)?'rainbow':/^S/.test(value)?'gold':/^A/.test(value)?'red':/^B/.test(value)?'blue':'unknown';
  const node=make('span',undefined,'player-grade grade-'+kind);node.setAttribute('role','img');i18n.attribute(node, 'aria-label', value||'Grade unknown');
  if(kind==='rainbow')for(const letter of value){const part=make('span',letter);part.setAttribute('aria-hidden','true');node.append(part);}else i18n.text(node, value||'—');return node;
}
// Presentation aliases only: retain the provider's original observation bytes.
function lampKey(value){const key=String(value??'').trim().toUpperCase();return ({'FULL_COMBO':'FULL COMBO','FULL_COMBO_PLUS':'FULL COMBO+','ALL_PERFECT':'ALL PERFECT','ALL_PERFECT_PLUS':'ALL PERFECT+'})[key]||key;}
function syncKey(value){const key=String(value??'').trim().toUpperCase();return ({'FULL SYNC':'FS','FULL SYNC+':'FS+','FULL SYNC DX':'FSD','FULL SYNC DX+':'FSD+','FDX':'FSD','FDX+':'FSD+','SYNC PLAY':'SYNC','FULL_SYNC':'FS','FULL_SYNC_PLUS':'FS+','FULL_SYNC_DX':'FSD','FULL_SYNC_DX_PLUS':'FSD+','SYNC_PLAY':'SYNC'})[key]||key;}
function badges(r){
  const fragment=document.createDocumentFragment(),lamp={'FULL COMBO':['fc','Full combo'],'FULL COMBO+':['fc+','Full combo+'],'ALL PERFECT':['ap','All perfect'],'ALL PERFECT+':['ap+','All perfect+']},sync={'FS':['fs','Full sync'],'FS+':['fs+','Full sync+'],'FSD':['fdx','Full sync DX'],'FSD+':['fdx+','Full sync DX+'],'SYNC':['sync','Sync play']};
  for(const entry of [lamp[lampKey(r.lamp)],sync[syncKey(r.sync)]])if(entry){const icon=make('span',undefined,'player-icon');icon.dataset.icon=entry[0];icon.setAttribute('role','img');i18n.attribute(icon, 'aria-label', entry[1]);i18n.attribute(icon, 'title', entry[1]);fragment.append(icon);}return fragment;
}
function summary(c){const root=make('div',undefined,'player-achievement');root.hidden=!player.active||!visible;if(root.hidden)return root;root.append(make('span','You','player-personal-label'));const r=record(c);if(!r){root.append(make('span',providerID(c)?'No recorded PB':'Personal chart match unavailable'));return root;}
  const score=make('span',undefined,'player-score'),achievement=make(r.achievement==null?'span':'strong',r.achievement==null?'Achievement unknown':undefined,'player-achievement-value');
  if(r.achievement!=null){const [whole,fraction]=(r.achievement/10000).toFixed(4).split('.');achievement.append(make('span',whole),make('span','.'+fraction,'player-achievement-decimal'),make('span','%','player-score-unit'));}
  score.append(achievement,gradeNode(r.grade));
  root.append(score);
  if(r.rate!=null){const rating=make('strong',String(r.rate),'player-chart-rating');rating.append(document.createTextNode(' '),make('span','RT','player-score-unit'));i18n.attribute(rating, 'title', 'Chart rating');root.append(rating);}
  root.append(badges(r));return root;
}
function details(c){const group=ports.overview.section('player','Your data'),root=group.root,body=group.content;root.classList.add('player-history');root.hidden=!player.active||!visible;if(root.hidden)return root;body.append(summary(c));const cid=providerID(c);if(!cid)return root;
  const {plays,changes}=core.chartHistory(player.active,[cid,...providerIDs(c).filter(id=>id!==cid)]);
  body.append(make('h4','Recorded plays','player-history-title'),make('p',plays.length?`${plays.length} retained ${plays.length===1?'play':'plays'} · Dates show when you played.`:'No recorded plays for this chart. Your saved PB is shown above.','muted'));
  const points=plays.filter(e=>e.time!=null&&e.r.achievement!=null).slice().reverse();
  if(points.length>1){const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 400 100');svg.setAttribute('role','img');i18n.attribute(svg, 'aria-label', 'Achievement progress across retained plays');const line=document.createElementNS(ns,'polyline'),lo=points.reduce((v,p)=>Math.min(v,p.r.achievement),1010000),hi=points.reduce((v,p)=>Math.max(v,p.r.achievement),lo+10000);line.setAttribute('points',points.map((p,i)=>`${8+i*384/(points.length-1)},${92-(p.r.achievement-lo)*84/(hi-lo)}`).join(' '));line.setAttribute('fill','none');line.setAttribute('stroke','currentColor');line.setAttribute('stroke-width','2');svg.append(line);body.append(svg);}
  function tableFor(entries,firstLabel,label){
    const wrap=make('div'),table=make('table'),head=make('tr');for(const title of [firstLabel,'Achievement','Grade','Chart rating','Badges']){const th=make('th',title);th.scope='col';head.append(th);}const thead=make('thead');thead.append(head);const tbody=make('tbody');table.append(thead,tbody);let shown=0;
    const more=make('button','Show more '+label.toLowerCase());more.type='button';const show=()=>{for(const e of entries.slice(shown,shown+50)){const row=make('tr');row.append(make('td',date(e.time)),make('td',e.r.achievement==null?'Unknown':(e.r.achievement/10000).toFixed(4)+'%'));const grade=make('td'),icons=make('td');grade.append(gradeNode(displayRecord(e.r).grade));icons.append(badges(e.r));row.append(grade,make('td',String(e.r.rate??'—')),icons);tbody.append(row);}shown+=50;more.hidden=shown>=entries.length;};more.onclick=show;show();const scroll=make('div',undefined,'player-history-table');scroll.tabIndex=0;scroll.setAttribute('role','region');i18n.attribute(scroll, 'aria-label', label);scroll.append(table);wrap.append(scroll,more);return wrap;
  }
  if(plays.length)body.append(tableFor(plays,'Played on','Recorded plays'));
  if(changes.length){const toggle=make('button',`Show saved PB changes (${changes.length})`,'player-pb-toggle'),saved=make('div',undefined,'player-pb-history');toggle.type='button';toggle.setAttribute('aria-expanded','false');saved.hidden=true;saved.id='saved-pbs-'+c.chart_id;toggle.setAttribute('aria-controls',saved.id);saved.append(make('p','These dates show when a PB was saved, not when you played. Unchanged scores are grouped.','muted'),tableFor(changes,'Saved on','Saved PB changes'));toggle.onclick=()=>{saved.hidden=!saved.hidden;if(saved.hidden)ports.browserState.history.delete(saved.id);else ports.browserState.history.add(saved.id);toggle.setAttribute('aria-expanded',String(!saved.hidden));i18n.text(toggle, `${saved.hidden?'Show':'Hide'} saved PB changes (${changes.length})`);};body.append(toggle,saved);}
  return root;
}

function matches(c){if(!player.active||!visible)return true;const r=record(c);if(state.recorded==='yes'&&!r||state.recorded==='no'&&r)return false;if(state.grade.size&&!state.grade.has(r?.grade))return false;if(state.lamp&&lampKey(r?.lamp)!==state.lamp||state.sync&&syncKey(r?.sync)!==state.sync)return false;for(const [key,value,minimum]of [['min',r?.achievement==null?null:r.achievement/10000,true],['max',r?.achievement==null?null:r.achievement/10000,false],['rateMin',r?.rate,true],['rateMax',r?.rate,false]])if(state[key]!==''&&(value==null||(minimum?value<Number(state[key]):value>Number(state[key]))))return false;return true;}
function controls(parent,onchange){const root=make('fieldset',undefined,'player-filters'),badgeSelectors=[];root.dataset.personalControls='';
  const legend=make('legend'),toggle=make('button',undefined,'player-filter-toggle'),title=make('span','Your results'),count=make('small','','player-filter-count'),chevron=make('span','','player-filter-chevron');toggle.type='button';toggle.id='player-filters-toggle';toggle.append(title,count,chevron);chevron.setAttribute('aria-hidden','true');toggle.setAttribute('aria-controls','personal-filter-content');legend.append(toggle);root.append(legend);
  const scope=make('div',undefined,'format-switch');scope.classList.add('personal-scope');scope.setAttribute('role','group');i18n.attribute(scope, 'aria-label', 'Personal chart scope');
  function scopeSelection(){scope.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(state.recorded===b.dataset.recorded)));}
  for(const [value,label]of [['','All charts'],['yes','My PBs'],['no','No PB yet']]){const b=make('button',label);b.type='button';b.dataset.recorded=value;b.onclick=()=>{if(value&&(!player.active||!visible)){importButton.click();return;}state.recorded=value;scopeSelection();change();usage('filter_first_used','personal_scope');};scope.append(b);}scopeSelection();document.getElementById('personal-scope-slot').append(scope);
  const reveal=make('div',undefined,'player-filter-reveal'),body=make('div',undefined,'player-filter-body'),fields=make('div',undefined,'player-filter-fields');reveal.id='personal-filter-content';body.append(fields);reveal.append(body);root.append(reveal);ports.filterDisclosure(root,toggle,body,'maimai-personal-filters-collapsed');
  function summary(){
    const n=Object.values(state).filter(v=>v instanceof Set?v.size>0:v!=='').length;i18n.text(count,n?`${n} active`:'');empty.hidden=n>0;clear.hidden=n===0;chips.replaceChildren();
    const labels={recorded:'Show',grade:'Grade',lamp:'Combo',sync:'Sync',min:'Achievement from %',max:'Achievement to %',rateMin:'Chart rating from',rateMax:'Chart rating to'};
    for(const [key,value]of Object.entries(state))for(const item of value instanceof Set?value:value!==''?[value]:[]){
      const chip=make('button',undefined,'filter-chip');chip.type='button';const label=key==='recorded'?(item==='yes'?'My PBs':'No PB yet'):labels[key];
      chip.append(make('span',label));if(key!=='recorded')chip.append(document.createTextNode(': '),make('span',String(item)));chip.append(document.createTextNode(' ×'));
      i18n.attribute(chip,'aria-label','Remove '+label+' filter');chip.onclick=()=>{if(state[key] instanceof Set)state[key].delete(item);else state[key]='';syncFields();change();};chips.append(chip);
    }
  }
  function syncFields(){for(const key of ['lamp','sync','min','max','rateMin','rateMax']){const field=document.getElementById('personal-'+key);if(field)field.value=state[key];}gradeSelection();scopeSelection();}
  let ranges;
  function change(){for(const selector of badgeSelectors)selector();ranges?.sync();summary();onchange();}
  const sorting=make('div',undefined,'player-sorting');sorting.setAttribute('role','group');i18n.attribute(sorting, 'aria-label', 'Sort personal results');sorting.append(make('span','Sort by'));
  for(const [key,label]of [['rating','Your RT'],['achievement','Achievement'],['grade','Grade'],['lastPlayed','Last recorded play']]){const button=make('button',label);button.type='button';button.dataset.sortKey=key;if(key==='rating')i18n.attribute(button, 'title', 'Sort by your chart rating (RT)');sorting.append(button);}fields.append(sorting);
  const gradeGroup=make('div',undefined,'player-grade-options');gradeGroup.setAttribute('role','group');i18n.attribute(gradeGroup, 'aria-label', 'Filter by grade');gradeGroup.append(make('span','Grade'));i18n.attribute(gradeGroup, 'title', 'Select one or more grades');
  function gradeSelection(){gradeGroup.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.grade?state.grade.has(b.dataset.grade):state.grade.size===0)));}
  for(const grade of ['',...grades.slice().reverse()]){const b=make('button');b.type='button';b.dataset.grade=grade;i18n.attribute(b, 'aria-label', grade||'Any grade');b.append(grade?gradeNode(grade):make('span','Any'));b.onclick=()=>{if(!grade)state.grade.clear();else if(state.grade.has(grade))state.grade.delete(grade);else state.grade.add(grade);gradeSelection();change();usage('filter_first_used','grade');};gradeGroup.append(b);}gradeSelection();fields.append(gradeGroup);
  const selects=[['lamp','Combo',[['','Any'],...['FULL COMBO','FULL COMBO+','ALL PERFECT','ALL PERFECT+'].map(g=>[g,g])]],['sync','Sync',[['','Any'],['FS','Full sync'],['FS+','Full sync+'],['FSD','Full sync DX'],['FSD+','Full sync DX+'],['SYNC','Sync play']]]];
  for(const [key,title,options]of selects){
    const label=make('div',undefined,'player-badge-field'),caption=make('span',title),select=make('select'),button=make('button',undefined,'player-badge-select'),menu=make('div',undefined,'player-badge-menu');
    caption.id='personal-'+key+'-label';select.id='personal-'+key;select.hidden=true;select.tabIndex=-1;select.setAttribute('aria-hidden','true');
    for(const [value,text]of options)select.append(i18n.option(text,value));select.value=state[key];
    button.id=select.id+'-button';button.type='button';button.setAttribute('role','combobox');button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');button.setAttribute('aria-labelledby',caption.id+' '+select.id+'-value');
    menu.id=select.id+'-choices';menu.hidden=true;menu.setAttribute('role','listbox');i18n.attribute(menu,'aria-label',title);button.setAttribute('aria-controls',menu.id);
    function content(value,text){const n=make('span',undefined,'player-badge-choice');n.append(badges({lamp:key==='lamp'?value:'',sync:key==='sync'?value:''}));for(const icon of n.querySelectorAll('.player-icon'))icon.setAttribute('aria-hidden','true');n.append(make('span',text));return n;}
    const choices=options.map(([value,text])=>{const option=make('button');option.type='button';option.tabIndex=-1;option.dataset.value=value;option.setAttribute('role','option');option.append(content(value,text));option.onclick=()=>{select.value=value;select.dispatchEvent(new Event('change'));close(true);};menu.append(option);return option;});
    function render(){const [value,text]=options.find(([v])=>v===select.value)||options[0],current=content(value,text);current.id=select.id+'-value';button.replaceChildren(current);choices.forEach(n=>n.setAttribute('aria-selected',String(n.dataset.value===value)));}
    function close(focus=false){menu.hidden=true;button.setAttribute('aria-expanded','false');if(focus)button.focus();}
    function position(){
      if(menu.hidden)return;const r=button.getBoundingClientRect();if(r.bottom<0||r.top>innerHeight){close();return;}
      const width=Math.min(Math.max(r.width,190),innerWidth-16);menu.style.width=width+'px';menu.style.left=Math.max(8,Math.min(r.left,innerWidth-width-8))+'px';menu.style.maxHeight=Math.max(88,Math.min(300,Math.max(r.top,innerHeight-r.bottom)-16))+'px';
      const height=menu.getBoundingClientRect().height;menu.style.top=(r.bottom+height+8<=innerHeight?r.bottom+4:Math.max(8,r.top-height-4))+'px';
    }
    function open(){
      document.dispatchEvent(new CustomEvent('maimai-badge-open',{detail:menu.id}));menu.hidden=false;button.setAttribute('aria-expanded','true');position();
      (choices.find(n=>n.dataset.value===select.value)||choices[0]).focus({preventScroll:true});
    }
    button.onclick=()=>menu.hidden?open():close(true);
    button.onkeydown=e=>{if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();open();if(e.key==='Home')choices[0].focus();if(e.key==='End')choices.at(-1).focus();}};
    menu.onkeydown=e=>{let index=choices.indexOf(document.activeElement);if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);}else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();index=e.key==='Home'?0:e.key==='End'?choices.length-1:(index+(e.key==='ArrowDown'?1:-1)+choices.length)%choices.length;choices[index].focus();}else if(e.key==='Tab'){close(true);}};
    document.addEventListener('pointerdown',e=>{if(!menu.contains(e.target)&&!button.contains(e.target))close();});
    document.addEventListener('focusin',e=>{if(!menu.contains(e.target)&&e.target!==button)close();});
    document.addEventListener('maimai-badge-open',e=>{if(e.detail!==menu.id)close();});
    window.addEventListener('resize',position);window.addEventListener('scroll',e=>{if(e.target!==menu&&!menu.contains(e.target))position();},true);
    select.onchange=()=>{state[key]=select.value;usage('filter_first_used',key);change();};badgeSelectors.push(render);render();label.append(caption,select,button);fields.append(label);document.body.append(menu);
  }
  ranges=ports.playerRanges(fields,state,change,()=>catalog.catalog.map(chart=>record(chart)?.rate));subscribers.add(ranges.updateData);
  const clear=make('button','Clear');clear.type='button';clear.className='player-clear-filters';clear.classList.add('filter-disclosure-clear');i18n.attribute(clear,'aria-label','Clear personal filters');i18n.attribute(clear,'title','Clear personal filters');clear.onclick=()=>{usage('filters_reset','personal');for(const k in state)if(state[k] instanceof Set)state[k].clear();else state[k]='';root.querySelectorAll('select,input').forEach(n=>n.value='');gradeSelection();scopeSelection();change();};const actions=make('div',undefined,'filter-disclosure-actions'),empty=make('span','No filters selected','filter-empty'),chips=make('div',undefined,'active-filters');chips.setAttribute('role','group');i18n.attribute(chips,'aria-label','Active personal filters');actions.append(empty,chips,clear);summary();legend.after(actions);const toolbar=parent.querySelector('.sort-toolbar');if(toolbar)toolbar.before(root);else parent.append(root);root.hidden=!player.active||!visible;return {clear:()=>clear.click(),
    snapshot:()=>Object.fromEntries(Object.entries(state).map(([k,v])=>[k,v instanceof Set?[...v]:v])),
    sync:()=>{syncFields();for(const selector of badgeSelectors)selector();ranges?.sync();summary();},
    restore:saved=>{ports.browserState.restorePersonal(saved);
      syncFields();for(const selector of badgeSelectors)selector();ranges?.sync();summary();
    }};
}
personal=Object.freeze({subscribe:listener=>{subscribers.add(listener);return()=>subscribers.delete(listener);},configure,record,summary,details,matches,controls,lastPlayed,enabled:()=>!!player.active&&visible,gradeIndex:c=>{const r=record(c);return r&&grades.includes(r.grade)?grades.indexOf(r.grade):null;},ready});
})();

return personal;
}
