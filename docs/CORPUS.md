# Corpus preparation and recovery

Production remains on the separately accepted Maishift hotfix. These commands prepare local review candidates; none publish, change account settings, or operate on player data.

The installed application follows retained inputs → verified source captures → canonical decisions and independent coverage checkpoint → prepared catalog → browser/SEO assets → release receipt. Owner `scripts/update_catalog.py` and the historical analysis commands delegate to installed preparation services. Python installation and offline preparation require no Node runtime.

## Command family

```
maimai-chart corpus prepare --store CACHE/updates --previous-browser RETAINED/browser --previous-public RETAINED/public --registry ACCEPTED/registry --package RETAINED/package --reviews config/coverage-reviews.json
maimai-chart corpus resume --from CACHE/updates/runs/ATTEMPT
maimai-chart corpus replay --from CACHE/updates/runs/ATTEMPT
maimai-chart corpus inspect --run CACHE/updates/runs/ATTEMPT
maimai-chart corpus inspect --run CACHE/updates/runs/ATTEMPT --identity song:CANONICAL-ID
maimai-chart corpus inspect --run CACHE/updates/runs/ATTEMPT --workbench CACHE/review/workbench.html
maimai-chart corpus diff CACHE/updates/runs/BEFORE CACHE/updates/runs/AFTER
maimai-chart corpus verify --run CACHE/updates/runs/ATTEMPT
```

Use the approved per-project DevCache locations on Windows. `prepare` and `resume` are offline unless `--online` is supplied. `replay` is always offline, requires a complete capture receipt, and verifies the original starting state and policy. Provider acquisition cannot run merely because a cached source is unavailable. Supply the actual retained inputs; do not download production pages and treat them as a complete source package.

Owner-script attempts also bind the compiler, configuration, registry seed and policy files in their source checkout. Use `--source-root EXACT/producer/checkout` with `resume`, `replay` or `verify` for these attempts. The installed command and owner wrapper calculate that identity through the same packaged service. Omitting the checkout does not downgrade the check; a mismatching packaged identity is rejected. Attempts created by the installed command require no source checkout.

Each attempt records exact input inventories and a predecessor reference. Resume creates a new attempt; it never edits its predecessor. Changed inputs, changed producer policy, stale review assertions, or tampered receipts block reuse. A policy change requires a new preparation or the existing explicitly reviewed capture-reassessment workflow. A completed coverage checkpoint remains usable even when packaging or the 20,000-file publication guard subsequently fails. Neither a checkpoint nor `corpus verify` advances publication pointers.

An interrupted writer leaves its existing lease semantics intact. Inspect the process and `writer.lock` before owner recovery; no command silently breaks another writer's lock. Inspect `state.json`, `diagnostics.jsonl`, and the referenced evidence to locate the failed stage. Expected provider failures remain bounded outcomes in the capture and coverage receipts; integrity and programming failures stop the attempt.

## Evidence and the workbench

The workbench is generated outside immutable runs and has no save, promote, fetch, or publish operations. It uses accepted registry records, observations, mappings, artwork decisions, coverage conflicts, source audits, change reports, and stage diagnostics. Record explanations distinguish source assertions from explicitly retained legacy admission evidence. A source assertion is not proof that its capture bytes were verified during inspection: the view labels that distinction and integrity verification remains a separate operation.

Canonical view identity excludes operational timestamps, durations and stage status. Diagnostics contain finite local stage/outcome codes, counts, evidence filenames, and recovery instructions; raw provider messages, credentials and private inputs are excluded. The workbench embeds escaped data, blocks network connections and forms, and never loads remote artwork. Its derived indexes are not an additional registry.

## Validation

`python scripts/check_corpus_boundaries.py` runs strict mypy checks at the extracted corpus and preparation surfaces, then measures each extracted pure decision module independently and requires at least 95% branch coverage. Other legacy Python internals are not claimed to be fully type checked. Invariant tests enumerate every source-mode combination and reject changed base/policy/review reuse. Offline integration tests exercise interruption, resumption, tampering, immutable publication state, and safe workbench rendering.

The gate uses pinned development-only mypy and coverage packages; the application still has no new runtime dependency. Existing whole-system, contract, browser, visual and reproducibility acceptance remains required before release.
