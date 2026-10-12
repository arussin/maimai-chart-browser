import {PROVIDERS, SESSION_MS, OAuthError, encoder, base64url, randomID, digest, accountDigest, encryptionKey, credentials, callbackURL, jsonResponse, readJSON, validateDisconnectInput} from './provider-oauth.mjs';

const MAX_DATA_BYTES = 8 * 1024 * 1024, MAX_RECORDS = 25000, FLOW_MS = 10 * 60000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GRANT_ID = /^[A-Za-z0-9_-]{43}$/;
const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
const tokenString = v => typeof v === 'string' && /^[\x21-\x7e]{1,8192}$/.test(v);
function label(value) {
  if (typeof value !== 'string') return null;
  // Bound UTF-16 length without splitting a surrogate pair; lone surrogates
  // and control characters must not enter portable player display metadata.
  let result = '';
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code < 32 || code >= 127 && code <= 159 || code >= 0xd800 && code <= 0xdfff) continue;
    if (result.length + char.length > 200) break;
    result += char;
  }
  return result.trim() || null;
}
function exact(input, keys) { if (!object(input) || Object.keys(input).some(k => !keys.includes(k))) throw new OAuthError('invalid_request', 400); }
function grantView(provider, c, candidate = false) {
  return {provider, connectionID:c.id, accountID:c.accountID, displayName:c.displayName, flowNonce:c.nonce,
    connected:!!c.tokens && !c.requiresReconnect, requiresReconnect:!!c.requiresReconnect, candidate, warnings:provider === 'diving-fish' ? ['fish_masking_unverified'] : []};
}
function retryAt(value, now) {
  const v = /^\d{1,9}$/.test(value || '') ? now + Number(value) * 1000 : Date.parse(value || '');
  return Number.isFinite(v) ? Math.min(now + 86400000, Math.max(now + 30000, v)) : now + 60000;
}
function envelope(value) {
  if (!object(value) || value.success !== true || value.code !== 200) throw new OAuthError('invalid_response');
  return value.data;
}
function pickRecord(provider, record) {
  if (!object(record)) throw new OAuthError('invalid_response');
  const fish = provider === 'diving-fish';
  const required = fish ? ['song_id','achievements','level_index','type'] : ['id','achievements','level_index','type'];
  if (required.some(k => !(k in record))) throw new OAuthError('invalid_response');
  if (typeof record.achievements !== 'number' || !Number.isFinite(record.achievements) || record.achievements < 0 || record.achievements > 101) throw new OAuthError('invalid_response');
  const keys = fish ? ['song_id','title','type','level','level_index','level_label','achievements','dxScore','ds','fc','fs']
    : ['id','song_name','type','level','level_index','achievements','dx_score','dx_rating','rate','fc','fs','play_time','upload_time','last_played_time'];
  const result = {};
  for (const k of keys) if (k in record) {
    const value = record[k];
    if (value !== null && !['string','number','boolean'].includes(typeof value) || typeof value === 'string' && value.length > 512 || typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > 1e12)) throw new OAuthError('invalid_response');
    result[k] = value;
  }
  return result;
}
function minimize(provider, value) {
  const rows = provider === 'diving-fish' ? value?.records : envelope(value);
  if (!Array.isArray(rows) || rows.length > MAX_RECORDS) throw new OAuthError('invalid_response');
  // A future explicit mask flag is a positive rejection signal. Absence/false,
  // or any pattern in dxScore, cannot independently prove exactness today.
  if (provider === 'diving-fish' && value.mask === true) throw new OAuthError('scores_masked', 409);
  const records = rows.map(row => pickRecord(provider, row));
  return provider === 'diving-fish' ? {records, nickname:label(value.nickname) || ''} : {success:true, code:200, data:records};
}

/** One object per opaque browser session. No scores
 * are persisted. An in-memory queue serializes events, while the persisted
 * renewing marker makes a crash during rotating-token exchange fail closed. */
export class ProviderOAuthSessionCore {
  constructor(storage, env, {fetcher = fetch, now = Date.now, storageIdentity, timeoutMs = 10000} = {}) {
    this.storage = storage; this.env = env; this.fetcher = fetcher; this.now = now; this.timeoutMs = timeoutMs;
    this.identity = storageIdentity || 'test-session'; this.queue = Promise.resolve();
  }
  serial(operation) { const result = this.queue.then(operation, operation); this.queue = result.catch(() => {}); return result; }
  async cipherKey() {
    const bytes = encryptionKey(this.env.PROVIDER_OAUTH_ENCRYPTION_KEY); if (!bytes) throw new OAuthError('integration_disabled', 503);
    return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt','decrypt']);
  }
  aad() { return encoder.encode('party-provider-session-v1\0' + this.identity); }
  async save(state) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:this.aad()}, await this.cipherKey(), encoder.encode(JSON.stringify(state)));
    await this.storage.transaction(async tx => {
      await tx.put('session', {v:1, iv:base64url(iv), cipher:base64url(new Uint8Array(cipher))});
      await tx.setAlarm(state.expiresAt);
    });
  }
  async load() {
    const saved = await this.storage.get('session');
    if (!saved) return {version:1, expiresAt:this.now() + SESSION_MS, pending:{}, connections:{}, candidates:{}, starts:[]};
    let state;
    try {
      if (saved.v !== 1 || typeof saved.iv !== 'string' || typeof saved.cipher !== 'string' || saved.cipher.length > 131072) throw new Error();
      const unbase = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
      const plain = await crypto.subtle.decrypt({name:'AES-GCM', iv:unbase(saved.iv), additionalData:this.aad()}, await this.cipherKey(), unbase(saved.cipher));
      state = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(plain));
      if (state.version !== 1 || !object(state.pending) || !object(state.connections) || !Array.isArray(state.starts) || !Number.isSafeInteger(state.expiresAt)) throw new Error();
    } catch { throw new OAuthError('session_unavailable', 503); }
    state.candidates ??= {};
    if (!object(state.candidates)) throw new OAuthError('session_unavailable', 503);
    if (state.expiresAt <= this.now()) { await this.storage.delete('session'); return {version:1, expiresAt:this.now() + SESSION_MS, pending:{}, connections:{}, candidates:{}, starts:[]}; }
    let recovered = false;
    for (const c of [...Object.values(state.connections), ...Object.values(state.candidates)]) if (c.renewing) {
      c.tokens = null; c.requiresReconnect = true; c.renewing = false; recovered = true;
    }
    if (recovered) await this.save(state);
    return state;
  }
  fetch(request) { return this.serial(async () => {
    try {
      const url = new URL(request.url), m = url.pathname.match(/^\/(status|start|callback|read|disconnect)(?:\/(diving-fish|lxns))?$/);
      if (url.origin !== 'https://provider-session.invalid' || url.search || request.method !== 'POST' || !m || (m[1] === 'status' ? !!m[2] : !m[2])) throw new OAuthError('not_found', 404);
      let input;
      try { input = await readJSON(request, 2048, AbortSignal.any([request.signal, AbortSignal.timeout(5000)])); }
      catch { throw new OAuthError('invalid_request', 400); }
      const state = await this.load(), action = m[1], provider = m[2];
      if (action === 'status') {
        exact(input, []); return jsonResponse(200, {connections:[...Object.entries(state.connections).filter(([p]) => Object.hasOwn(PROVIDERS,p)).map(([p,c]) => grantView(p,c)), ...Object.entries(state.candidates).filter(([p]) => Object.hasOwn(PROVIDERS,p)).map(([p,c]) => grantView(p,c,true))]});
      }
      const result = await this[action](state, provider, input, request.signal);
      return jsonResponse(200, result);
    } catch (error) {
      const known = error instanceof OAuthError;
      return jsonResponse(known ? error.status : 502, {error:known ? error.code : 'source_unavailable'}, known ? error.retryAt : null, this.now());
    }
  }); }
  alarm() { return this.serial(async () => {
    const state = await this.load();
    if (state.expiresAt <= this.now()) await this.storage.delete('session');
    else if (Object.keys(state.connections).length || Object.keys(state.candidates).length || Object.keys(state.pending).length) await this.storage.setAlarm(state.expiresAt);
  }); }
  async upstream(url, {method = 'GET', form = null, token = null, maximum = 65536, signal, optionalBody = false} = {}) {
    // Never accept a caller-supplied endpoint, host, redirect, or request header.
    const allowed = typeof url === 'string' && Object.values(PROVIDERS).some(p => [p.discovery,p.token,p.userinfo,p.revoke,p.records,p.player].includes(url));
    if (!allowed) throw new OAuthError('invalid_endpoint', 500);
    const timed = AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(this.timeoutMs)]);
    const headers = {Accept:'application/json'};
    if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (token) headers.Authorization = 'Bearer ' + token;
    let response;
    try {
      // workerd's global fetch rejects a foreign receiver. Detach the injected
      // callable instead of invoking it as a method on this session core.
      const fetcher = this.fetcher;
      response = await fetcher(url, {method, headers, body:form ? new URLSearchParams(form).toString() : undefined,
        redirect:'manual', credentials:'omit', cache:'no-store', referrerPolicy:'no-referrer', signal:timed});
      if (!response.ok) {
        if (response.status === 404 && [PROVIDERS.lxns.player,PROVIDERS.lxns.records].includes(url)) {
          // LXNS documents matching HTTP/JSON status codes for absent resources.
          // Only these own-player endpoints imply missing game data; a proxy
          // page, unrelated endpoint or inconsistent envelope is not that signal.
          const missing = await readJSON(response, 2048, timed).catch(() => null);
          if (object(missing) && missing.success === false && missing.code === 404)
            throw new OAuthError('lxns_player_missing', 404);
        }
        if (response.status === 403 && url === PROVIDERS['diving-fish'].records) {
          // Recognize only the documented tracker-agreement response. Never
          // relay provider text or confuse a scope/token rejection with setup.
          const denied = await readJSON(response, 2048, timed).catch(() => null);
          if (object(denied) && denied.status === 'error' && denied.message === '该用户未同意用户协议')
            throw new OAuthError('tracker_agreement_required', 403);
        }
        await response.body?.cancel();
        if (response.status === 429 || response.status === 503) throw new OAuthError('upstream_busy', 503, retryAt(response.headers.get('Retry-After'), this.now()));
        if ([400,401,403].includes(response.status)) throw new OAuthError('authorization_failed', 401);
        throw new OAuthError('source_unavailable');
      }
      if (optionalBody) { await response.body?.cancel(); return null; }
      return await readJSON(response, maximum, timed);
    } catch (error) { if (error instanceof OAuthError) throw error; throw new OAuthError('source_unavailable'); }
  }
  async validateDiscovery(provider, signal) {
    const p = PROVIDERS[provider];
    if (!p.discovery || this.discoveryUntil > this.now()) return;
    const discovery = await this.upstream(p.discovery, {signal});
    // Discovery changes are never authority to relay credentials to new paths.
    // A changed contract fails closed until these reviewed endpoints are updated.
    if (!object(discovery) || discovery.issuer !== p.issuer || discovery.authorization_endpoint !== p.authorize || discovery.token_endpoint !== p.token
      || discovery.userinfo_endpoint !== p.userinfo || discovery.revocation_endpoint !== p.revoke || !Array.isArray(discovery.code_challenge_methods_supported)
      || !discovery.code_challenge_methods_supported.includes('S256')) throw new OAuthError('provider_configuration_changed', 503);
    this.discoveryUntil = this.now() + 300000;
  }
  tokenData(provider, response, priorScope = null) {
    const scope = response?.scope === undefined && priorScope ? priorScope : response?.scope;
    if (!object(response) || !tokenString(response.access_token) || !tokenString(response.refresh_token) || typeof response.token_type !== 'string' || response.token_type.toLowerCase() !== 'bearer'
      || !Number.isSafeInteger(response.expires_in) || response.expires_in < 60 || response.expires_in > 86400 || typeof scope !== 'string' || scope.length > 2048) throw new OAuthError('invalid_token_response');
    const scopes = scope.split(/\s+/);
    if (PROVIDERS[provider].scopes.some(s => !scopes.includes(s))) throw new OAuthError('missing_scope', 403);
    if (scopes.some(s => s && !PROVIDERS[provider].scopes.includes(s))) throw new OAuthError('unexpected_scope', 403);
    return {access:response.access_token, refresh:response.refresh_token, scope, expiresAt:this.now() + response.expires_in * 1000, refreshExpiresAt:this.now() + SESSION_MS};
  }
  client(provider) { const c = credentials(this.env, provider); if (!c) throw new OAuthError('integration_disabled', 503); return {client_id:c.clientID, client_secret:c.clientSecret}; }
  async start(state, provider, input, signal) {
    exact(input, ['nonce','maskingDisabled','locale']);
    if (!UUID.test(input.nonce || '')) throw new OAuthError('invalid_request', 400);
    if (provider === 'diving-fish' && input.maskingDisabled !== true) throw new OAuthError('masking_confirmation_required', 400);
    if (provider !== 'diving-fish' && input.maskingDisabled !== undefined) throw new OAuthError('invalid_request', 400);
    if (input.locale !== undefined && !['en','ja','ko','zh-Hans','id'].includes(input.locale)) throw new OAuthError('invalid_request', 400);
    if (state.candidates[provider]) throw new OAuthError('connection_pending', 409);
    state.starts = state.starts.filter(t => t > this.now() - FLOW_MS);
    if (state.starts.length >= 5) throw new OAuthError('rate_limited', 429, state.starts[0] + FLOW_MS);
    await this.validateDiscovery(provider, signal);
    const p = PROVIDERS[provider], rawState = randomID(), verifier = randomID(48), client = this.client(provider);
    state.pending[provider] = {stateHash:await digest(rawState), verifier, nonce:input.nonce, locale:input.locale || 'en', expiresAt:this.now() + FLOW_MS, maskingDisabled:input.maskingDisabled === true};
    state.starts.push(this.now()); state.expiresAt = this.now() + SESSION_MS; await this.save(state);
    const url = new URL(p.authorize);
    for (const [key,value] of Object.entries({response_type:'code', client_id:client.client_id, redirect_uri:callbackURL(provider), scope:p.scopes.join(' '), state:rawState, code_challenge:await digest(verifier), code_challenge_method:'S256'})) url.searchParams.set(key,value);
    return {authorizationURL:url.href};
  }
  async callback(state, provider, input, signal) {
    exact(input, ['state','code','error','iss']);
    const pending = state.pending[provider];
    if (!pending || pending.expiresAt <= this.now() || !GRANT_ID.test(input.state || '') || await digest(input.state) !== pending.stateHash) throw new OAuthError('invalid_state', 400);
    // Persist consumption BEFORE any network work. A callback cannot be replayed
    // after timeout/restart; an existing connection survives a failed replacement.
    delete state.pending[provider]; await this.save(state);
    let issuedRefresh = null;
    try {
      if (input.iss !== undefined && input.iss !== PROVIDERS[provider].issuer) throw new OAuthError('invalid_issuer', 400);
      if (input.error !== undefined) throw new OAuthError('authorization_denied', 400);
      if (!tokenString(input.code) || input.code.length > 2048) throw new OAuthError('invalid_request', 400);
      await this.validateDiscovery(provider, signal);
      const raw = await this.upstream(PROVIDERS[provider].token, {method:'POST', form:{...this.client(provider), grant_type:'authorization_code', code:input.code, redirect_uri:callbackURL(provider), code_verifier:pending.verifier}, signal});
      if (tokenString(raw?.refresh_token)) issuedRefresh = raw.refresh_token;
      const tokens = this.tokenData(provider, raw);
      const identity = await this.upstream(PROVIDERS[provider].userinfo, {token:tokens.access, signal});
      if (!object(identity) || typeof identity.sub !== 'string' || !identity.sub || identity.sub.length > 512) throw new OAuthError('invalid_identity');
      const c = {id:randomID(), accountID:await accountDigest(provider, identity.sub), displayName:label(identity.name) || label(identity.preferred_username) || (provider === 'diving-fish' ? 'Diving-Fish player' : 'LXNS player'), nonce:pending.nonce,
        tokens, requiresReconnect:false, renewing:false, lastReadAt:0, retryAt:0, maskingDisabled:pending.maskingDisabled};
      if (state.connections[provider]) state.candidates[provider] = c; else state.connections[provider] = c;
      state.expiresAt = this.now() + SESSION_MS; await this.save(state);
      return {ok:true, nonce:pending.nonce, locale:pending.locale};
    } catch (error) {
      // A token pair may have been issued before UserInfo/storage failed. Revoke
      // only that new chain, never the previously working grant. This bounded
      // cleanup is independent of the popup's abort. LXNS has no documented
      // public revocation endpoint; users can revoke in their provider account.
      if (issuedRefresh && PROVIDERS[provider].revoke) {
        try { await this.upstream(PROVIDERS[provider].revoke, {method:'POST', form:{...this.client(provider), token:issuedRefresh, token_type_hint:'refresh_token'}, optionalBody:true}); } catch {}
      }
      return {ok:false, nonce:pending.nonce, locale:pending.locale, error:error instanceof OAuthError ? error.code : 'connection_failed'};
    }
  }
  async accessToken(state, provider, c, signal) {
    if (!c.tokens || c.requiresReconnect || c.tokens.refreshExpiresAt <= this.now()) throw new OAuthError('reconnect_required', 401);
    if (c.tokens.expiresAt > this.now() + 60000) return c.tokens.access;
    const previous = c.tokens.refresh;
    await this.validateDiscovery(provider, signal);
    c.renewing = true; await this.save(state);
    let issuedRefresh = null;
    try {
      const raw = await this.upstream(PROVIDERS[provider].token, {method:'POST', form:{...this.client(provider), grant_type:'refresh_token', refresh_token:previous}, signal});
      if (tokenString(raw?.refresh_token) && raw.refresh_token !== previous) issuedRefresh = raw.refresh_token;
      const tokens = this.tokenData(provider, raw, c.tokens.scope);
      if (tokens.refresh === previous) throw new OAuthError('invalid_token_response');
      c.tokens = tokens; c.renewing = false; await this.save(state); return tokens.access;
    } catch (error) {
      // Rotation may have succeeded before validation or persistence failed.
      // Retire only the newly issued chain; never replay the consumed token.
      if (issuedRefresh && PROVIDERS[provider].revoke) {
        try { await this.upstream(PROVIDERS[provider].revoke, {method:'POST', form:{...this.client(provider), token:issuedRefresh, token_type_hint:'refresh_token'}, optionalBody:true}); } catch {}
      }
      // Even a transport failure might have consumed the previous refresh token.
      // Never blindly retry it or restore it from an older browser/cookie copy.
      c.tokens = null; c.renewing = false; c.requiresReconnect = true; await this.save(state);
      throw new OAuthError('reconnect_required', 401, error instanceof OAuthError ? error.retryAt : null);
    }
  }
  async read(state, provider, input, signal) {
    exact(input, ['connectionID']);
    if (!GRANT_ID.test(input.connectionID || '')) throw new OAuthError('invalid_request', 400);
    const candidate = state.candidates[provider]?.id === input.connectionID;
    const c = candidate ? state.candidates[provider] : state.connections[provider];
    if (!c && !state.candidates[provider]) throw new OAuthError('not_connected', 401);
    if (!c || c.id !== input.connectionID) throw new OAuthError('connection_changed', 409);
    if (c.requiresReconnect || !c.tokens) throw new OAuthError('reconnect_required', 401);
    if (provider === 'diving-fish' && !c.maskingDisabled) throw new OAuthError('masking_confirmation_required', 409);
    const until = Math.max(c.retryAt || 0, c.lastReadAt ? c.lastReadAt + 30000 : 0);
    if (until > this.now()) throw new OAuthError('rate_limited', 429, until);
    c.lastReadAt = this.now(); state.expiresAt = this.now() + SESSION_MS; await this.save(state);
    try {
      const token = await this.accessToken(state, provider, c, signal);
      let player = null;
      if (provider === 'lxns') {
        player = envelope(await this.upstream(PROVIDERS[provider].player, {token, signal}));
        if (!object(player)) throw new OAuthError('invalid_response');
      }
      const raw = await this.upstream(PROVIDERS[provider].records, {token, maximum:MAX_DATA_BYTES, signal});
      const data = minimize(provider, raw);
      c.displayName = label(provider === 'diving-fish' ? raw.nickname : player.name) || c.displayName;
      c.retryAt = 0; await this.save(state);
      // No fabricated score-capture or play time. fetchedAt is acquisition only.
      return {...grantView(provider,c,candidate), coverage:'full', capturedAt:null, fetchedAt:this.now(), data};
    } catch (error) {
      if (error instanceof OAuthError && error.retryAt) c.retryAt = error.retryAt;
      if (error instanceof OAuthError && error.code === 'authorization_failed') { c.tokens = null; c.requiresReconnect = true; }
      await this.save(state); throw error;
    }
  }
  async disconnect(state, provider, input, signal) {
    validateDisconnectInput(input);
    const pending = state.pending[provider];
    const matches = c => c && (input.connectionID ? input.connectionID === c.id : input.nonce === c.nonce);
    const candidate = !!matches(state.candidates[provider]);
    const c = candidate ? state.candidates[provider] : state.connections[provider];
    const pendingMatch = pending && input.nonce === pending.nonce;
    const grantMatch = matches(c);
    // Targeted cleanup is idempotent. An older tab's grant may already be gone;
    // a different grant/pending flow is deliberately left untouched.
    if (pendingMatch) delete state.pending[provider];
    if (grantMatch) {
      if (candidate) delete state.candidates[provider];
      else {
        delete state.connections[provider];
        if (state.candidates[provider]) { state.connections[provider] = state.candidates[provider]; delete state.candidates[provider]; }
      }
    }
    await this.save(state); // Local logout cannot be undone by a failed revoke.
    let revocation = 'unavailable';
    if (grantMatch && c.tokens?.refresh && PROVIDERS[provider].revoke && credentials(this.env,provider)) {
      try {
        await this.upstream(PROVIDERS[provider].revoke, {method:'POST', form:{...this.client(provider), token:c.tokens.refresh, token_type_hint:'refresh_token'}, optionalBody:true, signal});
        revocation = 'requested';
      } catch {} // Never expose provider body; local credentials are already gone.
    }
    return {disconnected:true, revocation};
  }
}
