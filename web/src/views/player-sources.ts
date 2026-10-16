import type { PlayerDataset } from '../domain/player-data';
import type {
  SourceConnection,
  SourceLocation,
  PlayerOffer,
} from '../runtime/player-session-contracts';
import type { createPlayerDataCore } from './player-data-core';
import type { createPlayerMaishift } from './player-maishift';
import { DiagnosticError, diagnosticError } from '../runtime/diagnostic-error';
import { sourceRequest, sourceJSON, workerReason } from '../runtime/source-transport';
interface SavedConnection extends SourceConnection {
  schemaVersion: number;
  region: string;
  handle: string;
  profileCreatedAt: number;
  contentRevision: string;
  diagnostics: { rowIndex: number; reason: string }[];
  diagnosticCount: number;
}
interface MaishiftLocation {
  url?: unknown;
  handle?: unknown;
  region?: unknown;
}
interface ReadOptions {
  signal?: AbortSignal;
  expectedPlayer?: string | null;
  manual?: boolean;
}
interface SourcesPorts {
  playerCore: ReturnType<typeof createPlayerDataCore>;
  maishift: ReturnType<typeof createPlayerMaishift>;
  features?: { maishift: boolean };
  playerContext?: { pilot: boolean };
}
/** Source adapters perform bounded acquisition; connection metadata remains local. */
export function createPlayerSources(ports: SourcesPorts) {
  const core = ports.playerCore;
  const capabilities = Object.freeze({
    file: true,
    report: true,
    maishift: ports.features?.maishift === true || ports.playerContext?.pilot === true,
  });
  const AUTO_INTERVAL = 15 * 60 * 1000,
    MANUAL_INTERVAL = 30000;
  function reportURL(value: string) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error('Enter a complete HTTPS Session Report URL.');
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      value.length > 2048
    )
      throw new Error('Enter a complete HTTPS Session Report URL.');
    // The installed report uses exactly one installation-prefix segment. Never
    // discover endpoints by crawling HTML or guessing parents of arbitrary paths.
    const match = /^\/([A-Za-z0-9_-]+)(?:\/(?:party\/latest\.json|index\.html)?)?$/.exec(
      url.pathname,
    );
    return {
      url: url.href,
      manifest: match ? url.origin + '/' + match[1] + '/party/latest.json' : null,
    };
  }
  function validateSource(input: unknown, playerKey: string): SourceConnection | null {
    const source = input as SavedConnection | null;
    if (source === null) return null;
    if (
      !source ||
      source.schemaVersion !== 1 ||
      !['report', 'maishift'].includes(source.type) ||
      !(source.type === 'maishift' ? [1, 2] : [1]).includes(source.adapterVersion) ||
      source.playerKey !== playerKey ||
      source.autoRefresh !== true ||
      !Number.isSafeInteger(source.generation) ||
      source.generation < 0
    )
      throw new Error('Invalid saved source connection.');
    if (source.type === 'report') {
      const parsed = reportURL(source.url);
      if (!parsed.manifest || parsed.manifest !== source.url)
        throw new Error('Invalid saved source connection.');
    } else {
      const parsed = ports.maishift.location(source.url, source.region);
      if (
        source.profileRating != null &&
        (!Number.isSafeInteger(source.profileRating) ||
          source.profileRating < 0 ||
          source.profileRating > 1000000)
      )
        throw new Error('Invalid saved source connection.');
      if (
        parsed.url !== source.url ||
        parsed.handle !== source.handle ||
        playerKey !==
          'maishift:maimaidx:' + source.region + ':' + encodeURIComponent(source.handle) ||
        !Number.isSafeInteger(source.profileCreatedAt) ||
        source.profileCreatedAt < 0 ||
        !/^[a-f0-9]{64}$/.test(source.contentRevision) ||
        !Array.isArray(source.diagnostics) ||
        source.diagnostics.length > 100 ||
        !Number.isSafeInteger(source.diagnosticCount) ||
        source.diagnosticCount < source.diagnostics.length ||
        source.diagnosticCount > 20000
      )
        throw new Error('Invalid saved source connection.');
      if (
        source.diagnostics.some(
          (d) =>
            !Number.isSafeInteger(d.rowIndex) ||
            d.rowIndex < 0 ||
            d.rowIndex >= 20000 ||
            d.reason !== 'insufficient_chart_identity',
        )
      )
        throw new Error('Invalid saved source connection.');
    }
    for (const name of [
      'lastAttempt',
      'lastChecked',
      'lastSuccess',
      'sourceUpdatedAt',
      'retryAt',
    ] as const)
      if (source[name] !== null && (!Number.isSafeInteger(source[name]) || source[name] < 0))
        throw new Error('Invalid saved source connection.');
    if (!/^[a-f0-9]{64}$/.test(source.sourceRevision))
      throw new Error('Invalid saved source connection.');
    return source;
  }
  function connection(url: string, data: PlayerDataset, now = Date.now()): SourceConnection {
    return {
      schemaVersion: 1,
      type: 'report',
      url,
      playerKey: data.player.key,
      adapterVersion: 1,
      autoRefresh: true,
      generation: 0,
      lastAttempt: now,
      lastChecked: now,
      lastSuccess: now,
      sourceUpdatedAt: core.offer(data).capturedAt || null,
      sourceRevision: data.revision,
      retryAt: null,
    };
  }
  function retryAfter(value: string | null, now = Date.now()) {
    if (!value) return now + AUTO_INTERVAL;
    const until = /^\d+$/.test(value) ? now + Number(value) * 1000 : Date.parse(value);
    return Number.isSafeInteger(until)
      ? Math.max(now + MANUAL_INTERVAL, until)
      : now + AUTO_INTERVAL;
  }
  async function request(url: string, maximum: number, signal: AbortSignal, timeout: number) {
    const { response, bytes } = await sourceRequest(
      url,
      {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        redirect: 'error',
      },
      signal,
      timeout,
    );
    if (!response.ok) {
      const error = new DiagnosticError(
        'The public source could not be read. Open the report to use its import or download controls.',
        response.status === 429
          ? 'rate_limited'
          : response.status === 503
            ? 'upstream_busy'
            : [401, 403, 404].includes(response.status)
              ? 'profile_unavailable'
              : 'unknown',
        'transport',
      );
      if (response.status === 429 || response.status === 503)
        error.retryAt = retryAfter(response.headers.get('Retry-After'));
      throw error;
    }
    return {
      response,
      bytes: await bytes(maximum, undefined, 'The source response exceeds its size limit.'),
    };
  }
  async function readReport(
    value: string,
    { signal = new AbortController().signal, expectedPlayer = null }: ReadOptions = {},
  ) {
    const parsed = reportURL(value);
    if (!parsed.manifest)
      throw new Error(
        'This report link needs assisted import. Open the report and choose Open in Party, or download its player file.',
      );
    const { response, bytes: raw } = await request(parsed.manifest, 1024 * 1024, signal, 10000);
    if (
      !/^application\/(?:json|[a-z0-9.+-]+\+json)(?:;|$)/i.test(
        response.headers.get('Content-Type') || '',
      )
    )
      throw new DiagnosticError(
        'The source did not return player data. Open the report to sign in or download a player file.',
        'malformed_response',
        'response',
      );
    let parsedMeta: unknown;
    try {
      parsedMeta = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    } catch {
      throw new DiagnosticError(
        'The source did not return valid player data.',
        'malformed_response',
        'response',
      );
    }
    let meta: PlayerOffer & {
      object?: { sha256: string; path: string; bytes: number };
    };
    try {
      meta = core.validateOffer(parsedMeta);
    } catch (error) {
      throw new DiagnosticError(
        error instanceof Error ? error.message : 'Invalid report data offer.',
        'contract_changed',
        'response',
      );
    }
    const ref = meta.object,
      prefix = new URL(parsed.manifest).pathname.slice(0, -'latest.json'.length);
    if (
      !ref ||
      !/^[a-f0-9]{64}$/.test(ref.sha256) ||
      ref.path !== prefix + 'data/' + ref.sha256 + '.gz' ||
      !Number.isSafeInteger(ref.bytes) ||
      ref.bytes < 1 ||
      ref.bytes > core.MAX_COMPRESSED
    )
      throw new DiagnosticError('Invalid player data reference.', 'contract_changed', 'response');
    if (expectedPlayer && meta.player.key !== expectedPlayer)
      throw new DiagnosticError(
        'The source now identifies a different player. Import it again to confirm the switch.',
        'identity',
        'identity',
      );
    const { bytes } = await request(
      new URL(ref.path, parsed.manifest).href,
      ref.bytes,
      signal,
      30000,
    );
    if (bytes.length !== ref.bytes || (await core.hash(bytes)) !== ref.sha256)
      throw new DiagnosticError('Player file integrity check failed.', 'integrity', 'response');
    let data: PlayerDataset;
    try {
      data = await core.decode(bytes);
    } catch (error) {
      throw new DiagnosticError(
        error instanceof Error ? error.message : 'The source did not return valid player data.',
        'normalization',
        'decode',
      );
    }
    const offer = core.offer(data);
    if (
      !Object.entries(offer).every(
        ([key, value]) =>
          (key === 'profile' && !Object.hasOwn(meta, key)) ||
          core.canonical(value) === core.canonical(meta[key as keyof typeof meta]),
      )
    )
      throw new DiagnosticError(
        'The report sent a different dataset from the one offered.',
        'snapshot_changed',
        'identity',
      );
    signal.throwIfAborted();
    return { data, source: connection(parsed.manifest, data) };
  }
  async function readMaishift(
    value: MaishiftLocation,
    {
      signal = new AbortController().signal,
      manual = true,
      expectedPlayer = null,
    }: ReadOptions = {},
  ) {
    if (!capabilities.maishift)
      throw new Error(
        'Maishift import is not available yet. Full record access and exact chart matching are still being verified.',
      );
    const adapter = ports.maishift,
      selected = adapter.location(value.url || value.handle, value.region);
    const { response, bytes } = await sourceRequest(
      '/api/player-import/maishift',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: selected.handle, region: selected.region, manual }),
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        redirect: 'error',
      },
      signal,
      45000,
      'Maishift could not be read. Your saved data was kept. Try again later or open your public profile.',
    );
    if (!response.ok) {
      let reason: import('../diagnostic-contract').Reason =
        response.status === 429 ? 'rate_limited' : 'unknown';
      if (/^application\/json(?:;|$)/i.test(response.headers.get('Content-Type') || ''))
        try {
          const value = sourceJSON(await bytes(2048));
          reason = workerReason(
            value && typeof value === 'object' && 'error' in value ? value.error : undefined,
          );
        } catch (error) {
          signal.throwIfAborted();
          if (error instanceof DiagnosticError && [429, 503].includes(response.status))
            error.retryAt = retryAfter(response.headers.get('Retry-After'));
          throw error;
        }
      const error = new DiagnosticError(
        reason === 'region_mismatch'
          ? 'Maishift returned a different game region. Try the other region.'
          : 'Maishift could not be read. Your saved data was kept. Try again later or open your public profile.',
        reason,
        'response',
      );
      if (response.status === 429 || response.status === 503)
        error.retryAt = retryAfter(response.headers.get('Retry-After'));
      throw error;
    }
    if (!/^application\/json(?:;|$)/i.test(response.headers.get('Content-Type') || ''))
      throw new DiagnosticError(
        'Maishift returned an unsupported response. Your saved data was kept.',
        'malformed_response',
        'response',
      );
    const raw = await bytes(
      4 * 1024 * 1024,
      undefined,
      'Maishift returned an unsupported response. Your saved data was kept.',
    );
    let envelope: unknown;
    try {
      envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    } catch {
      throw new DiagnosticError(
        'Maishift returned an unsupported response. Your saved data was kept.',
        'malformed_response',
        'response',
      );
    }
    let result: Awaited<ReturnType<typeof adapter.normalize>>;
    try {
      result = await adapter.normalize(envelope, selected);
    } catch (error) {
      signal.throwIfAborted();
      if (diagnosticError(error)) throw error;
      throw new DiagnosticError(
        error instanceof Error
          ? error.message
          : 'Maishift returned an unsupported response. Your saved data was kept.',
        'normalization',
        'normalize',
      );
    }
    const data = result.data,
      resolved = adapter.location(
        selected.handle,
        (envelope as { identity: { region: string } }).identity.region,
      );
    // Identity is the user-selected provider/region/handle. Profile dates describe
    // records, not account ownership; a normal upload can change createdAt.
    if (expectedPlayer && data.player.key !== expectedPlayer)
      throw new DiagnosticError(
        'The source now identifies a different player. Import it again to confirm the switch.',
        'identity',
        'identity',
      );
    const source: SourceConnection = {
      ...connection(resolved.url, data),
      type: 'maishift',
      adapterVersion: result.adapterVersion,
      handle: resolved.handle,
      region: resolved.region,
      profileCreatedAt: result.createdAt,
      profileRating: result.profileRating,
      sourceUpdatedAt: result.updatedAt,
      contentRevision: await core.digest({ charts: data.charts, records: data.records }),
      diagnostics: result.diagnostics,
      diagnosticCount: result.coverage.diagnosticCount,
    };
    signal.throwIfAborted();
    return { data, source };
  }
  function readSource(source: SourceLocation | SourceConnection, options: ReadOptions = {}) {
    return source.type === 'maishift'
      ? readMaishift(source, options)
      : readReport(source.url, options);
  }
  return Object.freeze({
    capabilities,
    reportURL,
    validateSource,
    connection,
    readReport,
    readMaishift,
    readSource,
    AUTO_INTERVAL,
    MANUAL_INTERVAL,
    retryAfter,
  });
}
