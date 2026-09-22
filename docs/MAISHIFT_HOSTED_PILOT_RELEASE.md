# Hosted Maishift pilot release

## Settings profile card - September 22, 2026, 06:57 UTC

Deployment `e4ce3121-1b10-4889-8b3f-1e8243e3ec41` is verified at the existing
[browser trial](https://maimai.party/pilot/maishift/browser/?view=catalog) and its
[immutable deployment](https://e4ce3121.maimai-party.pages.dev/pilot/maishift/browser/).
The Session Report link now sits inside the profile card using the same link
classes as Maishift. Successful refresh no longer adds a redundant saved-data
status sentence; Last Updated, progress and error messages remain.

Only the pilot player script and its versioned HTML reference changed from
`35d5af48-a079-494e-b6b1-338047d1ddec`; all 17,368 other package files match.
The Worker, main site and general-release capability gates are unchanged.
All 28 hosted hash/header checks passed. The exact package passed 32 Settings
layouts across Chrome, Edge, Firefox and WebKit, four languages, and 319/1280px
widths, with fictional imports and unchanged-refresh verification.
The source/refresh browser suite also passed all 154 cases.

Evidence: `profile-card-pilot-20260922-v1` beneath the approved registry DevCache
workspace root; browser build
`6b8fb00f7e2c9e3d465c10d6e02fe64df55dc92251cf9123b713d4d3b0b4ab0c`.
The broader review and remaining main-site gates are tracked in
[the merge checklist](PLAYER_IMPORT_MERGE_CHECKLIST.md).

## Startup performance and pronunciation coverage - September 22, 2026

Published at 06:43:35 UTC as deployment
`35d5af48-a079-494e-b6b1-338047d1ddec`
([immutable deployment](https://35d5af48.maimai-party.pages.dev/pilot/maishift/browser/)).
Cloudflare confirmed it as canonical. All 28 hosted asset hashes and pilot
privacy/cache header checks passed on both this deployment and `maimai.party`.
The earlier cache-header discrepancy is resolved without changing zone settings.

The browser pilot now starts from its verified progressive index instead of
downloading the complete analysis catalog. Startup data falls from 59,613,449 to
25,100,655 uncompressed bytes; rich chart details load on demand through the
existing integrity-checked path. All 7,251 chart IDs and exact provider/region
mappings remain intact. Only unused startup audit fields (`capabilities`,
`input_id`, per-row Maishift `snapshot_id`) are projected out; the immutable full
catalog and its provenance remain available unchanged.

The loader shares one parsed catalog, avoids embedding a second JSON copy, and
configures personal mapping once. Saved-data restoration before and after
controller startup is covered. Public content-addressed catalogs, detail shards
and media can be cached. Mutable pilot scripts/styles/manifests use `no-store`;
HTML entry routes revalidate. The existing domain-wide four-hour browser cache
TTL was observed overriding `no-cache` on JS/CSS, so that policy was tightened
only in the pilot's asset headers. No zone settings or security headers changed.
The dynamic controller URL now carries the same content revision as its preload,
matching the normal builder and avoiding a second unversioned download.

English secondary-title coverage rises from 485 to 806 song records by adding
321 reviewed full-title pronunciations from existing pinned Tachi aliases.
**馬と鹿 — Uma to Shika** is included. Original titles remain dominant. Translations,
nicknames, incomplete names and uncertain readings remain search-only. The audit
and identity guards are recorded in
[the pronunciation review](localization-review/display-readings-20260922.md).
153 Japanese-script records still lack an accepted display reading; this is not
a claim of complete pronunciation coverage.

Evidence roots beneath the approved registry DevCache `workspaces` directory:

- `performance-pilot-20260922-v1`: initial performance deployment
  `e308289f-3b32-4fb3-8b25-9b463ebdbde5`, against the retained `d557be41` baseline.
  Adds 1,024 derived assets, modifies four existing files, preserves 16,342 files.
- `performance-pilot-20260922-v2`: cache-only correction, deployment
  `629dbd0d-23bb-4069-9650-15275de6c31c`. All 17,369 application assets match v1;
  only `_headers` differs.
- `readings-pilot-20260922-v1`: final pronunciation candidate; only controller,
  loader and HTML change from the cache-corrected build. 17,367 files preserved.
  Browser build `60e32fe7f954122fe392493ba336fddad52cdd2948aa158ba687cc72d5361162`.
- `pilot-performance-20260922`: before/after Chrome CPU profiles, public network
  measurements and validation logs. Fresh contexts block provider/API/analytics
  destinations. These are local lab checks, not field Core Web Vitals.

Final hosted measurements use the same Chrome script and viewport as the
baseline. Ready means 40 initial rows rendered plus two animation frames. The
network is unthrottled; CPU 4x is a simulation, not a physical phone benchmark.

| Local Chrome measurement | Before | Final deployment |
| --- | ---: | ---: |
| First opening, normal CPU | 2,123 ms | 1,391 ms |
| Refresh, normal CPU | 2,302 ms | 494 ms |
| First opening, 4x CPU slowdown | 4,296 ms | 2,190 ms |
| Refresh, 4x CPU slowdown | 4,275 ms | 1,401 ms |
| Initial resource transfer, normal CPU | 12.74 MB | 6.39 MB |
| Refresh resource transfer, normal CPU | 12.77 MB | 1.15 MB |

These are individual before/after lab observations; network and machine load
vary. The change addresses opening/refresh. Broad searches and large result
renders can still exceed 200 ms under simulated slower CPU; this is not a claim
that every interaction or field performance target is solved. No page errors
were recorded in either final Chrome measurement.

Validation: documented Python wrapper ran 538 tests successfully, 7 skipped,
in `20260922T064110497-cddaa8c6`. The earlier performance browser wrapper passed
six progressive-loading cases, plus capacity budgets and loader integrity/retry
checks. The final exact candidate passed 32 title/difficulty layouts, 32 additional
pronunciation layouts and 64 badge menu cases across Chrome, Edge, Firefox,
WebKit, four languages and 320/1280px widths. No live account reads were made.
All 940 localization messages, source-copy inventory, review fingerprints and
scoped Ruff checks pass. Review fixtures were updated for the additional
pronunciation file; the initial fixture failures are retained in the test log.

The main manifest remains
`9cb000b90b381f32a531651f6a321a22f418d0427185e45b97fdd25f227e7c73`.
The import Worker and player storage are unchanged. All previous pilot layout,
report recovery, badge filters, multiple difficulty rows and in-place row
switching remain included. General Maishift release, broader live-account
acceptance and announcements remain separate unfinished work.

## Results, difficulty controls and title readings - September 22, 2026, 06:02 UTC

Updated the existing [browser trial](https://maimai.party/pilot/maishift/browser/?view=catalog)
with separate rows for every matching chart, hardest levels first within a title,
while preserving an in-place difficulty dropdown on each row. Dropdown changes
update scores, details and actions without moving the row; filters and exact
chart links remain authoritative. Explicit sorting restores individual chart
ordering. Original titles stay dominant, with a smaller English romaji accessory
only where a faithful stored reading is available.

Combo and Sync now normalize reviewed Maishift/Session Report aliases for display
and filtering, and their choices show the existing badge images beside localized
text. Unknown source values remain unknown. The public Session Report checked
during this work contained no AP/AP+ observations or sync values; the UI cannot
supply badges missing from the export. No datasets, revisions or history are
rewritten by these display changes.

- Pages deployment: `d557be41-d79c-4d29-8a98-8e4c159f0ca7`;
  [immutable preview](https://d557be41.maimai-party.pages.dev/pilot/maishift/browser/).
- Previous deployment / rollback target: `a41b4e99-1dd0-48cd-bdb8-1833b96a96b5`.
- Browser build: `d6c198ef3a0a30dc51882a31b2d02a0da4bcd9d7f2665c373f97a214ebb86c30`.
- Evidence workspace: `results-pilot-20260922-v4` beneath
  `C:\DevCache\projects\maimai-chart-browser-registry\6c15e789d6fd4518\workspaces`.
- `scripts/build_results_pilot_patch.py` verifies the retained baseline and
  exact source component boundaries. Only five pilot assets change:
  `challenge-review.js`, `challenge-review.css`, `player-data.js`,
  `player-data.css`, and `index.html`. All 16,341 other files are byte-identical.
  Main manifest remains `9cb000b90b381f32a531651f6a321a22f418d0427185e45b97fdd25f227e7c73`.
- Preserves the approved navy import action, absent preview banner/upper total,
  aligned chart count, precision ranges, slider endpoint corrections, hosted
  report URL recognition and recovery formatting. General release and the
  announcement remain disabled; the import Worker is unchanged.
- Python wrapper: 535 tests run, 7 skipped, successful, in
  `20260922T052734056-1850dcbb`. Final browser wrapper and matrix in
  `20260922T055640081-cebd6901`: 42 focused checks passed across Chrome, Edge,
  Firefox, WebKit, desktop, mobile and 320px; 117 catalog regressions passed.
  Coverage includes file/hosted Session Report and Maishift fixtures, badge
  display/filter/restore, unchanged observations, keyboard focus, in-place
  difficulty changes, refresh, sorting, filtering, deep links and title hierarchy.
- Exact assembled package: 32 title/difficulty layouts and 64 badge menu cases
  across four engines, two widths and four languages; plus 64 earlier layout
  cases, 24 range layouts, 24 recovery layouts and range interactions. Fictional
  narrow screenshots were visually reviewed. These checks make no live profile
  reads and block external requests.
- All 940 localization messages, source-copy inventory and language-review
  fingerprints pass. Two pre-existing technical literals were explicitly
  classified as nonlinguistic invariants with a recorded source review.
- All 16,346 candidate inventory entries and compiled source components were
  rechecked before publication. Cloudflare confirmed the expected baseline
  immediately before publishing and the new canonical deployment afterward.
  Thirty hosted asset hashes passed across the immutable deployment and live
  Party origin, including preserved main HTML/manifest and approved layout files.
  HTML checks remove only the marked Cloudflare Pages analytics injection.

No authentication, permissions, infrastructure, schedules, release announcements
or invitations changed. Wider live-account acceptance and the general release
remain separate work. The current preview's storage namespace is unchanged.

## Formatting and report URL update - September 22, 2026, 05:05 UTC

The hosted browser trial now uses the reviewed v9 local formatting: the navy
import action, no preview banner or upper total, the count aligned with
multi-sorting, achievement/rating ranges, corrected slider endpoints and the
report recovery dialog. It remains an isolated pilot; general release and the
announcement stay disabled. The prototype adapters still need integration into
shared source before general release.

The report host now permits public export reads from Party. A real browser on
this updated layout reached the correct **Import this profile?** preview using
`https://adamrussin.com/maimai` without a trailing slash. The preview was cancelled
without committing data. Localhost remains outside that CORS permission.

- Pages deployment: `a41b4e99-1dd0-48cd-bdb8-1833b96a96b5`;
  [immutable preview](https://a41b4e99.maimai-party.pages.dev/pilot/maishift/browser/).
- Previous deployment: `90412f50-feaa-4910-b8b7-ea3e8bfa797f` (original pilot below).
- Browser build: `c49a966269629655a81f69f427c75da5e1d2bfdc96292d4af592f56a38557f51`.
- Evidence: DevCache workspace `report-url-pilot-patch-20260922` beneath
  `projects/maimai-chart-browser-registry/6c15e789d6fd4518/workspaces`.
- `scripts/build_report_url_pilot_patch.py` verifies the retained inventory and
  reviewed layout against canonical source. Five pilot files are added, three
  existing pilot files change, and 16,338 files remain byte-identical. Changed
  script references have new version hashes. Main-site files and the Worker are
  unchanged; unrelated work remains outside the package.
- Exact artifact: 64 layout cases, 24 range layouts, 24 report-recovery layouts
  and range interactions passed in Chrome and WebKit, four languages and eight
  widths. Screenshots contain fictional data only. The report-source module is
  identical to the one that passed the documented browser wrapper in
  `20260922T040855775-474f039a`.
- 28 hosted asset checks passed across the immutable deployment and live Party
  origin, including main HTML/manifest and updated pilot files. HTML comparisons
  exclude only the observed Cloudflare Pages analytics injection, which remains
  blocked by pilot CSP.

No new permissions, score imports, Maishift live reads, schedules or general
release activation were performed. Existing pilot storage is preserved.

## Original pilot publication

Published September 22, 2026 UTC following Adam's explicit test-page request,
Workers Paid approval ($5/month plus usage), and approval of the narrowly scoped
deployment permissions. This releases the **unlisted public pilot only**.
General Maishift availability and the combined announcement remain disabled.

- [Chart browser trial](https://maimai.party/pilot/maishift/browser/)
- [Upload chronology check](https://maimai.party/pilot/maishift/)
- [Immutable Pages deployment](https://90412f50.maimai-party.pages.dev/pilot/maishift/browser/)

The pilot accepts supported public usernames and profile URLs; it is not limited
to the local sample account. It has no invitation enforcement or sign-in. Player
storage is isolated from normal Party storage. No invitations were sent.

## Deployment and provenance

| Item | Recorded value |
| --- | --- |
| Pages deployment | `90412f50-feaa-4910-b8b7-ea3e8bfa797f` |
| Previous Pages deployment / rollback target | `88250ed3-dc47-4921-971c-d334b3ff0ee5` |
| Preserved production revision | `98d1cc8e62d90eff050117771e3e965158d115e1` |
| Feature checkout HEAD, with staged changes | `cfb26eef1c5c0b0102e859433a8603d687f3a7fb` |
| Worker | `maimai-player-imports` |
| Worker version | `5e36182a-1272-43ed-8a09-c3df43bef1cb` |
| Exact route | `maimai.party/api/player-import/maishift` |
| Main manifest SHA-256, unchanged | `9cb000b90b381f32a531651f6a321a22f418d0427185e45b97fdd25f227e7c73` |
| Pilot build | `10a628cd931c1226a17e20ce8399dcaffe03a17ceb7fef1a6eddb59e7a065dc5` |
| Browser build | `249edf0427840ecb3d16461ab66411df5255508573909c93a14d7da5dd9e1423` |
| Browser manifest SHA-256 | `54144167365ea8a54bb1a4e8c4a75b003cf0d9a50651bf364e738ab8da763f2d` |
| Full catalog SHA-256, unchanged | `d326e1380acfa65fdb941689a67cf8ff74baae9574f8c490f4d7ac664a81a154` |

Release evidence is retained under:

`C:\DevCache\projects\maimai-chart-browser-registry\6c15e789d6fd4518\workspaces\hosted-pilot-release-20260922T023015439`

`public-inventory.json` hashes all 16,341 upload files. All 14,850 baseline
content files remain byte-identical; only `_headers` is extended, alongside
1,490 new pilot files. `preparation.json`, `pages-deploy.log`, `hosted-assets.json`
and aggregate hosted-test results record assembly and verification. Source was
exported from the reviewed Git index, excluding unrelated unstaged work.
No Git push, merge, workflow dispatch or schedule change was performed.

The first upload was rejected locally before upload because its complete catalog
was 56.9 MiB. That attempt remains in `hosted-pilot-release-20260922T020134450`.
The pilot builder now uses the existing production loader's hashed 8-MiB parts.
It uses a progressive index when that index fits; this rich pilot's index also
exceeds Pages' 25-MiB limit, so its eight parts reconstruct the original catalog
exactly. No chart, mapping, artwork or evidence was removed. Build-time file-size
and file-count guards prevent a repeat. The largest combined-site file is
24,675,597 bytes. The successful package was uploaded once.

## Service configuration and privacy

The exact deployed configuration is preserved in
[`wrangler.pilot.jsonc`](../player-import-worker/wrangler.pilot.jsonc).
The default configuration remains disabled and unprovisioned for local testing.
The pilot has a SQLite `ProfileLimiter`, client namespace `202609220001` with
10 attempts per 60 seconds, and a 1,000-ms request CPU ceiling. Namespace and
route separation were checked against existing support/community services.
Existing request bounds, shared profile cooldowns and fixed upstream destinations
remain in force. There is no background polling, score cache, or score database.

Workers Paid was activated once through Cloudflare's checkout. The existing
Wrangler login retained user/account read, Pages write and offline refresh;
only Worker-script write (including Durable Objects), Worker-route write and
zone read were added through the approved official OAuth flow. `whoami` verified
the seven scopes. No credential values were read or saved into source/artifacts.
The API connector's earlier Worker-write refusal created no partial resource;
deployment used the authorized CLI instead.

The dashboard explicitly shows Logs, Traces and Logpush off, cache disabled, no
cron triggers and no queues. The API verifies no tail consumers and disabled
workers.dev/preview URLs. This does not claim zero Cloudflare platform retention.
The connector could not list account/zone Logpush jobs. Account-wide spending
caps and sustained-load capacity are not established by this pilot.

Pilot responses use no-store, no-referrer, noindex/nofollow, nosniff, frame denial
and source-specific CSP. Global no-referrer/nosniff headers are inherited once:
Pages concatenates duplicate values, so identical pilot entries are omitted
from the appended stanza. The normal site's header rules remain intact.
Cloudflare injects its standard analytics script into HTML; pilot CSP blocks it.
The hosted browser test observed zero unexpected network requests, including
analytics. API requests omit cookies, authorization and referrers. Logs contain
aggregate checks only; no real profile screenshots, traces, payloads or saved
browser state were retained.

## Verification

- Documented Python wrapper: 532 tests ran successfully, seven skipped.
  Workspace `20260922T022530616-2d1f45ca`. After the final large-index fallback,
  all 15 focused pilot/public-release tests passed on the exact exported source.
- Documented browser wrapper: **154 passed**, covering Chrome, Edge, Firefox,
  WebKit, desktop/mobile/320px, all four languages, grades/ratings, refresh,
  corrections, storage failures, source switches, Clear and cross-tab Forget.
  Workspace `20260922T022549209-13b2887a`.
- The final rich artifact passed **42 additional browser checks** across the
  same browser/layout matrix. Fictional screenshots are in `browser-results/`;
  narrow layout, grade badges, rating badges and shared artwork were inspected.
- Worker wrapper: **39 passed**, including real local workerd and SQLite leases;
  generated binding types and the complete deployment dry-run passed. Workspace
  `20260922T015934135-74e9d1c3`; Wrangler 4.135.0.
- **38 hosted asset checks** passed across the immutable deployment and
  maimai.party, including every catalog part, both entry pages, manifests and
  player modules. HTML comparison removes only the observed Cloudflare beacon
  injection. The main manifest and main HTML match the preserved baseline.
- `scripts/check_maishift_browser_hosted.mjs` passed on the actual Party origin:
  **1,719 matched PBs and 1,719 displayed grades**, chart ratings visible, zero
  invented plays, remembered restore, one manual unchanged refresh without new
  history, and Forget propagated across two tabs and survived both reloads.
  The successful run made two API requests and zero unexpected requests.
  Earlier smoke attempts exposed test timing/foreground assumptions: the final
  test waits 31 seconds after the local commit and foregrounds the refreshing
  tab. No deployed app changes or repeat deployment were needed.
- The separate `scripts/check_maishift_pilot_hosted.mjs` upload-check smoke also
  passed: one real read, 1,719 played/matched PBs, zero excluded records, zero
  invented plays, and the exact approved pilot build. Changed-upload evidence
  remains explicitly false.

The hosted browser check requires `MAISHIFT_CANARY_APPROVED=true`, explicit
`MAISHIFT_CANARY_URL` and `MAISHIFT_CANARY_REGION`, the exact
`MAISHIFT_BROWSER_MANIFEST_SHA256`, a prepared `MAIMAI_NODE_MODULES_ROOT`, and
DevCache `TEMP`. It is manually run and never part of deterministic PR tests.
The separate upload-check smoke uses `MAISHIFT_PILOT_BUILD` instead.

## Remaining acceptance and rollback

The invited trial must still establish genuine changed uploads, lower source
corrections, version transitions and full-PB snapshot consistency across accounts.
The initial Cloudflare metrics view showed **no data**, not measured zero usage;
actual CPU/memory distributions and broader operating cost remain unverified.
Successful real imports establish deployed transport and sample operation, not
worst-case workload acceptance. General release and the announcement remain off.

Rollback is an owner release action: disable `MAISHIFT_ENABLED` for this Worker
and restore the previous Pages deployment after checking for newer unrelated
production changes. Preserve browser data, limiter state, support routes and
all other services. Do not delete the Durable Object namespace. Monitoring,
notifications, invitations and general-release activation are separate actions.
