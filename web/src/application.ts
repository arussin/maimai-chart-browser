import { createAnalysisModel } from './domain/analysis-model';
import { createPassagePreview } from './components/passage-preview';
import { createChartSections } from './components/chart-sections';
import { sectionPreferences } from './runtime/section-preferences';
import { createLocalization, type LocalizationConfiguration } from './views/localization.js';
import type { SearchConfiguration } from './views/song-search';
import { createSongSearch } from './views/song-search.js';
import { createSettingsMenu } from './views/settings-menu.js';
import { createPlayerRanges } from './views/player-ranges.js';
import { createPlayerDataCore } from './views/player-data-core.js';
import { createPlayerMaishift } from './views/player-maishift.js';
import { createPlayerSources } from './views/player-sources.js';
import { createPlayerStorage } from './views/player-storage.js';
import { createPlayerData } from './views/player-data.js';
import { createFeatureAnnouncements } from './views/feature-announcements.js';
import { createSupportClient } from './views/support-client.js';
import { createSupportStripe } from './views/support-stripe.js';
import { createChartVisuals, type ChartTheme } from './views/chart-visuals.js';
import { createPatternLibrary } from './views/pattern-library.js';
import * as matching from './domain/challenge-matching';
import { createChartLinks } from './views/chart-links.js';
import { createChartArtwork } from './views/chart-artwork.js';
import { createChartFilters } from './views/chart-filters.js';
import { createChartOverview } from './views/chart-overview.js';
import { createPatternFilter, type PatternDefinition } from './views/pattern-filter.js';
import { createRegistryBrowser } from './views/registry-browser.js';
import { createChartComparison } from './views/chart-comparison.js';
import { createChallengeReview } from './views/challenge-review.js';
import type supportConfig from '../../src/maimai_intelligence/assets/support-config.json';
import { createAnalytics } from './views/analytics.js';
import * as catalogQuery from './catalog-query';
import * as playerDomain from './player-session';
import { createTabs } from './runtime/tabs';
import { BrowserState } from './runtime/browser-state';
import { historyPort } from './runtime/history';
import { loadCatalog, type PublicCatalog, type LoadedCatalog } from './runtime/catalog';
import { loadSongCatalog } from './runtime/song-catalog';
import { mountSongView } from './components/song-view';
import { PublicReader, decodeJSON } from './runtime/verified-data';
import type { NavigationCoordinator } from './runtime/navigation';
import type { UsageAPI } from './usage';
import type { BrowserResources } from './runtime/browser-resources';
import type {
  BrowserPort,
  BrowserSnapshot,
  LocalizationPort,
  PageMetadata,
} from './runtime/contracts';
export interface BrowserConfiguration {
  messages: LocalizationConfiguration['messages'];
  flags: Record<string, string>;
  search: SearchConfiguration;
  theme: ChartTheme;
  lessons: import('./domain/patterns').LessonBook;
  features: { maishift: boolean };
  pilot: boolean;
  support: typeof supportConfig;
}
export type Application = Awaited<ReturnType<typeof createApplication>>;
export interface ApplicationOptions {
  resources?: BrowserResources;
  configuration?: BrowserConfiguration;
  data?: PublicCatalog;
  usage: UsageAPI;
  navigation: NavigationCoordinator;
  onLocalization: (value: LocalizationPort) => void;
}
async function mountShell(
  reader: PublicReader,
  resources?: BrowserResources,
): Promise<PageMetadata | undefined> {
  if (document.querySelector('main:not([data-seo-page])')) return;
  if (!resources) throw Error('Missing browser resources');
  const bytes = await reader.verified(resources.shell);
  const parsed = new DOMParser().parseFromString(
    new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    'text/html',
  );
  const shell = parsed.querySelector<HTMLTemplateElement>('template[data-browser-shell]');
  if (!shell) throw Error('The research browser could not start.');
  // Resolve resources while the template is inert: importNode can start image requests.
  for (const node of shell.content.querySelectorAll<HTMLElement>('[src],[href]'))
    for (const key of ['src', 'href']) {
      const value = node.getAttribute(key);
      if (value && !value.startsWith('#')) node.setAttribute(key, new URL(value, reader.base).href);
    }
  const wrapper = document.createElement('div');
  wrapper.dataset.versionBrowser = '';
  wrapper.hidden = true;
  wrapper.append(document.importNode(shell.content, true));
  document.body.append(wrapper);
  for (const sheet of parsed.querySelectorAll<HTMLLinkElement>('link[rel=stylesheet]')) {
    const url = new URL(sheet.getAttribute('href')!, reader.base);
    if (url.origin !== location.origin) throw Error('Invalid public data reference');
    if (
      [...document.querySelectorAll<HTMLLinkElement>('link[rel=stylesheet]')].some(
        (node) => new URL(node.href).pathname === url.pathname,
      )
    )
      continue;
    const copy = sheet.cloneNode(true) as HTMLLinkElement;
    copy.href = url.href;
    document.head.append(copy);
  }
  return {
    title: parsed.title,
    language: parsed.documentElement.lang,
    nodes: [
      ...parsed.head.querySelectorAll(
        'link[rel=canonical],link[rel=alternate][hreflang],meta[name=description],meta[property^="og:"],meta[name^="twitter:"]',
      ),
    ].map((node) => node.cloneNode(true) as Element),
  };
}
/** The same dependency graph builds the hosted and self-contained offline applications. */
export async function createApplication(options: ApplicationOptions) {
  const { usage, navigation } = options,
    reader = new PublicReader(
      new URL(
        document.querySelector<HTMLMetaElement>('meta[name=maimai-browser-base]')?.content || '.',
        location.href,
      ),
    );
  const metadata = await mountShell(reader, options.resources),
    browserState = new BrowserState();
  const configuration =
    options.configuration ??
    decodeJSON<BrowserConfiguration>(await reader.verified(requiredResources().configuration));
  function requiredResources(): BrowserResources {
    if (!options.resources) throw Error('Missing browser resources');
    return options.resources;
  }
  const directSong = !!document.querySelector('body>main[data-seo-page="song"]');
  const readCatalog = () =>
    options.data
      ? Promise.resolve({
          canonical: options.data,
          data: options.data,
          details: undefined,
          latest: true,
          version: '',
          hash: '',
        })
      : loadCatalog(
          reader,
          new URLSearchParams(location.search).get('version'),
          directSong
            ? document.querySelector<HTMLElement>('[data-song-id]')?.dataset.catalogSha256
            : undefined,
          requiredResources().catalog,
        );
  const initialCatalog = directSong ? undefined : readCatalog();
  const localization = createLocalization({ root: document.body, configuration });
  options.onLocalization(localization);
  const settings = createSettingsMenu({ root: document.body, localization, usage });
  const views = createTabs(navigation, localization, (name) => {
    if (!directSong || name === 'about') {
      views.show(name);
      return;
    }
    void navigation.browserAction(() => {
      controller!.selectView!(name);
    });
  });
  const playerContext = configuration.pilot
    ? Object.freeze({ pilot: true, key: (name: string) => 'maimai-pilot-maishift-v1:' + name })
    : undefined;
  if (configuration.pilot) {
    const banner = document.createElement('aside');
    banner.id = 'maishift-browser-pilot';
    banner.className = 'maishift-browser-pilot';
    const title = document.createElement('strong'),
      description = document.createElement('span');
    localization.text(title, 'Maishift browser preview');
    localization.text(description, 'Test scores are saved separately from the main site.');
    banner.append(title, description);
    document.querySelector('main')!.prepend(banner);
  }
  const playerCore = createPlayerDataCore({}),
    maishift = createPlayerMaishift({ playerCore });
  const playerSources = createPlayerSources({
    playerContext,
    playerCore,
    features: configuration.features,
    maishift,
  });
  const playerStorage = createPlayerStorage({ playerContext });
  const playerRanges = createPlayerRanges({ usage, localization, maishift });
  const { filterDisclosure, catalogFilters } = createChartFilters({
    root: document.body,
    browserState,
    localization,
    playerContext,
    usage,
  });
  // Private imports and settings remain usable even while public catalog data is unavailable.
  const sections = createChartSections(
    document.body,
    browserState.sections,
    localization,
    sectionPreferences(
      playerContext?.key('maimai-chart-sections-v1') ?? 'maimai-chart-sections-v1',
    ),
    usage,
  );
  const personal = createPlayerData({
    root: document.body,
    browserState,
    sections,
    filterDisclosure,
    localization,
    playerContext,
    playerCore,
    maishift,
    playerRanges,
    playerDomain,
    playerSources,
    playerStorage,
    settings,
    songPages: navigation,
    usage,
    historyPort,
  });
  if (!configuration.pilot) {
    createFeatureAnnouncements({ root: document.body, localization, playerSources, settings });
    const supportClient = createSupportClient({ supportConfig: configuration.support });
    createSupportStripe({ root: document.body, localization, supportClient, historyPort });
    createAnalytics({ root: document.body, localization, settings, historyPort });
  }
  const songSearch = createSongSearch({ configuration }),
    visuals = createChartVisuals({ configuration });
  const previewField = createPassagePreview(localization);
  const definitions = JSON.parse(
    document.getElementById('pattern-data')!.textContent!,
  ) as PatternDefinition[];
  let loaded: LoadedCatalog | undefined;
  let patternLibrary: ReturnType<typeof createPatternLibrary> | undefined;
  let comparison: ReturnType<typeof createChartComparison> | undefined;
  let controller: ReturnType<typeof createChallengeReview> | undefined;
  let fullContext: ReturnType<typeof chartContext> | undefined;
  let songData: PublicCatalog | undefined;
  function chartContext(data: PublicCatalog, details?: LoadedCatalog['details']) {
    const analysis = createAnalysisModel(data.analysis, data.catalog);
    const chartLinks = createChartLinks({ localization, usage });
    chartLinks.configure(data.mai_notes);
    const artwork = createChartArtwork({
      localization,
      publicData: data,
      title: (chart) => catalogQuery.titleLabel(chart, localization.locale) || chart.title,
      asset: (path) => navigation.asset(path),
    });
    const overview = createChartOverview({
      root: document.body,
      definitions,
      sections,
      analysis,
      catalogDetails: details,
      catalogQuery,
      localization,
      patternLibrary: {
        show: (id, button) => {
          if (patternLibrary) return patternLibrary.show(id, button);
          void navigation.browserAction(() => {
            patternLibrary!.show(id, button);
          });
          return true;
        },
      },
      publicData: data,
    });
    return { analysis, chartLinks, artwork, overview };
  }
  const patternFilter = createPatternFilter({
    root: document.body,
    definitions,
    browserState,
    localization,
    usage,
  });
  const registry = createRegistryBrowser({
    root: document.body,
    browserState,
    catalogQuery,
    localization,
    usage,
  });
  let browserJob: Promise<void> | undefined;
  function initializeBrowser(catalog: LoadedCatalog) {
    loaded = catalog;
    const publicData = loaded.data;
    fullContext = chartContext(publicData, loaded.details);
    const { analysis, chartLinks, artwork, overview } = fullContext;
    patternLibrary = createPatternLibrary({
      root: document.body,
      definitions,
      analysis,
      localization,
      previewField,
      usage,
      configuration,
    });
    comparison = createChartComparison({
      root: document.body,
      browserState,
      catalogQuery,
      matching,
      artwork,
      chartLinks,
      overview,
      localization,
      personal,
      registry,
      songSearch,
      usage,
      historyPort,
    });
    controller = navigation.silent(() =>
      createChallengeReview({
        root: document.body,
        browserState,
        catalogFilters,
        catalogQuery,
        artwork,
        comparison: comparison!,
        chartLinks,
        overview,
        filterDisclosure,
        localization,
        patternFilter,
        patternLibrary: patternLibrary!,
        personal,
        registry,
        publicData,
        songPages: navigation,
        songSearch,
        usage,
        views,
        historyPort,
      }),
    );
    if (!controller.browserState) throw Error('The research browser could not start.');
    const status = document.getElementById('lab-status');
    if (status && !status.dataset.catalogError) {
      localization.text(status, '');
      if (!loaded.latest) {
        localization.text(status, 'You are viewing an older catalog. ');
        const link = document.createElement('a'),
          latest = new URL(location.href);
        latest.searchParams.delete('version');
        link.href = latest.href;
        localization.text(link, 'Open the latest catalog');
        status.append(link);
      }
    }
    if (directSong) window.dispatchEvent(new Event('maimai:browser-ready'));
  }
  const loadBrowser = () =>
    (browserJob ??= (initialCatalog ?? readCatalog()).then(initializeBrowser, (error: unknown) => {
      // Acquisition has not constructed catalog views. A later intent may retry it.
      // Activation failures stay cached: retrying partially mounted views duplicates owners.
      browserJob = undefined;
      throw error;
    }));
  const browser: BrowserPort = Object.freeze({
    load: loadBrowser,
    cancelRestoration: () => browserState.cancelRestoration(),
    capture: () => browserState.capture(),
    restore: (value: BrowserSnapshot) => browserState.restore(value),
    version: (value: string) => browserState.version(value),
    open: () => browserState.open(),
    ready: personal.ready,
    song: async (content: HTMLElement) => {
      const node = content.querySelector<HTMLElement>('[data-song-id]');
      if (!node?.dataset.songId) throw Error('Missing public song identity');
      let data: PublicCatalog;
      let context: ReturnType<typeof chartContext> | undefined;
      if (fullContext && loaded) {
        if (
          node.dataset.catalogSha256 &&
          node.dataset.catalogSha256 !== loaded.hash &&
          !new URLSearchParams(location.search).has('version')
        )
          throw Error('Song page belongs to another catalog revision');
        data = loaded.data;
        context = fullContext;
      } else if (
        !(node.dataset.songCatalog || node.dataset.songBinding) ||
        new URLSearchParams(location.search).has('version')
      ) {
        await loadBrowser();
        data = loaded!.data;
        context = fullContext!;
      } else {
        data = await loadSongCatalog(reader, {
          song: node.dataset.songId,
          catalog: node.dataset.catalogSha256 ?? '',
          binding: node.dataset.songBinding ? JSON.parse(node.dataset.songBinding) : undefined,
          asset: {
            path: node.dataset.songCatalog,
            sha256: node.dataset.songSha256,
            bytes: Number(node.dataset.songBytes),
          },
        });
      }
      // Construction and session configuration happen only after navigation commits this intent.
      return (root: HTMLElement, international: boolean) => {
        context ??= chartContext(data);
        songData = data;
        if (!loaded) {
          personal.configure(data, data.provider_mapping);
          const status = document.getElementById('lab-status');
          if (status && !status.dataset.catalogError) localization.text(status, '');
        }
        return mountSongView(root, international, {
          data,
          components: {
            localization,
            artwork: context.artwork,
            links: context.chartLinks.group,
            overview: context.overview,
            personal,
          },
          romaji: songSearch.romaji,
          compare: (id, similar) => {
            void navigation.browserAction(() => controller!.compareChart!(id, similar));
          },
          changed: personal.subscribe,
          usage,
        });
      };
    },
  });
  if (!directSong) await loadBrowser();
  navigation.attach(browser, metadata);
  document
    .querySelectorAll<HTMLElement>('main[data-seo-page],body>.site-header')
    .forEach((node) => {
      if (metadata && !directSong) node.hidden = true;
    });
  const wrapper = document.querySelector<HTMLElement>('[data-version-browser]');
  if (wrapper && !directSong) {
    wrapper.hidden = false;
    document.documentElement.classList.remove('seo-static');
  }
  window.dispatchEvent(new Event('maimai:browser-ready'));
  return {
    browser,
    localization,
    services: {
      localization,
      settings,
      views,
      playerRanges,
      playerCore,
      maishift,
      playerSources,
      playerStorage,
      playerDomain,
      personal,
      visuals,
      get patternLibrary() {
        return patternLibrary;
      },
      matching,
      get chartLinks() {
        return fullContext?.chartLinks;
      },
      get artwork() {
        return fullContext?.artwork;
      },
      filterDisclosure,
      catalogFilters,
      get overview() {
        return fullContext?.overview;
      },
      patternFilter,
      registry,
      get comparison() {
        return comparison;
      },
      browserState: browser,
      previewField,
      get publicData() {
        return loaded?.canonical ?? songData;
      },
      get catalogDetails() {
        return loaded?.details;
      },
      catalogQuery,
      songPages: navigation,
      songSearch,
      usage,
      features: configuration.features,
      playerContext,
    },
  };
}
