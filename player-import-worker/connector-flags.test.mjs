import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CONNECTOR_FLAGS_KEY, CONNECTOR_METHODS, normalizeConnectorFlags, parseConnectorFlags, readConnectorFlags} from './connector-flags.mjs';
import {createProviderOAuthService, OAUTH_PREFIX, PARTY_ORIGIN} from './provider-oauth.mjs';
import {configureConnectorFlags} from '../scripts/configure_import_connectors.mjs';

const text = JSON.stringify({schemaVersion:1, methods:{file:true, 'file:tomomai':true}});
const stream = value => new Response(value).body;
const env = value => ({IMPORT_CONNECTOR_FLAGS:{get:async (key, options) => {
  assert.equal(key, CONNECTOR_FLAGS_KEY);
  assert.deepEqual(options, {type:'stream', cacheTtl:60});
  return stream(value);
}}});

test('known method booleans normalize and absent methods stay hidden', () => {
  const result = parseConnectorFlags(text);
  assert.equal(result.schemaVersion, 1);
  assert.deepEqual(Object.keys(result.methods), CONNECTOR_METHODS);
  assert.deepEqual(Object.entries(result.methods).filter(([, enabled]) => enabled).map(([key]) => key), ['file', 'file:tomomai']);
  assert.deepEqual(normalizeConnectorFlags({schemaVersion:1, methods:{}}).methods, Object.fromEntries(CONNECTOR_METHODS.map(key => [key, false])));
});

test('configuration rejects unknown fields, methods, versions, non-booleans and oversized UTF-8', () => {
  for (const value of [null, [], {}, {schemaVersion:2,methods:{}}, {schemaVersion:1,methods:[]},
    {schemaVersion:1,methods:{},url:'https://untrusted.test'}, {schemaVersion:1,methods:{tomomai:true}},
    {schemaVersion:1,methods:{'file:diving-fish':true}}, {schemaVersion:1,methods:{file:'true'}},
    {schemaVersion:1,methods:{file:1}}, {schemaVersion:1,methods:{file:null}},
    JSON.parse('{"schemaVersion":1,"methods":{"__proto__":true}}')]) assert.throws(() => normalizeConnectorFlags(value));
  for (const raw of ['', '{', ' '.repeat(8193), 'あ'.repeat(3000)]) assert.throws(() => parseConnectorFlags(raw));
});

test('KV stream is bounded and invalid bytes are rejected', async () => {
  assert.deepEqual(await readConnectorFlags(env(text)), parseConnectorFlags(text));
  await assert.rejects(readConnectorFlags({}));
  await assert.rejects(readConnectorFlags({IMPORT_CONNECTOR_FLAGS:{get:async () => null}}));
  await assert.rejects(readConnectorFlags(env(new Uint8Array([0xff]))));
  let cancelled = false;
  await assert.rejects(readConnectorFlags({IMPORT_CONNECTOR_FLAGS:{get:async () => new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(8193)); },
    cancel() { cancelled = true; },
  })}}));
  assert.equal(cancelled, true);
});

test('KV lookup and body read have deadlines and late bodies are cancelled', async () => {
  let resolveLookup, cancelled = false;
  const pending = readConnectorFlags({IMPORT_CONNECTOR_FLAGS:{get:() => new Promise(resolve => { resolveLookup = resolve; })}}, undefined, {timeoutMs:10});
  await assert.rejects(pending);
  resolveLookup(new ReadableStream({cancel() { cancelled = true; }}));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(cancelled, true);
  cancelled = false;
  await assert.rejects(readConnectorFlags({IMPORT_CONNECTOR_FLAGS:{get:async () => new ReadableStream({cancel() { cancelled = true; }})}}, undefined, {timeoutMs:10}));
  assert.equal(cancelled, true);
  const aborted = new AbortController(); aborted.abort();
  let calls = 0;
  await assert.rejects(readConnectorFlags({IMPORT_CONNECTOR_FLAGS:{get:async () => { calls++; return stream(text); }}}, aborted.signal));
  assert.equal(calls, 0);
});

test('public endpoint needs only KV and exposes only normalized flags without cookies or cache', async () => {
  const service = createProviderOAuthService();
  const response = await service.fetch(new Request(PARTY_ORIGIN + OAUTH_PREFIX + '/connectors'), env(text));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), parseConnectorFlags(text));
  assert.match(response.headers.get('Cache-Control'), /no-store/);
  assert.equal(response.headers.has('Set-Cookie'), false);
  assert.equal(response.headers.has('Access-Control-Allow-Origin'), false);
});

test('public flags endpoint rejects other methods and query relay without touching KV', async () => {
  const service = createProviderOAuthService();
  let reads = 0;
  const e = {IMPORT_CONNECTOR_FLAGS:{get:async () => { reads++; return stream(text); }}};
  for (const method of ['POST','PUT','DELETE','HEAD','OPTIONS']) assert.equal((await service.fetch(new Request(PARTY_ORIGIN + OAUTH_PREFIX + '/connectors', {method}), e)).status, 405);
  for (const url of [PARTY_ORIGIN + OAUTH_PREFIX + '/connectors?url=https://untrusted.test', 'https://other.test' + OAUTH_PREFIX + '/connectors', PARTY_ORIGIN + OAUTH_PREFIX + '/connectors/']) assert.equal((await service.fetch(new Request(url), e)).status, 404);
  assert.equal(reads, 0);
});

test('missing and invalid flags return a fixed 503 without echoing stored data or errors', async () => {
  const service = createProviderOAuthService();
  for (const e of [{}, env('bad json'), env(JSON.stringify({schemaVersion:1,methods:{file:true},secret:'fictional-secret'})),
    {IMPORT_CONNECTOR_FLAGS:{get:async () => { throw Error('fictional-secret'); }}}]) {
    const response = await service.fetch(new Request(PARTY_ORIGIN + OAUTH_PREFIX + '/connectors'), e);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {error:'connectors_unavailable'});
    assert.match(response.headers.get('Cache-Control'), /no-store/);
  }
});

test('UI visibility flags do not change OAuth readiness or touch the flag store for provider requests', async () => {
  const service = createProviderOAuthService();
  const e = {IMPORT_CONNECTOR_FLAGS:{get:async () => { throw Error('Provider routes must not read visibility flags.'); }}};
  const response = await service.fetch(new Request(PARTY_ORIGIN + OAUTH_PREFIX + '/capabilities'), e);
  assert.deepEqual(await response.json(), {providers:{'diving-fish':{enabled:false},lxns:{enabled:false}}});
});

test('operator seed and local toggles use the exact same validated public contract', () => {
  const seed = parseConnectorFlags(readFileSync(new URL('../config/import-connectors.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(seed.methods), CONNECTOR_METHODS);
  const result = configureConnectorFlags(seed, ['file:tomomai'], ['diving-fish', 'lxns']);
  assert.equal(result.methods['file:tomomai'], true);
  assert.equal(result.methods['diving-fish'], false);
  assert.equal(result.methods.lxns, false);
  assert.equal(seed.methods.lxns, true);
  assert.throws(() => configureConnectorFlags(seed, ['unknown']));
  assert.throws(() => configureConnectorFlags(seed, ['file'], ['file']));
});
