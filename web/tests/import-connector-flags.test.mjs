import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './module.mjs';
import { CONNECTOR_METHODS } from '../../player-import-worker/connector-flags.mjs';
const { parseImportConnectorFlags, fetchImportConnectorFlags, OFFLINE_IMPORT_CONNECTORS } =
  await loadModule('runtime/import-connector-flags', {
    AbortController,
    TextDecoder,
    Uint8Array,
    setTimeout,
    clearTimeout,
  });
const manifest = (methods = {}) => ({ schemaVersion: 1, methods });
const response = (value) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
test('browser methods match Worker allowlist; missing methods off and offline only local recovery', () => {
  const flags = parseImportConnectorFlags(manifest());
  assert.deepEqual(Object.keys(flags).sort(), [...CONNECTOR_METHODS].sort());
  assert(Object.values(flags).every((value) => value === false));
  assert.deepEqual(
    Object.entries(OFFLINE_IMPORT_CONNECTORS).filter(([, value]) => value),
    [['file', true]],
  );
  for (const input of [
    null,
    [],
    manifest({ unknown: true }),
    manifest({ file: 1 }),
    { ...manifest(), url: 'https://invalid.test/' },
    { schemaVersion: 2, methods: {} },
  ])
    assert.throws(() => parseImportConnectorFlags(input));
});
test('fresh reads honor live off/on and never send cookies or permit redirects', async () => {
  let enabled = false,
    count = 0;
  const transport = async (url, options) => {
    count++;
    assert.equal(url, '/api/player-import/oauth/connectors');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
    assert.equal(options.referrerPolicy, 'no-referrer');
    return response(manifest({ 'file:tomomai': enabled }));
  };
  assert.equal(
    (await fetchImportConnectorFlags(new AbortController().signal, transport))['file:tomomai'],
    false,
  );
  enabled = true;
  assert.equal(
    (await fetchImportConnectorFlags(new AbortController().signal, transport))['file:tomomai'],
    true,
  );
  assert.equal(count, 2);
});
test('HTTP failure, non-JSON, oversized body and malformed data cannot enable methods', async () => {
  for (const result of [
    new Response('', { status: 503 }),
    new Response('{}'),
    response(manifest({ file: 'true' })),
    new Response(' '.repeat(8193), { headers: { 'content-type': 'application/json' } }),
  ])
    await assert.rejects(
      fetchImportConnectorFlags(new AbortController().signal, async () => result),
    );
});
test('fetch and body reads have a bounded deadline; caller cancellation also stops waiting', async () => {
  await assert.rejects(
    fetchImportConnectorFlags(new AbortController().signal, () => new Promise(() => {}), 5),
  );
  await assert.rejects(
    fetchImportConnectorFlags(
      new AbortController().signal,
      async () =>
        new Response(new ReadableStream({ start() {} }), {
          headers: { 'content-type': 'application/json' },
        }),
      5,
    ),
  );
  const controller = new AbortController();
  const pending = fetchImportConnectorFlags(controller.signal, () => new Promise(() => {}));
  controller.abort();
  await assert.rejects(pending);
});

test('all-off success is immutable and never falls back to the offline file choice', async () => {
  const flags = await fetchImportConnectorFlags(new AbortController().signal, async () =>
    response(manifest()),
  );
  assert.equal(flags.file, false);
  assert(Object.values(flags).every((value) => value === false));
  assert(Object.isFrozen(flags));
});

test('rejected HTTP, content type and content length cancel unread response bodies', async () => {
  for (const options of [
    { status: 503, headers: { 'content-type': 'application/json' } },
    { headers: { 'content-type': 'text/html' } },
    { headers: { 'content-type': 'application/json', 'content-length': '8193' } },
    { headers: { 'content-type': 'application/json', 'content-length': 'invalid' } },
  ]) {
    let cancelled = false;
    const body = new ReadableStream({
      cancel() {
        cancelled = true;
      },
    });
    await assert.rejects(
      fetchImportConnectorFlags(
        new AbortController().signal,
        async () => new Response(body, options),
      ),
    );
    assert.equal(cancelled, true, JSON.stringify(options));
  }
});

test('invalid UTF-8 and oversized streamed data cannot enable a connector', async () => {
  for (const bytes of [new Uint8Array([0xff]), new Uint8Array(8193)]) {
    await assert.rejects(
      fetchImportConnectorFlags(
        new AbortController().signal,
        async () => new Response(bytes, { headers: { 'content-type': 'application/json' } }),
      ),
    );
  }
});

test('pre-aborted callers make no request and timed-out late responses are cancelled', async () => {
  const aborted = new AbortController();
  aborted.abort();
  let calls = 0;
  await assert.rejects(
    fetchImportConnectorFlags(aborted.signal, async () => {
      calls++;
      return response(manifest({ file: true }));
    }),
  );
  assert.equal(calls, 0);
  let resolveResponse,
    cancelled = false;
  const pending = fetchImportConnectorFlags(
    new AbortController().signal,
    () =>
      new Promise((resolve) => {
        resolveResponse = resolve;
      }),
    5,
  );
  await assert.rejects(pending);
  resolveResponse(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { 'content-type': 'application/json' } },
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cancelled, true);
});

test('cancelling an in-flight body read discards it without changing offline recovery', async () => {
  const controller = new AbortController();
  let cancelled = false,
    startRead;
  const reading = new Promise((resolve) => {
    startRead = resolve;
  });
  const body = new ReadableStream({
    pull() {
      startRead();
    },
    cancel() {
      cancelled = true;
    },
  });
  const pending = fetchImportConnectorFlags(
    controller.signal,
    async () => new Response(body, { headers: { 'content-type': 'application/json' } }),
  );
  await reading;
  controller.abort();
  await assert.rejects(pending);
  assert.equal(cancelled, true);
  assert.equal(OFFLINE_IMPORT_CONNECTORS.file, true);
});
