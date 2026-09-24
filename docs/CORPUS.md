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
maimai-chart corpus inspect --run CACHE/updates/runs/ATTEMPT
maimai-chart corpus inspect --registry RETAINED/registry --workbench CACHE/review/registry.html
maimai-chart corpus inspect --run CACHE/updates/runs/ATTEMPT --identity song:CANONICAL-ID
maimai-chart corpus inspect --run CACHE/updates/runs/ATTEMPT --workbench CACHE/review/workbench.html
maimai-chart corpus diff CACHE/updates/runs/BEFORE CACHE/updates/runs/AFTER
maimai-chart corpus verify --run CACHE/updates/runs/ATTEMPT
```

Use the approved per-project DevCache locations on Windows. `prepare` and `resume` are offline unless `--online` is supplied. `replay` is always offline, requires a complete capture receipt, and verifies the original starting state and policy. Provider acquisition cannot run merely because a cached source is unavailable. Supply the actual retained inputs; do not download production pages and treat them as a complete source package.

Owner-script attempts also bind the compiler, configuration, registry seed and policy files in their source checkout. Use `--source-root EXACT/producer/checkout` with `resume`, `replay` or `verify` for these attempts. The installed command and owner wrapper calculate that identity through the same packaged service. Omitting the checkout does not downgrade the check; a mismatching packaged identity is rejected. Attempts created by the installed command require no source checkout.

Each attempt records exact input inventories and a predecessor reference. Resume creates a new attempt; it never edits its predecessor. Changed inputs, changed producer policy, stale review assertions, or tampered receipts block reuse. A policy change requires a new preparation or the existing explicitly reviewed capture-reassessment workflow. A completed coverage checkpoint remains usable even when packaging or the 20,000-file publication guard subsequently fails. Neither a checkpoint nor `corpus verify` advances publication pointers.

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
