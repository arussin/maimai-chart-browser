import {VERSION,PAGES,validateRow,type Page,type UsageRow} from './usage-contract';
interface UsageAPI {emit:(event:string,page?:Page,detail?:string,failure?:string)=>void;flush:()=>Promise<void>;suspend:<T>(run:()=>T)=>T;disable:()=>void}
declare global {interface Window {maimaiUsage?:UsageAPI;maimaiUsageEnabled?:boolean}}
if(!window.maimaiUsage){
  let enabled=window.maimaiUsageEnabled!==false, suspended=0, page:Page='charts',timer:number|undefined;
  const queue=new Map<string,UsageRow>(),firstFilters=new Set<string>();
  const allowed=()=>enabled&&window.maimaiUsageEnabled!==false&&location.protocol==='https:'&&location.hostname==='maimai.party'&&
    !(navigator as Navigator&{globalPrivacyControl?:boolean}).globalPrivacyControl&&navigator.doNotTrack!=='1'&&
    (window as Window&{doNotTrack?:string}).doNotTrack!=='1'&&!(document as Document&{prerendering?:boolean}).prerendering;
  function emit(event:string,p:Page=page,detail='',failure=''){
    if(suspended||!allowed())return;
    const row=validateRow({event,page:p,detail,failure,count:1});if(!row)return;
    if(event==='filter_first_used'){if(firstFilters.has(detail))return;firstFilters.add(detail);}
    const key=[row.event,row.page,row.detail,row.failure].join('|'),existing=queue.get(key);
    if(existing){existing.count=Math.min(100,existing.count+1);}else if(queue.size<16)queue.set(key,row);
    if(queue.size&&!timer)timer=window.setTimeout(()=>{void flush();},10000);
  }
  async function flush(){
    if(timer){clearTimeout(timer);timer=undefined;}
    const rows=[...queue.values()];queue.clear();
    if(!allowed()||!rows.length)return;
    const body=JSON.stringify({version:VERSION,events:rows});
    if(new TextEncoder().encode(body).length>4096)return;
    try{await fetch('/__usage',{method:'POST',headers:{'Content-Type':'application/json'},body,
      credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',keepalive:true,signal:AbortSignal.timeout(5000)});}catch{/* Deliberately drop; never retry or log payloads. */}
  }
  window.maimaiUsage=Object.freeze({emit,flush,suspend:<T>(run:()=>T)=>{suspended++;try{return run();}finally{suspended--;}},
    disable:()=>{enabled=false;queue.clear();if(timer)clearTimeout(timer);timer=undefined;}});
  window.addEventListener('maimai:navigation',event=>{
    const next=(event as CustomEvent<{page:Page}>).detail?.page;if(!PAGES.includes(next))return;
    page=next;emit('page_view');
  });
  // Navigation owns initial activation. BFCache restoration is a new activation.
  window.addEventListener('pagehide',()=>{void flush();});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')void flush();});
}
