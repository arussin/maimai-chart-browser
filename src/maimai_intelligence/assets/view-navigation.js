/* Static About content and navigation are available before the catalog arrives. */
(()=>{'use strict';
const i18n=window.maimaiI18n||{text:(node,value)=>node.textContent=value,attribute:(node,key,value)=>node.setAttribute(key,value),option:(...args)=>new Option(...args),literal:(node,value)=>node.textContent=value};

if(window.maimaiViews)return;
const names=['catalog','patterns','compare','about'],labels={catalog:'charts',patterns:'pattern dictionary',compare:'comparison',about:'about'};
function show(name,preservePattern=false){
  if(!names.includes(name))return;
  for(const id of names){document.getElementById(id).hidden=id!==name;document.getElementById(id+'-tab').setAttribute('aria-pressed',String(id===name));}
  const skip=document.querySelector('.skip-link');skip.href='#'+name;i18n.text(skip, 'Skip to '+labels[name]);
  const url=new URL(location.href);url.searchParams.set('view',name);if(!preservePattern)url.searchParams.delete('pattern');history.replaceState(history.state,'',url);
  window.dispatchEvent(new Event('maimai:viewchange'));
}
window.maimaiViews=Object.freeze({show});
for(const name of names)document.getElementById(name+'-tab').onclick=()=>show(name);
const requested=new URLSearchParams(location.search).get('view');
show(location.hash==='#privacy'?'about':names.includes(requested)?requested:'catalog',true);
if(location.hash==='#privacy')document.getElementById('privacy').open=true;
})();
