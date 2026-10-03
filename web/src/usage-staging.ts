import { createUsageForOrigin } from './usage-client';
export type { UsageAPI } from './usage-client';
/** Build-only staging replacement. The production graph never imports this entry. */
export function createUsage() {
  return createUsageForOrigin('https://maimai-party-staging.pages.dev');
}
