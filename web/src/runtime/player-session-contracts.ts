import type {
  PlayerSource, PlayerStorage, StoreToken
} from '../views/player-storage';
export interface PlayerIdentity {
  key: string;
  provider: string;
  game: string;
  username: string;
  displayName: string
}
export interface PlayerDataset {
  format: string;
  schemaVersion: number;
  revision: string;
  player: PlayerIdentity;
  charts: Record<string, unknown>;
  records: Record<string, unknown>;
  plays: Record<string, string>;
  snapshots: Record<string, {
    capturedAt: number;
    pbs: Record<string, string>
  }
 >;
  captures: Record<string, unknown>;
}
export interface PlayerOffer {
  format: string;
  schemaVersion: number;
  revision: string;
  player: PlayerIdentity;
  capturedAt: number;
  pbCount: number;
  pbCoverage: string;
  playCount: number;
  snapshotIDs: string[];
  captureIDs: string[];
  historyCoverage: string;
  profile?: {
    rating: number | null;
    sessionCount: number
  };
}
export interface SourceConnection extends PlayerSource {
  type: 'report' | 'maishift';
  url: string;
  playerKey: string;
  adapterVersion: number;
  lastChecked: number | null;
  lastSuccess: number | null;
  sourceUpdatedAt: number | null;
  sourceRevision: string;
  profileRating?: number | null;
  contentRevision?: string;
  diagnosticCount?: number;
  diagnostics?: unknown[];
}
export type SourceLocation = {
  type: 'report';
  url: string
}
| {
  type: 'maishift';
  url: string;
  [field: string]: unknown
};
export interface PlayerCore {
  MAX_COMPRESSED: number;
  decode(bytes: Uint8Array | ArrayBuffer): Promise<PlayerDataset>;
  encode(data: PlayerDataset): Promise<Uint8Array>;
  reconcile(data: PlayerDataset): Promise<PlayerDataset>;
  merge(previous: PlayerDataset, next: PlayerDataset): Promise<PlayerDataset>;
  current(data: PlayerDataset): {
    pbs: Map<string, unknown>
  };
  offer(data: PlayerDataset): PlayerOffer;
  validateOffer(value: unknown): PlayerOffer;
  needsUpdate(data: PlayerDataset, offer: PlayerOffer): boolean;
  canonical(value: unknown): string;
  digest(value: unknown): Promise<string>;
}
export interface PlayerSources {
  AUTO_INTERVAL: number;
  reportURL(value: string): {
    url: string;
    manifest: string | null
  };
  validateSource(value: unknown, playerKey: string): SourceConnection | null;
  readSource(source: SourceLocation | SourceConnection, options: {
    signal: AbortSignal;
    expectedPlayer?: string;
    manual?: boolean
  }): Promise<{
    data: PlayerDataset;
    source: SourceConnection
  }
 >;
}
export interface Consent {
  accept: boolean;
  remember: boolean
}
export interface ConsentOptions {
  file?: boolean;
  stale?: boolean;
  connection?: SourceConnection | null;
  rememberDefault?: boolean;
  unmatched?: number | null
}
export type ImportMethod = 'file' | 'report' | 'maishift';
export type ImportStage = 'storage' | 'invalid' | 'unavailable';
export type SessionEvent = 'saved' | 'forgotten' | 'cleared' | 'invalidate';
export interface SessionNotification {
  kind: SessionEvent;
  epoch?: number;
  version?: number
}
export interface SessionEffects {
  changed(redraw?: boolean): void;
  invalidate(): void;
  show(): void;
  hide(): void;
  loadedFailure(): void;
  ask(offer: PlayerOffer, options: ConsentOptions, signal: AbortSignal): Promise<Consent>;
  reading(cancel: () => void): () => void;
  message(title: string, body: string, options?: {
    success: boolean
  }): void;
  recovery(url: string): void;
  usage(event: 'import_opened'): void;
  usage(event: 'import_started' | 'import_completed' | 'import_cancelled', detail: ImportMethod): void;
  usage(event: 'import_failed', detail: ImportMethod, failure: ImportStage): void;
  usage(event: 'data_action', detail: 'forget' | 'clear'): void;
  notify(kind: SessionEvent, token: StoreToken | null): void;
  unmatched(data: PlayerDataset): number;
}
export interface SessionPorts {
  core: PlayerCore;
  sources: PlayerSources;
  storage: PlayerStorage;
  maishift: {
    enrichRatings(previous: PlayerDataset, next: PlayerDataset): Promise<PlayerDataset>
  };
  temporary: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  key(name: string): string;
  effects: SessionEffects;
  refreshAllowed(): boolean;
  clock?: () => number;
}
export interface HandoffTransfer {
  send(type: 'reused' | 'declined' | 'accept' | 'imported' | 'error'): void;
  read(signal: AbortSignal): Promise<ArrayBuffer>;
  close(): void
}
export const importTime = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value> 0 && value <= 8640000000000000 ? value: null;
export const errorMessage = (value: unknown) => value instanceof Error ? value.message: String(value);
export const isAbort = (value: unknown) => value instanceof Error && value.name === 'AbortError';
