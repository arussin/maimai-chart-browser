import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { moduleSource, evaluateModule } from './module.mjs';

const origin = 'https://maimai-party-staging.pages.dev';
for (const staging of [false, true]) {
  test(`public reader ${staging ? 'staging' : 'production'} credentials are erased build literals`, async () => {
    const source = await moduleSource('runtime/verified-data', { staging });
    assert.ok(!source.includes('__MAIMAI_PUBLIC_REQUEST_CREDENTIALS__'));
    const requests = [];
    const bytes = new TextEncoder().encode('{"fictional":true}');
    const { PublicReader, sha256 } = evaluateModule(source, {
      URL,
      Uint8Array,
      TextDecoder,
      crypto: webcrypto,
      // Model an Access session: same-origin sends its cookie; omit does not.
      // Hosted verification separately proves actual Access policy and cookie delivery.
      fetch: async (url, options) => {
        requests.push({ url: String(url), options });
        return options.credentials === 'same-origin'
          ? new Response(bytes)
          : new Response(null, { status: 403 });
      },
      window: { __MAIMAI_PUBLIC_REQUEST_CREDENTIALS__: 'same-origin' },
    });
    const reader = new PublicReader(new URL(origin + '/'));
    const ref = { path: 'catalog.json', bytes: bytes.length, sha256: await sha256(bytes) };
    if (staging)
      assert.equal(new TextDecoder().decode(await reader.verified(ref)), '{"fictional":true}');
    else await assert.rejects(reader.verified(ref), /could not be loaded/);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options.credentials, staging ? 'same-origin' : 'omit');
    assert.equal(requests[0].options.redirect, 'error');
    assert.equal(requests[0].options.referrerPolicy, 'no-referrer');
    await assert.rejects(reader.read('https://other.invalid/catalog.json', 100), /Invalid public/);
    assert.equal(requests.length, 1, 'cross-origin reference never requests credentials');
    if (staging)
      await assert.rejects(reader.verified({ ...ref, sha256: '0'.repeat(64) }), /integrity/);
  });
}

test('staging usage passes a cookie-required transport without reading authentication or private data', async () => {
  const source = await moduleSource('usage-staging', { staging: true });
  assert.ok(!source.includes('__MAIMAI_PUBLIC_REQUEST_CREDENTIALS__'));
  const accepted = [],
    attempted = [],
    listeners = [];
  const document = { prerendering: false, addEventListener: (name) => listeners.push(name) };
  Object.defineProperty(document, 'cookie', {
    get() {
      throw Error('No cookie access');
    },
  });
  const api = evaluateModule(source, {
    document,
    location: { origin },
    navigator: {},
    TextEncoder,
    AbortSignal,
    clearTimeout() {},
    window: { setTimeout: () => 1, addEventListener: (name) => listeners.push(name) },
    fetch: async (url, options) => {
      attempted.push(url);
      assert.equal(options.credentials, 'same-origin');
      assert.equal(options.redirect, 'error');
      assert.equal(options.referrerPolicy, 'no-referrer');
      assert.deepEqual(Object.keys(options.headers), ['Content-Type']);
      accepted.push(JSON.parse(options.body));
      return new Response(null, { status: 204 });
    },
  }).createUsage();
  api.activate('song');
  api.emit('search_used', 'charts', 'PRIVATE-SENTINEL');
  await api.flush();
  assert.deepEqual(attempted, ['/__usage']);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].events.length, 1);
  assert.equal(accepted[0].events[0].event, 'page_view');
  assert.deepEqual(listeners.sort(), ['pagehide', 'visibilitychange']);
});
