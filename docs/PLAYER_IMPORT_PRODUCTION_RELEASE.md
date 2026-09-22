# Player import production cutover

Adam authorized the main-site rollout after CI on September 22, 2026, including
retirement of the previous pilot. This record supersedes the earlier pilot-only
release gates where it explicitly records completed production integration.

## Candidate

- The approved navy Charts import action, single count aligned with multi-sort,
  grade-stop achievement range and imported-rating bounds now use shared source.
  Production does not load the design mock's DOM adapters or its preview banner.
- An explicit build capability enables Maishift independently of the pilot flag.
  Main-site storage remains `maimai-player-data`; pilot scores remain separate.
  Testers import again with ordinary consent. No migration or deletion runs.
- All four localized help pages and the source icon are in the public asset
  allowlist. The announcement refers to the visible import action and retains
  its independent `player-import-sources-v1` preference.
- The release assembler verifies the accepted public inventory and retained
  package before building. It preserves all 14 historical catalog entries and
  their immutable assets, payment files, favicons and unrelated public pages.
  The new catalog is projected from the canonical registry, retaining reviewed
  artwork and prepared analysis. No private export enters the artifact.
- The pilot application is excluded. The old `/pilot/maishift` entry and all
  descendants redirect to `/?view=catalog`. Historical immutable deployments
  remain available for rollback; removing the canonical pilot is not deletion
  of all prior Pages deployments.

## Shared dependency checkpoint

Session Report retains Party revision
`e134d585c7b738fb13e1d08dadf1c048fff6aea4` in its checked-in provenance file.
The current Python reader differs only by extracted provider-aware identity
validation and Maishift provider/region chart-prefix validation. Kamaitachi's
identity rule, record fields, sealing, observation and reconciliation functions
are unchanged. This is a one-way report-to-Party transfer: no new Session Report
reader capability or pin update is required. The portable v1 shape remains
strict. Existing deterministic file/report and JS/Python parity tests apply.

## Operational evidence and limits

The already deployed import Worker is unchanged at version
`5e36182a-1272-43ed-8a09-c3df43bef1cb`. Its fixed upstream destinations,
credential/referrer omission, bounded requests and per-client/per-profile limits
remain in effect. A read-only account check on September 22 confirmed the same
deployment and `logpush: false`; it did not provide a platform-wide retention
guarantee or a measured workload/cost distribution.

Earlier approved sample imports established deployed full-PB transport and
exact mapping, including lower difficulties and STD/DX. Deterministic tests
cover unchanged reads, lower corrections, interruptions and stale-tab Forget.
Genuine new-upload chronology, version transitions, correction samples and
capacity distributions across many invited accounts remain unobserved. Do not
present those as measured production outcomes. Manual contract checks remain
separate; no recurring workflow, alert, maintainer contact or invitation is
activated by this release.

## Issue audit

Open issues were checked in both repositories before the rollout:

| Issue | Decision |
| --- | --- |
| Chart Browser #30, Add one-click Maishift player-data import | Closure candidate after CI and live release verification. The current public PB contract supports available profile/rating, PB, DX score and badge values, with observations rather than invented plays. Docs identify the observed public source and the absence of an official API/cooperation agreement. No closure was performed by this audit. |
| Chart Browser #38, SEO song/version pages | Keep open. Faster catalog startup does not deliver static song/version pages, sitemap coverage or its SEO acceptance criteria. |
| Session Report #20, report localization | Keep open. Localized import help does not localize the report application. |

## Verification and rollback

Run the complete Python/browser/Worker and localization checks for the final
commit. Test the exact assembled artifact with fictional data before publishing,
then verify immutable and canonical assets and all four former pilot entry
forms. Run only the explicitly approved sample for the real-source smoke check;
keep raw account data, URLs and screenshots out of saved results.

The immediate rollback baseline is Pages deployment
`e4ce3121-1b10-4889-8b3f-1e8243e3ec41`. Recheck canonical state before rollback.
Restore that Pages version without touching browser storage, limiter state,
Worker namespaces or unrelated services. Release/verification receipts remain
in the approved DevCache workspace; append the final deployment identity and
test result when the rollout actually completes.
