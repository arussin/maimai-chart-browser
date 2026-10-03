import assets from './assets.mjs';
import { monthPeriod, fetchAnalytics, readJsonBounded, validSnapshot } from './analytics.mjs';
import { renderBadge } from './render.mjs';

export const BADGE_PATH = '/badges/community.svg';
export const FRESH_MS = 3600000;
const RETRY_MS = 300000;

export function cacheKey(env, month, origin) {
  return new Request(origin + '/.community-badge-cache/v4/http-visits-30d-known-monitors-excluded/' + env.CF_ACCOUNT_ID + '/maimai.party/' + month);
}
async function getState(cache, key, now) {
  try {
    const hit = await cache.match(key);
    if (!hit) return null;
    const value = await readJsonBounded(hit, 16384);
    if (!value || !Number.isFinite(value.retryAfter)) return null;
    // A snapshot from another query policy must not impose its retry delay.
    if (value.snapshot != null && !validSnapshot(value.snapshot, now)) return null;
    return { snapshot: validSnapshot(value.snapshot, now) ? value.snapshot : null, retryAfter: value.retryAfter };
  } catch { return null; }
}
async function saveState(cache, key, value) {
  if (!cache) return;
  try {
    await cache.put(key, new Response(JSON.stringify(value), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' },
    }));
  } catch { /* Cache eviction or quota never breaks the image. */ }
}
export async function handle(request, env, ctx, dependencies = {}) {
  const url = new URL(request.url);
  if (url.pathname !== BADGE_PATH) return new Response('Not found', { status: 404 });
  if (!['GET', 'HEAD'].includes(request.method))
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  const now = dependencies.now ?? new Date();
  const period = monthPeriod(now);
  const cache = dependencies.cache ?? globalThis.caches?.default;
  const key = cacheKey(env, period.month, url.origin);
  const cached = cache ? await getState(cache, key, now) : null;
  let snapshot = cached?.snapshot ?? null;
  let state = snapshot ? 'fresh' : 'unavailable';
  const age = snapshot ? now.getTime() - Date.parse(snapshot.updatedAt) : Infinity;
  if (age >= FRESH_MS && (cached?.retryAfter ?? 0) <= now.getTime()) {
    try {
      snapshot = await fetchAnalytics(env, period, dependencies.fetcher ?? fetch);
      state = 'fresh';
      // Await the tiny cache write to avoid repeated misses on the next request.
      await saveState(cache, key, { snapshot, retryAfter: now.getTime() + FRESH_MS });
    } catch {
      state = snapshot ? 'stale' : 'unavailable';
      await saveState(cache, key, { snapshot, retryAfter: now.getTime() + RETRY_MS });
    }
  } else if (age >= FRESH_MS) state = snapshot ? 'stale' : 'unavailable';
  const svg = renderBadge(snapshot, state, assets);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(svg));
  const etag = '"' + [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('') + '"';
  const headers = new Headers({
    'Content-Type': 'image/svg+xml; charset=utf-8',
    'Cache-Control': state === 'fresh' ? 'public, max-age=300, s-maxage=3600' : 'public, max-age=60, s-maxage=60',
    'ETag': etag,
    'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'none'; sandbox",
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*',
    'X-Badge-State': state,
  });
  if (snapshot) headers.set('Last-Modified', new Date(snapshot.updatedAt).toUTCString());
  const matches = (request.headers.get('If-None-Match') ?? '').split(',').map(x => x.trim().replace(/^W\//, ''));
  if (matches.includes(etag) || matches.includes('*')) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : svg, { headers });
}

