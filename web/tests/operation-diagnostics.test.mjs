import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './module.mjs';
import { makeSession, dataset, connection, deferred, file } from './player-session-fixture.mjs';
import {
  validateDiagnostic,
  validateDiagnosticBatch,
  REASONS,
} from '../src/diagnostic-contract.ts';
const globals = {
  Error,
  DOMException,
  AbortController,
  AbortSignal,
  TextDecoder,
  TextEncoder,
  Uint8Array,
  URL,
  Response,
};
const { DiagnosticError, diagnosticError } = await loadModule('runtime/diagnostic-error', globals);
const { beginDiagnostic } = await loadModule('runtime/operation-diagnostics', globals);
const row = {
  operation: 'import',
  stage: 'transport',
  reason: 'network',
  outcome: 'failed',
  source: 'maishift',
  mode: 'manual',
  duration: 'under_1s',
  instrumentation: 'diagnostics-1',
  count: 1,
};
test('diagnostics reject raw strings in every dimension and private extra fields, whole batch', () => {
  assert.ok(validateDiagnostic(row));
  for (const key of Object.keys(row))
    assert.equal(validateDiagnostic({ ...row, [key]: 'PRIVATE-SENTINEL' }), null);
  for (const key of [
    'url',
    'handle',
    'player',
    'query',
    'error',
    'stack',
    'filename',
    'session',
    'ip',
    'hash',
  ])
    assert.equal(
      validateDiagnosticBatch({ version: 2, events: [row, { ...row, [key]: 'PRIVATE-SENTINEL' }] }),
      null,
    );
  assert.equal(validateDiagnostic({ ...row, source: 'best50' }), null);
  assert.equal(validateDiagnostic({ ...row, count: 101 }), null);
  assert.equal(validateDiagnosticBatch({ version: 2, events: Array(17).fill(row) }), null);
});
test('terminal guard accepts only explicit tags and never reads exception text', () => {
  const rows = [],
    op = beginDiagnostic((r) => rows.push(r), 'import', 'maishift', 'manual');
  op.stage('transport');
  op.fail({ message: 'PRIVATE', reason: 'network' });
  op.finish('success');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reason, 'unknown');
  assert(!JSON.stringify(rows).includes('PRIVATE'));
  assert.doesNotThrow(() =>
    beginDiagnostic(() => {
      throw Error('sink');
    }, 'catalog').finish('success'),
  );
});
async function sourceFixture(
  fetch,
  normalize = async () => {
    throw Error('PRIVATE normalization');
  },
  signals = AbortSignal,
) {
  const { createPlayerSources } = await loadModule('views/player-sources', {
    ...globals,
    AbortSignal: signals,
    fetch,
  });
  return createPlayerSources({
    features: { maishift: true },
    playerCore: {},
    maishift: {
      location: () => ({ handle: 'fictional', region: 'intl', url: 'https://fictional.invalid/' }),
      normalize,
    },
  });
}
test('every finite Worker category survives the real browser source adapter', async () => {
  const { workerReasons } = await loadModule('runtime/source-transport', globals);
  for (const [code, reason] of Object.entries(workerReasons)) {
    const source = await sourceFixture(
      async () =>
        new Response(JSON.stringify({ error: code }), {
          status: 503,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '120' },
        }),
    );
    await assert.rejects(source.readMaishift({ handle: 'fictional' }), (error) => {
      assert.equal(diagnosticError(error).reason, reason, code);
      assert(error.retryAt > Date.now());
      return true;
    });
  }
  const source = await sourceFixture(
    async () =>
      new Response('{"error":"PRIVATE-SENTINEL"}', {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  await assert.rejects(
    source.readMaishift({}),
    (error) => diagnosticError(error).reason === 'unknown' && !error.message.includes('PRIVATE'),
  );
});
test('malformed, oversized, changed schema and local normalization remain distinct', async () => {
  for (const [response, reason] of [
    [
      () => new Response('{', { headers: { 'Content-Type': 'application/json' } }),
      'malformed_response',
    ],
    [
      () =>
        new Response('{}', {
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': String(4 * 1024 * 1024 + 1),
          },
        }),
      'oversized_response',
    ],
    [
      () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array(4 * 1024 * 1024 + 1));
              c.close();
            },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
      'oversized_response',
    ],
    [
      () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }),
      'normalization',
    ],
  ]) {
    const source = await sourceFixture(async () => response());
    await assert.rejects(source.readMaishift({}), (e) => diagnosticError(e).reason === reason);
  }
  const source = await sourceFixture(
    async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }),
    async () => {
      throw new DiagnosticError('PRIVATE', 'contract_changed', 'response');
    },
  );
  await assert.rejects(
    source.readMaishift({}),
    (e) => diagnosticError(e).reason === 'contract_changed',
  );
});
test('diagnostics retain actionable import guidance without reporting its text', async () => {
  const guidance = [
    'Unsupported player file. Choose a maimai-player-data v1 export.',
    'This browser cannot read compressed player files. Please update your browser.',
  ];
  for (const message of guidance) {
    const source = await sourceFixture(
      async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }),
      async () => {
        throw Error(message);
      },
    );
    await assert.rejects(source.readMaishift({}), (error) => {
      assert.equal(error.message, message);
      assert.deepEqual(
        { ...diagnosticError(error) },
        { reason: 'normalization', stage: 'normalize' },
      );
      const rows = [];
      beginDiagnostic((row) => rows.push(row), 'import', 'maishift').fail(error);
      assert(!JSON.stringify(rows).includes(message));
      return true;
    });
  }
  for (const fault of ['offer', 'decode', 'declared_size', 'stream_size']) {
    const hash = 'a'.repeat(64);
    const meta = { object: { sha256: hash, path: '/report/party/data/' + hash + '.gz', bytes: 1 } };
    const { createPlayerSources } = await loadModule('views/player-sources', {
      ...globals,
      fetch: async (url) => {
        if (String(url).endsWith('latest.json')) {
          return new Response(JSON.stringify(meta), {
            headers: {
              'Content-Type': 'application/json',
              ...(fault === 'declared_size' ? { 'Content-Length': String(2 * 1024 * 1024) } : {}),
            },
          });
        }
        return new Response(fault === 'stream_size' ? 'xx' : 'x');
      },
    });
    const source = createPlayerSources({
      playerCore: {
        MAX_COMPRESSED: 32 * 1024 * 1024,
        validateOffer: (offer) => {
          if (fault === 'offer') throw Error('Invalid report history offer.');
          return offer;
        },
        hash: async () => hash,
        decode: async () => {
          throw Error(guidance[1]);
        },
      },
    });
    const expected = {
      offer: ['Invalid report history offer.', 'contract_changed'],
      decode: [guidance[1], 'normalization'],
      declared_size: ['The source response exceeds its size limit.', 'oversized_response'],
      stream_size: [
        'Player history exceeds its size limit; nothing was replaced.',
        'oversized_response',
      ],
    }[fault];
    await assert.rejects(source.readReport('https://fixture.invalid/report/'), (error) => {
      assert.equal(error.message, expected[0]);
      assert.equal(diagnosticError(error).reason, expected[1]);
      return true;
    });
  }
});
test('client deadlines, body deadlines, network errors and caller cancellation differ', async () => {
  const short = { any: AbortSignal.any.bind(AbortSignal), timeout: () => AbortSignal.timeout(5) },
    hold = setTimeout(() => {}, 1000);
  try {
    for (const fetch of [
      async (_u, { signal }) =>
        new Promise((_r, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
      async () =>
        new Response(new ReadableStream(), { headers: { 'Content-Type': 'application/json' } }),
    ]) {
      const source = await sourceFixture(fetch, undefined, short);
      await assert.rejects(
        source.readMaishift({}),
        (e) => diagnosticError(e).reason === 'client_timeout',
      );
    }
    const network = await sourceFixture(async () => {
      throw new TypeError('PRIVATE CORS guess');
    });
    await assert.rejects(network.readMaishift({}), (e) => diagnosticError(e).reason === 'network');
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      network.readMaishift({}, { signal: controller.signal }),
      (e) => e.name === 'AbortError' && diagnosticError(e) === null,
    );
  } finally {
    clearTimeout(hold);
  }
});
test('import failures preserve the saved dataset and produce one typed terminal', async () => {
  for (const reason of REASONS.filter(
    (r) =>
      ![
        'none',
        'cooldown',
        'older_snapshot',
        'not_prepared',
        'no_matches',
        'insufficient_coverage',
      ].includes(r),
  )) {
    const rows = [],
      f = makeSession({ initial: dataset(), diagnose: (r) => rows.push(r) });
    await f.owner.ready;
    rows.length = 0;
    f.ports.sources.readSource = async () => {
      throw new DiagnosticError('PRIVATE', reason, 'response');
    };
    await f.owner.importSource({ type: 'maishift', url: 'fictional' }, true);
    const terminal = rows.filter((r) => r.operation === 'import');
    assert.equal(terminal.length, 1, reason);
    assert.equal(terminal[0].reason, reason);
    assert.equal(f.owner.active.revision, 'one');
    assert.equal(f.calls.save, 0);
  }
});
test('manual and automatic refresh distinguish unchanged, changed, cooldown and failures', async () => {
  for (const manual of [true, false])
    for (const outcome of ['success', 'unchanged', 'skipped', 'failed']) {
      const rows = [],
        f = makeSession({
          initial: dataset(),
          source: connection(),
          diagnose: (r) => rows.push(r),
        });
      await f.owner.ready;
      rows.length = 0;
      if (outcome === 'unchanged')
        f.ports.sources.readSource = async () => ({ data: dataset(), source: connection() });
      if (outcome === 'skipped') f.ports.storage.claim = async () => null;
      if (outcome === 'failed')
        f.ports.sources.readSource = async () => {
          throw new DiagnosticError('PRIVATE', 'worker_timeout', 'response');
        };
      await f.owner.refresh(manual);
      const terminal = rows.filter((r) => r.operation === 'refresh');
      assert.equal(terminal.length, 1);
      assert.equal(terminal[0].outcome, outcome);
      assert.equal(terminal[0].mode, manual ? 'manual' : 'automatic');
      if (outcome !== 'success') assert.equal(f.owner.active.revision, 'one');
    }
});
test('superseded imports emit no failure and committed data retains success across navigation', async () => {
  const rows = [],
    f = makeSession({ diagnose: (r) => rows.push(r) });
  await f.owner.ready;
  const wait = deferred();
  f.ports.sources.readSource = () => wait.promise;
  const pending = f.owner.importSource({ type: 'maishift', url: 'fictional' }, true);
  await new Promise((r) => setTimeout(r, 0));
  f.owner.cancel();
  wait.resolve({ data: dataset('two'), source: connection('two') });
  await pending;
  assert.equal(rows.filter((r) => r.operation === 'import').length, 1);
  assert.equal(rows.find((r) => r.operation === 'import').outcome, 'superseded');
  rows.length = 0;
  const save = f.ports.storage.save;
  f.ports.storage.save = async (...args) => {
    const token = await save(...args);
    f.owner.cancel();
    return token;
  };
  await f.owner.importFile(file(dataset('three')));
  assert.equal(rows.filter((r) => r.operation === 'import').length, 1);
  assert.equal(rows.find((r) => r.operation === 'import').outcome, 'success');
  assert.equal(f.state.active.revision, 'three');
});
test('restore failure stages and storage quota/denial never expose values or clear data', async () => {
  for (const [stage, configure] of [
    [
      'read',
      (p) => {
        p.temporary.getItem = () => {
          throw new DOMException('PRIVATE', 'SecurityError');
        };
      },
    ],
    [
      'decode',
      (p) => {
        p.core.decode = async () => {
          throw Error('PRIVATE');
        };
      },
    ],
    [
      'reconcile',
      (p) => {
        p.core.reconcile = async () => {
          throw Error('PRIVATE');
        };
      },
    ],
  ]) {
    const rows = [],
      f = makeSession({ initial: dataset(), diagnose: (r) => rows.push(r), configure });
    await f.owner.ready;
    const failed = rows.find((r) => r.operation === 'restore' && r.outcome === 'failed');
    assert.equal(failed.stage, stage);
    assert(f.state.active);
    assert(!JSON.stringify(rows).includes('PRIVATE'));
  }
  for (const [name, reason] of [
    ['QuotaExceededError', 'storage_quota'],
    ['SecurityError', 'storage_denied'],
  ]) {
    const rows = [],
      f = makeSession({ diagnose: (r) => rows.push(r) });
    await f.owner.ready;
    f.ports.storage.save = async () => {
      throw new DOMException('PRIVATE', name);
    };
    await f.owner.importFile(file(dataset()));
    assert(rows.some((r) => r.operation === 'storage' && r.reason === reason));
    assert(rows.some((r) => r.operation === 'import' && r.reason === reason));
  }
});
