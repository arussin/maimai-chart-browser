import type { OAuthProvider } from '../runtime/player-session-contracts';

const PATH = '/api/player-import/oauth';
const unavailable = 'The Diving-Fish connection could not be completed. Please try again.';
const removed = 'The provider connection could not be removed. Try again when online.';
const agreementRequired =
  'Open Diving-Fish, accept its tracker agreement, and confirm your scores are visible. Then try again.';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export interface OAuthConnection {
  provider: OAuthProvider;
  accountID: string;
  connectionID: string;
  displayName: string;
  connected: boolean;
  requiresReconnect: boolean;
  flowNonce?: string;
  warnings: string[];
  previousConnectionIDs?: string[];
}
interface OAuthRead extends OAuthConnection {
  fetchedAt: number;
  capturedAt: number | null;
  coverage: 'full';
  data: unknown;
}
interface ConnectionPorts {
  bounded(stream: ReadableStream<Uint8Array>, maximum: number): Promise<Uint8Array>;
  fetch?: typeof fetch;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const timestamp = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 8640000000000000;
export function isOAuthProvider(value: unknown): value is OAuthProvider {
  return value === 'diving-fish';
}
function connection(value: unknown): OAuthConnection {
  if (
    !object(value) ||
    !isOAuthProvider(value.provider) ||
    typeof value.accountID !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.accountID) ||
    typeof value.connectionID !== 'string' ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(value.connectionID) ||
    typeof value.displayName !== 'string' ||
    !value.displayName.trim() ||
    value.displayName.length > 200 ||
    (value.flowNonce !== undefined &&
      (typeof value.flowNonce !== 'string' || !uuid.test(value.flowNonce))) ||
    (value.warnings !== undefined &&
      (!Array.isArray(value.warnings) ||
        value.warnings.some((warning) => warning !== 'fish_masking_unverified')))
  )
    throw new Error(unavailable);
  return {
    provider: value.provider,
    accountID: value.accountID,
    connectionID: value.connectionID,
    displayName: value.displayName,
    connected: value.connected !== false,
    requiresReconnect: value.requiresReconnect === true,
    ...(typeof value.flowNonce === 'string' ? { flowNonce: value.flowNonce } : {}),
    warnings: (value.warnings as string[] | undefined) ?? [],
  };
}
/** OAuth grants stay behind the same-origin HttpOnly session; only opaque IDs enter browser storage. */
export function createPlayerProviderConnections(ports: ConnectionPorts) {
  const request = ports.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const cleanupKey = 'maimai-provider-cleanup-v1';
  let storage = ports.storage;
  if (!storage)
    try {
      storage = globalThis.localStorage;
    } catch {}
  type Cleanup = { provider: OAuthProvider; connectionID?: string; nonce?: string };
  let cleanup: Cleanup[] = [];
  let volatileCleanup: Cleanup[] = [];
  const cleanupID = (entry: Cleanup) => entry.provider + ':' + (entry.connectionID ?? entry.nonce);
  function refreshCleanup() {
    if (!storage) return;
    try {
      const saved: unknown = JSON.parse(storage.getItem(cleanupKey) ?? '[]');
      if (
        Array.isArray(saved) &&
        saved.length <= 8 &&
        saved.every(
          (entry) =>
            object(entry) &&
            typeof entry.provider === 'string' &&
            ((typeof entry.connectionID === 'string' &&
              /^[A-Za-z0-9_-]{16,128}$/.test(entry.connectionID)) ||
              (typeof entry.nonce === 'string' && uuid.test(entry.nonce))),
        )
      )
        cleanup = [
          ...new Map(
            [
              ...saved
                .filter((entry) => isOAuthProvider(entry.provider))
                .map((entry) => ({
                  provider: entry.provider,
                  ...(entry.connectionID
                    ? { connectionID: entry.connectionID }
                    : { nonce: entry.nonce }),
                })),
              ...volatileCleanup,
            ].map((entry) => [cleanupID(entry), entry]),
          ).values(),
        ].slice(0, 8);
    } catch {}
  }
  refreshCleanup();
  function saveCleanup() {
    try {
      if (cleanup.length) storage?.setItem(cleanupKey, JSON.stringify(cleanup));
      else storage?.removeItem(cleanupKey);
      volatileCleanup = [];
    } catch {
      volatileCleanup = [...cleanup];
    }
  }
  async function json(path: string, body: Record<string, unknown> | null, signal?: AbortSignal) {
    const response = await request(PATH + path, {
      method: body === null ? 'GET' : 'POST',
      headers: body === null ? {} : { 'Content-Type': 'application/json', 'X-Party-Import': '1' },
      ...(body === null ? {} : { body: JSON.stringify(body) }),
      credentials: 'same-origin',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(45000)])
        : AbortSignal.timeout(45000),
    });
    if (response.status === 429 || response.status === 503) {
      const now = Date.now(),
        retry = response.headers.get('Retry-After') ?? '';
      const until = /^\d+$/.test(retry) ? now + Number(retry) * 1000 : Date.parse(retry);
      const error: Error & { retryAt: number } = Object.assign(new Error(unavailable), {
        retryAt: Number.isSafeInteger(until)
          ? Math.max(now + 30000, Math.min(now + 86400000, until))
          : now + 900000,
      });
      throw error;
    }
    if (response.status === 401 || response.status === 409)
      throw new Error('The connection needs to be renewed. Connect your account again.');
    if (response.status === 403 && path === '/diving-fish/read') {
      let value: unknown;
      try {
        if (
          !/^application\/json(?:;|$)/i.test(response.headers.get('Content-Type') ?? '') ||
          Number(response.headers.get('Content-Length')) > 2048 ||
          !response.body
        )
          throw new Error(unavailable);
        value = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(
            await ports.bounded(response.body, 2048),
          ),
        );
      } catch {
        await response.body?.cancel().catch(() => {});
        throw new Error(unavailable);
      }
      if (object(value) && value.error === 'tracker_agreement_required')
        throw Object.assign(new Error(agreementRequired), { code: 'tracker_agreement_required' });
      throw new Error(unavailable);
    }
    if (
      !response.ok ||
      !/^application\/json(?:;|$)/i.test(response.headers.get('Content-Type') ?? '') ||
      Number(response.headers.get('Content-Length')) > 32 * 1024 * 1024 ||
      !response.body
    )
      throw new Error(unavailable);
    let value: unknown;
    try {
      value = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(
          await ports.bounded(response.body, 32 * 1024 * 1024),
        ),
      );
    } catch {
      throw new Error(unavailable);
    }
    if (!object(value)) throw new Error(unavailable);
    signal?.throwIfAborted();
    return value;
  }
  async function capabilities(signal?: AbortSignal) {
    const value = await json('/capabilities', null, signal);
    if (!object(value.providers)) throw new Error(unavailable);
    return {
      'diving-fish':
        object(value.providers['diving-fish']) && value.providers['diving-fish'].enabled === true,
    };
  }
  async function status(signal?: AbortSignal) {
    const value = await json('/status', {}, signal);
    if (!Array.isArray(value.connections) || value.connections.length > 2)
      throw new Error(unavailable);
    return value.connections.map(connection);
  }
  async function start(
    provider: OAuthProvider,
    nonce: string,
    maskingDisabled: boolean,
    signal: AbortSignal,
    locale = 'en',
  ) {
    if (!isOAuthProvider(provider) || !uuid.test(nonce)) throw new Error(unavailable);
    refreshCleanup();
    if (cleanup.length)
      throw new Error('Retry connection cleanup before connecting another account.');
    const value = await json(
      '/' + provider + '/start',
      {
        nonce,
        locale,
        maskingDisabled,
      },
      signal,
    );
    if (typeof value.authorizationURL !== 'string') throw new Error(unavailable);
    const url = new URL(value.authorizationURL);
    const origin = 'https://auth.diving-fish.com';
    if (
      url.origin !== origin ||
      url.pathname !== '/oauth/authorize' ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new Error(unavailable);
    return url.href;
  }
  async function read(
    provider: OAuthProvider,
    connectionID: string,
    signal: AbortSignal,
  ): Promise<OAuthRead> {
    if (!isOAuthProvider(provider)) throw new Error(unavailable);
    const value = await json('/' + provider + '/read', { connectionID }, signal);
    const grant = connection(value);
    if (
      grant.provider !== provider ||
      grant.connectionID !== connectionID ||
      !timestamp(value.fetchedAt) ||
      (value.capturedAt !== null && !timestamp(value.capturedAt)) ||
      value.coverage !== 'full' ||
      !('data' in value)
    )
      throw new Error(unavailable);
    return {
      ...grant,
      fetchedAt: value.fetchedAt,
      capturedAt: value.capturedAt,
      coverage: 'full',
      data: value.data,
    };
  }
  async function disconnect(
    provider: OAuthProvider,
    identity: { connectionID?: string; nonce?: string },
  ) {
    if (!isOAuthProvider(provider)) throw new Error(removed);
    if (
      !(
        typeof identity.connectionID === 'string' &&
        /^[A-Za-z0-9_-]{16,128}$/.test(identity.connectionID)
      ) &&
      !(typeof identity.nonce === 'string' && uuid.test(identity.nonce))
    )
      throw new Error(removed);
    const entry = { provider, ...identity },
      key = cleanupID(entry);
    try {
      const value = await json('/' + provider + '/disconnect', identity);
      if (value.disconnected !== true) throw new Error(removed);
      refreshCleanup();
      cleanup = cleanup.filter((row) => cleanupID(row) !== key);
      volatileCleanup = volatileCleanup.filter((row) => cleanupID(row) !== key);
      saveCleanup();
    } catch {
      refreshCleanup();
      if (!cleanup.some((row) => cleanupID(row) === key) && cleanup.length < 8) cleanup.push(entry);
      saveCleanup();
      throw new Error(removed);
    }
  }
  async function retryCleanup(provider?: OAuthProvider) {
    if (provider !== undefined && !isOAuthProvider(provider)) throw new Error(removed);
    refreshCleanup();
    const results = await Promise.allSettled(
      cleanup
        .filter((entry) => !provider || entry.provider === provider)
        .map(({ provider, ...identity }) => disconnect(provider, identity)),
    );
    if (results.some((result) => result.status === 'rejected')) throw new Error(removed);
  }
  return {
    capabilities,
    status,
    start,
    read,
    disconnect,
    retryCleanup,
    pendingCleanup: () => {
      refreshCleanup();
      return cleanup.length;
    },
    pendingCleanupProviders: (): OAuthProvider[] => {
      refreshCleanup();
      return [...new Set(cleanup.map((entry) => entry.provider))];
    },
  };
}

/** The popup is opened synchronously by a deliberate click, before any asynchronous request. */
export async function authorizeProvider(
  api: ReturnType<typeof createPlayerProviderConnections>,
  provider: OAuthProvider,
  popup: Window,
  nonce: string,
  maskingDisabled: boolean,
  signal: AbortSignal,
  browser: Window = window,
  locale = 'en',
  onCleanup?: (outcome: 'started' | 'completed' | 'failed') => void,
): Promise<OAuthConnection> {
  if (!isOAuthProvider(provider)) {
    popup.close();
    throw new Error(unavailable);
  }
  let complete = false;
  try {
    const result = await new Promise<OAuthConnection>((resolve, reject) => {
      let finished = false,
        checking = false,
        started = false;
      const finish = (error: Error | null, value?: OAuthConnection) => {
        if (finished) return;
        finished = true;
        clearInterval(timer);
        clearTimeout(timeout);
        browser.removeEventListener('message', receive);
        signal.removeEventListener('abort', cancel);
        if (error) reject(error);
        else resolve(value!);
      };
      const verify = async () => {
        if (finished || checking) return;
        checking = true;
        try {
          const grants = await api.status(signal);
          const grant = grants.find(
            (item) =>
              item.provider === provider &&
              item.flowNonce === nonce &&
              item.connected &&
              !item.requiresReconnect,
          );
          if (grant)
            finish(null, {
              ...grant,
              previousConnectionIDs: grants
                .filter(
                  (item) => item.provider === provider && item.connectionID !== grant.connectionID,
                )
                .map((item) => item.connectionID),
            });
        } catch (error) {
          finish(error instanceof Error ? error : new Error(unavailable));
        } finally {
          checking = false;
        }
      };
      const receive = (event: MessageEvent<unknown>) => {
        if (
          event.origin !== browser.location.origin ||
          event.source !== popup ||
          !object(event.data) ||
          event.data.type !== 'maimai-party-oauth' ||
          event.data.provider !== provider ||
          event.data.nonce !== nonce
        )
          return;
        if (event.data.status === 'connected') void verify();
        else if (event.data.status === 'error') finish(new Error(unavailable));
      };
      const cancel = () => finish(new DOMException('Superseded operation', 'AbortError'));
      // COOP may detach WindowProxy while sign-in is still in progress. Only a
      // matching server nonce, explicit cancel, or the bounded timeout ends it.
      const timer = setInterval(() => {
        if (started) void verify();
      }, 1500);
      const timeout = setTimeout(() => finish(new Error(unavailable)), 180000);
      browser.addEventListener('message', receive);
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
      else
        void api.start(provider, nonce, maskingDisabled, signal, locale).then(
          (url) => {
            if (!finished) {
              started = true;
              popup.location.href = url;
            }
          },
          (error: unknown) => finish(error instanceof Error ? error : new Error(unavailable)),
        );
    });
    signal.throwIfAborted();
    complete = true;
    return result;
  } finally {
    popup.close();
    if (!complete) {
      onCleanup?.('started');
      try {
        await api.disconnect(provider, { nonce });
        onCleanup?.('completed');
      } catch (error) {
        onCleanup?.('failed');
        throw error;
      }
    }
  }
}
