import { automationExclusions } from './traffic-policy.mjs';
export const GRAPHQL_ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';
export const GRAPHQL_QUERY = `query CommunityBadge($account: string!, $filter: AccountHttpRequestsAdaptiveGroupsFilter_InputObject!) {
  viewer { accounts(filter: {accountTag: $account}) {
    total: httpRequestsAdaptiveGroups(limit: 1, filter: $filter) { sum { visits } avg { sampleInterval } }
    regions: httpRequestsAdaptiveGroups(limit: 250, filter: $filter, orderBy: [sum_visits_DESC, clientCountryName_ASC]) {
      dimensions { countryName: clientCountryName } sum { visits } avg { sampleInterval }
    }
  } }
}`;

export function formatExactCount(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid count');
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function formatCount(value) {
  const exact = formatExactCount(value);
  return value < 10000 ? exact : value.toLocaleString('en-US', {
    notation: 'compact', maximumFractionDigits: 1,
  }).toLowerCase();
}

export function monthPeriod(now = new Date()) {
  const end = now.toISOString();
  return { start: new Date(now.getTime() - 30 * 86400000).toISOString(), end, month: end.slice(0, 7) };
}

export function queryBody(env, period) {
  if (!/^[a-f0-9]{32}$/.test(env.CF_ACCOUNT_ID ?? '')) throw new Error('Missing configuration');
  return {
    query: GRAPHQL_QUERY,
    variables: {
      account: env.CF_ACCOUNT_ID,
      filter: {
        clientRequestHTTPHost: 'maimai.party',
        requestSource: 'eyeball',
        AND: automationExclusions(),
        datetime_geq: period.start,
        datetime_lt: period.end,
      },
    },
  };
}

function checkedCount(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid analytics response');
  return value;
}
function sampled(row) {
  const interval = row?.avg?.sampleInterval;
  if (typeof interval !== 'number' || !Number.isFinite(interval) || interval < 1)
    throw new Error('Missing sampling metadata');
  return interval > 1;
}

export function parseAnalytics(payload, period) {
  if (!payload || (payload.errors != null && (!Array.isArray(payload.errors) || payload.errors.length)))
    throw new Error('Analytics query failed');
  const accounts = payload.data?.viewer?.accounts;
  if (!Array.isArray(accounts) || accounts.length !== 1) throw new Error('Account unavailable');
  const { total, regions } = accounts[0];
  if (!Array.isArray(total) || total.length > 1 || !Array.isArray(regions) || regions.length >= 250)
    throw new Error('Incomplete analytics response');
  // A successful empty query means no measured visits. An error never becomes zero.
  if (total.length === 0 && regions.length) throw new Error('Missing total');
  const visits = total.length ? checkedCount(total[0]?.sum?.visits) : 0;
  let estimated = total.length ? sampled(total[0]) : false;
  const seen = new Set();
  const rows = [];
  for (const row of regions) {
    const count = checkedCount(row?.sum?.visits);
    const rowSampled = sampled(row); estimated = estimated || rowSampled;
    const country = row?.dimensions?.countryName;
    if (typeof country !== 'string' || seen.has(country)) throw new Error('Invalid region');
    seen.add(country);
    // Unknown geolocation stays in the total, never receives an invented flag.
    if (!/^[A-Z]{2}$/.test(country) || ['XX', 'T1', 'ZZ'].includes(country) || count === 0) continue;
    rows.push({ country, visits: count });
  }
  rows.sort((a, b) => b.visits - a.visits || a.country.localeCompare(b.country, 'en'));
  return { version: 5, source: 'httpRequestsAdaptiveGroups', metric: 'visits', month: period.month, start: period.start,
    updatedAt: period.end, visits, estimated, regions: rows.slice(0, 5) };
}

export async function readJsonBounded(response, limit = 131072) {
  if (!response.ok || !response.body) throw new Error('Analytics unavailable');
  const reader = response.body.getReader();
  let length = 0, text = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new Error('Oversized analytics response'); }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { reader.releaseLock(); }
}

export async function fetchAnalytics(env, period, fetcher = fetch) {
  const token = env.CF_ANALYTICS_TOKEN;
  if (typeof token !== 'string' || !token) throw new Error('Analytics credential unavailable');
  const body = queryBody(env, period);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetcher(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: controller.signal,
    });
    return parseAnalytics(await readJsonBounded(response), period);
  } finally { clearTimeout(timeout); }
}

export function validSnapshot(value, now = new Date()) {
  try {
    if (value?.version !== 5 || value.source !== 'httpRequestsAdaptiveGroups' || value.metric !== 'visits' || value.month !== monthPeriod(now).month ||
        value.start !== monthPeriod(new Date(value.updatedAt)).start || typeof value.estimated !== 'boolean' ||
        !Array.isArray(value.regions) || value.regions.length > 5) return false;
    checkedCount(value.visits);
    const age = now.getTime() - Date.parse(value.updatedAt);
    if (!Number.isFinite(age) || age < 0 || age >= 86400000) return false;
    const countries = new Set();
    for (const row of value.regions) {
      if (!/^[A-Z]{2}$/.test(row.country) || countries.has(row.country)) return false;
      countries.add(row.country); checkedCount(row.visits);
    }
    return true;
  } catch { return false; }
}

