/** Version 2 is a separate finite diagnostic batch; version 1 action semantics stay intact. */
export const DIAGNOSTIC_VERSION = 2;
export const INSTRUMENTATION = 'diagnostics-1';
export const OPERATIONS = [
  'import',
  'refresh',
  'restore',
  'storage',
  'preferences',
  'catalog',
  'chart_details',
  'image_export',
  'comparison',
  'similar',
  'provider_connect',
  'provider_disconnect',
  'provider_cleanup',
  'connector_config',
] as const;
export const STAGES = [
  'start',
  'authorization',
  'transport',
  'response',
  'normalize',
  'identity',
  'read',
  'decode',
  'reconcile',
  'commit',
  'renderer',
  'canvas',
  'encode',
  'preview',
  'artwork',
  'compute',
  'complete',
] as const;
export const REASONS = [
  'none',
  'unknown',
  'client_timeout',
  'worker_timeout',
  'network',
  'rate_limited',
  'upstream_busy',
  'profile_unavailable',
  'region_mismatch',
  'contract_changed',
  'malformed_response',
  'oversized_response',
  'snapshot_changed',
  'normalization',
  'identity',
  'storage_unavailable',
  'storage_quota',
  'storage_denied',
  'saved_malformed',
  'integrity',
  'renderer_module',
  'canvas_context',
  'png_encoding',
  'preview_preparation',
  'artwork_failed',
  'cooldown',
  'older_snapshot',
  'not_prepared',
  'insufficient_coverage',
  'no_matches',
  'popup_blocked',
  'authorization_failed',
  'connection_expired',
  'agreement_required',
  'empty_scores',
  'cleanup_required',
  'configuration_unavailable',
] as const;
export const OUTCOMES = [
  'success',
  'unchanged',
  'skipped',
  'unavailable',
  'degraded',
  'failed',
  'cancelled',
  'superseded',
  'recovered',
  'empty',
] as const;
export const SOURCES = [
  'none',
  'file',
  'report',
  'maishift',
  'kamaitachi',
  'diving-fish',
  'lxns',
  'file:mai-tools',
  'file:dxrating',
  'file:tomomai',
  'file:jietng',
  'file:aqua',
  'file:tachi',
  'temporary',
  'persistent',
  'best50',
  'achievement_pb',
  'achievement_play',
] as const;
export type Operation = (typeof OPERATIONS)[number];
export type Stage = (typeof STAGES)[number];
export type Reason = (typeof REASONS)[number];
export type Outcome = (typeof OUTCOMES)[number];
export type Source = (typeof SOURCES)[number];
export interface DiagnosticRow {
  operation: Operation;
  stage: Stage;
  reason: Reason;
  outcome: Outcome;
  source: Source;
  mode: 'manual' | 'automatic';
  duration: 'under_1s' | '1_10s' | 'over_10s';
  instrumentation: typeof INSTRUMENTATION;
  count: number;
}
export type DiagnosticSink = (row: DiagnosticRow) => void;
export function validateDiagnostic(value: unknown): DiagnosticRow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (
    Object.keys(r).sort().join(',') !==
    'count,duration,instrumentation,mode,operation,outcome,reason,source,stage'
  )
    return null;
  const member = (list: readonly string[], v: unknown) => typeof v === 'string' && list.includes(v);
  if (
    !member(OPERATIONS, r.operation) ||
    !member(STAGES, r.stage) ||
    !member(REASONS, r.reason) ||
    !member(OUTCOMES, r.outcome) ||
    !member(SOURCES, r.source) ||
    !member(['manual', 'automatic'], r.mode) ||
    !member(['under_1s', '1_10s', 'over_10s'], r.duration) ||
    r.instrumentation !== INSTRUMENTATION ||
    !Number.isSafeInteger(r.count) ||
    Number(r.count) < 1 ||
    Number(r.count) > 100
  )
    return null;
  const importSource = member(
    [
      'file',
      'report',
      'maishift',
      'kamaitachi',
      'diving-fish',
      'lxns',
      'file:mai-tools',
      'file:dxrating',
      'file:tomomai',
      'file:jietng',
      'file:aqua',
      'file:tachi',
    ],
    r.source,
  );
  if (
    ['import', 'refresh'].includes(String(r.operation))
      ? !importSource
      : ['provider_connect', 'provider_disconnect', 'provider_cleanup'].includes(
            String(r.operation),
          )
        ? !member(['diving-fish', 'lxns'], r.source)
        : ['restore', 'storage', 'preferences'].includes(String(r.operation))
          ? !member(['temporary', 'persistent'], r.source)
          : r.operation === 'image_export'
            ? !member(['best50', 'achievement_pb', 'achievement_play'], r.source)
            : r.source !== 'none'
  )
    return null;
  if (r.outcome === 'failed' && r.reason === 'none') return null;
  if (member(['success', 'recovered', 'cancelled', 'superseded'], r.outcome) && r.reason !== 'none')
    return null;
  // Return only reconstructed fields, never the input object or arbitrary strings.
  return {
    operation: r.operation,
    stage: r.stage,
    reason: r.reason,
    outcome: r.outcome,
    source: r.source,
    mode: r.mode,
    duration: r.duration,
    instrumentation: INSTRUMENTATION,
    count: r.count,
  } as DiagnosticRow;
}
export function validateDiagnosticBatch(
  value: unknown,
): { version: 2; events: DiagnosticRow[] } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const b = value as Record<string, unknown>;
  if (
    Object.keys(b).sort().join(',') !== 'events,version' ||
    b.version !== 2 ||
    !Array.isArray(b.events) ||
    !b.events.length ||
    b.events.length > 16
  )
    return null;
  const events: DiagnosticRow[] = [];
  for (const row of b.events) {
    const safe = validateDiagnostic(row);
    if (!safe) return null;
    events.push(safe);
  }
  return { version: 2, events };
}
