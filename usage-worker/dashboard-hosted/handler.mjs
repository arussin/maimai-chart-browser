const headers = {
  'Cache-Control':'private, no-store, max-age=0', 'CDN-Cache-Control':'no-store',
  'Cloudflare-CDN-Cache-Control':'no-store', 'Pragma':'no-cache',
  'X-Robots-Tag':'noindex, nofollow, noarchive', 'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer', 'X-Frame-Options':'DENY',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()', 'Vary':'Cookie, Cf-Access-Jwt-Assertion',
  'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};
const reply = (text, status) => new Response(text, {status, headers:{...headers,'Content-Type':'text/plain; charset=utf-8'}});
export const QUERIES = [
  'SELECT day,version,event,page,detail,failure,count FROM usage_daily ORDER BY day,version,event,page,detail,failure LIMIT 50001',
  'SELECT day,version,status FROM usage_coverage ORDER BY day,version LIMIT 10001',
];
export function createHandler({authenticate, render, now = () => new Date()}) {
  return {async fetch(request, env) {
    const url = new URL(request.url);
    if (url.origin !== 'https://adamrussin.com' || !['/maimai-dash','/maimai-dash/'].includes(url.pathname)) return reply('Not found',404);
    if (!['GET','HEAD'].includes(request.method)) return reply('Method not allowed',405);
    if (url.search) return reply('Query parameters are not supported',400);
    if (!await authenticate(request, env)) return reply('Access denied',403);
    if (request.method === 'HEAD') return new Response(null, {status:200,headers});
    try {
      if (!env.USAGE_DB) throw Error('Missing database binding');
      const results = await env.USAGE_DB.batch(QUERIES.map(sql => env.USAGE_DB.prepare(sql)));
      if (!Array.isArray(results) || results.length !== 2 || results.some(r => r.success !== true || !Array.isArray(r.results)) ||
          results[0].results.length > 50000 || results[1].results.length > 10000) throw Error('Incomplete query');
      const input = {schema_version:'usage-export-1',query_status:'ok',activation:'2026-10-03',totals:results[0].results,coverage:results[1].results};
      const capturedAt = now().toISOString();
      const {html, csp} = await render(input, capturedAt);
      return new Response(html, {headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':csp}});
    } catch { return reply('Latest usage data is unavailable. Please reload later; missing data is not zero.',503); }
  }};
}
