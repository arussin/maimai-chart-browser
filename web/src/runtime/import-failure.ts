import type { Failure } from '../usage-contract';
import type { Reason, Stage } from '../diagnostic-contract';
import { DiagnosticError, diagnosticError } from './diagnostic-error';

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

const diagnosticFailures: Record<Failure, { reason: Reason; stage: Stage }> = {
  invalid: { reason: 'normalization', stage: 'normalize' },
  unavailable: { reason: 'unknown', stage: 'response' },
  storage: { reason: 'storage_unavailable', stage: 'commit' },
  unknown: { reason: 'unknown', stage: 'response' },
  popup_blocked: { reason: 'popup_blocked', stage: 'authorization' },
  authorization_failed: { reason: 'authorization_failed', stage: 'authorization' },
  timeout: { reason: 'client_timeout', stage: 'transport' },
  network: { reason: 'network', stage: 'transport' },
  rate_limited: { reason: 'rate_limited', stage: 'response' },
  connection_expired: { reason: 'connection_expired', stage: 'authorization' },
  agreement_required: { reason: 'agreement_required', stage: 'response' },
  profile_missing: { reason: 'profile_unavailable', stage: 'response' },
  empty_scores: { reason: 'empty_scores', stage: 'normalize' },
  invalid_response: { reason: 'contract_changed', stage: 'response' },
  account_mismatch: { reason: 'identity', stage: 'identity' },
  cleanup_required: { reason: 'cleanup_required', stage: 'authorization' },
};
export class ImportFailureError extends DiagnosticError {
  readonly [tag]: Failure;
  constructor(
    message: string,
    failure: Failure,
    readonly code?: string,
    diagnostic = diagnosticFailures[failure],
  ) {
    super(message, diagnostic.reason, diagnostic.stage);
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
  const classified = diagnosticError(error);
  if (classified) {
    const mapped: Partial<Record<Reason, Failure>> = {
      client_timeout: 'timeout',
      worker_timeout: 'timeout',
      network: 'network',
      rate_limited: 'rate_limited',
      profile_unavailable: 'profile_missing',
      contract_changed: 'invalid_response',
      malformed_response: 'invalid_response',
      oversized_response: 'invalid_response',
      identity: 'account_mismatch',
      storage_unavailable: 'storage',
      storage_quota: 'storage',
      storage_denied: 'storage',
      popup_blocked: 'popup_blocked',
      authorization_failed: 'authorization_failed',
      connection_expired: 'connection_expired',
      agreement_required: 'agreement_required',
      empty_scores: 'empty_scores',
      cleanup_required: 'cleanup_required',
    };
    return mapped[classified.reason] ?? fallback;
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
