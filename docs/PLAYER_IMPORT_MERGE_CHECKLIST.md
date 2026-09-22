# Player imports: review and merge checklist

Prepared September 22, 2026 for `codex/maishift-proxy`, based on production
`98d1cc8e62d90eff050117771e3e965158d115e1`. This is a review candidate for the
complete import work, not an instruction to enable the main-site connector.
The existing [test page](https://maimai.party/pilot/maishift/browser/?view=catalog)
is live; its exact package and checks are in
[the deployment receipt](MAISHIFT_HOSTED_PILOT_RELEASE.md).

## Included in review

- Provider-aware v1 validation, source adapters, consent, transactional remembered
  refresh, cross-tab invalidation, Forget/Clear, and preserved file/report imports.
- Frozen full-PB Maishift reader, reviewed exact chart joins, bounded unmatched
  diagnostics, region isolation, on-demand pilot Worker and deterministic fixtures.
- Four-language source picker, help, official profile artwork, grades/ratings,
  source links, local Last Updated and quiet refresh feedback.
- Combo/sync badges, separate matching chart rows with in-place difficulty
  switching, secondary English pronunciations, uniform version artwork, and
  progressive catalog startup with integrity and cache checks.
- The accepted pilot placement/count/range design and its retained build/check
  tools. These prototype assets are explicit pending integration work below.
- Contract/privacy documentation, manual-only live checks, release evidence and
  rollback guidance. No schedule, alert, general release or announcement is enabled.

Unrelated workspace-retention edits, community-badge work, support artwork and
localization-review output artifacts stay outside this change set. Existing
production emergency fixes are included through the merged main baseline.

## Validation checkpoint

- [x] Python wrapper: 538 tests run, 7 skipped; remaining tests passed.
- [x] Worker deterministic tests and binding generation pass.
- [x] Source/refresh browser suite: 154 passing cases across all configured
  engines/layouts, including cancellation, quota, corrections and cross-tab Forget.
- [x] Current pilot: 32 localized Settings layouts and 28 hosted hash/header checks.
- [x] Ruff lint/format, all 940 localization messages, prose inventory and review
  fingerprints pass.
- [x] Browser regression coverage: 1,172 cases passed across the full run and
  focused correction run; 15 skipped. The initial run passed 1,144 cases. Its
  28 failures were stale success-message/lazy-artwork expectations and one
  full-page WebKit screenshot exceeding the image limit. All 31 focused cases
  pass after updating those checks, without changing product behavior.
- [ ] GitHub CI on the pushed candidate. The invalid job-level `runner.temp`
  reference was moved to a runner step; the corrected workflow starts normally.
- [ ] Review the final diff and confirm the accepted design has no draft variants.

Validation outputs stay under the approved registry DevCache root. Python:
`20260922T065406088-737e95c0`; Worker: `20260922T065418318-97362b4d`;
source browser suite: `20260922T065121382-859b41f7`.
Full browser run: `20260922T065449223-b3cb5f30`; focused corrections:
`20260922T070532945-c1e64f6d`. The wrapper's multi-file argument failed on Windows;
the correction run used the installed Playwright CLI directly in that fresh
workspace. Logs are retained in the registry DevCache `temp` directory as
`review-browser-20260922.log` and `review-targeted-browser-20260922.log`.

## Before production merge and activation

1. Integrate `docs/design/import-placement.*` and `player-range-controls.*` into
   shared rendering. Replace the superseded header-button draft. Preserve the
   approved count placement, grade stops, exact input and data-based rating limits;
   do not ship the prototype DOM adapters as main-site architecture.
2. Separate Maishift availability from the pilot storage flag. Keep the pilot
   namespace and require normal import consent on the main site; do not migrate
   tester data silently. Acceptance-test the normal analytics/sharing environment.
3. Complete invited-account checks: full played PB coverage, lower difficulties,
   STD/DX, both regions where available, genuine new uploads and unchanged refresh.
   Record corrections/version transitions when available. Keep unobserved cases
   explicitly open; deterministic fixtures do not establish live source chronology.
4. Review observed Worker capacity/cost and platform log-retention findings.
   Existing Paid-plan and narrow deployment permissions are already approved.
5. Resolve the shared-reader dependency checkpoint. Session Report currently pins
   Party revision `e134d585c7b738fb13e1d08dadf1c048fff6aea4` in
   `src/maimai_report/_party/PROVENANCE.json`. This review does not change that pin.
   Audit validator/observation differences and rerun downstream compatibility after
   any pin update; preserve provenance and the strict portable v1 shape.
6. Review and enable the localized announcement only for accepted capabilities,
   including its Settings replay, dialog deferral and independent seen state.
7. Capture fresh Pages/Worker baselines, exact final artifacts, privacy checks and
   rollback instructions. Obtain the production release instruction after review
   and tests. Monitoring scheduling, live dispatch and alert publication remain
   separate owner actions.
8. Retire the superseded pilot as part of the main-site rollout. Keep the current
   test page available during acceptance, then remove the pilot application from
   the published package and route the old entry points to the main chart browser.
   Verify `/pilot/maishift/` and `/pilot/maishift/browser/`, including their
   `index.html` forms, no longer run the pilot. Do not erase or silently migrate
   browser-local tester data. Inventory historical immutable deployment URLs
   separately so their cleanup cannot destroy the main site's rollback baseline.

The [general-release plan](PLAYER_IMPORT_RELEASE_PLAN.md) contains the detailed
acceptance procedure. A passing pilot and green CI alone do not close these gates.
