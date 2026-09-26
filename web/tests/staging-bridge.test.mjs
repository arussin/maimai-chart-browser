import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { moduleSource, evaluateModule } from './module.mjs';

// Node requires duplex for streaming bodies; workerd's Request does not.
class WorkerRequest extends Request {
  constructor(input, init) {
    super(input, init?.body ? { ...init, duplex: 'half' } : init);
  }
}
const { onRequest } = evaluateModule(
  await moduleSource('../../usage-worker/pages/functions/__usage'),
  {
    URL,
    Headers,
    Request: WorkerRequest,
    Response,
  },
);
const collector = evaluateModule(await moduleSource('../../usage-worker/staging'), {
  URL,
  Response,
  TextDecoder,
  Uint8Array,
  Date,
  Intl,
}).default;
const origin = 'https://maimai-party-staging.pages.dev';
const body = JSON.stringify({
  version: 1,
  events: [{ event: 'page_view', page: 'charts', detail: '', count: 1 }],
});
function request(options = {}) {
  const method = options.method || 'POST';
  return new Request(options.url || origin + '/__usage', {
    method,
    headers: { Origin: origin, 'Content-Type': 'application/json', ...options.headers },
    ...(method === 'GET' ? {} : { body: options.body ?? body }),
  });
}
test('Pages bridge strips authentication and identity before invoking the existing collector', async () => {
  const calls = [],
    statements = [];
  const env = {
    USAGE_COLLECTOR: {
      async fetch(forwarded) {
        calls.push(forwarded);
        assert.equal(forwarded.url, origin + '/__usage');
        assert.deepEqual([...forwarded.headers.keys()].sort(), ['content-type', 'origin']);
        assert.equal(forwarded.redirect, 'manual');
        assert.equal(await forwarded.clone().text(), body);
        return collector.fetch(forwarded, {
          USAGE_ENABLED: 'true',
          USAGE_DB: {
            prepare(sql) {
              return {
                bind(...values) {
                  return { sql, values };
                },
              };
            },
            async batch(rows) {
              statements.push(...rows);
            },
          },
        });
      },
    },
  };
  const response = await onRequest({
    request: request({
      headers: {
        Cookie: 'CF_Authorization=PRIVATE-SENTINEL',
        Authorization: 'Bearer PRIVATE-SENTINEL',
        'Cf-Access-Jwt-Assertion': 'PRIVATE-SENTINEL',
        'Cf-Access-Authenticated-User-Email': 'PRIVATE-SENTINEL',
        'Cf-Connecting-Ip': 'PRIVATE-SENTINEL',
        'X-Forwarded-For': 'PRIVATE-SENTINEL',
        Referer: 'PRIVATE-SENTINEL',
        'User-Agent': 'PRIVATE-SENTINEL',
        'Cf-Ray': 'PRIVATE-SENTINEL',
      },
    }),
    env,
  });
  assert.equal(response.status, 204);
  assert.equal(calls.length, 1);
  assert.equal(statements.length, 1);
  assert.ok(!JSON.stringify(statements).includes('PRIVATE-SENTINEL'));
});
test('Pages bridge rejects other origins and nonexact paths without calling the binding', async () => {
  const env = {
    USAGE_COLLECTOR: {
      fetch() {
        assert.fail('Forbidden bridge request');
      },
    },
  };
  for (const url of [
    'https://maimai.party/__usage',
    'https://other.invalid/__usage',
    'https://preview.maimai-party-staging.pages.dev/__usage',
    'http://maimai-party-staging.pages.dev/__usage',
    origin + ':8443/__usage',
    origin + '/__usage/',
    origin + '/__usage?x=1',
    origin + '/__usage?',
    origin + '/__usage%2f',
    origin + '/api/support/checkout',
    origin + '/',
  ])
    assert.equal((await onRequest({ request: request({ url }), env })).status, 404, url);
});
test('collector retains method, origin, finite data, privacy and kill decisions behind the bridge', async () => {
  let enabled = 'true',
    writes = 0;
  const env = {
    USAGE_COLLECTOR: {
      fetch: (forwarded) =>
        collector.fetch(forwarded, {
          USAGE_ENABLED: enabled,
          USAGE_DB: {
            prepare() {
              return {
                bind() {
                  return {};
                },
              };
            },
            async batch() {
              writes++;
            },
          },
        }),
    },
  };
  for (const [options, status] of [
    [{ method: 'GET' }, 405],
    [{ headers: { Origin: 'https://maimai.party' } }, 400],
    [{ headers: { 'Content-Type': 'text/plain' } }, 400],
    [{ body: 'x'.repeat(4097) }, 400],
    [{ body: body.replace('"page_view"', '"PRIVATE-SENTINEL"') }, 400],
    [{ headers: { DNT: '1' } }, 204],
    [{ headers: { 'Sec-GPC': '1' } }, 204],
  ])
    assert.equal((await onRequest({ request: request(options), env })).status, status);
  enabled = 'false';
  assert.equal((await onRequest({ request: request(), env })).status, 204);
  assert.equal(writes, 0);
  enabled = 'true';
  assert.equal((await onRequest({ request: request(), env })).status, 204);
  assert.equal(writes, 1);
});
test('missing or failed private binding is unavailable without private error detail or fallback', async () => {
  for (const env of [
    {},
    {
      USAGE_COLLECTOR: {
        fetch() {
          throw Error('PRIVATE-SENTINEL');
        },
      },
    },
  ]) {
    const response = await onRequest({ request: request(), env });
    assert.equal(response.status, 503);
    assert.equal(await response.text(), '');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
});
test('staging Pages routing is narrow and has no production source entry', async () => {
  const routes = JSON.parse(
    await readFile(new URL('../../usage-worker/pages/_routes.json', import.meta.url)),
  );
  assert.deepEqual(routes, { version: 1, include: ['/__usage', '/__usage/'], exclude: [] });
  const build = await readFile(new URL('../../usage-worker/package.json', import.meta.url), 'utf8');
  assert.ok(!JSON.parse(build).scripts.build.includes('pages/'));
  const productionConfig = await readFile(
    new URL('../../usage-worker/wrangler.jsonc', import.meta.url),
    'utf8',
  );
  assert.ok(!productionConfig.includes('USAGE_COLLECTOR'));
});

test('private service redirects are refused without leaking their location or following them', async () => {
  let calls = 0;
  const env = {
    USAGE_COLLECTOR: {
      async fetch(forwarded) {
        calls++;
        assert.equal(forwarded.redirect, 'manual');
        return new Response('PRIVATE-SENTINEL', {
          status: 302,
          headers: { Location: 'https://private.invalid/' },
        });
      },
    },
  };
  const response = await onRequest({ request: request(), env });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Location'), null);
  assert.equal(await response.text(), '');
  assert.equal(calls, 1);
});
