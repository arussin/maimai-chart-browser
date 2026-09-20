(() => {
  'use strict';
const i18n=window.maimaiI18n||{text:(node,value)=>node.textContent=value,attribute:(node,key,value)=>node.setAttribute(key,value),option:(...args)=>new Option(...args),literal:(node,value)=>node.textContent=value};

  history.replaceState(null, '', location.pathname);
  const status = document.getElementById('support-page-status');
  const opener = document.getElementById('support-open');
  if (opener?.dataset.checkoutReady !== 'stripe') {
    i18n.text(status, 'Support checkout is currently unavailable. Thank you for visiting maimai.party.');
    return;
  }
  status.hidden = true;
  // Navigation here follows a Support click. This isolated page loads no analytics
  // or player code, and never reads the originating report or a return URL.
  opener.click();
})();
