import type { UsageAPI } from '../usage';
export type Locale = 'en' | 'ja' | 'ko' | 'zh-Hans';
export type Tab = 'catalog' | 'patterns' | 'compare' | 'about';
export type SortKey =
  | 'title'
  | 'artist'
  | 'constant'
  | 'bpm'
  | 'difficulty'
  | 'format'
  | 'genre'
  | 'version'
  | 'speed'
  | 'peak'
  | 'rating'
  | 'achievement'
  | 'grade'
  | 'lastPlayed';
export interface SortRule {
  key: SortKey;
  direction: 1 | -1;
}
export interface BrowserSnapshot {
  schemaVersion: 1;
  catalogHash: string | null;
  search: string;
  genre: string;
  format: string;
  versions: string[];
  sortRules: SortRule[];
  chartFilters: unknown;
  patterns: string[];
  region?: { availability: string; international: boolean };
  personal?: unknown;
  visible: number;
  selectedCharts: [string, string][];
  expandedRows: string[];
  comparison?: {
    left: string | null;
    right: string | null;
    similar?: boolean;
    priority?: 'patterns' | 'measurements';
    useFilters?: boolean;
  };
  sections?: { chart: boolean; player: boolean };
  history: string[];
  disclosures: [string, string | null | undefined][];
  scroll: [number, number];
  focus: string | null;
  locale?: Locale;
  auxiliary?: { sortKeep: boolean; patternSearch: string; menus: [string, boolean][] };
}
export interface SongWorkspacePort {
  region(international: boolean): void;
  dispose(): void;
}
export interface BrowserPort {
  cancelRestoration(): void;
  capture(): BrowserSnapshot;
  restore(value: BrowserSnapshot): boolean | Promise<boolean>;
  version(value: string): boolean;
  open(): void;
  ready: Promise<void>;
  song(root: HTMLElement, international: boolean): SongWorkspacePort;
}
export interface LocalizationPort {
  readonly locale: Locale;
  setLocale(locale: string, options?: { persist?: boolean }): void;
}
export interface ReturnTarget {
  url: string;
  snapshot: BrowserSnapshot;
}
export interface NavigationEntry {
  maimaiBrowserState?: BrowserSnapshot | null;
  maimaiReturn?: ReturnTarget | null;
  maimaiBrowserURL?: string;
  maimaiInternational?: boolean;
  maimaiOpenBrowser?: boolean;
}
export interface PageMetadata {
  title: string;
  language: string;
  nodes: Element[];
}
export interface NavigationPorts {
  usage: UsageAPI;
  loadBrowser: () => Promise<BrowserPort>;
  localization: () => LocalizationPort | undefined;
}
