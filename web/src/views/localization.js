/** Existing DOM behavior with explicit module dependencies. */
export function createLocalization(ports) {
let localization;
/* Site-owned copy only. No DOM observer, network translation, or catalog mutation. */
(() => {
  'use strict';

  const catalogs = ports.configuration.messages;
  const languages = ['en', 'zh-Hans', 'ko', 'ja'];
  const names = {en: 'English', 'zh-Hans': '简体中文', ko: '한국어', ja: '日本語'};
  const key = 'maimai-language-v1';
  const readmeLinks = new Map();
  const verbatim = value => ({literal:String(value ?? '')});
  const parts = (values, separator) => ({parts:values, separator});
  const message = (source, values) => ({message:source, values});
  const sourceText = value => value && typeof value==='object' ? Object.hasOwn(value,'literal') ? value.literal : value.message ? value.message.replace(/\{(\d+)\}/g,(_,n)=>sourceText(value.values[n])) : value.parts.map(sourceText).join(value.separator) : String(value ?? '');
  const negotiate = values => {
    for (const value of values) {
      const language = String(value).toLowerCase();
      if (/^zh(?:-|$)/.test(language)) return 'zh-Hans';
      if (/^ko(?:-|$)/.test(language)) return 'ko';
      if (/^ja(?:-|$)/.test(language)) return 'ja';
      if (/^en(?:-|$)/.test(language)) return 'en';
    }
    return 'en';
  };
  let locale = negotiate(navigator.languages || [navigator.language]);
  try { const saved = localStorage.getItem(key); if (languages.includes(saved)) locale = saved; } catch {}
  // Explicit public route language wins without overwriting the user's saved preference.
  const routeLocale={en:'en',ja:'ja',ko:'ko','zh-hans':'zh-Hans'}[location.pathname.split('/')[1]];
  const linkedLocale=new URLSearchParams(location.search).get('lang');
  if(routeLocale)locale=routeLocale;else if(languages.includes(linkedLocale))locale=linkedLocale;
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = Object.keys(catalogs).filter(source => /\{\d+\}/.test(source)).map(source => {
    const parts = source.split(/(\{\d+\})/);
    return {source, indices: parts.filter(p => /^\{\d+\}$/.test(p)).map(p => Number(p.slice(1,-1))),
      expression: new RegExp('^' + parts.map(p => /^\{\d+\}$/.test(p) ? '(.*?)' : escape(p)).join('') + '$', 's'),
      specificity: source.replace(/\{\d+\}/g, '').length};
  }).sort((a,b) => b.specificity-a.specificity);
  function translate(value) {
    if(value && typeof value==='object' && Object.hasOwn(value,'literal')) return value.literal;
    if(value && typeof value==='object' && Object.hasOwn(value,'parts')) return value.parts.map(translate).join(translate(value.separator));
    if(value && typeof value==='object' && value.message) return (locale==='en' ? value.message : catalogs[value.message]?.[locale] || value.message).replace(/\{(\d+)\}/g,(_,n)=>translate(value.values[n]));
    const source = String(value ?? '');
    if (locale === 'en' || !source.trim()) return source;
    const leading=source.match(/^\s*/)[0], trailing=source.match(/\s*$/)[0], trimmed=source.trim();
    const exact = catalogs[trimmed];
    if (exact) return leading + exact[locale] + trailing;
    for (const pattern of patterns) {
      const match = pattern.expression.exec(trimmed);
      if (match) {
        const values = {};
        pattern.indices.forEach((index,i) => { values[index]=match[i+1]; });
        return leading + catalogs[pattern.source][locale].replace(/\{(\d+)\}/g, (_,n) =>
          catalogs[pattern.source].$translate?.includes(Number(n)) ? translate(values[n]) : values[n]) + trailing;
      }
    }
    return source;
  }
  // Weak references let discarded catalog rows and closed lessons be collected.
  const bindings = new Set(), registered = new WeakMap();
  function bind(node, slot, source, apply) {
    let slots = registered.get(node);
    if (!slots) { slots=new Map(); registered.set(node,slots); }
    let entry=slots.get(slot);
    if (!entry) { entry={node:new WeakRef(node), source, apply}; slots.set(slot,entry); bindings.add(entry); }
    entry.source=source; apply(node, translate(source));
  }
  function text(node, source) {
    const value=sourceText(source);
    if(node.childNodes.length===1 && node.firstChild.nodeType===Node.TEXT_NODE) node.firstChild.nodeValue=value;
    else node.textContent=value;
    // Bind the text node rather than its parent; labels may later receive an input.
    if (node.firstChild) bind(node.firstChild,'text',source,(target,value)=>{target.nodeValue=value;});
    return source;
  }
  const attributes = new Set(['title','aria-label','aria-valuetext','placeholder','alt']);
  function attribute(node,name,source) {
    if(attributes.has(name)) bind(node,name,source,(target,value)=>target.setAttribute(name,value));
    else node.setAttribute(name,source);
    return source;
  }
  function option(label,value,defaultSelected=false,selected=false) {
    const node=new Option('',value,defaultSelected,selected); text(node,label); return node;
  }
  // Explicit escape hatch for official names and user data, including words that
  // happen to equal a UI message (a song or player could be named "Close").
  function literal(node,source) { text(node,verbatim(source)); return source; }
  function original(node,attributeName) {
    const target=attributeName ? node : node.nodeType===Node.TEXT_NODE ? node : node.firstChild;
    const source=target && registered.get(target)?.get(attributeName || 'text')?.source;
    return source ?? (attributeName ? node.getAttribute(attributeName) : node.textContent);
  }
  function staticText(root) {
    const walk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    const nodes=[];
    while(walk.nextNode()) if(!walk.currentNode.parentElement?.closest('script,style,noscript,[data-i18n-literal]')) nodes.push(walk.currentNode);
    for(const node of nodes) if(!registered.has(node) && catalogs[node.nodeValue.trim()]) bind(node,'text',node.nodeValue,(target,value)=>{target.nodeValue=value;});
    for(const node of root.querySelectorAll('[title],[aria-label],[aria-valuetext],[placeholder],[alt]')) {
      if(node.closest('[data-i18n-literal]')) continue;
      for(const name of attributes) if(!registered.get(node)?.has(name) && node.hasAttribute(name) && catalogs[node.getAttribute(name).trim()]) attribute(node,name,node.getAttribute(name));
    }
  }
  function setLocale(next,{persist=true}={}) {
    if(!languages.includes(next)) return false;
    locale=next;
    if(persist) try { localStorage.setItem(key,next); } catch {}
    document.documentElement.lang=locale;
    document.documentElement.style.setProperty('--label-constant',JSON.stringify(translate('Constant')));
    document.documentElement.style.setProperty('--label-speed',JSON.stringify(translate('Inputs / s')));
    for(const entry of bindings) {
      const node=entry.node.deref();
      if(!node) bindings.delete(entry); else entry.apply(node,translate(entry.source));
    }
    for(const button of document.querySelectorAll('[data-language]')) button.setAttribute('aria-pressed',String(button.dataset.language===locale));
    for(const [link, english] of readmeLinks) link.setAttribute('href',locale==='en' ? english : english+'/blob/main/README.'+locale+'.md');
    window.dispatchEvent(new CustomEvent('maimai-language-change',{detail:locale}));
    return true;
  }
  // Unmodified Famfamfam PNGs by Mark James, bundled at build time.
  const flags=ports.configuration.flags;
  function controls(host) {
    const controls=document.createElement('div');controls.className='language-controls';controls.setAttribute('role','group');attribute(controls,'aria-label','Language');
    for(const language of languages) {
      const button=document.createElement('button');button.type='button';button.dataset.language=language;button.title=names[language];button.setAttribute('aria-label',names[language]);
      const icon=document.createElement('img');icon.src=flags[language];icon.alt='';icon.width=16;icon.height=11;icon.setAttribute('aria-hidden','true');
      button.append(icon);button.onclick=()=>setLocale(language);controls.append(button);
    }
    host.append(controls);
    for(const button of controls.querySelectorAll('[data-language]'))button.setAttribute('aria-pressed',String(button.dataset.language===locale));
    return controls;
  }
  function mount() {
    for(const link of document.querySelectorAll('a[data-localized-readme]')) readmeLinks.set(link,link.getAttribute('href'));
    staticText(document.body);
    const title=document.querySelector('head title');if(title && catalogs[title.textContent])text(title,title.textContent);
    const header=document.querySelector('[data-version-browser] .site-header') || document.querySelector('.site-header');
    controls(header || document.querySelector('main') || document.body);
    setLocale(locale,{persist:false});
  }
  const searchTerms=value=>[value,...languages.filter(l=>l!=='en').map(l=>catalogs[value]?.[l] || '')].join(' ');
  localization=Object.freeze({text,literal,verbatim,parts,message,original,attribute,option,translate,searchTerms,staticText,controls,setLocale,negotiate,get locale(){return locale;}});
  document.documentElement.lang=locale;
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',mount,{once:true}); else mount();
  window.addEventListener('storage',event=>{if(event.key===key && languages.includes(event.newValue)) setLocale(event.newValue,{persist:false});});
})();

return localization;
}
