import type { Failure } from '../usage-contract';

// A symbol cannot arrive in provider JSON. The finite tag survives separate
// browser chunks while untyped errors and arbitrary upstream text stay opaque.
const tag = Symbol.for('maimai.party.import-failure-v1');
const reasons: readonly Failure[] = [
  'invalid',
  'unavailable',
  'storage',
  'unknown',
  'popup_blocked',
  'authorization_failed',
  'timeout',
  'network',
  'rate_limited',
  'connection_expired',
  'agreement_required',
  'profile_missing',
  'empty_scores',
  'invalid_response',
  'account_mismatch',
  'cleanup_required',
];

export class ImportFailureError extends Error {
  readonly [tag]: Failure;
  constructor(
    message: string,
    failure: Failure,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ImportFailureError';
    this[tag] = failure;
  }
}

/** Only errors explicitly classified at a reviewed branch affect telemetry. */
export function importFailure(error: unknown, fallback: Failure = 'unavailable'): Failure {
  if (typeof error === 'object' && error !== null && tag in error) {
    const value = error[tag];
    if (typeof value === 'string' && (reasons as readonly string[]).includes(value))
      return value as Failure;
  }
  return fallback;
}

/** Caller cancellation remains cancellation, even if a timeout also fires. */
export function transportFailure(
  error: unknown,
  message: string,
  signal?: AbortSignal,
  timeout?: AbortSignal,
): Error {
  signal?.throwIfAborted();
  return new ImportFailureError(
    message,
    timeout?.aborted || (error instanceof DOMException && error.name === 'TimeoutError')
      ? 'timeout'
      : 'network',
  );
}
