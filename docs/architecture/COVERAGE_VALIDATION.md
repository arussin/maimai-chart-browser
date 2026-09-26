# Bounded real coverage validation — 2026-09-22

> Historical initial candidate. See [the production revision](REVISION.md) for the current architecture and acceptance results.

This is a local review candidate from the merged Maishift baseline `67e377dc2a5a095e2fe05b331235fb679895a4bd`, using the retained public v4 package. No source registry, retained publication, personal record or hosted service state was changed. No publication or deployment was performed.

## Measured coverage

| Identity-level coverage | Before | After | Change |
| --- | ---: | ---: | ---: |
| Accepted chart identities | 7,251 | 7,251 | 0 |
| Accepted song identities | 1,694 | 1,694 | 0 |
| Charts with Kamaitachi mapping | 6,796 | 6,796 | 0 |
| Remaining mapping gaps | 455 | 455 | 0 |
| Songs with artwork | 1,425 | 1,443 | +18 |
| Remaining artwork gaps | 269 | 251 | -18 |

No mapping or artwork coverage was removed. Among existing artwork-covered songs, 246 gained/changed regional selections and 1,179 were unchanged; all existing default selections were retained. Title classifications are 1,693 present and one reviewed intentional blank. Its original full-width-space title and x0o0x_ credit remain unchanged.

The 18 new artwork selections comprise 17 independently identity-checked Gamerch images and one International official image. Examples include Ievan Polkka, 7 Girls War, Now Loading!!!!, and historical removed songs. The final summary records every added song UUID, original metadata, selected path/hash, source URL and evidence.

| Listing scope (overlapping) | Artwork-covered songs before | After |
| --- | ---: | ---: |
| JP | 1,423 | 1,428 |
| INTL | 1,380 | 1,381 |
| Historical / currently unlisted | 1 | 13 |

These are coverage gains in the prepared data. They are not a claim that all remaining gaps are solvable, or that metadata-only charts acquired analysis.

## Bounded work and explicit gaps

The first pass attempted 300 songs. It made 597 requests: three immutable-provider metadata requests, 265 JP images, 247 INTL images, 65 Wiki discovery/song pages, and 17 Wiki images. Outcomes were 14 accepted, 250 partial, seven retained on failure, and 29 unresolved. Another 1,394 songs remain pending in the durable queue; no unattempted evidence is acknowledged.

All 265 JP image requests failed with `SSL: CERTIFICATE_VERIFY_FAILED: unable to get local issuer certificate`. Certificate verification was preserved. This is an observed acquisition limitation, not evidence that those jackets do not exist. Valid default/International selections remain available and failed regional refreshes remain retryable.

The 29 unresolved attempted songs comprise 24 unsupported or missing Wiki jacket cases, two missing/ambiguous discovered image cases, two ambiguous accepted song identities and one page without unique complete identity evidence. These diagnostics remain separate from upstream absence. No unsafe broad credit equivalence was introduced: the current immutable provider capture added no mapping IDs; the 455 mapping gaps remain review/source gaps. A later build can safely process another bounded batch. No schedule was created.

## Pinned input and artifacts

Tachi revision: `bc9d2789bc98bb740fd5b804295e2b75e7609e3b`. Both files came from this same SHA in the approved public repository.

| Capture | SHA-256 | Bytes |
| --- | --- | ---: |
| songs | `8b55708ec0812860773a731ebcaacff2d3266a12c59ba17dbd11a5df322418d1` | 443,204 |
| charts | `380e3f076f1596f82899c2380c3c2b3fdda83389107b9e1c88633fa1a16f8a8f` | 3,361,411 |

The retained baseline is `C:/DevCache/projects/maimai-chart-browser-registry/6c15e789d6fd4518/workspaces/player-import-release-20260922-v4/package`; its descriptor and every retained JSON hash were verified before use.

Raw captures and original run receipts: `C:/DevCache/projects/maimai-chart-browser-registry/50b28fa463dbfb9a/workspaces/20260922T102019479-700ede6c/output/real-coverage`. Final-code replay, verified registry/package and detached public catalog: `C:/DevCache/projects/maimai-chart-browser-registry/50b28fa463dbfb9a/workspaces/20260922T102804355-3201db86/output/real-coverage-final`. These outputs stay in DevCache; no asset corpus is copied into source control.

| Review artifact | SHA-256 |
| --- | --- |
| Original source-captures.json | `5513b7eb47ec028ca3be570cce76cefb94873b520657cc7571fbf9639309fe7b` |
| Final coverage-audit.json | `fa1f51457b0f48561389d0a980982f28c362d12a0f3fc0a54188739841896a59` |
| Final registry manifest.json | `05d378d8971268fccf35154d5a4f9a95a7afdedfeabc3c1d5ce616efbe09fe0d` |
| Final package package.json | `b7395be11f12835af3461963ccd44752d0effc0f221d175192b7e83edcc97729` |
| Final summary.json | `1f46607a2dbd33850a64d1a5f175035803948f165064c56ab1bfb7071403dcea` |

To verify any listed file, run `Get-FileHash -Algorithm SHA256 -LiteralPath 'ABSOLUTE_ARTIFACT_PATH'` in PowerShell and compare it with the table. `read_registry(PATH)` and `read_package(PATH)` additionally verify every bound table/package JSON; accepted artwork bytes are verified during package projection.

## Repeat and integrity evidence

The original real run's registry, audit and capture receipt reproduced exactly in offline replay. An ordinary offline enrichment pass retained the accepted registry exactly. Repeating the same bound inputs/captures reproduced the same selections; this check does not claim a second live incremental batch was exhausted.

After the pending/processed queue fix, a fresh source copy replayed the same real captures again. Registry, audit and receipt still matched exactly. Writing/reading that registry, building its package, and rebuilding from that enriched package produced identical public data. Original chart UUIDs, every profile source hash and the complete analysis payload remained unchanged. The real capture/three repeat checks took 645.91 seconds in total; the final-code replay, registry roundtrip and two package builds took 62.59 seconds. These include acquisition/preparation work and are not browser performance measurements.

The selected final Python suite passed 94 tests. A later targeted test also passed after adding independent mutation checks for every coverage receipt file. Specifically tested scenarios include metadata-only matching without fabricated analysis, scoped credit and blank-title reviews, mapping gap N→N+1, default/JP/INTL migration, changed-image failure then recovery, oldest-job reservation, batch overflow, 404/429/backoff, accepted asset tampering, source replay ignoring newer cache pointers, and package reuse. The retained-PB browser reveal scenario was subsequently validated separately in the browser matrix described below; the Python checks alone do not claim it.

## Readiness boundary

This directory is a verified enrichment/package review artifact; it has no `ready.json` and is not a publishable release. The complete historical public release still has an independently measured file-capacity blocker. The normal preparation path binds source/config/review policy, candidate registry, selected public asset bytes and all five coverage receipts before writing readiness last. Mutating `coverage-inputs.json`, `coverage-start.json`, `coverage-state.json`, `coverage-audit.json` or `source-captures.json` was individually verified to reject the candidate; existing registry/public tamper checks remain in place.

The final readiness integrity change additionally binds Python dependency/decoder pins, typed build metadata and usage Worker policy. `implementation-binding.json` records the expanded implementation fingerprint at this coverage checkpoint (`f03a11351fa5d99d5c636dabee674e3d568d302ee98ca7c1083abf2700543820`), the validated source-copy fingerprint, the unchanged coverage-module check and 1,442 reverified selected assets. Its SHA-256 is `77ab72e9672cafa9ddec55320980f754cc4be7c8e9b9a51574f726b980c8b3dd`. The real raw-capture receipt has no outer readiness fingerprint to update; the eventual complete public candidate must generate a new `ready.json` using current source. This record does not make the enrichment artifact publishable.

## Updater integration follow-up

The normal updater now accepts `--previous-public`, resolves a verified current publication for refresh, and binds prior manifest/permalink identity in both replay inputs and readiness. A known publication without a usable current pointer requires explicit input; an explicitly stale input fails before readiness is written. Publication compares the exact bound live manifest before recording an upload attempt. Forty-four updater/waterfall/coverage tests passed in immutable source copy `20260922T105353553-7288b1d5`; five affected current-pointer/refresh/repeated-preparation/publication cases passed after the final tightening in `20260922T105632151-3065514d`. These orchestration checks do not change the measured coverage checkpoint or claim a completed public release.


## Final browser coverage check

The fictional retained-PB scenario passed on desktop, mobile and narrow configurations. It imports and remembers an unmatched personal record at catalog N, reloads catalog N+1 with a policy-exact mapping, and sees the personal achievement without another import. Stored private bytes and revision remain identical. Reloading the old catalog removes the match again without rewriting that history. The test is `tests/browser/progressive.spec.js`, “stored PB gains a policy-exact catalog mapping without reimport or rewriting private history”.

The full main browser matrix on source copy `20260922T105905539-c135f701` ran 1,204 cases: 1,182 passed, 17 failed and five were intentionally skipped. Every failure belonged to five concrete cases: an adapter normalization compatibility regression, an integrity fixture targeting the unused legacy startup reference, and three standalone checks exposing unsolicited permalink-ledger reads. After those were corrected, a fresh immutable copy `20260922T111921392-a956693c` passed all 343 registry/standalone cases across their configured projects in 175.12 seconds. The updated integrity fixture independently rejects unknown genres from both shared and legacy startup inputs. The two existing desktop capacity-budget tests then passed serially in an isolated window in 3.62 seconds. This is a complete affected rerun, not a claim that the original full run had no failures.

Original full-run JSON/log: `C:/DevCache/projects/maimai-chart-browser-registry/50b28fa463dbfb9a/workspaces/20260922T105905539-c135f701/output/browser-main-results.json` and `browser-main.log`. Corrected matrix JSON/log: `C:/DevCache/projects/maimai-chart-browser-registry/50b28fa463dbfb9a/workspaces/20260922T111921392-a956693c/output/browser-affected-results.json` and `browser-affected.log`. Serial capacity evidence in the same output directory is `browser-capacity-budget-results.json` and `browser-capacity-budget.log`.

The five skips were the optional official Google SDK local audit on desktop/mobile/narrow because `GA_SDK_PATH` was unavailable, and the desktop-only capacity network check on mobile/narrow. The desktop capacity network case passed. These checks make no hosted-service, production-deployment or personal-account validation claim.


## Final navigation and display checkpoint

Source snapshot `20260922T122833644-cb17083c` includes the later navigation/position fixes. The measured reload issue was layout expansion: Chromium first restored the requested 683px at a 692px maximum, then scroll anchoring followed a 0.24-second disclosure expansion to 928px as the maximum became 937px. This was not corrected by changing native history restoration. Position restoration now waits for existing finite layout transitions, fonts and any pending public-link lookup; newer navigation or user interaction cancels it. WebKit's pointer activation changed focus before the click handler captured it, so navigation now explicitly preserves the activating link identity. Explicit chart opening also cancels any older pending snapshot position. Raw diagnostic measurements remain in `20260922T114922489-52e91810/output/scroll-probe.json`; the corrected focused matrix passed 20 cases across five browser configurations.

On the final 12:28 snapshot, all 36 existing-UI screenshot comparisons passed with zero changed pixels (12 cases, four languages, 320/768/1280px). All 78 usage/localization/affected standalone cases passed with no skips, failures or flaky results. The preceding 12:10 run's single WebKit test detached its transient chart-row scroll target during initial rendering; the test now scrolls the persistent catalog container and retains every SVG visibility and localized accessibility assertion. Five concurrent WebKit repetitions and the final full 78-case matrix passed. Original failure evidence was preserved; these later checks do not relabel the earlier full-browser checkpoint.

Final evidence root: `C:/DevCache/projects/maimai-chart-browser-registry/50b28fa463dbfb9a/workspaces/20260922T122833644-cb17083c/output`. `browser-visual-final-results.json` / `browser-visual-final.log` record the 20.39-second screenshot run. `browser-usage-locale-final-results.json` / `browser-usage-locale-final.log` record the 37.72-second behavior run. `visual-inputs.json` binds the unchanged baseline data manifest and every final overlaid public asset; `fixture-runtime-inputs.json` records the final runtime generation and unchanged synthetic JSON corpus. Separate SEO navigation and comparative performance evidence is maintained in the architecture validation/performance reports.


After every other browser/build process exited, the same final snapshot passed both existing desktop capacity-budget cases serially in 3.57 seconds, with no skips or failures. The final evidence root contains `browser-capacity-budget-results.json`, `browser-capacity-budget.log` and timing attachments under `browser-capacity-budget-test-results`. All local browser/server processes then exited before the separate final comparative timing window was released. These checks remain local regression evidence; the 29,049-file review candidate exceeds the unchanged 20,000-file publication gate and was not deployed.
