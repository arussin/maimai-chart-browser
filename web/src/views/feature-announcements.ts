import type { TextView, LocalizedText } from '../components/chart-card';
import type { SettingsMenu } from './settings-menu';
interface Announcement {
  id: string;
  enabled(): boolean;
  title: string;
  body: string;
}
interface AnnouncementPorts {
  root: HTMLElement;
  localization: Pick<TextView, 'text'>;
  settings?: Pick<SettingsMenu, 'close'>;
  playerSources: { capabilities: Record<string, boolean> };
}
/** Local feature IDs are independent of scores and ordinary deployments. */
export function createFeatureAnnouncements(ports: AnnouncementPorts) {
  const root = ports.root,
    document = root.ownerDocument,
    window = document.defaultView!;
  const find = (id: string) => root.querySelector<HTMLElement>('#' + id);
  /* Local feature IDs survive ordinary deployments and are independent of scores. */
  if (find('feature-announcement-replay')) return;
  const i18n = ports.localization,
    foundSettings = find('settings-toggle'),
    foundMenu = find('settings-actions');
  if (!foundSettings || !foundMenu) return;
  const settings = foundSettings,
    menu = foundMenu;
  const registry: Announcement[] = [
    {
      id: 'player-import-sources-v1',
      enabled: () => Object.values(ports.playerSources.capabilities).every(Boolean),
      title: 'Bring your scores to maimai.party',
      body: 'Bring your Session Report or public Maishift scores into the chart browser. Choose Import player data to get started.',
    },
  ];
  const sessionSeen = new Set<string>();
  let current: Announcement | null = null;
  let manual = false,
    readyToShow = document.readyState === 'complete';
  const bubble = document.createElement('aside');
  bubble.className = 'feature-announcement';
  bubble.hidden = true;
  bubble.setAttribute('role', 'region');
  bubble.setAttribute('aria-labelledby', 'feature-announcement-title');
  root.append(bubble);
  function seen(id: string) {
    if (sessionSeen.has(id)) return true;
    try {
      if (localStorage.getItem('maimai-announcement:' + id) === 'seen') return true;
    } catch {}
    try {
      return sessionStorage.getItem('maimai-announcement:' + id) === 'seen';
    } catch {
      return false;
    }
  }
  function mark(id: string) {
    sessionSeen.add(id);
    try {
      localStorage.setItem('maimai-announcement:' + id, 'seen');
    } catch {
      try {
        sessionStorage.setItem('maimai-announcement:' + id, 'seen');
      } catch {}
    }
  }
  function element<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text: LocalizedText,
  ): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    i18n.text(node, text);
    return node;
  }
  function close() {
    bubble.hidden = true;
    if (manual) settings.focus();
  }
  function position() {
    const r = settings.getBoundingClientRect();
    bubble.style.top = Math.max(8, r.bottom + 10) + 'px';
    bubble.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
    bubble.style.maxHeight = Math.max(80, window.innerHeight - r.bottom - 22) + 'px';
  }
  function show(item: Announcement, replay = false) {
    if (
      !readyToShow ||
      !item.enabled() ||
      document.visibilityState !== 'visible' ||
      root.querySelector('dialog[open]') ||
      window.opener ||
      !settings.getClientRects().length
    )
      return false;
    const bounds = settings.getBoundingClientRect();
    if (
      bounds.top < 0 ||
      bounds.bottom > window.innerHeight ||
      bounds.right < 0 ||
      bounds.left > window.innerWidth
    )
      return false;
    current = item;
    manual = replay;
    const title = element('h2', item.title);
    title.id = 'feature-announcement-title';
    const body = element('p', item.body),
      actions = document.createElement('div');
    const start = element('button', 'Import data');
    start.type = 'button';
    start.onclick = () => {
      close();
      find('player-import')?.click();
    };
    const done = element('button', 'Got it');
    done.type = 'button';
    done.onclick = close;
    actions.append(start, done);
    for (const [label, url] of [
      ['Session Report on GitHub', 'https://github.com/arussin/maimai-session-report'],
      ['Maishift', 'https://maimai.shiftpsh.com/en'],
    ]) {
      const link = element('a', label);
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.referrerPolicy = 'no-referrer';
      actions.append(link);
    }
    bubble.replaceChildren(title, body, actions);
    bubble.hidden = false;
    position();
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (current === item && !bubble.hidden && !root.querySelector('dialog[open]'))
          mark(item.id);
      }),
    );
    if (replay) start.focus();
    return true;
  }
  const replay = element('button', 'What’s new');
  replay.id = 'feature-announcement-replay';
  replay.type = 'button';
  replay.setAttribute('role', 'menuitem');
  replay.tabIndex = -1;
  replay.hidden = !registry.some((item) => item.enabled());
  menu.insertBefore(replay, find('site-share'));
  replay.onclick = () => {
    ports.settings?.close();
    const item = registry.find((item) => item.enabled());
    if (item) show(item, true);
  };
  const attempt = () => {
    if (current && !bubble.hidden) return;
    const item = registry.find((item) => item.enabled() && !seen(item.id));
    if (item) show(item);
  };
  const observer = new MutationObserver(() => {
    if (root.querySelector('dialog[open]')) close();
    attempt();
  });
  observer.observe(root, { subtree: true, attributes: true, attributeFilter: ['open'] });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !bubble.hidden) {
      close();
      event.preventDefault();
    }
  });
  window.addEventListener('resize', () => {
    position();
    attempt();
  });
  window.addEventListener(
    'scroll',
    () => {
      position();
      attempt();
    },
    { passive: true },
  );
  document.addEventListener('visibilitychange', attempt);
  if (readyToShow) requestAnimationFrame(attempt);
  else
    window.addEventListener(
      'load',
      () => {
        readyToShow = true;
        requestAnimationFrame(attempt);
      },
      { once: true },
    );
}
