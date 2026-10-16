import { REASONS, STAGES, type Reason, type Stage } from '../diagnostic-contract.ts';
const tag = Symbol.for('maimai.party.diagnostic-error-v1');
export class DiagnosticError extends Error {
  readonly [tag]: { reason: Reason; stage: Stage };
  retryAt?: number;
  constructor(message: string, reason: Reason, stage: Stage) {
    super(message);
    this.name = 'DiagnosticError';
    this[tag] = { reason, stage };
  }
}
export function diagnosticError(error: unknown): { reason: Reason; stage: Stage } | null {
  if (!error || typeof error !== 'object' || !(tag in error)) return null;
  const v = error[tag] as { reason?: unknown; stage?: unknown };
  return v && REASONS.includes(v.reason as Reason) && STAGES.includes(v.stage as Stage)
    ? { reason: v.reason as Reason, stage: v.stage as Stage }
    : null;
}
export function storageReason(error: unknown): Reason {
  // Platform exception names only; messages, values and keys never enter telemetry.
  if (error instanceof DOMException) {
    if (error.name === 'QuotaExceededError') return 'storage_quota';
    if (error.name === 'SecurityError' || error.name === 'NotAllowedError') return 'storage_denied';
  }
  return 'storage_unavailable';
}
export async function diagnosticStep<T>(
  run: () => Promise<T>,
  reason: Reason,
  stage: Stage,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (diagnosticError(error) || (error instanceof Error && error.name === 'AbortError'))
      throw error;
    throw new DiagnosticError(
      error instanceof Error ? error.message : 'Unknown failure',
      reason,
      stage,
    );
  }
}
