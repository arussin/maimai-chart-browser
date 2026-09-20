(() => {
  'use strict';
const i18n=window.maimaiI18n||{text:(node,value)=>node.textContent=value,attribute:(node,key,value)=>node.setAttribute(key,value),option:(...args)=>new Option(...args),literal:(node,value)=>node.textContent=value};

  // The configured return URL has no query/fragment and no analytics scripts.
  // Scrub unsolicited URL parameters as well; never trust them as payment evidence.
  history.replaceState(null, '', location.pathname);
  const client = window.maimaiSupportClient;
  const message = document.getElementById('support-return-status');
  const retry = document.getElementById('support-return-retry');
  const back = document.getElementById('support-return-continue');
  const value = client?.read();
  if (!value?.session) {
    i18n.text(message, 'We could not find this checkout in this tab. Check your receipt before making another payment.');
    return;
  }
  if (value.entry === 'support') back.href = '/support.html';
  let busy = false;
  async function check() {
    if (busy) return; busy = true; retry.hidden = true;
    i18n.text(message, 'Checking your checkout…');
    try {
      const {status} = await client.request('status', value);
      i18n.text(message, status === 'paid' ? client.config.thanks : status === 'pending' ?
        'Your payment is still processing. Please check again before making another payment.' : status === 'open' ?
          'Your checkout is unfinished. You can return to it or leave it for later.' :
          'This checkout has expired. You can return to choose an amount again.');
      retry.hidden = status !== 'pending';
      i18n.text(back, status === 'open' ? 'Return to checkout' : value.entry === 'support' ? 'Continue' : 'Back to maimai.party');
      // Main-page analytics, if already consented, can count a verified return once.
      back.onclick = () => { try { client.save({...value, resume: true}); } catch { /* Back still works. */ } };
    } catch {
      i18n.text(message, 'We could not confirm your payment yet. Check again before starting another payment.');
      retry.hidden = false;
    } finally { busy = false; }
  }
  retry.onclick = () => { void check(); }; void check();
})();
