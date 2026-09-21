# Player import delivery — 2026-09-21 UTC

The independent import, refresh, storage and localization changes are implemented
for review. **The complete Maishift integration remains incomplete and disabled.**
The approved local proxy now verifies extraction and normalization of all 2,010
played PBs returned for the official sample. The reviewed Party chart crosswalk
is now installed locally; source chronology and deployment acceptance remain incomplete. The combined
announcement is consequently unreleased. See [proxy delivery](MAISHIFT_PROXY.md)
for the new code, privacy constraints, validation, and remaining release gates.
The [latest matching research](MAISHIFT_MATCHING_RESEARCH.md) verifies the full
tracks/export agreement in both regions and records unique candidates for every
catalog chart. All exceptional matches are now explicitly reviewed and preserved;
local mapping consumption is implemented and tested as recorded in
[mapping test evidence](MAISHIFT_MAPPING_TESTS.md): all 2,010 International and
200 Japan sample PBs match in Chrome, Edge, Firefox and narrow WebKit. Player source identity uses
the supplied username plus game region, with rename/reuse limits documented in
[the mapping decisions](MAISHIFT_MAPPING_DECISIONS.md). The preview was shortened,
with secondary copy under native Import details; new validation and fictional
screenshots are in the proxy delivery.
The [runtime verification](MAISHIFT_RUNTIME_VERIFICATION.md) now also passes both
regions in local workerd, adds bounded output expansion and per-isolate admission,
and separates the remaining upstream chronology and deployed resource gates.
The [invited pilot](MAISHIFT_PILOT.md) is now built as a separate unlisted page
and deployment artifact. Its baseline/upload/stability sequence collects the
missing evidence without writing experimental data into saved Party history.
It is not published and does not enable the normal import or announcement.

## Local preview repair and real-account baseline — September 21

The initial loopback preview was a static server: its API POST returned 501.
The replacement `tools/Start-MaishiftPilot.ps1` serves the verified artifact and
the existing bounded reader locally, restricted to the expressly selected public
username/region. It validates local Host/Origin, denies credentials/arbitrary
URLs, shares cooldown/attempt limits across tabs and never publishes a route.
The page now states that this preview is local-only. Production origin validation
and disabled release/announcement flags remain unchanged.

The supplied profile-root URL is now accepted, consistent with the observed
redirect to `/home`. A user-selected Japan read returned International (`ASIA`)
metadata; this mismatch now has an explicit localized error and still stops
before fetching tracks. A subsequent International baseline was verified in the
user's visible browser: **1,719 played PBs, 1,719 exact matches, zero unmatched,
zero excluded**. No actual score payload, profile identifier or real-account
screenshot was retained in repository artifacts. This does not verify genuine
changed uploads, snapshot atomicity or deployed Cloudflare operation.

The active preview artifact is DevCache workspace
`pilot-preview-20260921T205248260-29ee9adb`, build
`27bc2d01233e810decaf64b2e84a1479154a7dc81020827c8df82be9db18f64f`.
This supersedes the initial pilot artifact below for the repaired UI/adapter.
Worker/local-preview checks: **31 passed**, workspace
`20260921T205444596-8cab72ba`. Existing Maishift import/refresh/Forget checks:
**112 passed**, in `20260921T205443981-8b327332`. The accompanying pilot matrix
initially reported 28 test failures because its clipping assertion treated normal
scrolling of a long URL inside a native input as overflow. The corrected check
retains URL-value, field-boundary and button/select-label assertions. The complete
final pilot matrix then passed **42 tests**, including translated region errors
at 320px, in `20260921T205701075-7e7cb25e`. Localization coverage/inventory/review
checks pass with 53 pilot entries. No shared-library/Session Report pin changed.
Hosted deployment, genuine update/correction/version evidence, operating-limit
acceptance and general release remain incomplete; other checkout work is separate.

## Hosted pilot preparation — September 21

The tester's explicit choice is a hosted pilot for a few invited players. The
prepared scope is `/pilot/maishift/` plus the existing isolated Maishift proxy.
This remains a public unlisted link, not an invitation access restriction.
Deployment, invitations, account configuration, genuine account trials and live
workflow dispatch remain separate owner actions. No live account was fetched in
this preparation pass. See the [pilot guide](MAISHIFT_PILOT.md) for tester steps,
aggregate report fields, deployment merge/rollback instructions and release gaps.

Final artifact:
`C:\DevCache\projects\maimai-chart-browser-registry\6c15e789d6fd4518\workspaces\pilot-artifact-20260921T202953458-bf9f763b`.
Pilot build fingerprint:
`4eea6ebaea4a7ae236c52b5d2ec780f9c3a1b494f95766f6aaa39ac1f6e59963`.
The manifest hashes all pilot assets and the proposed path-scoped headers. Do not
deploy this directory as the whole site or overwrite existing site headers.

| Final check | Result | DevCache workspace |
| --- | --- | --- |
| Python development wrapper | 525 tests, OK, 7 skipped | `20260921T202506955-adfeac34` |
| Worker development wrapper and binding generation | 24 passed | `20260921T202508586-82f3f138` |
| Pilot browser development wrapper | 42 passed in all seven configurations | `20260921T202915607-5a05a997` |
| Localization copy, JS inventory and review fingerprints | Passed; 51 new pilot entries, 910 total in current working tree | Canonical source and DevCache dependencies |
| Pilot Python style checks and hosted checker syntax | Passed | Canonical source, DevCache tools |

The Python/Worker checks used the same final logic; the final browser pass also
verifies the subsequent language-button sizing change. An earlier pilot run had
one Firefox context-teardown protocol error; its clean retry and final complete
matrix passed without suppressing assertions. Tests use fictional profiles, the
actual Worker contract and browser adapter. No hosted or genuine-upload result
is claimed. The separate owner-run hosted smoke script requires an approved
canary and the reviewed build fingerprint.

Fictional desktop and 320px screenshots were visually reviewed in the final
browser workspace under `tests/browser/test-results/`, in the
`player-maishift-pilot-host-e8c08-dence-and-no-player-storage-desktop` and
`player-maishift-pilot-host-e8c08-dence-and-no-player-storage-narrow` directories
(each named `maishift-pilot.png`). Test outputs remain in DevCache.

The pilot reuses exact mappings and the strict v1 adapter but intentionally does
not test saved real-account imports, remembered refresh or cross-tab Forget.
Their existing deterministic evidence remains below; deployed real-account
acceptance is still required. The shared library and Session Report pin are
unchanged. Concurrent filter/artwork/other localization changes remain separate.

The exact staged tree was separately exported to DevCache workspace
`pilot-staged-20260921T203302434`: its 15 focused Python tests, eight pilot contract
tests, style checks and localization checks passed (900 staged messages, excluding
ten messages from concurrent work). All ten deployable artifact files match that
tree after normalizing checkout line endings and the resulting build fingerprint.
The supplied artifact's literal hashes were also verified against its manifest.

## Reviewable changes

- Native source selection retains file defaults and previews public Session
  Reports before Import & remember / Import once. Protected and unsupported
  report locations use the existing report-origin consent/download recovery.
- The bounded public manifest adapter validates immutable payload integrity and
  normalized v1 data. Connection metadata stays outside portable files.
- Transactional remembered refresh, cross-tab leases and generation checks
  preserve observations, corrections, hidden results and chart state. Forget
  cancels work and invalidates remembered/tab caches across reloads and tabs.
- Provider and region identities are isolated in both JavaScript and Python.
  Exact Kamaitachi joins remain intact. Unmatched identifiable records remain
  portable and cannot acquire a speculative Maishift chart match.
- Four-language copy and an accessible reusable announcement registry are present.
  The blocked combined announcement and its replay action remain hidden.
- The Maishift contract document includes measured transport evidence, remaining
  gates, the locally implemented proxy, and owner-only monitoring proposals.

Initial registry branch: `codex/player-import-sources`; the local proxy and research
continue on `codex/maishift-proxy`. The shared validator
commit is `f1abe2c7d93ff7f0b6610dd0bb57d4e038f609c0`.
The Session Report branch is `codex/player-source-compatibility`, commit
`c54749e211e08ad4ad01719e329ed9b2f5e3f483`. Only its shared player reader,
file-specific provenance, documentation and compatibility tests changed.
The reader's normalized SHA256 is
`23e716bd0ec48b45f916d1b3dcc491b0a5c55b7bb0ea275394ae0b6a9e58d275`.
Unrelated dirty/untracked work remains in both canonical checkouts.

## Validation evidence

All generated fixtures, dependencies and disposable outputs stayed in approved
DevCache project workspaces. The two images below are deliberately retained,
reviewed fictional-data exports; they contain no real player records.

| Check | Result | DevCache workspace suffix |
| --- | --- | --- |
| Registry `tools/Test-Development.ps1 -Check python` | 510 tests, OK, 7 skipped | `20260921T033030351-f26afa93` |
| Registry full `-Check browser` | 546 passed, 15 skipped | `20260921T032937290-8c664688` |
| Final source matrix, including Forget during commit and expanded PB state | 140 passed, seven browser/layout configurations | `20260921T034915104-9a7d3fae` |
| Session Report offline wrapper | 260 tests, OK, 1 skipped | `20260921T033707565-8520de6f` |
| Cross-repo `prepare_party_browser.py` / `party_browser.cjs` | Chrome, Edge, Firefox and WebKit passed | `20260921T034132430-3217c644` |
| Localization source inventory and review freshness | Passed | Canonical source, DevCache Acorn dependency |
| Maishift canary transport probe | Expected blocked result: HTML, no ACAO; browser read unavailable | Sanitized aggregate only; no profile artifact |

Registry workspace parent:
`C:\DevCache\projects\maimai-chart-browser-registry\6c15e789d6fd4518\workspaces`.
Report workspace parent:
`C:\DevCache\projects\maimai-session-report\38ad3fe0799bce9d\workspaces`.
Run source-only browser checks with
`tools/Test-Development.ps1 -Check browser -TestFile player-sources.spec.js`.
The full browser run preceded the final consent/cancellation refinements; the
source matrix specifically verifies those refinements. One intermediate matrix
also hit a Firefox context-teardown protocol error; the clean final rerun above
had no such error. No product assertion was suppressed.

Checks cover legacy datasets/offers/database migration, provider isolation,
precision and null measurements, unchanged/corrected/partial observations,
HTML/login and throttling failures, integrity rejection, cancellation, file
supersession, cross-tab Forget during fetch and commit, preserved expanded PB history, storage rejection, consent revocation, announcement
modal deferral/session fallback, keyboard radios and all four languages.
The report harness covers local/served/protected handoff consent and interrupted
payload recovery. Network fixtures are synthetic; they are not a claim of live
public-report deployment acceptance. No private report was fetched or changed.
Native-language human review and real-device mobile checks are not claimed.

## Reviewed previews

![Desktop source selector with fictional chart data](player-import-preview.png)

![Narrow source selector with fictional chart data](player-import-preview-mobile.png)

## Remaining release gates

- [x] Preserve existing file/handoff contracts, exact joins and retained history.
- [x] Validate remembered refresh, consent and transactional Forget protections.
- [x] Keep player data out of analytics/referrers/sharing; maintain separate
  announcement preferences and truthful capability gating.
- [x] Record deterministic tests and narrow-screen visual review.
- [x] Establish complete available PB access for the approved official sample in
  both regions, with the declared provider/region/username source identity.
- [x] Freeze observed fixtures, implement normalization/diagnostics, and verify
  real-source imports with exact chart matching in four local browser engines.
- [x] Test missing/private profiles, login HTML, throttling, interrupted snapshots,
  bounded output, and decoder failures. The observed full response has no pagination;
  an unknown changed contract fails closed rather than inventing page requests.
- [x] Benchmark permitted full samples and larger fictional workloads in local
  workerd; add output and capacity guards without retaining player payloads.
- [x] Build and deterministically test the opt-in hosted pilot and sanitized
  baseline/upload/stability report, with a separate deployment checklist.
- [ ] Verify source chronology across genuine changed uploads, corrections and
  version changes, and validate full-PB snapshot consistency.
- [ ] Verify upstream access, CPU/memory/cost limits and log retention in the
  intended deployed Worker, then test the actual Party-origin endpoint.
- [ ] Enable and acceptance-test Maishift and the combined announcement only
  after those gates pass. HTML access or Best 50 alone cannot pass.
- [ ] Obtain a separate owner release action; separately approve proxy deployment,
  monitoring schedule, alert publication and long-term canary.

No deployment, push, maintainer contact, issue update, live workflow dispatch,
monitoring schedule activation or private-data refresh was performed. The
subsequently approved proxy was implemented and tested locally; it is not deployed.
See [the source/storage contract](PLAYER_SOURCES.md) and
[the Maishift investigation](MAISHIFT_INTEGRATION.md) for operational limits.
