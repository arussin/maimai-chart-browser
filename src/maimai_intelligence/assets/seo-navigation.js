/* Public routes and local browsing history. No state object crosses the usage boundary. */
(()=>{'use strict';
if(window.maimaiSongPages)return;
const songPagesEnabled=!!document.querySelector('meta[name=maimai-song-pages][content="1"],main[data-seo-page]');
const allowed=new Set(['charts','patterns','compare','about','song','version']);
const routePattern=/^\/(en|ja|ko|zh-hans)\/(songs|versions)\/[^/]+\/$/;
const labels={en:['Open song page','Back to results'],ja:['楽曲ページを開く','検索結果に戻る'],ko:['곡 페이지 열기','검색 결과로 돌아가기'],'zh-hans':['打开歌曲页面','返回搜索结果']};
let ledgerPromise,routeView=null,browserMain=null,originalTitle=document.title,originalLanguage=document.documentElement.lang,pending=null,lastActivation=null,bfcacheKey=null,restoring=false;
const metadataSelector='link[rel=canonical],link[rel=alternate][hreflang],meta[name=description],meta[property^="og:"],meta[name^="twitter:"]';
let originalMetadata=[...document.head.querySelectorAll(metadataSelector)].map(node=>node.cloneNode());
function replaceMetadata(nodes){for(const node of document.head.querySelectorAll(metadataSelector))node.remove();for(const node of nodes)document.head.append(node.cloneNode());}
const locale=()=>({ 'zh-Hans':'zh-hans' }[window.maimaiI18n?.locale]||window.maimaiI18n?.locale||document.documentElement.lang||'en');
function pageType(){if(location.hash==='#privacy')return 'about';const route=routePattern.exec(location.pathname);if(route)return route[2]==='songs'?'song':'version';return {catalog:'charts',patterns:'patterns',compare:'compare',about:'about'}[new URLSearchParams(location.search).get('view')]||'charts';}
function activate(force=false){const page=pageType(),key=location.pathname+'|'+page;if(restoring||document.prerendering||!allowed.has(page)||!force&&lastActivation===key)return;lastActivation=key;window.dispatchEvent(new CustomEvent('maimai:navigation',{detail:{page}}));}
function withRestore(run){restoring=true;try{return window.maimaiUsage?.suspend?window.maimaiUsage.suspend(run):run();}finally{restoring=false;}}
function asset(path){return routePattern.test(location.pathname)?new URL(path,location.origin+'/').href:path;}
function updateRegional(root,enabled){for(const node of root.querySelectorAll('[data-seo-jp-src]'))node.src=enabled?node.dataset.seoIntlSrc:node.dataset.seoJpSrc;for(const node of root.querySelectorAll('[data-seo-jp-visible]'))node.hidden=(enabled?node.dataset.seoIntlVisible:node.dataset.seoJpVisible)!=='true';for(const node of root.querySelectorAll('[data-seo-jp]'))node.textContent=enabled?node.dataset.seoIntl:node.dataset.seoJp;const check=root.querySelector('[data-seo-international]');if(check)check.checked=enabled;}
function bindRegional(root){const check=root.querySelector('[data-seo-international]');if(check)check.onchange=()=>{updateRegional(root,check.checked);history.replaceState({...history.state,maimaiInternational:check.checked},'',location.href);if(!restoring)window.maimaiUsage?.emit('filter_first_used',undefined,'international');};updateRegional(root,history.state?.maimaiInternational===true);}
async function bounded(response,maximum){if(!response.ok)throw new Error('Public page unavailable');const reader=response.body.getReader(),chunks=[];let count=0;for(;;){const {done,value}=await reader.read();if(done)break;count+=value.length;if(count>maximum){await reader.cancel();throw new Error('Public page exceeds its limit');}chunks.push(value);}const output=new Uint8Array(count);let offset=0;for(const c of chunks){output.set(c,offset);offset+=c.length;}return new TextDecoder('utf-8',{fatal:true}).decode(output);}
async function read(path,signal){return bounded(await fetch(path,{credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',signal}),2*1024*1024);}
function ledger(){return ledgerPromise??=read('/permalinks.json').then(JSON.parse).catch(error=>{ledgerPromise=null;throw error;});}
function link(songID,chartID){const node=document.createElement('a');node.hidden=true;node.dataset.songPage='';node.id='song-page-'+chartID;node.className='chart-song-page';node.textContent=labels[locale()]?.[0]||labels.en[0];if(!songPagesEnabled)return node;ledger().then(map=>{let id=songID;const seen=new Set();while(map.redirects?.[id]){if(seen.has(id))return;seen.add(id);id=map.redirects[id];}const slug=map.songs?.[id];if(typeof slug!=='string'||!slug||/[/?#\\]/.test(slug))return;node.href='/'+locale()+'/songs/'+encodeURIComponent(slug)+'/';node.hidden=false;}).catch(()=>{});return node;}
function saveBrowser(focus=null){if(!window.maimaiBrowserState)return null;const snapshot=window.maimaiBrowserState.capture();if(focus)snapshot.focus=focus;history.replaceState({...history.state,maimaiBrowserState:snapshot,maimaiBrowserURL:location.href},'',location.href);return {url:location.href,snapshot};}
function rootMain(){return document.querySelector('main:not([data-seo-page])');}
function showBrowser(snapshot){if(routeView)routeView.hidden=true;if(browserMain)browserMain.hidden=false;document.title=originalTitle;document.documentElement.lang=snapshot?.locale||window.maimaiI18n?.locale||originalLanguage;replaceMetadata(originalMetadata);if(snapshot)withRestore(()=>window.maimaiBrowserState?.restore(snapshot));}
async function showRoute(url,{push=false,returnTo=null,browserState=null}={}){
  if(!routePattern.test(url.pathname)||url.origin!==location.origin)return false;
  pending?.abort();const controller=new AbortController();pending=controller;
  try{
    const parsed=new DOMParser().parseFromString(await read(url.pathname,controller.signal),'text/html');
    const content=parsed.querySelector('main[data-seo-page]');if(!content)throw new Error('Public page unavailable');
    if(controller!==pending)return false;
    browserMain??=rootMain();if(!browserMain)return false;
    if(!routeView){routeView=document.createElement('section');routeView.id='seo-route-view';routeView.tabIndex=-1;browserMain.after(routeView);const style=document.createElement('link');style.rel='stylesheet';style.href='/seo-pages.css';document.head.append(style);}
    bfcacheKey=null;
    if(push){const international=browserState?.region?.international??history.state?.maimaiInternational??(returnTo?.snapshot?.region?.international===true);history.pushState({maimaiReturn:returnTo,maimaiInternational:international,...(browserState?{maimaiBrowserState:browserState}:{})},'',url.pathname);}
    routeView.replaceChildren(document.importNode(content,true));routeView.hidden=false;browserMain.hidden=true;
    document.title=parsed.title;document.documentElement.lang=parsed.documentElement.lang;replaceMetadata(parsed.head.querySelectorAll(metadataSelector));bindRegional(routeView);if(content.dataset.seoPage==='version'){routeView.hidden=true;browserMain.hidden=false;withRestore(()=>{if(history.state?.maimaiBrowserState)window.maimaiBrowserState.restore(history.state.maimaiBrowserState);else window.maimaiBrowserState.version(content.querySelector('[data-seo-version]').dataset.seoVersion);});if(!history.state?.maimaiBrowserState)document.getElementById('catalog-tab')?.focus({preventScroll:true});}else routeView.focus({preventScroll:true});if(window.maimaiI18n&&window.maimaiI18n.locale!==parsed.documentElement.lang)withRestore(()=>window.maimaiI18n.setLocale(parsed.documentElement.lang,{persist:false}));document.documentElement.lang=parsed.documentElement.lang;if(!(content.dataset.seoPage==='version'&&history.state?.maimaiBrowserState))scrollTo(0,0);activate();return true;
  }catch(error){if(error.name!=='AbortError'){if(push)location.assign(url.href);else location.replace(url.href);}return false;}
}
function openBrowserTarget(){const language=new URLSearchParams(location.search).get('lang');if(language)window.maimaiI18n?.setLocale(language,{persist:false});window.maimaiBrowserState.open();history.replaceState({...history.state,maimaiOpenBrowser:false,maimaiBrowserState:window.maimaiBrowserState.capture()},'',location.href);}
function returnToBrowser(target=null){const state=history.state?.maimaiReturn;if(!browserMain||!window.maimaiBrowserState){if(state?.snapshot){history.pushState({maimaiBrowserState:state.snapshot,maimaiOpenBrowser:!!target},'',target||state.url||'/');location.reload();return true;}return false;}pending?.abort();
  bfcacheKey=null;const destination=target||state?.url||'/';history.pushState({maimaiBrowserState:state?.snapshot||null,maimaiOpenBrowser:!!target},'',destination);if(!target&&routePattern.exec(new URL(destination,location.href).pathname)?.[2]==='versions'){showRoute(new URL(destination,location.href));return true;}showBrowser(state?.snapshot);if(target)withRestore(openBrowserTarget);activate();return true;
}
document.addEventListener('click',event=>{
  const anchor=event.target.closest('a');if(!anchor||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey||anchor.target&&anchor.target!=='_self')return;
  const url=new URL(anchor.href,location.href);if(url.origin!==location.origin)return;
  if(anchor.hasAttribute('data-back-results')){if(returnToBrowser()){event.preventDefault();}return;}
  if(anchor.hasAttribute('data-open-browser')){if(returnToBrowser(url.href)){event.preventDefault();}return;}
  if(anchor.hasAttribute('data-song-page')&&routePattern.test(url.pathname)){if(window.maimaiBrowserState){event.preventDefault();const source=routeView&&!routeView.hidden?history.state?.maimaiReturn:saveBrowser(anchor.id);showRoute(url,{push:true,returnTo:source});}else if(history.state?.maimaiReturn||typeof history.state?.maimaiInternational==='boolean'){event.preventDefault();history.pushState({...history.state},'',url.pathname);location.reload();}}
});
window.addEventListener('popstate',()=>{
  if(bfcacheKey===location.href){bfcacheKey=null;return;}
  if(routePattern.test(location.pathname)&&window.maimaiBrowserState)showRoute(new URL(location.href));
  else if(window.maimaiBrowserState){pending?.abort();showBrowser(history.state?.maimaiBrowserState);activate(true);}
});
document.addEventListener('prerenderingchange',()=>activate(true),{once:true});
window.addEventListener('pageshow',event=>{if(event.persisted){bfcacheKey=location.href;activate(true);}});
window.addEventListener('maimai:viewchange',()=>{const tab=new URLSearchParams(location.search).get('view');if(routeView&&!routeView.hidden||window.maimaiBrowserState&&routePattern.exec(location.pathname)?.[2]==='versions'&&tab&&tab!=='catalog'){history.replaceState(history.state,'','/?view='+new URLSearchParams(location.search).get('view'));showBrowser();}activate();});
window.addEventListener('maimai-language-change',()=>{for(const node of document.querySelectorAll('a.chart-song-page')){const match=routePattern.exec(new URL(node.href,location.href).pathname);if(match){const url=new URL(node.href);url.pathname=url.pathname.replace('/'+match[1]+'/', '/'+locale()+'/');node.href=url.href;node.textContent=labels[locale()]?.[0]||labels.en[0];}}const match=routePattern.exec(location.pathname);if(!restoring&&window.maimaiBrowserState&&match&&match[1]!==locale()){const url=new URL(location.href);url.pathname=url.pathname.replace('/'+match[1]+'/', '/'+locale()+'/');const source=history.state?.maimaiReturn||saveBrowser(),browserState=match[2]==='versions'?window.maimaiBrowserState.capture():null;showRoute(url,{push:true,returnTo:source,browserState});}});
window.addEventListener('maimai:browser-ready',()=>{
  browserMain??=rootMain();if(!document.querySelector('main[data-seo-page]')){originalTitle=document.title;originalLanguage=document.documentElement.lang;}
  const restore=history.state?.maimaiBrowserState||history.state?.maimaiReturn?.snapshot;
  if(restore)withRestore(()=>window.maimaiBrowserState.restore(restore));
  const selected=new URLSearchParams(location.search).get('release')||document.querySelector('[data-seo-version]')?.dataset.seoVersion;
  if(selected&&!restore)withRestore(()=>window.maimaiBrowserState.version(selected));
  if(history.state?.maimaiOpenBrowser)withRestore(openBrowserTarget);
  if(routePattern.exec(location.pathname)?.[2]==='songs')showRoute(new URL(location.href));
  activate();
});
async function enhanceVersion(){
  const staticPage=document.querySelector('main[data-seo-page="version"]');if(!staticPage||window.maimaiBrowserState)return;
  try{
    const parsed=new DOMParser().parseFromString(await read('/'),'text/html'),wrapper=document.createElement('div');wrapper.dataset.versionBrowser='';wrapper.hidden=true;
    originalTitle=parsed.title;originalMetadata=[...parsed.head.querySelectorAll(metadataSelector)].map(node=>node.cloneNode());
    for(const child of [...parsed.body.children])if(child.tagName!=='SCRIPT')wrapper.append(document.importNode(child,true));
    // Inline data scripts are public catalog definitions; never execute inline code.
    for(const script of parsed.querySelectorAll('script[type="application/json"]'))wrapper.append(document.importNode(script,true));
    for(const node of wrapper.querySelectorAll('[src],[href]'))for(const attribute of ['src','href']){const value=node.getAttribute(attribute);if(value&&!value.startsWith('#'))node.setAttribute(attribute,new URL(value,location.origin+'/').href);}
    document.body.append(wrapper);
    for(const sheet of parsed.querySelectorAll('link[rel="stylesheet"]')){const url=new URL(sheet.getAttribute('href'),location.origin+'/');if([...document.querySelectorAll('link[rel=stylesheet]')].some(node=>{const existing=new URL(node.href);return existing.origin===url.origin&&existing.pathname===url.pathname;}))continue;const copy=sheet.cloneNode();copy.href=url.href;document.head.append(copy);}
    window.addEventListener('maimai:browser-ready',()=>{staticPage.hidden=true;document.documentElement.classList.remove('seo-static');document.querySelector('body>.site-header')?.setAttribute('hidden','');wrapper.hidden=false;},{once:true});
    for(const script of parsed.querySelectorAll('script[src]')){
      const path=new URL(script.getAttribute('src'),location.origin+'/');if(path.origin!==location.origin)continue;
      if(['usage.js','seo-navigation.js'].includes(path.pathname.split('/').at(-1)))continue;
      await new Promise((resolve,reject)=>{const node=document.createElement('script');node.src=path.href;node.onload=resolve;node.onerror=reject;document.body.append(node);});
    }
  }catch{/* Static song links and browser action remain usable. */}
}
window.maimaiSongPages=Object.freeze({link,asset,ready:()=>ledgerPromise?.catch(()=>null)||Promise.resolve(),get restoring(){return restoring;}});
for(const root of document.querySelectorAll('main[data-seo-page]'))bindRegional(root);
activate();
if(document.querySelector('main[data-seo-page="version"]'))enhanceVersion();
})();