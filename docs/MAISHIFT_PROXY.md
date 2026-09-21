# Local Maishift proxy delivery

Implemented locally on `codex/maishift-proxy`. Nothing deployed or enabled.
The user approved the described proxy after the original proposal-only plan.

## Flow and contract

1. A user selects Maishift and enters a public handle/URL and game region.
   Selection itself makes no request. Locale never chooses game region.
2. Party POSTs `{handle, region, manual}` to `/api/player-import/maishift`.
   The handle stays out of Party URLs, analytics events, and referrers.
3. The isolated Worker reads the frozen public profile RPC, full-track RPC,
   then profile RPC again. It sends no cookies, authorization, or referrer.
   A changed profile snapshot, redirect, login HTML, malformed response, or
   limit violation fails without returning partial success.
4. Only identity/display metadata, chart metadata and played PB measurements
   return. Friend codes, avatars, jackets, trophies and play totals are removed.
5. Party validates and previews identity, region, capture date, partial coverage,
   unmatched count and excluded-record count. Remember starts checked; the final
   button says **Import & remember** or **Import once**.
6. The existing atomic dataset/connection commit, generation checks, cross-tab
   leases and Forget protection control persistence and later refreshes.

Observed RPC hashes, inert wire types and field meanings are recorded in
`player-import-worker/observed-contract.json`. The checked-in fixtures contain
fictional people, chart identifiers and scores. Internal RPC hashes can change
on any upstream deployment; this is not a supported public API contract.

`ASIA` maps to Party `intl`, `JAPAN` to `jp`. Explicit `@na` and `@intl` URLs
both select the international record region; language-only URLs require an
explicit matching region selection. Historical version overrides are rejected.
Handles remain case-sensitive in portable identities. Coordination folds case
conservatively to prevent duplicate case variants increasing upstream load.
Handle ownership, rename/reuse rules and immutable player identity are unresolved.
A changed profile `createdAt` timestamp blocks remembered refresh; this is a
conservative rejection guard, not proof that handles are immutable. Follow-up
research indicates this is snapshot timing, not account creation; the guard may
reject a legitimate upload and needs verified replacement semantics before release.
See [matching and identity research](MAISHIFT_MATCHING_RESEARCH.md).

Achievements retain the source integer scale (`1000000 = 100%`). Maishift supplies
fractional ratings with no verified lossless conversion to the portable format’s
integer `rate`; these are deliberately unknown (`null`), never rounded. Estimated
constants are also unknown. Source profile update time dates the PB observation,
not an individual play. No plays or sessions are created. Identical PB content
adds no history even if the profile timestamp changes. A lower PB with a newer
source timestamp is a correction; changed PBs without a newer timestamp fail
closed instead of inventing an ordering. Missing rows cannot delete prior PBs
because these are partial observations.

Provider chart IDs are namespaced by provider and region, with `inGameID: null`.
They never impersonate SEGA or Kamaitachi identifiers. Empty display titles or
artists do not invalidate a known provider ID. Every current Maishift chart is
explicitly unmatched in the preview and excluded from catalog overlays until a
reviewed crosswalk is delivered. At most 100 excluded-row indices/reason codes
and their total count accompany a remembered connection outside portable data.

## Limits, privacy and operation

The Worker accepts only same-origin JSON POSTs on one fixed Party path. Origin
checks are browser isolation, not authentication: non-browser callers can forge
them, so deployed rate limits are essential. Arbitrary upstream URLs, methods,
redirects, authentication headers and private-report forwarding are unsupported.

- Input: 2 KiB and 5 seconds; upstream: 4 MiB per response, three requests and
  30 seconds total. Decode depth, node counts and collections are also bounded.
- A required client rate binding starts at 10 requests/minute. Cloudflare’s
  native limiter is local to a data center, not a strict global IP quota.
- SQLite-backed Durable Objects provide a global per-profile lease (45 seconds),
  30-second manual cooldown and 15-minute automatic cooldown. Upstream
  `Retry-After` can extend these. There is no response cache or score database.
- Only random lease IDs and times are retained server-side, under hashed
  identity names. Unsalted hashes are not anonymous; profiles may be guessable.
  Cleanup alarms expire cooldown state and never make network requests.
- Responses use `no-store, private`; application logging, Wrangler telemetry,
  public preview URLs and workers.dev are disabled. Review platform/security
  logs and retention separately before release. No raw body/URL tracing.
- Forget removes browser connection/diagnostic metadata and invalidates stale
  requests/tabs. A request already sent to the server may finish within its
  deadline, but its result cannot resurrect forgotten browser data.
- Failures preserve the working dataset. Storage failures cannot replace it.
  No background polling, periodic profile fetch, or scheduled cache population.

The checked-in Wrangler configuration is disabled, has no route/account, and
omits the client rate namespace. Missing bindings fail closed. Owner provisioning
must assign an account-unique `CLIENT_LIMITER` namespace, bind the Durable Object,
review costs/retention, and route only `/api/player-import/maishift` after all
release gates pass. This is separate from the existing payment Worker.

The owner can disable `MAISHIFT_ENABLED` to stop upstream reads. A public build
can also turn off the Maishift capability without deleting saved data. Neither
switch is activated here. Keep the combined announcement disabled until the
enabled capabilities pass acceptance checks.

## Validation and release checklist

Run `tools/Test-Development.ps1 -Check worker`, `-Check python`, and
`-Check browser -TestFile player-`. Dependencies and outputs live in disposable
DevCache workspaces; source edits stay in the canonical checkout. Wrangler,
workerd/Miniflare and worker types are pinned in the worker lockfile. The current
Wrangler dependency uses Miniflare `5.20260918.0-alpha`; the explicit local runtime
checks cover the APIs used here. No toolchain was installed alongside source.

The manual `player-import-worker/live-contract.mjs` requires
`MAISHIFT_CANARY_APPROVED=true`, `MAISHIFT_CANARY_URL` and
`MAISHIFT_CANARY_REGION`. Never put personal canaries in CI logs or artifacts.
The approved official sample was read on 2026-09-21: 6,031 charts, 2,010 played
PBs, all 2,010 normalized, zero excluded, zero plays, zero Party matches.
No raw sample data was retained. This verifies the server reader and normalization,
not a deployed Cloudflare-to-Maishift connection or completeness for other users.

- [x] Frozen observed transport and fictional fixtures; public sample normalized.
- [x] Fixed-destination proxy, bounded inert decoding and minimized responses.
- [x] Partial PB semantics, unknown values, precision and provider/region isolation.
- [x] Local preview/remember/refresh integration and four-language copy.
- [ ] Verified full PB completeness, snapshot consistency and handle ownership semantics.
- [ ] Exact reviewed region/chart crosswalk with no fabricated or fuzzy joins.
- [ ] Owner-reviewed deployment, runtime upstream access and platform log retention.
- [ ] Benchmark a permitted full canary against the selected Worker's CPU/memory
  budget and configure capacity/cost limits before enabling the route.
- [ ] Final browser acceptance against the deployed same-origin endpoint.
- [ ] Enable Maishift and the truthful combined announcement only after those gates.

No maintainer contact, workflow dispatch, scheduling, alert publishing, or
deployment occurred. The existing manual workflow and all automation holds remain
unchanged. A proposed daily 05:17 UTC check, alert after three consecutive failures,
and recovery notice remain owner actions documented in `MAISHIFT_INTEGRATION.md`.

The shared player library revision remains
`f1abe2c7d93ff7f0b6610dd0bb57d4e038f609c0`; this proxy changes no portable schema,
Python validator or Session Report pinned dependency. Existing downstream
compatibility evidence is recorded in `PLAYER_IMPORT_DELIVERY.md`.

Local validation on 2026-09-21:

- 12 deterministic Worker tests passed, including enabled/disabled real workerd
  routes, SQLite coordination, fixed destinations, redirect rejection, malformed
  data, limits, source changes, lower corrections and data minimization.
- 70 new Maishift browser checks and 140 existing import/source checks passed
  across Chrome, Edge, Firefox, WebKit, desktop, mobile and 320px layouts.
  The broader `player-` run passed 219/222 checks; its three failures were
  overlapping filter-selector edits. The fresh sorting rerun passed all six
  desktop/mobile/narrow checks after those selectors were corrected.
- Python: 510 tests, OK with 7 expected skips. No Session Report dependency change.
- Localization coverage validated 850 messages; changed Python files passed
  Ruff and formatting checks. JavaScript inventory and all localization review
  fingerprints also passed against the staged source, read in memory from Git.
  This isolates the review from concurrent uncommitted filter changes without
  editing or discarding that working state.
- Four-language UI preview checks passed. English, Simplified Chinese, Korean and
  Japanese copy received a contextual AI review, not native-speaker certification.

Reviewed fictional previews: [desktop](maishift-preview-desktop.png) and
[320px narrow screen](maishift-preview-narrow.png). No live-player screenshots.

Validation workspaces (all under the documented registry DevCache root):

- Worker/runtime/types: `workspaces/20260921T045415937-082b33a0`.
- Player browser suite and screenshots: `workspaces/20260921T045219986-e779f4d5`.
- Sorting rerun: `workspaces/20260921T045821552-8c6ec3be`.
- Python suite: `workspaces/20260921T045641157-e1f2e42a`.

Local implementation commits: `42e037f` (proxy/contract/runtime), `faee3e9`
(browser adapter, localization and tests). The documentation commit follows these.
Concurrent filter UI edits and pre-existing untracked work are preserved separately.

## Simpler import UI and research follow-up

The preview now keeps the player, handle, region/PB count, date and nonzero
unmatched/excluded warnings visible. Secondary coverage/privacy information and
the source link sit in native **Import details**. The consent label is **Remember
and refresh**; Import & remember / Import once remains explicit. Existing file
import defaults are unchanged. The two fictional screenshots above were refreshed
and visually checked at desktop and 320px widths.

Validation for this follow-up:

- 70 Maishift browser tests passed in `20260921T051833323-8beaf379`.
- 140 existing import/source tests passed in `20260921T052045131-5e6067b6`.
- All seven browser/layout configurations passed, including four-language copy,
  collapsed-details behavior, corrections, hidden results and cross-tab Forget.
- 13 Worker tests and binding generation passed in
  `20260921T052149486-a9face35`, including the new transport-string regression.
- Python localization coverage passed. The scoped staged JavaScript inventory
  and language-review fingerprints passed. The working tree's global inventory
  and review checks still report separate concurrent filter-copy changes; those
  files were preserved and excluded from this change's commits.

Public sample research agrees across full tracks/export loaders in both regions
and finds unique candidates for all catalog rows. Forty International candidates
need artist-credit review. No crosswalk was installed. Player continuity and
timestamp semantics remain unresolved, so the release checklist stays incomplete.
