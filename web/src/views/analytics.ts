import type { TextView } from '../components/chart-card';
import type { SettingsMenu } from './settings-menu';
import type { HistoryPort } from '../runtime/history';
type Choice = 'granted' | 'denied';
export interface AnalyticsPorts {
  root: HTMLElement;
  localization: Pick<TextView, 'text'>;
  settings: SettingsMenu | undefined;
  historyPort: Pick<HistoryPort, 'onTraversal'>;
}
/** Existing explicit-consent GA4 settings, separate from the finite usage collector. */
export function createAnalytics(ports: AnalyticsPorts) {
  const root = ports.root,
    document = root.ownerDocument,
    window = document.defaultView! as Window &
      typeof globalThis & {
        dataLayer?: IArguments[];
      } & Partial<Record<`ga-disable-${string}`, boolean>>,
    location = window.location,
    navigator = window.navigator as Navigator & { globalPrivacyControl?: boolean },
    i18n = ports.localization;
  const find = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>('#' + id);
  const measurementId = 'G-FP9V9NF63J';
  const hosts = ['maimai.party', 'www.maimai.party'];
  if (location.protocol !== 'https:' || !hosts.includes(location.hostname)) return;
  const settings = find('analytics-settings');
  const foundNotice = find('analytics-notice');
  const foundDialog = find<HTMLDialogElement>('analytics-dialog');
  if (!settings || !foundNotice || !foundDialog) return;
  const notice = foundNotice,
    dialog = foundDialog;

  const storageKey = 'maimai.party.analytics.v1';
  const choiceLifetime = 180 * 86400 * 1000;
  const optOut: `ga-disable-${string}` = `ga-disable-${measurementId}`;
  const labels = {
    catalog: 'Charts',
    patterns: 'Pattern dictionary',
    compare: 'Compare charts',
    about: 'About',
  };
  const research = !!find('catalog-tab');
  let active = false,
    started = false;
  let lastView: string | null = null;
  const privacySignal = () =>
    navigator.globalPrivacyControl === true || navigator.doNotTrack === '1';
  const readChoice = (): Choice | null => {
    try {
      const record = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
      return record &&
        ['granted', 'denied'].includes(record.choice) &&
        Number.isFinite(record.expires) &&
        record.expires > Date.now()
        ? record.choice
        : null;
    } catch {
      return null;
    }
  };
  const currentView = (): keyof typeof labels => {
    if (!research) return 'catalog';
    const requested = new URLSearchParams(location.search).get('view');
    return requested && Object.hasOwn(labels, requested)
      ? (requested as keyof typeof labels)
      : 'catalog';
  };
  const pageFields = () => {
    const view = currentView();
    // Fixed virtual pages: never send the real URL, referrer, query, hash or DOM title.
    return {
      page_location: 'https://maimai.party/' + (view === 'catalog' ? 'charts' : view),
      page_title: 'maimai.party · ' + labels[view],
      page_referrer: '',
    };
  };
  function tag(..._args: unknown[]) {
    window.dataLayer!.push(arguments);
  }
  function trackView() {
    if (!active || privacySignal()) return;
    const page = pageFields();
    if (lastView === page.page_location) return;
    lastView = page.page_location;
    tag('set', page);
    tag('event', 'page_view', { ...page, send_to: measurementId });
  }
  function start() {
    if (privacySignal() || active) return;
    active = true;
    window[optOut] = false;
    if (!started) {
      started = true;
      window.dataLayer = window.dataLayer || [];
      // Basic consent mode: the Google tag does not exist before an opt-in.
      tag('consent', 'default', {
        analytics_storage: 'granted',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
      });
      tag('set', {
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
        ads_data_redaction: true,
        url_passthrough: false,
        ...pageFields(),
        campaign_id: '',
        campaign_source: '',
        campaign_medium: '',
        campaign_name: '',
        campaign_term: '',
        campaign_content: '',
      });
      tag('js', new Date());
      tag('config', measurementId, {
        send_page_view: false,
        cookie_domain: location.hostname,
        cookie_path: '/',
        cookie_expires: 90 * 86400,
        cookie_update: false,
        cookie_flags: 'SameSite=Lax;Secure',
        ...pageFields(),
      });
      const script = document.createElement('script');
      script.async = true;
      script.referrerPolicy = 'no-referrer';
      script.src = 'https://www.googletagmanager.com/gtag/js?id=' + measurementId;
      script.onerror = () => {
        i18n.text(
          find('analytics-status')!,
          'Analytics could not load. Your browser remains fully usable.',
        );
      };
      document.head.append(script);
    }
    trackView();
  }
  function stop() {
    // Google's documented opt-out flag also stops its automatic session events.
    active = false;
    lastView = null;
    window[optOut] = true;
    for (const item of document.cookie.split(';')) {
      const name = item.trim().split('=')[0];
      if (name !== '_ga' && name !== '_ga_' + measurementId.slice(2)) continue;
      for (const domain of ['', location.hostname, 'maimai.party', '.maimai.party']) {
        document.cookie =
          name +
          '=; Max-Age=0; Path=/; SameSite=Lax; Secure' +
          (domain ? '; Domain=' + domain : '');
      }
    }
  }
  function updateStatus() {
    const blocked = privacySignal();
    i18n.text(
      find('analytics-status')!,
      blocked
        ? 'Analytics is off because your browser requests privacy.'
        : active
          ? 'Analytics is on. You can turn it off at any time.'
          : 'Analytics is off.',
    );
    for (const button of root.querySelectorAll<HTMLButtonElement>(
      '[data-analytics-choice="granted"]',
    ))
      button.disabled = blocked;
  }
  function choose(choice: Choice) {
    if (privacySignal()) choice = 'denied';
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ choice, expires: Date.now() + choiceLifetime }),
      );
    } catch {
      /* The choice still applies for this tab when storage is unavailable. */
    }
    if (choice === 'granted') start();
    else stop();
    notice.hidden = true;
    updateStatus();
    if (dialog.open) dialog.close();
  }
  settings.removeAttribute('aria-disabled');
  find('analytics-unavailable')!.hidden = true;
  settings.onclick = () => {
    ports.settings?.close();
    notice.hidden = true;
    updateStatus();
    dialog.showModal();
  };
  notice.querySelector<HTMLAnchorElement>('a[href="#privacy"]')!.onclick = (event) => {
    event.preventDefault();
    notice.hidden = true;
    find('about-tab')?.click();
    const privacy = find<HTMLDetailsElement>('privacy')!;
    privacy.open = true;
    privacy.querySelector('summary')!.focus();
    privacy.scrollIntoView({ block: 'start' });
  };
  find('analytics-close')!.onclick = () => dialog.close();
  dialog.addEventListener('close', () => ports.settings?.focus());
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-analytics-choice]'))
    button.onclick = () => {
      const choice = button.dataset.analyticsChoice;
      if (choice === 'granted' || choice === 'denied') choose(choice);
    };
  window.addEventListener('maimai:viewchange', trackView);
  window.addEventListener('maimai:support', (event: Event) => {
    const detail: unknown = (event as CustomEvent<unknown>).detail;
    if (
      !active ||
      privacySignal() ||
      readChoice() !== 'granted' ||
      typeof detail !== 'string' ||
      !['support_opened', 'support_checkout_started', 'support_success_return'].includes(detail)
    )
      return;
    // Enum-only events: no amount, Stripe identifier, payer or player information.
    tag('event', detail, { ...pageFields(), send_to: measurementId });
  });
  ports.historyPort.onTraversal(() => queueMicrotask(trackView));
  window.addEventListener('storage', (event) => {
    if (event.key !== storageKey && event.key !== null) return;
    if (readChoice() === 'granted' && !privacySignal()) start();
    else stop();
    notice.hidden = readChoice() !== null || privacySignal();
    updateStatus();
  });
  const choice = readChoice();
  if (choice === 'granted' && !privacySignal()) start();
  else stop();
  notice.hidden = choice !== null || privacySignal();
  updateStatus();
}
