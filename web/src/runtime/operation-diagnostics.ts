import {
  INSTRUMENTATION,
  type DiagnosticSink,
  type Operation,
  type Outcome,
  type Reason,
  type Source,
  type Stage,
} from '../diagnostic-contract.ts';
import { diagnosticError } from './diagnostic-error.ts';
/** One terminal diagnostic per logical operation. No error text or application values accepted. */
export function beginDiagnostic(
  sink: DiagnosticSink | undefined,
  operation: Operation,
  source: Source = 'none',
  mode: 'manual' | 'automatic' = 'automatic',
) {
  const started = Date.now();
  let ended = false,
    stage: Stage = 'start';
  const finish = (outcome: Outcome, reason: Reason = 'none') => {
    if (ended) return;
    ended = true;
    const elapsed = Math.max(0, Date.now() - started);
    // Diagnostics must never alter the underlying operation, even with a faulty port.
    try {
      sink?.({
        operation,
        stage,
        reason,
        outcome,
        source,
        mode,
        duration: elapsed < 1000 ? 'under_1s' : elapsed < 10000 ? '1_10s' : 'over_10s',
        instrumentation: INSTRUMENTATION,
        count: 1,
      });
    } catch {}
  };
  return {
    stage: (next: Stage) => {
      stage = next;
    },
    finish,
    fail: (error: unknown, fallback: Reason = 'unknown') => {
      const typed = diagnosticError(error);
      if (typed) {
        stage = typed.stage;
        finish('failed', typed.reason);
        return;
      }
      finish('failed', fallback);
    },
  };
}
