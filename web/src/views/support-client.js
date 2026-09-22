/** Existing DOM behavior with explicit module dependencies. */
export function createSupportClient(ports) {
let supportClient;
/* Payment-only state shared with the return page. Never reads player storage or URLs. */
(() => {
  'use strict';

  const config = ports.supportConfig;
  if (!config || (location.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(location.hostname)) || location.origin !== config.origin ||
      !/^pk_(test|live)_[A-Za-z0-9]+$/.test(config.publishableKey)) return;
  const key = 'support.checkout.v2.' + config.project;
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  const clear = () => { try { sessionStorage.removeItem(key); } catch { /* No state. */ } };
  const save = value => {
    // Redirect methods need this tab's state; do not start a payment if it cannot persist.
    sessionStorage.setItem(key, JSON.stringify(value));
  };
  const read = () => {
    try {
      const value = JSON.parse(sessionStorage.getItem(key));
      if (!value || !uuid.test(value.attempt) ||
          (value.entry !== undefined && !['site', 'support'].includes(value.entry)) ||
          !Number.isFinite(value.created) || value.created > Date.now() ||
          Date.now() - value.created > 23 * 3600000 ||
          (value.session && !/^cs_(test|live)_[a-zA-Z0-9]{10,200}$/.test(value.session))) return null;
      return value;
    } catch { return null; }
  };
  async function request(action, value) {
    const response = await fetch((config.apiOrigin || '') + '/api/support/' + action, {method: 'POST',
      headers: {'Content-Type': 'application/json'}, credentials: 'omit', cache: 'no-store',
      referrerPolicy: 'no-referrer', redirect: 'error', signal: AbortSignal.timeout(20000),
      body: JSON.stringify({project: config.project, attempt: value.attempt,
        ...(value.session ? {session: value.session} : {})})});
    if (!response.ok) throw new Error(response.status === 429 ? 'Please wait a minute and try again.' :
      'Checkout is unavailable. Please try again.');
    const data = await response.json();
    if (!['open', 'paid', 'pending', 'expired'].includes(data.status)) throw new Error('Invalid checkout response.');
    return data;
  }
  supportClient = Object.freeze({config, read, save, clear, request});
})();

return supportClient;
}
