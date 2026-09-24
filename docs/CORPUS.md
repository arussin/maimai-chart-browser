# Corpus preparation and recovery

Production remains on the separately accepted Maishift hotfix. These commands prepare local review candidates; none publish, change account settings, or operate on player data.

The installed application follows retained inputs → verified source captures → canonical decisions and independent coverage checkpoint → prepared catalog → browser/SEO assets → release receipt. Owner `scripts/update_catalog.py` and the historical analysis commands delegate to installed preparation services. Python installation and offline preparation require no Node runtime.

## Catalog handoff

`build_browser` returns the browser preview location and its prepared `CatalogDocument`.
The document owns one detached catalog model, its encoded bytes, and the integration
projection prepared once. `prepare_update` passes it to the existing public-release
planner. The planner verifies that its reference matches the browser manifest and
consumes the structured model without rereading the current catalog or integration
files. Browser shell/assets and retained historical catalogs are still verified.

`build_lab` keeps its historical Path-returning API as a thin wrapper. Directory-only
release callers validate/decode retained bytes into the same document and use the
same projection/rendering implementation. Validation and encoding live in the installed
package; no owner-script or Node runtime dependency is introduced.

The Python model is read-only by ownership contract, not recursively frozen. Renderers
must not mutate it. Tests compare the complete outputs of both input paths, check that
rendering leaves the model unchanged, reject forged references and invalid external
bytes, and prohibit the current-run serialization round trip. This completes this
handoff; it does not claim every upstream corpus stage has finished its type migration.

## Command family

```
maimai-chart corpus prepare --store CACHE/updates --previous-browser RETAINED/browser --previous-public RETAINED/public --registry ACCEPTED/registry --package RETAINED/package --reviews config/coverage-reviews.json
maimai-chart corpus resume --from CACHE/updates/runs/ATTEMPT
maimai-chart corpus replay --from CACHE/updates/runs/ATTEMPT
maimai-chart corpus reassess --from CACHE/updates/runs/ATTEMPT
maimai-chart corpus inspect --run CACHE/updates/runs/ATTEMPT
maimai-chart corpus inspect --registry RETAINED/registry --workbench CACHE/review/registry.html
maimai-chart corpus inspect --run CACHE/updates/runs/ATTEMPT --identity song:CANONICAL-ID
maimai-chart corpus inspect --run CACHE/updates/runs/ATTEMPT --workbench CACHE/review/workbench.html
maimai-chart corpus diff CACHE/updates/runs/BEFORE CACHE/updates/runs/AFTER
maimai-chart corpus verify --run CACHE/updates/runs/ATTEMPT
```

Use the approved per-project DevCache locations on Windows. `prepare` and `resume` are offline unless `--online` is supplied. `replay` is always offline, requires a complete capture receipt, and verifies the original starting state and policy. Provider acquisition cannot run merely because a cached source is unavailable. Supply the actual retained inputs; do not download production pages and treat them as a complete source package.

Owner-script attempts also bind the compiler, configuration, registry seed and policy files in their source checkout. Use `--source-root EXACT/producer/checkout` with `resume`, `replay` or `verify` for these attempts. The installed command and owner wrapper calculate that identity through the same packaged service. Omitting the checkout does not downgrade the check; a mismatching packaged identity is rejected. Attempts created by the installed command require no source checkout.

Each attempt records exact input inventories and a predecessor reference. Resume creates a new attempt; it never edits its predecessor. Changed inputs, changed producer policy, stale review assertions, or tampered receipts block reuse. A policy change requires a new preparation or explicit `corpus reassess` of verified retained evidence. A completed coverage checkpoint remains usable even when packaging or the 20,000-file publication guard subsequently fails. Neither a checkpoint nor `corpus verify` advances publication pointers.

After restoring inputs on another machine, `resume`, `replay`, and `verify` accept repeated `--input NAME=PATH` arguments. For example:

```
maimai-chart corpus resume --from CACHE/updates/runs/ATTEMPT --input previous-browser=RESTORED/browser --input package=RESTORED/package --input mai-notes-snapshot=RESTORED/links.json
```

Names refer to the original receipt's bound inputs; hyphens and underscores are equivalent. Every relative filename, byte count and hash must still match. Unknown, duplicate, missing, modified or additional inputs are rejected. This does not rewrite the predecessor or search for replacement data automatically. The new attempt records the restored locations and retains its predecessor hash. Store layout, source identity, review binding and publication checks still apply. Retained artwork/cache paths are not automatically relocated by this option.

New attempts also bind the legacy mai-notes snapshot timestamp once. Its provenance is explicitly labeled `legacy_file_mtime`, not a verified provider capture time. A restored file's different filesystem timestamp cannot alter replay output. Historical attempts without that observation cannot resume through this path and require a new preparation; their receipts are retained. The historical public link format is unchanged. This closes predecessor replay drift, not the broader migration of legacy capture timestamps out of canonical public data.

An interrupted writer leaves its existing lease semantics intact. Inspect the process and `writer.lock` before owner recovery; no command silently breaks another writer's lock. Inspect `state.json`, `diagnostics.jsonl`, and the referenced evidence to locate the failed stage. Expected provider failures remain bounded outcomes in the capture and coverage receipts; integrity and programming failures stop the attempt.

## Failure and completion semantics

`ready.json` is written only after receipt preparation and required terminal diagnostics
have succeeded. `state.json` remains an advisory operational record. A workbench view
reports `incomplete` when advisory state says ready but the receipt is absent, and
`inconsistent` when an existing receipt contradicts the recorded state. Receipt presence
is explicitly unverified until `corpus verify` checks it; inspection never publishes.

Explicit request/policy rejections use a ValueError-compatible `CorpusInputError`.
Known integrity, review and snapshot errors remain blocked outcomes. Plain ValueError
and other untyped exceptions stop preparation as `unclassified_error`, with investigation
guidance. They may be programming failures or legacy validators; the diagnostic does not
guess ownership from their class/message. Migrating all legacy validators is separate work.

A primary exception remains primary when diagnostics, failed-state persistence or lock
cleanup also fails. Finite `corpus.*_failed` exception notes identify secondary failures;
raw secondary messages are not copied to diagnostics. The installed corpus CLI reports
only the recognized finite secondary codes, omitting arbitrary exception notes. An initial or successful terminal
diagnostic write failure still aborts preparation. Input diagnostics include capacity,
retained inputs and attempt binding.

If the protected operation completed but removing `writer.lock` fails, `LockCleanupError`
(an OSError subclass) explicitly reports completed work with unfinished cleanup. A ready
candidate remains verifiable. Do not retry automatically: verify its output, establish
that no writer owns the lease using the existing owner recovery procedure, and inspect
the retained lock. No code checks PID liveness to break locks, changes lock permissions,
or removes a pre-existing lock. Interruption tests do not establish power-loss durability.

## Evidence and the workbench

Retained registries can also be inspected directly with `--registry`; these views explicitly say `retained_registry_only` and never masquerade as preparation or publication receipts. Each evidence table is indexed once, and common source assertions are stored once in the derived view.

The workbench is generated outside immutable runs and has no save, promote, fetch, or publish operations. It uses accepted registry records, observations, mappings, artwork decisions, coverage conflicts, source audits, change reports, and stage diagnostics. Record explanations distinguish source assertions from explicitly retained legacy admission evidence. A source assertion is not proof that its capture bytes were verified during inspection: the view labels that distinction and integrity verification remains a separate operation.

Canonical view identity excludes operational timestamps, durations and stage status. Diagnostics contain finite local stage/outcome codes, counts, evidence filenames, and recovery instructions; raw provider messages, credentials and private inputs are excluded. The workbench embeds escaped data, blocks network connections and forms, and never loads remote artwork. Its derived indexes are not an additional registry.

## Validation

`python scripts/check_corpus_boundaries.py` runs strict mypy checks at the extracted corpus and preparation surfaces, then measures each extracted pure decision module independently and requires at least 95% branch coverage. Other legacy Python internals are not claimed to be fully type checked. Invariant tests enumerate every source-mode combination and reject changed base/policy/review reuse. Offline integration tests exercise interruption, resumption, tampering, immutable publication state, and safe workbench rendering.

The gate uses pinned development-only mypy and coverage packages; the application still has no new runtime dependency. Existing whole-system, contract, browser, visual and reproducibility acceptance remains required before release.


## Reassessment after code changes

`corpus reassess --from STORE/runs/ATTEMPT` is a new offline attempt, not permission to
resume old computed decisions under a new producer name. It verifies the predecessor
receipt and unchanged complete input inventories, preserves the old implementation and
review assertions in the old receipt, and records `operation: reassess` with its hash in
the new predecessor reference. `resume` and `replay` still require the same implementation.
Input locations may be restored with the same `--input NAME=PATH` options. For an owner
attempt, `--source-root` must identify the current executing producer checkout, not an old
checkout supplied merely to satisfy a historical hash. It does not choose or load code.

Legacy package preparation recomputes from its bound package/snapshot and preserves its
recorded capture timestamp. Registry preparation verifies the completed candidate or
independent coverage checkpoint, all retained capture blobs, and accepted artwork before
recomputation. Even captures the new code never requests must pass their recorded hashes.
Capture URL bindings, coverage receipts, checkpoint files and policy references are checked.
The input check grants no publication authority and does not verify an old site's output
as a current candidate. `corpus verify` retains its strict producer/candidate checks.

Registry reassessment uses the original captured work set, observation time, reviews and
starting registry. It recomputes using the current policy and records `reassessment_of`
in its coverage input receipt. Changed input inventories, changed reviews, missing/tampered
evidence, an incompatible intermediate starting registry or requests for uncaptured URLs
block it. This is deliberately not arbitrary changed-base migration or online acquisition.
Changes requiring new evidence need a separate explicit preparation.

Reassessed coverage receives its own checkpoint before rendering. A rendering/capacity
failure preserves that completed coverage, and a later offline `resume` or `replay` under
the same producer can recover it. No command advances publication pointers. Artwork
conversion cache keys now include the coverage producer identity; old conversion receipts
remain intact, and a changed producer cannot reuse them as new conversions. Verified
accepted artwork keeps its existing selection/provenance and is not replaced automatically.

For offline recovery, retain exact bound inputs and the attempt's receipt files, immutable
capture blobs under `cache/waterfall/sources/blobs`, checkpoint directories under
`cache/coverage/checkpoints`, and their verified `cache/coverage/media` assets. These are
evidence despite the historical `cache` directory name. Mutable URL/conversion indexes
and derived browser/package/public output are not prerequisites for replay. Recovery
tests restore these records into a different temporary store, remove the original tree,
block sockets and compare complete generated public inventories. They also verify warm
conversion invalidation, tampering, checkpoint survival and resumption after render failure.
This proves a controlled fictional registry/package path on Windows, not a full-corpus
backup, revision-download recovery, canonical Linux reproduction or power-loss durability.


## Typed preparation and installed acceptance

The maintained application entry is `prepare_corpus(PreparationRequest)`. The
installed CLI normalizes arguments once through `preparation_request`; that
factory defaults to retained/offline inputs. Existing `prepare_update` Python
signatures remain compatibility adapters with their historical defaults.

`RegistrySource` and `LegacySource` select distinct input paths. Retained packages
and reviewed source revisions are separate types. Registry acquisition is an
explicit retained, online, replay or reassessment mode; only the latter two carry
a capture receipt. Receipt fields are derived from the executable request, with
redundant historical input bindings isolated for format compatibility.

Registry preparation has three explicit handoffs:

1. `capture_claims` returns captured claims and a single shared capture store.
2. `reconcile_evidence` returns the accepted/enriched registry after validated
   checkpoint persistence.
3. `project_corpus` returns `PreparedRegistry`, including its prepared package,
   coverage audit and optional complete refresh result.

Legacy preparation returns `PreparedLegacy`. Both supply the common package and
catalog fields to rendering and readiness. Registry-only fields are mandatory on
the registry result rather than independent optional fields. Existing JSON corpus
schemas retain their validators; typed stage ownership is not a claim that every
nested historical JSON record has been converted to a Python class.

Diagnostics identify claims, enrichment and projection separately. Library
refresh functions no longer print progress into the installed command's JSON
response; bounded counts and evidence references are in run diagnostics and
source audits. Ready receipts remain the final commit, after terminal diagnostics.

The owner source-root option must byte-match the executing Python packages before
it can identify a candidate. It cannot label a different installed package as the
requested checkout. Ordinary installed-only attempts keep their runtime identity.

Ordinary distribution tests compare a direct wheel with its sdist rebuild, then
execute fictional legacy and registry lifecycles from the wheel in an isolated
process. Checkout/report imports, network and product subprocesses are blocked.
The checks cover prepare, verify, resume, captured-source replay, failed rendering,
recovery, workbench output, tampering and mismatched producer roots. A retained-only
candidate without required source captures must reject captured replay; it cannot
invent missing evidence. Platform metadata is discovered before isolation because
Windows CPython may use its native version command during host identification.

These Windows fixture gates do not replace canonical Linux reproduction, complete
corpus verification, browser/performance acceptance or restricted hosted staging.
No preparation or acceptance command grants publication authority.


### Explicit supplemental metadata sources

The installed `prepare_corpus(request, sources=(registration, ...))` interface accepts
immutable `SourceRegistration(adapter, policy, parser_revision)` values. These add BPM
and chart-constant claims only; they cannot grant identity, mapping or regional-membership
authority. Builtin registrations cannot be overridden. Source URLs remain subject to
the existing capture allowlist. No executable adapter is loaded from a receipt.

Use `source_context(sources)` as the explicit `policy_context` when reading, inspecting,
verifying or continuing the resulting registry and attempt. The sorted source URL,
parser revision, allowed fields and policy binding are retained in attempt/checkpoint
receipts. A fresh process must supply the same registration and context. Existing public
callers retain builtin defaults.

`parser_revision` is declared by the caller; it is not an independently verified
hash of an external normalizer's executable bytes. The caller must retain that
adapter implementation and change its revision when its behavior changes.
Receipts compare the declared binding and packaged producer identity; they do
not automatically detect arbitrary changes to external adapter code.

Changed supplemental registrations are rejected for resume, replay **and reassessment**.
A new independently prepared base and coverage lineage is required; the migration
procedure for doing that from retained evidence is not yet accepted. Reusing the same
store is not a workaround for its bound checkpoint. Dual-context reassessment must
verify prior authority while recomputing a potentially changed pre-coverage base.
Earlier receipts remain intact and no base-integrity check is bypassed here. Existing
builtin changed-code reassessment is unchanged.
