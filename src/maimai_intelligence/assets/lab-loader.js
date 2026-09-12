/* Versioned public research data only; retains the existing comparison interface. */
(async()=>{
  'use strict';
  const status=document.getElementById('lab-status');
  const maximum=32*1024*1024;
  const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
  async function read(path,limit){
    const response=await fetch(path,{credentials:'omit',redirect:'error'});
    if(!response.ok)throw new Error('Research catalog could not be loaded');
    const reader=response.body.getReader(),chunks=[];let size=0;
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new Error('Research catalog exceeds its size limit');}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const value of chunks){bytes.set(value,offset);offset+=value.length;}return bytes;
  }
  try{
    const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await read('manifest.json',1024*1024))),version=new URLSearchParams(location.search).get('version')||manifest.default;
    const entry=Array.isArray(manifest.releases)&&manifest.releases.find(r=>r.version===version);
    if(!['1.0.0','1.1.0'].includes(manifest.schema_version)||!entry||!/^[a-f0-9]{64}$/.test(entry.sha256)||entry.path!==`catalogs/${entry.sha256}.json`)throw new Error('This research catalog version is unavailable');
    let bytes;
    if(entry.parts!==undefined){
      if(manifest.schema_version!=='1.1.0'||!Array.isArray(entry.parts)||!entry.parts.length||entry.parts.length>8)throw new Error('Invalid catalog parts');
      let total=0;
      for(const p of entry.parts){if(!/^[a-f0-9]{64}$/.test(p.sha256)||p.path!==`catalog-parts/${p.sha256}.json`||!Number.isInteger(p.bytes)||p.bytes<1||p.bytes>8*1024*1024)throw new Error('Invalid catalog part');total+=p.bytes;}
      if(total>maximum)throw new Error('Research catalog exceeds 32 MiB');
      bytes=new Uint8Array(total);let offset=0;
      for(const p of entry.parts){const part=await read(p.path,p.bytes);if(part.length!==p.bytes||await hash(part)!==p.sha256)throw new Error('Catalog part integrity check failed');bytes.set(part,offset);offset+=part.length;}
    }else bytes=await read(entry.path,maximum);
    const sha=await hash(bytes);
    if(sha!==entry.sha256)throw new Error('Research catalog integrity check failed');
    const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    const pinned=new URL(location.href);pinned.searchParams.set('version',version);history.replaceState(null,'',pinned);
    const element=document.createElement('script');element.type='application/json';element.id='challenge-data';element.textContent=JSON.stringify(data);document.body.append(element);
    const script=document.createElement('script');script.src='challenge-review.js';script.onload=()=>{status.textContent='';if(version!==manifest.default){status.textContent='You are viewing an older catalog. ';const link=document.createElement('a'),latest=new URL(location.href);latest.searchParams.set('version',manifest.default);link.href=latest.href;link.textContent='Open the latest catalog';status.append(link);}};script.onerror=()=>{status.textContent='The research browser could not start.';};document.body.append(script);
  }catch(error){status.textContent=error.message;}
})();
