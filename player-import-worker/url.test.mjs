import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import '../src/maimai_intelligence/assets/player-maishift.js';

const adapter=globalThis.maimaiPlayerMaishift;
const origin='https://maimai.shiftpsh.com';
const locales=['en','ko','ja','zh-TW'];
const tabs=['','home','records','export','grinding','playlists','s_rating','stamp'];
const prefixes=[{path:'',region:null}];
for(const locale of locales){
  prefixes.push({path:locale+'/',region:null});
  for(const [hint,region]of [['intl','intl'],['na','intl'],['jp','jp']]){
    for(const separator of ['@','%40'])prefixes.push({path:locale+separator+hint+'/',region});
  }
}
const url=(prefix,handle,tab='',slash='')=>origin+'/'+prefix+'profile/'+handle+(tab?'/'+tab:'')+slash;
const expected=(handle,region)=>({handle,region,url:origin+'/en'+(region==='auto'?'':'@'+region)+'/profile/'+handle+'/home'});

// All fixtures are fictional. Parsing never reads a live player's profile.
test('locale-less Korean copy links match their English and bare-handle equivalents',()=>{
  const handle='fictional-player';
  for(const tab of tabs){
    assert.deepEqual(adapter.location(url('',handle,tab)),adapter.location(handle));
    assert.deepEqual(adapter.location(url('',handle,tab)),adapter.location(url('en/',handle,tab)));
    assert.deepEqual(adapter.location(url('ko/',handle,tab)),adapter.location(handle));
  }
});

test('every supported locale, region encoding, profile tab and trailing slash canonicalizes consistently',()=>{
  for(const {path,region}of prefixes){
    for(const handle of ['fictional-player','MiXeD_09','0','x'.repeat(64)]){
      for(const tab of tabs){
        for(const slash of ['','/']){
          const value=url(path,handle,tab,slash),selected=region||'auto';
          assert.deepEqual(adapter.location(value),expected(handle,selected),value);
          assert.equal(adapter.regionFromURL(value),region,value);
          assert.deepEqual(adapter.location(adapter.location(value).url),expected(handle,selected),value);
          assert.deepEqual(adapter.location(' \n'+value+'\t '),expected(handle,selected),value);
        }
      }
    }
  }
});

test('locale-less and language-only URLs preserve selected region rather than infer it from language',()=>{
  for(const path of ['',...locales.map(locale=>locale+'/')]){
    for(const region of ['auto','intl','jp']){
      for(const tab of tabs){
        const value=url(path,'fictional-player',tab);
        assert.deepEqual(adapter.location(value,region),expected('fictional-player',region),value);
        assert.equal(adapter.regionFromURL(value),null,value);
      }
    }
  }
});

test('explicit region hints remain authoritative and conflicting selections fail closed',()=>{
  for(const {path,region}of prefixes.filter(p=>p.region)){
    for(const tab of tabs){
      const value=url(path,'fictional-player',tab);
      assert.deepEqual(adapter.location(value,region),expected('fictional-player',region),value);
      for(const other of ['auto',region==='jp'?'intl':'jp']){
        assert.throws(()=>adapter.location(value,other),/selected game region do not match/,value);
      }
    }
  }
});

test('host, protocol, credential, port, query and fragment restrictions are preserved',()=>{
  const invalid=[
    'https://evil.example/profile/fictional-player/home',
    'https://maimai.shiftpsh.com.evil.example/profile/fictional-player/home',
    'https://evil.maimai.shiftpsh.com/profile/fictional-player/home',
    'https://maimai.shiftpsh.com@evil.example/profile/fictional-player/home',
    'https://user:password@maimai.shiftpsh.com/profile/fictional-player/home',
    'https://user@maimai.shiftpsh.com/en%40jp/profile/fictional-player',
    'http://maimai.shiftpsh.com/profile/fictional-player/home',
    'ftp://maimai.shiftpsh.com/profile/fictional-player/home',
    'https://maimai.shiftpsh.com:8443/profile/fictional-player/home',
    '//maimai.shiftpsh.com/profile/fictional-player/home',
    'maimai.shiftpsh.com/profile/fictional-player/home',
    '/profile/fictional-player/home',
    url('','fictional-player','home')+'?foo=1',
    url('en%40jp/','fictional-player','records')+'?version=1',
    url('','fictional-player','home')+'#secret',
    url('ko%40na/','fictional-player','export')+'#fragment',
  ];
  for(const value of invalid){
    assert.throws(()=>adapter.location(value),/public profile URL/,value);
    assert.equal(adapter.regionFromURL(value),null,value);
  }
});

test('malformed paths, unsupported locales, historical overrides and encoded identities are rejected',()=>{
  const invalid=[
    '', ' ', 'fictional player', 'x'.repeat(65),
    '/profile/', '/profile//home', '/profile/fictional-player/unknown',
    '/profile/fictional-player/home/extra', '/profile/fictional-player//home',
    '/en//profile/fictional-player', '/en/ko/profile/fictional-player',
    '/fr/profile/fictional-player', '/zh-Hans/profile/fictional-player',
    '/@jp/profile/fictional-player', '/en@us/profile/fictional-player',
    '/en@/profile/fictional-player', '/en@jp@intl/profile/fictional-player',
    '/en%2540jp/profile/fictional-player', '/en%2f@jp/profile/fictional-player',
    '/en%40jp%2fprofile/fictional-player', '/profile/fictional-player:1/home',
    '/profile/fictional-player%3A1/home', '/profile/fictional%2fplayer/home',
    '/profile/%2e%2e/home', '/profile/fictional%40player/home',
    '/profile/fictional%00player/home', '/profile/fictional%20player/home',
    '/profile/fictional%25player/home', '/profile/fictional%ZZplayer/home',
    '/profile/fictional\\player/home', '/profile/한글/home',
    '/profile/'+('x'.repeat(65))+'/home',
  ];
  for(const input of invalid){
    const value=input.startsWith('/')?origin+input:input;
    assert.throws(()=>adapter.location(value),/public profile URL/,value);
    assert.equal(adapter.regionFromURL(value),null,value);
  }
  for(const value of [null,undefined,42,{},[]]){
    assert.throws(()=>adapter.location(value),/public profile URL/);
    assert.equal(adapter.regionFromURL(value),null);
  }
  for(const region of [null,'ko','na','ASIA','']){
    assert.throws(()=>adapter.location('fictional-player',region),/Choose the game region/);
  }
});

test('parsing requires no networking, redirects, storage, locale globals or player data',()=>{
  let sideEffects=0;
  const forbid=()=>{sideEffects++;throw new Error('Unexpected side effect');};
  const sandbox={URL,fetch:forbid,XMLHttpRequest:forbid};
  for(const name of ['localStorage','sessionStorage','navigator','document','location']){
    Object.defineProperty(sandbox,name,{get:forbid});
  }
  runInNewContext(readFileSync(new URL('../src/maimai_intelligence/assets/player-maishift.js',import.meta.url),'utf8'),sandbox);
  for(const {path,region}of prefixes){
    const value=url(path,'fictional-player','records');
    const parsed=sandbox.maimaiPlayerMaishift.location(value);
    assert.equal(JSON.stringify(parsed),JSON.stringify(expected('fictional-player',region||'auto')));
    assert.equal(sandbox.maimaiPlayerMaishift.regionFromURL(value),region);
  }
  assert.equal(sideEffects,0);
});
