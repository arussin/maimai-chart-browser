import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './module.mjs';
const { createPlayerProviderConnections, authorizeProvider } = await loadModule(
  'views/player-provider-connections',
  {
    Error,
    DOMException,
    AbortSignal,
    AbortController,
    URL,
    TextDecoder,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
  },
);
const nonce = '11111111-1111-4111-8111-111111111111';
const { importFailure } = await loadModule('runtime/import-failure', { Error, DOMException });
const grant = {
  provider: 'diving-fish',
  accountID: 'a'.repeat(64),
  connectionID: 'x'.repeat(32),
  displayName: 'Fictional player',
  connected: true,
  requiresReconnect: false,
  flowNonce: nonce,
  warnings: [],
};
const bounded = async (stream, limit) => {
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  assert(bytes.length <= limit);
  return bytes;
};
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

test('reviewed OAuth response branches expose finite reasons without provider text', async () => {
  for (const [provider, status, body, reason] of [
    ['diving-fish', 403, { error: 'tracker_agreement_required' }, 'agreement_required'],
    ['lxns', 404, { error: 'lxns_player_missing' }, 'profile_missing'],
    ['lxns', 429, { error: 'rate_limited' }, 'rate_limited'],
    ['lxns', 401, { error: 'reconnect_required' }, 'connection_expired'],
    ['lxns', 502, { error: 'invalid_response' }, 'invalid_response'],
    ['lxns', 502, { error: 'PRIVATE arbitrary body' }, 'unavailable'],
    ['lxns', 200, {}, 'invalid_response'],
  ]) {
    const api = createPlayerProviderConnections({ bounded, fetch: async () => json(body, status) });
    await assert.rejects(
      api.read(provider, grant.connectionID, new AbortController().signal),
      (error) => {
        assert.equal(importFailure(error), reason);
        assert.ok(!error.message.includes('PRIVATE'));
        return true;
      },
    );
  }
  const api = createPlayerProviderConnections({
    bounded,
    fetch: async () => json({ error: 'connection_pending' }, 409),
  });
  await assert.rejects(
    api.start('lxns', nonce, false, new AbortController().signal),
    (error) => importFailure(error) === 'cleanup_required',
  );
});

test('OAuth network failures and timeouts differ from caller cancellation', async () => {
  for (const timeout of [false, true]) {
    const api = createPlayerProviderConnections({
      bounded,
      fetch: async () => {
        throw timeout
          ? new DOMException('PRIVATE', 'TimeoutError')
          : new TypeError('PRIVATE network');
      },
    });
    await assert.rejects(
      api.read('lxns', grant.connectionID, new AbortController().signal),
      (error) => {
        assert.equal(importFailure(error), timeout ? 'timeout' : 'network');
        assert.ok(!error.message.includes('PRIVATE'));
        return true;
      },
    );
  }
  const controller = new AbortController();
  const api = createPlayerProviderConnections({
    bounded,
    fetch: async () => {
      controller.abort();
      throw new TypeError('network after cancel');
    },
  });
  await assert.rejects(api.read('lxns', grant.connectionID, controller.signal), {
    name: 'AbortError',
  });
});

test('authorization cancellation keeps its outcome when scoped cleanup also fails', async () => {
  const controller = new AbortController(),
    outcomes = [];
  const api = {
    start: () => new Promise(() => {}),
    status: async () => [],
    disconnect: async () => {
      throw Error('PRIVATE cleanup');
    },
  };
  const browser = {
    location: { origin: 'https://maimai.party' },
    addEventListener() {},
    removeEventListener() {},
  };
  const popup = { location: { href: '' }, close() {} };
  const waiting = authorizeProvider(
    api,
    'lxns',
    popup,
    nonce,
    false,
    controller.signal,
    browser,
    'en',
    (...args) => outcomes.push(args),
  );
  controller.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
  assert.deepEqual(outcomes, [['started'], ['failed', 'unavailable']]);
});

test('only verified callback failure codes become authorization reasons', async () => {
  for (const [code, reason] of [
    ['authorization_denied', 'authorization_failed'],
    ['PRIVATE arbitrary', 'unavailable'],
  ]) {
    let receive;
    const browser = {
      location: { origin: 'https://maimai.party' },
      addEventListener(_event, fn) {
        receive = fn;
      },
      removeEventListener() {},
    };
    const popup = { location: { href: '' }, close() {} };
    const api = {
      start: async () => 'https://maimai.lxns.net/oauth/authorize',
      status: async () => [],
      disconnect: async () => {},
    };
    const waiting = authorizeProvider(
      api,
      'lxns',
      popup,
      nonce,
      false,
      new AbortController().signal,
      browser,
    );
    receive({
      origin: browser.location.origin,
      source: popup,
      data: { type: 'maimai-party-oauth', provider: 'lxns', nonce, status: 'error', error: code },
    });
    await assert.rejects(
      waiting,
      (error) => importFailure(error) === reason && !error.message.includes('PRIVATE'),
    );
  }
});

test('bounded authorization timeout remains timeout even when its cleanup fails', async () => {
  let expire;
  const { authorizeProvider: authorize } = await loadModule('views/player-provider-connections', {
    Error,
    DOMException,
    AbortSignal,
    AbortController,
    URL,
    TextDecoder,
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: (callback) => {
      expire = callback;
      return 2;
    },
    clearTimeout() {},
  });
  const browser = {
    location: { origin: 'https://maimai.party' },
    addEventListener() {},
    removeEventListener() {},
  };
  const popup = { location: { href: '' }, close() {} };
  const api = {
    start: () => new Promise(() => {}),
    status: async () => [],
    disconnect: async () => {
      throw Error('PRIVATE cleanup');
    },
  };
  const outcomes = [];
  const waiting = authorize(
    api,
    'lxns',
    popup,
    nonce,
    false,
    new AbortController().signal,
    browser,
    'en',
    (...args) => outcomes.push(args),
  );
  expire();
  await assert.rejects(waiting, (error) => importFailure(error) === 'timeout');
  assert.deepEqual(outcomes, [['started'], ['failed', 'unavailable']]);
});

test('OAuth transport stays same-origin, uses the CSRF header, and exposes no token persistence', async () => {
  const calls = [];
  const api = createPlayerProviderConnections({
    bounded,
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/capabilities'))
        return json({ providers: { 'diving-fish': { enabled: true } } });
      if (url.endsWith('/status')) return json({ connections: [grant] });
      if (url.endsWith('/start'))
        return json({
          authorizationURL: 'https://auth.diving-fish.com/oauth/authorize?state=opaque',
        });
      if (url.endsWith('/read'))
        return json({ ...grant, fetchedAt: 1000, capturedAt: null, coverage: 'full', data: [] });
      return json({ disconnected: true, revocation: 'unavailable' });
    },
  });
  const signal = new AbortController().signal;
  assert.deepEqual(JSON.parse(JSON.stringify(await api.capabilities(signal))), {
    'diving-fish': true,
    lxns: false,
  });
  assert.equal((await api.status(signal))[0].accountID, grant.accountID);
  await api.start('diving-fish', nonce, false, signal);
  assert.equal(
    (await api.read('diving-fish', grant.connectionID, signal)).connectionID,
    grant.connectionID,
  );
  await api.disconnect('diving-fish', { connectionID: grant.connectionID });
  for (const { url, options } of calls) {
    assert(url.startsWith('/api/player-import/oauth/'));
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.redirect, 'error');
    if (options.method === 'POST') assert.equal(options.headers['X-Party-Import'], '1');
    assert.equal(options.headers.Authorization, undefined);
  }
  assert.equal(
    JSON.parse(calls.find(({ url }) => url.endsWith('/read')).options.body).connectionID,
    grant.connectionID,
  );
});

test('unsupported capabilities, unapproved authorization origins and changed grant generations fail closed', async () => {
  for (const [path, result, invoke] of [
    ['capabilities', {}, (api, signal) => api.capabilities(signal)],
    [
      'start',
      { authorizationURL: 'https://lookalike.example/oauth/authorize' },
      (api, signal) => api.start('diving-fish', nonce, false, signal),
    ],
    [
      'read',
      {
        ...grant,
        connectionID: 'new'.repeat(12),
        fetchedAt: 1000,
        capturedAt: null,
        coverage: 'full',
        data: [],
      },
      (api, signal) => api.read('diving-fish', grant.connectionID, signal),
    ],
  ]) {
    const api = createPlayerProviderConnections({
      bounded,
      fetch: async (url) => {
        assert(url.endsWith('/' + path));
        return json(result);
      },
    });
    await assert.rejects(() => invoke(api, new AbortController().signal));
  }
});

test('expired provider grants request reconnection and disconnect failures are explicit', async () => {
  const api = createPlayerProviderConnections({
    bounded,
    fetch: async () => json({ error: 'expired' }, 401),
  });
  await assert.rejects(
    () => api.read('diving-fish', grant.connectionID, new AbortController().signal),
    /renewed/,
  );
  await assert.rejects(
    () => api.disconnect('diving-fish', { connectionID: grant.connectionID }),
    /could not be removed/,
  );
});

test('provider cooldown survives transport errors for the refresh coordinator', async () => {
  const before = Date.now();
  const api = createPlayerProviderConnections({
    bounded,
    fetch: async () => new Response('', { status: 429, headers: { 'Retry-After': '120' } }),
  });
  await assert.rejects(
    () => api.read('diving-fish', grant.connectionID, new AbortController().signal),
    (error) => error.retryAt >= before + 120000,
  );
});

test('popup completion requires the precise origin, popup, provider, nonce and correlated server grant', async () => {
  let receiver;
  const browser = {
    location: { origin: 'https://maimai.party' },
    addEventListener: (_name, callback) => {
      receiver = callback;
    },
    removeEventListener: () => {},
  };
  const popup = {
    closed: false,
    location: { href: 'about:blank' },
    close() {
      this.closed = true;
    },
  };
  let statusCalls = 0,
    disconnected = 0;
  const api = {
    start: async () => 'https://auth.diving-fish.com/oauth/authorize',
    status: async () => {
      statusCalls++;
      return [grant];
    },
    disconnect: async () => {
      disconnected++;
    },
  };
  const waiting = authorizeProvider(
    api,
    'diving-fish',
    popup,
    nonce,
    false,
    new AbortController().signal,
    browser,
  );
  const valid = {
    origin: browser.location.origin,
    source: popup,
    data: { type: 'maimai-party-oauth', provider: 'diving-fish', nonce, status: 'connected' },
  };
  receiver({ ...valid, origin: 'https://lookalike.example' });
  receiver({ ...valid, source: {} });
  receiver({ ...valid, data: { ...valid.data, nonce: '22222222-2222-4222-8222-222222222222' } });
  receiver({ ...valid, data: { ...valid.data, provider: 'lxns' } });
  assert.equal(statusCalls, 0);
  receiver(valid);
  assert.equal((await waiting).connectionID, grant.connectionID);
  assert.equal(statusCalls, 1);
  assert.equal(disconnected, 0);
  assert.equal(popup.closed, true);
});

test('cancelled popup authorization closes the window and cancels only its nonce', async () => {
  const browser = {
    location: { origin: 'https://maimai.party' },
    addEventListener() {},
    removeEventListener() {},
  };
  const popup = {
    closed: false,
    location: { href: '' },
    close() {
      this.closed = true;
    },
  };
  const calls = [];
  const api = {
    start: () => new Promise(() => {}),
    status: async () => [],
    disconnect: async (...args) => calls.push(args),
  };
  const controller = new AbortController();
  const waiting = authorizeProvider(
    api,
    'diving-fish',
    popup,
    nonce,
    false,
    controller.signal,
    browser,
  );
  controller.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
  assert.equal(popup.closed, true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['diving-fish', { nonce }, 'provider_cleanup'],
  ]);
});

test('detached popup proxies keep polling until the exact nonce is connected', async () => {
  const browser = {
    location: { origin: 'https://maimai.party' },
    addEventListener() {},
    removeEventListener() {},
  };
  const popup = { closed: true, location: { href: '' }, close() {} };
  let reads = 0,
    disconnected = 0;
  const prior = {
    ...grant,
    connectionID: 'y'.repeat(32),
    flowNonce: '22222222-2222-4222-8222-222222222222',
  };
  const api = {
    start: async () => 'https://auth.diving-fish.com/oauth/authorize',
    status: async () => (++reads < 2 ? [prior] : [prior, grant]),
    disconnect: async () => {
      disconnected++;
    },
  };
  const result = await authorizeProvider(
    api,
    'diving-fish',
    popup,
    nonce,
    false,
    new AbortController().signal,
    browser,
  );
  assert.equal(reads, 2);
  assert.equal(disconnected, 0);
  assert.deepEqual(Array.from(result.previousConnectionIDs), [prior.connectionID]);
});

test('offline scoped cleanup survives reload without scores or tokens and can be retried', async () => {
  const values = new Map(),
    calls = [];
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const failed = createPlayerProviderConnections({
    bounded,
    storage,
    fetch: async () => {
      throw Error('offline');
    },
  });
  await assert.rejects(
    () => failed.disconnect('diving-fish', { connectionID: grant.connectionID }),
    /could not be removed/,
  );
  assert.equal(failed.pendingCleanup(), 1);
  assert.deepEqual(JSON.parse(values.values().next().value), [
    { provider: 'diving-fish', connectionID: grant.connectionID },
  ]);
  const restored = createPlayerProviderConnections({
    bounded,
    storage,
    fetch: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return json({ disconnected: true });
    },
  });
  await assert.rejects(
    () => restored.start('diving-fish', nonce, false, new AbortController().signal),
    /Retry connection cleanup/,
  );
  assert.equal(calls.length, 0);
  await restored.retryCleanup();
  assert.equal(restored.pendingCleanup(), 0);
  assert.equal(values.size, 0);
  assert.deepEqual(calls[0].body, { connectionID: grant.connectionID });
});

test('blocked local storage retains the in-tab cleanup retry', async () => {
  let online = false;
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw Error('blocked');
    },
    removeItem: () => {},
  };
  const api = createPlayerProviderConnections({
    bounded,
    storage,
    fetch: async () => {
      if (!online) throw Error('offline');
      return json({ disconnected: true });
    },
  });
  await assert.rejects(() => api.disconnect('diving-fish', { nonce }));
  assert.equal(api.pendingCleanup(), 1);
  online = true;
  await api.retryCleanup();
  assert.equal(api.pendingCleanup(), 0);
});

test('deferred providers cannot enter capabilities, status or any request path', async () => {
  const calls = [];
  const api = createPlayerProviderConnections({
    bounded,
    fetch: async (url) => {
      calls.push(url);
      if (url.endsWith('/capabilities'))
        return json({
          providers: { 'diving-fish': { enabled: true }, tomomai: { enabled: true } },
        });
      return json({ connections: [{ ...grant, provider: 'tomomai' }] });
    },
  });
  const signal = new AbortController().signal;
  assert.deepEqual(JSON.parse(JSON.stringify(await api.capabilities(signal))), {
    'diving-fish': true,
    lxns: false,
  });
  await assert.rejects(() => api.status(signal));
  const before = calls.length;
  for (const invoke of [
    () => api.start('tomomai', nonce, true, signal),
    () => api.read('tomomai', grant.connectionID, signal),
    () => api.disconnect('tomomai', { connectionID: grant.connectionID }),
    () => api.retryCleanup('tomomai'),
  ])
    await assert.rejects(invoke);
  assert.equal(calls.length, before);
});

test('the documented agreement error is actionable and the same remembered grant can retry', async () => {
  const calls = [];
  const api = createPlayerProviderConnections({
    bounded,
    fetch: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return calls.length === 1
        ? json({ error: 'tracker_agreement_required', private: 'never show this' }, 403)
        : json({
            ...grant,
            fetchedAt: 1000,
            capturedAt: null,
            coverage: 'full',
            data: { records: [] },
          });
    },
  });
  const signal = new AbortController().signal;
  await assert.rejects(
    () => api.read('diving-fish', grant.connectionID, signal),
    (error) => {
      assert.equal(error.code, 'tracker_agreement_required');
      assert.equal(
        error.message,
        'Open Diving-Fish, accept its tracker agreement, and confirm your scores are visible. Then try again.',
      );
      return true;
    },
  );
  assert.equal(
    (await api.read('diving-fish', grant.connectionID, signal)).connectionID,
    grant.connectionID,
  );
  assert.equal(api.pendingCleanup(), 0);
  assert(
    calls.every(
      (call) =>
        call.url.endsWith('/diving-fish/read') && call.body.connectionID === grant.connectionID,
    ),
  );
});

test('only bounded agreement errors from Fish read receive setup guidance and no error suggests a JSON fallback', async () => {
  const unavailable = 'The provider connection could not be completed. Please try again.';
  for (const [response, invoke] of [
    [
      () => json({ error: 'other', private: 'never show this' }, 403),
      (api) => api.read('diving-fish', grant.connectionID, new AbortController().signal),
    ],
    [
      () => json({ error: 'tracker_agreement_required' }, 403),
      (api) => api.start('diving-fish', nonce, true, new AbortController().signal),
    ],
    [
      () =>
        new Response('private invalid json', {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
      (api) => api.read('diving-fish', grant.connectionID, new AbortController().signal),
    ],
    [
      () => new Response('private html', { status: 403, headers: { 'Content-Type': 'text/html' } }),
      (api) => api.read('diving-fish', grant.connectionID, new AbortController().signal),
    ],
    [
      () => json({ error: 'tracker_agreement_required', private: 'x'.repeat(2048) }, 403),
      (api) => api.read('diving-fish', grant.connectionID, new AbortController().signal),
    ],
  ]) {
    const api = createPlayerProviderConnections({ bounded, fetch: async () => response() });
    await assert.rejects(
      () => invoke(api),
      (error) => error.message === unavailable && error.code === undefined,
    );
  }
});

test('a deferred cleanup entry cannot discard a valid Fish cleanup or trigger deferred requests', async () => {
  const key = 'maimai-provider-cleanup-v1',
    values = new Map([
      [
        key,
        JSON.stringify([
          { provider: 'tomomai', connectionID: 'y'.repeat(32) },
          { provider: 'diving-fish', connectionID: grant.connectionID },
        ]),
      ],
    ]),
    calls = [];
  const api = createPlayerProviderConnections({
    bounded,
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
    fetch: async (url) => {
      calls.push(url);
      return json({ disconnected: true });
    },
  });
  assert.equal(api.pendingCleanup(), 1);
  await api.retryCleanup();
  assert.deepEqual(calls, ['/api/player-import/oauth/diving-fish/disconnect']);
  assert.equal(api.pendingCleanup(), 0);
});

test('LXNS uses its fixed authorize origin, no Fish acknowledgement, and independent capabilities', async () => {
  const calls = [],
    lxns = { ...grant, provider: 'lxns', accountID: 'b'.repeat(64) };
  const api = createPlayerProviderConnections({
    bounded,
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/capabilities')) return json({ providers: { lxns: { enabled: true } } });
      if (url.endsWith('/status')) return json({ connections: [grant, lxns] });
      if (url.endsWith('/start'))
        return json({ authorizationURL: 'https://maimai.lxns.net/oauth/authorize?state=opaque' });
      if (url.endsWith('/read'))
        return json({
          ...lxns,
          fetchedAt: 1000,
          capturedAt: null,
          coverage: 'full',
          data: { success: true, code: 200, data: [] },
        });
      return json({ disconnected: true });
    },
  });
  const signal = new AbortController().signal;
  assert.deepEqual(JSON.parse(JSON.stringify(await api.capabilities(signal))), {
    'diving-fish': false,
    lxns: true,
  });
  assert.equal((await api.status(signal)).length, 2);
  assert.equal(
    await api.start('lxns', nonce, false, signal, 'ja'),
    'https://maimai.lxns.net/oauth/authorize?state=opaque',
  );
  assert.deepEqual(JSON.parse(calls.find((call) => call.url.endsWith('/start')).options.body), {
    nonce,
    locale: 'ja',
  });
  assert.equal((await api.read('lxns', lxns.connectionID, signal)).provider, 'lxns');
  await api.disconnect('lxns', { connectionID: lxns.connectionID });
  assert(
    calls
      .filter((call) => !/\/(status|capabilities)$/.test(call.url))
      .every((call) => call.url.startsWith('/api/player-import/oauth/lxns/')),
  );
  for (const wrong of [
    'https://auth.diving-fish.com/oauth/authorize',
    'https://maimai.lxns.net/account',
    'https://maimai.lxns.net.evil.example/oauth/authorize',
  ]) {
    const hostile = createPlayerProviderConnections({
      bounded,
      fetch: async () => json({ authorizationURL: wrong }),
    });
    await assert.rejects(() => hostile.start('lxns', nonce, false, signal));
  }
});

test('LXNS never accepts Fish masking warnings or Fish agreement recovery', async () => {
  for (const [response, invoke] of [
    [
      () =>
        json({
          connections: [{ ...grant, provider: 'lxns', warnings: ['fish_masking_unverified'] }],
        }),
      (api) => api.status(),
    ],
    [
      () => json({ error: 'tracker_agreement_required' }, 403),
      (api) => api.read('lxns', grant.connectionID, new AbortController().signal),
    ],
  ]) {
    const api = createPlayerProviderConnections({ bounded, fetch: async () => response() });
    await assert.rejects(
      () => invoke(api),
      (error) => error.code === undefined && !error.message.includes('Diving-Fish'),
    );
  }
});

test('only the bounded LXNS missing-player read response receives sync-first recovery', async () => {
  const signal = new AbortController().signal;
  const missing = () => json({ error: 'lxns_player_missing' }, 404);
  const api = createPlayerProviderConnections({ bounded, fetch: async () => missing() });
  await assert.rejects(
    () => api.read('lxns', grant.connectionID, signal),
    (error) =>
      error.code === 'lxns_player_missing' &&
      error.message ===
        'No supported scores were found in LXNS. Sync your maimai DX scores to LXNS first, then try again.',
  );
  for (const [response, invoke] of [
    [missing, (api) => api.read('diving-fish', grant.connectionID, signal)],
    [missing, (api) => api.start('lxns', nonce, false, signal)],
    [
      () => json({ error: 'lxns_player_missing' }, 400),
      (api) => api.read('lxns', grant.connectionID, signal),
    ],
    [
      () => json({ error: 'not_found' }, 404),
      (api) => api.read('lxns', grant.connectionID, signal),
    ],
    [
      () => new Response('<html>private</html>', { status: 404 }),
      (api) => api.read('lxns', grant.connectionID, signal),
    ],
    [
      () => json({ error: 'lxns_player_missing', extra: 'x'.repeat(2048) }, 404),
      (api) => api.read('lxns', grant.connectionID, signal),
    ],
  ]) {
    const other = createPlayerProviderConnections({ bounded, fetch: async () => response() });
    await assert.rejects(
      () => invoke(other),
      (error) => error.code === undefined && !error.message.includes('Sync your'),
    );
  }
});
