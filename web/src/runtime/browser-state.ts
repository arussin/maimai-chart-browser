import type {BrowserSnapshot, Locale, SortKey, SortRule, LocalizationPort} from './contracts';
import type {PositionRestorer} from './position';
import type {UsageAPI} from '../usage';

const publicKeys: readonly SortKey[] = [
  'title', 'artist', 'constant', 'bpm', 'difficulty', 'format', 'genre', 'version', 'speed', 'peak',
];
const personalKeys: readonly SortKey[] = ['rating', 'achievement', 'grade', 'lastPlayed'];
const allKeys = new Set<SortKey>([...publicKeys, ...personalKeys]);
const grades = ['D', 'C', 'B', 'BB', 'BBB', 'A', 'AA', 'AAA', 'S', 'S+', 'SS', 'SS+', 'SSS', 'SSS+'];
const locales = new Set<Locale>(['en', 'ja', 'ko', 'zh-Hans']);
const disclosureIds = new Set(['catalog-filters-toggle', 'player-filters-toggle']);
const menuIds = new Set(['version-filter', 'difficulty-filter', 'pattern-filter']);

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function restoreSortRules(value: unknown): SortRule[] {
  if (!Array.isArray(value)) return [{key: 'title', direction: 1}];
  const valid = value.filter((row): row is SortRule =>
    object(row) && allKeys.has(row.key as SortKey) && [1, -1].includes(Number(row.direction)) &&
    typeof row.direction === 'number');
  return valid.length ? valid.map(({key, direction}) => ({key, direction})) : [{key: 'title', direction: 1}];
}

export function effectiveSortRules(requested: readonly SortRule[], personalReady: boolean): SortRule[] {
  const rules = requested.filter(rule => personalReady || !personalKeys.includes(rule.key));
  return rules.length ? [...rules] : [{key: 'title', direction: 1}];
}

export interface PersonalFilters {
  recorded: string;
  grade: Set<string>;
  min: string;
  max: string;
  rateMin: string;
  rateMax: string;
  lamp: string;
  sync: string;
}

interface ComparisonState {
  left: string | null;
  right: string | null;
  similar: boolean;
  priority: 'patterns' | 'measurements';
  useFilters: boolean;
}

interface FilterValue {
  difficulties: string[];
  low: number | null;
  high: number | null;
}

interface TransientView {
  auxiliary: BrowserSnapshot['auxiliary'];
  scroll: [number, number];
  focus: string | null;
  locale: Locale;
}

interface CatalogIdentity {
  catalog: {chart_id: string}[];
  source_catalog_sha256?: string;
  navigation?: {versions?: string[]};
}

export interface BrowserViewPort {
  readTransient(): TransientView;
  writeControls(snapshot: BrowserSnapshot): void;
  render(): void;
  writeDisclosures(snapshot: BrowserSnapshot): void;
  openRoute(): void;
  versionChanged(): void;
  position: Pick<PositionRestorer, 'cancel' | 'restore'>;
  localization: LocalizationPort;
  usage: Pick<UsageAPI, 'suspend'>;
}

/** One authoritative public-control state shared by DOM adapters and navigation.
 * Player records, source URLs, credentials and private import state are excluded.
 * Mutable sets/objects keep a stable identity for existing view adapters.
 */
export class BrowserState {
  visible = 40;
  format = 'all';
  search = '';
  genre = '';
  sortRules: SortRule[] = [{key: 'title', direction: 1}];
  readonly selectedVersions = new Set<string>();
  readonly selectedCharts = new Map<string, string>();
  readonly expandedRows = new Set<string>();
  readonly patterns = new Set<string>();
  readonly difficulties = new Set<string>();
  readonly level = {low: 0, high: 0};
  readonly region: {availability: '' | 'JP' | 'INTL'; international: boolean} = {
    availability: '', international: false,
  };
  readonly personal: PersonalFilters = {
    recorded: '', grade: new Set(), min: '', max: '', rateMin: '', rateMax: '', lamp: '', sync: '',
  };
  readonly comparison: ComparisonState = {
    left: null, right: null, similar: false, priority: 'patterns', useFilters: false,
  };
  readonly disclosures = new Map<string, {expanded: boolean}>();
  readonly history = new Set<string>();
  readonly sections = {chart: true, player: true};
  private readonly chartIds = new Set<string>();
  private readonly versions = new Set<string>();
  private readonly patternIds = new Set<string>();
  private readonly difficultyIds = new Set<string>();
  private levels: number[] = [];
  private catalogHash: string | null = null;
  private view: BrowserViewPort | undefined;

  disclosure(id: string): {expanded: boolean} {
    let value = this.disclosures.get(id);
    if (!value) {
      value = {expanded: false};
      this.disclosures.set(id, value);
    }
    return value;
  }

  configure(data: CatalogIdentity): void {
    this.chartIds.clear();
    data.catalog.forEach(chart => this.chartIds.add(chart.chart_id));
    this.versions.clear();
    data.navigation?.versions?.forEach(version => this.versions.add(version));
    this.catalogHash = data.source_catalog_sha256 ?? null;
  }

  bind(view: BrowserViewPort): this {
    this.view = view;
    return this;
  }

  configureLevels(difficulties: string[], levels: number[]): void {
    this.difficultyIds.clear();
    difficulties.forEach(value => this.difficultyIds.add(value));
    this.levels = [...levels];
    this.level.high = Math.max(0, levels.length - 1);
  }

  configurePatterns(ids: string[]): void {
    this.patternIds.clear();
    ids.forEach(value => this.patternIds.add(value));
  }

  setPatterns(values: unknown): void {
    this.patterns.clear();
    strings(values).filter(value => this.patternIds.has(value)).forEach(value => this.patterns.add(value));
  }

  filterSnapshot(): FilterValue {
    return {
      difficulties: [...this.difficulties],
      low: this.levels[this.level.low] ?? null,
      high: this.levels[this.level.high] ?? null,
    };
  }

  restoreFilters(value: unknown): void {
    if (!object(value) || !Array.isArray(value.difficulties)) return;
    this.difficulties.clear();
    strings(value.difficulties).filter(item => this.difficultyIds.has(item))
      .forEach(item => this.difficulties.add(item));
    const minimum = this.levels.indexOf(value.low as number);
    const maximum = this.levels.indexOf(value.high as number);
    this.level.low = minimum < 0 ? 0 : minimum;
    this.level.high = maximum < this.level.low ? Math.max(this.level.low, this.levels.length - 1) : maximum;
  }

  restorePersonal(value: unknown): void {
    if (!object(value)) return;
    for (const key of ['recorded', 'min', 'max', 'rateMin', 'rateMax', 'lamp', 'sync'] as const) {
      this.personal[key] = typeof value[key] === 'string' && value[key].length <= 32 ? value[key] : '';
    }
    this.personal.grade.clear();
    strings(value.grade).filter(grade => grades.includes(grade)).forEach(grade => this.personal.grade.add(grade));
  }

  setRegion(value: string): void {
    this.region.availability = value === 'JP' || value === 'INTL' ? value : '';
    this.region.international = value === 'INTL';
  }

  restoreRegion(value: unknown): void {
    if (!object(value) || !['', 'JP', 'INTL'].includes(String(value.availability)) ||
        typeof value.international !== 'boolean') return;
    this.region.availability = value.availability as '' | 'JP' | 'INTL';
    this.region.international = value.international;
  }

  chooseComparison(side: 'left' | 'right', id: string | null): void {
    this.comparison[side] = id && this.chartIds.has(id) ? id : null;
  }

  changeSort(key: SortKey, keep: boolean): void {
    if (!allKeys.has(key)) return;
    const prior = this.sortRules.find(rule => rule.key === key);
    const direction = personalKeys.includes(key) ? -1 : 1;
    if (keep) {
      if (prior) prior.direction = prior.direction === 1 ? -1 : 1;
      else this.sortRules.push({key, direction});
    } else {
      this.sortRules = [{key, direction: prior && this.sortRules[0] === prior ?
        (prior.direction === 1 ? -1 : 1) : direction}];
    }
    this.selectedCharts.clear();
    this.visible = 40;
  }

  removeSort(index: number): void {
    this.sortRules.splice(index, 1);
    if (!this.sortRules.length) this.sortRules = [{key: 'title', direction: 1}];
    this.selectedCharts.clear();
  }

  capture(): BrowserSnapshot {
    if (!this.view) throw Error('Browser state is not mounted');
    const transient = this.view.readTransient();
    return {
      schemaVersion: 1,
      catalogHash: this.catalogHash,
      search: this.search,
      genre: this.genre,
      format: this.format,
      versions: [...this.selectedVersions],
      sortRules: this.sortRules.map(rule => ({...rule})),
      chartFilters: this.filterSnapshot(),
      patterns: [...this.patterns],
      region: {...this.region},
      personal: {...this.personal, grade: [...this.personal.grade]},
      visible: this.visible,
      selectedCharts: [...this.selectedCharts],
      expandedRows: [...this.expandedRows],
      history: [...this.history],
      disclosures: [...this.disclosures].map(([id, value]) => [id, String(value.expanded)]),
      comparison: {...this.comparison},
      sections: {...this.sections},
      ...transient,
    };
  }

  private restoreIdentities(value: Record<string, unknown>): void {
    this.selectedVersions.clear();
    strings(value.versions).filter(version => this.versions.has(version))
      .forEach(version => this.selectedVersions.add(version));
    this.selectedCharts.clear();
    if (Array.isArray(value.selectedCharts)) {
      for (const pair of value.selectedCharts) {
        if (Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'string' &&
            this.chartIds.has(pair[0]) && this.chartIds.has(pair[1])) {
          this.selectedCharts.set(pair[0], pair[1]);
        }
      }
    }
    this.expandedRows.clear();
    strings(value.expandedRows).filter(id => this.chartIds.has(id)).forEach(id => this.expandedRows.add(id));
    if (object(value.comparison)) {
      this.chooseComparison('left', text(value.comparison.left));
      this.chooseComparison('right', text(value.comparison.right));
      this.comparison.similar = value.comparison.similar === true;
      this.comparison.priority = value.comparison.priority === 'measurements' ? 'measurements' : 'patterns';
      this.comparison.useFilters = value.comparison.useFilters === true;
    }
    if (object(value.sections)) {
      for (const key of ['chart', 'player'] as const) {
        if (typeof value.sections[key] === 'boolean') this.sections[key] = value.sections[key];
      }
    }
  }

  private restorePresentation(value: Record<string, unknown>): BrowserSnapshot {
    const rows = Array.isArray(value.disclosures) ? value.disclosures : [];
    const disclosures: BrowserSnapshot['disclosures'] = rows.filter((row): row is [string, string] =>
      Array.isArray(row) && disclosureIds.has(String(row[0])) && ['true', 'false'].includes(String(row[1])));
    for (const [id, expanded] of disclosures) this.disclosure(id).expanded = expanded === 'true';
    const history = strings(value.history).filter(id =>
      id.startsWith('saved-pbs-') && this.chartIds.has(id.slice(10)));
    this.history.clear();
    history.forEach(id => this.history.add(id));
    const auxiliary = object(value.auxiliary) ? {
      sortKeep: value.auxiliary.sortKeep === true,
      patternSearch: text(value.auxiliary.patternSearch),
      menus: (Array.isArray(value.auxiliary.menus) ? value.auxiliary.menus : [])
        .filter((row): row is [string, boolean] => Array.isArray(row) &&
          menuIds.has(String(row[0])) && typeof row[1] === 'boolean'),
    } : undefined;
    const scroll: [number, number] = Array.isArray(value.scroll) && value.scroll.length === 2 &&
      value.scroll.every(n => typeof n === 'number' && Number.isFinite(n)) ?
      [value.scroll[0], value.scroll[1]] : [0, 0];
    // Forward only documented public controls, never arbitrary history input.
    return {...this.capture(), disclosures, history, auxiliary, scroll,
      focus: typeof value.focus === 'string' ? value.focus : null};
  }

  restore(value: unknown): boolean {
    this.view?.position.cancel();
    if (!this.view || !object(value) || value.schemaVersion !== 1 || value.catalogHash !== this.catalogHash) {
      return false;
    }
    const view = this.view;
    view.usage.suspend(() => {
      if (locales.has(value.locale as Locale)) view.localization.setLocale(value.locale as Locale, {persist: false});
      this.search = text(value.search);
      this.genre = text(value.genre);
      this.format = ['all', 'STD', 'DX'].includes(String(value.format)) ? String(value.format) : 'all';
      this.restoreIdentities(value);
      this.sortRules = restoreSortRules(value.sortRules);
      this.restoreFilters(value.chartFilters);
      this.setPatterns(value.patterns);
      this.restoreRegion(value.region);
      this.restorePersonal(value.personal);
      this.visible = Number.isSafeInteger(value.visible) ?
        Math.max(40, Math.min(this.chartIds.size, value.visible as number)) : 40;
      const clean = this.restorePresentation(value);
      view.writeControls(clean);
      view.render();
      view.writeDisclosures(clean);
      view.position.restore(clean);
    });
    return true;
  }

  version(value: string): boolean {
    if (!this.versions.has(value)) return false;
    this.selectedVersions.clear();
    this.selectedVersions.add(value);
    this.visible = 40;
    this.view?.versionChanged();
    return true;
  }

  open(): void {
    this.view?.position.cancel();
    this.view?.openRoute();
  }
}
