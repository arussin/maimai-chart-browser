# Accepted planning refinements

These refine the original handoff. The integrated design adds the recorded Maishift base, architecture boundaries and legacy-asset capacity gate.

# Sustainable coverage on the Maishift launch baseline

## 1. Baseline and development workflow

Implement the full original handoff using the pending Maishift launch as its dependency.

The current checkout is already on `codex/maishift-proxy` at `cfb26ee`, incorporating current remote `main` (`98d1cc8`). However, substantial launch changes remain staged, with additional working-tree edits. The recorded hosted pilot includes changes beyond HEAD. This inspection updated the design baseline; it did not change the checkout or run tests.

- Have the Maishift task checkpoint its intended launch source, preserving unrelated work. A committed checkpoint is sufficient; this feature does **not** need to wait for every general-release gate.
- Create `codex/sustainable-coverage` from that exact checkpoint after the existing task releases the checkout. If Maishift remains unmerged, treat this as a dependent branch with its review diff based on Maishift. After Maishift merges, update against `main` and repeat affected integration checks.
- Do not commit another task’s staged work, switch its active checkout, or create an unapproved parallel source copy.
- Record the dependency commit and input hashes. Recheck them before implementation and final validation; changes to relevant launch interfaces require reconciliation.
- Update `AGENTS.md` to require feature branches, explicit dependencies, one writer per checkout, scoped commits, review against the correct base, and validation of the exact delivered candidate. Merging and deployment remain separate authorized actions.

Preserve the merged filter, MAGiCAL, genre, regional-availability, localization, and latest-versus-historical URL changes.

## 2. Extend the launch’s existing identity and player contracts

The launch retains portable player/handoff version 1, provider-separated mappings, and the existing persistent registry. It adds adapter-v2 rating enrichment, connection metadata, isolated pilot storage, and shared version artwork. Build on those contracts.

**Persistent enrichment**

- Keep the existing six-table registry and UUID identities. Add optional, versioned enrichment records to existing song/chart entries, with explicit validation, rather than creating another identity database.
- Store artwork selections and history on songs; provider outcomes on charts; source evidence in the existing source ledger. Keep scheduling and review progress outside accepted identity state.
- Add `present`, `intentional_blank`, and `missing` title classification with evidence. Preserve raw titles exactly, including U+3000. Empty or corrupt fields do not automatically establish intentional blanks.
- Implement an idempotent migration from verified retained artwork through existing song identities and redirects. Preserve bytes, hashes, available provenance, and historical references; report unavailable historical evidence.
- Remove artwork’s dependence on analyzed-chart `legacy_identity` in both projection and package reuse. Enrichment must neither require nor manufacture transcription hashes, profiles, or analysis qualification.

**Kamaitachi reconciliation**

- Resolve the approved public metadata source to one immutable revision per online run and capture songs/charts from that same revision.
- Validate schemas, references, uniqueness, hashes, and meaningful count changes. Invalid or suspicious snapshots retain last-known-good mappings and generate explicit review outcomes.
- Revalidate accepted relationships first. Upstream disappearance preserves historical aliases; contradictory reassignment blocks candidate readiness.
- Accept new mappings only through a proven scoped identity bridge or a unique complete title/artist/format/difficulty match on both sides.
- Bind credit exceptions to the exact provider, source identity, assertions, and evidence. Maishift decisions can inform investigation but do not automatically authorize Kamaitachi matches.
- Support truthful `policy_exact` acceptance throughout registry validation, package/startup projection, Python integration, and browser consumption.
- Persist accepted, absent, ambiguous, conflicting, failed-refresh, and deferred outcomes. Separate freshness from the usability of retained mappings.

**Player and display behavior**

- Extend the launch’s provider-aware lookup with explicit mapping status. Preserve provider namespaces, regional identity, imported IDs, and retained records.
- Show “No recorded PB” only when an applicable mapping exists without a record. Unmapped charts remain unknown in filters and sorting.
- A newly accepted mapping must reveal a retained synthetic PB on reload without reimport or rewritten history. Explicit historical releases retain their original mappings.
- Preserve Maishift’s rating-only enrichment, correction rules, unknown measurements, transactional refresh, Forget behavior, and pilot/main-site storage isolation. No additional player schema or IndexedDB migration is required.
- Use shared title-display helpers and four-language accessible labels across cards, search, comparisons, artwork, and existing generated-page consumers. Display labels never become matching identities.
- Do not implement the separate SEO/logging work or alter Maishift’s rollout gates.

## 3. Durable artwork and common rebuild orchestration

**Artwork waterfall**

- Start from every accepted song, including metadata-only, regional, and historical entries. Reuse verified retained selections first.
- Acquire gaps from verified Japanese/International song-image references, then the main jacket on an identity-verified Wiki page. Other sources require explicit approval.
- Share Wiki discovery, captured pages, and accepted relationships with the existing waterfall. Artwork-only gaps must schedule work even when numeric metadata is complete.
- Select the song metadata table’s jacket, not social-preview icons, banners, related-song art, or arbitrary images. Ambiguous editions remain unresolved.
- Preserve regional/edition distinctions and selection history. Reconsider artwork when relevant evidence changes; do not oscillate between providers.
- Reuse the launch’s shared `public-artwork` manifest and version-logo preparation. Keep existing default song paths compatible; add compact optional regional song selections without restoring the MAGiCAL runtime exception.
- Enforce approved origins/paths, private-network blocking, restrictive redirects, bounded bytes/time/concurrency, decoded-image limits, and content validation. Reject malformed responses and known placeholders without rejecting legitimate minimalist art.
- Retain original and converted hashes, dimensions, policy version, evidence binding, availability, and attribution. Serve content-addressed thumbnails locally; no browser hotlink fallback.

**Rebuilds and progress**

- Run the common coverage stage during full-source preparation, accepted-package/metadata-only preparation, and `refresh`.
- Route supported legacy preparation through its accepted registry or compatible seed. Require an explicit registry when an input cannot be safely bound; never silently retain a frozen online path.
- Offline rebuild validates and reuses accepted state without network. Exact replay uses only receipt-bound starting state, captures, assets, configuration, and work selections.
- Persist a bounded queue. Retain the existing 300-page Wiki budget, reserving one-third for the oldest eligible unresolved work; spare capacity passes between groups.
- Use reason-specific expiry/backoff, honor Retry-After, and invalidate relevant negatives after source or policy changes. A failed parser or request never establishes upstream absence.
- Deduplicate review items by identity, candidate, evidence, and policy. Preserve reviewed decisions and surface stale assertions.
- Separate check times from observation times. Reuse unchanged captures, conversions, and analysis caches.
- Persist progress atomically after successful preparation. Preserve locks, failed-run evidence, and publication-pointer semantics.

**Readiness**

Bind policies, configuration, selected inputs/assets, next accepted registry, and work selections into readiness verification. Write `ready.json` last.

Reject conflicting mappings, invalid assets, tampered inputs, and unexplained losses of accepted identity-level coverage. Denominator growth alone is not regression. Optional outages warn and retain verified data.

## 4. Acceptance tests and performance

Use deterministic upstream fixtures and synthetic personal data. Exercise actual preparation, projection, packaging, startup loading, and browser consumption.

Required scenarios:

- Metadata-only song gains artwork and mappings without fabricated analysis.
- Migrated enrichment survives saved-state reload, metadata-only refresh, package reuse, and offline rebuild.
- Provider snapshot N leaves a gap; N+1 resolves it and exposes a previously retained synthetic PB.
- Changed credit assertions invalidate exceptions; duplicate titles, editions, STD/DX, and absent difficulty slots never produce false joins.
- Null, absent, empty, whitespace, intentional U+3000, and unrelated blank-title songs remain distinct.
- Official-image failure reaches verified Wiki fallback; wrong editions, unrelated images, malformed data, placeholders, and unsafe URLs fail safely.
- Outages, 404, 429, schema drift, and conflicting provider IDs retain valid data and produce correct outcomes.
- Queues exceeding one build’s budget advance despite new arrivals.
- Unchanged builds avoid duplicate acceptance, review, conversion, or reanalysis.
- Exact replay ignores newer cached bytes and reproduces semantic selections and content-addressed payloads.
- Historical URLs/releases, player files, aliases, integration exports, and Maishift behavior remain compatible.
- Policy/state/asset tampering invalidates readiness.
- Four-language narrow-layout, accessibility, filtering, sorting, image-failure, and privacy checks pass.

Add launch-specific regression coverage for adapter-v2 rating enrichment, zero invented PB history, provider/region isolation, pilot/main-site storage separation, shared version logos, and latest-versus-pinned release navigation.

Measure checkpoint code and new code against the same dataset, then measure the enriched candidate separately. Use five alternating cold and five warm runs per configuration, recording startup, interactions, transfer sizes, requests, long tasks, and offscreen loading.

Preserve existing performance assertions, payload limits, single catalog parse, initial 40-row rendering, deferred artwork/details, request deduplication, and hosting guards. Verify unchanged analysis/profile hashes during metadata-only runs.

## 5. Delivery and boundaries

- Rebaseline the live default release, accepted retained inputs, and committed launch source separately; do not treat an older archived package as the current source baseline.
- Restore or reuse only verified required inputs in DevCache. Use current development wrappers and retain the selected evidence needed for review.
- Produce before/after coverage using unique persistent charts for mappings and unique songs or explicitly defined variants for artwork. Include additions, removals, replacements, unchanged, retained-on-failure, remaining, and deferred counts with regional/historical denominators.
- Demonstrate bounded live preparation, unchanged repeat, metadata-only refresh, package reuse, offline rebuild, and exact replay. Keep live-source limitations separate from deterministic test results.
- Preserve the launch’s published pilot assets and routes in candidate composition where applicable. Do not run its deployment or live-player test tooling.
- Deliver the focused patch, compatible migration, tests, documentation, updated agent instructions, exact commands and identities, performance measurements, repeated-build evidence, and a checklist covering the entire original handoff.
- Explain unresolved absences, conflicts, unsupported sources, deferred work, missing provenance, and anything unverified.

Finish with a validated review candidate. Do not merge, deploy, access or resync private player reports, enable Maishift generally, create schedules, alter automation states, or change backup/migration settings.
