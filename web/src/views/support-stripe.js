/** Existing DOM behavior with explicit module dependencies. */
export function createSupportStripe(ports) {
(() => {
  'use strict';
const i18n=ports.localization||{text:(node,value)=>node.textContent=value,attribute:(node,key,value)=>node.setAttribute(key,value),option:(...args)=>new Option(...args),literal:(node,value)=>node.textContent=value};

  const client = ports.supportClient, opener = document.getElementById('support-open');
  if (!client?.config.enabled || !opener || opener.dataset.checkoutReady ||
      typeof HTMLDialogElement === 'undefined' || !HTMLDialogElement.prototype.showModal) return;
  const {config, read, save, clear, request} = client;
  const element = (tag, className, text) => {
    const node = document.createElement(tag); node.className = className;
    if (text) i18n.text(node, text); return node;
  };
  const event = name => window.dispatchEvent(new CustomEvent('maimai:support', {detail: name}));
  const dialog = element('dialog', 'support-dialog support-stripe-dialog');
  dialog.dataset.stage = 'checkout';
  dialog.id = 'support-checkout-dialog'; dialog.setAttribute('aria-labelledby', 'support-dialog-title');
  const header = element('div', 'support-dialog-header');
  const title = element('h2', 'support-dialog-title', config.title); title.id = 'support-dialog-title';
  const brand = document.querySelector('.party-brand > span');
  if (brand) {
    title.replaceChildren(brand.cloneNode(true)); title.classList.add('party-brand');
    i18n.attribute(title, 'aria-label', config.title);
  }
  const close = element('button', 'support-dialog-close', '×'); close.type = 'button';
  i18n.attribute(close, 'aria-label', 'Close support checkout'); header.append(title, close);
  const body = element('div', 'support-stripe-body');
  const message = element('p', 'support-stripe-status'); message.setAttribute('role', 'status');
  const invitation = element('p', 'support-invitation', config.invitation);
  const mount = element('div', 'support-stripe-mount'); mount.id = 'support-stripe-mount';
  const retry = element('button', 'support-primary', 'Try again'); retry.type = 'button'; retry.hidden = true;
  const again = element('button', 'support-secondary', 'Start a new checkout'); again.type = 'button'; again.hidden = true;
  body.append(invitation, message, mount, retry, again);
  dialog.append(header, body); document.body.append(dialog);
  ports.localization?.controls(header);
  opener.dataset.checkoutReady = 'stripe'; opener.setAttribute('aria-haspopup', 'dialog');
  const provider = opener.parentElement.querySelector('.support-button-provider');
  if (provider) provider.hidden = false;
  opener.parentElement.hidden = false;
  opener.setAttribute('aria-controls', dialog.id);
  i18n.text(opener.querySelector('span:last-child'), config.title);
  let instance = null, generation = 0, busy = false, scriptPromise = null;
  const destroy = () => { instance?.destroy(); instance = null; mount.replaceChildren(); };
  function loadStripe() {
    if (window.Stripe) return Promise.resolve();
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise((resolve, reject) => {
      const script = element('script', ''); script.async = true;
      script.src = 'https://js.stripe.com/dahlia/stripe.js'; script.referrerPolicy = 'no-referrer';
      const fail = () => { clearTimeout(timer); script.remove(); scriptPromise = null;
        reject(new Error('Stripe could not load. Please try again.')); };
      const timer = setTimeout(fail, 15000);
      script.onerror = fail;
      script.onload = () => { clearTimeout(timer); if (window.Stripe) resolve(); else fail(); };
      document.head.append(script);
    });
    return scriptPromise;
  }
  function result(status, value) {
    if (status === 'open') return false;
    dialog.dataset.stage = 'result';
    destroy(); invitation.hidden = true; retry.hidden = true; again.hidden = status === 'pending';
    if (status === 'paid') {
      i18n.text(message, config.thanks);
      i18n.text(again, 'Support again');
      if (!value.successTracked) { value.successTracked = true; save(value); event('support_success_return'); }
    } else if (status === 'pending') {
      i18n.text(message, 'Your payment is still processing. Please check its status before trying another payment.');
      i18n.text(retry, 'Check payment status'); retry.hidden = false;
    } else {
      i18n.text(message, 'This checkout has expired. You can start a new checkout.');
      i18n.text(again, 'Start a new checkout');
    }
    return true;
  }
  function errorMessage(error) {
    const safeMessages = ['Please wait a minute and try again.', 'Checkout is unavailable. Please try again.',
      'Stripe could not load. Please try again.',
      'Checkout is taking too long. Try again to resume the same payment.'];
    return error?.name === 'QuotaExceededError' || error?.name === 'SecurityError' ?
      'Checkout needs temporary storage in this tab to return safely from a wallet. Please allow it and try again.' :
      error?.name === 'TimeoutError' || error?.name === 'AbortError' ?
        'Checkout is taking too long. Try again to resume the same payment.' :
        error instanceof TypeError ? 'Checkout could not connect. Try again to resume the same payment.' :
          safeMessages.includes(error?.message) ? error.message : 'Checkout could not start. Try again to resume the same payment.';
  }
  async function start() {
    if (busy) return;
    let value = read();
    if (!value) value = {attempt: crypto.randomUUID(), created: Date.now(),
      entry: /^\/support(?:\.html)?$/.test(location.pathname) ? 'support' : 'site'};
    const token = ++generation;
    dialog.dataset.stage = 'checkout';
    busy = true; invitation.hidden = false; retry.hidden = true; again.hidden = true;
    destroy(); i18n.text(message, value.session ? 'Checking your checkout…' : 'Opening secure checkout…');
    try {
      save(value);
      if (value.session) {
        const checked = await request('status', value);
        if (token !== generation) return;
        if (result(checked.status, value)) return;
      }
      await loadStripe(); if (token !== generation) return;
      const data = await request('checkout', value); if (token !== generation) return;
      if (!/^cs_(test|live)_[a-zA-Z0-9]{10,200}$/.test(data.session)) throw new Error('Invalid checkout response.');
      value.session = data.session; save(value);
      if (result(data.status, value)) return;
      if (typeof data.clientSecret !== 'string') throw new Error('Invalid checkout response.');
      let abandoned = false, initializationTimer;
      const initializing = window.Stripe(config.publishableKey).createEmbeddedCheckoutPage({
        fetchClientSecret: async () => data.clientSecret,
        onComplete: () => {
          if (abandoned || token !== generation) return;
          // A client callback is not proof of payment: retrieve paid status on the server.
          busy = false; void start();
        },
      }).then(checkout => {
        if (abandoned || token !== generation) { checkout.destroy(); return null; }
        return checkout;
      });
      let checkout;
      try {
        checkout = await Promise.race([initializing, new Promise((_, reject) => {
          initializationTimer = setTimeout(() => { abandoned = true;
            reject(new Error('Checkout is taking too long. Try again to resume the same payment.'));
          }, 20000);
        })]);
      } finally { clearTimeout(initializationTimer); }
      if (!checkout) return;
      if (token !== generation) { checkout.destroy(); return; }
      instance = checkout; checkout.mount(mount); i18n.text(message, '');
      if (!value.startedTracked) { value.startedTracked = true; save(value); event('support_checkout_started'); }
    } catch (error) {
      if (token !== generation) return;
      destroy(); dialog.dataset.stage = 'result'; i18n.text(message, errorMessage(error));
      i18n.text(retry, 'Try again'); retry.hidden = false;
    } finally { if (token === generation) busy = false; }
  }
  function open() {
    if (dialog.open) return;
    dialog.showModal(); document.body.classList.add('support-dialog-open'); close.focus();
    event('support_opened');
    void start();
  }
  retry.onclick = () => { void start(); };
  again.onclick = () => { clear(); close.focus(); void start(); };
  opener.addEventListener('click', e => {
    if (e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault(); open();
  });
  close.onclick = () => dialog.close();
  dialog.addEventListener('click', e => { if (e.target === dialog) {
    const box = dialog.getBoundingClientRect();
    if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) dialog.close();
  } });
  dialog.addEventListener('close', () => {
    generation++; busy = false; destroy(); document.body.classList.remove('support-dialog-open'); opener.focus();
  });
  // Only an explicit return-page action resumes automatically. Ordinary reloads wait for a click.
  const returning = read();
  if (config.returnHash && location.hash === config.returnHash) {
    ports.historyPort.replaceState(null, '', location.pathname + location.search);
    if (returning?.session) { returning.resume = true; save(returning); }
  }
  if (returning?.resume) { delete returning.resume; save(returning); open(); }
})();

return undefined;
}
