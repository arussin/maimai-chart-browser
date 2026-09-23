import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {parse} from 'acorn';
import {createPlayerMaishift} from '../src/views/player-maishift.js';
const assets=new URL('../../src/maimai_intelligence/assets/',import.meta.url);
function bundledFactory(name){
  const source=readFileSync(new URL(name,assets),'utf8');
  const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'}),factories=[];
  function visit(node){
    if(!node||typeof node!=='object')return;
    if(node.type==='FunctionDeclaration'&&node.params.length===1&&source.slice(node.start,node.end).includes('Maishift returned an unsupported response. Your saved data was kept.'))factories.push(node);
    for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);
  }
  visit(ast);
  // Execute the smallest enclosing factory verbatim from the shipped bytes.
  // No production test globals or substituted source modules are involved.
  factories.sort((a,b)=>(a.end-a.start)-(b.end-b.start));
  assert.ok(factories.length,name+' contains the Maishift implementation');
  const node=factories[0];
  return runInNewContext('('+source.slice(node.start,node.end)+')',{URL})({playerCore:{}});
}
const manifest=JSON.parse(readFileSync(new URL('browser-assets.json',assets),'utf8'));
const hosted=Object.keys(manifest.assets).find(name=>name.startsWith('browser/application-'));
assert.ok(hosted,'hosted application chunk is recorded');
const facade={URL};runInNewContext(readFileSync(new URL('player-maishift.js',assets),'utf8'),facade);
const subjects=[['maintained module',createPlayerMaishift({playerCore:{}})],['compatibility entry',facade.maimaiPlayerMaishift],['hosted bundle',bundledFactory(hosted)],['offline bundle',bundledFactory(manifest.entries.offline)]];
// VM objects have different prototypes; compare the public serialized contract.
const plain=value=>JSON.parse(JSON.stringify(value));
const origin='https://maimai.shiftpsh.com';
const locales=['en','ko','ja','zh-TW'];
const tabs=['','home','records','export','grinding','playlists','s_rating','stamp'];
const prefixes=[{path:'',region:null}];
for(const locale of locales){
  prefixes.push({path:locale+'/',region:null});
  for(const [hint,region] of [['intl','intl'],['na','intl'],['jp','jp']]){
    for(const separator of ['@','%40'])prefixes.push({path:locale+separator+hint+'/',region});
  }
}
const expected=(handle,region)=>({handle,region,url:origin+'/en'+(region==='auto'?'':'@'+region)+'/profile/'+handle+'/home'});
for(const [name,adapter]of subjects){
test(name+' preserves all 1856 production URL combinations',()=>{
  let count=0;
  for(const {path,region} of prefixes)for(const handle of ['fictional-player','MiXeD_09','0','x'.repeat(64)])for(const tab of tabs)for(const slash of ['','/']){
    const url=origin+'/'+path+'profile/'+handle+(tab?'/'+tab:'')+slash;
    assert.deepEqual(plain(adapter.location(url)),expected(handle,region||'auto'),url);
    assert.equal(adapter.regionFromURL(url),region,url);
    assert.deepEqual(plain(adapter.location(adapter.location(url).url)),expected(handle,region||'auto'),url);
    if(region){assert.throws(()=>adapter.location(url,region==='jp'?'intl':'jp'),/do not match/);}
    else for(const selected of ['auto','intl','jp'])assert.deepEqual(plain(adapter.location(url,selected)),expected(handle,selected),url);
    count++;
  }
  assert.equal(count,1856);
});
test(name+' rejects unsafe and unsupported locations without inferring region',()=>{
  const paths=['/fr/profile/fictional-player','/profile/fictional-player:1/home','/profile/fictional-player%3A1/home','/en%2540jp/profile/fictional-player','/profile/fictional%2fplayer','/profile/fictional-player/unknown','/profile/fictional-player/home/extra','/en//profile/fictional-player','/@jp/profile/fictional-player','/en@us/profile/fictional-player','/profile/한글'];
  for(const value of [...paths.map(path=>origin+path),origin+'/profile/fictional-player?private=fictional',origin+'/profile/fictional-player#private','http://maimai.shiftpsh.com/profile/fictional-player','https://user:password@maimai.shiftpsh.com/profile/fictional-player','https://maimai.shiftpsh.com:8443/profile/fictional-player','https://maimai.shiftpsh.com.evil.example/profile/fictional-player',null,undefined,42,{},[]]){
    assert.throws(()=>adapter.location(value),/public profile URL/);
    assert.equal(adapter.regionFromURL(value),null);
  }
});

}
