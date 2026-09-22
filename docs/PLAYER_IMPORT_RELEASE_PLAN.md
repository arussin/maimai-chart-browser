# Unified player imports: general-release plan

Current review status is tracked in [the merge checklist](PLAYER_IMPORT_MERGE_CHECKLIST.md).
The selected layout remains accepted; its integration and source acceptance gates
must be completed before the main-site release.

Prepared September 21, 2026 local time (September 22 UTC). This is a deployment
plan and local design proposal, not a production release or a new authorization
to publish. The hosted pilot and its existing permissions remain as recorded in
[the hosted release receipt](MAISHIFT_HOSTED_PILOT_RELEASE.md).

September 22 follow-up: the reviewed v9 layout is now hosted at the existing
pilot URL so real imports can be tested with the updated formatting. Main-site
deployment remains unchanged. The prototype adapters still require integration
into shared source before general release.

## Proposed final presentation

- Restore the existing logo/navigation header. Replace the unshipped large teal
  header-button draft with a smaller navy Import player data button on the right
  beside Find a chart. Remove the duplicate upper chart total and era caption.
- Use the pilot banner's existing navy, `#15283b`, with light text and a 44px
  minimum target. Keep the familiar localized action text and small upload icon.
- On phones, put the heading on its own row, then the button beneath it. Balance
  long translated labels instead of clipping them. Keep one count above the
  results list, formatted as **7,251** charts: only the number is bold, with no
  "found" suffix, and with the existing localized chart label. Align it vertically
  with Enable multi-sorting on the same row, keeping the sort-priority chips below.
- Omit the Maishift preview banner in the reviewed layout. The updated hosted
  trial uses that same layout, retaining its pilot URL and isolated scores.
- Keep Settings as the entry point from the other views, and keep Share this
  site, the profile card/link, local Last Updated, Clear and Forget in place.
- Keep the existing simple source dialog, grouped help links, source icons,
  automatic region resolution, rating/grade display, refresh consent and concise
  overwrite warning. Do not change history, import defaults or identity rules.
- Replace the four loose numeric bounds with two compact range groups. Achievement
  handles step through grade thresholds, with direct entry retaining four decimal
  places. Chart rating handles use the known minimum and maximum across the whole
  mapped imported profile, independent of current chart filters; missing ratings
  are excluded and a real zero remains valid. Both groups have a Clear action.
- Keep the numeric filter fields blank initially, showing limits as placeholders;
  the controls must not silently add a filter. Preserve explicit entries when new
  imports change the rating bounds. Disable the rating slider for a single known
  rating, and disable both its slider and fields when none are known. The group's
  Clear action remains available for any retained selection.

The local proposal is built from the checked rich public pilot, preserving its
catalog and artwork. `docs/design/import-placement.css`, `.js`, and the matching
`player-range-controls.css` / `.js` are **prototype assets**, excluded from the
general-release builder but included in the updated hosted trial. The previous
teal header implementation remains an unshipped draft; it must be replaced,
not delivered alongside this proposal, when the final design is selected.

Preview: `http://127.0.0.1:8897/pilot/maishift/browser/?view=catalog`.
This local address is a visual mockup with the real source dialog, not a live import service.
Its origin and existing pilot namespace keep it separate from saved main-site
data. No personal data is seeded. Use the updated hosted pilot for live Session
Report imports; its exact Party origin is permitted by the report host.

## What is established and what remains open

| Area | Evidence available | Still needed for general release |
| --- | --- | --- |
| Complete PB access and exact joins | Reviewed full-track contract, export agreement, both-region mapping evidence; hosted sample imported 1,719 PBs with 1,719 exact matches and grades | Invited-account coverage, including lower difficulties and STD/DX; disclose and preserve genuinely unmatched records |
| Remembered data | Hosted restore, unchanged refresh without new history, and cross-tab Forget passed; deterministic correction/race/quota tests pass | Genuine changed uploads, lower corrections, version transitions and full-snapshot consistency |
| Hosting and privacy | Fixed Worker route, bounded requests, deployed rate coordination, omitted credentials/referrers, no-store and application logs/traces off | Review populated operational metrics, resource/cost limits and remaining platform-retention findings; repeat privacy checks with the main site's normal scripts |
| UI | Four-language import flows, shared artwork, grades, ratings, Clear/Forget and Party import time are tested | Choose final placement; verify main-site empty/imported/hidden/error states and the new announcement wording |
| Compatibility | Existing v1 portable shape and legacy file/report flow remain; no Session Report pin was changed for the pilot | Audit reader divergence and the final pinned revision; run downstream checks if a shared pin changes |
| Hosted report URLs | Both trailing-slash forms resolve to the verified manifest; recovery actions have separate touch targets. The deployer supports opted-in public exports and the updated hosted pilot successfully previews Adam's report | Localhost is outside the report's exact Party-origin CORS policy; private reports retain assisted transfer. Preserve these boundaries for general release |

The existing hosted result proves sample operation, not acceptance across all
accounts or source updates. None of the open rows is marked complete merely
because the UI looks ready.

## Work order

1. **Settle the UI.** Review the banner-free desktop/mobile mockup, then replace
   the rejected header draft in shared source. Keep one prominent Charts action
   and the existing Settings entry. Update focus-return and placement tests.
   Integrate the range proposal into the existing controls and localization
   catalogs, preserving exact numeric filtering, Clear, source-change behavior,
   unknown values and keyboard access. Do not ship the mock's DOM adapters.
2. **Collect invited-test evidence.** Ask participating users to compare Party
   with their own public PB records, including ordinary lower-level charts,
   then perform a genuine Maishift upload and refresh Party. Use the separate
   upload chronology page for before/after/stable-read evidence. Check a repeated
   unchanged read adds no history. Collect legitimate correction/version-change
   evidence when available; leave those gates open if it is not available.
   Record only consented aggregate results, not raw player exports or screenshots.
3. **Accept source and operating behavior.** Resolve any mismatch, timestamp or
   interrupted-update findings. Inspect actual Worker usage after those trials
   and document the observed sample size and limits; do not call absent metrics
   zero usage. Test fail-closed contract errors and quiet retry with saved data.
4. **Prepare real production enablement.** Separate the Maishift capability from
   `maimaiPlayerContext.pilot`. Never set `pilot=true` on the main site just to
   enable the connector: that would also select its separate storage namespace.
   Keep the pilot namespace intact. Proposed default: testers re-import into the
   main site with normal consent; do not silently copy or merge pilot scores.
   Review the current Session Report pin and any shared-reader delta explicitly.
5. **Prepare the announcement.** Preserve key `player-import-sources-v1`, Settings
   anchoring, What's new replay and separate seen-state. Revise the four-language
   text to mention the visible Import player data action, rather than directing
   everyone only through Settings. Activate only with accepted capabilities;
   test first display, dialog deferral, keyboard dismissal and reduced motion.
6. **Validate the complete candidate.** Reconcile against fresh production/main
   first, preserving emergency fixes, filter behavior, artwork and all accepted
   work in this task. Export only reviewed source; exclude unrelated dirty work
   and these mockup-only assets. Run the documented Python/browser/Worker and
   localization checks in DevCache, plus downstream checks if the pin changes.
   Cover Chrome, Edge, Firefox, WebKit, four languages and desktop/phone widths;
   retest storage upgrades, source switches, stale tabs, Clear/Forget during work,
   no invented history and unknown-value handling. Inspect the actual final
   static artifact, all version logos, catalog identities and sharing/analytics
   behavior with and without imported data.
7. **Publish after a separate release instruction.** Prepare exact Pages and
   Worker versions, inventory hashes, baseline diff and rollback steps first.
   Verify the resulting immutable deployment and production, then run the bounded
   actual-origin check with an explicitly approved public canary. Preserve all
   unrelated services and routes. Do not treat deployment propagation as a reason
   to upload the same artifact again.

The existing Workers Paid plan and deployment permissions have already been
approved and applied; they do not need to be purchased or granted again for the
same scope. No new account permission or authentication change is proposed here.

## Rollback and follow-up

Before publishing, capture the then-current Pages/Worker versions; do not blindly
restore an older receipt over newer unrelated production work. Rollback can
disable Maishift availability/announcement and restore the accepted UI/Worker
version while preserving player datasets, limiter state, files/reports and other
services. Never erase player data or delete the Durable Object namespace as a
deployment rollback.

Monitoring stays a separate owner action: retain the manually dispatched contract
check with an explicitly approved canary. The proposed daily run, deduplicated
alert after three failures and recovery notification remain proposals until
separately authorized. Existing automation holds remain in effect.

## Mockup verification

The final local artifact is retained at
`C:\DevCache\projects\maimai-chart-browser-registry\6c15e789d6fd4518\workspaces\import-placement-mock-20260922-v9`.
Its receipt records hashes for the five proposal files plus the shared report
source adapter, player UI and player stylesheet, and the source
browser build, after verifying 1,481 public browser assets. The manual layout
check covers Chrome and WebKit, all four languages, and eight widths from 320
through 1280px, including the reported 537px viewport. It also checks filtered
zero/nonzero counts and count alignment with the multi-sort toggle, with chips
below. The range checks use fictional imports and cover exact percentages,
keyboard grade stepping, pointer snapping, handle crossing, stable rating bounds,
unchanged player storage while filtering, Clear, changed imports, a single known
rating and entirely unknown ratings. Range layouts cover all four languages at
320, 537 and 1280px in both engines. Screenshots and aggregate checks live in
`screenshots/`. These local checks do not replace the full release browser matrix.
Both sliders explicitly override the inherited input `max-width: 100%` so their
thumb travel matches the drawn track. Endpoint geometry is checked at 320, 537,
1024 and 1280px, with both minimum and maximum values reached through the controls.
The report fallback is also checked in the actual mock at 320, 430 and 1280px,
in four languages, including link focus and 44px actions. The shared source
adapter accepts the installation address without its trailing slash, without
following redirects or guessing endpoints for unrelated pages. The recovery
link has an explicit tab stop for WebKit. The mock includes the current player
stylesheet explicitly because the original pilot bundled that CSS; it removes
the rejected header-button draft before mounting the selected navy placement.
The report suite passed 22 checks per browser in Chrome, Edge, Firefox and
WebKit; after adding the explicit tab stop, the final recovery-layout test also
passed again in Chrome, Edge and Firefox. The final mock passed 64 placement,
24 range-layout and 24 report-recovery layout checks in Chrome/WebKit, plus
range interactions, with fictional data and no upstream reads in the tests.
No upstream profile reads, hosted edits, main-site activation or announcement
publication are part of this mockup.
