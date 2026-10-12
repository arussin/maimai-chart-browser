import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { loadModule } from './module.mjs';

const globals = {
  crypto: webcrypto,
  TextEncoder,
  TextDecoder,
  structuredClone,
  Date,
  Map,
  Set,
  Uint8Array,
  ArrayBuffer,
  AbortController,
  DOMException,
  setTimeout,
  clearTimeout,
};
const { createPlayerDataCore } = await loadModule('views/player-data-core', globals);
const { createPlayerKamaitachi } = await loadModule('views/player-kamaitachi', globals);
const { importFailure } = await loadModule('runtime/import-failure', globals);
const core = createPlayerDataCore(),
  legacy = 'a'.repeat(40),
  stamp = 1791727516840;
const profile = () => ({
  id: 42,
  username: 'Fictional_Player',
  about: 'not retained',
  socialMedia: { discord: 'not retained' },
});
// Synthetic shape from Tachi b38e072 common/types/documents.ts, db-formats/{chart,pb,song}.ts.
function fixture() {
  const song = {
    id: 'song-v3',
    title: 'Fictional Song 🦆',
    artist: 'Fictional Artist',
    data: { genre: 'ORIGINAL' },
    altTitles: [],
    searchTerms: [],
  };
  return {
    songs: [song],
    charts: [
      {
        game: 'maimaidx',
        chartID: 'chart-v3',
        legacyChartID: legacy,
        song,
        level: '14+',
        levelNum: 14.7,
        isPrimary: true,
        difficulty: 'DX Re:Master',
        data: { displayVersion: 'PRiSM', inGameID: 12345 },
        versions: ['prism'],
      },
    ],
    pbs: [
      {
        userID: 42,
        game: 'maimaidx',
        chartID: 'chart-v3',
        songID: 'song-v3',
        isPrimary: true,
        timeAchieved: 1750000000000,
        composedFrom: [{ name: 'Best Percent', scoreID: 'real-but-not-a-composite-play' }],
        scoreData: {
          percent: 100.1234,
          lamp: 'FULL COMBO+',
          grade: 'SSS',
          enumIndexes: { lamp: 3, grade: 12 },
          optional: { enumIndexes: {}, fast: 2, slow: 3, maxCombo: 400 },
          judgements: { pcrit: 370, perfect: 25, great: 5, good: 0, miss: 0 },
        },
        calculatedData: { rate: 312 },
      },
    ],
  };
}
function response(body, init = {}) {
  return new Response(JSON.stringify({ success: true, body }), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}
function setup({ p = profile(), body = fixture(), now = stamp, responses } = {}) {
  const calls = [],
    queue = responses ?? [response(p), response(body)];
  const adapter = createPlayerKamaitachi({
    core,
    now: () => now,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return queue.shift();
    },
  });
  return {
    adapter,
    calls,
    read: (account = 'Fictional_Player', expectedPlayer) =>
      adapter.read(account, { signal: new AbortController().signal, expectedPlayer }),
  };
}

test('Kamaitachi failures retain finite source causes without exposing response text', async () => {
  for (const [responses, reason] of [
    [[new Response('PRIVATE missing', { status: 404 })], 'profile_missing'],
    [[new Response('PRIVATE limit', { status: 429 })], 'rate_limited'],
    [[new Response('PRIVATE denial', { status: 403 })], 'authorization_failed'],
    [[new Response('PRIVATE unavailable', { status: 503 })], 'unavailable'],
    [[response({ ...profile(), username: 'Wrong_account' })], 'account_mismatch'],
    [[response(profile()), response({ songs: [], charts: [], pbs: [] })], 'empty_scores'],
    [[response(profile()), response({ songs: 'bad', charts: [], pbs: [] })], 'invalid_response'],
  ]) {
    await assert.rejects(setup({ responses }).read(), (error) => {
      assert.equal(importFailure(error), reason);
      assert.ok(!error.message.includes('PRIVATE'));
      return true;
    });
  }
  const adapter = createPlayerKamaitachi({
    core,
    fetch: async () => {
      throw new TypeError('PRIVATE network');
    },
  });
  await assert.rejects(
    adapter.read('Fictional_Player', { signal: new AbortController().signal }),
    (error) => importFailure(error) === 'network',
  );
});

test('public v3 PB read resolves numeric account, omits credentials, and never invents plays', async () => {
  const { read, calls } = setup();
  const { data, account } = await read();
  assert.equal(account, '42');
  assert.equal(data.player.key, 'kamaitachi:maimaidx:42');
  assert.equal(data.player.username, '42');
  assert.equal(data.player.displayName, 'Fictional_Player');
  assert.deepEqual(
    calls.map((c) => c.url),
    [
      'https://kamai.tachi.ac/api/v1/users/Fictional_Player',
      'https://kamai.tachi.ac/api/v1/users/42/games/maimaidx/pbs/all',
    ],
  );
  for (const { init } of calls) {
    assert.equal(init.method, 'GET');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    assert.equal(init.referrerPolicy, 'no-referrer');
    assert.equal(init.cache, 'no-store');
    assert.deepEqual(Object.keys(init.headers), ['Accept']);
  }
  const record = Object.values(data.records)[0];
  assert.equal(record.achievement, 1001234);
  assert.equal(record.constant, 147);
  assert.equal(record.timeAchieved, 1750000000000);
  assert.equal(record.lamp, 'FULL COMBO+');
  assert.equal(record.fast, 2);
  assert.equal(record.rate, 312);
  assert.equal(record.dxScore, null);
  assert.equal(record.sync, '');
  assert.equal(data.charts[legacy].difficulty, 'RE:MASTER');
  assert.equal(data.charts[legacy].format, 'DX');
  assert.equal(Object.keys(data.plays).length, 0);
  assert.equal(Object.values(data.snapshots)[0].complete, false);
  assert.equal(Object.values(data.snapshots)[0].capturedAt, stamp);
  assert.equal(Object.values(data.captures)[0].historyCoverage, 'none');
  assert.equal(JSON.stringify(data).includes('not retained'), false);
  assert.equal(JSON.stringify(data).includes('real-but-not'), false);
  assert.equal((await core.validate(data)).revision, data.revision);
});

test('renamed numeric user retains identity; wrong account or changed expected identity rejects before PB read', async () => {
  const renamed = setup({ p: { ...profile(), username: 'Renamed_Player' } });
  assert.equal(
    (await renamed.read('42', 'kamaitachi:maimaidx:42')).data.player.displayName,
    'Renamed_Player',
  );
  for (const [account, p, expected] of [
    ['Fictional_Player', { ...profile(), username: 'Other' }, null],
    ['41', profile(), null],
    ['Fictional_Player', profile(), 'kamaitachi:maimaidx:41'],
  ]) {
    const client = setup({ p });
    await assert.rejects(() => client.read(account, expected));
    assert.equal(client.calls.length, 1);
  }
});

test('canonical profile URLs and usernames resolve through the same public API lookup', async () => {
  for (const input of [
    'Fictional_Player',
    '42',
    'https://kamai.tachi.ac/u/Fictional_Player',
    'https://kamai.tachi.ac/u/42',
    ' https://kamai.tachi.ac/u/42/ ',
  ]) {
    const client = setup(),
      selected = client.adapter.location(input),
      result = await client.read(input);
    assert.equal(result.data.player.key, 'kamaitachi:maimaidx:42');
    assert.equal(selected.url, 'https://kamai.tachi.ac/u/' + selected.account);
    assert.equal(client.calls[0].url, 'https://kamai.tachi.ac/api/v1/users/' + selected.account);
    assert.equal(
      client.calls[1].url,
      'https://kamai.tachi.ac/api/v1/users/42/games/maimaidx/pbs/all',
    );
  }
});

test('locations reject noncanonical URLs, numeric aliases, and authenticated me route before requests', async () => {
  const { adapter } = setup();
  for (const value of [
    'me',
    'ME',
    '042',
    'https://kamai.tachi.ac/u/me',
    'https://kamai.tachi.ac/u/ME',
    'https://kamai.tachi.ac/u/042',
    'http://kamai.tachi.ac/u/42',
    'https://kamai.tachi.ac:443/u/42',
    'https://user:secret@kamai.tachi.ac/u/42',
    'https://kamai.tachi.ac.evil.example/u/42',
    'https://other.example/u/42',
    '//kamai.tachi.ac/u/42',
    'https://kamai.tachi.ac/u/%34%32',
    'https://kamai.tachi.ac/u/42?token=not-a-token',
    'https://kamai.tachi.ac/u/42#profile',
    'https://kamai.tachi.ac/u/42/games/maimaidx',
    'https://kamai.tachi.ac/api/v1/users/42',
    'https://kamai.tachi.ac/u/../u/42',
    'https://kamai.tachi.ac/u/42//',
    'https:\\\\kamai.tachi.ac\\u\\42',
    'a/b',
    'x?y',
    'x\u0000',
    '9007199254740992',
    'https://kamai.tachi.ac/u/9007199254740992',
    'a'.repeat(65),
    'https://kamai.tachi.ac/u/' + 'a'.repeat(65),
  ]) {
    assert.throws(() => adapter.location(value), /username, numeric user ID, or profile URL/);
    const client = setup();
    await assert.rejects(() => client.read(value), /username, numeric user ID, or profile URL/);
    assert.equal(client.calls.length, 0);
  }
  assert.equal(adapter.location(' 42 ').account, '42');
});

test('missing legacy alias preserves explicitly namespaced unmatched chart, never infers from in-game ID', async () => {
  const body = fixture();
  delete body.charts[0].legacyChartID;
  const { data } = await setup({ body }).read();
  assert.deepEqual(Object.keys(data.charts), ['kamaitachi-v3:chart-v3']);
  assert.equal(data.charts['kamaitachi-v3:chart-v3'].inGameID, 12345);
});

test('ambiguous, dangling, wrong-game and mismatched identities reject the whole response', async () => {
  const mutations = [
    (b) => {
      b.pbs[0].userID = 41;
    },
    (b) => {
      b.pbs[0].game = 'maimai';
    },
    (b) => {
      b.pbs[0].songID = 'wrong';
    },
    (b) => {
      b.charts[0].song.title = 'mismatch';
      b.songs = [{ ...b.songs[0], title: 'correct' }];
    },
    (b) => {
      b.pbs.push(structuredClone(b.pbs[0]));
    },
    (b) => {
      b.charts.push(structuredClone(b.charts[0]));
    },
    (b) => {
      b.charts.push({ ...b.charts[0], chartID: 'second', difficulty: 'Master' });
    },
    (b) => {
      b.pbs = [];
    },
    (b) => {
      b.songs.push({ ...b.songs[0], id: 'unused' });
    },
    (b) => {
      b.charts[0].difficulty = 'Utage';
    },
    (b) => {
      b.charts[0].chartID = '__proto__';
    },
    (b) => {
      b.charts[0].legacyChartID = '12345';
    },
    (b) => {
      b.charts[0].isPrimary = false;
    },
  ];
  for (const mutate of mutations) {
    const body = fixture();
    mutate(body);
    await assert.rejects(() => setup({ body }).read(), /unsupported/);
  }
});

test('malformed score fields, strings, precision and timestamps cannot silently become valid measurements', async () => {
  const mutations = [
    (b) => {
      b.pbs[0].scoreData.percent = '100.1234';
    },
    (b) => {
      b.pbs[0].scoreData.percent = 101.0001;
    },
    (b) => {
      b.pbs[0].scoreData.percent = 100.12345;
    },
    (b) => {
      b.charts[0].levelNum = 14.75;
    },
    (b) => {
      b.pbs[0].timeAchieved = '2025-01-01';
    },
    (b) => {
      delete b.pbs[0].timeAchieved;
    },
    (b) => {
      b.pbs[0].timeAchieved = -1;
    },
    (b) => {
      b.pbs[0].scoreData.optional.fast = 1.5;
    },
    (b) => {
      b.pbs[0].scoreData.judgements = [];
    },
    (b) => {
      b.pbs[0].scoreData.lamp = 'AP';
    },
    (b) => {
      b.pbs[0].calculatedData.rate = -1;
    },
    (b) => {
      b.charts[0].song.title = '\ud800';
    },
  ];
  for (const mutate of mutations) {
    const body = fixture();
    mutate(body);
    await assert.rejects(() => setup({ body }).read(), /unsupported/);
  }
  const body = fixture();
  body.pbs[0].timeAchieved = null;
  body.pbs[0].scoreData.optional = {};
  body.pbs[0].scoreData.judgements = {};
  const { data } = await setup({ body }).read();
  assert.equal(Object.values(data.records)[0].timeAchieved, null);
  assert.equal(Object.values(data.records)[0].maxCombo, null);
});

test('repeat reads deduplicate records; newer responses preserve omitted PBs without fake history', async () => {
  const a = (await setup().read()).data,
    same = (await setup().read()).data;
  assert.equal((await core.merge(a, same)).revision, a.revision);
  const body = fixture();
  body.pbs[0].scoreData.percent = 100.2345;
  const newer = (await setup({ body, now: stamp + 1000 }).read()).data;
  const merged = await core.merge(a, newer);
  assert.equal(core.current(merged).pbs.get(legacy).achievement, 1002345);
  assert.equal(Object.keys(merged.plays).length, 0);
  const extra = fixture();
  extra.charts.push({
    ...extra.charts[0],
    chartID: 'another-v3',
    legacyChartID: 'b'.repeat(40),
    difficulty: 'Master',
  });
  extra.pbs.push({ ...extra.pbs[0], chartID: 'another-v3' });
  const two = (await setup({ body: extra, now: stamp - 1000 }).read()).data;
  const omitted = await core.merge(two, newer);
  assert.equal(core.current(omitted).pbs.size, 2);
  assert.equal(core.current(omitted).pbs.get('b'.repeat(40)).achievement, 1001234);
});

test('missing user, missing maimai DX profile, and empty PB set have distinct actionable failures', async () => {
  const missingUser = setup({ responses: [new Response('not exposed', { status: 404 })] });
  await assert.rejects(
    () => missingUser.read(),
    /could not find that user\. Check the username or profile URL/,
  );
  assert.equal(missingUser.calls.length, 1);
  const missingGame = setup({
    responses: [response(profile()), new Response('not exposed', { status: 404 })],
  });
  await assert.rejects(
    () => missingGame.read(),
    /has no maimai DX profile\. Import maimai DX scores into Kamaitachi first/,
  );
  assert.equal(missingGame.calls.length, 2);
  const empty = setup({ body: { songs: [], charts: [], pbs: [] } });
  await assert.rejects(
    () => empty.read(),
    /no maimai DX personal bests to import\. Update its scores in Kamaitachi first/,
  );
  assert.equal(empty.calls.length, 2);
});

test('HTTP, rate limits, redirects, bad encodings and byte limits reject without retries', async () => {
  const cases = [
    [new Response('not exposed', { status: 429 }), /limiting requests/],
    [new Response('not exposed', { status: 404 }), /could not find/],
    [new Response('not exposed', { status: 500 }), /could not be reached/],
    [
      new Response('<html>wrong</html>', { headers: { 'Content-Type': 'text/html' } }),
      /unsupported/,
    ],
    [new Response('{broken', { headers: { 'Content-Type': 'application/json' } }), /unsupported/],
    [
      new Response(new Uint8Array([0xff]), { headers: { 'Content-Type': 'application/json' } }),
      /unsupported/,
    ],
    [
      response(profile(), {
        headers: { 'Content-Type': 'application/json', 'Content-Length': '1048577' },
      }),
      /unsupported/,
    ],
    [response(profile(), { status: 206 }), /unsupported/],
    [
      new Response(' '.repeat(1048577), { headers: { 'Content-Type': 'application/json' } }),
      /too large|size|limit/i,
    ],
    [
      new Response(
        JSON.stringify({ success: false, description: 'not exposed', body: profile() }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
      /unsupported/,
    ],
  ];
  const redirected = response(profile());
  Object.defineProperty(redirected, 'redirected', { value: true });
  cases.push([redirected, /unsupported/]);
  for (const [res, pattern] of cases) {
    const client = setup({ responses: [res] });
    await assert.rejects(() => client.read(), pattern);
    assert.equal(client.calls.length, 1);
  }
  const abort = new AbortController();
  abort.abort();
  const { adapter, calls } = setup();
  await assert.rejects(() => adapter.read('42', { signal: abort.signal }), { name: 'AbortError' });
  assert.equal(calls.length, 0);
});

test('PB download has its own byte limit; cancellation interrupts the public request', async () => {
  const client = setup({
    responses: [
      response(profile()),
      response(fixture(), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(32 * 1024 * 1024 + 1),
        },
      }),
    ],
  });
  await assert.rejects(() => client.read(), /unsupported/);
  assert.equal(client.calls.length, 2);
  let resolveStarted;
  const started = new Promise((resolve) => {
    resolveStarted = resolve;
  });
  const controller = new AbortController();
  const adapter = createPlayerKamaitachi({
    core,
    fetch: async (_url, { signal }) => {
      resolveStarted();
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
      );
    },
  });
  const result = adapter.read('42', { signal: controller.signal });
  await started;
  controller.abort();
  await assert.rejects(() => result, { name: 'AbortError' });
});

test('rate limits propagate bounded Retry-After seconds and HTTP dates without automatic retries', async () => {
  const date = new Date(stamp + 120000).toUTCString();
  for (const [value, expected] of [
    ['120', stamp + 120000],
    [date, Date.parse(date)],
    ['0', stamp + 30000],
    ['999999999', stamp + 24 * 60 * 60 * 1000],
    [new Date(stamp - 120000).toUTCString(), stamp + 30000],
    ['invalid', stamp + 15 * 60 * 1000],
    ['-1', stamp + 15 * 60 * 1000],
    ['9'.repeat(130), stamp + 15 * 60 * 1000],
    [null, stamp + 15 * 60 * 1000],
  ]) {
    const headers = value === null ? {} : { 'Retry-After': value };
    const client = setup({ responses: [new Response('not exposed', { status: 429, headers })] });
    await assert.rejects(
      () => client.read(),
      (error) => {
        assert.match(error.message, /limiting requests/);
        assert.equal(error.retryAt, expected);
        return true;
      },
    );
    assert.equal(client.calls.length, 1);
  }
});

test('approved provider alias still requires exact source metadata and chart variant', async () => {
  const { adapter, read } = setup(),
    { data } = await read();
  const chart = data.charts[legacy],
    target = { ...chart, chart_id: 'catalog' },
    row = { chart_id: 'catalog' };
  assert.equal(adapter.matchChart(data.player, chart, row, target), true);
  for (const change of [
    { title: 'another' },
    { artist: 'another' },
    { format: 'STD' },
    { difficulty: 'MASTER' },
  ])
    assert.equal(adapter.matchChart(data.player, { ...chart, ...change }, row, target), false);
  assert.equal(
    adapter.matchChart(
      data.player,
      chart,
      {
        ...row,
        expected_source: {
          title: chart.title,
          artist: chart.artist,
          format: chart.format,
          difficulty: chart.difficulty,
        },
      },
      { ...target, title: 'Reviewed alias' },
    ),
    true,
  );
});
