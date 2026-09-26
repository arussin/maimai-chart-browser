# Codex handoff: sustainable identity, personal-score, and artwork coverage

Repository: `arussin/maimai-chart-browser`
Product: `maimai.party`
Scope: implement the agreed coverage improvements in the normal rebuild pipeline.
Handoff date: September 21, 2026.

## 1. Objective and authority

Implement a persistent, incremental enrichment stage that runs during every supported catalog rebuild. It must improve Kamaitachi personal-score mappings, correctly handle intentionally blank titles, and expand jacket coverage using verified official and Wiki sources.

Do not deliver only a plan, a list of manual corrections, or a one-time backfill. Inspect the actual checkout, implement the feature, test repeated rebuilds, and prepare a reviewable candidate. Initial reviewed exceptions are acceptable only when they become durable, source-scoped rules used by subsequent builds.

The required outcome is: **each rebuild accepts newly provable improvements, preserves verified results, advances deferred work, and explains everything still unresolved.** Never fabricate matches or images to reach an arbitrary percentage.

Preparation is not publication. Do not merge, deploy, create schedules, or change existing automation states under this handoff. Preserve the existing owner-controlled publication and verification workflow. Do not access or resync private player reports; synthetic profiles suffice for testing.

## 2. Workspace and preservation requirements

On Windows, first read `C:\Dev\general\development-layout-plan\MIGRATION-REGISTER.md`, then the checkout's `AGENTS.md`, `DEVELOPMENT.md`, and relevant nested instructions. Resolve the authoritative checkout and retained inputs from those records. Existing locations remain authoritative until individually accepted; do not recreate retired paths from old documentation or chats.

Ordinary source belongs in `C:\Dev`; per-project/worktree Python environments, package caches, bytecode, test/lint caches, `node_modules`, and disposable workspaces belong in `C:\DevCache`; shared toolchains belong in `C:\DevTools`. Do not use a global Python environment or junction/symlink dependencies into the source tree. Use the repository's development wrappers after inspecting them.

For Node tools requiring adjacent dependencies, use a disposable copy containing current tracked, uncommitted, and relevant untracked source. Edit only the authoritative source, regenerate the copy, and never copy changes back automatically. Other hosts use their approved local layout, not invented Windows mappings.

Preserve Git history, dirty files, unrelated work, accepted registries, published packages, source captures, selected artwork, audit evidence, and recovery copies. A directory named `output` or `cache` is not automatically disposable. Put newly selected durable evidence/results in the approved retained destination after review. Do not rewrite historical receipts to hide path changes.

Protected runtimes, credentials, private dependencies, and controls remain under the existing `C:\Protected` owner/privileged workflow. Preserve all automation holds, Uriel pause, runner/ChatGPT schedule states, Hasleo settings, and backups. This task does not authorize migration or backup changes.

## 3. Inspect and establish the baseline

Read the current implementations and their tests before editing. Important integration points identified in the investigation:

- Owner pipeline: `scripts/update_catalog.py`; `docs/CATALOG_UPDATES.md` and `docs/CATALOG_WATERFALL.md`.
- Persistent identities/projection: `registry/`; `src/maimai_intelligence/registry.py`, `registry_catalog.py`, `catalog_refresh.py`, and `catalog_identity.py`; `docs/REGISTRY_IMPLEMENTATION.md`.
- Acquisition/reuse: `catalog_capture.py`, `catalog_sources.py`, and `catalog_identity_aliases.json` under `src/maimai_intelligence/`.
- Provider mapping: `provider_mapping.py`, `scripts/update_provider_registry.py`, and the existing provider registry, provenance, and override assets.
- Jackets: `artwork.py`, `scripts/prepare_public_artwork.py`, and `assets/chart-artwork.js`.
- Personal UI/contracts: `assets/player-data.js`, `assets/player-data-core.js`, relevant locale files, `docs/PLAYER_DATA.md`, and `docs/PERFORMANCE.md`.

Reverify these paths and behavior against the actual working tree. Do not reset to an older commit or overwrite concurrent changes to match this handoff.

Earlier live inspection reported 7,251 chart identities, 1,694 song identities, 455 charts without personal mappings, and 269 songs without jacket mappings. Treat these as historical diagnostic leads, not current facts, test constants, or promised improvement counts. Recalculate from the live default release and the selected accepted local build, recording both identities and any differences.

Verify these specific leads:

1. Personal UI distinguishes an absent provider mapping from a mapped chart with no imported PB.
2. Original artwork/provider matchers discard normalized-empty titles.
3. The x0o0x_ song has an intentionally blank source title and needs identity-based handling, not a fabricated canonical title.
4. Provider credits can differ legitimately, such as `Junky` versus the expanded credit for オトヒメモリー☆ウタゲーション. Establish evidence before accepting equivalence.
5. Artwork acquisition has used Japanese metadata with one international image host; verify actual regional image references rather than guessing replacement URLs.
6. `project_registry()` and `_legacy_enrichment()` currently route artwork through legacy analyzed-chart identities. Remove this dependency in both projection and reuse; fixing only first-build output is insufficient.

Save a baseline audit and representative fixture cases before changing behavior.

## 4. Persist independent capabilities

Song identity, chart identity, and transcription identity have different responsibilities:

- Raw title, title classification, display label, artist, and jacket selection attach to the persistent song or explicitly supported regional/edition variant.
- Provider chart IDs attach to the persistent chart: song identity plus exact STD/DX, difficulty, and any supported distinguishing variant.
- Analysis remains attached to the selected, validated transcription revision.

Neither jackets nor personal mappings may require a transcription, demand profile, `legacy_identity`, or fabricated source hash. Conversely, receiving a jacket or provider link must not qualify a chart for analysis or recommendations.

Extend existing registry/package structures where practical. Add a small versioned enrichment table only where the existing contract cannot represent the required state. Avoid a second independent identity database.

Migrate existing verified artwork into persistent song-scoped records once, retaining provenance, bytes, source references, and old IDs/redirects. An accepted metadata-only song must retain its jacket through online refresh, metadata-only rebuild, offline rebuild, package reuse, and reload of the saved accepted state.

Preserve UUIDs, legacy/current provider aliases, song redirects, deep links, historical immutable releases, and the existing player-file/handoff contract. Do not regenerate the registry from scratch or admit new inventory just because an enrichment provider lists something. Official inventory admission remains its established workflow.

## 5. Reconcile Kamaitachi metadata on every online rebuild

### Acquisition

Use the approved public provider source already identified by repository configuration. Resolve the source revision once per online run and capture songs and charts from that same immutable revision. Record revision, hashes, schema checks, meaningful count changes, and matching-policy version.

This is a public metadata refresh, not permission to execute upstream code, install dependencies, follow arbitrary repositories, or change the separately reviewed transcription source pin. Validation/schema failures quarantine the candidate source and retain last-known-good mappings.

### Matching order

Retain accepted provider-ID relationships and historical aliases first. Validate them against fresh identity evidence when available. A missing row in a newer snapshot does not by itself erase a historical alias. A contradictory ID reassignment must be held and require correction/review before publication; never silently attach an old user's score to a different chart.

For unmapped charts, allow automatic acceptance only through a documented, scoped identity bridge or a unique complete title/artist/format/difficulty match without conflicting evidence. Check uniqueness on both sides. A numeric ID is evidence only within its proven provider/game namespace; shared digits across catalogs are not a bridge.

Reuse narrowly reviewed song/provider credit equivalences. Bind them to the source identity, exact assertions, and evidence. A valid song-level relationship may resolve all explicitly matching ordinary difficulty slots; it must not invent chart slots or conflate STD, DX, remixes, editions, or special variants.

Share safe normalization and discovery infrastructure, but keep purpose-specific acceptance policies. Do not broaden metadata/transcription qualification simply to make artwork or personal-score matching easier. Search aliases and fuzzy similarity are candidate-discovery aids, never sufficient acceptance evidence.

Metadata-only chart mappings use persistent chart identity; do not require the legacy matcher’s transcription hash as a universal prerequisite.

Record acceptance honestly, for example an explicitly validated `policy_exact` basis for automatic decisions and a reviewed basis for human decisions. Trace any schema change through registry validators, package projection, public mapping validation, browser consumers, and integration adapters. Never label an automated match as reviewed to evade a validator.

### Outcomes and UI

Persist specific outcomes: accepted, absent in a validated provider snapshot, ambiguous, identity conflict, failed refresh, or deferred. Separate source freshness from whether an accepted mapping remains usable. Do not report upstream absence based on a timeout or an incomplete snapshot.

Keep “No recorded PB” only for a mapped chart with no applicable imported record. Replace the opaque missing-link wording with a concise localized explanation such as “Personal-score linking not yet available for this chart,” with minimal explanatory help where useful. Never equate unresolved matching with “you have not played this chart.”

Verify personal filters and sorts do not silently treat unmapped charts as confirmed no-PB charts. Preserve local scores/history for later resolution without requiring reimport. A newly accepted current-release mapping should make a retained synthetic score visible on reload while old explicitly selected releases retain their original behavior.

## 6. Support intentional blanks without weakening identity checks

Represent title classification explicitly, for example `present`, `intentional_blank`, and `missing`, using the smallest compatible schema change. Preserve the exact raw title, including U+3000 where supplied. Display text must not become the canonical identity or be fed back into matching.

An intentional blank requires source evidence bound to the accepted song. It is not inferred from arbitrary empty strings, missing fields, or artist name alone. Distinct empty-title songs must remain distinct.

Provide one shared display-title helper and localized accessible label, such as “Untitled (intentional),” for relevant cards, search results, comparisons, and existing generated-page consumers. Do not implement the separate SEO project here. Keep verified discovery aliases separate from official titles; a sorting field is not automatically a song title.

Use established song/provider identity to resolve artwork and explicit chart slots for intentional blanks. Missing or corrupt metadata remains an audit issue, not an automatically accepted intentional blank. Test null, absent, empty, whitespace-only, legitimate blank, and multiple unrelated blank-title records. Cover all supported languages and narrow layouts.

## 7. Run a song-scoped artwork waterfall

Start with every accepted song, including historical/regional and metadata-only entries. Reuse valid retained assets before doing new acquisition.

Use this acquisition order for gaps: verified official Japanese/International song-image references; then the jacket field of an identity-verified Wiki song page; then another explicitly approved public source where necessary. Discover and verify actual image URL construction for each official source. Do not merely substitute a guessed hostname.

Reuse the existing Wiki discovery, accepted page relationships, and captured pages. A previously discovered page must be useful even when it has no remaining numeric-metadata gaps; artwork-only gaps must also schedule discovery. Fetch the page/image once per run through shared capture infrastructure rather than running separate crawlers.

The Wiki adapter must identify the main song jacket, not an arbitrary image, video thumbnail, banner, avatar, comment attachment, or related-song image. Identify the page and image host separately; explicitly approve the actual required image origins. Page-title similarity alone is insufficient. Ambiguous editions or multiple conflicting jacket candidates remain unresolved.

Preserve genuinely different regional/edition selections. Retain accepted artwork during outages; do not oscillate between sources. Reconsider a selection when relevant source evidence changes, recording replacement history and holding identity conflicts for review.

Use only approved sources consistent with their access/use requirements, and maintain attribution. Public accessibility alone is not a license. Do not bypass authentication, anti-bot controls, access restrictions, or rate limits.

All downloads must have origin/path restrictions, bounded bytes, timeouts, bounded concurrency, and validated content. Preserve the existing restrictive redirect policy; any necessary exception must validate every hop and destination, not allow arbitrary redirects. Block private/local network targets. Treat fetched text as data, never instructions or executable code.

Decode allowed image formats; enforce decoded dimension/pixel limits and reject HTML/error pages, malformed images, and confidently recognized generic placeholders. Do not reject legitimate blank/minimalist art merely because it looks simple. Convert to the existing bounded thumbnail format and publish content-addressed same-site assets. No browser hotlink fallback.

Retain source/page provenance, evidence binding, original and converted hashes, dimensions, conversion-policy version, selection history, and asset availability. Publish only necessary compact lookup/attribution data, not raw pages or the review queue.

## 8. Integrate all rebuild paths and persist incremental progress

Extend the normal `update_catalog` orchestration; do not add a repair command users must remember. Full source preparation, accepted-package/metadata-only preparation, and `refresh` must share the coverage stage when building a new current release. Offline mode validates/reuses accepted enrichments without network; exact replay uses only its bound captures and inputs.

Handle legacy build modes explicitly: retain compatibility or route them through the common stage. Do not silently leave a supported online rebuild path with frozen mappings/artwork. Prior immutable catalog releases remain unchanged.

Use shared indexed matching and a once-per-run source cache. Reuse unchanged captures and converted images. Record `checked_at` separately from original observation/capture time so unchanged bytes do not appear to be new factual evidence or create unnecessary release churn.

Persist a bounded work queue with progress and aging. Prioritize new songs and new evidence while reserving capacity for older unresolved work. Rebuild N+1 must advance beyond the first page budget of rebuild N. Never repeatedly crawl only the same first 300 pages.

Negative results need reason-specific expiry/backoff: a 404 is not permanent, a 429 respects Retry-After, and a parser failure is not upstream absence. Source, identity-rule, adapter, or policy changes can invalidate relevant negatives. Rejected/reviewed candidates retain fingerprints so unchanged evidence does not repeatedly demand review.

Keep scheduling/progress state separate from accepted identity state. Persist it atomically and record selected work in the run receipt so replay is deterministic. Failed preparation must not advance the accepted publication pointer or corrupt verified inputs.

Retain everything needed to reproduce accepted output: starting registry, package/browser identities, source/asset bytes and hashes, policy versions, configuration, and relevant work-selection state. Successful exact offline replay must not use newer cached bytes and must reproduce semantic selections and content-addressed public payloads; operational timestamps may differ outside those payloads.

Reuse analysis caches. A jacket, credit-equivalence, or provider-map improvement must not trigger unrelated chart reanalysis.

## 9. Coverage reporting and candidate gates

Extend the existing `report.md`, `changes.json`, and source audit. Include before, after, additions, removals, replacements, unchanged, retained-on-failure, remaining, and deferred results with exact denominators.

Count unique persistent chart identities for personal mapping, not duplicate provider aliases. Count unique songs or explicitly defined artwork variants for jackets, not difficulties. Recompute counts after migration/projection; do not carry stale legacy artwork coverage totals into the new release.

Break down current JP, current International, historical/not-currently-observed entries, and known release scopes. Do not infer removal from absence, or confuse a song's introduction version with the introduction of a later chart variant. Include source health and mutually understandable reasons for unresolved coverage.

Use a persistent deduplicated review queue keyed to identity, candidate, source evidence, and policy. Reviewed resolutions become reusable rules; stale/conflicting rules are surfaced, not silently broadened.

Gate the candidate on no unexplained loss of previously accepted identity-level coverage, no invalid asset references, and no conflicting provider assignments. Denominator growth alone is not a regression. Legitimate corrections/removals require narrow evidence-bound review, not a global ignore-regressions switch. Optional source outages should warn and retain good data, not erase it or block every otherwise valid rebuild.

Update readiness verification to bind every behavior-affecting policy/configuration file, source selection, next accepted enrichment state, and selected assets—not only code directories. Write `ready.json` last. Preserve writer locks, failed-run records, immutable receipts, publication verification, and `latest.json` semantics.

Keep private scores, player names, raw pages, failed candidate payloads, and detailed matching audits out of public assets and analytics. No runtime telemetry service is part of this task.

## 10. Required acceptance tests

Add deterministic fixtures to the relevant existing unit, integration, and browser suites. CI must not depend on live upstreams or private accounts.

| Scenario | Required result |
|---|---|
| New accepted song without transcription | Receives verified jacket and explicit provider mappings without fake analysis/hash/legacy identity. |
| Saved accepted state reused on successive builds | Enrichments survive metadata-only refresh, package reuse, and offline rebuild; no legacy round-trip loss. |
| New provider metadata on rebuild N+1 | Previously unresolved explicit chart maps automatically; retained synthetic PB appears without reimport. |
| Reviewed artist-credit equivalence | Resolves verified slots; changed assertions invalidate the rule; unrelated songs remain unmatched. |
| Intentional blank and corrupt/missing titles | Correct song maps and displays accessibly; missing titles and unrelated blank records cannot collide. |
| Same title, distinct artist/remix/edition/STD/DX | No false joins; aliases do not merge identities or infer absent difficulty slots. |
| Official jacket failure plus verified Wiki jacket | Fallback is acquired, packaged, attributed, and retained; HTML/ad/placeholder and wrong-edition candidates fail safely. |
| Source outage, 404, 429, schema drift, conflicting ID | Correct failure classification, bounded requests, retained valid data, and review/gates for dangerous contradictions. |
| Queue exceeds one run's budget | Later rebuilds progress through old deferred work despite new arrivals; retry/backoff and rule changes work. |
| Unchanged second build and exact replay | No duplicate acceptance/review churn, no repeated conversion/reanalysis, verified capture reuse, deterministic selected public content. |
| Compatibility and receipt tampering | Old URLs, provider aliases, player schema/handoff and historical bytes remain valid; policy/asset/state tampering invalidates readiness. |
| Browser behavior/privacy/performance | Localized states, PB filters/sorts, image failure UI and accessibility work; no new upstream browser requests or score leakage. |

Run source-content tests and actual projection/package tests, not just helper-unit tests. A unit-tested mapping is not delivered until it survives the startup/public integration projection and is consumed correctly by the personal UI.

## 11. Performance and compatibility acceptance

Preserve the repository's current capacity thresholds, single catalog parse, bounded initial rendering, deferred artwork/detail loading, request deduplication, and existing public/player compatibility. Do not raise budgets, remove assertions, or disable integrity checks to make the feature pass.

Compare old and new code with the same dataset to isolate implementation overhead, then measure the enriched candidate separately to expose the cost of additional working thumbnails/mappings. Use repeatable cold/warm runs and report startup, key interaction timings, transfer sizes, request counts, and relevant long tasks on comparable configurations.

Full evidence and review history must not be duplicated into the startup index or per difficulty. Use compact selected mappings and song-scoped artwork references. Additional valid art can add bytes; report the measured impact rather than promising literally zero cost. Require no material measured startup/interaction regression and no offscreen eager downloading.

Metadata-only fixtures must show unchanged analysis/profile hashes and reuse of analysis outputs. Integrate with already existing SEO/localization/import consumers only as required for compatibility; do not implement those separate projects or overwrite their in-progress work.

## 12. Delivery and definition of done

Deliver the actual patch, tests, compatible migration, updated runbook/source/attribution documentation, and a coverage report tied to exact baseline and candidate identities. Include a real bounded source-backed preparation where the authorized environment and retained inputs permit it; keep network-sensitive acceptance deterministic in CI.

Provide exact commands used, development-wrapper/workspace paths, passing/failing tests, performance measurements, the migrated-state round-trip/replay evidence, and before/after coverage with representative corrected cases. Identify remaining upstream absences, conflicts, unsupported sources, deferred work, and any unverified live assumptions. Do not claim a test, acquisition, deployment, or migration succeeded without its evidence.

The implementation should demonstrably fix representative blank-title, credit-difference, newly admitted metadata-only artwork, and official-to-Wiki fallback cases where evidence permits. Do not claim all 455 historical mapping gaps or all 269 historical artwork gaps are solvable, and do not hardcode those counts into tests.

Finish with PR-ready changes and a validated review candidate, not a deployment. Preserve unrelated work and explicitly reconcile all sections of this handoff before declaring completion. The result is not complete if it improves a first build but forgets those improvements on the next normal rebuild.

---

## Repository evidence behind this brief

The September 21 investigation used the current repository, including search results at revision `e2ee969c04c572e0e9ca1f04b11252ac384d78dc`. This is a provenance reference, not an instruction to check out or reset to that revision.

- `src/maimai_intelligence/registry_catalog.py`, `project_registry()` and `_legacy_enrichment()`: jacket projection and reuse through legacy identities.
- `src/maimai_intelligence/artwork.py`, `match_jackets()`: normalized title/artist matching and the configured official metadata/image sources.
- `src/maimai_intelligence/provider_mapping.py`, `build_mapping()` and `validate_mapping()`: existing matching and validation contracts.
- `src/maimai_intelligence/catalog_refresh.py`: current shared source acquisition and automatic `policy_exact` link acceptance.
- `docs/CATALOG_UPDATES.md` and `docs/CATALOG_WATERFALL.md`: normal rebuild, capture/replay, retained-state, and owner publication design.
- `DEVELOPMENT.md`, `AGENTS.md`, and `docs/PERFORMANCE.md`: development layout, scope preservation, and performance requirements.

Verify all implementation details against the checkout used for the actual work.
