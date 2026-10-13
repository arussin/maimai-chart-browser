import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { loadModule } from './module.mjs';

const globals = {
  crypto: webcrypto,
  TextEncoder,
  TextDecoder,
  Blob,
  DecompressionStream,
  CompressionStream,
  structuredClone,
  Date,
  Map,
  Set,
  Uint8Array,
  ArrayBuffer,
};
const { createPlayerDataCore } = await loadModule('views/player-data-core', globals);
const { readImportFile, normalizeFileImportDocument } = await loadModule(
  'runtime/import-file',
  globals,
);
const { exactFileChartIndex } = await loadModule('domain/import-identities', globals);
const core = createPlayerDataCore();
const options = { format: 'mai-tools', username: 'Fictional', region: 'intl' };
const mai = (achievement = 100.1234) => [
  {
    songName: 'True Love Song',
    genre: 'maimai',
    chartType: 0,
    difficulty: 3,
    achievement,
    level: 12.4,
    fcap: 'FC+',
  },
];
function file(value, gzip = false) {
  const bytes = gzip
    ? gzipSync(JSON.stringify(value))
    : new TextEncoder().encode(JSON.stringify(value));
  return {
    size: bytes.length,
    lastModified: 1700000000000,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

test('file metadata enriches exact identities without inventing versions or gameplay times', async () => {
  const data = await readImportFile(core, file(mai()), options);
  const record = Object.values(data.records)[0],
    chart = Object.values(data.charts)[0];
  assert.equal(data.player.key, 'mai-tools:maimaidx:intl:Fictional');
  assert.equal(record.achievement, 1001234);
  assert.equal(record.constant, 124);
  assert.equal(record.lamp, 'FULL COMBO+');
  assert.equal(record.rate, null);
  assert.equal(record.timeAchieved, null);
  assert.equal(record.displayVersion, '');
  assert.equal(chart.inGameID, null);
  assert.equal(chart.artist, 'Kai/クラシック「G線上のアリア」');
  assert.equal(Object.keys(data.plays).length, 0);
  assert.equal(Object.values(data.snapshots)[0].complete, false);
  assert.equal(Object.values(data.snapshots)[0].capturedAt, 1700000000000);
  assert.equal((await core.decode(await core.encode(data))).revision, data.revision);
});

test('files are bounded before reading and after decompression, with strict selected formats', async () => {
  const plain = await readImportFile(core, file(mai()), options);
  const zipped = await readImportFile(core, file(mai(), true), options);
  assert.deepEqual(
    JSON.parse(JSON.stringify(plain.records)),
    JSON.parse(JSON.stringify(zipped.records)),
  );
  assert.equal(
    (await core.merge(plain, await readImportFile(core, file(mai()), options))).revision,
    plain.revision,
  );
  for (const format of ['diving-fish', 'lxns', 'unknown'])
    await assert.rejects(
      () =>
        readImportFile(
          core,
          {
            size: 0,
            arrayBuffer() {
              throw Error('Must not read');
            },
          },
          { ...options, format },
        ),
      /Unsupported/,
    );
  await assert.rejects(
    () =>
      readImportFile(
        core,
        {
          size: core.MAX_COMPRESSED + 1,
          arrayBuffer() {
            throw Error('Must not read');
          },
        },
        options,
      ),
    /32 MiB/,
  );
  const tooLarge = new Uint8Array(core.MAX_COMPRESSED + 1);
  await assert.rejects(
    () => readImportFile(core, { size: 1, arrayBuffer: async () => tooLarge.buffer }, options),
    /32 MiB/,
  );
  await assert.rejects(
    () => readImportFile({ ...core, MAX_DECODED: 10 }, file(mai(), true), options),
    /large|limit|exceed/i,
  );
  await assert.rejects(() => readImportFile(core, file(mai()), { ...options, format: 'tomomai' }));
  assert.equal(
    (await readImportFile(core, file(plain), { ...options, format: 'portable' })).revision,
    plain.revision,
  );
  assert.equal(
    (await readImportFile(core, file(plain, true), { ...options, format: 'portable' })).revision,
    plain.revision,
  );
});

test('partial snapshots preserve omitted charts, distinguish regions and reject conflicting PBs', async () => {
  const first = mai();
  first.push({ ...first[0], difficulty: 2 });
  const a = await readImportFile(core, file(first), options);
  const update = file(mai(98));
  update.lastModified += 1000;
  const b = await readImportFile(core, update, options);
  const merged = await core.merge(a, b);
  assert.equal(core.current(merged).pbs.size, 2);
  assert.equal(core.current(merged).pbs.get(Object.keys(b.charts)[0]).achievement, 980000);
  const other = await readImportFile(core, file(mai()), { ...options, region: 'jp' });
  await assert.rejects(() => core.merge(a, other), /Different players/);
  const duplicate = mai();
  duplicate.push({ ...duplicate[0], achievement: 97 });
  await assert.rejects(
    () => readImportFile(core, file(duplicate), options),
    /Conflicting personal bests/,
  );
});

test('unknown provider metadata is kept losslessly and never matched by a guessed numeric ID', async () => {
  const input = [{ ...mai()[0], songName: 'Future Fictional Song' }];
  const data = await readImportFile(core, file(input), options);
  assert.equal(Object.values(data.charts)[0].artist, '');
  assert.equal(Object.values(data.charts)[0].title, 'Future Fictional Song');
  assert.equal(exactFileChartIndex([], data.charts).size, 0);
});

test('DXRating and Tomomai native files normalize independently with stable provider IDs', async () => {
  const dx = await readImportFile(
    core,
    file([{ sheetId: 'True Love Song__dxrt__std__dxrt__master', achievementRate: 100 }]),
    { ...options, format: 'dxrating' },
  );
  assert.equal(core.current(dx).pbs.size, 1);
  assert.equal(Object.values(dx.charts)[0].artist, 'Kai/クラシック「G線上のアリア」');
  const source = {
    fetchedAt: '2026-10-10T12:30:00Z',
    songs: [
      {
        songId: 'Ab3xK9pQ:i11',
        songName: 'Fictional',
        artist: 'Synthetic',
        type: 'dx',
        difficulty: 'master',
        achievement: 1001234,
        levelPrecise: 137,
      },
    ],
  };
  const tomo = await readImportFile(core, file(source), { ...options, format: 'tomomai' });
  assert.equal(core.current(tomo).pbs.size, 1);
  assert.equal(Object.values(tomo.snapshots)[0].capturedAt, Date.parse(source.fetchedAt));
  source.songs[0].songId = 'Ab3xK9pQ:i12';
  const version = await readImportFile(core, file(source), { ...options, format: 'tomomai' });
  assert.equal(Object.keys(tomo.charts)[0], Object.keys(version.charts)[0]);
  const recent = await readImportFile(
    core,
    file({
      plays: [{ song: source.songs[0], achievement: 990000, playedAt: '2026-10-10T12:30:00Z' }],
    }),
    { ...options, format: 'tomomai' },
  );
  assert.equal(Object.keys(recent.plays).length, 0);
  assert.equal(core.current(recent).pbs.size, 0);
  assert.equal(core.current(await core.merge(tomo, recent)).pbs.size, 1);
});

test('private Aqua snapshots and attempts stay distinct and never retain card data', async () => {
  const input = {
    gameId: 'SDEZ',
    userData: { userName: 'Synthetic', accessCode: 'never-retain' },
    userMusicDetailList: [
      {
        musicId: 8,
        level: 3,
        achievement: 1000000,
        comboStatus: 2,
        syncStatus: 0,
        deluxscoreMax: 800,
      },
    ],
    userPlaylogList: [
      {
        musicId: 8,
        level: 3,
        achievement: 980000,
        comboStatus: 0,
        syncStatus: 0,
        deluxscore: 700,
        playlogId: 42,
        userPlayDate: '2026-10-01 20:00:00',
        trackNo: 1,
      },
    ],
  };
  const opts = {
    format: 'aqua',
    username: 'Fictional',
    region: 'private',
    instance: 'example.invalid',
  };
  const data = await readImportFile(core, file(input), opts);
  assert.equal(Object.keys(data.plays).length, 1);
  assert.equal([...core.current(data).pbs.values()][0].achievement, 1000000);
  assert.equal(
    Object.values(data.records).find((r) => r.achievement === 980000).timeAchieved,
    null,
  );
  assert.equal(JSON.stringify(data).includes('never-retain'), false);
  assert.equal(data.player.username, 'Fictional@example.invalid');
  await assert.rejects(
    () =>
      readImportFile(core, file(input), {
        ...opts,
        instance: 'https://example.invalid?token=secret',
      }),
    /hostname/,
  );
});

test('JiETNG title metadata is exact, recent scores do not replace PBs, and source regions must agree', async () => {
  const best = {
    title: 'True Love Song',
    type: 'Standard',
    difficulty: 'Master',
    achievement: 100,
    internal_level: 12.4,
    dx_score: 800,
    dx_score_max: 1200,
    combo: 'FC',
    sync: '',
  };
  const input = {
    format: 'JiETNGExport',
    schema_version: 2,
    maimai_version: 'intl',
    generated_at: '2026-10-10T20:30:00',
    profile: { name: 'Synthetic' },
    records: { best: [best, { ...best, type: 'Utage' }], recent: [{ ...best, achievement: 98 }] },
  };
  const opts = { format: 'jietng', username: 'Synthetic', region: 'intl' };
  let diagnostics;
  const data = await readImportFile(core, file(input), opts, (...args) => {
    diagnostics = args;
  });
  assert.deepEqual(diagnostics, [1, true]);
  assert.equal(Object.values(data.charts)[0].artist, 'Kai/クラシック「G線上のアリア」');
  assert.equal(Object.keys(data.records).length, 2);
  assert.equal(Object.keys(data.plays).length, 0);
  assert.equal([...core.current(data).pbs.values()][0].achievement, 1000000);
  await assert.rejects(
    () => readImportFile(core, file(input), { ...opts, region: 'jp' }),
    /region/,
  );
});

test('long Unicode title identities remain lossless while portable IDs stay bounded', async () => {
  const title = '未収録'.repeat(100);
  const data = await readImportFile(
    core,
    file({
      meta: { game: 'maimaidx', playtype: 'Single', service: 'Synthetic' },
      scores: [
        {
          matchType: 'songTitle',
          identifier: title,
          difficulty: 'DX Master',
          percent: 98,
          lamp: 'CLEAR',
        },
      ],
    }),
    { format: 'tachi', username: 'Synthetic', region: 'private', instance: 'example.invalid' },
  );
  const chart = Object.values(data.charts)[0];
  assert.equal(chart.title, title);
  assert.ok(chart.songID.length <= 256);
  assert.ok(chart.chartID.length <= 200);
  assert.equal(Object.keys(data.plays).length, 0);
  assert.equal(core.current(data).pbs.size, 0);
  assert.equal((await core.decode(await core.encode(data))).revision, data.revision);
});

test('full files preserve thousands of PBs beyond best-50', async () => {
  const input = Array.from({ length: 2010 }, (_, i) => ({
    ...mai()[0],
    songName: `Synthetic full export ${i}`,
  }));
  const data = await readImportFile(core, file(input), options);
  assert.equal(core.current(data).pbs.size, 2010);
  assert.equal(Object.keys(data.plays).length, 0);
  assert.equal((await core.decode(await core.encode(data))).revision, data.revision);
});

test('mai-tools duplicate Link titles need recognized genre evidence before catalog matching', async () => {
  const source = { ...mai()[0], songName: 'Link' };
  const normalized = async (genre) => {
    const data = await readImportFile(core, file([{ ...source, genre }]), options);
    return { data, chart: Object.values(data.charts)[0] };
  };
  const original = await normalized('maimai'),
    cover = await normalized('niconico＆ボーカロイド');
  assert.equal(original.chart.artist, 'Clean Tears feat. Youna');
  assert.match(cover.chart.artist, /Circle of friends/);
  assert.notEqual(original.chart.chartID, cover.chart.chartID);
  const catalog = [
    { ...original.chart, chart_id: 'original', variant_id: 'ordinary' },
    { ...cover.chart, chart_id: 'cover', variant_id: 'ordinary' },
  ];
  for (const genre of [undefined, '', 'Unknown category']) {
    const unknown = await normalized(genre);
    assert.equal(unknown.chart.title, 'Link');
    assert.equal(unknown.chart.artist, '');
    assert.equal(core.current(unknown.data).pbs.size, 1);
    assert.equal(exactFileChartIndex(catalog, unknown.data.charts).size, 0);
  }
});
