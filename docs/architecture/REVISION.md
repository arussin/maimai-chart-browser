# Production revision and acceptance record

This document supersedes the initial implementation's architecture claims in
`IMPLEMENTATION.md`, `VALIDATION.md`, `PERFORMANCE.md`, and `COVERAGE_VALIDATION.md`.
Those documents retain useful historical evidence; their counts and asset names
describe the earlier candidate, not this revision. Final results and exact candidate
commits are recorded below, with unavailable hosted and CI gates kept explicit.

The baselines are registry `a47e8857197488b646585ae3b0d73c227e1742d9` and report
`5a1a7b8bbc16246a65f25c3d4abbd2580a389f94`. Public upstream was reconciled at
registry `67e377dc2a5a095e2fe05b331235fb679895a4bd` and report
`c4992ce14e3b5a0821e96a801c8cf925f60f41cf` before implementation. Existing linked
architecture checkouts are used; unrelated checkout and retention work is preserved.

## Ownership and maintenance

| Decision | Maintained owner | Boundary |
|---|---|---|
| Navigation intent and activation | `web/src/runtime/navigation.ts`, `intent.ts` | Generation tokens prevent late requests from committing; cancellation alone is insufficient. |
| Browser history | `runtime/history.ts` | Other modules use its port; navigation snapshots contain controls and public chart IDs, never private scores. |
| Browser controls and restoration | `runtime/browser-state.ts`, `position.ts` | Requested sorting survives delayed player readiness. New input cancels older restoration. |
| Catalog and details | `runtime/catalog.ts`, `verified-data.ts` | Bounded verified reads, one multipart reader, supported historical schemas, detached hydrated detail. |
| Player transactions | `runtime/import-coordinator.ts`, `player-session.ts` | Import/refresh/Forget ordering and private readiness stay separate from DOM rendering. |
| Existing rendering | `web/src/views` | Existing DOM/CSS and interaction semantics; no framework or layout redesign. |
| Finite usage | `usage.ts`, `usage-contract.ts` | Committed actions and page activations; typed names/details; no arbitrary metadata. |
| Browser composition | `web/build.mjs`, generated `browser-assets.json` | One imported application graph, hosted and offline entries. Python consumes verified packaged outputs without Node. |
| Catalog preparation | `catalog_preparation.py`, `catalog_loading.py` | Explicit projections; no full-object deletion projection or serialize/parse handoff. |
| Coverage | `coverage_policy.py`, `coverage_queue.py`, `coverage.py`, `coverage_store.py` | Pure decisions, bounded adapters, independent validated atomic checkpoints. |
| Report preparation | Report `preparation.py` and explicit player context | Prepare recommendations once; artwork and rendering consume the same prepared result. |
| Public contract tooling | Registry `contract_bundle.py` | Report consumes exact provenance-pinned developer tool bytes, separately from its runtime contract pin. |

The browser graph gate checks import cycles, state/history ownership, retired
service dependencies and factory inclusion. Python architecture tests walk deferred
as well as eager imports and check pure-module dependency closures. Source metrics
report authored code, generated code, tests, vendored contract code and locks
separately. Extracting a function into its proper layer is not counted as removing
that function's complexity.

Some small external entry adapters remain for the standalone explorer, support
pages and separate Maishift pilot. These are generated from the same maintained
modules. The old catalog reader is retained only as a byte-pinned test fixture at
`tests/fixtures/legacy-lab-loader.js`, excluded from distributable packages.
The publisher can still consume an already-built historical browser directory;
it does not carry another authored implementation of that browser.

## What constitutes evidence

- `scripts/run_offline_tests.py` denies non-loopback Python network activity and
  fails on caught attempts. Browser fixtures add a denying proxy underneath route
  mocks. The adversarial tests cover popups, redirects, frames, beacons and explicit
  route escapes. These are separate from performance measurements.
- `scripts/check_report_compatibility.py` runs the actual registry exporter and
  actual report consumer against a reviewed counterpart commit. Dirty-tree probes
  are labeled probes and cannot count as committed acceptance.
- `scripts/verify_reproducible_build.py` compares two independent offline wheels
  and source distributions, then builds a wheel from the source distribution.
  Missing offline browser dependencies make the full result incomplete, not passed.
- `scripts/run_canonical_reproduction.py` pins Linux image, Node archive, Python,
  and dependency acquisition. Builds run without network. Ordinary CI also builds
  on Windows and compares portable wheel member hashes across platforms.
- `scripts/measure_architecture.mjs` requires byte-identical catalogs and exact
  commits. It uses a local server and denying proxy with browser caching intact,
  alternating paired runs, raw measurements and distributions. It measures real
  DOM readiness, execution, transfer, search, comparison and restored Back state.
  Enrichment is a separate experiment. Local desktop numbers are not internet
  performance or Core Web Vitals claims.
- `scripts/measure_source.py` reads exact Git commits. It reports physical lines,
  duplicate Python bodies, eager/deferred import cycles, and per-function static
  complexity. Browser duplicate/factory evidence comes from the dependency graph.

## Safe release gates

This source change does not grant hosted publication readiness. Keep SEO, active
usage collection and verified owner reporting behind one coordinated launch gate.
Coverage checkpoints cannot change accepted registry/publication pointers.

1. Preserve the exact candidate commits, artifacts, input and asset hashes,
   counterpart pins, source-policy identities, final test receipts and source
   metrics in the release review. Complete the fictional isolated human preview.
2. Verify Cloudflare account entitlement, actual monthly cost and supported upload
   path before preparing a paid-capacity review. The default is 20,000 files;
   100,000 requires a fresh closed review bound to evidence hashes. The 25 MiB
   per-asset ceiling and 8 MiB parts remain. A review bundle above the default
   limit contains no deployable manifest and cannot advance readiness.
3. Prepare a distinct hosted staging Pages project, its separate D1 database and
   staging Worker entry. Review all base/preview/custom hostname access policies.
   Verify signed-out denial and owner access. Preserve production origin checks;
   staging uses explicit test adapters. Read-only account access must succeed
   before claiming any of these hosted properties have been verified.
4. Capture current immutable Pages deployment identity, Worker version/config,
   routes, bindings, enabled state and owner report baseline. Rehearse switching
   staging between previous and candidate artifacts, disabling collection and
   reverting Worker configuration while preserving accumulated totals. Recheck
   both databases and retain the rollback receipt. Local adapter tests do not
   substitute for this hosted rehearsal.
5. Review the production package, account changes and combined activation. After
   approval, verify the immutable deployment and custom domain, same-origin
   collector behavior, privacy opt-outs, independent emergency disables and a
   completed owner report. Never delete totals as part of rollback. A partial
   emergency disable is explicitly a degraded combined release.

Account provisioning, access-policy changes and production activation require the
owner-controlled workflow. They are not executed by the local validation tools.

References: [focused changes](https://google.github.io/eng-practices/review/developer/small-cls.html),
[Pages limits](https://developers.cloudflare.com/pages/platform/limits/),
[preview access boundaries](https://developers.cloudflare.com/pages/configuration/preview-deployments/).

## Final scorecard

The registry product candidate is `6f386b301aea22334805d699c98168f31cc6c819`;
the report candidate is `b7404227ac0b83558218dcbae529a34deb33bc4d`. Test-only `fb7e2ec` waits for initial lazy images before observing requests;
documentation follow-ups do not relabel earlier source receipts. Exact source archives, input
inventories and result hashes are retained in
`C:/Dev/maimai/architecture-revision-20260922/`; `SCORECARD.md` is the consolidated
human review, and each evidence subdirectory identifies its original candidate.
No branch was pushed and no deployment occurred during local preparation.

| Measure | Baseline | Revision | Evidence and limit |
| --- | ---: | ---: | --- |
| Verified jacket coverage | 1,443 / 1,694 (85.18%) | 1,561 / 1,694 (92.15%) | All 251 original gaps classified; 118 resolved, 14 ambiguous identities, 119 without a verified match. No manual matching exceptions. |
| Accepted provider mappings | 6,796 | 6,796 | All 455 gaps classified separately; artwork never authorizes score mappings. |
| Authored code, both repositories | 50,270 lines | 55,688 lines | +5,418 (+10.78%); generated output, tests, locks and vendored tooling counted separately. |
| Test source, both repositories | 26,664 lines | 30,445 lines | +3,781; not a line/branch coverage percentage. |
| Python import-cycle groups | Registry 2, report 1 | Both 0 | Includes deferred imports; eager-only baseline was already zero. |
| Active browser graph | Overlapping script/controller paths | 42 modules, zero cycles | Strict coordinator/state types, one history writer and state/session owner; generated hosted/offline entries. |
| Existing report output | 21 characterizations | All byte-identical | Every hash independently checked against original report `5a1a7b8`, using fictional inputs. |
| Python behavior | Earlier candidate evidence | Registry 644 tests; report 276 | Registry seven Windows symlink capability skips, report one; zero non-loopback attempts. |
| Developer contract compatibility | Separate tooling paths | Actual reciprocal consumer checks pass | Registry final6f against reportb740; reportb740 against its reviewed registryce569 pin. Runtime contract pin remains separate. |
| Windows package reproduction | No equivalent complete proof | Both repositories pass all six checks | Two independent wheels/sdists and sdist-to-wheel contents match; fixed seed and source stability verified. Linux/cross-OS CI remains pending. |

The four reproduced regressions have failing-before evidence. Additional review
caught programming exceptions swallowed by the actual capture layer and a
measured Back-restoration regression. Capture errors now distinguish expected
transport/schema failures from programming, integrity and persistence faults.
Back restoration projects owned state without rereading live scroll position
mid-render; cancellation and player/font/animation readiness remain intact.

All 97 planned OTOGE opportunities were resolved: 92 selected OTOGE and five used
higher-priority official International sources. The total additions also include
19 verified Wiki discoveries and seven official International jackets. LXNS
provided no eligible additions. All 1,690 prior regional/default selections and
bytes, 6,796 mappings, canonical identities, regional membership and accepted
analysis remain unchanged. The 292 metadata-only charts still contain no invented
analysis. The one bounded JP TLS request preserved certificate verification and
reported issuer verification code 20; the source cooldown prevents repetition.

Coverage replay after the capture correction uses source `137b539`; its eighteen
policy files must match final product6f byte for byte. Original captures, prior
checkpoints and producer identities remain intact. Repeated and resumed execution,
changed bases, stale reviews, offline caches and tampering are tested separately
from publication. Six captured-data batches do not promise live-provider uptime.

## Critical assessment and open acceptance

This is a substantive improvement in ownership, contract discipline, retry
fairness, reproducibility and verified artwork. It is also a broad migration with
material release risk. Authored code increased rather than decreased. Registry
Python mean complexity improved from 10.672 to 9.990 and its 95th percentile from
37 to 32; report mean improved from 6.563 to 6.383 and its 95th percentile from 20
to 19. Maximum function complexity did not improve. Publication planning increased
from 67 to 92 and catalog refresh from 94 to 101: both remain maintenance risks.
These metrics describe source, not defect probability.

A measured baseline check also found that clicking the static BPM button before
catalog initialization drops the click in both versions. The functional sorting
test now waits for catalog readiness; this pre-existing limitation is recorded,
not claimed fixed by changing a test. Settings and private imports have separate
checks proving they work while public catalog loading is delayed or fails.

The final browser matrix recorded 1,311 passes, five intentional skips and one
initial-image observation failure. Both recorded lazy requests preceded the tested
interaction. Test-only `fb7e2ec` fixes that observation boundary; all three layouts
and ten narrow repetitions passed the unchanged zero-new-request assertion. The
original full run remains preserved as a run with one failure. Strict TypeScript,
31 browser module tests, 13 usage-worker tests and 48 network audits passed.
All 288 unchanged-data visual assertions passed across three engines, four
languages and 320/768/1280px. Their baseline images and exact source/input hashes
are retained; passing candidate PNGs were not saved by Playwright. Actual Chromium
BFCache restoration and prerender activation passed using native lifecycle events.
The isolated fictional preview passed headless simulations and is open for human
review; inspection and acceptance remain separate gates. No equivalent native-prerender claim is made for the
other engines.

Seven paired real-corpus measurements preserve cold/warm distributions. Same-data
startup transfer fell by 131,425 bytes cold (2.01%) and 4,800 bytes warm. Median
cold readiness was 365.4 to 374.5 ms; warm was 349.1 to 349.5 ms. Median Back was
96.8 to 110.6 ms cold and 102.9 to 121.4 ms warm. Profiling confirms removal of the
identified forced layout. A supplemental 12-pair diagnostic with equal native-frame
phase coverage found restored-DOM medians of 50.85 to 49.75 ms and paired differences
of -4.6 to +2.6 ms. This is consistent with frame/driver sensitivity; no substantive
slowdown was observed in those bounded DOM conditions. The marker is not a paint
timestamp, and it does not replace the original slower end-to-end distribution.
Local investigation is complete; release-environment performance remains a gate.
This is not a broad speedup or an end-to-end parity claim. The separate enrichment experiment adds
41,042 cold-transfer bytes and shows a one-frame cold-search median shift.
`PERFORMANCE-ACCEPTANCE.md` in the retained evidence directory reports every
minimum/median/maximum and links raw samples; no slower distribution is discarded.

Two clean full-corpus builds match for original data (29,040 review files) and
for enrichment (30,190), with zero network attempts and all 15,853 historical
immutable files preserved. The 18 capture-policy files at replay source137b539
match product6f exactly. Six checkpoint validations, repeat and exact replay,
fresh-cache reuse and two identical 1,602-file package reconstructions passed.

The full corpus exceeds the default 20,000-file capacity. Historical URLs remain
intact, and no deployable manifest is produced above the limit. The reviewed paid
profile is not enabled: actual entitlement, recurring cost and supported upload
path are unverified. Source delivery and ordinary pinned Linux/Windows CI are
pending explicit branch-push authorization. Hosted staging access restrictions,
separate collector storage, owner reporting and rollback have not been rehearsed.
The combined SEO/usage/reporting launch remains blocked by these gates.
