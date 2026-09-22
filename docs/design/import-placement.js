/* Local design mockup; uses the real UI with public catalog/artwork only. */
(()=>{'use strict';
  document.getElementById('maishift-browser-pilot')?.remove();
  document.getElementById('player-import-header')?.remove();
  document.querySelector('.site-header')?.classList.remove('has-player-import');
  const heading=document.querySelector('#catalog>.page-heading'),total=heading?.querySelector('.catalog-total');
  if(!heading||!total)return;
  const actions=document.createElement('div');actions.className='catalog-heading-actions';
  const button=document.createElement('button');button.id='player-import-primary';button.className='player-import-primary';button.type='button';button.setAttribute('aria-haspopup','dialog');
  button.innerHTML='<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/></svg>';
  const text=document.createElement('span');maimaiI18n.text(text,'Import player data');button.append(text);
  button.onclick=()=>document.getElementById('player-import')?.click();
  actions.append(button);heading.append(actions);
  const count=document.getElementById('catalog-count');
  const toolbar=document.querySelector('.sort-toolbar');
  if(count&&toolbar)toolbar.insertBefore(count,document.getElementById('sort-rules'));
  function simplifyCount(){
    if(!count||count.querySelector('strong'))return;
    const match=/^([\d.,\u00a0\u202f]+) charts found$/.exec(maimaiI18n.original(count));
    if(!match)return;
    const number=document.createElement('strong'),label=document.createElement('span');
    number.textContent=match[1];maimaiI18n.text(label,'charts');
    count.replaceChildren(number,document.createTextNode(' '),label);
  }
  // A mockup-only adapter follows the real filtered count without changing the
  // published renderer. The selected design will render this markup directly.
  if(count)new MutationObserver(simplifyCount).observe(count,{childList:true,characterData:true,subtree:true});
  simplifyCount();
})();
