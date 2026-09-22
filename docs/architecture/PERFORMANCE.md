# Architecture performance evidence

Measured on 2026-09-22 against the final 12:28 source snapshot, after the navigation, locale, history and focus corrections. The final batch contains 130 root-page runs and 20 deep-route groups: five cold and five warm samples per configuration. Each deep group independently measures a song arrival, a version arrival, and browser-to-song-to-Back navigation.

On identical retained public data, median cold readiness was 330.9 ms baseline, 336.4 ms with SEO, and 329.5 ms with SEO plus usage. Warm readiness was 284.7 / 295.7 / 292.3 ms. Usage adds 12,373 cold transfer bytes, about 0.19%; the warm cache behavior is unchanged. These local desktop measurements support a small runtime cost, not a universal zero-cost or production latency claim.

The measurements found a concrete delivery issue that was fixed: static songs initially downloaded the full browser stylesheet, and direct versions downloaded it twice under different URLs. The final static stylesheet is 1,608 gzip bytes. Song arrival with usage fell from 252,039 to 11,149 transferred bytes; version arrival fell from 1,057,706 to 817,926 bytes. Existing visuals are validated separately in [VALIDATION.md](VALIDATION.md).

## Method and scope

The source-controlled runner is [scripts/measure_architecture.mjs](../../scripts/measure_architecture.mjs). It uses pinned Playwright and Chromium 153.0.8010.12 on Windows 10.0.26200, an i7-13700KF with 24 logical CPUs and 31.8 GiB RAM. Viewport: 1280 × 900; locale: en-US; reduced motion enabled. Other agents' browser suites and Python builds finished before this batch; no competing project tests or builds ran during it.

- Each configuration has five fresh-context cold runs and five immediate same-context warm repeats. Configuration order rotates between iterations. Browser process, engine and OS caches are not cleared. No bandwidth or CPU throttling is applied.
- A real local HTTP server provides gzip, ETags, HTML/manifest revalidation and one-hour caching for other public assets. Its filesystem/compression cache is primed outside timed runs. Browser routing is avoided because [Playwright documents that enabling routing disables HTTP cache](https://playwright.dev/docs/api/class-browsercontext#browser-context-route).
- All configurations use the same localhost origin. A deny-all outbound proxy refuses every nonlocal HTTP request and every HTTPS CONNECT without forwarding it. The final run recorded zero nonlocal attempts, resource errors or page errors. Page-error recording covers root and deep-flow contexts.
- `seo-only` omits the usage script tag. `seo-usage` changes only the served script's exact production-origin eligibility predicate to this local origin. The substitution must match once, and the runner requires an actual finite local batch. Source assets stay unchanged; source and served hashes are retained. The served script compresses to 1,613 bytes versus 1,612 shipping bytes.
- The collector is an in-memory local 204 response. The representative root interaction sequence emits one 410-byte finite-category batch after the startup snapshot. This does not measure a provisioned D1 service, production TLS/edge latency, or D1 costs.
- Startup is the observed time when populated catalog rows are ready and loading status clears. Actions are measured through the second animation frame. Long tasks and layout shifts use PerformanceObserver. These are controlled application measurements, not field INP, LCP, or a Core Web Vitals report. Shift values are sums excluding recent-input shifts, not field session-window scores.
- Final Back completion requires the saved focus, if nonempty, and saved scroll position, then two animation frames. Earlier receipts waited only for visible results and two frames. Their Back timings are not directly comparable to the final, stricter measurement.
- Authored 6-chart, registry 26-chart and capacity 7,000-chart comparisons use byte-identical catalogs. The registry fixture's generated IDs are normalized by copying only 64 baseline manifest/data files into a fresh candidate-assets overlay. Deep SEO routes use the untouched matching candidate fixture.
- The retained real 7,251-chart corpus uses exactly the baseline manifest/data with final candidate root runtime assets served virtually. Enriched public data is measured separately. Its review manifest is served from the sibling file; no deployable manifest was created inside `planned-assets`.

## Root startup and transfer

Values are medians; brackets contain the minimum and maximum of five samples. Transfer is the browser ResourceTiming total including reported response overhead. Requests are actual local server requests during startup.

| Dataset | Runtime | Cold ready ms [range] | Warm ready ms [range] | Cold bytes | Cold requests |
| --- | --- | ---: | ---: | ---: | ---: |
| Authored 6 | Baseline | 59.1 [58.5–70.5] | 37.2 [36.8–37.8] | 804,504 | 25 |
| Authored 6 | SEO | 59.8 [59.1–67.3] | 38.2 [37.8–38.4] | 817,248 | 27 |
| Authored 6 | SEO + usage | 60.8 [58.2–68.3] | 38.1 [37.7–39.8] | 819,179 | 28 |
| Registry 26 | Baseline | 63.2 [62.4–70.1] | 42.2 [41.4–42.7] | 811,841 | 25 |
| Registry 26 | SEO | 70.6 [65.3–71.2] | 42.8 [42.5–42.9] | 824,567 | 27 |
| Registry 26 | SEO + usage | 64.0 [63.2–73.6] | 42.4 [42.4–43.1] | 826,498 | 28 |
| Capacity 7,000 | Baseline | 190.0 [182.0–202.0] | 153.6 [152.8–161.3] | 1,076,728 | 25 |
| Capacity 7,000 | SEO | 189.5 [185.1–191.9] | 158.9 [155.3–162.1] | 1,089,521 | 27 |
| Capacity 7,000 | SEO + usage | 186.7 [179.5–192.6] | 158.7 [156.8–161.3] | 1,091,452 | 28 |
| Retained public 7,251 | Baseline | 330.9 [325.7–346.8] | 284.7 [281.9–293.2] | 6,411,242 | 29 |
| Retained public 7,251 | SEO | 336.4 [329.7–359.0] | 295.7 [280.1–298.0] | 6,421,684 | 31 |
| Retained public 7,251 | SEO + usage | 329.5 [327.0–333.0] | 292.3 [289.2–293.2] | 6,423,615 | 32 |
| Enriched public 7,251 | SEO + usage | 342.5 [334.4–357.6] | 293.1 [287.7–303.6] | 6,594,344 | 32 |

Every warm root run transferred 600 bytes through two revalidation requests; remaining resources came from browser cache. Retained-public usage cold readiness was 1.4 ms below baseline; warm readiness was 7.6 ms higher, about 2.7%. The cold and warm ranges overlap. The registry fixture shows a 0.8 ms cold median increase with usage, while SEO-only's five samples were slower. The rotating order reduces order effects but five desktop samples do not establish statistical significance.

Enrichment adds 170,729 bytes beyond the new runtime on retained data and increases its cold median by 13.0 ms. That is a changed public payload, not an isolated refactor comparison. The inherited startup index dominates: 5,528,134 gzip / 25,100,655 decoded bytes retained, versus 5,695,471 gzip / 25,915,247 decoded enriched. Its added 167,337 compressed / 814,592 decoded bytes account for most of the difference. The actual corpus is substantially more expensive than the repetitive synthetic capacity fixture. This remains an architectural optimization opportunity; accepted contents, immutable identities and analytic hashes were preserved.

For the identical registry fixture, the 14,657-byte cold transfer increase comprises 13,757 added gzip body bytes and 900 additional reported response-overhead bytes:

| Asset | Gzip body delta bytes |
| --- | ---: |
| Existing `challenge-review.js` bundle | +5,104 |
| New `seo-navigation.js` | +4,697 |
| New `usage.js`, local eligibility substitution | +1,613 |
| `localization.js` | +1,191 |
| New `player-session.js` | +789 |
| Loader, player/settings/navigation adapters combined | +395 |
| Root HTML | −32 |

Shipping `usage.js` is 3,274 raw / 1,612 gzip bytes. `catalog-query.js` is 1,635 raw / 875 gzip bytes, but is not requested by this root flow. The retained public baseline has different existing asset sizes, so its measured runtime delta is smaller than the synthetic registry delta. Even after this refactor, the pre-existing browser bundle and stylesheet together exceed 600 KB compressed; this change does not remove that inherited delivery cost.

## Interactions, long tasks and offscreen data

Cold median interaction milliseconds on retained public data:

| Action | Baseline | SEO | SEO + usage |
| --- | ---: | ---: | ---: |
| Search | 90.7 | 89.9 | 89.7 |
| Clear search | 36.9 | 35.4 | 35.3 |
| Sort | 62.8 | 58.6 | 59.2 |
| Expand chart | 23.1 | 26.3 | 25.5 |
| Choose comparison | 52.1 | 52.1 | 51.3 |
| Find similar | 159.8 | 161.8 | 160.5 |

Warm retained-public similarity medians were 147.2 / 147.6 / 147.6 ms. Capacity-fixture cold similarity was 129.9 / 130.2 / 130.2 ms. The maximum action observed was 164.9 ms for baseline retained-public similarity. These measurements cover the exercised controls and frame completion, not every query, locale, device or result count.

Small fixtures recorded no startup long tasks. Capacity cold median long-task totals were 128 / 129 / 128 ms. Retained-public totals were 232 / 286 / 239 ms cold and 226 / 231 / 230 ms warm. Three of five SEO-only cold runs and one of five usage runs recorded an additional 50–54 ms task immediately after readiness. This threshold effect changes the reported sum substantially; it does not imply a measured 54 ms startup regression. The largest individual public startup task was 139 ms. Parsing and rendering retained data remain substantial even with cached bytes.

No root startup fetched a full `catalogs/` or `catalog-parts/` payload. Registry startup fetched zero detail shards, increasing to one on expansion. Capacity startup fetched one shard covering four of 7,000 charts, without fetching other offscreen details. Retained and enriched public startup fetched one shard; the exercised search/sort/expansion sequence increased that to three. Request boundaries matched for old and new runtime on identical data.

Startup layout-shift sums matched across runtimes: 0.220227 for small fixtures and 1.0 for capacity/public data. These inherited shifts remain a UX/performance constraint; they are not evidence of good field CLS.

The separate existing capacity-budget suite passed both desktop cases with one worker, no skips and no failures, after the other heavy processes exited. Startup was 414.8 ms (embedded capacity) and 299.3 ms (progressive capacity); maximum controls were 68.0 / 43.1 ms and similarity 125.1 / 120.3 ms, within the existing 5,000 / 350 / 1,000 ms guards. Each case retained one parse over 1 MiB, taking 51.6 / 19.6 ms. These one-shot checks are separate from the comparative sample. Evidence is the final snapshot's `output/browser-capacity-budget-results.json`, sibling log and `browser-capacity-budget-test-results` attachments.

## Direct SEO arrivals and complete Back restoration

The before values use independent cold contexts captured before the stylesheet correction. Final values come from the final batch. Each is a median of five samples.

| Flow | Runtime | Before cold bytes | Final cold bytes | Before readiness ms | Final readiness ms |
| --- | --- | ---: | ---: | ---: | ---: |
| Song | SEO | 250,117 | 9,226 | 14.5 | 11.4 |
| Song | SEO + usage | 252,039 | 11,149 | 14.6 | 41.8 |
| Version | SEO | 1,055,768 | 815,986 | 107.0 | 104.3 |
| Version | SEO + usage | 1,057,706 | 817,926 | 108.4 | 107.3 |

Song readiness here is DOMContentLoaded; version readiness is initialized browser results. Final cold song DOMContentLoaded ranged from 10.3 to 44.8 ms across configurations, while the static content became ready at about 5 ms. This sample supports the transfer reduction, not a reliable song latency improvement. Song arrivals used four requests without usage and five with it; they fetched no catalog index, full catalog or chart details. Version arrivals loaded the browser once, using 28 / 29 requests. Warm transfer was 300 bytes for songs and 900 for versions; version warm readiness was 59.1 / 59.6 ms.

All measured direct arrivals had zero layout shifts and zero long tasks. Root-to-song cold medians were 89.2 / 86.0 ms for SEO / usage. Complete Back medians were 49.7 / 49.2 ms cold and 49.5 / 49.8 ms warm, with saved focus and scroll verified in every case. Back never refetched a catalog index or added an observed shift beyond the existing root startup shifts. The old 32–33 ms Back receipts used a weaker completion condition and are superseded, not evidence of a comparable timing regression. These deep cases use representative synthetic registry routes; actual-corpus deep timing was not measured.

The strict CSS check isolates the stylesheet variable within the same DOM: lean → aggregate → lean, after fonts/layout settle, comparing decoded RGBA pixels with zero tolerance. The final five-project navigation matrix includes 40 locale/page CSS comparisons and 40 return-stability comparisons. Earlier separate-context Firefox captures differed at 53 glyph-edge pixels; independent repetitions and same-DOM checks found no layout/style difference, so the test was corrected without changing product CSS. Detailed functional/visual evidence is in [VALIDATION.md](VALIDATION.md).

## Reproduction and evidence

Final measurements:

`C:\DevCache\projects\maimai-chart-browser-registry\50b28fa463dbfb9a\performance\final-reviewed-source\measurements.json`

SHA-256: `db82d9e98a9f5025c17cb03fad46bffba5441db030063f361864edbbb58d590f`.

The receipt records every sample, action, request, long task, shift, input path, catalog hash and served resource's source/served SHA-256. Completion timestamp: `2026-09-22T12:38:43.467Z`. Harness SHA-256: `1fea971dd7f238e7a3567c22b2bd43bcaa31637d184f2152410663a5c4f6f1e0`.

All 147 files under `src/maimai_intelligence/assets` and `web/src` match the final checkout exactly. SHA-256 of the sorted `[relative_path, file_sha256]` compact JSON array is `2ede26b2daa8ef23b2b39414795425e1019a1eb7a7567bea6b90f0d8382b9b65`. Shipping usage SHA-256 is `4c8c72638c9612af07198092805b468b223f59651be3380e15290386e5116342`; eligibility-substituted served SHA-256 is `72284fd6e0f6239f2c74460a0db2e8c9c8ec01d38dbe04eb3da14d6c1e76a36d`. Static CSS SHA-256 is `05b0e538211116866b8198fd8a86a94363237059a678cecd88533d6a3f79a752`.

Retained catalog SHA-256 is `d326e1380acfa65fdb941689a67cf8ff74baae9574f8c490f4d7ac664a81a154` in every runtime configuration. Separately enriched SHA-256 is `11a1148572749a81cc40c1a3a95d31831edff4339ec5b1c1958ebae71adedddd`. Compared canonical identity/title/artist/slot/level/demand arrays are identical; synthetic hashes are retained too. The exact-data overlay manifest hash is `18df46d2aacd9bcaf14333954632f6b87bd2a4e46cffacdbaf79266a7acbfcd6`.

Earlier evidence remains under the same `performance` directory:

- `final-compatibility-source/measurements.json`: 130 root + 20 deep groups from 11:19, before final language/history/focus corrections; SHA-256 `4374f250cb4d530c454bd47ff342cd5e93ab81e2ae5fdf586ad754a8c1a13363`.
- `final-frozen-source/measurements.json`: 130 root + 20 deep groups from 10:59, before public normalize API and capability corrections; SHA-256 `0c0336d67a27a8fce006f9b1dd89eb70a90a98691c0d18d4bd8504c45679b65f`.
- Both preceding batches used harness `54f26a2d1667b52c10b3d1688a1567fb51ab4a666e0c9e89360a5abfb00f98a9`, weaker Back readiness and root-only page-error recording. They are checkpoints, not final-source acceptance.
- `deep-before/measurements.json`: valid independent-context CSS-before evidence; SHA-256 `79f9b74ec8309821fe25ae7239f578606261de3480a5e01ce3bee853f81b3b4a`.
- `final-five-runs/measurements.json`: original 90 root + 20 deep groups; SHA-256 `0bbee112fffde64f147d8a55ce001b257f7a31994723c32257cc1361e84455c5`. Its version context had visited a song, partly warming CSS. Those deep results are superseded by independent-context measurements; its earlier root samples are preserved.
- `calibration`, `calibration-exact` and `actual-calibration` are not acceptance timings. The first exposed a usage-script query-string exclusion bug in the harness; actual calibration ran under competing load.

To reproduce with retained inputs and a fresh DevCache output directory:

```powershell
$perfCache = 'C:\DevCache\projects\maimai-chart-browser-registry\50b28fa463dbfb9a'
$finalFixture = "$perfCache\workspaces\20260922T122833644-cb17083c"
$actualReview = 'C:\DevCache\maimai-architecture-seo\actual-candidate-20260922-1036\review-bundle-final-delivery'
$env:PLAYWRIGHT_BROWSERS_PATH = 'C:\DevCache\playwright'
& 'C:\Program Files\nodejs\node.exe' `
  'C:\Dev\worktrees\maimai-architecture-registry\scripts\measure_architecture.mjs' `
  --baseline "$perfCache\workspaces\20260922T094956774-db332cff\output\browser-tests" `
  --candidate "$finalFixture\output\browser-tests" `
  --candidate-registry "$perfCache\performance\input-final-reviewed-registry" `
  --runtime "$finalFixture\tests\browser" `
  --actual-baseline 'C:\DevCache\projects\maimai-chart-browser-registry\6c15e789d6fd4518\workspaces\player-import-release-20260922-v4\public' `
  --actual-candidate "$actualReview\planned-assets" `
  --actual-manifest "$actualReview\planned-manifest.json" `
  --iterations 5 --output "$perfCache\performance\rerun-new-directory"
```

The synthetic baseline is built from merged Maishift `67e377dc2a5a095e2fe05b331235fb679895a4bd`. The retained public artifact is the previously verified release input; its parent validation receipt hash is `fefc0bc79898b7b3e80ba0e61269e32dc28af5abe6baf3f0f1d63c033d792a9b`. The candidate is the final 12:28 snapshot. Its fixture refresh preserved 2,171 JSON inputs byte-for-byte (`output/fixture-runtime-inputs.json`); `compatibility-receipt-final-delivery.json` beside the review bundle verifies 15 historical public closures. `--roots-only`, `--deep-only` and `--actual-only --roots-only` support bounded subsets.

This is local review evidence. The full multilingual retained-history plan has 29,049 files against the existing 20,000-file guard. These measurements accept no hosting capacity change, production deployment, D1 provisioning or combined activation. Mobile CPU, constrained networks, production cache policy, field metrics, all locales and every interaction remain outside the timing sample. Unrelated copied development-layout/retention helpers are excluded from the product change; canonical originals remain preserved.
