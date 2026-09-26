import { createChartCard } from '../components/chart-card';
import { PositionRestorer } from '../runtime/position';
import { effectiveSortRules } from '../runtime/browser-state';
import type { CatalogChart, PublicCatalog } from '../runtime/catalog';
import type * as CatalogQuery from '../catalog-query';
import type { BrowserState } from '../runtime/browser-state';
import type { Tab, SortKey, SortRule, LocalizationPort } from '../runtime/contracts';
import type { HistoryPort } from '../runtime/history';
import type { NavigationCoordinator } from '../runtime/navigation';
import type { createTabs } from '../runtime/tabs';
import type {
  TextView,
  LocalizedText,
  ChartCardPresentation,
  ChartCardComponents,
} from '../components/chart-card';
import type { createChartArtwork } from './chart-artwork';
import type { createChartLinks } from './chart-links';
import type { createChartOverview } from './chart-overview';
import type { createChartFilters } from './chart-filters';
import type { createChartComparison } from './chart-comparison';
import type { createPatternFilter } from './pattern-filter';
import type { createPatternLibrary } from './pattern-library';
import type { createRegistryBrowser } from './registry-browser';
import type { createSongSearch } from './song-search';
import type { UsageAPI } from '../usage';
interface PersonalView {
  ready: Promise<void>;
  configure(data: PublicCatalog, mapping: PublicCatalog['provider_mapping']): void;
  record(chart: CatalogChart): { achievement?: number | null; rate?: number | null } | null;
  summary(chart: CatalogChart): HTMLElement;
  details(chart: CatalogChart): HTMLElement;
  matches(chart: CatalogChart): boolean;
  controls(root: HTMLElement, changed: () => void): { clear(): void; sync(): void } | undefined;
  lastPlayed(chart: CatalogChart): number | null;
  gradeIndex(chart: CatalogChart): number | null;
  enabled(): boolean;
  subscribe(listener: () => void): () => unknown;
}
interface ReviewPorts {
  root: HTMLElement;
  localization: TextView & LocalizationPort & { original(node: Node): LocalizedText | null };
  publicData: PublicCatalog;
  browserState: BrowserState;
  catalogQuery: typeof CatalogQuery;
  registry: ReturnType<typeof createRegistryBrowser>;
  chartLinks: ReturnType<typeof createChartLinks>;
  artwork: ReturnType<typeof createChartArtwork>;
  overview: ReturnType<typeof createChartOverview>;
  catalogFilters: ReturnType<typeof createChartFilters>['catalogFilters'];
  filterDisclosure: ReturnType<typeof createChartFilters>['filterDisclosure'];
  patternFilter: ReturnType<typeof createPatternFilter>;
  patternLibrary: ReturnType<typeof createPatternLibrary>;
  comparison: ReturnType<typeof createChartComparison>;
  songSearch: ReturnType<typeof createSongSearch>;
  personal: PersonalView;
  views: ReturnType<typeof createTabs>;
  historyPort: HistoryPort;
  songPages: NavigationCoordinator;
  usage: UsageAPI;
}
interface BrowserElements {
  [key: string]: HTMLElement;
  search: HTMLInputElement;
  'filter-genre': HTMLSelectElement;
  'sort-keep': HTMLInputElement;
  'catalog-filters-toggle': HTMLButtonElement;
  'use-international-data': HTMLInputElement;
  'pattern-filter-search': HTMLInputElement;
  'version-filter': HTMLDetailsElement;
  'difficulty-filter': HTMLDetailsElement;
  'pattern-filter': HTMLDetailsElement;
}
/** Browser DOM adapter; navigation, persistent state and data preparation are supplied. */
export function createChallengeReview(ports: ReviewPorts) {
  const root = ports.root,
    document = root.ownerDocument,
    window = document.defaultView!,
    location = window.location,
    history = window.history,
    i18n = ports.localization;
  const el = <K extends keyof BrowserElements>(id: K) =>
    root.querySelector<BrowserElements[K]>('#' + id)!;
  let data = ports.publicData;
  try {
    // Preserve the adapter's in-place normalization contract on a detached application view.
    if (data.schema_version === 'maimai-browser-catalog-2')
      data = ports.catalogQuery.createView(data);
    data = ports.registry.normalize(data);
  } catch (error) {
    let status = el('lab-status');
    if (!status) {
      status = document.createElement('p');
      status.id = 'lab-status';
      status.setAttribute('role', 'alert');
      el('catalog').prepend(status);
    }
    status.dataset.catalogError = 'genre';
    i18n.text(
      status,
      error instanceof Error ? error.message : 'The research browser could not start.',
    );
    return {};
  }
  ports.chartLinks.configure(data.mai_notes);
  const byId = new Map(data.catalog.map((c) => [c.chart_id, c]));
  const make = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text?: LocalizedText,
    cls?: string,
  ) => {
    const e = document.createElement(tag);
    if (text !== undefined) i18n.text(e, text);
    if (cls) e.className = cls;
    return e;
  };
  const state = ports.browserState;
  state.configure(data);
  let comparisonUI: ReturnType<ReviewPorts['comparison']['mount']> | null = null;
  const navigation = data.navigation || { charts: {}, genres: [], versions: [] };
  const overview = ports.overview;
  const personal = ports.personal;
  personal?.configure(data, data.provider_mapping);
  function folderValue(c: CatalogChart, mode: 'genre' | 'version' | 'level') {
    if (mode === 'level') return c.level || 'unknown';
    const n = navigation.charts[c.chart_id];
    return n && n.source_hash === c.source_hash ? n[mode] || 'unknown' : 'unknown';
  }
  const displayTitle = (c: CatalogChart) =>
    ports.catalogQuery?.titleLabel(c, i18n.locale) ||
    (c.title.trim() ? c.title : '〈Blank title〉');

  function selectView(name: Tab) {
    ports.views.show(name);
    ports.patternLibrary.stop();
    if (name === 'catalog') catalog();
    else if (name === 'compare') comparisonUI?.render();
    else if (name === 'patterns') ports.patternLibrary.render();
  }
  const difficultyOrder = ['BASIC', 'ADVANCED', 'EXPERT', 'MASTER', 'RE:MASTER'];
  const difficultyRank = (c: CatalogChart) => {
    const rank = difficultyOrder.indexOf(c.difficulty.toUpperCase());
    return rank < 0 ? null : rank;
  };
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const chartConstant = (c: CatalogChart) => {
    const record = navigation.charts?.[c.chart_id],
      value = record?.chart_constant;
    return (c.variant_id
      ? record?.chart_id === c.chart_id
      : record?.source_hash === c.source_hash) &&
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value > 0 &&
      value <= 15
      ? value
      : null;
  };
  const constantLabel = (c: CatalogChart) =>
    chartConstant(c) == null ? '—' : chartConstant(c)!.toFixed(1);
  const sortFields: Partial<Record<SortKey, string>> = {
    title: 'Title',
    artist: 'Artist',
    constant: 'Source constant',
    bpm: 'BPM',
    difficulty: 'Difficulty',
    format: 'Format',
    genre: 'Genre',
    version: 'Version',
    speed: 'Inputs / s',
    peak: 'Peak inputs / s',
  };

  const personalSorts: Partial<Record<SortKey, string>> = {
    rating: 'Your RT',
    achievement: 'Your achievement',
    grade: 'Your grade',
    lastPlayed: 'Last recorded play',
  };
  const filters = ['genre'] as const;
  let chartFilters: ReturnType<ReviewPorts['catalogFilters']['mount']>;
  let patternFilter: ReturnType<ReviewPorts['patternFilter']['mount']>;
  let regionFilter: ReturnType<ReviewPorts['registry']['mount']>;
  const versionLabel = (value: string) =>
    value.replace(/^maimai DX /, 'DX ').replace(/^maimai /, '');
  const genreLabel = (value: string) =>
    (navigation.genres || []).find((g) => g.id === value)?.label || 'Uncategorized';
  const values = {
    title: (c: CatalogChart) => displayTitle(c),
    artist: (c: CatalogChart) => c.artist,
    constant: chartConstant,
    bpm: (c: CatalogChart) => navigation.charts?.[c.chart_id]?.bpm ?? null,
    difficulty: (c: CatalogChart) => ports.catalogFilters.levelNumber(c.level),
    format: (c: CatalogChart) => c.format,
    genre: (c: CatalogChart) => genreLabel(folderValue(c, 'genre')),
    version: (c: CatalogChart) => {
      const v = (navigation.versions || []).indexOf(folderValue(c, 'version'));
      return v < 0 ? null : v;
    },
    speed: (c: CatalogChart) => c.demand?.cadence?.mean_onsets_s ?? null,
    peak: (c: CatalogChart) => {
      const record = overview.get(c);
      if (record && Object.hasOwn(record, 'flow_peak')) return record.flow_peak;
      const peaks = (record?.segments || [])
        .filter((s) => s[3] != null && s[4] > 0)
        .map((s) => s[3]!);
      return peaks.length ? Math.max(...peaks) : null;
    },
    achievement: (c: CatalogChart) => personal?.record(c)?.achievement ?? null,
    grade: (c: CatalogChart) => personal?.gradeIndex(c) ?? null,
    rating: (c: CatalogChart) => personal?.record(c)?.rate ?? null,
    lastPlayed: (c: CatalogChart) => personal?.lastPlayed(c) ?? null,
  };

  const rowKey = (c: CatalogChart) =>
    JSON.stringify([
      c.variant_id
        ? c.song_id
        : navigation.charts?.[c.chart_id]?.source_path || c.source_container_id || c.song_id,
      c.format,
      c.variant_id || 'ordinary',
    ]);
  function compareCharts(a: CatalogChart, b: CatalogChart, rules: readonly SortRule[]) {
    for (const rule of rules) {
      if (!rule.key) continue;
      const av = values[rule.key](a),
        bv = values[rule.key](b);
      // Unknown measurements stay at the end in either direction.
      if (av == null || bv == null) {
        if (av !== bv) return av == null ? 1 : -1;
        continue;
      }
      const diff = typeof av === 'number' ? av - Number(bv) : collator.compare(av, String(bv));
      if (diff) return diff * rule.direction;
    }
    const title = collator.compare(displayTitle(a), displayTitle(b));
    if (title) return title;
    const al = values.difficulty(a),
      bl = values.difficulty(b);
    if (al !== bl) {
      if (al == null || bl == null) return al == null ? 1 : -1;
      return bl - al;
    }
    return (
      (difficultyRank(b) ?? -1) - (difficultyRank(a) ?? -1) ||
      collator.compare(a.format, b.format) ||
      a.chart_id.localeCompare(b.chart_id)
    );
  }
  function sortLabel(rule: SortRule) {
    return (
      (sortFields[rule.key] || personalSorts[rule.key]) +
      (['title', 'artist', 'genre', 'format'].includes(rule.key)
        ? rule.direction === 1
          ? ' A–Z'
          : ' Z–A'
        : rule.direction === 1
          ? ' ↑'
          : ' ↓')
    );
  }

  function renderSort() {
    const chips = el('sort-rules');
    chips.replaceChildren();
    state.sortRules.forEach((rule, index) => {
      const b = make('button', index + 1 + '. ' + sortLabel(rule) + ' ×', 'filter-chip');
      i18n.attribute(
        b,
        'aria-label',
        'Remove ' + (sortFields[rule.key] || personalSorts[rule.key]) + ' sort priority',
      );
      b.onclick = () => {
        state.removeSort(index);
        renderSort();
        catalog();
        root.querySelector<HTMLElement>('[data-sort-key="' + rule.key + '"]')!.focus();
      };
      chips.append(b);
    });
    for (const button of root.querySelectorAll<HTMLElement>('[data-sort-key]')) {
      const key = button.dataset.sortKey as SortKey,
        index = state.sortRules.findIndex((r) => r.key === key),
        rule = state.sortRules[index],
        label =
          key === 'title' ? 'Song / artist' : key === 'peak' ? 'Flow · peak' : sortFields[key];
      const indicator = make(
        'span',
        rule ? (rule.direction === 1 ? '↑' : '↓') : '↕',
        'sort-indicator',
      );
      indicator.setAttribute('aria-hidden', 'true');
      if (rule) indicator.append(make('span', String(index + 1), 'sort-priority'));
      button.replaceChildren(make('span', label, 'sort-label'), indicator);
      button.setAttribute('aria-pressed', String(!!rule));
      i18n.attribute(
        button,
        'aria-label',
        label +
          (rule
            ? ', priority ' +
              (index + 1) +
              ', ' +
              (rule.direction === 1 ? 'ascending' : 'descending')
            : ' unsorted'),
      );
      button.onclick = (event) => {
        state.changeSort(key, event.shiftKey || el('sort-keep').checked);
        renderSort();
        catalog();
        button.focus();
      };
    }
  }
  function initializeFilters() {
    ports.filterDisclosure(
      el('catalog-filters'),
      el('catalog-filters-toggle'),
      el('catalog-filter-content').firstElementChild as HTMLElement,
      'maimai-catalog-filters-collapsed',
    );
    chartFilters = ports.catalogFilters.mount(data.catalog, () => {
      state.visible = 40;
      catalog();
    });
    patternFilter = ports.patternFilter.mount(overview, () => {
      state.visible = 40;
      writePatternFilter();
      catalog();
    });
    for (const id of filters) {
      const select = el(`filter-${id}`);
      let options: [string, string][] = [];
      if (id === 'genre') options = (navigation.genres || []).map((g) => [g.id, g.label]);
      for (const [value, label] of options) {
        const option = i18n.option(label, value);
        select.append(option);
      }
      select.onchange = () => {
        ports.usage?.emit('filter_first_used', undefined, 'genre');
        state.visible = 40;
        catalog();
      };
    }
    for (const key of ['all', 'STD', 'DX'])
      el('format-' + key).onclick = () => {
        ports.usage?.emit('filter_first_used', undefined, 'format');
        state.format = key;
        state.visible = 40;
        updateFormat();
        catalog();
      };
    for (const version of navigation.versions || []) {
      const label = make('label'),
        checkbox = make('input');
      checkbox.type = 'checkbox';
      checkbox.value = version;
      checkbox.onchange = () => {
        ports.usage?.emit('filter_first_used', undefined, 'version');
        if (checkbox.checked) state.selectedVersions.add(version);
        else state.selectedVersions.delete(version);
        state.visible = 40;
        updateVersions();
        catalog();
      };
      const text = make('span', i18n.verbatim(versionLabel(version)), 'version-name'),
        detail = make('small', '', 'version-count');
      detail.setAttribute('aria-hidden', 'true');
      text.append(detail);
      label.append(checkbox, ports.artwork.version(version), text);
      el('version-options').append(label);
    }
    updateVersionCounts();
    el('version-clear').onclick = () => {
      state.selectedVersions.clear();
      state.visible = 40;
      updateVersions();
      catalog();
    };
    el('version-filter').addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        el('version-filter').open = false;
        el('version-summary').focus();
        event.stopPropagation();
      }
    });
    document.addEventListener('click', (event) => {
      if (!el('version-filter').contains(event.target as Node | null))
        el('version-filter').open = false;
    });
    el('reset-filters').onclick = () => {
      ports.usage?.emit('filters_reset', undefined, 'catalog');
      for (const id of filters) el(`filter-${id}`).value = '';
      regionFilter?.clear(false);
      state.selectedVersions.clear();
      updateVersions();
      updateVersionCounts();
      chartFilters.clear();
      patternFilter.clear();
      el('search').value = '';
      state.format = 'all';
      state.visible = 40;
      writePatternFilter();
      updateFormat();
      catalog();
      comparisonUI?.render();
    };
    renderSort();
  }
  function writePatternFilter() {
    const url = new URL(location.href);
    url.searchParams.delete('pattern-filter');
    for (const id of patternFilter.ids()) url.searchParams.append('pattern-filter', id);
    ports.historyPort.replaceState(history.state, '', url);
  }
  function updateVersionCounts() {
    const counts = new Map<string, { charts: number; songs: Set<string> }>();
    for (const chart of data.catalog) {
      const version = folderValue(chart, 'version');
      if (!counts.has(version)) counts.set(version, { charts: 0, songs: new Set() });
      const count = counts.get(version)!;
      count.charts++;
      count.songs.add(rowKey(chart));
    }
    for (const label of el('version-options').querySelectorAll('label')) {
      const count = counts.get(label.querySelector('input')!.value),
        songs = count?.songs.size || 0,
        charts = count?.charts || 0;
      i18n.text(
        label.querySelector('.version-count')!,
        songs + ' song' + (songs === 1 ? '' : 's') + ' · ' + charts + ' charts',
      );
      i18n.attribute(label, 'title', songs + ' song / format entries, ' + charts + ' charts');
    }
  }
  function updateVersions() {
    i18n.text(
      el('version-summary'),
      state.selectedVersions.size === 0
        ? 'All versions'
        : state.selectedVersions.size === 1
          ? i18n.verbatim(versionLabel([...state.selectedVersions][0]))
          : state.selectedVersions.size + ' versions selected',
    );
    for (const input of el('version-options').querySelectorAll('input'))
      input.checked = state.selectedVersions.has(input.value);
  }
  function updateFormat() {
    for (const key of ['all', 'STD', 'DX'])
      el('format-' + key).setAttribute('aria-pressed', String(key === state.format));
  }
  function activeFilters() {
    const root = el('active-filters'),
      chips: HTMLButtonElement[] = [];
    const count =
      Number(!!el('search').value.trim()) +
      Number(state.format !== 'all') +
      Number(state.selectedVersions.size > 0) +
      chartFilters.activeCount() +
      Number(patternFilter.ids().length > 0) +
      Number(!!el('filter-genre').value) +
      Number(!!regionFilter?.value()) +
      Number(!!el('use-international-data')?.checked);
    i18n.text(el('catalog-filter-count'), count ? `${count} active` : '');
    el('catalog-filters-empty').hidden = count > 0;
    el('reset-filters').hidden = count === 0;
    function chip(label: string, remove: () => void) {
      const button = make('button', label + ' ×', 'filter-chip');
      i18n.attribute(button, 'aria-label', 'Remove ' + label + ' filter');
      button.onclick = remove;
      chips.push(button);
    }
    if (el('search').value.trim())
      chip(`Search: ${el('search').value.trim()}`, () => {
        el('search').value = '';
        state.visible = 40;
        catalog();
      });
    if (state.format !== 'all')
      chip(state.format, () => {
        state.format = 'all';
        updateFormat();
        state.visible = 40;
        catalog();
      });
    const international = el('use-international-data');
    if (international?.checked) chip('Use maimai international data', () => international.click());
    if (regionFilter?.value()) chip(regionFilter.label(), () => regionFilter!.clear());
    for (const version of state.selectedVersions) {
      const button = make('button', i18n.verbatim(versionLabel(version) + ' ×'), 'filter-chip');
      i18n.attribute(
        button,
        'aria-label',
        i18n.message('Remove version {0}', [i18n.verbatim(versionLabel(version))]),
      );
      button.onclick = () => {
        state.selectedVersions.delete(version);
        state.visible = 40;
        updateVersions();
        catalog();
        el('version-summary').focus();
      };
      chips.push(button);
    }
    chips.push(...chartFilters.chips(), ...patternFilter.chips());
    for (const id of filters) {
      const select = el(`filter-${id}`);
      if (!select.value) continue;
      const button = make('button', i18n.original(select.selectedOptions[0]) + ' ×', 'filter-chip');
      i18n.attribute(
        button,
        'aria-label',
        'Remove ' + i18n.original(select.parentElement!.firstChild!) + ' filter',
      );
      button.onclick = () => {
        select.value = '';
        state.visible = 40;
        catalog();
        select.focus();
      };
      chips.push(button);
    }
    // Preserve controls during text-field blur so a pending pointer click lands
    // on the same chip after the level filter updates.
    const existing = new Map(
      [...root.querySelectorAll<HTMLButtonElement>(':scope > button')].map((node) => [
        node.getAttribute('aria-label'),
        node,
      ]),
    );
    chips.forEach((candidate, index) => {
      const key = candidate.getAttribute('aria-label'),
        node = existing.get(key) || candidate;
      existing.delete(key);
      i18n.text(node, i18n.original(candidate) ?? '');
      node.onclick = candidate.onclick;
      if (root.children[index] !== node) root.insertBefore(node, root.children[index] || null);
    });
    for (const node of existing.values()) node.remove();
  }
  const cardPresentation: ChartCardPresentation<CatalogChart> = {
    title: displayTitle,
    folder: folderValue,
    genre: genreLabel,
    constant: chartConstant,
    constantSource: (c: CatalogChart) =>
      navigation.charts?.[c.chart_id]?.metric_sources?.chart_constant,
    bpm: values.bpm,
    speed: values.speed,
    romaji: ports.songSearch.romaji,
    difficultyRank,
    patterns: () => patternFilter.ids(),
  };
  const cardComponents: ChartCardComponents<CatalogChart> = {
    localization: i18n,
    artwork: ports.artwork,
    links: ports.chartLinks.group,
    overview,
    personal,
    songLink: ports.songPages?.link.bind(ports.songPages),
  };
  function catalog(focusKey: string | null = null) {
    state.search = el('search').value;
    state.genre = el('filter-genre').value;
    const matchesSearch = ports.songSearch.query(state.search);
    const selected = Object.fromEntries(filters.map((id) => [id, el(`filter-${id}`).value]));
    const region = regionFilter?.value();
    const charts = data.catalog.filter((c) => {
      if (state.format !== 'all' && c.format !== state.format) return false;
      if (!matchesSearch(c)) return false;
      if (selected.genre && folderValue(c, 'genre') !== selected.genre) return false;
      if (!ports.registry.matchesRegion(c, region)) return false;
      if (state.selectedVersions.size && !state.selectedVersions.has(folderValue(c, 'version')))
        return false;
      if (!chartFilters.matches(c)) return false;
      if (!patternFilter.matches(c)) return false;
      if (personal && !personal.matches(c)) return false;
      return true;
    });
    // Each matching chart owns a stable row. A local difficulty change only
    // replaces that row's contents; it must not reorder or hide other charts.
    const grouped = new Map<string, CatalogChart[]>();
    for (const chart of charts) {
      const key = rowKey(chart);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(chart);
    }
    const rules = effectiveSortRules(state.sortRules, personal?.enabled() === true);
    const rows = charts
      .map((chart) => ({ key: chart.chart_id, chart }))
      .sort((a, b) => compareCharts(a.chart, b.chart, rules));
    if (focusKey) {
      state.selectedCharts.delete(focusKey);
      state.visible = Math.max(state.visible, rows.findIndex((row) => row.key === focusKey) + 1);
    }
    el('songs').replaceChildren();
    activeFilters();
    for (const [index, { key, chart }] of rows.slice(0, state.visible).entries()) {
      const choices = grouped.get(rowKey(chart))!;
      const selected = choices.find((c) => c.chart_id === state.selectedCharts.get(key));
      if (!selected) state.selectedCharts.delete(key);
      el('songs').append(
        createChartCard(
          { chart: selected || chart, choices, key, domKey: String(index) },
          cardPresentation,
          cardComponents,
          {
            expanded: () => state.expandedRows.has(key),
            select: (id) => state.selectedCharts.set(key, id),
            expand: (value) => {
              if (value) state.expandedRows.add(key);
              else state.expandedRows.delete(key);
            },
            compare: (id) => {
              selectView('compare');
              if (comparisonUI!.first() && comparisonUI!.first() !== id)
                comparisonUI!.useAsSecond(id);
              else comparisonUI!.useAsFirst(id);
            },
            similar: (id) => {
              selectView('compare');
              comparisonUI!.useAsFirst(id, true);
            },
            usage: ports.usage,
          },
        ),
      );
    }
    const count = el('catalog-count'),
      number = document.createElement('strong'),
      unit = document.createElement('span');
    number.textContent = charts.length.toLocaleString();
    i18n.text(unit, 'charts');
    count.replaceChildren(number, document.createTextNode(' '), unit);
    if (!charts.length)
      el('songs').append(
        make(
          'p',
          'No charts match this combination. Remove a filter or try another search.',
          'empty-state',
        ),
      );
    el('more').hidden = rows.length <= state.visible;
  }

  el('search').oninput = (event) => {
    state.search = el('search').value;
    if ((event as InputEvent).isComposing) return;
    ports.usage?.emit('search_used', undefined, 'charts');
    state.visible = 40;
    catalog();
  };
  el('search').addEventListener('compositionend', () => {
    ports.usage?.emit('search_used', undefined, 'charts');
    state.visible = 40;
    catalog();
  });
  el('more').onclick = () => {
    state.visible += 40;
    catalog();
  };
  for (const name of ['compare', 'catalog', 'patterns', 'about'] as const)
    el(name + '-tab').onclick = () => selectView(name);
  initializeFilters();
  regionFilter = ports.registry.mount(data, () => {
    updateVersionCounts();
    state.visible = 40;
    catalog();
    comparisonUI?.render();
  });
  const personalControls = personal?.controls(el('catalog'), () => {
    state.visible = 40;
    catalog();
  });
  function personalChanged() {
    for (const key of Object.keys(personalSorts) as SortKey[]) delete sortFields[key];
    if (personal?.enabled()) Object.assign(sortFields, personalSorts);
    if (!state.sortRules.length) state.sortRules = [{ key: 'title', direction: 1 }];
    renderSort();
    catalog();
    comparisonUI?.render();
  }
  personal?.subscribe(personalChanged);
  personalChanged();
  comparisonUI = ports.comparison.mount({
    data,
    eligibleIds: () =>
      data.catalog
        .filter((c) => {
          if (state.format !== 'all' && c.format !== state.format) return false;
          if (state.selectedVersions.size && !state.selectedVersions.has(folderValue(c, 'version')))
            return false;
          if (!patternFilter.matches(c)) return false;
          if (personal && !personal.matches(c)) return false;
          if (el('filter-genre').value && folderValue(c, 'genre') !== el('filter-genre').value)
            return false;
          if (!ports.registry.matchesRegion(c, regionFilter?.value())) return false;
          return chartFilters.matches(c);
        })
        .map((c) => c.chart_id),
  });
  const compareChart = (id: string, similar = false) => {
    selectView('compare');
    if (!similar && comparisonUI!.first() && comparisonUI!.first() !== id)
      comparisonUI!.useAsSecond(id);
    else comparisonUI!.useAsFirst(id, similar);
  };
  const params = new URLSearchParams(location.search),
    initialView = params.get('view'),
    initialPattern = params.get('pattern');
  ports.patternLibrary.setDiscovery((id) => {
    ports.usage?.emit('filter_first_used', undefined, 'pattern');
    if (ports.usage?.suspend) ports.usage.suspend(() => el('reset-filters').click());
    else el('reset-filters').click();
    patternFilter.set([id]);
    writePatternFilter();
    selectView('catalog');
    catalog();
    el('pattern-filter-summary').focus();
  });
  ports.patternLibrary.setNavigation((id) => {
    const url = new URL(location.href);
    if (id) url.searchParams.set('pattern', id);
    else url.searchParams.delete('pattern');
    ports.historyPort.replaceState(history.state, '', url);
  });
  function applyRoute() {
    const p = new URLSearchParams(location.search),
      id = ports.registry.resolve(data, p.get('chart') ?? '');
    if (id && p.get('view') === 'catalog') {
      const c = byId.get(id);
      if (c) {
        state.expandedRows.add(id);
        selectView('catalog');
        catalog(id);
        const findRow = () =>
          [...el('songs').querySelectorAll<HTMLElement>(':scope > *')].find(
            (n) => n.dataset.rowKey === id,
          );
        let row = findRow();
        if (!row) {
          el('reset-filters').click();
          personalControls?.clear();
          catalog(id);
          row = findRow();
        }
        row?.scrollIntoView({ block: 'center' });
      } else {
        i18n.text(
          el('catalog-count'),
          'The linked chart is unavailable in this catalog version. Search for the song below.',
        );
      }
    } else if (['catalog', 'patterns', 'compare', 'about'].includes(p.get('view') ?? ''))
      selectView(p.get('view') as Tab);
    if (p.get('search')) {
      el('search').value = p.get('search')!;
      catalog();
    }
  }
  const restoreRoute = () =>
    ports.usage?.suspend ? ports.usage.suspend(applyRoute) : applyRoute();
  restoreRoute();
  const position = new PositionRestorer({
    history: ports.historyPort,
    playerReady: personal.ready,
    linksReady: () => ports.songPages.ready(),
  });
  // DOM translation only; the typed owner validates and commits public snapshots.
  const browserState = state.bind({
    readTransient: () => ({
      auxiliary: {
        sortKeep: el('sort-keep').checked,
        patternSearch: el('pattern-filter-search').value,
        menus: (['version-filter', 'difficulty-filter', 'pattern-filter'] as const).map((id) => [
          id,
          el(id).open,
        ]),
      },
      scroll: [scrollX, scrollY],
      focus: document.activeElement?.id || null,
      locale: ports.localization.locale,
    }),
    writeControls(value) {
      el('search').value = value.search;
      el('filter-genre').value = value.genre;
      chartFilters.sync();
      patternFilter.sync();
      regionFilter?.sync();
      personalControls?.sync();
    },
    render() {
      updateFormat();
      updateVersions();
      updateVersionCounts();
      renderSort();
      catalog();
      comparisonUI?.sync();
    },
    writeDisclosures(value) {
      ports.filterDisclosure.sync();
      if (value.auxiliary) {
        el('sort-keep').checked = value.auxiliary.sortKeep;
        el('pattern-filter-search').value = value.auxiliary.patternSearch;
        el('pattern-filter-search').dispatchEvent(new Event('input'));
        for (const [id, open] of value.auxiliary.menus) (el(id) as HTMLDetailsElement).open = open;
      }
      for (const id of value.history) {
        const toggle = el(id)?.previousElementSibling;
        if (
          toggle?.classList.contains('player-pb-toggle') &&
          toggle.getAttribute('aria-expanded') === 'false'
        )
          (toggle as HTMLElement).click();
      }
    },
    openRoute: restoreRoute,
    versionChanged() {
      updateVersions();
      catalog();
    },
    position,
    localization: ports.localization,
    usage: ports.usage,
  });

  if (initialPattern && ports.patternLibrary.has(initialPattern)) {
    ports.patternLibrary.show(initialPattern);
  }
  return { browserState, selectView, compareChart };
}
