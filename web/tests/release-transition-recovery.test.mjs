import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  recoveryDerivation,
  derivedEntry,
  assertRecoveryBinding,
} from '../../tests/browser/release-transition-recovery.mjs';
import {
  inspectArtifact,
  readRecoveryDerivation,
} from '../../tests/browser/release-transition-server.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const digest = (value) => hash(JSON.stringify(canonical(value)));
const record = (raw) => ({ bytes: raw.length, sha256: hash(raw) });
const changed = (value) => structuredClone(value);

function fixture() {
  const originalBundle = Buffer.from('original bundle');
  const originalLoader = Buffer.from(
    `script.src='challenge-review.js?v=${hash(originalBundle).slice(0, 16)}';`,
  );
  const old = {
    'index.html': Buffer.from(
      `<html><head></head><body><script src="lab-loader.js?v=${hash(originalLoader).slice(0, 16)}"></script></body></html>`,
    ),
    'lab-loader.js': originalLoader,
    'challenge-review.js': originalBundle,
  };
  const bundle = Buffer.from('derived bundle'),
    bundlePath = `browser-resources/${hash(bundle)}.js`;
  const loader = Buffer.from(`script.src='/${bundlePath}';`),
    loaderPath = `browser-resources/${hash(loader)}.js`;
  const html = Buffer.from(
    '<html><head><meta name="maimai-recovery-runtime" content="cc5-bounded-chart-recovery-1">' +
      `</head><body><script src="/${loaderPath}"></script></body></html>`,
  );
  const original = Object.fromEntries(
    Object.entries(old).map(([name, raw]) => [name, record(raw)]),
  );
  const derived = {
    'index.html': record(html),
    [loaderPath]: record(loader),
    [bundlePath]: record(bundle),
  };
  const files = { ...original, ...derived };
  const evidence = {
    schema_version: 'maimai-derived-recovery-baseline-1',
    policy: 'cc5-bounded-chart-recovery-1',
    substitutions: 4,
    scope: 'derived recovery runtime; not byte-identical rollback',
    original_inventory_sha256: digest(original),
    derived_inventory_sha256: digest(files),
    shared_pagination_sha256: 'a'.repeat(64),
    original_runtime: original,
    derived_assets: derived,
  };
  const plan = {
    target: 'recovery',
    scope: 'declared_file_composition_only',
    baseline_inventory_sha256: digest(files),
    files: Object.entries(files).map(([path, expected]) => ({
      path,
      expected,
      owner: 'baseline',
    })),
  };
  const receipt = {
    schema_version: 'maimai-release-assembly-1',
    status: 'complete',
    scope: 'local_file_assembly_only',
    plan,
    plan_sha256: digest(plan),
    files,
    output_inventory_sha256: digest(files),
    derived_baseline: {
      original_inventory_sha256: digest(original),
      evidence_sha256: digest(evidence),
      evidence,
    },
  };
  const baseline = {
    kind: 'legacy',
    htmlSha256: hash(old['index.html']),
    htmlBytes: old['index.html'].length,
    runtimeSha256: hash(old['lab-loader.js']),
    runtimeBytes: old['lab-loader.js'].length,
    bundleSha256: hash(old['challenge-review.js']),
    bundleBytes: old['challenge-review.js'].length,
  };
  const rollback = {
    kind: 'legacy',
    htmlSha256: hash(html),
    htmlBytes: html.length,
    runtimeURL: '/' + loaderPath,
    runtimeSha256: hash(loader),
    runtimeBytes: loader.length,
    bundleURL: '/' + bundlePath,
    bundleSha256: hash(bundle),
    bundleBytes: bundle.length,
  };
  return {
    receipt,
    baseline,
    rollback,
    html,
    loaderPath,
    bundlePath,
    originalFiles: old,
    derivedFiles: {
      ...old,
      'index.html': html,
      [loaderPath]: loader,
      [bundlePath]: bundle,
    },
  };
}

test('without derivation both original byte equalities remain required', () => {
  const { baseline, rollback } = fixture();
  assert.deepEqual(assertRecoveryBinding(baseline, { ...baseline }, null), {
    kind: 'exact-baseline',
  });
  assert.throws(() => assertRecoveryBinding(baseline, rollback, null), /exact baseline document/);
  assert.throws(
    () => assertRecoveryBinding(baseline, { ...baseline, runtimeSha256: 'c'.repeat(64) }, null),
    /exact baseline runtime/,
  );
});

test('explicit completed derivation labels original and derived identities separately', () => {
  const { receipt, baseline, rollback, html, loaderPath } = fixture();
  const binding = recoveryDerivation(receipt, digest(receipt));
  assert.deepEqual(assertRecoveryBinding(baseline, rollback, binding), {
    kind: 'derived-baseline',
    receiptSHA: digest(receipt),
    evidenceSHA: receipt.derived_baseline.evidence_sha256,
    originalInventorySHA: binding.originalInventorySHA,
    derivedInventorySHA: binding.derivedInventorySHA,
  });
  assert.equal(derivedEntry(html, ['/old.js', '/' + loaderPath], binding), '/' + loaderPath);
  assert.notEqual(binding.originalInventorySHA, binding.derivedInventorySHA);
  receipt.derived_baseline.evidence.original_runtime['index.html'].bytes++;
  assert.equal(assertRecoveryBinding(baseline, rollback, binding).kind, 'derived-baseline');
});

test('missing, incomplete or wrong policy receipts are rejected', () => {
  const { receipt } = fixture();
  const mutations = [
    (value) => {
      value.status = 'incomplete';
    },
    (value) => {
      value.scope = 'hosted_verified';
    },
    (value) => {
      value.plan.target = 'candidate';
    },
    (value) => {
      value.plan.scope = 'unknown';
    },
    (value) => {
      delete value.derived_baseline;
    },
    (value) => {
      value.derived_baseline.evidence.policy = 'unknown';
    },
    (value) => {
      value.derived_baseline.evidence.substitutions = 3;
    },
  ];
  for (const mutate of mutations) {
    const value = changed(receipt);
    mutate(value);
    assert.throws(() => recoveryDerivation(value, digest(value)));
  }
  assert.throws(() => recoveryDerivation(receipt, null));
});

test('all canonical receipt, plan and inventory hashes are checked', () => {
  const { receipt } = fixture();
  for (const mutate of [
    (value) => {
      value.plan_sha256 = '0'.repeat(64);
    },
    (value) => {
      value.output_inventory_sha256 = '0'.repeat(64);
    },
    (value) => {
      value.derived_baseline.original_inventory_sha256 = '0'.repeat(64);
    },
    (value) => {
      value.derived_baseline.evidence_sha256 = '0'.repeat(64);
    },
    (value) => {
      value.plan.baseline_inventory_sha256 = '0'.repeat(64);
    },
  ]) {
    const value = changed(receipt);
    mutate(value);
    assert.throws(() => recoveryDerivation(value, digest(value)), /binding differs/);
  }
});

test('a rehashed receipt cannot remove a derived asset or change its owner', () => {
  const { receipt, bundlePath } = fixture();
  for (const mutate of [
    (value) => {
      delete value.files[bundlePath];
    },
    (value) => {
      value.plan.files.find((row) => row.path === bundlePath).owner = 'candidate';
    },
    (value) => {
      value.derived_baseline.evidence.derived_assets['outside.js'] = record(Buffer.from('bad'));
    },
    (value) => {
      delete value.derived_baseline.evidence.original_runtime['challenge-review.js'];
    },
  ]) {
    const value = changed(receipt);
    mutate(value);
    value.output_inventory_sha256 = digest(value.files);
    value.plan_sha256 = digest(value.plan);
    value.derived_baseline.evidence_sha256 = digest(value.derived_baseline.evidence);
    assert.throws(() => recoveryDerivation(value, digest(value)));
  }
});

test('actual original and derived observations must match all three files', () => {
  const { receipt, baseline, rollback } = fixture(),
    binding = recoveryDerivation(receipt, digest(receipt));
  for (const key of ['html', 'runtime', 'bundle']) {
    assert.throws(
      () =>
        assertRecoveryBinding({ ...baseline, [key + 'Sha256']: '0'.repeat(64) }, rollback, binding),
      /Original baseline/,
    );
    assert.throws(
      () => assertRecoveryBinding(baseline, { ...rollback, [key + 'Bytes']: 1 }, binding),
      /differs/,
    );
  }
  assert.throws(
    () => assertRecoveryBinding({ ...baseline, kind: 'modular' }, rollback, binding),
    /legacy/,
  );
  assert.throws(
    () => assertRecoveryBinding(baseline, { ...rollback, runtimeURL: '/outside.js' }, binding),
    /differs/,
  );
});

test('only receipt-bound document and one exact hashed loader are recognized', () => {
  const { receipt, html, loaderPath, bundlePath } = fixture(),
    binding = recoveryDerivation(receipt, digest(receipt));
  assert.throws(
    () => derivedEntry(Buffer.from('changed'), ['/' + loaderPath], binding),
    /document bytes/,
  );
  for (const scripts of [
    [],
    ['/' + loaderPath, '/' + loaderPath],
    ['/outside.js'],
    ['/' + loaderPath, '/' + bundlePath],
  ]) {
    assert.throws(() => derivedEntry(html, scripts, binding), /single loader/);
  }
  const noMarker = Buffer.from('page with missing marker');
  const synthetic = {
    ...binding,
    derived: { ...binding.derived, 'index.html': record(noMarker) },
  };
  assert.throws(() => derivedEntry(noMarker, ['/' + loaderPath], synthetic), /marker/);
});

test('bounded local receipt and actual artifact inspection preserve the original baseline', async () => {
  const value = fixture(),
    root = await mkdtemp(path.join(tmpdir(), 'recovery-binding-'));
  try {
    const baseline = path.join(root, 'original'),
      rollback = path.join(root, 'derived');
    for (const [directory, files] of [
      [baseline, value.originalFiles],
      [rollback, value.derivedFiles],
    ]) {
      for (const [name, raw] of Object.entries(files)) {
        const filename = path.join(directory, name);
        await mkdir(path.dirname(filename), { recursive: true });
        await writeFile(filename, raw, { flag: 'wx' });
      }
    }
    const receiptPath = path.join(root, 'receipt.json'),
      raw = Buffer.from(JSON.stringify(value.receipt));
    await writeFile(receiptPath, raw, { flag: 'wx' });
    assert.equal(await readRecoveryDerivation(undefined, undefined), null);
    for (const [filename, sha] of [
      [receiptPath, undefined],
      [undefined, hash(raw)],
      [receiptPath, '0'.repeat(64)],
    ]) {
      await assert.rejects(readRecoveryDerivation(filename, sha));
    }
    const binding = await readRecoveryDerivation(receiptPath, hash(raw));
    const original = await inspectArtifact(baseline, 'legacy');
    const recovered = await inspectArtifact(rollback, 'legacy', binding);
    assert.equal(assertRecoveryBinding(original, recovered, binding).kind, 'derived-baseline');
    assert.equal(
      original.runtimeURL,
      '/lab-loader.js?v=' + hash(value.originalFiles['lab-loader.js']).slice(0, 16),
    );
    await assert.rejects(
      inspectArtifact(rollback, 'legacy'),
      /recognized maintained browser entry/,
    );
    await writeFile(path.join(rollback, value.bundlePath), Buffer.from('tampered'));
    const changed = await inspectArtifact(rollback, 'legacy', binding);
    assert.throws(() => assertRecoveryBinding(original, changed, binding), /runtime differs/);
  } finally {
    assert((await realpath(root)).startsWith((await realpath(tmpdir())) + path.sep));
    await rm(root, { recursive: true, force: true });
  }
});
