import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountRegistryPage } from '../../tests/browser/registry-page-mount.mjs';

const origin = 'http://127.0.0.1:8766';
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture() {
  const closing = deferred(),
    closed = deferred();
  const events = [];
  let handler;
  const page = {
    async route(pattern, callback) {
      assert.equal(pattern, '**/*');
      handler = callback;
    },
    async close() {
      events.push('page-close-start');
      closing.resolve();
      await closed.promise;
      events.push('page-closed');
    },
    unrouteAll() {
      assert.fail('A live mount must never be removed during shutdown');
    },
    context() {
      assert.fail('The mount must not close or reconfigure context isolation');
    },
  };
  function request(path, response) {
    return handler({
      request: () => ({ url: () => new URL(path, origin).href }),
      async fetch(options) {
        events.push(['fetch', options.url]);
        return response.promise;
      },
      async fulfill({ response: value }) {
        events.push(['fulfill', value]);
      },
      async abort() {
        events.push('abort');
      },
    });
  }
  return { page, request, events, closing, closed };
}

test('registry mount closes its page then drains a held response before context disposal', async () => {
  const f = fixture(),
    response = deferred();
  const mount = await mountRegistryPage(f.page, origin);
  const request = f.request('/media/fictional.webp?version=1', response);
  let drained = false;
  const shutdown = mount.close().then(() => {
    drained = true;
    f.events.push('context-may-dispose');
  });
  await f.closing.promise;
  assert.equal(drained, false);
  f.closed.resolve();
  await f.closed.promise;
  assert.equal(drained, false, 'The held API response remains owned after page close');
  response.resolve('fictional-image');
  await Promise.all([request, shutdown]);
  assert.deepEqual(f.events, [
    ['fetch', origin + '/registry/media/fictional.webp?version=1'],
    'page-close-start',
    'page-closed',
    ['fulfill', 'fictional-image'],
    'context-may-dispose',
  ]);
});

test('registry mount also owns a late callback admitted while page closure is pending', async () => {
  const f = fixture(),
    response = deferred();
  const mount = await mountRegistryPage(f.page, origin);
  const shutdown = mount.close();
  await f.closing.promise;
  const late = f.request('/media/late.webp', response);
  f.closed.resolve();
  response.resolve('late-image');
  await Promise.all([late, shutdown]);
  assert.deepEqual(f.events, [
    'page-close-start',
    ['fetch', origin + '/registry/media/late.webp'],
    'page-closed',
    ['fulfill', 'late-image'],
  ]);
});

test('registry mount propagates request errors and drains other owned work before failing close', async () => {
  const f = fixture(),
    failed = deferred(),
    held = deferred();
  const mount = await mountRegistryPage(f.page, origin);
  const failure = new Error('fictional transport failed');
  const rejectedRequest = assert.rejects(
    f.request('/failed', failed),
    (error) => error === failure,
  );
  const survivingRequest = f.request('/held', held);
  let drained = false;
  const shutdown = assert.rejects(mount.close(), (error) => {
    drained = true;
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [failure]);
    return true;
  });
  await f.closing.promise;
  f.closed.resolve();
  failed.reject(failure);
  await rejectedRequest;
  assert.equal(drained, false, 'One failed operation must not abandon the other active response');
  held.resolve('remaining-image');
  await Promise.all([survivingRequest, shutdown]);
  assert.deepEqual(
    f.events.filter((event) => Array.isArray(event) && event[0] === 'fulfill'),
    [['fulfill', 'remaining-image']],
  );
});

test('registry mount preserves off-origin aborts and never fetches a forbidden destination', async () => {
  const f = fixture();
  const mount = await mountRegistryPage(f.page, origin);
  await f.request('https://forbidden.invalid/private', deferred());
  f.closed.resolve();
  await mount.close();
  assert.deepEqual(f.events, ['abort', 'page-close-start', 'page-closed']);
});
