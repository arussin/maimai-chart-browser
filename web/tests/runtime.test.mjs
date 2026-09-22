import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {loadModule} from './module.mjs';
const {IntentScope}=await loadModule('runtime/intent',{AbortController});
const sorting=await loadModule('runtime/browser-state');
const data=await loadModule('runtime/verified-data',{crypto:webcrypto,TextDecoder,Uint8Array,Error,URL,fetch:async()=>{throw Error('Use an explicit fixture reader');}});
test('only the latest navigation intention has permission to commit',()=>{
 const owner=new IntentScope(),song=owner.start();assert.equal(song.current(),true);owner.cancel();assert.equal(song.current(),false);assert.equal(song.signal.aborted,true);
 const version=owner.start(),newer=owner.start();assert.equal(version.current(),false);assert.equal(newer.current(),true);
});
test('personal readiness changes effective sorting without rewriting the requested settings',()=>{
 const requested=sorting.restoreSortRules([{key:'rating',direction:-1}]);
 assert.equal(JSON.stringify(sorting.effectiveSortRules(requested,false)),'[{"key":"title","direction":1}]');
 assert.equal(JSON.stringify(requested),'[{"key":"rating","direction":-1}]');
 assert.equal(JSON.stringify(sorting.effectiveSortRules(requested,true)),JSON.stringify(requested));
 assert.equal(JSON.stringify(sorting.restoreSortRules([{key:'PRIVATE',direction:1}])),'[{"key":"title","direction":1}]');
});
test('multipart references enforce per-part, aggregate, path and count bounds',()=>{
 const hash='a'.repeat(64),part={path:'catalog-index-parts/'+hash+'.json',sha256:hash,bytes:8*1024*1024};
 const ref={sha256:hash,bytes:part.bytes*4,parts:[part,part,part,part]};
 assert.equal(data.multipartReference(ref,'catalog-index-parts',32*1024*1024,4).parts.length,4);
 for(const changed of [{...ref,bytes:1},{...ref,parts:[...ref.parts,part]},{...ref,parts:[{...part,path:'../private.json'}]}])assert.throws(()=>data.multipartReference(changed,'catalog-index-parts',32*1024*1024,4));
});
test('one verified reader bounds concurrency to two and verifies every part plus aggregate',async()=>{
 const parts=[new TextEncoder().encode('one'),new TextEncoder().encode('two'),new TextEncoder().encode('three')];
 const descriptors=await Promise.all(parts.map(async bytes=>{const sha256=await data.sha256(bytes);return {path:'catalog-index-parts/'+sha256+'.json',sha256,bytes:bytes.length};}));
 const all=Buffer.concat(parts),ref={sha256:await data.sha256(all),bytes:all.length,parts:descriptors};
 const reader=new data.PublicReader(new URL('http://127.0.0.1/'));let active=0,maximum=0;
 reader.read=async path=>{active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return parts[descriptors.findIndex(part=>part.path===path)];};
 assert.equal(new TextDecoder().decode(await reader.verified(ref)),'onetwothree');assert.equal(maximum,2);
 await assert.rejects(()=>reader.verified({...ref,sha256:'b'.repeat(64)}),/integrity/);
 reader.read=async()=>new Uint8Array([0]);await assert.rejects(()=>reader.verified(ref),/integrity/);
});

test('a completed reader slot starts the next part without waiting for its slower sibling',async()=>{
 const parts=['one','two','three'].map(value=>new TextEncoder().encode(value));
 const descriptors=await Promise.all(parts.map(async bytes=>{const sha256=await data.sha256(bytes);return {path:'catalog-index-parts/'+sha256+'.json',sha256,bytes:bytes.length};}));
 const all=Buffer.concat(parts),ref={sha256:await data.sha256(all),bytes:all.length,parts:descriptors};
 const reader=new data.PublicReader(new URL('http://127.0.0.1/'));
 let releaseFirst,startedThird,active=0,maximum=0,timer;
 const first=new Promise(resolve=>{releaseFirst=resolve;}),third=new Promise(resolve=>{startedThird=resolve;});
 reader.read=async path=>{
  const index=descriptors.findIndex(part=>part.path===path);active++;maximum=Math.max(maximum,active);
  if(index===0)await first;
  if(index===2)startedThird(true);
  active--;return parts[index];
 };
 const result=reader.verified(ref);
 try{
  assert.equal(await Promise.race([third,new Promise(resolve=>{timer=setTimeout(()=>resolve(false),1000);})]),true);
 }finally{clearTimeout(timer);releaseFirst();}
 assert.equal(new TextDecoder().decode(await result),'onetwothree');assert.equal(maximum,2);
});

// The coordinator's original readiness invariant now exercises the real import transaction.
import {supersededReadiness} from './player-session-fixture.mjs';
test('superseded readiness cannot acquire a storage lease or commit an import',supersededReadiness);

const {loadCatalog}=await loadModule('runtime/catalog',{crypto:webcrypto,TextDecoder,Uint8Array,Error,URL});
test('verified details hydrate a disposable evidence view without mutating canonical index data',async()=>{
 const encode=value=>new TextEncoder().encode(JSON.stringify(value)),source='a'.repeat(64);
 const detail=encode({schema_version:'chart-details-shared-1',identities:{c:'s'},charts:{c:{source_hash:'s',measured:true}},snippets:{c:{passages:[]}}});
 const detailHash=await data.sha256(detail);
 const index=encode({schema_version:'maimai-browser-catalog-2',index_schema_version:'catalog-index-shared-1',source_catalog_sha256:source,catalog:[{chart_id:'c',source_hash:'s',detail_bucket:'b'}],detail_buckets:{b:{path:'chart-details/'+detailHash+'.json',sha256:detailHash,bytes:detail.length}},analysis:{charts:{c:{source_hash:'s'}}},snippets:{}});
 const indexHash=await data.sha256(index),entry={version:'v',path:'catalogs/'+source+'.json',sha256:source,inventory_schema:'maimai-browser-catalog-2',startup_shared:{path:'catalog-index/'+indexHash+'.json',sha256:indexHash,bytes:index.length}};
 const files=new Map([['manifest.json',encode({schema_version:'1.3.0',default:'v',releases:[entry]})],[entry.startup_shared.path,index],['chart-details/'+detailHash+'.json',detail]]);
 const reader=new data.PublicReader(new URL('http://127.0.0.1/'));reader.read=async path=>files.get(path);
 const loaded=await loadCatalog(reader,null),before=JSON.stringify(loaded.canonical);
 await loaded.details.ensure(loaded.data.catalog[0]);
 assert.equal(loaded.data.analysis.charts.c.measured,true);assert.equal(JSON.stringify(loaded.canonical),before);assert.equal(loaded.details.ready(loaded.data.catalog[0]),true);
});

function mountedState() {
 const state=new sorting.BrowserState(),calls=[];
 state.configure({catalog:[{chart_id:'a'},{chart_id:'b'}],source_catalog_sha256:'catalog',navigation:{versions:['v1','v2']}});
 state.configureLevels(['BASIC','MASTER'],[12,12.5,13]);state.configurePatterns(['slide']);
 let locale='en';
 state.bind({readTransient:()=>({locale,scroll:[0,320],focus:'search',auxiliary:{sortKeep:true,patternSearch:'s',menus:[['pattern-filter',false]]}}),
  writeControls:value=>calls.push(['controls',value]),render:()=>calls.push(['render']),writeDisclosures:value=>calls.push(['disclosures',value]),
  position:{cancel:()=>calls.push(['cancel']),restore:value=>calls.push(['position',value])},
  openRoute:()=>calls.push(['open']),versionChanged:()=>calls.push(['version']),
  localization:{get locale(){return locale;},setLocale:value=>{locale=value;calls.push(['locale',value]);}},usage:{suspend:fn=>{calls.push(['silent']);return fn();}}});
 return {state,calls};
}

test('one public state owner restores allowlisted controls and validates catalog identity',()=>{
 const {state,calls}=mountedState(),personal=state.personal,comparison=state.comparison,levels=state.level;
 const input={...state.capture(),locale:'ja',search:'Song',sortRules:[{key:'rating',direction:-1}],versions:['v2','private'],
  chartFilters:{difficulties:['MASTER','invalid'],low:12.5,high:13},patterns:['slide','unknown'],
  personal:{recorded:'yes',grade:['SSS+','invalid'],rateMin:'250',pbs:[{secret:true}],sourceURL:'private'},
  region:{availability:'INTL',international:false},comparison:{left:'a',right:'unknown'},expandedRows:['b','private'],
  selectedCharts:[['a','b'],['private','b']],history:['saved-pbs-a','private'],sections:{chart:false,player:true},
  disclosures:[['player-filters-toggle','true'],['private','true']],privateData:'never forwarded'};
 assert.equal(state.restore(input),true);
 assert.equal(state.personal,personal);assert.equal(state.comparison,comparison);assert.equal(state.level,levels);
 assert.equal(state.disclosure('player-filters-toggle').expanded,true);assert.equal(state.search,'Song');assert.equal(state.level.low,1);assert.equal(state.level.high,2);
 assert.equal([...state.personal.grade].join(','),'SSS+');assert.equal([...state.patterns].join(','),'slide');
 assert.equal([...state.selectedVersions].join(','),'v2');assert.equal(state.comparison.left,'a');assert.equal(state.comparison.right,null);
 const committed=calls.findLast(row=>row[0]==='position')[1],serialized=JSON.stringify(committed);
 assert.equal(serialized.includes('private'),false);assert.equal(serialized.includes('sourceURL'),false);assert.equal(Object.hasOwn(committed.personal,'pbs'),false);
 assert.equal(committed.personal.rateMin,'250');assert.deepEqual(JSON.parse(JSON.stringify(committed.disclosures)),[['player-filters-toggle','true']]);
 assert.equal(calls.map(row=>row[0]).join(','),'cancel,silent,locale,controls,render,disclosures,position');
 const before=JSON.stringify(state.capture());assert.equal(state.restore({...input,catalogHash:'different'}),false);assert.equal(JSON.stringify(state.capture()),before);
});

test('state snapshots exclude private records and preserve requested personal sorts across readiness',()=>{
 const {state,calls}=mountedState();state.restorePersonal({grade:['S'],recorded:'yes',pbs:[{achievement:100}],connection:'secret'});
 state.changeSort('rating',false);const snapshot=state.capture();
 assert.equal(JSON.stringify(sorting.effectiveSortRules(state.sortRules,false)),'[{"key":"title","direction":1}]');
 assert.equal(state.restore(snapshot),true);assert.equal(JSON.stringify(state.sortRules),'[{"key":"rating","direction":-1}]');
 assert.equal(JSON.stringify(snapshot).includes('achievement'),false);assert.equal(JSON.stringify(snapshot).includes('secret'),false);
 state.open();assert.deepEqual(calls.slice(-2).map(row=>row[0]),['cancel','open']);
 assert.equal(state.version('unknown'),false);assert.equal(state.version('v2'),true);assert.equal([...state.selectedVersions].join(','),'v2');
});
