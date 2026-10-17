// Public presentation flags only. These do not grant provider access or revoke
// existing connections; OAuth readiness and all authorization checks stay separate.
export const CONNECTOR_FLAGS_KEY = 'connectors:v1';
export const CONNECTOR_FLAGS_MAX_BYTES = 8192;
export const CONNECTOR_FLAGS_TIMEOUT_MS = 3000;
export const CONNECTOR_METHODS = Object.freeze([
  'file', 'report', 'maishift', 'kamaitachi', 'diving-fish', 'lxns',
  'file:mai-tools', 'file:dxrating', 'file:tomomai', 'file:jietng', 'file:aqua', 'file:tachi',
]);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = () => new Error('Connector configuration is unavailable.');

/** Reconstruct an exact public contract, never relay arbitrary stored fields. */
export function normalizeConnectorFlags(value) {
  if (!object(value) || Object.keys(value).length !== 2 || value.schemaVersion !== 1 || !object(value.methods)
      || !Object.hasOwn(value, 'schemaVersion') || !Object.hasOwn(value, 'methods')
      || Object.keys(value.methods).some(key => !CONNECTOR_METHODS.includes(key) || typeof value.methods[key] !== 'boolean')) throw invalid();
  return {schemaVersion:1, methods:Object.fromEntries(CONNECTOR_METHODS.map(method => [method, Object.hasOwn(value.methods, method) && value.methods[method] === true]))};
}

/** Shared by the Worker and local operator tool; the limit is UTF-8 bytes. */
export function parseConnectorFlags(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > CONNECTOR_FLAGS_MAX_BYTES) throw invalid();
  let value;
  try { value = JSON.parse(text); } catch { throw invalid(); }
  return normalizeConnectorFlags(value);
}

function untilAborted(promise, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(invalid());
    signal.addEventListener('abort', abort, {once:true});
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Missing, malformed, oversized and slow KV reads all fail closed. */
export async function readConnectorFlags(env, requestSignal, {timeoutMs = CONNECTOR_FLAGS_TIMEOUT_MS} = {}) {
  if (typeof env.IMPORT_CONNECTOR_FLAGS?.get !== 'function') throw invalid();
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeoutMs);
  const signal = requestSignal ? AbortSignal.any([requestSignal, deadline.signal]) : deadline.signal;
  let stream, reader;
  try {
    signal.throwIfAborted();
    const pending = Promise.resolve().then(() => env.IMPORT_CONNECTOR_FLAGS.get(CONNECTOR_FLAGS_KEY, {type:'stream', cacheTtl:60}));
    // KV has no abort argument. If its result arrives after the deadline, discard
    // the stream instead of leaving an unread body behind.
    pending.then(value => { if (signal.aborted) void value?.cancel?.().catch(() => {}); }, () => {});
    stream = await untilAborted(pending, signal);
    if (!stream || typeof stream.getReader !== 'function') throw invalid();
    reader = stream.getReader();
    const parts = []; let length = 0;
    for (;;) {
      const {done, value} = await untilAborted(reader.read(), signal);
      if (done) break;
      if (!(value instanceof Uint8Array)) throw invalid();
      length += value.byteLength;
      if (length > CONNECTOR_FLAGS_MAX_BYTES) throw invalid();
      parts.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    return parseConnectorFlags(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
  } catch { throw invalid(); }
  finally {
    clearTimeout(timer);
    deadline.abort();
    if (reader) {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
