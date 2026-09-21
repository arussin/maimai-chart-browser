# Maishift mapping implementation and local acceptance

2026-09-21 UTC. The canonical registry now retains **12,474 accepted regional
mappings**: 6,031 International and 6,443 Japan, including the 56 explicitly
reviewed exceptions. Maishift and the combined announcement remain disabled.

## Durable evidence and runtime behavior

- `registry/maishift-source-20260921.json` retains only public chart metadata,
  candidate input hashes, source IDs, canonical UUIDs and matching basis. It
  contains no profiles, played flags or scores. The capture date has day
  precision; it does not assert a fabricated capture time.
- `scripts/install_maishift_mappings.py` builds a fresh candidate in DevCache.
  It rechecks unique exact title/artist/format/difficulty matches and all 56
  exception decisions, rejects duplicate regional targets and changed accepted
  mappings, and calls the registry's existing `accept_mapping` mechanism.
  Replaying the retained snapshot produces the same registry.
- The reviewed candidate added 12,474 mappings and one source. Existing mapping
  and source rows, songs, charts, observations and legacy IDs were compared
  unchanged before promotion. The registry manifest verifies the resulting bytes.
- `maishift-mapping-1` is an additive public catalog lookup. Its entries carry
  a canonical UUID, expected raw source fields and snapshot reference. Package,
  full-catalog and progressive-index paths retain the same guards.
- JavaScript and Python compare the exact region-qualified provider ID and raw
  title, artist, format and difficulty. Runtime matching does not normalize
  titles or shorten artists. Ambiguous, unknown or changed identities remain
  unmatched; portable PBs are preserved. A later reviewed mapping can make a
  saved PB visible without changing that PB or inventing a play.
- The existing Kamaitachi export and Session Report integration projection are
  unchanged. No portable schema or downstream reader pin was updated.

## Deterministic validation

All runs use the documented DevCache environment. The source checkout contains
no installed dependencies, bytecode caches or disposable build outputs.

- Python wrapper: **522 tests, OK, 7 skips**, workspace
  `20260921T062518942-2d241f8f`. This includes snapshot replay, tamper rejection,
  regional target collisions, Python/JavaScript guard parity, progressive
  retention and unchanged Session Report projection.
- Browser wrapper `-Check browser -TestFile player-`: **243 passed**, workspace
  `20260921T062805381-27a41de5`. Chrome, Edge, Firefox, WebKit, desktop, mobile and
  320px layouts cover exact/unknown achievement values, unmatched retention,
  legacy imports, partial observations, lower corrections, deduplication,
  remembered refresh, source switches, storage denial, Forget during fetch and
  commit, stale tabs, hidden scores, four languages and announcement gating.
- The initial test run caught the missing public-catalog allowlist entry; it
  was fixed before the passing suite. A fixture readiness race was fixed by
  waiting for the catalog. Neither failure was dismissed as a pass.
- Changed Python files pass Ruff. Localization validation is recorded below;
  concurrent filter/localization work is preserved separately.
- After the full-catalog test exposed serial WebCrypto hashing latency in
  WebKit, the Maishift adapter adopted the existing validator's bounded batches
  of 128 hashes. The portable records and hash algorithm are unchanged. The
  final Maishift matrix passed **98 tests**, including a 6,000-PB regression in
  all seven configurations, workspace `20260921T063858731-ac69422b`.
- The full 6,031-chart fictional profile then passed narrow WebKit in the
  progressive preview. Preview took 1,992 ms; all ten difficulty/format
  combinations, remembered reload, hiding and Forget passed. This is local
  browser timing, excluding upstream network latency, not a device benchmark.
- Localization source inventory and review fingerprints pass for the staged
  change; the full working catalog validates 857 messages in Chinese, Korean
  and Japanese. No new UI prose was introduced here. Concurrent filter-copy
  changes are excluded from the staged review-freshness check.

## Manual real-source browser check

`scripts/prepare_maishift_preview.py --output <fresh DevCache directory>` builds
a metadata-only registry package and progressive Party preview. It reads no
protected chart bodies and enables no feature flag.

`scripts/test_maishift_live_browser.mjs` requires explicit per-run approval via
`MAISHIFT_CANARY_APPROVED=true`, an approved `MAISHIFT_CANARY_URL`, the selected
`MAISHIFT_CANARY_REGION`, `MAISHIFT_PREVIEW_ROOT` pointing to the prepared `public`
directory, and `MAIMAI_NODE_MODULES_ROOT` pointing to a DevCache `tests/browser`
directory containing the pinned Playwright installation.

One run performs the proxy handler's three bounded upstream reads. The minimized
response stays in memory and is reused across isolated Chrome, Edge, Firefox
and narrow WebKit contexts. Only the test context enables the browser connector.
It checks every imported score against the guarded mapping, actual visible
STD/DX difficulty rows, exact precision, PB-only history, remembered reload,
hidden scores and Forget. It records counts and timing, never profile payloads,
screenshots, traces or reusable browser storage. External browser requests are
blocked and asserted absent. A separate `MAISHIFT_SYNTHETIC=true` mode uses
fictional scores for every mapped chart and makes no upstream requests.

This local harness uses the real service handler and browser pipeline; it is
not a deployed Cloudflare route, a production-origin acceptance test, a Worker
resource benchmark, or proof of source timestamp semantics across uploads.
No deployment, workflow dispatch, schedule activation, alerts or maintainer
contact is part of this acceptance.

The final International official-sample run passed Chrome, Edge, Firefox and
narrow WebKit: **2,010 / 2,010 PBs matched**, zero unmatched/excluded, zero plays,
and all ten STD/DX difficulty combinations visibly rendered at exact precision.
Remembered reload, hidden scores and Forget passed in each engine. The run made
three upstream requests; the same in-memory response was used across engines.
Local preview times were 261, 173, 318 and 933 ms respectively. These timings
exclude the upstream fetch. Earlier harness locator failures were diagnosed
with fictional data before this passing run; no failed attempt is counted as
acceptance. No sample PBs or browser artifacts were retained.

The Japan run also passed all four engines: **200 / 200 PBs matched** out of
6,443 catalog charts, zero unmatched/excluded and zero plays. Its eight played
difficulty/format combinations were rendered; absent combinations were not
invented. Remembered reload, hiding and Forget passed. Three upstream requests
served this run. Local preview times were 140, 94, 119 and 419 ms.

Both final live runs used `workspaces/maishift-live-preview-20260921-v3/public`
under the approved registry DevCache root. The desktop viewport was 1280×900;
WebKit used 320×800. This is engine/layout coverage, not a physical-device test.

## Remaining release gates

- Validate upstream update-time ordering across genuine changed uploads,
  corrections and version transitions. Current deterministic correction tests
  establish Party behavior, not Maishift's timestamp guarantee.
- Benchmark the permitted full sample in the intended Worker CPU/memory budget
  and review rate limits, costs, log retention and deployed upstream access.
- Complete owner-approved deployment and browser acceptance of the actual
  same-origin endpoint before enabling Maishift or its announcement.

Username plus provider/region remains the accepted source identity. This does
not establish account ownership or detect reassignment of the same username.
