import type { PlayerStorage } from '../views/player-storage';
import type { DiagnosticSink } from '../diagnostic-contract';
import { beginDiagnostic } from './operation-diagnostics';
import { diagnosticError, DiagnosticError, storageReason } from './diagnostic-error';
/** Public transactions only, never keys, stored values or individual IDB requests. */
export function observeStorage(
  storage: PlayerStorage,
  sink: DiagnosticSink | undefined,
): PlayerStorage {
  const observe = <K extends keyof PlayerStorage>(key: K): PlayerStorage[K] =>
    ((...args: unknown[]) => {
      const op = beginDiagnostic(sink, 'storage', 'persistent');
      const stage = key === 'read' || key === 'verify' ? 'read' : 'commit';
      op.stage(stage);
      return Promise.resolve()
        .then(() => (storage[key] as (...args: unknown[]) => Promise<unknown>).apply(storage, args))
        .then(
          (value) => {
            op.finish(
              key === 'claim' && value === null ? 'skipped' : 'success',
              key === 'claim' && value === null ? 'cooldown' : 'none',
            );
            return value;
          },
          (error) => {
            const classified = diagnosticError(error)
              ? error
              : new DiagnosticError(
                  error instanceof Error ? error.message : 'Device storage is unavailable.',
                  storageReason(error),
                  stage,
                );
            op.fail(classified);
            throw classified;
          },
        );
    }) as PlayerStorage[K];
  return {
    read: observe('read'),
    begin: observe('begin'),
    verify: observe('verify'),
    save: observe('save'),
    forget: observe('forget'),
    clear: observe('clear'),
    claim: observe('claim'),
    finish: observe('finish'),
  };
}
