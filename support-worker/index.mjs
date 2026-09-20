// An independently provisioned Worker. Static site builds never deploy this file.
const PROJECTS = Object.freeze({
  'maimai-party': Object.freeze({origin: 'https://maimai.party', name: 'Support maimai.party',
    returnPath: '/support-return.html', maximum: 10000, preset: 500}),
});
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SESSION = /^cs_(test|live)_[a-zA-Z0-9]{10,200}$/;
const headers = {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff'};
const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers});
class Failure extends Error { constructor(status, code) { super(code); this.status = status; } }
async function boundedJSON(stream, maximum) {
  if (!stream) throw new Failure(400, 'invalid_request');
  const reader = stream.getReader();
  let length = 0, text = '';
  const decoder = new TextDecoder('utf-8', {fatal: true});
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Failure(408, 'request_timeout')), 5000);
  });
  try {
    for (;;) {
      const {done, value} = await Promise.race([reader.read(), deadline]);
      if (done) break;
      length += value.byteLength;
      if (length > maximum) throw new Failure(413, 'request_too_large');
      text += decoder.decode(value, {stream: true});
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) {
    if (error instanceof Failure) throw error;
    throw new Failure(400, 'invalid_request');
  } finally { clearTimeout(timer); await reader.cancel().catch(() => {}); }
}
async function digest(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
}
function sameDigest(left, right) {
  if (typeof left !== 'string' || left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < right.length; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}
async function stripe(env, path, params, key) {
  // Neither request/response bodies nor upstream error messages are logged/forwarded.
  const diagnostic = {stage: path.startsWith('/prices/') ? 'price_lookup' :
    params ? 'session_create' : 'session_status', reason: 'transport'};
  try {
    const response = await fetch('https://api.stripe.com/v1' + path, {
      // Receive and reject redirects as non-2xx responses without following them.
      method: params ? 'POST' : 'GET', redirect: 'manual', signal: AbortSignal.timeout(15000),
      headers: {Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY,
        'Stripe-Version': '2026-08-26.dahlia', ...(params ? {'Content-Type':
          'application/x-www-form-urlencoded', 'Idempotency-Key': key} : {})},
      ...(params ? {body: params.toString()} : {}),
    });
    if (!response.ok) {
      diagnostic.reason = 'http';
      diagnostic.status = response.status;
      await response.body?.cancel();
      throw new Error('upstream');
    }
    diagnostic.reason = 'response_read';
    return await boundedJSON(response.body, 65536);
  } catch {
    const failure = new Failure(502, 'checkout_unavailable');
    // Opt-in sandbox diagnostics contain only our enums and an HTTP status.
    // Never include upstream messages, bodies, identifiers or credentials.
    if (env.STRIPE_MODE === 'test' && env.SUPPORT_DIAGNOSTICS === 'true')
      failure.sandboxDiagnostic = diagnostic;
    throw failure;
  }
}
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const action = url.pathname === '/api/support/checkout' ? 'checkout' :
        url.pathname === '/api/support/status' ? 'status' : null;
      if (!action || url.search) return json({error: 'not_found'}, 404);
      if (request.method !== 'POST') return json({error: 'method_not_allowed'}, 405);
      if (env.SUPPORT_ENABLED !== 'true' || env.SUPPORT_ELIGIBILITY_CONFIRMED !== 'true' ||
          !['test', 'live'].includes(env.STRIPE_MODE) ||
          !new RegExp('^(sk|rk)_' + env.STRIPE_MODE + '_[A-Za-z0-9]+$').test(env.STRIPE_SECRET_KEY || '') ||
          !/^pmc_[a-zA-Z0-9]+$/.test(env.PAYMENT_METHOD_CONFIGURATION || '') ||
          (action === 'checkout' && !/^price_[a-zA-Z0-9]+$/.test(env.SUPPORT_PRICE_ID || '')) ||
          !env.SUPPORT_RATE_LIMITER || (env.TEST_LOCATION_COUNTRY &&
            (env.STRIPE_MODE !== 'test' || !['US', 'KR', 'JP', 'CN'].includes(env.TEST_LOCATION_COUNTRY))))
        return json({error: 'support_unavailable'}, 503);
      if (url.protocol !== 'https:' || request.headers.get('Origin') !== url.origin ||
          !Object.values(PROJECTS).some(project => project.origin === url.origin) ||
          !['same-origin', null].includes(request.headers.get('Sec-Fetch-Site')))
        return json({error: 'invalid_origin'}, 403);
      if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json')
        return json({error: 'invalid_request'}, 415);
      // No accounts: a generous per-IP limit also bounds anonymous session creation.
      // Cloudflare supplies this header. Counters are transient and local to each PoP.
      const ip = request.headers.get('CF-Connecting-IP');
      if (!ip) return json({error: 'support_unavailable'}, 503);
      if (!(await env.SUPPORT_RATE_LIMITER.limit({key: ip})).success)
        return new Response(JSON.stringify({error: 'try_later'}), {status: 429,
          headers: {...headers, 'Retry-After': '60'}});
      const body = await boundedJSON(request.body, 1024);
      const hasSession = body && typeof body === 'object' && Object.hasOwn(body, 'session');
      const allowed = action === 'status' || hasSession ? ['project', 'attempt', 'session'] : ['project', 'attempt'];
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).length !== allowed.length || Object.keys(body).some(key => !allowed.includes(key)) ||
          typeof body.attempt !== 'string' || !UUID.test(body.attempt) ||
          typeof body.project !== 'string' || !Object.hasOwn(PROJECTS, body.project))
        return json({error: 'invalid_request'}, 400);
      const project = PROJECTS[body.project];
      if (project.origin !== url.origin) return json({error: 'invalid_origin'}, 403);
      const attemptHash = await digest(body.attempt);
      let session;
      if (action === 'checkout' && !hasSession) {
        // Stripe owns amount entry. Verify the owner-provisioned Price before using
        // it, including the cap and suggestion. Leave the optional minimum unset;
        // Stripe still applies its own currency/payment-method processing floor.
        const price = await stripe(env, '/prices/' + env.SUPPORT_PRICE_ID + '?expand[]=product&expand[]=currency_options');
        if (price.id !== env.SUPPORT_PRICE_ID || price.active !== true || price.type !== 'one_time' ||
            price.livemode !== (env.STRIPE_MODE === 'live') || price.currency !== 'usd' ||
            price.custom_unit_amount?.minimum != null ||
            price.custom_unit_amount?.maximum !== project.maximum ||
            price.custom_unit_amount?.preset !== project.preset ||
            Object.keys(price.currency_options || {}).some(currency => currency !== 'usd') ||
            price.product?.active !== true || price.product?.name !== project.name)
          return json({error: 'support_unavailable'}, 503);
        const params = new URLSearchParams({mode: 'payment', ui_mode: 'embedded_page',
          redirect_on_completion: 'if_required', return_url: project.origin + project.returnPath,
          'adaptive_pricing[enabled]': 'true', payment_method_configuration: env.PAYMENT_METHOD_CONFIGURATION,
          'line_items[0][price]': env.SUPPORT_PRICE_ID, 'line_items[0][quantity]': '1',
          'metadata[support_project]': body.project, 'metadata[support_attempt_hash]': attemptHash,
        });
        if (env.TEST_LOCATION_COUNTRY)
          params.set('customer_email', 'test+location_' + env.TEST_LOCATION_COUNTRY + '@example.com');
        // Stable body/key across retries, including an ambiguous timeout. The
        // visitor can edit the amount in this same Stripe session without a new one.
        session = await stripe(env, '/checkout/sessions', params, 'support-v2-' + body.project + '-' + attemptHash);
      } else {
        // Resume the existing session even if deployment settings changed since
        // creation. Never recreate it with a different body under the same key.
        if (typeof body.session !== 'string' || !SESSION.test(body.session) ||
            !body.session.startsWith('cs_' + env.STRIPE_MODE + '_'))
          return json({error: 'invalid_request'}, 400);
        session = await stripe(env, '/checkout/sessions/' + body.session);
      }
      if (!session || !SESSION.test(session.id) || session.livemode !== (env.STRIPE_MODE === 'live') ||
          session.mode !== 'payment' || session.metadata?.support_project !== body.project ||
          !sameDigest(session.metadata?.support_attempt_hash, attemptHash) ||
          (hasSession && session.id !== body.session))
        return json({error: 'session_unavailable'}, 404);
      const status = session.payment_status === 'paid' ? 'paid' :
        session.status === 'complete' ? 'pending' : session.status === 'expired' ? 'expired' :
          session.status === 'open' ? 'open' : null;
      if (!status) throw new Failure(502, 'checkout_unavailable');
      if (action === 'status') return json({status});
      if (status === 'open' && typeof session.client_secret !== 'string')
        throw new Failure(502, 'checkout_unavailable');
      return json({status, session: session.id,
        ...(status === 'open' ? {clientSecret: session.client_secret} : {})});
    } catch (error) {
      return json({error: error instanceof Failure ? error.message : 'support_unavailable',
        ...(error instanceof Failure && error.sandboxDiagnostic ?
          {sandboxDiagnostic: error.sandboxDiagnostic} : {})},
        error instanceof Failure ? error.status : 503);
    }
  },
};
