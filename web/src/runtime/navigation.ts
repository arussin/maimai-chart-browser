import { routePattern, publicPath } from './public-routes';
import { diagnose, catalogFailure, catalogPending } from './diagnostics';
import { IntentScope } from './intent';
import { historyPort } from './history';
import { PublicReader, decodeJSON } from './verified-data';
import type {
  BrowserPort,
  BrowserSnapshot,
  NavigationPorts,
  ReturnTarget,
  Tab,
  SongWorkspacePort,
} from './contracts';
import type { Page } from '../usage-contract';
const metadataSelector =
  'link[rel=canonical],link[rel=alternate][hreflang],meta[name=description],meta[property^="og:"],meta[name^="twitter:"]';
const labels: Record<string, readonly string[]> = {
  en: ['Open song page', 'Back to results'],
  ja: ['楽曲ページを開く', '検索結果に戻る'],
  ko: ['곡 페이지 열기', '검색 결과로 돌아가기'],
  'zh-hans': ['打开歌曲页面', '返回搜索结果'],
};
interface Ledger {
  songs: Record<string, string>;
  redirects?: Record<string, string>;
}
interface RouteOptions {
  push?: boolean;
  returnTo?: ReturnTarget | null;
  browserState?: BrowserSnapshot | null;
}
const nodes = (root: ParentNode) => [...root.querySelectorAll(metadataSelector)];
const copyMetadata = (root: ParentNode) =>
  nodes(root).map((node) => node.cloneNode(true) as Element);
function replaceMetadata(values: Element[]) {
  nodes(document.head).forEach((node) => node.remove());
  values.forEach((node) => document.head.append(node.cloneNode(true)));
}
/** Sole owner of browser history, route intent and committed page activation. */
export class NavigationCoordinator {
  private readonly intent = new IntentScope();
  private readonly reader = new PublicReader(new URL('/', location.href));
  private browser: BrowserPort | undefined;
  private browserMain: HTMLElement | null = null;
  private routeView: HTMLElement | null = null;
  private songWorkspace: SongWorkspacePort | undefined;
  private browserTitle = document.title;
  private browserLanguage = document.documentElement.lang;
  private browserMetadata = copyMetadata(document.head);
  private lastActivation: string | null = null;
  private bfcacheKey: string | null = null;
  private restoreDepth = 0;
  private ledgerPromise: Promise<Ledger> | undefined;
  private readonly interactions = new Set<string>();
  private interactionIdle: Promise<void> = Promise.resolve();
  private finishInteraction: (() => void) | undefined;
  private enabled = !!document.querySelector(
    'meta[name=maimai-song-pages][content="1"],main[data-seo-page]',
  );
  constructor(private readonly ports: NavigationPorts) {}
  get restoring() {
    return this.restoreDepth > 0;
  }
  asset(path: string) {
    return routePattern.test(location.pathname) ? new URL(path, location.origin + '/').href : path;
  }
  ready() {
    return this.ledgerPromise?.catch(() => null) ?? Promise.resolve();
  }
  locale() {
    const value = this.ports.localization()?.locale || document.documentElement.lang || 'en';
    return value === 'zh-Hans' ? 'zh-hans' : value;
  }
  silent<T>(run: () => T): T {
    this.restoreDepth++;
    try {
      return this.ports.usage.suspend(run);
    } finally {
      this.restoreDepth--;
    }
  }
  private page(): Page {
    if (location.hash === '#privacy') return 'about';
    const route = routePattern.exec(location.pathname);
    if (route) return route[2] === 'songs' ? 'song' : 'version';
    return (
      ({ catalog: 'charts', patterns: 'patterns', compare: 'compare', about: 'about' } as const)[
        new URLSearchParams(location.search).get('view') as Tab
      ] || 'charts'
    );
  }
  private activate(force = false) {
    const page = this.page(),
      key = location.pathname + '|' + page;
    if (
      this.restoring ||
      (document as Document & { prerendering?: boolean }).prerendering ||
      (!force && this.lastActivation === key)
    )
      return;
    this.lastActivation = key;
    this.ports.usage.activate(page);
    window.dispatchEvent(new CustomEvent('maimai:navigation', { detail: { page } }));
  }
  private async ledger(): Promise<Ledger> {
    return (this.ledgerPromise ??= this.reader
      .read('permalinks.json', 2 * 1024 * 1024)
      .then((bytes) => decodeJSON<Ledger>(bytes))
      .catch((error) => {
        this.ledgerPromise = undefined;
        throw error;
      }));
  }
  link(songID: string, chartID: string) {
    const node = document.createElement('a');
    node.hidden = true;
    node.dataset.songPage = '';
    node.id = 'song-page-' + chartID;
    node.className = 'chart-song-page';
    node.textContent = labels[this.locale()]?.[0] || labels.en[0];
    if (!this.enabled) return node;
    void this.ledger()
      .then((map) => {
        let id = songID;
        const seen = new Set<string>();
        while (map.redirects?.[id]) {
          if (seen.has(id)) return;
          seen.add(id);
          id = map.redirects[id];
        }
        const slug = map.songs?.[id];
        if (typeof slug !== 'string' || !slug || /[/?#\\]/.test(slug)) return;
        node.href = publicPath(this.locale(), 'songs', slug);
        node.hidden = false;
      })
      .catch(() => {});
    return node;
  }
  private saveBrowser(focus?: string): ReturnTarget | null {
    if (!this.browser) return null;
    const snapshot = this.browser.capture();
    if (focus) snapshot.focus = focus;
    historyPort.replace({
      ...historyPort.state,
      maimaiBrowserState: snapshot,
      maimaiBrowserURL: location.href,
    });
    return { url: location.href, snapshot };
  }
  private regional(root: ParentNode) {
    const update = (enabled: boolean) => {
      root.querySelectorAll<HTMLImageElement>('[data-seo-jp-src]').forEach((node) => {
        node.src = (enabled ? node.dataset.seoIntlSrc : node.dataset.seoJpSrc)!;
      });
      root.querySelectorAll<HTMLElement>('[data-seo-jp-visible]').forEach((node) => {
        node.hidden =
          (enabled ? node.dataset.seoIntlVisible : node.dataset.seoJpVisible) !== 'true';
      });
      root.querySelectorAll<HTMLElement>('[data-seo-jp]').forEach((node) => {
        node.textContent = (enabled ? node.dataset.seoIntl : node.dataset.seoJp)!;
      });
      const check = root.querySelector<HTMLInputElement>('[data-seo-international]');
      if (check) check.checked = enabled;
      this.songWorkspace?.region(enabled);
    };
    const check = root.querySelector<HTMLInputElement>('[data-seo-international]');
    if (check)
      check.onchange = () => {
        update(check.checked);
        historyPort.replace({ ...historyPort.state, maimaiInternational: check.checked });
        if (!this.restoring) this.ports.usage.emit('filter_first_used', undefined, 'international');
      };
    update(historyPort.state.maimaiInternational === true);
  }
  private revealShell() {
    const wrapper = document.querySelector<HTMLElement>('[data-version-browser]');
    if (wrapper) {
      document
        .querySelectorAll('body>main[data-seo-page],body>.site-header,body>.skip-link')
        .forEach((node) => node.remove());
      wrapper.hidden = false;
    }
    document.documentElement.classList.remove('seo-static');
  }
  private showBrowser(snapshot?: BrowserSnapshot | null) {
    this.revealShell();
    this.songWorkspace?.dispose();
    this.songWorkspace = undefined;
    if (this.routeView) this.routeView.hidden = true;
    if (this.browserMain) this.browserMain.hidden = false;
    document.title = this.browserTitle;
    document.documentElement.lang =
      snapshot?.locale || this.ports.localization()?.locale || this.browserLanguage;
    replaceMetadata(this.browserMetadata);
    if (snapshot) this.silent(() => this.browser?.restore(snapshot));
  }
  async route(
    url: URL,
    { push = false, returnTo = null, browserState = null }: RouteOptions = {},
  ): Promise<boolean> {
    if (!routePattern.test(url.pathname) || url.origin !== location.origin) return false;
    const operation = this.intent.start();
    try {
      const raw = await this.reader.read(url.pathname, 2 * 1024 * 1024, operation.signal);
      if (!operation.current()) return false;
      const parsed = new DOMParser().parseFromString(
        new TextDecoder('utf-8', { fatal: true }).decode(raw),
        'text/html',
      );
      const content = parsed.querySelector<HTMLElement>('main[data-seo-page]');
      if (!content) throw Error('Public page unavailable');
      const browser = await this.ports.loadBrowser();
      if (!operation.current()) return false;
      const mountSong =
        content.dataset.seoPage === 'song' ? await browser.song(content) : undefined;
      if (!mountSong) await browser.load();
      // Preserve the pressed target until pointer/key activation has dispatched its click.
      await this.interactionIdle;
      if (!operation.current()) return false;
      this.browser = browser;
      this.browserMain ??= document.querySelector<HTMLElement>('main:not([data-seo-page])');
      if (!this.browserMain) return false;
      if (!this.routeView) {
        this.routeView = document.createElement('section');
        this.routeView.id = 'seo-route-view';
        this.routeView.tabIndex = -1;
        this.browserMain.after(this.routeView);
        const style = document.createElement('link');
        style.rel = 'stylesheet';
        style.href = '/seo-pages.css';
        document.head.append(style);
      }
      browser.cancelRestoration();
      this.bfcacheKey = null;
      if (push) {
        const international =
          browserState?.region?.international ??
          historyPort.state.maimaiInternational ??
          returnTo?.snapshot?.region?.international === true;
        historyPort.push(
          {
            maimaiReturn: returnTo,
            maimaiInternational: international,
            ...(browserState ? { maimaiBrowserState: browserState } : {}),
          },
          url.pathname,
        );
      }
      this.songWorkspace?.dispose();
      this.songWorkspace = undefined;
      this.routeView.replaceChildren(document.importNode(content, true));
      this.routeView.hidden = false;
      this.browserMain.hidden = true;
      document.title = parsed.title;
      document.documentElement.lang = parsed.documentElement.lang;
      replaceMetadata(copyMetadata(parsed.head));
      const localization = this.ports.localization();
      if (localization && localization.locale !== parsed.documentElement.lang)
        this.silent(() => localization.setLocale(parsed.documentElement.lang, { persist: false }));
      if (mountSong)
        this.songWorkspace = mountSong(
          this.routeView,
          historyPort.state.maimaiInternational === true,
        );
      this.regional(this.routeView);
      this.revealShell();
      const saved = historyPort.state.maimaiBrowserState;
      if (content.dataset.seoPage === 'version') {
        this.routeView.hidden = true;
        this.browserMain.hidden = false;
        this.silent(() => {
          if (saved) browser.restore(saved);
          else
            browser.version(
              content.querySelector<HTMLElement>('[data-seo-version]')!.dataset.seoVersion!,
            );
        });
        if (!saved) document.getElementById('catalog-tab')?.focus({ preventScroll: true });
      } else this.routeView.focus({ preventScroll: true });
      // Snapshot restoration can set its saved locale; the committed route owns metadata.
      if (localization && localization.locale !== parsed.documentElement.lang)
        this.silent(() => localization.setLocale(parsed.documentElement.lang, { persist: false }));
      document.documentElement.lang = parsed.documentElement.lang;
      if (!(content.dataset.seoPage === 'version' && saved)) scrollTo(0, 0);
      this.activate();
      return true;
    } catch (error) {
      if (!operation.current()) return false;
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        diagnose('route_unavailable');
        const staticPage = document.querySelector<HTMLElement>('body>main[data-seo-page]');
        if (!push && staticPage && !staticPage.hidden && url.href === location.href) {
          catalogFailure(staticPage, document.documentElement.lang);
          return false;
        }
        if (push) location.assign(url.href);
        else location.replace(url.href);
      }
      return false;
    }
  }
  private openTarget() {
    if (!this.browser) return;
    const language = new URLSearchParams(location.search).get('lang');
    if (language) this.ports.localization()?.setLocale(language, { persist: false });
    this.browser.open();
    historyPort.replace({
      ...historyPort.state,
      maimaiOpenBrowser: false,
      maimaiBrowserState: this.browser.capture(),
    });
  }
  private returnToBrowser(target?: string): boolean {
    const state = historyPort.state.maimaiReturn;
    if (!this.browserMain || !this.browser) {
      if (state?.snapshot) {
        historyPort.push(
          { maimaiBrowserState: state.snapshot, maimaiOpenBrowser: !!target },
          target || state.url || '/',
        );
        location.reload();
        return true;
      }
      return false;
    }
    void this.browserAction(() => {
      this.bfcacheKey = null;
      const destination = target || state?.url || '/';
      historyPort.push(
        { maimaiBrowserState: state?.snapshot || null, maimaiOpenBrowser: !!target },
        destination,
      );
      if (
        !target &&
        routePattern.exec(new URL(destination, location.href).pathname)?.[2] === 'versions'
      ) {
        void this.route(new URL(destination, location.href));
        return;
      }
      this.showBrowser(state?.snapshot);
      if (target) this.silent(() => this.openTarget());
      this.activate();
    });
    return true;
  }
  /** Loading does not activate a page; only the still-current user action may commit. */
  async browserAction(action: () => void): Promise<boolean> {
    const operation = this.intent.start();
    this.browser?.cancelRestoration();
    const root = this.routeView && !this.routeView.hidden ? this.routeView : document.body;
    const pending = catalogPending(
      root,
      this.ports.localization()?.locale || document.documentElement.lang,
    );
    try {
      const browser = this.browser ?? (await this.ports.loadBrowser());
      await browser.load();
      if (!operation.current()) return false;
      action();
      return true;
    } catch {
      if (operation.current())
        catalogFailure(root, this.ports.localization()?.locale || document.documentElement.lang);
      return false;
    } finally {
      pending.remove();
    }
  }

  /** A newer tab intention invalidates a pending route before changing any URL. */
  tabCommitted(name: Tab, preservePattern = false) {
    if (!this.restoring) this.intent.cancel();
    const url = new URL(location.href);
    url.searchParams.set('view', name);
    if (!preservePattern) url.searchParams.delete('pattern');
    if (
      !this.restoring &&
      ((this.routeView && !this.routeView.hidden) ||
        (routePattern.exec(url.pathname)?.[2] === 'versions' && name !== 'catalog'))
    ) {
      url.pathname = '/';
      this.showBrowser();
    }
    historyPort.replace(historyPort.state, url);
    if (!this.restoring) this.activate();
    window.dispatchEvent(new Event('maimai:viewchange'));
  }
  attach(browser: BrowserPort, metadata?: { title: string; language: string; nodes: Element[] }) {
    this.browser = browser;
    this.browserMain = document.querySelector<HTMLElement>('main:not([data-seo-page])');
    if (metadata) {
      this.browserTitle = metadata.title;
      this.browserLanguage = metadata.language;
      this.browserMetadata = metadata.nodes;
    } else if (!document.querySelector('main[data-seo-page]')) {
      this.browserTitle = document.title;
      this.browserLanguage = document.documentElement.lang;
      this.browserMetadata = copyMetadata(document.head);
    }
    if (routePattern.exec(location.pathname)?.[2] === 'songs') {
      this.activate();
      return;
    }
    const restore =
      historyPort.state.maimaiBrowserState || historyPort.state.maimaiReturn?.snapshot;
    if (restore) this.silent(() => browser.restore(restore));
    const selected =
      new URLSearchParams(location.search).get('release') ||
      document.querySelector<HTMLElement>('[data-seo-version]')?.dataset.seoVersion;
    if (selected && !restore) this.silent(() => browser.version(selected));
    if (historyPort.state.maimaiOpenBrowser) this.silent(() => this.openTarget());
    this.activate();
  }
  start() {
    const hold = (key: string) => {
      this.interactions.add(key);
      if (!this.finishInteraction)
        this.interactionIdle = new Promise((resolve) => {
          this.finishInteraction = resolve;
        });
    };
    const release = (key?: string) => {
      if (key) this.interactions.delete(key);
      else this.interactions.clear();
      // Native click follows pointerup/keyup. A microtask here would run too early.
      setTimeout(() => {
        if (this.interactions.size) return;
        this.finishInteraction?.();
        this.finishInteraction = undefined;
      }, 0);
    };
    document.addEventListener('pointerdown', (event) => hold('pointer:' + event.pointerId), true);
    for (const type of ['pointerup', 'pointercancel'] as const)
      document.addEventListener(type, (event) => release('pointer:' + event.pointerId), true);
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Enter' || event.key === ' ') hold('key:' + event.code);
      },
      true,
    );
    document.addEventListener('keyup', (event) => release('key:' + event.code), true);
    window.addEventListener('blur', () => release());
    document.addEventListener('click', (event) => {
      const anchor = (event.target as Element)?.closest<HTMLAnchorElement>('a');
      if (
        !anchor ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        (anchor.target && anchor.target !== '_self')
      )
        return;
      const url = new URL(anchor.href, location.href);
      if (url.origin !== location.origin) return;
      if (anchor.hasAttribute('data-back-results')) {
        if (this.returnToBrowser()) event.preventDefault();
        return;
      }
      if (anchor.hasAttribute('data-open-browser')) {
        if (this.returnToBrowser(url.href)) event.preventDefault();
        return;
      }
      if (anchor.hasAttribute('data-song-page') && routePattern.test(url.pathname)) {
        if (this.browser) {
          event.preventDefault();
          const source =
            routePattern.exec(location.pathname)?.[2] === 'songs'
              ? historyPort.state.maimaiReturn
              : this.saveBrowser(anchor.id);
          void this.route(url, { push: true, returnTo: source });
        } else if (
          historyPort.state.maimaiReturn ||
          typeof historyPort.state.maimaiInternational === 'boolean'
        ) {
          event.preventDefault();
          historyPort.push({ ...historyPort.state }, url.pathname);
          location.reload();
        }
      }
    });
    historyPort.onTraversal(() => {
      this.intent.cancel();
      if (this.bfcacheKey === location.href) {
        this.bfcacheKey = null;
        return;
      }
      if (routePattern.test(location.pathname) && this.browser)
        void this.route(new URL(location.href));
      else if (this.browser) {
        void this.browserAction(() => {
          this.showBrowser(historyPort.state.maimaiBrowserState);
          if (!historyPort.state.maimaiBrowserState) this.silent(() => this.browser!.open());
          this.activate(true);
        });
      }
    });
    document.addEventListener('prerenderingchange', () => this.activate(true), { once: true });
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) {
        this.bfcacheKey = location.href;
        this.activate(true);
      }
    });
    window.addEventListener('maimai-language-change', () => {
      document.querySelectorAll<HTMLAnchorElement>('a.chart-song-page').forEach((node) => {
        const url = new URL(node.href, location.href),
          match = routePattern.exec(url.pathname);
        if (match) {
          url.pathname = url.pathname.replace('/' + match[1] + '/', '/' + this.locale() + '/');
          node.href = url.href;
          node.textContent = labels[this.locale()]?.[0] || labels.en[0];
        }
      });
      const match = routePattern.exec(location.pathname);
      if (!this.restoring && this.browser && match && match[1] !== this.locale()) {
        const url = new URL(location.href);
        url.pathname = url.pathname.replace('/' + match[1] + '/', '/' + this.locale() + '/');
        void this.route(url, {
          push: true,
          returnTo:
            historyPort.state.maimaiReturn || (match[2] === 'versions' ? this.saveBrowser() : null),
          browserState: match[2] === 'versions' ? this.browser.capture() : null,
        });
      }
    });
    document.querySelectorAll('main[data-seo-page]').forEach((root) => this.regional(root));
    this.activate();
  }
}
