// DOM-free loader contract. No browser, network, accounts or real corpus inputs.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {webcrypto,createHash}=require('node:crypto');
const shared=process.argv.includes('--shared');
const root=process.argv[2],loader=fs.readFileSync(path.join(__dirname,'fixtures/legacy-lab-loader.js'),'utf8');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function start(change=()=>{}){
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))),entry=manifest.releases[0];
  if(shared)entry.startup=entry.startup_shared;delete entry.startup_shared;
  const initial=JSON.parse(fs.readFileSync(path.join(root,entry.startup.path)));
  if(shared)entry.startup_shared=entry.startup;
  const assets=Object.fromEntries(Object.values(initial.detail_buckets).map(r=>[r.path,fs.readFileSync(path.join(root,r.path))]));
  const test={initial,entry,assets,manifest};change(test);
  const bytes=Buffer.from(JSON.stringify(initial)),sha=digest(bytes);
  entry.startup={path:`catalog-index/${sha}.json`,sha256:sha,bytes:bytes.length};
  assets[entry.startup.path]=bytes;if(shared)entry.startup_shared=entry.startup;
  const appended=[],requests=[],status={textContent:''};let active=0,maxActive=0;
  const scope={window:{},crypto:webcrypto,Uint8Array,TextDecoder,URL,URLSearchParams,
    location:{href:'https://example.test/?left=chart-id',search:'?left=chart-id'},history:{replaceState(){}},
    document:{getElementById(){return status;},createElement(){return {};},body:{append(e){appended.push(e);}}},
    fetch:async(name,options)=>{
      assert.deepEqual(JSON.parse(JSON.stringify(options)),{credentials:'omit',redirect:'error'});
      requests.push(name);active++;maxActive=Math.max(active,maxActive);
      await new Promise(resolve=>setTimeout(resolve,2));active--;
      const body=name==='manifest.json'?Buffer.from(JSON.stringify(manifest)):assets[name];
      return new Response(body||'missing',{status:body?200:404});
    }};
  await vm.runInNewContext(loader,scope);
  assert.equal(status.textContent,'');assert.equal(appended.length,1);
  assert.equal(appended[0].src,'challenge-review.js');
  assert.deepEqual(JSON.parse(JSON.stringify(scope.window.maimaiResearchCatalog)),initial);
  assert.deepEqual(requests,['manifest.json',entry.startup.path]);
  return {...test,requests,scope,api:scope.window.maimaiCatalogDetails,data:scope.window.maimaiResearchCatalog,maxActive:()=>maxActive};
}
function replaceShard(test,mutate){
  const chart=test.initial.catalog[0],bucket=chart.detail_bucket,ref=test.initial.detail_buckets[bucket];
  const value=JSON.parse(test.assets[ref.path]);mutate(value,chart);
  const bytes=Buffer.from(JSON.stringify(value)),sha=digest(bytes),name=`chart-details/${sha}.json`;
  test.assets[name]=bytes;test.initial.detail_buckets[bucket]={path:name,sha256:sha,bytes:bytes.length};
}
(async()=>{
  let run=await start(),chart=run.data.catalog[0];
  const one=run.api.ensure(chart),two=run.api.ensure(chart);assert.equal(one,two);
  await one;assert(run.api.ready(chart));assert(run.data.analysis.charts[chart.chart_id].segments.length);
  assert(Object.hasOwn(run.data.snippets,chart.chart_id));
  const count=run.requests.length;await run.api.ensure(chart);assert.equal(run.requests.length,count);
  await Promise.all(run.data.catalog.map(c=>run.api.ensure(c)));assert(run.maxActive()<=3);
  assert(!run.requests.some(name=>name.includes('chart-id')||name.includes('catalog-parts/')));
  for(const mutate of [
    ...(shared?[]:[value=>value.source_catalog_sha256='0'.repeat(64)]),
    (value,c)=>delete value.charts[c.chart_id],
    (value,c)=>value.identities[c.chart_id]='0'.repeat(64),
    value=>value.charts.unlisted={source_hash:'bad'},
    value=>value.snippets.unlisted={}
  ]){
    run=await start(test=>replaceShard(test,mutate));chart=run.data.catalog[0];
    await assert.rejects(run.api.ensure(chart));assert(!run.api.ready(chart));
    assert.equal(run.data.analysis.charts[chart.chart_id].segments.length,0);
    assert.equal(Object.keys(run.data.snippets).length,0);
  }
  run=await start();chart=run.data.catalog[0];
  const ref=run.initial.detail_buckets[chart.detail_bucket],saved=run.assets[ref.path];
  run.assets[ref.path]=Buffer.alloc(saved.length);
  await assert.rejects(run.api.ensure(chart));assert(!run.api.ready(chart));
  await new Promise(resolve=>setTimeout(resolve,0));run.assets[ref.path]=saved;
  await run.api.ensure(chart);assert(run.api.ready(chart));
  run=await start(test=>{test.initial.detail_buckets[test.initial.catalog[0].detail_bucket].path='https://example.org/private';});
  await assert.rejects(run.api.ensure(run.data.catalog[0]));assert.equal(run.requests.length,2);
  console.log('Progressive startup, identity, integrity, concurrency, cache and retry checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
