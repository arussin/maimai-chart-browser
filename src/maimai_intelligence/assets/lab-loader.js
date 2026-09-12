/* Versioned public research data only; retains the existing comparison interface. */
(async()=>{
  'use strict';
  const status=document.getElementById('lab-status');
  try{
    const manifestResponse=await fetch('manifest.json',{credentials:'omit',redirect:'error'});
    if(!manifestResponse.ok)throw new Error('Research manifest could not be loaded');
    const manifest=await manifestResponse.json(),version=new URLSearchParams(location.search).get('version')||manifest.default;
    const entry=manifest.releases.find(r=>r.version===version);
    if(manifest.schema_version!=='1.0.0'||!entry||!/^[a-f0-9]{64}$/.test(entry.sha256)||entry.path!==`catalogs/${entry.sha256}.json`)throw new Error('This research catalog version is unavailable');
    const response=await fetch(entry.path,{credentials:'omit',redirect:'error'});
    if(!response.ok)throw new Error('Research catalog could not be loaded');
    const reader=response.body.getReader(),chunks=[];let size=0;
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>32*1024*1024){await reader.cancel();throw new Error('Research catalog exceeds 32 MiB');}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const value of chunks){bytes.set(value,offset);offset+=value.length;}
    const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
    if(sha!==entry.sha256)throw new Error('Research catalog integrity check failed');
    const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    const pinned=new URL(location.href);pinned.searchParams.set('version',version);history.replaceState(null,'',pinned);
    const element=document.createElement('script');element.type='application/json';element.id='challenge-data';element.textContent=JSON.stringify(data);document.body.append(element);
    const script=document.createElement('script');script.src='challenge-review.js';script.onload=()=>{status.textContent='';};script.onerror=()=>{status.textContent='The research browser could not start.';};document.body.append(script);
  }catch(error){status.textContent=error.message;}
})();
