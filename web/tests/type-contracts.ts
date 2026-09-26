/** Compile-only negative cases: invalid semantic payloads must never type-check. */
import type { UsageAPI } from '../src/usage';
import type { UsageRow } from '../src/usage-contract';

export function verifyFiniteUsage(emit: UsageAPI['emit']): void {
  emit('page_view');
  emit('import_completed', undefined, 'file');
  emit('import_failed', 'charts', 'report', 'invalid');
  // @ts-expect-error Import method is required.
  emit('import_started');
  // @ts-expect-error Import detail cannot be omitted.
  emit('import_completed', 'charts');
  // @ts-expect-error Failure classes only belong to failed imports.
  emit('chart_opened', 'charts', '', 'invalid');
  // @ts-expect-error Failed imports require a failure class.
  emit('import_failed', 'charts', 'file');
  // @ts-expect-error Each event has its own detail enum.
  emit('search_used', undefined, 'file');
  // @ts-expect-error URLs are not allowed event metadata.
  emit('resource_opened', 'song', 'https://maimai.party/');
}

// @ts-expect-error Row discriminants must preserve the same semantic correlation.
const wrongDetail: UsageRow = {
  event: 'search_used',
  page: 'charts',
  detail: 'file',
  failure: '',
  count: 1,
};
// @ts-expect-error Non-failure rows cannot carry a failure reason.
const wrongFailure: UsageRow = {
  event: 'page_view',
  page: 'charts',
  detail: '',
  failure: 'invalid',
  count: 1,
};
void wrongDetail;
void wrongFailure;
