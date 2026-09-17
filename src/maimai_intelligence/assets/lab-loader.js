/* Versioned public research data only; retains the existing comparison interface. */
(async()=>{
  'use strict';
  const status=document.getElementById('lab-status');
  const maximum=32*1024*1024;
  const catalogMaximum=64*1024*1024;
  const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
  async function read(path,limit){
    const response=await fetch(path,{credentials:'omit',redirect:'error'});
    if(!response.ok)throw new Error('Research catalog could not be loaded');
    const reader=response.body.getReader(),chunks=[];let size=0;
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new Error('Research catalog exceeds its size limit');}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const value of chunks){bytes.set(value,offset);offset+=value.length;}return bytes;
  }
  async function verified(record,folder,limit=maximum){
    if(!record||!/^[a-f0-9]{64}$/.test(record.sha256)||record.path!==`${folder}/${record.sha256}.json`||!Number.isInteger(record.bytes)||record.bytes<1||record.bytes>limit)throw new Error('Invalid public data reference');
    const bytes=await read(record.path,record.bytes);
    if(bytes.length!==record.bytes||await hash(bytes)!==record.sha256)throw new Error('Public data integrity check failed');
    return bytes;
  }
  function details(data,sourceHash){
    const charts=new Map(data.catalog.map(c=>[c.chart_id,c])),loaded=new Set(),jobs=new Map(),queue=[];
    let active=0;
    async function fetchBucket(bucket){
      const raw=await verified(data.detail_buckets[bucket],'chart-details',8*1024*1024);
      const detail=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
      if(detail.schema_version!==(data.index_schema_version==='catalog-index-2'?'chart-details-2':'chart-details-1')||detail.source_catalog_sha256!==sourceHash)throw new Error('Chart details belong to another catalog');
      const expected=[...charts.values()].filter(c=>c.detail_bucket===bucket);
      if(!detail.identities||Object.keys(detail.identities).length!==expected.length||expected.some(c=>detail.identities[c.chart_id]!==c.source_hash))throw new Error('Chart detail identity mismatch');
      for(const [id,record]of Object.entries(detail.charts||{}))if(charts.get(id)?.detail_bucket!==bucket||record.source_hash!==charts.get(id).source_hash)throw new Error('Chart detail identity mismatch');
      for(const id of Object.keys(detail.snippets||{}))if(charts.get(id)?.detail_bucket!==bucket)throw new Error('Passage identity mismatch');
      for(const c of expected)if(data.analysis?.charts?.[c.chart_id]&&!detail.charts?.[c.chart_id])throw new Error('Chart evidence is missing');
      // Publish a whole verified shard together; a failed request can be retried.
      if(data.analysis)Object.assign(data.analysis.charts,detail.charts);
      Object.assign(data.snippets,detail.snippets);
      loaded.add(bucket);
    }
    function pump(){while(active<3&&queue.length){const job=queue.shift();active++;job.started=true;fetchBucket(job.bucket).then(job.resolve,job.reject).finally(()=>{active--;jobs.delete(job.bucket);pump();});}}
    function ensure(chart,priority=false){
      const bucket=charts.get(chart.chart_id)?.detail_bucket;
      if(!bucket||!Object.hasOwn(data.detail_buckets,bucket))return Promise.reject(new Error('Chart details are unavailable'));
      if(loaded.has(bucket))return Promise.resolve();
      let job=jobs.get(bucket);
      if(job){if(priority&&!job.started){queue.splice(queue.indexOf(job),1);queue.unshift(job);}return job.promise;}
      job={bucket};job.promise=new Promise((resolve,reject)=>Object.assign(job,{resolve,reject}));jobs.set(bucket,job);
      if(priority)queue.unshift(job);else queue.push(job);pump();return job.promise;
    }
    return Object.freeze({ensure,ready:chart=>!chart.detail_bucket||loaded.has(chart.detail_bucket)});
  }
  try{
    const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await read('manifest.json',1024*1024))),version=new URLSearchParams(location.search).get('version')||manifest.default;
    const entry=Array.isArray(manifest.releases)&&manifest.releases.find(r=>r.version===version);
    if(!['1.0.0','1.1.0','1.2.0','1.3.0'].includes(manifest.schema_version)||!entry||!/^[a-f0-9]{64}$/.test(entry.sha256)||entry.path!==`catalogs/${entry.sha256}.json`)throw new Error('This research catalog version is unavailable');
    let bytes;
    if(entry.startup!==undefined){
      if(!['1.2.0','1.3.0'].includes(manifest.schema_version))throw new Error('Unsupported browsing index');
      bytes=await verified(entry.startup,'catalog-index');
    }else if(entry.parts!==undefined){
      if(!['1.1.0','1.2.0','1.3.0'].includes(manifest.schema_version)||!Array.isArray(entry.parts)||!entry.parts.length||entry.parts.length>8)throw new Error('Invalid catalog parts');
      let total=0;
      for(const p of entry.parts){if(!/^[a-f0-9]{64}$/.test(p.sha256)||p.path!==`catalog-parts/${p.sha256}.json`||!Number.isInteger(p.bytes)||p.bytes<1||p.bytes>8*1024*1024)throw new Error('Invalid catalog part');total+=p.bytes;}
      if(total>catalogMaximum)throw new Error('Full research catalog exceeds 64 MiB');
      bytes=new Uint8Array(total);let offset=0;
      // Two bounded reads overlap network latency without fetching every part at once.
      for(let i=0;i<entry.parts.length;i+=2){
        const batch=await Promise.all(entry.parts.slice(i,i+2).map(async p=>{const part=await read(p.path,p.bytes);if(part.length!==p.bytes||await hash(part)!==p.sha256)throw new Error('Catalog part integrity check failed');return part;}));
        for(const part of batch){bytes.set(part,offset);offset+=part.length;}
      }
    }else bytes=await read(entry.path,catalogMaximum);
    // Startup bytes were already verified against their own manifest digest.
    if(!entry.startup&&await hash(bytes)!==entry.sha256)throw new Error('Research catalog integrity check failed');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),data=JSON.parse(text);
    if(entry.inventory_schema&&data.schema_version!==entry.inventory_schema)throw new Error('Inventory schema mismatch');
    if(entry.startup){
      if(entry.inventory_schema&&data.index_schema_version!=='catalog-index-2')throw new Error('Unsupported inventory index');
      if(data.source_catalog_sha256!==entry.sha256||!Array.isArray(data.catalog)||!data.detail_buckets||Object.keys(data.detail_buckets).length>1024)throw new Error('Invalid browsing index');
      window.maimaiCatalogDetails=details(data,entry.sha256);
    }
    const pinned=new URL(location.href);pinned.searchParams.set('version',version);history.replaceState(null,'',pinned);
    // Public catalog only. All interface modules share this one parsed object.
    window.maimaiResearchCatalog=data;
    window.maimaiPersonal?.configure(data,data.provider_mapping);
    const element=document.createElement('script');element.type='application/json';element.id='challenge-data';element.textContent=text;document.body.append(element);
    const script=document.createElement('script');script.src='challenge-review.js';script.onload=()=>{status.textContent='';if(version!==manifest.default){status.textContent='You are viewing an older catalog. ';const link=document.createElement('a'),latest=new URL(location.href);latest.searchParams.set('version',manifest.default);link.href=latest.href;link.textContent='Open the latest catalog';status.append(link);}};script.onerror=()=>{status.textContent='The research browser could not start.';};document.body.append(script);
  }catch(error){status.textContent=error.message;}
})();
