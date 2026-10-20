import type { DiagnosticSink } from '../diagnostic-contract';
import { DiagnosticError } from './diagnostic-error';
import { beginDiagnostic } from './operation-diagnostics';
import { IMPORT_SERVICES, type ImportMethodValue } from '../views/player-import-services';

export type ImportConnectorFlags = Readonly<Record<ImportMethodValue, boolean>>;
const methods = IMPORT_SERVICES.flatMap((service) => service.methods.map((method) => method.value));
const limit = 8192;
const unavailable = () =>
  new DiagnosticError('Import options are unavailable.', 'contract_changed', 'response');
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function parseImportConnectorFlags(value: unknown): ImportConnectorFlags {
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, 'schemaVersion') ||
    !Object.hasOwn(value, 'methods') ||
    !object(value.methods)
  )
    throw unavailable();
  const entries = value.methods;
  if (
    Object.keys(entries).some(
      (key) => !methods.includes(key as ImportMethodValue) || typeof entries[key] !== 'boolean',
    )
  )
    throw unavailable();
  return Object.freeze(
    Object.fromEntries(
      methods.map((method) => [method, Object.hasOwn(entries, method) && entries[method] === true]),
    ) as Record<ImportMethodValue, boolean>,
  );
}

/** Offline recovery is local only; a successful all-off response is respected. */
export const OFFLINE_IMPORT_CONNECTORS = parseImportConnectorFlags({
  schemaVersion: 1,
  methods: { file: true },
});

function untilAborted<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(unavailable());
    signal.addEventListener('abort', abort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Read afresh on each modal opening; never persist a previously allowed method. */
export async function fetchImportConnectorFlags(
  signal: AbortSignal,
  transport: typeof fetch = fetch,
  timeoutMs = 4000,
  diagnose?: DiagnosticSink,
): Promise<ImportConnectorFlags> {
  const operation = beginDiagnostic(diagnose, 'connector_config');
  operation.stage('transport');
  const deadline = new AbortController();
  const abort = () => deadline.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => deadline.abort(), timeoutMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let response: Response | undefined;
  try {
    signal.throwIfAborted();
    const pending = transport('/api/player-import/oauth/connectors', {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: deadline.signal,
      headers: { Accept: 'application/json' },
    });
    pending.then(
      (response) => {
        if (deadline.signal.aborted) void response.body?.cancel().catch(() => {});
      },
      () => {},
    );
    response = await untilAborted(pending, deadline.signal);
    operation.stage('response');
    if (!response.ok)
      throw new DiagnosticError(
        'Import options are unavailable.',
        'configuration_unavailable',
        'response',
      );
    if (
      !response.body ||
      !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')
    )
      throw unavailable();
    const length = response.headers.get('content-length');
    if (length !== null && !/^\d+$/.test(length)) throw unavailable();
    if (length !== null && Number(length) > limit)
      throw new DiagnosticError(
        'Import options are unavailable.',
        'oversized_response',
        'response',
      );
    reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { value, done } = await untilAborted(reader.read(), deadline.signal);
      deadline.signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > limit)
        throw new DiagnosticError(
          'Import options are unavailable.',
          'oversized_response',
          'response',
        );
      parts.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      throw new DiagnosticError(
        'Import options are unavailable.',
        'malformed_response',
        'response',
      );
    }
    const flags = parseImportConnectorFlags(value);
    operation.stage('complete');
    operation.finish('success');
    return flags;
  } catch (error) {
    if (signal.aborted) operation.finish('superseded');
    else if (deadline.signal.aborted)
      operation.fail(
        new DiagnosticError('Import options are unavailable.', 'client_timeout', 'transport'),
      );
    else operation.fail(error, error instanceof SyntaxError ? 'malformed_response' : 'network');
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    deadline.abort();
    if (reader) {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    } else if (response?.body) void response.body.cancel().catch(() => {});
  }
}
