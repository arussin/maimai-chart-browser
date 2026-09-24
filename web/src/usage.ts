import { createUsageForOrigin } from './usage-client';
export type { UsageAPI } from './usage-client';
/** Production eligibility cannot be changed by a page, query or runtime setting. */
export function createUsage() {
  return createUsageForOrigin('https://maimai.party');
}
