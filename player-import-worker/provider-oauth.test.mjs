import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProviderOAuthService, PROVIDERS, OAUTH_PREFIX, PARTY_ORIGIN, SESSION_COOKIE, randomID} from './provider-oauth.mjs';
import {ProviderOAuthSessionCore} from './provider-oauth-session-core.mjs';

const nonce = () => crypto.randomUUID();
const json = (v, status = 200, extra = {}) => new Response(JSON.stringify(v), {status, headers:{'Content-Type':'application/json', ...extra}});
const fishScore = () => ({song_id:1,title:'Fictional song',type:'DX',level:'13+',level_index:3,achievements:100.1234,dxScore:1200,ds:13.7,fc:'fc',fs:''});
const lxScore = () => ({id:1,song_name:'Fictional song',type:'dx',level:'13+',level_index:3,achievements:100.1234,dx_score:1200,dx_rating:300.9,rate:'sssp',fc:'fc',fs:null,play_time:null,upload_time:'2026-10-11T00:00:00Z',last_played_time:null,private:'not returned'});
class Storage {
  values = new Map(); alarm = null;
  async get(k) { return structuredClone(this.values.get(k)); }
  async put(k,v) { this.values.set(k, structuredClone(v)); }
  async delete(k) { return this.values.delete(k); }
  async setAlarm(v) { this.alarm = v; }
  async transaction(operation) { const values = structuredClone(this.values), alarm = this.alarm; try { return await operation(this); } catch (error) { this.values = values; this.alarm = alarm; throw error; } }
}
function setup() {
  const s = {time:1800000000000, calls:[], stores:new Map(), cores:new Map(), tokenNumber:0, override:null, allowed:true};
  s.env = {PROVIDER_OAUTH_ENABLED:'true', DIVING_FISH_OAUTH_ENABLED:'true', LXNS_OAUTH_ENABLED:'true',
    PROVIDER_OAUTH_ENCRYPTION_KEY:randomID(), DIVING_FISH_OAUTH_CLIENT_ID:'fixture-fish-client', DIVING_FISH_OAUTH_CLIENT_SECRET:'fixture-fish-secret',
    LXNS_OAUTH_CLIENT_ID:'fixture-lxns-client', LXNS_OAUTH_CLIENT_SECRET:'fixture-lxns-secret',
    PROVIDER_OAUTH_LIMITER:{limit:async () => ({success:s.allowed})},
  };
  s.fetcher = async (url, options) => {
    s.calls.push({url, options});
    const changed = await s.override?.(url, options); if (changed) return changed;
    const provider = Object.entries(PROVIDERS).find(([,p]) => [p.discovery,p.token,p.userinfo,p.records,p.revoke,p.player].includes(url))?.[0];
    assert.ok(provider, 'all upstream URLs must be fixed'); const p = PROVIDERS[provider];
    if (url === p.discovery) return json({issuer:p.issuer,authorization_endpoint:p.authorize,token_endpoint:p.token,userinfo_endpoint:p.userinfo,revocation_endpoint:p.revoke,code_challenge_methods_supported:['S256']});
    if (url === p.token) { s.tokenNumber++; return json({access_token:'fixture-access-' + s.tokenNumber,refresh_token:'fixture-refresh-' + s.tokenNumber,token_type:'Bearer',expires_in:900,scope:p.scopes.join(' ')}); }
    if (url === p.userinfo) return json({sub:'fixture-' + provider, name:'Fictional player', email:'not-returned@example.test'});
    if (url === p.player) return json({success:true,code:200,data:{name:'Fictional player',friend_code:123456,upload_time:'2026-10-11T00:00:00Z'}});
    if (url === p.records) return provider === 'diving-fish' ? json({nickname:'Fictional player',records:[fishScore()],user_general_data:{private:'not returned'},access_token:'not returned'}) : json({success:true,code:200,data:[lxScore()]});
    if (url === p.revoke) return new Response(null, {status:200});
    throw Error('unexpected fixture request');
  };
  s.env.PROVIDER_OAUTH_SESSIONS = {getByName(id) {
    if (!s.cores.has(id)) {
      const storage = s.stores.get(id) || new Storage(); s.stores.set(id, storage);
      s.cores.set(id, new ProviderOAuthSessionCore(storage,s.env,{fetcher:s.fetcher,now:() => s.time,storageIdentity:id}));
    }
    return {fetch:r => s.cores.get(id).fetch(r)};
  }};
  s.service = createProviderOAuthService({now:() => s.time});
  s.call = async (path, input = {}, {cookie = s.cookie, method = 'POST', headers = {}, raw = null} = {}) => {
    const h = {Origin:PARTY_ORIGIN, 'Content-Type':'application/json','X-Party-Import':'1','Sec-Fetch-Site':'same-origin','CF-Connecting-IP':'192.0.2.1',...headers};
    if (cookie) h.Cookie = cookie;
    const r = await s.service.fetch(new Request(PARTY_ORIGIN + OAUTH_PREFIX + path, {method, headers:h, ...(method === 'GET' ? {} : {body:raw ?? JSON.stringify(input)})}), s.env);
    if (r.headers.has('set-cookie')) s.cookie = r.headers.get('set-cookie').split(';')[0];
    return r;
  };
  s.start = async (provider = 'diving-fish') => {
    const n = nonce(), r = await s.call('/' + provider + '/start', {nonce:n,...(provider === 'diving-fish' ? {maskingDisabled:true} : {})});
    assert.equal(r.status,200); const body = await r.json(); return {nonce:n,url:new URL(body.authorizationURL)};
  };
  s.callback = async (flow, provider = 'diving-fish', suffix = '') => s.call('/' + provider + '/callback?state=' + flow.url.searchParams.get('state') + '&code=fixture-code' + suffix, {}, {method:'GET'});
  s.status = async () => (await (await s.call('/status')).json()).connections;
  s.connect = async (provider = 'diving-fish') => { const flow = await s.start(provider); assert.match(await (await s.callback(flow,provider)).text(), /"status":"connected"/); return (await s.status()).find(c => c.provider === provider && c.flowNonce === flow.nonce); };
  return s;
}

test('OAuth capabilities fail closed unless every required binding and provider setting exists', async () => {
  const s = setup();
  assert.deepEqual(Object.keys(PROVIDERS), ['diving-fish','lxns']);
  for (const provider of Object.keys(PROVIDERS)) for (const k of ['PROVIDER_OAUTH_ENABLED','PROVIDER_OAUTH_ENCRYPTION_KEY','PROVIDER_OAUTH_SESSIONS','PROVIDER_OAUTH_LIMITER',...['CLIENT_ID','CLIENT_SECRET','ENABLED'].map(suffix => PROVIDERS[provider].variable + '_OAUTH_' + suffix)]) {
    const v = s.env[k]; delete s.env[k];
    const body = await (await s.call('/capabilities',{}, {method:'GET'})).json(); assert.equal(body.providers[provider].enabled,false,k); s.env[k] = v;
  }
  assert.equal(s.calls.length,0);
});
test('deferred providers have no route, capability, session status or upstream access', async () => {
  const s = setup();
  Object.assign(s.env, {AQUA_OAUTH_ENABLED:'true', AQUA_OAUTH_CLIENT_ID:'unused', AQUA_OAUTH_CLIENT_SECRET:'unused'});
  assert.deepEqual(await (await s.call('/capabilities',{}, {method:'GET'})).json(), {providers:{'diving-fish':{enabled:true},lxns:{enabled:true}}});
  for (const path of ['/aqua/start','/aqua/read','/aqua/disconnect','/aqua/callback'])
    assert.equal((await s.call(path,{}, {method:path.endsWith('callback') ? 'GET' : 'POST'})).status,404);
  assert.equal(s.calls.length,0);
  const fish = await s.connect(), core = [...s.cores.values()][0], state = await core.load();
  state.connections.aqua = {...state.connections['diving-fish'], displayName:'Deferred player'};
  await core.save(state);
  assert.deepEqual((await s.status()).map(c => c.connectionID),[fish.connectionID]);
  const count = s.calls.length;
  await assert.rejects(core.upstream('https://unknown-provider.test/player/scores'),{code:'invalid_endpoint'});
  const internal = await core.fetch(new Request('https://provider-session.invalid/read/aqua',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}));
  assert.equal(internal.status,404); assert.equal(s.calls.length,count);
});
test('OAuth browser API rejects foreign origins, missing CSRF header, alternate hosts, query relay and malformed bodies', async () => {
  const s = setup();
  for (const headers of [{Origin:'https://evil.test'},{'X-Party-Import':''},{'Sec-Fetch-Site':'cross-site'}]) assert.equal((await s.call('/status',{}, {headers})).status,403);
  assert.equal((await s.call('/status?url=https://evil.test')).status,403);
  assert.equal((await s.call('/status',{}, {raw:'[]'})).status,400);
  assert.equal((await s.call('/status',{}, {raw:'x'.repeat(2049)})).status,400);
  assert.equal((await s.service.fetch(new Request('https://evil.test' + OAUTH_PREFIX + '/capabilities'), s.env)).status,404);
  s.allowed = false; assert.equal((await s.call('/status')).status,429); assert.equal(s.calls.length,0);
});
test('Fish mask acknowledgement is per connection, PKCE is S256, and cookies contain no credentials', async () => {
  const s = setup(); assert.equal((await s.call('/diving-fish/start',{nonce:nonce()})).status,400);
  const flow = await s.start();
  assert.equal(flow.url.origin,'https://auth.diving-fish.com'); assert.equal(flow.url.pathname,'/oauth/authorize');
  assert.equal(flow.url.searchParams.get('code_challenge_method'),'S256'); assert.equal(flow.url.searchParams.get('code_challenge').length,43);
  assert.equal(flow.url.searchParams.get('scope'),'openid profile prober.records.read'); assert.equal(flow.url.searchParams.has('client_secret'),false);
  const r = await s.callback(flow); const cookie = r.headers.get('set-cookie');
  assert.match(cookie,/^__Host-party-provider-import=[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Lax;/);
  assert.ok(!cookie.includes('fixture')); assert.match(r.headers.get('content-security-policy'),/default-src 'none'/);
  const html = await r.text(); assert.ok(html.includes(flow.nonce)); assert.ok(!html.includes('fixture-access')); assert.ok(!html.includes('fixture-code'));
  assert.equal(s.calls.length,3); const form = new URLSearchParams(s.calls.find(c => c.url === PROVIDERS['diving-fish'].token).options.body);
  const challenge = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(form.get('code_verifier')));
  assert.equal(Buffer.from(challenge).toString('base64url'),flow.url.searchParams.get('code_challenge'));
  assert.ok(s.calls.every(c => !c.url.includes('fixture-secret') && c.options.redirect === 'manual' && c.options.credentials === 'omit'));
  const stored = JSON.stringify([...s.stores.values()][0].values.get('session')); assert.ok(!stored.includes('fixture')); assert.ok(!stored.includes('verifier'));
});
test('callback requires the bound browser cookie and state, consumes once, checks issuer, and preserves old grant on failure', async () => {
  const s = setup(), original = await s.connect(), flow = await s.start();
  const absent = await s.call('/diving-fish/callback?state=' + flow.url.searchParams.get('state') + '&code=fixture-code',{}, {method:'GET',cookie:''});
  assert.match(await absent.text(),/invalid_state/); const before = s.calls.length;
  assert.match(await (await s.callback(flow,'diving-fish','&iss=https%3A%2F%2Fevil.test')).text(),/invalid_issuer/); assert.equal(s.calls.length,before);
  assert.match(await (await s.callback(flow)).text(),/invalid_state/); assert.equal(s.calls.length,before);
  assert.equal((await s.status())[0].connectionID,original.connectionID);
});
test('expired authorization attempts and duplicate state query parameters never exchange tokens', async () => {
  const s = setup(), flow = await s.start();
  assert.match(await (await s.callback(flow,'diving-fish','&state=duplicate')).text(),/invalid_state/);
  s.time += 600001; assert.match(await (await s.callback(flow)).text(),/invalid_state/); assert.equal(s.calls.filter(c => c.url === PROVIDERS['diving-fish'].token).length,0);
});
test('full PB reads use exact Fish and LXNS contracts and strip unrelated profile data', async () => {
  for (const provider of ['diving-fish','lxns']) {
    const s = setup(), c = await s.connect(provider), response = await s.call('/' + provider + '/read',{connectionID:c.connectionID});
    assert.equal(response.status,200); const body = await response.json();
    assert.equal(body.accountID.length,64); assert.equal(body.connectionID,c.connectionID); assert.equal(body.coverage,'full'); assert.equal(body.capturedAt,null); assert.equal(body.fetchedAt,s.time);
    assert.deepEqual(body.warnings,provider === 'diving-fish' ? ['fish_masking_unverified'] : []);
    const records = provider === 'diving-fish' ? body.data.records : body.data.data;
    assert.equal(records[0].achievements,100.1234); assert.ok(!JSON.stringify(body).includes('not returned')); assert.ok(!JSON.stringify(body).includes('friend_code'));
    assert.ok(s.calls.filter(c => c.url === PROVIDERS[provider].records).every(c => c.options.method === 'GET' && c.options.headers.Authorization.startsWith('Bearer fixture-access-')));
    if (provider === 'lxns') { assert.equal(records[0].dx_rating,300.9); assert.equal(records[0].rate,'sssp'); }
    assert.equal((await s.call('/' + provider + '/read',{connectionID:c.connectionID})).status,429);
  }
});
test('mask uncertainty is never inferred from zero DX score and an explicit mask flag blocks the read', async () => {
  const s = setup(), c = await s.connect();
  s.override = url => url === PROVIDERS['diving-fish'].records ? json({records:[{...fishScore(),dxScore:0}]}) : null;
  const first = await s.call('/diving-fish/read',{connectionID:c.connectionID}); assert.equal(first.status,200); assert.deepEqual((await first.json()).warnings,['fish_masking_unverified']);
  s.time += 30001; s.override = url => url === PROVIDERS['diving-fish'].records ? json({mask:true,records:[fishScore()]}) : null;
  const second = await s.call('/diving-fish/read',{connectionID:c.connectionID}); assert.equal(second.status,409); assert.equal((await second.json()).error,'scores_masked');
});
test('concurrent expired reads rotate once and the persisted replacement is used after restart', async () => {
  const s = setup(), c = await s.connect(); s.time += 901000;
  const rs = await Promise.all([s.call('/diving-fish/read',{connectionID:c.connectionID}),s.call('/diving-fish/read',{connectionID:c.connectionID})]);
  assert.deepEqual(rs.map(r => r.status),[200,429]);
  assert.equal(s.calls.filter(c => c.url === PROVIDERS['diving-fish'].token).length,2);
  const form = new URLSearchParams(s.calls.find(c => c.url === PROVIDERS['diving-fish'].token && c.options.body.includes('grant_type=refresh_token')).options.body);
  assert.equal(form.get('refresh_token'),'fixture-refresh-1');
  s.cores.clear(); s.time += 30001; assert.equal((await s.call('/diving-fish/read',{connectionID:c.connectionID})).status,200);
  assert.equal(s.calls.at(-1).options.headers.Authorization,'Bearer fixture-access-2');
});
test('uncertain token rotation and crash recovery require reconnect instead of replaying the previous token', async () => {
  const s = setup(), c = await s.connect(); s.time += 901000;
  s.override = (url,options) => { if (url === PROVIDERS['diving-fish'].token && options.body.includes('refresh_token')) throw Error('fixture connection reset'); return null; };
  const r = await s.call('/diving-fish/read',{connectionID:c.connectionID}); assert.equal(r.status,401); assert.equal((await r.json()).error,'reconnect_required');
  assert.equal((await s.status())[0].requiresReconnect,true); const count = s.calls.length;
  s.time += 30001; await s.call('/diving-fish/read',{connectionID:c.connectionID}); assert.equal(s.calls.length,count);
  const t = setup(), tc = await t.connect(); const core = [...t.cores.values()][0], state = await core.load(); state.connections['diving-fish'].renewing = true; await core.save(state); t.cores.clear();
  assert.equal((await t.status())[0].requiresReconnect,true); assert.equal((await t.call('/diving-fish/read',{connectionID:tc.connectionID})).status,401);
});
test('upstream backoff is persisted without exposing provider error bodies', async () => {
  const s = setup(), c = await s.connect(); s.override = url => url === PROVIDERS['diving-fish'].records ? json({secret:'never disclose'},429,{'Retry-After':'120'}) : null;
  const r = await s.call('/diving-fish/read',{connectionID:c.connectionID}); assert.equal(r.status,503); assert.equal(r.headers.get('Retry-After'),'120'); assert.ok(!(await r.text()).includes('never disclose'));
  const before = s.calls.length; s.time += 31000; assert.equal((await s.call('/diving-fish/read',{connectionID:c.connectionID})).status,429); assert.equal(s.calls.length,before);
});
test('tracker-agreement rejection preserves an established Fish grant across restart and retry', async () => {
  const s = setup(), c = await s.connect();
  s.override = url => url === PROVIDERS['diving-fish'].records ? json({status:'error',message:'该用户未同意用户协议',private:'never disclose'},403) : null;
  const response = await s.call('/diving-fish/read',{connectionID:c.connectionID});
  assert.equal(response.status,403); assert.deepEqual(await response.json(),{error:'tracker_agreement_required'});
  s.cores.clear();
  const status = await s.status(); assert.equal(status[0].connectionID,c.connectionID); assert.equal(status[0].connected,true); assert.equal(status[0].requiresReconnect,false);
  s.time += 30001; s.override = null;
  assert.equal((await s.call('/diving-fish/read',{connectionID:c.connectionID})).status,200);
  assert.equal(s.calls.filter(call => call.url === PROVIDERS['diving-fish'].token).length,1);
  assert.equal(s.calls.filter(call => call.url === PROVIDERS['diving-fish'].revoke).length,0);
});
test('agreement recovery does not override first-import cleanup or replacement cancellation', async () => {
  const first = setup(), uncommitted = await first.connect();
  first.override = url => url === PROVIDERS['diving-fish'].records ? json({status:'error',message:'该用户未同意用户协议'},403) : null;
  assert.equal((await first.call('/diving-fish/read',{connectionID:uncommitted.connectionID})).status,403);
  assert.equal((await first.call('/diving-fish/disconnect',{connectionID:uncommitted.connectionID})).status,200);
  assert.deepEqual(await first.status(),[]);
  const s = setup(), original = await s.connect(), candidate = await s.connect();
  s.override = url => url === PROVIDERS['diving-fish'].records ? json({status:'error',message:'该用户未同意用户协议'},403) : null;
  assert.equal((await s.call('/diving-fish/read',{connectionID:candidate.connectionID})).status,403);
  assert.equal((await s.status()).length,2);
  // The browser still cleans an uncommitted first import/replacement after failure.
  await s.call('/diving-fish/disconnect',{connectionID:candidate.connectionID});
  assert.deepEqual((await s.status()).map(c => c.connectionID),[original.connectionID]);
  s.override = null;
  assert.equal((await s.call('/diving-fish/read',{connectionID:original.connectionID})).status,200);
});
test('only the exact bounded Fish records agreement error receives setup recovery', async () => {
  for (const denied of [
    () => json({status:'error',message:'access token 缺少权限：prober.records.read',private:'never disclose'},403),
    () => json({status:'error',message:'该用户未同意用户协议 extra private text'},403),
    () => json({message:'该用户未同意用户协议'},403),
    () => new Response('<html>该用户未同意用户协议</html>',{status:403,headers:{'Content-Type':'text/html'}}),
    () => json({status:'error',message:'该用户未同意用户协议',extra:'x'.repeat(2048)},403),
  ]) {
    const s = setup(), c = await s.connect();
    s.override = url => url === PROVIDERS['diving-fish'].records ? denied() : null;
    const response = await s.call('/diving-fish/read',{connectionID:c.connectionID});
    assert.equal(response.status,401); assert.deepEqual(await response.json(),{error:'authorization_failed'});
    assert.equal((await s.status())[0].requiresReconnect,true);
  }
  const s = setup();
  s.override = url => url === PROVIDERS['diving-fish'].userinfo ? json({status:'error',message:'该用户未同意用户协议'},403) : null;
  const flow = await s.start(); assert.match(await (await s.callback(flow)).text(),/authorization_failed/);
  assert.deepEqual(await s.status(),[]);
});
test('redirects, missing scopes, malformed/full-vs-simple records and response bounds fail closed', async () => {
  const s = setup(), c = await s.connect();
  for (const fixture of [() => new Response(null,{status:302,headers:{Location:'https://evil.test'}}), () => json({records:[{...fishScore(),achievements:102}]}), () => json({records:[{...fishScore(),title:'x'.repeat(513)}]}), () => json({records:[]},200,{'Content-Length':String(9*1024*1024)})]) {
    s.time += 30001; s.override = url => url === PROVIDERS['diving-fish'].records ? fixture() : null;
    assert.equal((await s.call('/diving-fish/read',{connectionID:c.connectionID})).status,502);
  }
  const t = setup(); t.override = url => url === PROVIDERS['diving-fish'].token ? json({access_token:'fixture-a',refresh_token:'fixture-r',token_type:'Bearer',expires_in:900,scope:'openid'}) : null;
  const flow = await t.start('diving-fish'); assert.match(await (await t.callback(flow,'diving-fish')).text(),/missing_scope/); assert.deepEqual(await t.status(),[]);
});
test('conditional disconnect cancels callbacks, is idempotent, preserves newer grants and clears locally before revoke', async () => {
  const s = setup(), first = await s.connect(), second = await s.connect();
  const old = await s.call('/diving-fish/disconnect',{connectionID:first.connectionID}); assert.equal(old.status,200); assert.equal((await s.status())[0].connectionID,second.connectionID);
  assert.equal((await s.call('/diving-fish/read',{connectionID:first.connectionID})).status,409);
  s.override = url => url === PROVIDERS['diving-fish'].revoke ? new Response(null,{status:500}) : null;
  const gone = await s.call('/diving-fish/disconnect',{connectionID:second.connectionID}); assert.deepEqual(await gone.json(),{disconnected:true,revocation:'unavailable'}); assert.deepEqual(await s.status(),[]);
  const flow = await s.start(); await s.call('/diving-fish/disconnect',{nonce:flow.nonce}); assert.match(await (await s.callback(flow)).text(),/invalid_state/);
});
test('encrypted storage cannot be transferred across sessions; expired storage loses access', async () => {
  const s = setup(); await s.connect(); const stored = [...s.stores.values()][0];
  const other = new ProviderOAuthSessionCore(stored,s.env,{storageIdentity:'different',now:() => s.time}); await assert.rejects(other.load(),{code:'session_unavailable'});
  s.time += 30*86400000 + 1; assert.deepEqual(await s.status(),[]); assert.equal(stored.values.has('session'),false);
});
test('canceling replacement B leaves A readable; uncommitted candidate never silently replaces A', async () => {
  const s = setup(), a = await s.connect(), b = await s.connect();
  let status = await s.status(); assert.equal(status.length,2); assert.equal(status.find(c => c.connectionID === b.connectionID).candidate,true);
  const refused = await s.call('/diving-fish/start',{nonce:nonce(),maskingDisabled:true}); assert.equal(refused.status,409); assert.equal((await refused.json()).error,'connection_pending');
  assert.equal((await s.call('/diving-fish/read',{connectionID:b.connectionID})).status,200);
  await s.call('/diving-fish/disconnect',{connectionID:b.connectionID});
  status = await s.status(); assert.equal(status.length,1); assert.equal(status[0].connectionID,a.connectionID);
  assert.equal((await s.call('/diving-fish/read',{connectionID:a.connectionID})).status,200);
});
test('discovery endpoint changes cannot redirect tokens; refresh revalidates expired discovery cache', async () => {
  const s = setup(); s.override = url => url === PROVIDERS['diving-fish'].discovery ? json({issuer:PROVIDERS['diving-fish'].issuer,authorization_endpoint:'https://evil.test',token_endpoint:'https://evil.test'}) : null;
  const r = await s.call('/diving-fish/start',{nonce:nonce(),maskingDisabled:true}); assert.equal(r.status,503); assert.equal((await r.json()).error,'provider_configuration_changed'); assert.equal(s.calls.length,1);
  const t = setup(), c = await t.connect(); t.time += 901000;
  t.override = url => url === PROVIDERS['diving-fish'].discovery ? json({issuer:'https://evil.test'}) : null;
  assert.equal((await t.call('/diving-fish/read',{connectionID:c.connectionID})).status,503);
  assert.equal(t.calls.filter(c => c.url === PROVIDERS['diving-fish'].token).length,1);
  assert.equal((await t.status())[0].requiresReconnect,false);
});
test('renewal may omit unchanged scope but cannot reduce an established read scope', async () => {
  const s = setup(), c = await s.connect('diving-fish'); s.time += 901000;
  s.override = (url,o) => url === PROVIDERS['diving-fish'].token && o.body.includes('refresh_token') ? json({access_token:'fixture-new-a',refresh_token:'fixture-new-r',token_type:'Bearer',expires_in:900}) : null;
  assert.equal((await s.call('/diving-fish/read',{connectionID:c.connectionID})).status,200);
  s.time += 901000; s.override = url => url === PROVIDERS['diving-fish'].token ? json({access_token:'fixture-newer-a',refresh_token:'fixture-newer-r',token_type:'Bearer',expires_in:900,scope:'openid'}) : null;
  assert.equal((await s.call('/diving-fish/read',{connectionID:c.connectionID})).status,401); assert.equal((await s.status())[0].requiresReconnect,true);
});
test('a provider response granting unrequested write scopes is not retained as a read-only connection', async () => {
  const s = setup(); s.override = url => url === PROVIDERS['diving-fish'].token ? json({access_token:'fixture-a',refresh_token:'fixture-r',token_type:'Bearer',expires_in:900,scope:'openid profile prober.records.read prober.records.write'}) : null;
  const flow = await s.start('diving-fish'); assert.match(await (await s.callback(flow,'diving-fish')).text(),/unexpected_scope/); assert.deepEqual(await s.status(),[]);
});
test('display labels are bounded valid Unicode with a nonempty identity-only fallback', async () => {
  const s = setup(); s.override = url => url === PROVIDERS['diving-fish'].userinfo ? json({sub:'fictional-fish'}) : null;
  const c = await s.connect('diving-fish'); assert.equal(c.displayName,'Diving-Fish player');
  s.override = url => url === PROVIDERS['diving-fish'].records ? json({nickname:'\u0000\ud800' + '🎵'.repeat(150),records:[fishScore()]}) : null;
  const body = await (await s.call('/diving-fish/read',{connectionID:c.connectionID})).json(); assert.equal(body.displayName.length,200); assert.equal(body.displayName,'🎵'.repeat(100));
});
test('popup locale is finite and sourced from browser-bound authorization attempt', async () => {
  const s = setup(), n = nonce();
  assert.equal((await s.call('/diving-fish/start',{nonce:n,locale:'<script>',maskingDisabled:true})).status,400);
  const r = await s.call('/diving-fish/start',{nonce:n,locale:'ja',maskingDisabled:true}), url = new URL((await r.json()).authorizationURL);
  const html = await (await s.callback({url,nonce:n},'diving-fish')).text(); assert.match(html,/<html lang="ja">/); assert.match(html,/連携が完了/); assert.match(html,/history\.replaceState/);
});
test('aborted streams and size failures cancel response bodies; failed redirects never forward auth', async () => {
  const s = setup(), core = new ProviderOAuthSessionCore(new Storage(),s.env,{storageIdentity:'bounded-test',now:() => s.time,fetcher:null});
  let canceled = false;
  core.fetcher = async () => new Response(new ReadableStream({start(c) { c.enqueue(new Uint8Array(100)); }, cancel() { canceled = true; }}),{headers:{'Content-Type':'application/json'}});
  await assert.rejects(core.upstream(PROVIDERS['diving-fish'].records,{maximum:50}),{code:'response_too_large'}); assert.equal(canceled,true);
  canceled = false; const controller = new AbortController();
  core.fetcher = async () => new Response(new ReadableStream({start() { queueMicrotask(() => controller.abort()); }, cancel() { canceled = true; }}),{headers:{'Content-Type':'application/json'}});
  await assert.rejects(core.upstream(PROVIDERS['diving-fish'].records,{signal:controller.signal}),{code:'source_unavailable'}); assert.equal(canceled,true);
  let count = 0; core.fetcher = async (_url,options) => { count++; assert.equal(options.redirect,'manual'); return new Response(null,{status:307,headers:{Location:'https://evil.test'}}); };
  await assert.rejects(core.upstream(PROVIDERS['diving-fish'].records,{token:'fixture-access'}),{code:'source_unavailable'}); assert.equal(count,1);
});
test('post-exchange failure revokes the new Fish token without replacing an older working connection', async () => {
  const s = setup(), original = await s.connect(), flow = await s.start();
  s.override = url => url === PROVIDERS['diving-fish'].userinfo ? json({name:'missing subject'}) : null;
  const html = await (await s.callback(flow)).text(); assert.match(html,/invalid_identity/);
  const revoke = s.calls.find(c => c.url === PROVIDERS['diving-fish'].revoke); assert.ok(revoke); assert.equal(new URLSearchParams(revoke.options.body).get('token'),'fixture-refresh-2');
  const status = await s.status(); assert.equal(status.length,1); assert.equal(status[0].connectionID,original.connectionID);
  s.override = null; assert.equal((await s.call('/diving-fish/read',{connectionID:original.connectionID})).status,200);
});

test('failed renewal validation or storage revokes only the newly issued Fish chain and cannot replay the old token', async () => {
  for (const failure of ['scope','storage']) {
    const s = setup(), c = await s.connect(); s.time += 901000;
    const storage = [...s.stores.values()][0], put = storage.put.bind(storage);
    let rejectNextSave = false;
    storage.put = async (...args) => { if (rejectNextSave) { rejectNextSave = false; throw Error('fixture storage failure'); } return put(...args); };
    s.override = (url, options) => {
      if (url !== PROVIDERS['diving-fish'].token || !options.body.includes('grant_type=refresh_token')) return null;
      if (failure === 'storage') rejectNextSave = true;
      return json({access_token:'fixture-new-access',refresh_token:'fixture-new-refresh',token_type:'Bearer',expires_in:900,
        scope:PROVIDERS['diving-fish'].scopes.join(' ') + (failure === 'scope' ? ' extra.write' : '')});
    };
    assert.equal((await s.call('/diving-fish/read',{connectionID:c.connectionID})).status,401);
    const revoke = s.calls.filter(call => call.url === PROVIDERS['diving-fish'].revoke);
    assert.equal(revoke.length,1); assert.equal(new URLSearchParams(revoke[0].options.body).get('token'),'fixture-new-refresh');
    s.time += 30001; assert.equal((await s.call('/diving-fish/read',{connectionID:c.connectionID})).status,401);
    assert.equal(s.calls.filter(call => call.url === PROVIDERS['diving-fish'].token && call.options.body.includes('grant_type=refresh_token')).length,1);
    assert.equal((await s.status())[0].requiresReconnect,true);
  }
});

test('missing browser session permits only validated idempotent disconnect without claiming upstream revocation', async () => {
  const s = setup(), c = await s.connect(), before = s.calls.length;
  const response = await s.call('/diving-fish/disconnect',{connectionID:c.connectionID},{cookie:''});
  assert.equal(response.status,200); assert.equal(response.headers.has('set-cookie'),false);
  assert.deepEqual(await response.json(),{disconnected:true,revocation:'unavailable',session:'unavailable'});
  assert.equal(s.calls.length,before); assert.equal((await s.status())[0].connectionID,c.connectionID);
  for (const input of [{},{connectionID:'bad'},{nonce:'bad'},{connectionID:c.connectionID,token:'PRIVATE'}])
    assert.equal((await s.call('/diving-fish/disconnect',input,{cookie:''})).status,400);
  assert.equal((await s.call('/diving-fish/disconnect',{connectionID:c.connectionID},{cookie:'',headers:{Origin:'https://evil.test'}})).status,403);
  assert.equal((await s.call('/diving-fish/disconnect',{connectionID:c.connectionID},{cookie:'',headers:{'Content-Type':'text/plain'}})).status,400);
  assert.equal((await s.call('/unknown/disconnect',{connectionID:c.connectionID},{cookie:''})).status,404);
  assert.equal((await s.call('/diving-fish/read',{connectionID:c.connectionID},{cookie:''})).status,401);
});

test('upstream fetch is called without a session receiver as required by workerd global fetch', async () => {
  const s = setup();
  const core = new ProviderOAuthSessionCore(new Storage(),s.env,{fetcher:async function(url) {
    assert.equal(this,undefined); assert.equal(url,PROVIDERS['diving-fish'].userinfo);
    return json({sub:'fictional-subject'});
  }});
  assert.deepEqual(await core.upstream(PROVIDERS['diving-fish'].userinfo),{sub:'fictional-subject'});
});

test('LXNS requests only stable identity and player reads with bound state and S256', async () => {
  const s = setup();
  assert.equal((await s.call('/lxns/start',{nonce:nonce(),maskingDisabled:true})).status,400);
  s.override = url => url === PROVIDERS.lxns.userinfo ? json({sub:'fixture-lxns-subject'}) : null;
  const flow = await s.start('lxns');
  assert.equal(flow.url.origin,'https://maimai.lxns.net'); assert.equal(flow.url.pathname,'/oauth/authorize');
  assert.equal(flow.url.searchParams.get('scope'),'openid read_player');
  assert.equal(flow.url.searchParams.get('redirect_uri'),PARTY_ORIGIN + OAUTH_PREFIX + '/lxns/callback');
  assert.equal(flow.url.searchParams.get('code_challenge_method'),'S256');
  const unbound = await s.call('/lxns/callback?state=' + flow.url.searchParams.get('state') + '&code=fixture-code',{}, {method:'GET',cookie:''});
  assert.match(await unbound.text(),/invalid_state/); assert.equal(s.calls.length,0);
  const callback = await s.callback(flow,'lxns'), html = await callback.text();
  assert.match(html,/"status":"connected"/); assert.ok(!html.includes('fixture-'));
  const form = new URLSearchParams(s.calls.find(c => c.url === PROVIDERS.lxns.token).options.body);
  assert.equal(form.get('client_secret'),'fixture-lxns-secret');
  const challenge = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(form.get('code_verifier')));
  assert.equal(Buffer.from(challenge).toString('base64url'),flow.url.searchParams.get('code_challenge'));
  assert.equal(s.calls.filter(c => c.url === PROVIDERS.lxns.token).length,1);
  assert.match(await (await s.callback(flow,'lxns')).text(),/invalid_state/);
  const c = (await s.status())[0]; assert.equal(c.displayName,'LXNS player'); assert.deepEqual(c.warnings,[]);
  s.override = url => url === PROVIDERS.lxns.player ? json({success:true,code:200,data:{name:'\u0000\ud800' + '🎵'.repeat(150),friend_code:123}}) : null;
  const read = await s.call('/lxns/read',{connectionID:c.connectionID}), body = await read.json();
  assert.equal(body.accountID,c.accountID); assert.equal(body.displayName,'🎵'.repeat(100));
  assert.ok(!JSON.stringify(body).includes('fixture-lxns-subject')); assert.ok(!JSON.stringify(body).includes('friend_code'));
  const decrypted = await [...s.cores.values()][0].load();
  assert.ok(!JSON.stringify(decrypted).includes('Fictional song')); assert.ok(!JSON.stringify(decrypted).includes('100.1234'));
  assert.ok(s.calls.every(c => c.options.redirect === 'manual' && c.options.credentials === 'omit'));
});

test('LXNS rejects missing or excessive scope and missing subject without replacing prior grants', async () => {
  for (const failure of ['missing','write','userinfo','issuer']) {
    const s = setup(), fish = await s.connect(), original = await s.connect('lxns'), flow = await s.start('lxns');
    s.override = url => {
      if (url === PROVIDERS.lxns.token && ['missing','write'].includes(failure)) return json({access_token:'fixture-a',refresh_token:'fixture-r',token_type:'Bearer',expires_in:900,scope:failure === 'missing' ? 'openid' : 'openid read_player write_player'});
      if (url === PROVIDERS.lxns.userinfo && failure === 'userinfo') return json({name:'Missing stable subject'});
      return null;
    };
    const result = await s.callback(flow,'lxns',failure === 'issuer' ? '&iss=https%3A%2F%2Fevil.test' : '');
    assert.match(await result.text(),new RegExp({missing:'missing_scope',write:'unexpected_scope',userinfo:'invalid_identity',issuer:'invalid_issuer'}[failure]));
    assert.deepEqual((await s.status()).map(c => c.connectionID),[fish.connectionID,original.connectionID]);
    assert.ok(!s.calls.some(c => /revoke/.test(c.url)));
    s.override = null; assert.equal((await s.call('/lxns/read',{connectionID:original.connectionID})).status,200);
  }
});

test('LXNS full-score envelopes reject simplified records, malformed data and oversized responses', async () => {
  const s = setup(), c = await s.connect('lxns');
  const simple = lxScore(); delete simple.achievements;
  for (const response of [
    () => json({success:false,code:200,data:[lxScore()],message:'private rejection'}),
    () => json({success:true,code:201,data:[lxScore()]}),
    () => json({success:true,code:200,data:[simple]}),
    () => json({success:true,code:200,data:[{...lxScore(),achievements:102}]}),
    () => json({success:true,code:200,data:[{...lxScore(),song_name:'x'.repeat(513)}]}),
    () => json({success:true,code:200,data:Array(25001).fill(lxScore())}),
    () => json({success:true,code:200,data:[]},200,{'Content-Length':String(9*1024*1024)}),
    () => new Response(null,{status:302,headers:{Location:'https://evil.test'}}),
    () => new Response('<html>private login</html>',{headers:{'Content-Type':'text/html'}}),
  ]) {
    s.time += 30001; s.override = url => url === PROVIDERS.lxns.records ? response() : null;
    const result = await s.call('/lxns/read',{connectionID:c.connectionID});
    assert.equal(result.status,502); assert.ok(!(await result.text()).includes('private')); assert.equal((await s.status())[0].connected,true);
  }
  s.time += 30001; s.override = url => url === PROVIDERS.lxns.player ? json({success:true,code:200,data:null}) : null;
  const count = s.calls.filter(c => c.url === PROVIDERS.lxns.records).length;
  assert.equal((await s.call('/lxns/read',{connectionID:c.connectionID})).status,502);
  assert.equal(s.calls.filter(c => c.url === PROVIDERS.lxns.records).length,count);
});

test('LXNS rotating refresh serializes and persists across restart; uncertain exchange cannot replay', async () => {
  const s = setup(), c = await s.connect('lxns'); s.time += 901000;
  const responses = await Promise.all([s.call('/lxns/read',{connectionID:c.connectionID}),s.call('/lxns/read',{connectionID:c.connectionID})]);
  assert.deepEqual(responses.map(r => r.status),[200,429]);
  assert.equal(s.calls.filter(c => c.url === PROVIDERS.lxns.token).length,2);
  s.cores.clear(); s.time += 30001;
  assert.equal((await s.call('/lxns/read',{connectionID:c.connectionID})).status,200);
  assert.equal(s.calls.at(-1).options.headers.Authorization,'Bearer fixture-access-2');
  s.time += 901000;
  s.override = url => { if (url === PROVIDERS.lxns.token) throw Error('fixture lost rotation response'); return null; };
  assert.equal((await s.call('/lxns/read',{connectionID:c.connectionID})).status,401);
  const before = s.calls.length; s.cores.clear(); s.time += 30001;
  assert.equal((await s.status())[0].requiresReconnect,true);
  assert.equal((await s.call('/lxns/read',{connectionID:c.connectionID})).status,401); assert.equal(s.calls.length,before);
});

test('LXNS refresh may omit unchanged scope but cannot lose scope or reuse its old refresh token', async () => {
  for (const failure of ['scope','reused']) {
    const s = setup(), c = await s.connect('lxns'); s.time += 901000;
    s.override = url => url === PROVIDERS.lxns.token ? json({access_token:'fixture-new-a',refresh_token:'fixture-new-r',token_type:'Bearer',expires_in:900}) : null;
    assert.equal((await s.call('/lxns/read',{connectionID:c.connectionID})).status,200);
    s.time += 901000;
    s.override = url => url === PROVIDERS.lxns.token ? json({access_token:'fixture-next-a',refresh_token:failure === 'reused' ? 'fixture-new-r' : 'fixture-next-r',token_type:'Bearer',expires_in:900,scope:failure === 'scope' ? 'openid' : 'openid read_player'}) : null;
    assert.equal((await s.call('/lxns/read',{connectionID:c.connectionID})).status,401);
    assert.equal((await s.status())[0].requiresReconnect,true);
  }
});

test('LXNS and Fish grants stay separate; replacement cancellation and disabled cleanup preserve other grants', async () => {
  const s = setup();
  s.override = url => [PROVIDERS.lxns.userinfo,PROVIDERS['diving-fish'].userinfo].includes(url) ? json({sub:'same-upstream-subject'}) : null;
  const fish = await s.connect(), lxns = await s.connect('lxns'), fishCandidate = await s.connect(), lxnsCandidate = await s.connect('lxns');
  assert.notEqual(fish.accountID,lxns.accountID); assert.equal(lxns.accountID,lxnsCandidate.accountID);
  assert.equal((await s.status()).length,4); assert.equal((await s.call('/lxns/start',{nonce:nonce()})).status,409);
  assert.equal((await s.call('/lxns/read',{connectionID:fish.connectionID})).status,409);
  assert.equal((await s.call('/lxns/read',{connectionID:lxnsCandidate.connectionID})).status,200);
  const before = s.calls.length;
  const gone = await s.call('/lxns/disconnect',{connectionID:lxnsCandidate.connectionID});
  assert.deepEqual(await gone.json(),{disconnected:true,revocation:'unavailable'}); assert.equal(s.calls.length,before);
  assert.deepEqual((await s.status()).map(c => c.connectionID),[fish.connectionID,lxns.connectionID,fishCandidate.connectionID]);
  assert.equal((await s.call('/lxns/read',{connectionID:lxns.connectionID})).status,200);
  s.env.LXNS_OAUTH_ENABLED = 'false';
  assert.equal((await s.call('/lxns/read',{connectionID:lxns.connectionID})).status,503);
  assert.equal((await s.call('/lxns/disconnect',{connectionID:lxns.connectionID})).status,200);
  assert.deepEqual((await s.status()).map(c => c.connectionID),[fish.connectionID,fishCandidate.connectionID]);
  assert.equal((await s.call('/diving-fish/read',{connectionID:fish.connectionID})).status,200);
});

test('LXNS rate limits survive restart and authorization rejection never impersonates Fish setup recovery', async () => {
  const s = setup(), c = await s.connect('lxns');
  s.override = url => url === PROVIDERS.lxns.records ? json({message:'private text'},429,{'Retry-After':'120'}) : null;
  const busy = await s.call('/lxns/read',{connectionID:c.connectionID});
  assert.equal(busy.status,503); assert.equal(busy.headers.get('Retry-After'),'120'); assert.ok(!(await busy.text()).includes('private text'));
  const count = s.calls.length; s.cores.clear(); s.time += 31000;
  assert.equal((await s.call('/lxns/read',{connectionID:c.connectionID})).status,429); assert.equal(s.calls.length,count);
  s.time += 120000;
  s.override = url => url === PROVIDERS.lxns.records ? json({status:'error',message:'该用户未同意用户协议'},403) : null;
  const rejected = await s.call('/lxns/read',{connectionID:c.connectionID});
  assert.equal(rejected.status,401); assert.deepEqual(await rejected.json(),{error:'authorization_failed'}); assert.equal((await s.status())[0].requiresReconnect,true);
  const disconnected = await s.call('/lxns/disconnect',{connectionID:c.connectionID},{cookie:''});
  assert.deepEqual(await disconnected.json(),{disconnected:true,revocation:'unavailable',session:'unavailable'});
});

test('LXNS absent player data has a finite recovery error without discarding either provider grant', async () => {
  for (const endpoint of [PROVIDERS.lxns.player,PROVIDERS.lxns.records]) {
    const s = setup(), fish = await s.connect(), lxns = await s.connect('lxns');
    s.override = url => url === endpoint ? json({success:false,code:404,message:'private upstream detail'},404) : null;
    const response = await s.call('/lxns/read',{connectionID:lxns.connectionID});
    assert.equal(response.status,404); assert.deepEqual(await response.json(),{error:'lxns_player_missing'});
    s.cores.clear();
    const status = await s.status();
    assert.deepEqual(status.map(c => [c.connectionID,c.connected,c.requiresReconnect]),[[fish.connectionID,true,false],[lxns.connectionID,true,false]]);
    if (endpoint === PROVIDERS.lxns.player) assert.ok(!s.calls.some(c => c.url === PROVIDERS.lxns.records));
    s.override = null; s.time += 30001;
    assert.equal((await s.call('/lxns/read',{connectionID:lxns.connectionID})).status,200);
    assert.equal((await s.call('/diving-fish/read',{connectionID:fish.connectionID})).status,200);
    assert.equal(s.calls.filter(c => c.url === PROVIDERS.lxns.token).length,1);
  }
});

test('LXNS missing-player recovery requires the documented status and envelope on a player endpoint', async () => {
  const s = setup(), c = await s.connect('lxns');
  for (const response of [
    () => json({success:false,code:404},200),
    () => json({success:true,code:404},404),
    () => json({success:false,code:400},404),
    () => json({success:false,code:'404'},404),
    () => json({success:false,code:404,message:'x'.repeat(2049)},404),
    () => new Response('<html>not found</html>',{status:404,headers:{'Content-Type':'text/html'}}),
    () => new Response('{',{status:404,headers:{'Content-Type':'application/json'}}),
  ]) {
    s.time += 30001; s.override = url => url === PROVIDERS.lxns.player ? response() : null;
    const result = await s.call('/lxns/read',{connectionID:c.connectionID});
    assert.equal(result.status,502); assert.notEqual((await result.json()).error,'lxns_player_missing');
    assert.equal((await s.status())[0].connected,true);
  }
  const core = [...s.cores.values()][0];
  core.fetcher = async () => json({success:false,code:404},404);
  for (const url of [PROVIDERS.lxns.token,PROVIDERS.lxns.userinfo,PROVIDERS['diving-fish'].records])
    await assert.rejects(core.upstream(url),{code:'source_unavailable'});
});
