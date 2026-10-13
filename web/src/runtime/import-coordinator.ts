import type { StoreToken } from '../views/player-storage';
import type {
  SessionPorts,
  PlayerDataset,
  SourceConnection,
  SourceLocation,
  ImportStage,
  ImportMethod,
  HandoffTransfer,
  SessionNotification,
  SessionUsage,
  OAuthProvider,
} from './player-session-contracts';
import { importTime, errorMessage, isAbort } from './player-session-contracts';
import { importFailure } from './import-failure';
import type { Failure } from '../usage-contract';
import type { ImportFile, FileImportOptions } from '../domain/import-options';
type ProviderFlow =
  | { action: 'connect'; provider: OAuthProvider }
  | { action: 'read'; provider: OAuthProvider | 'kamaitachi' }
  | { action: 'refresh'; provider: SourceConnection['type'] };
/** Sole owner of player readiness and transaction state; DOM and transport are ports. */
export class ImportCoordinator {
  private revision = 0;
  private importing = false;
  private checking = false;
  private pending: AbortController | null = null;
  private data: PlayerDataset | null = null;
  private connection: SourceConnection | null = null;
  private token: StoreToken | null = null;
  private savedRevision: string | null = null;
  private persistent = false;
  private rating: number | null = null;
  private importedAt: number | null = null;
  private refreshMessage = '';
  private handoffPending = false;
  readonly ready: Promise<void>;
  constructor(private readonly ports: SessionPorts) {
    this.ready = this.load();
  }
  get generation() {
    return this.revision;
  }
  get busy() {
    return this.importing;
  }
  get refreshing() {
    return this.checking;
  }
  get active() {
    return this.data;
  }
  get source() {
    return this.connection;
  }
  get remembered() {
    return this.persistent;
  }
  get storedRevision() {
    return this.savedRevision;
  }
  get sourceRating() {
    return this.rating;
  }
  get lastImportedAt() {
    return this.importedAt;
  }
  get refreshText() {
    return this.refreshMessage;
  }
  private now() {
    return (this.ports.clock ?? Date.now)();
  }
  private assert(expected: number) {
    if (expected !== this.revision) throw new DOMException('Superseded operation', 'AbortError');
  }
  cancel() {
    this.revision++;
    this.importing = false;
    this.pending?.abort();
    this.pending = null;
    this.checking = false;
    this.ports.effects.invalidate();
  }
  setHandoffPending(value: boolean) {
    this.handoffPending = value;
  }
  private notify(kind: SessionNotification['kind'], token = this.token) {
    this.ports.effects.notify(kind, token);
  }
  private clearTab() {
    try {
      this.ports.temporary.removeItem(this.ports.key('maimai-player-session'));
    } catch {}
  }
  private saveTab(
    bytes: Uint8Array,
    epoch = this.token?.epoch ?? null,
    profileRating: number | null = null,
    lastImportedAt: number | null = null,
  ) {
    let text = '';
    for (let i = 0; i < bytes.length; i += 32768)
      text += String.fromCharCode(...bytes.subarray(i, i + 32768));
    try {
      this.ports.temporary.setItem(
        this.ports.key('maimai-player-session'),
        JSON.stringify({
          epoch,
          bytes: btoa(text),
          profileRating,
          lastImportedAt,
        }),
      );
    } catch {
      throw new Error(
        'This tab’s temporary storage is full or unavailable. Nothing was replaced. You can choose “Remember on this device” to use device storage.',
      );
    }
  }
  private async begin() {
    this.cancel();
    this.importing = true;
    this.pending = new AbortController();
    const expected = this.revision;
    await this.ready;
    this.assert(expected);
    if (this.token) {
      const token = await this.ports.storage.begin(this.token);
      this.assert(expected);
      this.token = token;
      this.notify('invalidate');
    }
    return expected;
  }
  private signal() {
    if (!this.pending) throw new DOMException('Superseded operation', 'AbortError');
    return this.pending.signal;
  }
  private async load() {
    const { core, storage, sources, temporary, key, effects } = this.ports;
    let failed = false,
      saved;
    try {
      const state = await storage.read();
      saved = state.active;
      this.token = state.token;
      this.savedRevision = state.token.revision;
    } catch {
      failed = true;
    }
    try {
      let temporaryValue = temporary.getItem(key('maimai-player-session'));
      if (temporaryValue) {
        if (temporaryValue.length > Math.ceil((core.MAX_COMPRESSED * 4) / 3) + 256)
          throw new Error('Oversized temporary data');
        const entry: {
          epoch: unknown;
          bytes: string;
          profileRating?: unknown;
          lastImportedAt?: unknown;
        } = temporaryValue.startsWith('{')
          ? JSON.parse(temporaryValue)
          : {
              epoch: 0,
              bytes: temporaryValue,
            };
        if (entry.epoch !== (this.token?.epoch ?? null)) {
          this.clearTab();
          temporaryValue = null;
        } else {
          this.data = await core.reconcile(
            await core.decode(Uint8Array.from(atob(entry.bytes), (c) => c.charCodeAt(0))),
          );
          this.importedAt = importTime(entry.lastImportedAt);
          if (
            this.data.player.provider === 'maishift' &&
            typeof entry.profileRating === 'number' &&
            Number.isSafeInteger(entry.profileRating) &&
            entry.profileRating >= 0 &&
            entry.profileRating <= 1000000
          )
            this.rating = entry.profileRating;
        }
      }
      if (!temporaryValue && saved) {
        this.data = await core.reconcile(await core.decode(saved.bytes));
        this.persistent = true;
        try {
          this.connection = sources.validateSource(saved.source ?? null, this.data.player.key);
          this.rating =
            this.connection?.type === 'maishift' ? (this.connection.profileRating ?? null) : null;
        } catch {
          this.connection = null;
        }
        this.importedAt =
          importTime(saved.lastImportedAt) ?? importTime(this.connection?.lastSuccess);
      }
    } catch {
      failed = true;
    }
    effects.changed();
    if (failed && !this.data) effects.loadedFailure();
  }
  private async commit(
    data: PlayerDataset,
    remember: boolean,
    {
      connection = null,
      expected = this.revision,
      automatic = false,
      lease = null,
      onCommitted,
    }: {
      connection?: SourceConnection | null;
      expected?: number;
      automatic?: boolean;
      lease?: string | null;
      onCommitted?: () => void;
    } = {},
  ) {
    const { core, storage, effects } = this.ports;
    const previousConnections = remember
      ? await this.savedConnections()
      : this.connection
        ? [this.connection]
        : [];
    let removedSavedConnection = false;
    let previous = this.data;
    if (connection?.type === 'maishift' && this.data?.player.key === data.player.key) {
      if (connection.adapterVersion === 2)
        previous = await this.ports.maishift.enrichRatings(this.data, data);
      const current = core.current(previous!).pbs,
        observations = core.current(data).pbs;
      const unchanged = [...observations].every(
        ([id, r]) =>
          core.canonical(current.get(id)) === core.canonical(r) &&
          core.canonical(previous!.charts[id]) === core.canonical(data.charts[id]),
      );
      if (unchanged) {
        data = {
          ...previous!,
          player: data.player,
        };
        const { revision, ...body } = data;
        data.revision = await core.digest(body);
      } else if (core.offer(data).capturedAt <= core.offer(this.data).capturedAt)
        throw new Error(
          'Maishift changed records without a newer source timestamp. Your saved data was kept.',
        );
    }
    const next =
      previous?.player.key === data.player.key
        ? await core.merge(previous, data)
        : await core.reconcile(data);
    if (connection && core.offer(data).capturedAt >= core.offer(next).capturedAt) {
      next.player = structuredClone(data.player);
      const { revision, ...body } = next;
      next.revision = await core.digest(body);
    }
    const bytes = await core.encode(next);
    this.assert(expected);
    const importedAt = this.now();
    if (remember) {
      if (!this.token) throw new Error('Device storage is unavailable.');
      const token = await storage.save(
        {
          revision: next.revision,
          bytes,
          source: connection,
          lastImportedAt: importedAt,
        },
        this.token,
        lease,
      );
      // The IDB transaction has committed even if navigation cancelled this view
      // while it was pending. Keep its grant and report the durable result before
      // checking whether this operation may still update the current UI.
      onCommitted?.();
      onCommitted = undefined;
      this.notify('saved', token);
      this.assert(expected);
      this.token = token;
      this.savedRevision = token.revision;
      this.clearTab();
    } else {
      if (this.token) await storage.verify(this.token);
      this.assert(expected);
      if (
        this.persistent &&
        this.connection &&
        connection?.url === this.connection.url &&
        connection.playerKey === this.connection.playerKey
      ) {
        const key = this.ports.key('maimai-player-session'),
          old = this.ports.temporary.getItem(key);
        this.saveTab(bytes, this.token!.epoch + 1, connection?.profileRating ?? null, importedAt);
        try {
          this.token = await storage.forget(this.token);
          removedSavedConnection = true;
        } catch (error) {
          if (old === null) this.clearTab();
          else this.ports.temporary.setItem(key, old);
          throw error;
        }
        this.savedRevision = null;
        this.notify('forgotten');
        this.assert(expected);
      } else
        this.saveTab(
          bytes,
          this.token?.epoch ?? null,
          connection?.profileRating ?? null,
          importedAt,
        );
    }
    this.data = next;
    this.importedAt = importedAt;
    this.rating = connection?.type === 'maishift' ? (connection.profileRating ?? null) : null;
    this.persistent = remember;
    this.connection = remember ? connection : null;
    this.refreshMessage = '';
    onCommitted?.();
    if (!automatic) effects.show();
    effects.changed();
    const releasedIDs: string[] = [];
    for (const previous of previousConnections)
      if (
        (remember || removedSavedConnection) &&
        previous.connectionID &&
        previous.connectionID !== this.connection?.connectionID
      ) {
        await this.releaseConnection(previous);
        releasedIDs.push(previous.connectionID);
      }
    return releasedIDs;
  }
  private trackProvider(
    flow: ProviderFlow,
    outcome: 'started' | 'completed' | 'cancelled' | 'failed',
    failure: Failure = 'unavailable',
  ) {
    // All components are finite unions; no provider/account data enters usage rows.
    const event = `provider_${flow.action}_${outcome}`;
    this.ports.effects.usage(
      ...((outcome === 'failed'
        ? [event, flow.provider, failure]
        : [event, flow.provider]) as SessionUsage),
    );
  }
  private async ask(
    method: ImportMethod,
    ...[offer, options, signal]: Parameters<SessionPorts['effects']['ask']>
  ) {
    signal.throwIfAborted();
    const pending = this.ports.effects.ask(offer, options, signal);
    this.ports.effects.usage('import_previewed', method);
    const choice = await pending;
    if (choice.accept) {
      signal.throwIfAborted();
      this.ports.effects.usage('import_confirmed', method);
    }
    return choice;
  }
  private async releaseConnection(
    source: SourceLocation | SourceConnection,
    locallyRemoved = false,
  ) {
    if (
      (source.type !== 'diving-fish' && source.type !== 'lxns') ||
      !('connectionID' in source) ||
      !source.connectionID
    )
      return;
    this.ports.effects.usage('provider_disconnect_started', source.type);
    try {
      await this.ports.sources.disconnect?.(source);
      this.ports.effects.usage('provider_disconnect_completed', source.type);
    } catch (error) {
      this.ports.effects.usage('provider_disconnect_failed', source.type, importFailure(error));
      this.ports.effects.message(
        'Connection cleanup needed',
        locallyRemoved
          ? 'Saved player data was removed. A provider connection still needs cleanup; retry when online.'
          : errorMessage(error),
      );
    }
  }
  private async savedConnections() {
    const sources = this.connection ? [this.connection] : [];
    // A one-time import can be displayed while an earlier profile is retained.
    // Erasing local storage must also release that retained profile's grant.
    try {
      const saved = (await this.ports.storage.read()).active?.source;
      if (saved && typeof saved.playerKey === 'string') {
        const source = this.ports.sources.validateSource(saved, saved.playerKey);
        if (
          source?.connectionID &&
          !sources.some((row) => row.connectionID === source.connectionID)
        )
          sources.push(source);
      }
    } catch {
      /* Invalid metadata must never prevent local erasure. */
    }
    return sources;
  }
  async forget() {
    this.cancel();
    const expected = this.revision;
    this.importing = true;
    const { effects, storage } = this.ports;
    try {
      await this.ready;
      this.assert(expected);
      const connections = await this.savedConnections();
      this.assert(expected);
      const token = await storage.forget();
      this.assert(expected);
      this.token = token;
      this.savedRevision = null;
      this.clearTab();
      this.persistent = false;
      this.connection = null;
      this.refreshMessage = '';
      this.notify('forgotten');
      effects.changed();
      effects.usage('data_action', 'forget');
      effects.message(
        'Player data forgotten',
        'The saved profile and connection were removed. You can keep viewing these scores in this tab; automatic refresh is off.',
        { success: true },
      );
      for (const connection of connections) await this.releaseConnection(connection, true);
    } catch (error) {
      if (expected === this.revision && !isAbort(error))
        effects.message('Could not forget data', errorMessage(error));
    } finally {
      if (expected === this.revision) this.importing = false;
    }
  }
  private clearCurrent() {
    this.clearTab();
    this.data = null;
    this.rating = null;
    this.importedAt = null;
    this.persistent = false;
    this.connection = null;
    this.refreshMessage = '';
  }
  async clear() {
    this.cancel();
    const expected = this.revision;
    this.importing = true;
    const { effects, storage } = this.ports;
    try {
      await this.ready;
      this.assert(expected);
      const connections = await this.savedConnections();
      this.assert(expected);
      const cleared = await storage.clear();
      this.notify('cleared', cleared);
      if ((this.token?.version ?? -1) > cleared.version) return;
      this.cancel();
      this.token = cleared;
      this.savedRevision = null;
      this.clearCurrent();
      effects.changed();
      effects.usage('data_action', 'clear');
      effects.message(
        'Player data cleared',
        'Imported scores and the saved connection were removed from this browser.',
        {
          success: true,
        },
      );
      for (const connection of connections) await this.releaseConnection(connection, true);
    } catch (error) {
      if (expected === this.revision && !isAbort(error))
        effects.message('Could not clear player data', errorMessage(error));
    } finally {
      if (expected === this.revision) this.importing = false;
    }
  }
  async importFile(file: ImportFile, options?: FileImportOptions) {
    if (this.busy) return;
    const { core, effects } = this.ports;
    const method: ImportMethod =
      !options || options.format === 'portable' ? 'file' : `file:${options.format}`;
    effects.usage('import_started', method);
    this.importing = true;
    let expected: number | undefined = this.revision + 1,
      stage: ImportStage = 'storage',
      committed = false;
    try {
      expected = await this.begin();
      stage = 'invalid';
      if (file.size > core.MAX_COMPRESSED) throw new Error('Player file exceeds 32 MiB.');
      if (options?.format && options.format !== 'portable' && !this.ports.readFile)
        throw new Error('This file importer is unavailable.');
      const result = this.ports.readFile
        ? await this.ports.readFile(file, options)
        : {
            data: await core.decode(await file.arrayBuffer()),
            excludedUtage: 0,
            snapshotDateUnknown: false,
          };
      const data = result.data;
      this.assert(expected);
      const linked = new Set([
        ...Object.values(data.plays),
        ...Object.values(data.snapshots).flatMap((snapshot) => Object.values(snapshot.pbs)),
      ]);
      const reconciled = await core.reconcile(data);
      this.assert(expected);
      const choice = await this.ask(
        method,
        core.offer(reconciled),
        {
          file: true,
          fileExport: !!options && options.format !== 'portable',
          unlinkedObservations: Object.keys(data.records).filter((ref) => !linked.has(ref)).length,
          excludedUtage: result.excludedUtage,
          snapshotDateUnknown: result.snapshotDateUnknown,
          unmatched: effects.unmatched(data),
        },
        this.signal(),
      );
      if (choice.accept) {
        stage = 'storage';
        await this.commit(data, choice.remember, {
          expected,
          onCommitted: () => {
            committed = true;
            effects.usage('import_completed', method);
          },
        });
      } else effects.usage('import_cancelled', method);
    } catch (error) {
      if (expected === this.revision && !isAbort(error) && !committed) {
        effects.usage('import_failed', method, importFailure(error, stage));
        effects.message('Player data could not be imported', errorMessage(error));
      } else if (!committed) effects.usage('import_cancelled', method);
    } finally {
      if (expected === this.revision || expected === undefined) this.importing = false;
    }
  }
  async importSource(
    value: string | SourceLocation | SourceConnection,
    rememberChoice: boolean,
    authorize?: (signal: AbortSignal) => Promise<SourceLocation>,
  ) {
    if (this.busy) return;
    const { sources, core, effects } = this.ports;
    let parsed: SourceLocation | SourceConnection, recovery: string | undefined;
    try {
      if (typeof value === 'object') parsed = { ...value };
      else {
        const report = sources.reportURL(value);
        if (!report.manifest) {
          effects.recovery(report.url);
          return;
        }
        recovery = report.url;
        parsed = {
          type: 'report',
          url: report.manifest,
        };
      }
    } catch (error) {
      effects.message('Player data could not be imported', errorMessage(error));
      return;
    }
    const method = parsed.type;
    effects.usage('import_started', method);
    this.importing = true;
    let expected: number | undefined = this.revision + 1,
      reading = false,
      cancelled = false,
      acquired: SourceLocation | null = null,
      retained = false,
      committed = false,
      stage: ImportStage = 'storage';
    let acquisitionFlow: ProviderFlow | null = null;
    try {
      expected = await this.begin();
      stage = 'invalid';
      const cleanup = effects.reading(() => {
        if (expected === this.revision) {
          if (!cancelled) {
            cancelled = true;
            effects.usage('import_cancelled', method);
          }
          this.cancel();
        }
      });
      let result;
      try {
        reading = true;
        if (authorize) {
          if (method === 'diving-fish' || method === 'lxns') {
            acquisitionFlow = { action: 'connect', provider: method };
            this.trackProvider(acquisitionFlow, 'started');
          }
          parsed = await authorize(this.signal());
          acquired = parsed;
          this.assert(expected);
          if (acquisitionFlow) this.trackProvider(acquisitionFlow, 'completed');
          acquisitionFlow = null;
        }
        if (method === 'kamaitachi' || method === 'diving-fish' || method === 'lxns') {
          acquisitionFlow = { action: 'read', provider: method };
          this.trackProvider(acquisitionFlow, 'started');
        }
        result = await sources.readSource(parsed, {
          signal: this.signal(),
        });
        if (acquisitionFlow) this.trackProvider(acquisitionFlow, 'completed');
        acquisitionFlow = null;
        reading = false;
      } finally {
        cleanup();
      }
      this.assert(expected);
      const reconciled = await core.reconcile(result.data);
      this.assert(expected);
      const choice = await this.ask(
        method,
        core.offer(reconciled),
        {
          file: true,
          connection: result.source,
          rememberDefault: rememberChoice,
          unmatched: effects.unmatched(result.data),
          excludedUtage: result.source.excludedUtage,
        },
        this.signal(),
      );
      if (choice.accept) {
        stage = 'storage';
        const releasedIDs = await this.commit(result.data, choice.remember, {
          connection: result.source,
          expected,
          onCommitted: () => {
            committed = true;
            retained = choice.remember;
            effects.usage('import_completed', method);
          },
        });
        if (retained && acquired && (acquired.type === 'diving-fish' || acquired.type === 'lxns'))
          for (const connectionID of acquired.previousConnectionIDs ?? [])
            if (!releasedIDs.includes(connectionID))
              await this.releaseConnection({ type: acquired.type, connectionID });
        if (
          !choice.remember &&
          !acquired &&
          !releasedIDs.includes(result.source.connectionID ?? '')
        )
          await this.releaseConnection(result.source);
      } else effects.usage('import_cancelled', method);
    } catch (error) {
      if (acquisitionFlow)
        this.trackProvider(
          acquisitionFlow,
          cancelled || isAbort(error) ? 'cancelled' : 'failed',
          importFailure(error),
        );
      if (!isAbort(error) && !cancelled && !committed) {
        effects.usage(
          'import_failed',
          method,
          importFailure(error, reading ? 'unavailable' : stage),
        );
        if (reading && parsed.type === 'report') effects.recovery(recovery!);
        else effects.message('Player data could not be imported', errorMessage(error));
      } else if (!cancelled && !committed) effects.usage('import_cancelled', method);
    } finally {
      if (acquired && !retained) await this.releaseConnection(acquired);
      if (expected === this.revision || expected === undefined) {
        this.importing = false;
        this.pending = null;
      }
    }
  }
  async refresh(manual = false) {
    await this.ready;
    if (
      !this.connection ||
      !this.persistent ||
      this.busy ||
      this.checking ||
      !this.ports.refreshAllowed() ||
      this.handoffPending
    )
      return;
    this.checking = true;
    const expected = this.revision;
    const { storage, sources, core, effects } = this.ports;
    let lease: Awaited<ReturnType<typeof storage.claim>> = null;
    let refreshFlow: ProviderFlow | null = null,
      refreshStage: ImportStage = 'unavailable';
    try {
      lease = await storage.claim(this.token!, manual);
      this.assert(expected);
      if (!lease) {
        if (manual) {
          this.refreshMessage = 'Please wait before refreshing again.';
          effects.changed(false);
        }
        return;
      }
      this.checking = true;
      this.pending = new AbortController();
      this.refreshMessage = 'Checking for updated player data…';
      effects.changed(false);
      if (manual) {
        refreshFlow = { action: 'refresh', provider: this.connection.type };
        this.trackProvider(refreshFlow, 'started');
      }
      const result = await sources.readSource(this.connection, {
        signal: this.signal(),
        expectedPlayer: this.data!.player.key,
        manual,
      });
      this.assert(expected);
      refreshStage = 'storage';
      const now = this.now();
      const updated = {
        ...this.connection,
        ...result.source,
        lastAttempt: lease.active.source.lastAttempt,
        lastChecked: now,
        lastSuccess: now,
        retryAt: null,
      };
      const older = core.offer(result.data).capturedAt < (this.connection.sourceUpdatedAt ?? 0);
      if (
        result.data.revision === this.connection.sourceRevision ||
        older ||
        (this.connection.contentRevision !== undefined &&
          result.source.contentRevision === this.connection.contentRevision)
      ) {
        if (older) {
          const connection = (await storage.finish(this.token!, lease.id, {
            lastChecked: now,
            retryAt: null,
          })) as SourceConnection;
          this.assert(expected);
          this.connection = connection;
        } else {
          const checked = {
            ...this.connection,
            lastAttempt: lease.active.source.lastAttempt,
            lastChecked: now,
            lastSuccess: now,
            retryAt: null,
            ...(this.connection.type === 'maishift'
              ? {
                  adapterVersion: result.source.adapterVersion,
                  sourceUpdatedAt: result.source.sourceUpdatedAt,
                  profileRating: result.source.profileRating,
                  diagnosticCount: result.source.diagnosticCount,
                  diagnostics: result.source.diagnostics,
                }
              : {}),
          };
          const token = await storage.save(
            {
              ...lease.active,
              source: checked,
              lastImportedAt: now,
            },
            this.token!,
            lease.id,
          );
          this.assert(expected);
          this.token = token;
          this.connection = checked;
          this.importedAt = now;
          this.notify('saved');
        }
        this.rating =
          this.connection?.type === 'maishift' ? (this.connection.profileRating ?? null) : null;
      } else
        await this.commit(result.data, true, {
          connection: updated,
          expected,
          automatic: true,
          lease: lease.id,
        });
      this.refreshMessage = older
        ? 'The source returned older data. Your saved data was kept.'
        : '';
      if (refreshFlow) this.trackProvider(refreshFlow, 'completed');
    } catch (error) {
      if (refreshFlow)
        this.trackProvider(
          refreshFlow,
          expected !== this.revision || isAbort(error) ? 'cancelled' : 'failed',
          importFailure(error, refreshStage),
        );
      if (expected === this.revision && !isAbort(error)) {
        const code =
          typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
        this.refreshMessage =
          this.connection?.type === 'diving-fish' && code === 'tracker_agreement_required'
            ? 'Open Diving-Fish, accept its tracker agreement, and confirm your scores are visible. Then try again.'
            : this.connection?.type === 'lxns' && code === 'lxns_player_missing'
              ? 'No supported scores were found in LXNS. Sync your maimai DX scores to LXNS first, then try again.'
              : 'Could not refresh — showing your saved data';
        if (lease)
          try {
            const retryAt =
              typeof error === 'object' && error !== null && 'retryAt' in error
                ? error.retryAt
                : undefined;
            const connection = (await storage.finish(this.token!, lease.id, {
              retryAt: typeof retryAt === 'number' ? retryAt : this.now() + sources.AUTO_INTERVAL,
            })) as SourceConnection;
            this.assert(expected);
            this.connection = connection;
          } catch {}
      }
    } finally {
      if (expected === this.revision) {
        this.checking = false;
        this.pending = null;
        effects.changed(false);
      }
    }
  }
  async receiveUpdate(event: unknown) {
    if (
      typeof event !== 'object' ||
      event === null ||
      !('kind' in event) ||
      typeof event.kind !== 'string' ||
      !['saved', 'forgotten', 'cleared', 'invalidate'].includes(event.kind)
    )
      return;
    const update = event as SessionNotification;
    const { storage, core, sources, effects } = this.ports;
    if (
      ['forgotten', 'cleared'].includes(update.kind) &&
      Number.isSafeInteger(update.epoch) &&
      update.epoch! > (this.token?.epoch ?? 0)
    ) {
      this.cancel();
      this.clearTab();
      this.persistent = false;
      this.connection = null;
      this.savedRevision = null;
      this.refreshMessage =
        'The saved profile and connection were removed. You can keep viewing these scores in this tab; automatic refresh is off.';
      if (update.kind === 'cleared') this.clearCurrent();
      effects.changed(update.kind === 'cleared');
    }
    await this.ready;
    try {
      const state = await storage.read();
      if (
        state.token.epoch === (this.token?.epoch ?? 0) &&
        state.token.version <= (this.token?.version ?? 0)
      )
        return;
      const forgotten = state.token.epoch !== (this.token?.epoch ?? 0),
        cleared = (state.control.clearedEpoch ?? 0) > (this.token?.epoch ?? 0),
        wasRemembered = this.persistent;
      this.cancel();
      this.token = state.token;
      this.savedRevision = this.token.revision;
      if (cleared) this.clearCurrent();
      else if (forgotten) {
        this.clearTab();
        this.persistent = false;
        this.connection = null;
        this.refreshMessage =
          'The saved profile and connection were removed. You can keep viewing these scores in this tab; automatic refresh is off.';
      } else if (wasRemembered && state.active && update.kind === 'saved') {
        const expected = this.revision,
          data = await core.reconcile(await core.decode(state.active.bytes));
        this.assert(expected);
        this.data = data;
        this.connection = sources.validateSource(state.active.source ?? null, data.player.key);
        this.rating =
          this.connection?.type === 'maishift' ? (this.connection.profileRating ?? null) : null;
        this.importedAt =
          importTime(state.active.lastImportedAt) ?? importTime(this.connection?.lastSuccess);
      }
      effects.changed(cleared || update.kind !== 'invalidate');
    } catch {
      /* A failed notification never replaces the current in-memory data. */
    }
  }
  async resume() {
    await this.receiveUpdate({
      kind: 'invalidate',
    });
    await this.refresh();
  }
  async handoff(rawOffer: unknown, stale: boolean, transfer: HandoffTransfer) {
    const { core, effects } = this.ports;
    let ownsImport = false,
      expected: number | undefined,
      measured = false,
      committed = false,
      stage: ImportStage = 'invalid';
    try {
      await this.ready;
      if (this.busy) throw new Error('Another import is in progress. Please try again.');
      this.importing = true;
      ownsImport = true;
      expected = this.revision + 1;
      expected = await this.begin();
      const offer = core.validateOffer(rawOffer);
      if (this.data && !core.needsUpdate(this.data, offer)) {
        effects.show();
        effects.changed();
        transfer.send('reused');
        this.importing = false;
        return;
      }
      measured = true;
      effects.usage('import_opened');
      effects.usage('import_started', 'report');
      const choice = await this.ask(
        'report',
        offer,
        {
          stale,
        },
        this.signal(),
      );
      if (!choice.accept) {
        effects.usage('import_cancelled', 'report');
        effects.hide();
        effects.changed();
        transfer.send('declined');
        this.importing = false;
        return;
      }
      stage = 'unavailable';
      const bytes = await transfer.read(this.signal());
      stage = 'invalid';
      this.assert(expected);
      const data = await core.decode(bytes);
      const received = core.offer(data);
      if (
        !Object.entries(received).every(
          ([key, value]) =>
            (key === 'profile' && !Object.hasOwn(offer, key)) ||
            core.canonical(value) === core.canonical(offer[key as keyof typeof offer]),
        )
      )
        throw new Error('The report sent a different dataset from the one offered.');
      stage = 'storage';
      await this.commit(data, choice.remember, {
        expected,
        onCommitted: () => {
          committed = true;
          effects.usage('import_completed', 'report');
        },
      });
      transfer.send('imported');
    } catch (error) {
      transfer.send('error');
      if (!isAbort(error) && !committed) {
        if (measured) effects.usage('import_failed', 'report', importFailure(error, stage));
        effects.message('Player data could not be imported', errorMessage(error));
      }
    } finally {
      transfer.close();
      this.handoffPending = false;
      if (ownsImport && (expected === this.revision || expected === undefined))
        this.importing = false;
    }
  }
}
