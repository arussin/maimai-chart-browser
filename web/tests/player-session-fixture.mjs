import assert from 'node:assert/strict';
import {loadModule} from './module.mjs';
const {ImportCoordinator}=await loadModule('runtime/import-coordinator',{Error,DOMException,AbortController,structuredClone,btoa,atob});
export function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
export const dataset=(revision='one',capturedAt=100)=>({format:'maimai-player-data',schemaVersion:1,revision,player:{key:'kamaitachi:maimaidx:fixture',provider:'kamaitachi',game:'maimaidx',username:'fixture',displayName:'Fictional'},charts:{},records:{},plays:{},snapshots:{},captures:{},capturedAt});
const encode=data=>new TextEncoder().encode(JSON.stringify(data));
export const file=data=>{const bytes=encode(data);return {size:bytes.length,arrayBuffer:async()=>bytes.buffer};};
export function makeSession({initial=null,source=null,read=null}={}){
 const calls={begin:0,save:0,forget:0,finish:0,claim:0,events:[],messages:[],notifications:[],changed:0};
 const state={active:initial?{revision:initial.revision,bytes:encode(initial),source,lastImportedAt:10}:null,control:{epoch:0,version:0,lease:null}};
 const token=()=>({epoch:state.control.epoch,version:state.control.version,revision:state.active?.revision??null});
 const same=expected=>assert.deepEqual(JSON.parse(JSON.stringify(expected)),token());
 const values=new Map();
 const storage={
  read:async()=>{if(read)await read;return structuredClone({active:state.active,control:state.control,token:token()});},
  begin:async expected=>{same(expected);calls.begin++;state.control.version++;state.control.lease=null;return token();},
  verify:async expected=>{same(expected);return token();},
  save:async(value,expected,lease=null)=>{same(expected);if(lease)assert.equal(lease,state.control.lease.id);calls.save++;state.active=structuredClone(value);state.control.version++;state.control.lease=null;return token();},
  forget:async expected=>{if(expected)same(expected);calls.forget++;state.active=null;state.control.epoch++;state.control.version++;state.control.lease=null;return token();},
  clear:async()=>{const result=await storage.forget();state.control.clearedEpoch=result.epoch;return result;},
  claim:async expected=>{same(expected);calls.claim++;if(!state.active?.source)return null;const id='fixture-lease';state.control.lease={id,until:999999};return {id,active:structuredClone(state.active),token:token()};},
  finish:async(expected,id,patch)=>{same(expected);assert.equal(id,state.control.lease.id);calls.finish++;state.active.source={...state.active.source,...patch};state.control.lease=null;return structuredClone(state.active.source);},
 };
 const core={MAX_COMPRESSED:32*1024*1024,decode:async bytes=>JSON.parse(new TextDecoder().decode(bytes)),encode:async data=>encode(data),reconcile:async data=>data,merge:async(_old,data)=>data,current:()=>({pbs:new Map()}),
  offer:data=>({format:data.format,schemaVersion:1,revision:data.revision,player:data.player,capturedAt:data.capturedAt??100,pbCount:0,pbCoverage:'complete',playCount:0,snapshotIDs:[],captureIDs:[],historyCoverage:'retained-only'}),
  validateOffer:value=>value,needsUpdate:(data,offer)=>data.revision!==offer.revision,canonical:JSON.stringify,digest:async()=> 'fixture-merged'};
 const effects={changed:()=>{calls.changed++;},invalidate:()=>{},show:()=>{},hide:()=>{},loadedFailure:()=>{},ask:async()=>({accept:true,remember:true}),reading:()=>()=>{},message:(...args)=>calls.messages.push(args),recovery:url=>calls.messages.push(['recovery',url]),usage:(...args)=>calls.events.push(args),notify:(...args)=>calls.notifications.push(args),unmatched:()=>0};
 const sources={AUTO_INTERVAL:900000,reportURL:url=>({url,manifest:url+'/party/latest.json'}),validateSource:value=>value,readSource:async()=>({data:dataset('two',200),source:connection('two')})};
 const ports={core,sources,storage,maishift:{enrichRatings:async previous=>previous},temporary:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},key:name=>name,effects,refreshAllowed:()=>true,clock:()=>1000000};
 const owner=new ImportCoordinator(ports);
 return {owner,ports,calls,state,values,token};
}
export function connection(revision='one'){return {schemaVersion:1,type:'report',url:'https://fixture.invalid/public/party/latest.json',playerKey:'kamaitachi:maimaidx:fixture',adapterVersion:1,autoRefresh:true,generation:0,lastAttempt:0,lastChecked:0,lastSuccess:0,sourceUpdatedAt:100,sourceRevision:revision,retryAt:null};}

export async function supersededReadiness(){
 const load=deferred(),consent=deferred(),shown=deferred();
 const f=makeSession({read:load.promise});
 f.ports.effects.ask=()=>{shown.resolve();return consent.promise;};
 const old=f.owner.importFile(file(dataset('old')));f.owner.cancel();
 const current=f.owner.importFile(file(dataset('new')));load.resolve();
 await old;await shown.promise;
 assert.equal(f.calls.begin,1);assert.equal(f.owner.busy,true);assert.equal(f.calls.save,0);
 consent.resolve({accept:true,remember:true});await current;
 assert.equal(f.owner.active.revision,'new');assert.equal(f.state.active.revision,'new');assert.equal(f.owner.busy,false);
}
