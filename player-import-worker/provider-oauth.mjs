// Fixed-origin OAuth entrypoint. The existing Maishift service is independent.
import {readConnectorFlags} from './connector-flags.mjs';
export const PARTY_ORIGIN = 'https://maimai.party';
export const OAUTH_PREFIX = '/api/player-import/oauth';
export const SESSION_COOKIE = '__Host-party-provider-import';
export const SESSION_MS = 30 * 86400000;
export const PROVIDERS = Object.freeze({
  'diving-fish': Object.freeze({
    variable: 'DIVING_FISH', issuer: 'https://auth.diving-fish.com',
    discovery: 'https://auth.diving-fish.com/.well-known/openid-configuration',
    authorize: 'https://auth.diving-fish.com/oauth/authorize',
    token: 'https://auth.diving-fish.com/oauth/token',
    userinfo: 'https://auth.diving-fish.com/oauth/userinfo',
    revoke: 'https://auth.diving-fish.com/oauth/revoke',
    records: 'https://www.diving-fish.com/api/maimaidxprober/player/records',
    scopes: ['openid', 'profile', 'prober.records.read'],
  }),
  lxns: Object.freeze({
    variable: 'LXNS', issuer: 'https://maimai.lxns.net',
    authorize: 'https://maimai.lxns.net/oauth/authorize',
    token: 'https://maimai.lxns.net/api/v0/oauth/token',
    userinfo: 'https://maimai.lxns.net/api/v0/oauth/userinfo', revoke: null,
    records: 'https://maimai.lxns.net/api/v0/user/maimai/player/scores',
    player: 'https://maimai.lxns.net/api/v0/user/maimai/player',
    scopes: ['openid', 'read_player'],
  }),
});
export class OAuthError extends Error {
  constructor(code, status = 502, retryAt = null) { super(code); this.code = code; this.status = status; this.retryAt = retryAt; }
}
export function validateDisconnectInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['connectionID','nonce'].includes(k))
    || (!input.connectionID && !input.nonce)
    || input.connectionID !== undefined && (typeof input.connectionID !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.connectionID))
    || input.nonce !== undefined && (typeof input.nonce !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.nonce)))
    throw new OAuthError('invalid_request', 400);
}
export const encoder = new TextEncoder();
export function base64url(bytes) {
  let value = ''; for (const b of bytes) value += String.fromCharCode(b);
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function randomID(bytes = 32) { return base64url(crypto.getRandomValues(new Uint8Array(bytes))); }
export async function digest(value) { return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))); }
export async function accountDigest(provider, sub) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(provider + '\0' + sub))), b => b.toString(16).padStart(2, '0')).join('');
}
export function encryptionKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  try { const bytes = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='), c => c.charCodeAt(0)); return bytes.length === 32 && base64url(bytes) === value ? bytes : null; } catch { return null; }
}
export function credentials(env, provider) {
  const p = PROVIDERS[provider]; if (!p) return null;
  const clientID = env[p.variable + '_OAUTH_CLIENT_ID'], clientSecret = env[p.variable + '_OAUTH_CLIENT_SECRET'];
  return typeof clientID === 'string' && /^[\x21-\x7e]{1,512}$/.test(clientID) && typeof clientSecret === 'string' && /^[\x21-\x7e]{1,4096}$/.test(clientSecret) ? {clientID, clientSecret} : null;
}
export function enabled(env, provider) {
  return Object.hasOwn(PROVIDERS, provider) && env.PROVIDER_OAUTH_ENABLED === 'true' && env[PROVIDERS[provider].variable + '_OAUTH_ENABLED'] === 'true' && !!credentials(env, provider)
    && !!encryptionKey(env.PROVIDER_OAUTH_ENCRYPTION_KEY) && typeof env.PROVIDER_OAUTH_SESSIONS?.getByName === 'function' && typeof env.PROVIDER_OAUTH_LIMITER?.limit === 'function';
}
export const callbackURL = provider => PARTY_ORIGIN + OAUTH_PREFIX + '/' + provider + '/callback';
export function jsonResponse(status, data, retryAt = null, now = Date.now()) {
  const headers = {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store, private', 'Referrer-Policy':'no-referrer', 'X-Content-Type-Options':'nosniff'};
  if (retryAt) headers['Retry-After'] = String(Math.max(1, Math.ceil((retryAt - now) / 1000)));
  return new Response(JSON.stringify(data), {status, headers});
}
export async function readJSON(response, maximum, signal) {
  if (!/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '') || !response.body || Number(response.headers.get('content-length')) > maximum) {
    await response.body?.cancel().catch(() => {}); throw new OAuthError('invalid_response');
  }
  const reader = response.body.getReader(), parts = []; let length = 0;
  const abort = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener('abort', abort, {once:true});
  try {
    signal.throwIfAborted();
    for (;;) { const {value, done} = await reader.read(); signal.throwIfAborted(); if (done) break; length += value.byteLength; if (length > maximum) throw new OAuthError('response_too_large'); parts.push(value); }
    const bytes = new Uint8Array(length); let at = 0; for (const part of parts) { bytes.set(part, at); at += part.length; }
    try { return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); } catch { throw new OAuthError('invalid_response'); }
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function sessionID(request) {
  const entries = (request.headers.get('cookie') || '').split(';').map(v => v.trim()).filter(v => v.startsWith(SESSION_COOKIE + '='));
  if (entries.length !== 1) return null;
  const id = entries[0].slice(SESSION_COOKIE.length + 1); return /^[A-Za-z0-9_-]{43}$/.test(id) ? id : null;
}
function setSession(response, id) {
  const headers = new Headers(response.headers);
  headers.append('Set-Cookie', SESSION_COOKIE + '=' + id + '; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=' + SESSION_MS / 1000);
  return new Response(response.body, {status:response.status, headers});
}
export function callbackPage(provider, outcome) {
  const nonce = randomID(18);
  // Every reflected value is produced by our core, never an upstream error text.
  const message = {type:'maimai-party-oauth', provider, status:outcome.ok ? 'connected' : 'error', nonce:outcome.nonce || null};
  if (!outcome.ok) message.error = /^[a-z_]{1,64}$/.test(outcome.error || '') ? outcome.error : 'connection_failed';
  const messages = {
    en:['Connection completed. You can close this window.','Connection was not completed. Return to maimai.party to try again.'],
    ja:['連携が完了しました。このウィンドウを閉じてください。','連携できませんでした。maimai.party に戻って再試行してください。'],
    ko:['연결되었습니다. 이 창을 닫아 주세요.','연결되지 않았습니다. maimai.party로 돌아가 다시 시도해 주세요.'],
    'zh-Hans':['连接已完成。可以关闭此窗口。','连接未完成。请返回 maimai.party 重试。'],
    id:['Koneksi selesai. Anda dapat menutup jendela ini.','Koneksi belum selesai. Kembali ke maimai.party untuk mencoba lagi.'],
  };
  const locale = Object.hasOwn(messages, outcome.locale) ? outcome.locale : 'en';
  const script = `history.replaceState(null,'',location.pathname);if(window.opener){window.opener.postMessage(${JSON.stringify(message)},${JSON.stringify(PARTY_ORIGIN)});window.close();}`;
  return new Response(`<!doctype html><html lang="${locale}"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>maimai.party</title><p>${messages[locale][outcome.ok ? 0 : 1]}</p><script nonce="${nonce}">${script}</script></html>`, {status:200, headers:{
    'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store, private', 'Referrer-Policy':'no-referrer', 'X-Content-Type-Options':'nosniff',
    'Content-Security-Policy':`default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
  }});
}
export function createProviderOAuthService({now = Date.now} = {}) {
  return {async fetch(request, env) {
    let callbackProvider = null;
    try {
      const url = new URL(request.url);
      if (url.origin !== PARTY_ORIGIN || url.pathname.length > 160 || url.href.length > 8192) return jsonResponse(404, {error:'not_found'});
      if (url.pathname === OAUTH_PREFIX + '/connectors') {
        if (url.search) return jsonResponse(404, {error:'not_found'});
        if (request.method !== 'GET') return jsonResponse(405, {error:'method_not_allowed'});
        try { return jsonResponse(200, await readConnectorFlags(env, request.signal)); }
        catch { return jsonResponse(503, {error:'connectors_unavailable'}); }
      }
      if (url.pathname === OAUTH_PREFIX + '/capabilities' && !url.search && request.method === 'GET') return jsonResponse(200, {providers:Object.fromEntries(Object.keys(PROVIDERS).map(p => [p, {enabled:enabled(env, p)}]))});
      const match = url.pathname.match(/^\/api\/player-import\/oauth\/(diving-fish|lxns)\/(start|callback|read|disconnect)$/);
      const status = url.pathname === OAUTH_PREFIX + '/status';
      if (!match && !status) return jsonResponse(404, {error:'not_found'});
      const provider = match?.[1], action = status ? 'status' : match[2];
      if (action === 'callback') callbackProvider = provider;
      if (request.method !== (action === 'callback' ? 'GET' : 'POST')) return jsonResponse(405, {error:'method_not_allowed'});
      if (action !== 'callback' && (url.search || request.headers.get('origin') !== PARTY_ORIGIN || request.headers.get('x-party-import') !== '1' || ['cross-site','none'].includes(request.headers.get('sec-fetch-site')))) return jsonResponse(403, {error:'origin_not_allowed'});
      if (!encryptionKey(env.PROVIDER_OAUTH_ENCRYPTION_KEY) || !env.PROVIDER_OAUTH_SESSIONS?.getByName || !env.PROVIDER_OAUTH_LIMITER?.limit) throw new OAuthError('integration_disabled', 503);
      if (provider && action !== 'disconnect' && !enabled(env, provider)) throw new OAuthError('integration_disabled', 503);
      const ip = request.headers.get('CF-Connecting-IP');
      if (!ip || ip.length > 64) throw new OAuthError('limiter_unavailable', 503);
      if (!(await env.PROVIDER_OAUTH_LIMITER.limit({key:await digest('provider-oauth\0' + ip)})).success) throw new OAuthError('rate_limited', 429, now() + 60000);
      let id = sessionID(request), input = {};
      if (action === 'callback') {
        if (!id) throw new OAuthError('invalid_state', 400);
        for (const key of ['state','code','error','iss']) if (url.searchParams.getAll(key).length > 1) throw new OAuthError('invalid_state', 400);
        input = Object.fromEntries(['state','code','error','iss'].filter(k => url.searchParams.has(k)).map(k => [k,url.searchParams.get(k)]));
      } else {
        try { input = await readJSON(request, 2048, AbortSignal.any([request.signal, AbortSignal.timeout(5000)])); }
        catch { throw new OAuthError('invalid_request', 400); }
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new OAuthError('invalid_request', 400);
        if (action === 'disconnect') {
          validateDisconnectInput(input);
          // With no browser session, this target is already inaccessible here.
          // Do not claim its upstream authorization was revoked or contact any
          // other session. The browser may discard its unreachable cleanup ID.
          if (!id) return jsonResponse(200, {disconnected:true, revocation:'unavailable', session:'unavailable'});
        }
        if (!id && action !== 'start') return action === 'status' ? jsonResponse(200, {connections:[]}) : jsonResponse(401, {error:'not_connected'});
        if (!id) id = randomID();
      }
      const stub = env.PROVIDER_OAUTH_SESSIONS.getByName(await digest('provider-session\0' + id));
      const internal = await stub.fetch(new Request('https://provider-session.invalid/' + action + (provider ? '/' + provider : ''), {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(input), signal:request.signal}));
      if (action === 'callback') {
        const result = await internal.json(); return setSession(callbackPage(provider, result), id);
      }
      return setSession(internal, id);
    } catch (error) {
      const known = error instanceof OAuthError;
      if (callbackProvider) return callbackPage(callbackProvider, {ok:false, error:known ? error.code : 'connection_failed'});
      return jsonResponse(known ? error.status : 502, {error:known ? error.code : 'source_unavailable'}, known ? error.retryAt : null, now());
    }
  }};
}
