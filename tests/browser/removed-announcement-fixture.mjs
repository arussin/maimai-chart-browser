// The retired preference must remain inert, including when storage is unavailable.
export async function observeRetiredAnnouncements(page, {seen=false,deny=false,modal=false}={}) {
  await page.addInitScript(({seen,deny,modal})=>{
    const key='maimai-announcement:player-import-sources-v1';
    const get=Storage.prototype.getItem,set=Storage.prototype.setItem;
    if(seen)for(const storage of [localStorage,sessionStorage])set.call(storage,key,'seen');
    const accesses=[];
    for(const method of ['getItem','setItem','removeItem']){
      const original=Storage.prototype[method];
      Storage.prototype[method]=function(key,...args){
        if(String(key).startsWith('maimai-announcement:')){
          accesses.push(method);
          if(deny)throw new DOMException('Storage unavailable','SecurityError');
        }
        return original.call(this,key,...args);
      };
    }
    window.retiredAnnouncementState=()=>({accesses:[...accesses],local:get.call(localStorage,key),session:get.call(sessionStorage,key)});
    if(modal)document.addEventListener('DOMContentLoaded',()=>{
      const dialog=document.createElement('dialog');dialog.id='blocking-fixture';dialog.textContent='Fixture';document.body.append(dialog);dialog.showModal();
    },{once:true});
  },{seen,deny,modal});
}

export function retiredAnnouncementState(page) {
  return page.evaluate(()=>window.retiredAnnouncementState());
}
