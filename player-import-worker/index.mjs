import {ImportError,validInput,upstreamURL,decode,profile,minimize,MAX_RESPONSE_BYTES} from './contract.mjs';
export const PATH = '/api/player-import/maishift';
const PARTY = 'https://maimai.party', MAX_BYTES = 4 * 1024 * 1024;
export async function hash(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b => b.toString(16).padStart(2,'0')).join('');
}
export async function boundedJSON(response, maximum, signal) {
  if (!/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '')) throw new ImportError('invalid_response');
  if (Number(response.headers.get('content-length')) > maximum || !response.body) throw new ImportError('response_too_large');
  const reader = response.body.getReader(), chunks = []; let length = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort',abort,{once:true});
  try {
    signal.throwIfAborted();
    for (;;) {
      const {done,value} = await reader.read(); signal.throwIfAborted(); if (done) break;
      length += value.byteLength; if (length > maximum) throw new ImportError('response_too_large'); chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const part of chunks) { bytes.set(part,offset); offset += part.length; }
    try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); } catch { throw new ImportError('invalid_response'); }
  } finally { signal.removeEventListener('abort',abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export function retryTime(value, now) {
  const parsed = /^\d+$/.test(value || '') ? now + Number(value) * 1000 : Date.parse(value || '');
  // Unrepresentable values fail conservatively with a one-day backoff.
  return Number.isSafeInteger(parsed) ? Math.max(now + 30000,parsed) : now + 86400000;
}
function response(status, data, retryAt, now) {
  const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, private','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
  if (retryAt) headers['Retry-After'] = String(Math.max(1,Math.ceil((retryAt-now)/1000)));
  const body = JSON.stringify(data);
  // Includes envelope/diagnostics as well as the individually bounded records.
  if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) throw new ImportError('response_too_large');
  return new Response(body,{status,headers});
}
export function createService({fetcher = fetch, now = Date.now, timeoutMs = 30000} = {}) {
  // A transient count, never player data or a global rate quota. Several large
  // JSON decodes share one isolate's memory; reject excess work without queuing
  // bodies. Durable Objects still coordinate each profile across isolates.
  let activeImports = 0;
  return {async fetch(request,env) {
    let coordinator, lease, upstreamRetry = null, reserved = false;
    try {
      const url = new URL(request.url);
      if (url.origin !== PARTY || url.pathname !== PATH || url.search) return response(404,{error:'not_found'},null,now());
      if (request.method !== 'POST') return response(405,{error:'method_not_allowed'},null,now());
      if (request.headers.get('origin') !== PARTY || ['cross-site','none'].includes(request.headers.get('sec-fetch-site'))) return response(403,{error:'origin_not_allowed'},null,now());
      if (env.MAISHIFT_ENABLED !== 'true' || !env.CLIENT_LIMITER || !env.PROFILE_LIMITER) return response(503,{error:'integration_disabled'},null,now());
      // The trusted edge supplies this address. Only its digest enters counters.
      const ip = request.headers.get('CF-Connecting-IP');
      if (!ip || ip.length > 64) return response(503,{error:'limiter_unavailable'},null,now());
      if (!(await env.CLIENT_LIMITER.limit({key:await hash('client:'+ip)})).success) return response(429,{error:'rate_limited'},now()+60000,now());
      let input;
      try { input = await boundedJSON(request,2048,AbortSignal.any([request.signal,AbortSignal.timeout(5000)])); }
      catch { throw new ImportError('invalid_request',400); }
      if (!validInput(input)) throw new ImportError('invalid_request',400);
      if (activeImports >= 2) return response(429,{error:'rate_limited'},now()+30000,now());
      activeImports++; reserved = true;
      coordinator = env.PROFILE_LIMITER.getByName(await hash(input.region+':'+input.handle.toLowerCase()));
      lease = await coordinator.claim(input.manual);
      if (!lease.id) return response(429,{error:'rate_limited'},lease.retryAt,now());
      const signal = AbortSignal.any([request.signal,AbortSignal.timeout(timeoutMs)]);
      async function read(kind) {
        signal.throwIfAborted();
        const result = await fetcher(upstreamURL(kind,input),{method:'GET',headers:{Accept:'application/json','x-tsr-serverFn':'true'},
          credentials:'omit',referrerPolicy:'no-referrer',redirect:'manual',cache:'no-store',signal});
        if (!result.ok) {
          await result.body?.cancel();
          if (result.status === 429 || result.status === 503) throw new ImportError('upstream_busy',503,retryTime(result.headers.get('Retry-After'),now()));
          if ([401,403,404].includes(result.status)) throw new ImportError('profile_unavailable',404);
          throw new ImportError('upstream_failed');
        }
        return decode(await boundedJSON(result,MAX_BYTES,signal));
      }
      const before = profile(await read('profile'),input);
      const payload = minimize(await read('tracks'),before);
      const after = profile(await read('profile'),input);
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new ImportError('snapshot_changed',409);
      signal.throwIfAborted();
      return response(200,payload,null,now());
    } catch (error) {
      const known = error instanceof ImportError;
      upstreamRetry = known ? error.retryAt : null;
      return response(known ? error.status : 502,{error:known ? error.code : 'source_unavailable'},upstreamRetry,now());
    } finally {
      // Await completion so a failed coordinator never produces an unhandled
      // promise. A lost completion retains the expiring lease, failing closed.
      if (lease?.id) try { await coordinator.finish(lease.id,upstreamRetry); } catch {}
      if (reserved) activeImports--;
    }
  }};
}
