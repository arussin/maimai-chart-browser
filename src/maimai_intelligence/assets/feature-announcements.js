/* Local feature IDs survive ordinary deployments and are independent of scores. */
(()=>{'use strict';
if(document.getElementById('feature-announcement-replay'))return;
const i18n=window.maimaiI18n,settings=document.getElementById('settings-toggle'),menu=document.getElementById('settings-actions');if(!settings||!menu)return;
const registry=[{id:'player-import-sources-v1',enabled:()=>Object.values(window.maimaiPlayerSources.capabilities).every(Boolean),title:'Bring your scores to maimai.party',body:'Bring your Session Report or public Maishift scores into the chart browser. Choose Import player data to get started.'}];
const sessionSeen=new Set();let current=null,manual=false,readyToShow=document.readyState==='complete';
const bubble=document.createElement('aside');bubble.className='feature-announcement';bubble.hidden=true;bubble.setAttribute('role','region');bubble.setAttribute('aria-labelledby','feature-announcement-title');document.body.append(bubble);
function seen(id){if(sessionSeen.has(id))return true;try{if(localStorage.getItem('maimai-announcement:'+id)==='seen')return true;}catch{}try{return sessionStorage.getItem('maimai-announcement:'+id)==='seen';}catch{return false;}}
function mark(id){sessionSeen.add(id);try{localStorage.setItem('maimai-announcement:'+id,'seen');}catch{try{sessionStorage.setItem('maimai-announcement:'+id,'seen');}catch{}}}
function element(tag,text){const node=document.createElement(tag);i18n.text(node,text);return node;}
function close(){bubble.hidden=true;if(manual)settings.focus();}
function position(){const r=settings.getBoundingClientRect();bubble.style.top=Math.max(8,r.bottom+10)+'px';bubble.style.right=Math.max(8,innerWidth-r.right)+'px';bubble.style.maxHeight=Math.max(80,innerHeight-r.bottom-22)+'px';}
function show(item,replay=false){if(!readyToShow||!item.enabled()||document.visibilityState!=='visible'||document.querySelector('dialog[open]')||window.opener||!settings.getClientRects().length)return false;
  const bounds=settings.getBoundingClientRect();if(bounds.top<0||bounds.bottom>innerHeight||bounds.right<0||bounds.left>innerWidth)return false;
  current=item;manual=replay;const title=element('h2',item.title);title.id='feature-announcement-title';const body=element('p',item.body),actions=document.createElement('div');
  const start=element('button','Import data');start.type='button';start.onclick=()=>{close();document.getElementById('player-import')?.click();};
  const done=element('button','Got it');done.type='button';done.onclick=close;actions.append(start,done);
  for(const [label,url]of [['Session Report on GitHub','https://github.com/arussin/maimai-session-report'],['Maishift','https://maimai.shiftpsh.com/en']]){const link=element('a',label);link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.referrerPolicy='no-referrer';actions.append(link);}
  bubble.replaceChildren(title,body,actions);bubble.hidden=false;position();requestAnimationFrame(()=>requestAnimationFrame(()=>{if(current===item&&!bubble.hidden&&!document.querySelector('dialog[open]'))mark(item.id);}));if(replay)start.focus();return true;
}
const replay=element('button','What’s new');replay.id='feature-announcement-replay';replay.type='button';replay.setAttribute('role','menuitem');replay.tabIndex=-1;replay.hidden=!registry.some(item=>item.enabled());menu.insertBefore(replay,document.getElementById('site-share'));
replay.onclick=()=>{window.maimaiSettings?.close();const item=registry.find(item=>item.enabled());if(item)show(item,true);};
const attempt=()=>{if(current&&!bubble.hidden)return;const item=registry.find(item=>item.enabled()&&!seen(item.id));if(item)show(item);};
const observer=new MutationObserver(()=>{if(document.querySelector('dialog[open]'))close();attempt();});observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!bubble.hidden){close();event.preventDefault();}});
window.addEventListener('resize',()=>{position();attempt();});window.addEventListener('scroll',()=>{position();attempt();},{passive:true});document.addEventListener('visibilitychange',attempt);if(readyToShow)requestAnimationFrame(attempt);else window.addEventListener('load',()=>{readyToShow=true;requestAnimationFrame(attempt);},{once:true});
})();
