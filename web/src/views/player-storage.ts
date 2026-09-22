/** Device persistence. Data, source connection and invalidation share one transaction. */
export interface StoreToken {
  revision: string | null;
  epoch: number;
  version: number;
}
export interface PlayerSource {
  [metadata: string]: unknown;
  autoRefresh: boolean;
  generation: number;
  lastAttempt: number | null;
  retryAt: number | null;
}
export interface StoredPlayer {
  revision: string;
  bytes: Uint8Array;
  source?: PlayerSource | null;
  lastImportedAt?: number | null;
}
export interface StoreControl {
  epoch: number;
  version: number;
  lease: {id: string; until: number} | null;
  clearedEpoch?: number;
}
export interface StoragePorts {
  playerContext?: {key(name: string): string};
  database?: IDBFactory;
  clock?: () => number;
  leaseID?: () => string;
}
export interface PlayerStorage {
  read(): Promise<{active: StoredPlayer | null; control: StoreControl; token: StoreToken}>;
  begin(expected: StoreToken): Promise<StoreToken>;
  verify(expected: StoreToken): Promise<StoreToken>;
  save(value: StoredPlayer, expected: StoreToken, leaseID?: string | null): Promise<StoreToken>;
  forget(expected?: StoreToken | null, clear?: boolean): Promise<StoreToken>;
  clear(): Promise<StoreToken>;
  claim(expected: StoreToken, manual: boolean, now?: number): Promise<{
    id: string; active: StoredPlayer & {source: PlayerSource}; token: StoreToken;
  } | null>;
  finish(expected: StoreToken, id: string, patch: Partial<PlayerSource>): Promise<PlayerSource>;
}

const conflict = () => new Error('Player data changed in another tab. Reload before importing again.');
const defaults = (): StoreControl => ({epoch: 0, version: 0, lease: null});
const token = (active: StoredPlayer | null, control: StoreControl): StoreToken => ({
  revision: active?.revision ?? null, epoch: control.epoch, version: control.version,
});
function matches(expected: StoreToken, active: StoredPlayer | null, control: StoreControl): boolean {
  return expected.revision === (active?.revision ?? null)
    && expected.epoch === control.epoch && expected.version === control.version;
}

export function createPlayerStorage(ports: StoragePorts = {}): PlayerStorage {
  const databaseName = ports.playerContext?.key('maimai-player-data') || 'maimai-player-data';
  const factory = ports.database ?? indexedDB;
  const clock = ports.clock ?? Date.now;
  const leaseID = ports.leaseID ?? (() => crypto.randomUUID());
  function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      // Version 2 prevents an old open browser from recreating a forgotten v1 connection.
      const request = factory.open(databaseName, 2);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('datasets')) request.result.createObjectStore('datasets');
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(new Error('Device storage is unavailable.'));
      request.onblocked = () => reject(new Error('Close other maimai.party tabs to update device storage.'));
    });
  }
  async function transaction<T>(mode: IDBTransactionMode,
    run: (active: StoredPlayer | null, control: StoreControl, store: IDBObjectStore) => T,
  ): Promise<T> {
    const database = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const transaction = database.transaction('datasets', mode);
        const store = transaction.objectStore('datasets');
        let result: T, error: unknown, count = 0;
        const active = store.get('active') as IDBRequest<StoredPlayer | undefined>;
        const control = store.get('control') as IDBRequest<StoreControl | undefined>;
        const ready = () => {
          if (++count !== 2) return;
          try { result = run(active.result ?? null, control.result ?? defaults(), store); }
          catch (cause) { error = cause; transaction.abort(); }
        };
        active.onsuccess = ready;
        control.onsuccess = ready;
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => {};
        transaction.onabort = () => reject(error || new Error('Device storage could not be updated. Nothing was replaced.'));
      });
    } finally { database.close(); }
  }
  const read: PlayerStorage['read'] = () => transaction('readonly', (active, control) => ({
    active, control, token: token(active, control),
  }));
  const begin: PlayerStorage['begin'] = expected => transaction('readwrite', (active, control, store) => {
    if (!matches(expected, active, control)) throw conflict();
    control.version++;
    control.lease = null;
    store.put(control, 'control');
    return token(active, control);
  });
  const verify: PlayerStorage['verify'] = expected => transaction('readonly', (active, control) => {
    if (!matches(expected, active, control)) throw conflict();
    return token(active, control);
  });
  const save: PlayerStorage['save'] = (value, expected, id = null) => transaction('readwrite', (active, control, store) => {
    if (!matches(expected, active, control) || id && control.lease?.id !== id) throw conflict();
    control.version++;
    control.lease = null;
    if (value.source) value.source = {...value.source, generation: control.version};
    store.put(value, 'active');
    store.put(control, 'control');
    return token(value, control);
  });
  const forget: PlayerStorage['forget'] = (expected = null, clear = false) => transaction('readwrite', (active, control, store) => {
    if (expected && !matches(expected, active, control)) throw conflict();
    control.epoch++;
    control.version++;
    control.lease = null;
    if (clear) control.clearedEpoch = control.epoch;
    store.delete('active');
    store.put(control, 'control');
    return token(null, control);
  });
  const claim: PlayerStorage['claim'] = (expected, manual, now = clock()) => transaction('readwrite', (active, control, store) => {
    if (!matches(expected, active, control)) throw conflict();
    const source = active?.source;
    if (!active || !source?.autoRefresh) return null;
    if (control.lease && control.lease.until > now || (source.retryAt ?? 0) > now
      || now - (source.lastAttempt ?? 0) < (manual ? 30000 : 900000)) return null;
    const id = leaseID();
    control.lease = {id, until: now + 60000};
    const claimed = {...active, source: {...source, lastAttempt: now}};
    store.put(control, 'control');
    store.put(claimed, 'active');
    return {id, active: claimed, token: token(claimed, control)};
  });
  const finish: PlayerStorage['finish'] = (expected, id, patch) => transaction('readwrite', (active, control, store) => {
    if (!matches(expected, active, control) || control.lease?.id !== id || !active?.source) throw conflict();
    active.source = {...active.source, ...patch};
    control.lease = null;
    store.put(active, 'active');
    store.put(control, 'control');
    return active.source;
  });
  return Object.freeze({read, begin, verify, save, forget, clear: () => forget(null, true), claim, finish});
}
