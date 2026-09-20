import {test, afterEach, mock} from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.mjs';

const origin = 'https://maimai.party', attempt = '42a9c39e-23bb-46fc-b70f-1183891b1c10';
const sessionId = 'cs_test_abcdefghijk12345';
const env = () => ({SUPPORT_ENABLED: 'true', SUPPORT_ELIGIBILITY_CONFIRMED: 'true',
  STRIPE_MODE: 'test', STRIPE_SECRET_KEY: 'sk_test_fixture', PAYMENT_METHOD_CONFIGURATION: 'pmc_fixture', SUPPORT_PRICE_ID: 'price_fixture',
  SUPPORT_RATE_LIMITER: {limit: async () => ({success: true})}});
const body = {project: 'maimai-party', attempt};
const price = (changes = {}) => ({id: 'price_fixture', active: true, type: 'one_time', livemode: false,
  currency: 'usd', custom_unit_amount: {minimum: null, maximum: 10000, preset: 500},
  product: {active: true, name: 'Support maimai.party'}, ...changes});
const hash = async value => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('hex');
const session = async (changes = {}) => ({id: sessionId, mode: 'payment', livemode: false,
  status: 'open', payment_status: 'unpaid', client_secret: 'fixture-client-secret',
  metadata: {support_project: body.project, support_attempt_hash: await hash(attempt)},
  customer_details: {email: 'PRIVATE_PAYER@example.invalid'}, ...changes});
function request(data = body, action = 'checkout', init = {}) {
  return new Request(origin + '/api/support/' + action, {method: 'POST', headers: {
    Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'CF-Connecting-IP': '192.0.2.1',
    'Content-Type': 'application/json'}, body: JSON.stringify(data), ...init});
}
function upstream(data) { return mock.method(globalThis, 'fetch', async url =>
  Response.json(url.includes('/prices/') ? price() : data)); }
afterEach(() => mock.restoreAll());

test('uses a verified native customer-chosen price with dynamic methods and a clean return URL', async () => {
  const fetch = upstream(await session());
  const response = await worker.fetch(request(), env());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {status: 'open', session: sessionId, clientSecret: 'fixture-client-secret'});
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(fetch.mock.calls[0].arguments[0], 'https://api.stripe.com/v1/prices/price_fixture?expand[]=product&expand[]=currency_options');
  const [url, options] = fetch.mock.calls[1].arguments;
  assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(options.headers['Stripe-Version'], '2026-08-26.dahlia');
  assert.equal(options.redirect, 'manual');
  const params = new URLSearchParams(options.body);
  assert.equal(params.get('ui_mode'), 'embedded_page');
  assert.equal(params.get('mode'), 'payment');
  assert.equal(params.get('line_items[0][price]'), 'price_fixture');
  assert.equal(params.get('line_items[0][quantity]'), '1');
  assert.equal(params.has('line_items[0][price_data][unit_amount]'), false);
  assert.equal(params.get('adaptive_pricing[enabled]'), 'true');
  assert.equal(params.get('payment_method_configuration'), 'pmc_fixture');
  assert.equal(params.get('return_url'), origin + '/support-return.html');
  assert.equal(params.get('redirect_on_completion'), 'if_required');
  assert.equal(params.get('metadata[support_attempt_hash]'), await hash(attempt));
  assert.equal(params.has('payment_method_types'), false);
  assert.equal(params.has('customer_email'), false);
  assert.equal(options.body.includes(attempt), false);
});

test('retries use identical parameters and idempotency key even when the first response is lost', async () => {
  const data = await session();
  let calls = 0;
  const fetch = mock.method(globalThis, 'fetch', async url => {
    if (url.includes('/prices/')) return Response.json(price());
    if (++calls === 1) throw new Error('network lost');
    return Response.json(data);
  });
  assert.equal((await worker.fetch(request(), env())).status, 502);
  assert.equal((await worker.fetch(request(), env())).status, 200);
  assert.equal((await worker.fetch(request({...body, amount: 1000}), env())).status, 400);
  const options = fetch.mock.calls.filter(call => call.arguments[0].endsWith('/checkout/sessions')).map(call => call.arguments[1]);
  assert.equal(options.length, 2);
  assert.equal(options[0].body, options[1].body);
  assert.equal(options[0].headers['Idempotency-Key'], options[1].headers['Idempotency-Key']);
});

test('a known session resumes by retrieval after configuration changes and still verifies ownership', async () => {
  const fetch = upstream(await session());
  const changedEnv = {...env(), TEST_LOCATION_COUNTRY: 'KR', SUPPORT_PRICE_ID: 'price_changed',
    PAYMENT_METHOD_CONFIGURATION: 'pmc_changed'};
  const resumed = await worker.fetch(request({...body, session: sessionId}), changedEnv);
  assert.deepEqual(await resumed.json(), {status: 'open', session: sessionId, clientSecret: 'fixture-client-secret'});
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(fetch.mock.calls[0].arguments[0], 'https://api.stripe.com/v1/checkout/sessions/' + sessionId);
  assert.equal(fetch.mock.calls[0].arguments[1].method, 'GET');
  assert.equal((await worker.fetch(request({...body, attempt: crypto.randomUUID(), session: sessionId}), changedEnv)).status, 404);
  for (const invalid of ['', 'cs_live_abcdefghijk12345', [sessionId]])
    assert.equal((await worker.fetch(request({...body, session: invalid}), changedEnv)).status, 400);
});

test('client amounts, unexpected metadata, URLs, project and malformed JSON never reach Stripe', async () => {
  const fetch = upstream(await session());
  for (const amount of [0, 299, 500, 10001, 300.5, '500', null])
    assert.equal((await worker.fetch(request({...body, amount}), env())).status, 400);
  for (const extra of [{email: 'PRIVATE'}, {return_url: 'https://evil.invalid'}, {country: 'KR'},
    {project: '__proto__'}, {project: [body.project]}, {attempt: [attempt]},
    {attempt: 'guess'}, {metadata: {player: 'PRIVATE'}}])
    assert.equal((await worker.fetch(request({...body, ...extra}), env())).status, 400);
  assert.equal((await worker.fetch(request(null, 'checkout', {body: '{'}), env())).status, 400);
  assert.equal((await worker.fetch(request(null, 'checkout', {body: ' '.repeat(1025)}), env())).status, 413);
  assert.equal(fetch.mock.callCount(), 0);
});

test('disabled or mismatched environment, origin and absent rate limits fail closed', async () => {
  const fetch = upstream(await session());
  for (const patch of [{SUPPORT_ENABLED: 'false'}, {SUPPORT_ELIGIBILITY_CONFIRMED: 'false'},
    {PAYMENT_METHOD_CONFIGURATION: ''}, {STRIPE_MODE: 'live'}, {STRIPE_SECRET_KEY: ''},
    {SUPPORT_PRICE_ID: ''}, {SUPPORT_PRICE_ID: 'price_bad?expand=customer'},
    {SUPPORT_RATE_LIMITER: null}, {TEST_LOCATION_COUNTRY: 'ZZ'}])
    assert.equal((await worker.fetch(request(), {...env(), ...patch})).status, 503);
  assert.equal((await worker.fetch(request(body, 'checkout', {headers: {
    Origin: 'https://evil.invalid', 'Content-Type': 'application/json'}}), env())).status, 403);
  assert.equal((await worker.fetch(request(body, 'checkout', {headers: {
    Origin: origin, 'Content-Type': 'text/plain'}}), env())).status, 415);
  assert.equal((await worker.fetch(request(body, 'checkout', {headers: {
    Origin: origin, 'Content-Type': 'application/json'}}), env())).status, 503);
  assert.equal((await worker.fetch(new Request(origin + '/api/support/status'), env())).status, 405);
  assert.equal((await worker.fetch(new Request(origin + '/api/support/status?session=PRIVATE'), env())).status, 404);
  const rate = await worker.fetch(request(), {...env(), SUPPORT_RATE_LIMITER: {limit: async () => ({success: false})}});
  assert.equal(rate.status, 429); assert.equal(rate.headers.get('Retry-After'), '60');
  assert.equal(fetch.mock.callCount(), 0);
});

test('a configured minimum, missing cap, fixed or recurring prices and wrong products never create a session', async () => {
  for (const patch of [{active: false}, {id: 'price_other'}, {type: 'recurring'}, {livemode: true},
    {currency: 'krw'}, {custom_unit_amount: null}, {custom_unit_amount: {preset: 500}},
    {custom_unit_amount: {minimum: 0, maximum: 10000, preset: 500}},
    {custom_unit_amount: {minimum: 300, maximum: 10000, preset: 500}},
    {custom_unit_amount: {minimum: null, maximum: 10001, preset: 500}},
    {custom_unit_amount: {minimum: null, maximum: 10000, preset: 1000}},
    {currency_options: {krw: {custom_unit_amount: {minimum: 0}}}},
    {product: {active: false, name: 'Support maimai.party'}}, {product: {active: true, name: 'Unrelated product'}}]) {
    const fetch = mock.method(globalThis, 'fetch', async () => Response.json(price(patch)));
    assert.equal((await worker.fetch(request(), env())).status, 503);
    assert.equal(fetch.mock.callCount(), 1);
    assert.equal(fetch.mock.calls[0].arguments[1].method, 'GET');
    mock.restoreAll();
  }
});

test('an omitted optional minimum also delegates the processing floor to Stripe', async () => {
  const data = await session();
  mock.method(globalThis, 'fetch', async url => Response.json(url.includes('/prices/') ?
    price({custom_unit_amount: {maximum: 10000, preset: 500}}) : data));
  assert.equal((await worker.fetch(request(), env())).status, 200);
});

test('status requires the private attempt and returns only verified paid, pending, open or expired', async () => {
  for (const [changes, status] of [[{}, 'open'], [{status: 'complete', payment_status: 'paid'}, 'paid'],
    [{status: 'complete'}, 'pending'], [{status: 'expired'}, 'expired']]) {
    upstream(await session(changes));
    const response = await worker.fetch(request({project: body.project, attempt, session: sessionId}, 'status'), env());
    assert.deepEqual(await response.json(), {status}); mock.restoreAll();
  }
  upstream(await session());
  const wrong = await worker.fetch(request({project: body.project, attempt: crypto.randomUUID(), session: sessionId}, 'status'), env());
  assert.equal(wrong.status, 404);
  assert.equal((await wrong.text()).includes('PRIVATE'), false);
});

test('upstream failures, wrong account mode and oversized responses cannot expose Stripe data', async () => {
  mock.method(globalThis, 'fetch', async () => new Response('PRIVATE_API_ERROR', {status: 400}));
  assert.deepEqual(await (await worker.fetch(request(), env())).json(), {error: 'checkout_unavailable'});
  mock.restoreAll(); upstream(await session({livemode: true}));
  assert.equal((await worker.fetch(request(), env())).status, 404);
  mock.restoreAll(); upstream(await session({padding: 'PRIVATE'.repeat(15000)}));
  assert.equal((await worker.fetch(request(), env())).status, 502);
});

test('supported country simulation is confined to sandbox configuration', async () => {
  const fetch = upstream(await session());
  for (const country of ['US', 'KR', 'JP', 'CN']) {
    assert.equal((await worker.fetch(request(), {...env(), TEST_LOCATION_COUNTRY: country})).status, 200);
    assert.equal(new URLSearchParams(fetch.mock.calls.at(-1).arguments[1].body).get('customer_email'),
      'test+location_' + country + '@example.com');
  }
  assert.equal((await worker.fetch(request(), {...env(), STRIPE_MODE: 'live',
    STRIPE_SECRET_KEY: 'sk_live_fixture', TEST_LOCATION_COUNTRY: 'KR'})).status, 503);
});

test('opt-in sandbox diagnostics expose only fixed stages, reasons and HTTP status', async () => {
  for (const [upstreamStatus, reason] of [[302, 'http'], [401, 'http'], [400, 'http'], [429, 'http'], [200, 'response_read']]) {
    mock.method(globalThis, 'fetch', async () => new Response('PRIVATE_API_ERROR sk_test_private', {status: upstreamStatus}));
    const response = await worker.fetch(request(), {...env(), SUPPORT_DIAGNOSTICS: 'true'});
    assert.deepEqual(await response.json(), {error: 'checkout_unavailable', sandboxDiagnostic: {
      stage: 'price_lookup', reason, ...(reason === 'http' ? {status: upstreamStatus} : {})}});
    mock.restoreAll();
  }
  mock.method(globalThis, 'fetch', async () => { throw new Error('PRIVATE_NETWORK_ERROR'); });
  assert.deepEqual(await (await worker.fetch(request(), {...env(), SUPPORT_DIAGNOSTICS: 'true'})).json(),
    {error: 'checkout_unavailable', sandboxDiagnostic: {stage: 'price_lookup', reason: 'transport'}});
  const liveEnv = {...env(), STRIPE_MODE: 'live', STRIPE_SECRET_KEY: 'sk_live_fixture', SUPPORT_DIAGNOSTICS: 'true'};
  assert.deepEqual(await (await worker.fetch(request(), liveEnv)).json(), {error: 'checkout_unavailable'});
  mock.restoreAll();
  mock.method(globalThis, 'fetch', async url => url.includes('/prices/') ? Response.json(price()) :
    new Response('PRIVATE_SESSION_ERROR', {status: 400}));
  assert.deepEqual(await (await worker.fetch(request(), {...env(), SUPPORT_DIAGNOSTICS: 'true'})).json(),
    {error: 'checkout_unavailable', sandboxDiagnostic: {stage: 'session_create', reason: 'http', status: 400}});
});
