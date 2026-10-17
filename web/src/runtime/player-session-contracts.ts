import type { PlayerSource, PlayerStorage, StoreToken } from '../views/player-storage';
import type { PlayerIdentity, PlayerDataset, PlayerRecord } from '../domain/player-data';
import type { EmitArguments } from '../usage-contract';
import type { ImportFile, FileImportOptions, FileImportFormat } from '../domain/import-options';
type WithoutPage<T> = T extends [infer E, unknown?, ...infer Details] ? [E, ...Details] : never;
export type SessionUsage = WithoutPage<EmitArguments>;
import type { DiagnosticSink } from '../diagnostic-contract';
export type { PlayerIdentity, PlayerDataset } from '../domain/player-data';
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
    sessionCount: number;
  };
}
export interface SourceConnection extends PlayerSource {
  type: 'report' | 'maishift' | 'kamaitachi' | 'diving-fish' | 'lxns';
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
  account?: string;
  connectionID?: string;
  warnings?: string[];
  excludedUtage?: number;
}
export type OAuthProvider = 'diving-fish' | 'lxns';
export type SourceLocation =
  | {
      type: 'report';
      url: string;
    }
  | {
      type: 'maishift';
      url: string;
      [field: string]: unknown;
    }
  | { type: 'kamaitachi'; account: string }
  | {
      type: OAuthProvider;
      account?: string;
      connectionID?: string;
      previousConnectionIDs?: string[];
    };
export interface PlayerCore {
  MAX_COMPRESSED: number;
  decode(bytes: Uint8Array | ArrayBuffer): Promise<PlayerDataset>;
  encode(data: PlayerDataset): Promise<Uint8Array>;
  reconcile(data: PlayerDataset): Promise<PlayerDataset>;
  merge(previous: PlayerDataset, next: PlayerDataset): Promise<PlayerDataset>;
  current(data: PlayerDataset): {
    pbs: Map<string, PlayerRecord>;
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
    manifest: string | null;
  };
  validateSource(value: unknown, playerKey: string): SourceConnection | null;
  readSource(
    source: SourceLocation | SourceConnection,
    options: {
      signal: AbortSignal;
      expectedPlayer?: string;
      manual?: boolean;
    },
  ): Promise<{
    data: PlayerDataset;
    source: SourceConnection;
  }>;
  disconnect?(source: SourceLocation | SourceConnection, manual?: boolean): Promise<void>;
}
export interface Consent {
  accept: boolean;
  remember: boolean;
}
export interface ConsentOptions {
  file?: boolean;
  fileExport?: boolean;
  unlinkedObservations?: number;
  snapshotDateUnknown?: boolean;
  excludedUtage?: number;
  stale?: boolean;
  connection?: SourceConnection | null;
  rememberDefault?: boolean;
  unmatched?: number | null;
}
export type ImportMethod =
  | 'file'
  | 'report'
  | 'maishift'
  | 'kamaitachi'
  | OAuthProvider
  | `file:${Exclude<FileImportFormat, 'portable'>}`;
export type ImportStage = 'storage' | 'invalid' | 'unavailable';
export type SessionEvent = 'saved' | 'forgotten' | 'cleared' | 'invalidate';
export interface SessionNotification {
  kind: SessionEvent;
  epoch?: number;
  version?: number;
}
export interface SessionEffects {
  diagnose?: DiagnosticSink;
  changed(redraw?: boolean): void;
  invalidate(): void;
  show(): void;
  hide(): void;
  loadedFailure(): void;
  ask(offer: PlayerOffer, options: ConsentOptions, signal: AbortSignal): Promise<Consent>;
  reading(cancel: () => void): () => void;
  message(
    title: string,
    body: string,
    options?: {
      success: boolean;
    },
  ): void;
  recovery(url: string): void;
  usage(...args: SessionUsage): void;
  notify(kind: SessionEvent, token: StoreToken | null): void;
  unmatched(data: PlayerDataset): number;
}
export interface SessionPorts {
  core: PlayerCore;
  sources: PlayerSources;
  storage: PlayerStorage;
  maishift: {
    enrichRatings(previous: PlayerDataset, next: PlayerDataset): Promise<PlayerDataset>;
  };
  temporary: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  key(name: string): string;
  effects: SessionEffects;
  refreshAllowed(): boolean;
  readFile?(
    file: ImportFile,
    options?: FileImportOptions,
  ): Promise<{
    data: PlayerDataset;
    excludedUtage: number;
    snapshotDateUnknown: boolean;
  }>;
  clock?: () => number;
}
export interface HandoffTransfer {
  send(type: 'reused' | 'declined' | 'accept' | 'imported' | 'error'): void;
  read(signal: AbortSignal): Promise<ArrayBuffer>;
  close(): void;
}
export const importTime = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 8640000000000000
    ? value
    : null;
export const errorMessage = (value: unknown) =>
  value instanceof Error ? value.message : String(value);
export const isAbort = (value: unknown) => value instanceof Error && value.name === 'AbortError';
