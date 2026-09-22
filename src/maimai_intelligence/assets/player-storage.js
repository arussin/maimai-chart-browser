/* Dataset, connection and source-free invalidation state share one transaction.
 * Upgrade the DB so old, still-open releases cannot recreate a forgotten
 * connection through their version-1 write path. Portable datasets stay v1. */
(()=>{'use strict';
if(globalThis.maimaiPlayerStorage)return;
const conflict=()=>new Error('Player data changed in another tab. Reload before importing again.');
const databaseName=globalThis.maimaiPlayerContext?.key('maimai-player-data')||'maimai-player-data';
function db(){return new Promise((resolve,reject)=>{const q=indexedDB.open(databaseName,2);q.onupgradeneeded=()=>{if(!q.result.objectStoreNames.contains('datasets'))q.result.createObjectStore('datasets');};q.onsuccess=()=>{q.result.onversionchange=()=>q.result.close();resolve(q.result);};q.onerror=()=>reject(new Error('Device storage is unavailable.'));q.onblocked=()=>reject(new Error('Close other maimai.party tabs to update device storage.'));});}
const defaults=()=>({epoch:0,version:0,lease:null});
const token=(active,control)=>({revision:active?.revision??null,epoch:control.epoch,version:control.version});
function matches(expected,active,control){return expected&&expected.revision===(active?.revision??null)&&expected.epoch===control.epoch&&expected.version===control.version;}
async function transaction(mode,run){
  const database=await db();try{return await new Promise((resolve,reject)=>{
    const t=database.transaction('datasets',mode),store=t.objectStore('datasets');let result,error;
    const a=store.get('active'),c=store.get('control');let count=0;
    const ready=()=>{if(++count!==2)return;try{result=run(a.result??null,c.result??defaults(),store);}catch(e){error=e;t.abort();}};
    a.onsuccess=ready;c.onsuccess=ready;t.oncomplete=()=>resolve(result);t.onerror=()=>{};t.onabort=()=>reject(error||new Error('Device storage could not be updated. Nothing was replaced.'));
  });}finally{database.close();}
}
async function read(){return transaction('readonly',(active,control)=>({active,control,token:token(active,control)}));}
async function begin(expected){return transaction('readwrite',(active,control,store)=>{
  if(!matches(expected,active,control))throw conflict();control.version++;control.lease=null;store.put(control,'control');return token(active,control);
});}
async function verify(expected){return transaction('readonly',(active,control)=>{if(!matches(expected,active,control))throw conflict();return token(active,control);});}
async function save(value,expected,leaseID=null){return transaction('readwrite',(active,control,store)=>{
  if(!matches(expected,active,control)||leaseID&&control.lease?.id!==leaseID)throw conflict();
  control.version++;control.lease=null;
  if(value.source)value.source={...value.source,generation:control.version};
  store.put(value,'active');store.put(control,'control');return token(value,control);
});}
async function forget(expected=null,clear=false){return transaction('readwrite',(active,control,store)=>{
  if(expected&&!matches(expected,active,control))throw conflict();
  control.epoch++;control.version++;control.lease=null;if(clear)control.clearedEpoch=control.epoch;store.delete('active');store.put(control,'control');return token(null,control);
});}
const clear=()=>forget(null,true);
async function claim(expected,manual,now=Date.now()){return transaction('readwrite',(active,control,store)=>{
  if(!matches(expected,active,control))throw conflict();const source=active?.source;
  if(!source?.autoRefresh)return null;
  if(control.lease&&control.lease.until>now||source.retryAt>now||now-(source.lastAttempt??0)<(manual?30000:900000))return null;
  const id=crypto.randomUUID();control.lease={id,until:now+60000};active.source={...source,lastAttempt:now};store.put(control,'control');store.put(active,'active');return {id,active,token:token(active,control)};
});}
async function finish(expected,id,patch){return transaction('readwrite',(active,control,store)=>{
  if(!matches(expected,active,control)||control.lease?.id!==id)throw conflict();
  active.source={...active.source,...patch};control.lease=null;store.put(active,'active');store.put(control,'control');return active.source;
});}
globalThis.maimaiPlayerStorage=Object.freeze({read,begin,verify,save,forget,clear,claim,finish});
})();
