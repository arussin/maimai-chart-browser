# Player import delivery — 2026-09-21 UTC

The independent import, refresh, storage and localization changes are implemented
for review. **The complete Maishift integration remains incomplete and disabled.**
There is no verified real-source full-PB Maishift import, frozen upstream schema,
or exact chart crosswalk. The combined announcement is consequently unreleased.

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
  gates, an unimplemented proxy proposal, and owner-only monitoring proposals.

Canonical registry branch: `codex/player-import-sources`. Its shared validator
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
- [ ] Establish a permitted Maishift resource with complete available played PBs,
  stable provider/region/chart identity, timestamps and pagination/completeness.
- [ ] Freeze observed fixtures, implement normalization/diagnostics, and prove a
  real-source import with exact chart matching and Party-origin access.
- [ ] Verify private/missing profiles, interrupted pagination and all newly
  observed upstream failure cases against that future frozen adapter contract.
- [ ] Enable and acceptance-test Maishift and the combined announcement only
  after those gates pass. HTML access or Best 50 alone cannot pass.
- [ ] Obtain a separate owner release action; separately approve any proxy,
  monitoring schedule, alert publication and long-term canary.

No deployment, push, maintainer contact, issue update, live workflow dispatch,
monitoring schedule activation, private-data refresh or proxy was performed.
See [the source/storage contract](PLAYER_SOURCES.md) and
[the Maishift investigation](MAISHIFT_INTEGRATION.md) for operational limits.
