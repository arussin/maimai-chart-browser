/* Basic GA4 collection for the published site only. No application data is read. */
(() => {
  'use strict';
  const measurementId = 'G-FP9V9NF63J';
  const hosts = ['maimai.party', 'www.maimai.party'];
  if (location.protocol !== 'https:' || !hosts.includes(location.hostname)) return;
  const settings = document.getElementById('analytics-settings');
  const notice = document.getElementById('analytics-notice');
  const dialog = document.getElementById('analytics-dialog');
  if (!settings || !notice || !dialog) return;

  const storageKey = 'maimai.party.analytics.v1';
  const choiceLifetime = 180 * 86400 * 1000;
  const optOut = 'ga-disable-' + measurementId;
  const labels = {catalog: 'Charts', patterns: 'Pattern dictionary', compare: 'Compare charts', about: 'About'};
  const research = !!document.getElementById('catalog-tab');
  let active = false, started = false, lastView = null;
  const privacySignal = () => navigator.globalPrivacyControl === true || navigator.doNotTrack === '1';
  const readChoice = () => {
    try {
      const record = JSON.parse(localStorage.getItem(storageKey));
      return record && ['granted', 'denied'].includes(record.choice) &&
        Number.isFinite(record.expires) && record.expires > Date.now() ? record.choice : null;
    } catch { return null; }
  };
  const currentView = () => {
    if (!research) return 'catalog';
    const requested = new URLSearchParams(location.search).get('view');
    return Object.hasOwn(labels, requested) ? requested : 'catalog';
  };
  const pageFields = () => {
    const view = currentView();
    // Fixed virtual pages: never send the real URL, referrer, query, hash or DOM title.
    return {page_location: 'https://maimai.party/' + (view === 'catalog' ? 'charts' : view),
      page_title: 'maimai.party · ' + labels[view], page_referrer: ''};
  };
  function tag() { window.dataLayer.push(arguments); }
  function trackView() {
    if (!active || privacySignal()) return;
    const page = pageFields();
    if (lastView === page.page_location) return;
    lastView = page.page_location;
    tag('set', page);
    tag('event', 'page_view', {...page, send_to: measurementId});
  }
  function start() {
    if (privacySignal() || active) return;
    active = true; window[optOut] = false;
    if (!started) {
      started = true;
      window.dataLayer = window.dataLayer || [];
      // Basic consent mode: the Google tag does not exist before an opt-in.
      tag('consent', 'default', {analytics_storage: 'granted', ad_storage: 'denied',
        ad_user_data: 'denied', ad_personalization: 'denied'});
      tag('set', {allow_google_signals: false, allow_ad_personalization_signals: false,
        ads_data_redaction: true, url_passthrough: false, ...pageFields(),
        campaign_id: '', campaign_source: '', campaign_medium: '', campaign_name: '',
        campaign_term: '', campaign_content: ''});
      tag('js', new Date());
      tag('config', measurementId, {send_page_view: false, cookie_domain: location.hostname,
        cookie_path: '/', cookie_expires: 90 * 86400, cookie_update: false,
        cookie_flags: 'SameSite=Lax;Secure', ...pageFields()});
      const script = document.createElement('script');
      script.async = true; script.referrerPolicy = 'no-referrer';
      script.src = 'https://www.googletagmanager.com/gtag/js?id=' + measurementId;
      script.onerror = () => { document.getElementById('analytics-status').textContent =
        'Analytics could not load. Your browser remains fully usable.'; };
      document.head.append(script);
    }
    trackView();
  }
  function stop() {
    // Google's documented opt-out flag also stops its automatic session events.
    active = false; lastView = null; window[optOut] = true;
    for (const item of document.cookie.split(';')) {
      const name = item.trim().split('=')[0];
      if (name !== '_ga' && name !== '_ga_' + measurementId.slice(2)) continue;
      for (const domain of ['', location.hostname, 'maimai.party', '.maimai.party']) {
        document.cookie = name + '=; Max-Age=0; Path=/; SameSite=Lax; Secure' +
          (domain ? '; Domain=' + domain : '');
      }
    }
  }
  function updateStatus() {
    const blocked = privacySignal();
    document.getElementById('analytics-status').textContent = blocked ?
      'Analytics is off because your browser requests privacy.' :
      active ? 'Analytics is on. You can turn it off at any time.' : 'Analytics is off.';
    for (const button of document.querySelectorAll('[data-analytics-choice="granted"]'))
      button.disabled = blocked;
  }
  function choose(choice) {
    if (privacySignal()) choice = 'denied';
    try { localStorage.setItem(storageKey, JSON.stringify({choice, expires: Date.now() + choiceLifetime})); }
    catch { /* The choice still applies for this tab when storage is unavailable. */ }
    if (choice === 'granted') start(); else stop();
    notice.hidden = true; updateStatus();
    if (dialog.open) dialog.close();
  }
  settings.removeAttribute('aria-disabled');
  document.getElementById('analytics-unavailable').hidden = true;
  settings.onclick = () => { window.maimaiSettings.close(); notice.hidden = true; updateStatus(); dialog.showModal(); };
  notice.querySelector('a[href="#privacy"]').onclick = event => {
    event.preventDefault(); notice.hidden = true;
    document.getElementById('about-tab')?.click();
    const privacy = document.getElementById('privacy');
    privacy.open = true;
    privacy.querySelector('summary').focus();
    privacy.scrollIntoView({block: 'start'});
  };
  document.getElementById('analytics-close').onclick = () => dialog.close();
  dialog.addEventListener('close', () => window.maimaiSettings.focus());
  for (const button of document.querySelectorAll('[data-analytics-choice]'))
    button.onclick = () => choose(button.dataset.analyticsChoice);
  window.addEventListener('maimai:viewchange', trackView);
  window.addEventListener('maimai:support', event => {
    if (!active || privacySignal() || readChoice() !== 'granted' ||
        !['support_opened', 'support_checkout_started', 'support_success_return'].includes(event.detail)) return;
    // Enum-only events: no amount, Stripe identifier, payer or player information.
    tag('event', event.detail, {...pageFields(), send_to: measurementId});
  });
  window.addEventListener('popstate', () => queueMicrotask(trackView));
  window.addEventListener('storage', event => {
    if (event.key !== storageKey && event.key !== null) return;
    if (readChoice() === 'granted' && !privacySignal()) start(); else stop();
    notice.hidden = readChoice() !== null || privacySignal(); updateStatus();
  });
  const choice = readChoice();
  if (choice === 'granted' && !privacySignal()) start(); else stop();
  notice.hidden = choice !== null || privacySignal(); updateStatus();
})();
