/** Exact receipt binding for an explicitly derived recovery; no serving policy. */
import { createHash } from 'node:crypto';

const sha = (value) => createHash('sha256').update(value).digest('hex');
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
const digest = (value) => sha(JSON.stringify(canonical(value)));
const assert = (condition, message) => {
  if (!condition) throw Error(message);
};
const isDigest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const fingerprint = (value) =>
  value &&
  Object.keys(value).sort().join(',') === 'bytes,sha256' &&
  Number.isSafeInteger(value.bytes) &&
  value.bytes > 0 &&
  value.bytes <= 25 * 1024 * 1024 &&
  isDigest(value.sha256);

export function recoveryDerivation(receipt, receiptSHA) {
  assert(isDigest(receiptSHA), 'Derived recovery requires an explicit receipt hash');
  assert(
    receipt?.schema_version === 'maimai-release-assembly-1' &&
      receipt.status === 'complete' &&
      receipt.scope === 'local_file_assembly_only' &&
      receipt.plan?.target === 'recovery' &&
      receipt.plan.scope === 'declared_file_composition_only',
    'Derived recovery requires a completed recovery assembly',
  );
  const binding = receipt.derived_baseline,
    evidence = binding?.evidence;
  assert(
    evidence?.schema_version === 'maimai-derived-recovery-baseline-1' &&
      evidence.policy === 'cc5-bounded-chart-recovery-1' &&
      evidence.substitutions === 4 &&
      evidence.scope === 'derived recovery runtime; not byte-identical rollback',
    'Unsupported recovery derivation',
  );
  assert(
    isDigest(evidence.original_inventory_sha256) &&
      isDigest(evidence.derived_inventory_sha256) &&
      isDigest(evidence.shared_pagination_sha256) &&
      binding.original_inventory_sha256 === evidence.original_inventory_sha256 &&
      binding.evidence_sha256 === digest(evidence) &&
      receipt.plan.baseline_inventory_sha256 === evidence.derived_inventory_sha256 &&
      receipt.plan_sha256 === digest(receipt.plan) &&
      receipt.output_inventory_sha256 === digest(receipt.files),
    'Derived recovery receipt or inventory binding differs',
  );
  const original = evidence.original_runtime,
    derived = evidence.derived_assets;
  assert(
    original &&
      Object.keys(original).sort().join(',') === 'challenge-review.js,index.html,lab-loader.js' &&
      Object.values(original).every(fingerprint),
    'Derived recovery lacks exact original runtime identities',
  );
  assert(
    derived &&
      Object.keys(derived).length === 3 &&
      fingerprint(derived['index.html']) &&
      Object.entries(derived).every(
        ([name, row]) =>
          fingerprint(row) &&
          (name === 'index.html' || name === `browser-resources/${row.sha256}.js`) &&
          same(receipt.files?.[name], row),
      ),
    'Derived recovery assets differ from completed output',
  );
  const choices = new Map(receipt.plan.files.map((row) => [row.path, row]));
  assert(
    Object.entries(derived).every(
      ([name, row]) =>
        choices.get(name)?.owner === 'baseline' && same(choices.get(name)?.expected, row),
    ),
    'Derived recovery asset ownership differs',
  );
  return Object.freeze({
    receiptSHA,
    evidenceSHA: binding.evidence_sha256,
    original: structuredClone(original),
    derived: structuredClone(derived),
    originalInventorySHA: evidence.original_inventory_sha256,
    derivedInventorySHA: evidence.derived_inventory_sha256,
  });
}

export function derivedEntry(html, scripts, binding) {
  const expected = binding.derived['index.html'];
  assert(
    html.length === expected.bytes && sha(html) === expected.sha256,
    'Derived recovery document bytes differ',
  );
  const marker = '<meta name="maimai-recovery-runtime" content="cc5-bounded-chart-recovery-1">';
  assert(html.toString('utf8').split(marker).length === 2, 'Derived recovery marker differs');
  const selected = scripts.filter(
    (value) => value.startsWith('/') && Object.hasOwn(binding.derived, value.slice(1)),
  );
  assert(selected.length === 1, 'Derived recovery requires its exact single loader');
  return selected[0];
}

export function assertRecoveryBinding(baseline, rollback, binding) {
  assert(
    baseline.kind === 'legacy' && rollback.kind === 'legacy',
    'Recovery must use the legacy browser',
  );
  if (!binding) {
    assert(
      rollback.htmlSha256 === baseline.htmlSha256,
      'Rollback must serve the exact baseline document',
    );
    assert(
      rollback.runtimeSha256 === baseline.runtimeSha256,
      'Rollback must serve the exact baseline runtime entry',
    );
    return { kind: 'exact-baseline' };
  }
  for (const [key, source] of [
    ['html', 'index.html'],
    ['runtime', 'lab-loader.js'],
    ['bundle', 'challenge-review.js'],
  ]) {
    assert(
      baseline[key + 'Sha256'] === binding.original[source].sha256 &&
        baseline[key + 'Bytes'] === binding.original[source].bytes,
      'Original baseline differs from the recovery derivation',
    );
  }
  assert(
    rollback.htmlSha256 === binding.derived['index.html'].sha256 &&
      rollback.htmlBytes === binding.derived['index.html'].bytes,
    'Recovery document differs from the derivation',
  );
  for (const key of ['runtime', 'bundle']) {
    const expected = binding.derived[rollback[key + 'URL']?.slice(1)];
    assert(
      expected &&
        rollback[key + 'Sha256'] === expected.sha256 &&
        rollback[key + 'Bytes'] === expected.bytes,
      'Derived recovery runtime differs',
    );
  }
  assert(rollback.runtimeURL !== rollback.bundleURL, 'Derived loader and bundle must be distinct');
  return {
    kind: 'derived-baseline',
    receiptSHA: binding.receiptSHA,
    evidenceSHA: binding.evidenceSHA,
    originalInventorySHA: binding.originalInventorySHA,
    derivedInventorySHA: binding.derivedInventorySHA,
  };
}
