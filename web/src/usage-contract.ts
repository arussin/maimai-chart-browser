/** Finite public product counts. This module accepts no application state. */
export const VERSION = 1;
export const PAGES = ['charts', 'patterns', 'compare', 'about', 'song', 'version'] as const;
export type Page = (typeof PAGES)[number];
const methods = [
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
] as const;
const connectedProviders = ['diving-fish', 'lxns'] as const;
const directProviders = ['kamaitachi', 'diving-fish', 'lxns'] as const;
const refreshSources = ['report', 'maishift', 'kamaitachi', 'diving-fish', 'lxns'] as const;
export const SCORE_EXPORT_KINDS = ['best50', 'achievement_pb', 'achievement_play'] as const;
export type ScoreExportKind = (typeof SCORE_EXPORT_KINDS)[number];
export const DETAILS = {
  page_view: [''],
  settings_opened: [''],
  filters_opened: ['catalog', 'personal'],
  filter_first_used: [
    'format',
    'region',
    'international',
    'difficulty',
    'level',
    'genre',
    'version',
    'bpm',
    'constant',
    'pattern',
    'coverage',
    'profile',
    'personal_scope',
    'grade',
    'lamp',
    'sync',
    'achievement',
    'rating',
  ],
  filters_reset: ['catalog', 'personal', 'all'],
  search_used: ['charts', 'patterns', 'compare'],
  chart_opened: [''],
  chart_section_opened: ['chart', 'player'],
  compare_requested: [''],
  compare_loaded: [''],
  similar_requested: [''],
  import_opened: [''],
  import_started: methods,
  import_previewed: methods,
  import_confirmed: methods,
  import_completed: methods,
  import_failed: methods,
  import_cancelled: methods,
  // Explicit user-initiated stages only. Automatic refresh, restore, status
  // polling and background cleanup never emit these counters.
  provider_connect_started: connectedProviders,
  provider_connect_completed: connectedProviders,
  provider_connect_cancelled: connectedProviders,
  provider_connect_failed: connectedProviders,
  provider_read_started: directProviders,
  provider_read_completed: directProviders,
  provider_read_cancelled: directProviders,
  provider_read_failed: directProviders,
  provider_refresh_started: refreshSources,
  provider_refresh_completed: refreshSources,
  provider_refresh_cancelled: refreshSources,
  provider_refresh_failed: refreshSources,
  provider_disconnect_started: connectedProviders,
  provider_disconnect_completed: connectedProviders,
  provider_disconnect_failed: connectedProviders,
  provider_cleanup_started: connectedProviders,
  provider_cleanup_completed: connectedProviders,
  provider_cleanup_failed: connectedProviders,
  data_action: ['show', 'hide', 'forget', 'clear'],
  score_export_opened: SCORE_EXPORT_KINDS,
  score_export_option_changed: ['version', 'partner'],
  score_export_started: SCORE_EXPORT_KINDS,
  score_export_completed: SCORE_EXPORT_KINDS,
  score_export_failed: SCORE_EXPORT_KINDS,
  score_export_download_clicked: SCORE_EXPORT_KINDS,
  share_opened: [''],
  share_destination_clicked: [
    'facebook',
    'whatsapp',
    'reddit',
    'x',
    'facebook_messenger',
    'line',
    'hatena',
    'kakao',
    'naver',
    'wechat',
    'sina_weibo',
    'qzone',
    'more',
  ],
  share_native_result: ['resolved', 'cancelled', 'failed'],
  share_copied: [''],
  resource_opened: [
    'youtube',
    'mai_notes',
    'maishift',
    'session_report',
    'import_help',
    'diving_fish',
    'lxns',
  ],
  report_issue_opened: [''],
} as const satisfies Readonly<Record<string, readonly string[]>>;
export type EventName = keyof typeof DETAILS;
export type EventDetail<E extends EventName> = (typeof DETAILS)[E][number];
type ScoreExportEvent = Extract<EventName, `score_export_${string}`>;
export type ScoreExportUsageArguments = {
  [E in ScoreExportEvent]: [event: E, detail: EventDetail<E>];
}[ScoreExportEvent];
export const FAILURES = [
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
] as const;
export type Failure = (typeof FAILURES)[number];
const failureEvents = [
  'import_failed',
  'provider_connect_failed',
  'provider_read_failed',
  'provider_refresh_failed',
  'provider_disconnect_failed',
  'provider_cleanup_failed',
] as const;
type FailureEvent = (typeof failureEvents)[number];
export type UsageRow = {
  [E in EventName]: {
    event: E;
    page: Page;
    detail: EventDetail<E>;
    failure: E extends FailureEvent ? Failure : '';
    count: number;
  };
}[EventName];
export type EmitArguments = {
  [E in EventName]: E extends FailureEvent
    ? [event: E, page: Page | undefined, detail: EventDetail<E>, failure: Failure]
    : '' extends EventDetail<E>
      ? [event: E, page?: Page, detail?: EventDetail<E>, failure?: '']
      : [event: E, page: Page | undefined, detail: EventDetail<E>, failure?: ''];
}[EventName];
export interface Batch {
  version: 1;
  events: UsageRow[];
}
const record = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x);
export function validateRow(value: unknown): UsageRow | null {
  if (
    !record(value) ||
    Object.keys(value).some((k) => !['event', 'page', 'detail', 'failure', 'count'].includes(k))
  )
    return null;
  const { event, page, detail, count } = value,
    failure = value.failure ?? '';
  if (
    typeof event !== 'string' ||
    !Object.hasOwn(DETAILS, event) ||
    typeof detail !== 'string' ||
    !(DETAILS[event as EventName] as readonly string[]).includes(detail) ||
    !PAGES.includes(page as Page) ||
    !Number.isSafeInteger(count) ||
    Number(count) < 1 ||
    Number(count) > 100
  )
    return null;
  if (
    typeof failure !== 'string' ||
    ((failureEvents as readonly string[]).includes(event)
      ? !(FAILURES as readonly string[]).includes(failure)
      : failure !== '')
  )
    return null;
  if (
    ['filters_opened', 'filter_first_used', 'filters_reset'].includes(event) &&
    !['charts', 'patterns', 'compare', 'version', 'song'].includes(String(page))
  )
    return null;
  // The checks above establish the correlated event/detail/failure union.
  return { event, page: page as Page, detail, failure, count: Number(count) } as UsageRow;
}
export function validateBatch(value: unknown): Batch | null {
  if (
    !record(value) ||
    Object.keys(value).sort().join(',') !== 'events,version' ||
    value.version !== VERSION ||
    !Array.isArray(value.events) ||
    !value.events.length ||
    value.events.length > 16
  )
    return null;
  const events: UsageRow[] = [];
  for (const row of value.events) {
    const safe = validateRow(row);
    if (!safe) return null;
    events.push(safe);
  }
  return { version: VERSION, events };
}
