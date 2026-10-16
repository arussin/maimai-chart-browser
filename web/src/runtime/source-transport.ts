import { DiagnosticError } from './diagnostic-error';
import type { Reason } from '../diagnostic-contract';
const message = 'Maishift returned an unsupported response. Your saved data was kept.';
/** Fetch and body lifetime share a deadline. TypeError here means transport failure, never proven CORS. */
export async function sourceRequest(
  url: string,
  init: RequestInit,
  caller: AbortSignal,
  milliseconds: number,
  message = 'The public source could not be read. Open the report to use its import or download controls.',
) {
  const timeout = AbortSignal.timeout(milliseconds),
    signal = AbortSignal.any([caller, timeout]);
  const failure = () => {
    caller.throwIfAborted();
    return new DiagnosticError(
      message,
      timeout.aborted ? 'client_timeout' : 'network',
      'transport',
    );
  };
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal });
  } catch {
    throw failure();
  }
  async function bytes(
    maximum: number,
    oversizedMessage = 'Player history exceeds its size limit; nothing was replaced.',
    declaredSizeMessage = oversizedMessage,
  ) {
    if (Number(response.headers.get('Content-Length')) > maximum) {
      await response.body?.cancel();
      throw new DiagnosticError(declaredSizeMessage, 'oversized_response', 'response');
    }
    if (!response.body) throw new DiagnosticError(message, 'malformed_response', 'response');
    const reader = response.body.getReader(),
      parts: Uint8Array[] = [];
    let size = 0;
    const abort = () => {
      void reader.cancel().catch(() => {});
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      signal.throwIfAborted();
      for (;;) {
        const { done, value } = await reader.read();
        signal.throwIfAborted();
        if (done) break;
        size += value.length;
        if (size > maximum)
          throw new DiagnosticError(oversizedMessage, 'oversized_response', 'response');
        parts.push(value);
      }
    } catch (error) {
      if (error instanceof DiagnosticError) throw error;
      throw failure();
    } finally {
      signal.removeEventListener('abort', abort);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return result;
  }
  return { response, bytes };
}
export function sourceJSON(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new DiagnosticError(message, 'malformed_response', 'response');
  }
}
export const workerReasons: Readonly<Record<string, Reason>> = Object.freeze({
  worker_timeout: 'worker_timeout',
  upstream_network: 'network',
  rate_limited: 'rate_limited',
  upstream_busy: 'upstream_busy',
  profile_unavailable: 'profile_unavailable',
  region_mismatch: 'region_mismatch',
  contract_changed: 'contract_changed',
  invalid_response: 'malformed_response',
  response_too_large: 'oversized_response',
  snapshot_changed: 'snapshot_changed',
  source_unavailable: 'unknown',
  upstream_failed: 'unknown',
  integration_disabled: 'unknown',
  limiter_unavailable: 'unknown',
  profile_not_approved: 'unknown',
  invalid_request: 'unknown',
  request_cancelled: 'unknown',
});
export function workerReason(value: unknown): Reason {
  return typeof value === 'string' && Object.hasOwn(workerReasons, value)
    ? workerReasons[value]
    : 'unknown';
}
