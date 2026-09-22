# Import source presentation — 2026-09-21

The source selector groups file and hosted Session Report imports with one help
link; Maishift has its own. Both links open locally bundled, localized READMEs,
rendered as static HTML, at stable `#session-report` and `#maishift` anchors.
The Settings import item has no separate question mark. Radio rows share compact
spacing and decorative icons with empty alt text; the radio labels remain the
accessible source names. Selecting a source or opening help makes no upstream
request. Help links follow the current UI language and omit referrers/opener.

The Maishift icon is the unmodified public
`https://maimai.shiftpsh.com/favicon.ico`, downloaded September 21, SHA-256
`38f51467394d0fb2f4aff9496f424d96ec57af67131248e870588cb306b895d1`.
It identifies that service; it is not Party artwork or a claim of endorsement.
The file/report icon reuses Party's existing embedded 32px favicon. Icons are
served locally so they do not disclose a dialog opening to Maishift.

## Verified rating and region contract

One bounded logged-out profile read of the already-approved official sample
verified `userRecord.profile.rating` as a nonnegative integer. The public home
page displays the total profile rating. This is distinct from fractional
per-chart `r.g`, whose verified integer contribution is now imported into strict
v1 portable records. Missing and estimated chart ratings remain unknown.
Only field names/types and aggregate evidence were recorded; no raw profile,
friend code, avatar, scores or personal screenshot was retained.

The Worker now returns the optional total rating with validated identity
metadata. The adapter validates it again. The import preview and Settings use
the same official rating badge and label it Maishift rating. A missing value
shows dashes and Rating unknown, without assigning a rating tier. Zero is valid.
The number is stored alongside the dataset in the connection or temporary tab
entry; it is not added to portable v1 datasets. A rating-only refresh updates
display metadata without adding snapshots, PBs, plays or sessions. Older source
observations do not replace the displayed rating.

Static inspection of the publicly served `assets/main-B0wkGPQy.js` confirmed
the player region enum has JAPAN and ASIA, whereas availability adds NORTH_AMERICA.
Its `gk` mapping sends `jp` to JAPAN and `intl`/`na` to ASIA. North America
therefore does not introduce a third player identity namespace. Explicit
`@jp`, `@intl` and `@na` URLs select the record region without fetching. There is
no separate region selector. Bare usernames and unqualified URLs use an initial
manual `auto` request: the existing profile loader requests ASIA, then its
validated returned region selects both the full-track read and closing profile
read. This uses the same three-read bound; it never probes a second profile.
The preview links to the resolved regional profile. If both exist,
International is selected; use an explicit `@jp` link for Japan. Display language
does not select a region. Connections always persist `intl` or `jp`, never `auto`.
Refresh and explicit URLs still reject region mismatches. All regional choices
share one handle quota so automatic selection cannot bypass the cooldown.
The local pilot also rejects an unapproved returned region before reading scores.

## Follow-up simplification

Removed the redundant external Session Report guide link and the Import details
disclosure. The two localized question marks remain; the confirmation retains
identity, region, PB count, capture date, unmatched/excluded warnings and consent.
Unknown chart ratings no longer repeat in each score row. Missing measurements
remain null in the dataset and are excluded by a numeric rating filter; total
profile rating and known per-chart ratings continue to display normally.

Static inspection of the same public client's `packedTracks-BdfXGpoT.js` and
`RecordRow-CUnLZSM2.js` now verifies that `r.g` becomes `record.rating` and the
ordinary record row displays its floor. Adapter v2 imports that contribution;
estimated constants mark the source rating as inaccurate and stay unknown.
The same-observation migration and its history semantics are described below.

The full local pilot includes the verified retained jacket/transcription package.
All version logos use one shared manifest, including inventory-only builds.

Settings now shows the profile card, one localized Last Updated timestamp, and a
linked Maishift username. The timestamp uses the source update date when connected,
otherwise the retained observation date. Removed the remembered/tab label,
verbose tooltip and separate checked/success/source dates; operational metadata
is still retained internally. The profile link also works for temporary imports.
Failure/retry status remains available. Adam clarified that removing the region
selector applies only to import; the independent chart availability filter stays.

## Validation of the simplified UI

All disposable outputs below are under
`C:\DevCache\projects\maimai-chart-browser-registry\6c15e789d6fd4518\workspaces`.

- Documented wrappers: 231 Maishift browser checks passed in
  `20260921T221540701-5318bc29`; 37 Worker tests and binding checks passed in
  `20260921T221540712-146ab6be`; Python ran 529 tests successfully with seven
  skips in `20260921T221744859-776805ad`. These wrappers included the current
  working tree; unrelated catalog work remains excluded from the staged pilot.
- Staged Settings build `import-settings-staged-20260921T222527485`: all 383
  player browser checks passed, plus ten consecutive Firefox reload checks.
  An earlier staged run had one Firefox click timeout after reload. The test now
  waits for catalog loading before reopening import, matching initial setup.
- Final staged artifact `import-settings-final-20260921T222720860`: all 84
  browser-pilot checks passed after guarding unverified portable profile URLs.
  Includes Chrome, Edge, Firefox, WebKit, desktop/mobile/320px, all four languages,
  automatic regional resolution, explicit regional switching, persistence,
  correction/no-new-history behavior, Forget and source-switch races.
- Localization inventory, copy and review fingerprints pass (920 staged messages).
  English and Japanese 320px Settings screenshots were visually reviewed; the
  checked-in tests retain fictional screenshots for all four languages.
- The local loopback preview now serves that exact final artifact, browser hash
  `c9cdf22f7eb7e2cc9b3027e617c7be93d2888a31d0f004d06f5af72b190925b4`.
  One manual read of the previously approved public canary resolved International,
  previewed 1,719 PBs and its total rating, and completed Import once. The Settings
  card then showed one update timestamp and one profile link. No remembered live
  connection or deployment was enabled. No raw canary data or screenshots retained.

At the end of the earlier UI-only check, chart ratings and artwork packaging
were incomplete. The follow-up below implements them; real-upload chronology
and hosted-pilot deployment remain incomplete; this UI verification does not
clear those release gates or release the combined announcement.

Localization was reviewed by Codex against the actual controls and English
README in Simplified Chinese, Korean and Japanese. The review preserves the
public/private distinction, unknown ratings, consent, data locality, separate
regional identity and limited pilot availability. This is AI review, not
native-speaker certification. Browser tests cover both help anchors and all four
languages at 320px, icons, keyboard use, rating persistence and the source gate.


## Follow-up: profile links, chart ratings and shared artwork

The compact card now links its username to the validated regional Maishift URL,
with no referrer or opener. Removed the visible region label and duplicate footer
link. PB count and the single Last Updated timestamp remain. Stored provider and
regional identities are unchanged; the chart browser availability filter remains.

Adapter v2 imports Math.floor(r.g), matching the observed public row display.
The source marks t.x === 0 ratings as estimated; these and absent ratings stay
unknown. Achievement precision is unchanged. At an identical source timestamp,
only missing ratings with every other chart/record field equal may enrich an
existing Maishift observation. Hash references are updated without adding plays,
captures or snapshots. Other equal-time score changes still fail closed. Older
observations are not backfilled from newer timestamps. Unknown/known rating
metadata alone is not shown as a PB change; known corrections still are.

Removed the MAGiCAL runtime exception. All 28 version logos now use the same
public-artwork manifest, content-addressed WebP paths, integrity checks and
fallback. The existing reviewed MAGiCAL image was converted losslessly with an
RGBA pixel comparison. The other 27 are the verified retained logo collection.
The source image remains retained for provenance, but is not served separately.
`assets/version-artwork/manifest.json` records hashes, source revision and credit.

The pilot builder accepts an explicit retained package. The current package was
selectively restored from the accepted registry archive into DevCache and every
referenced file hash/size checked (1,464 files). Package descriptor SHA256:
fb1660a216ad0550a6e69d9853dd02ba0014087b3b06a5556341dcaedd6f2322.
Its 1,425 song artwork entries are reconciled against current registry identities;
it never replaces the current inventory. Earlier missing-artwork/rating notes
above describe superseded previews. Hosted deployment and real-upload chronology
remain separate, incomplete release gates.


## Final verification of the rating/artwork follow-up

- Python wrapper: 532 tests ran successfully, seven skipped, in
  `20260921T225124996-a4047fce`.
- Worker wrapper: deterministic service/coordinator tests and binding types passed
  in `20260921T224925084-782472ba`; final adapter unit checks also passed.
- Staged full-artwork build: 397 player/browser checks passed in
  `ratings-artwork-final-20260921T225629801`.
- Final staged artifact: 91 browser-pilot checks passed in
  `ratings-artwork-delivery-20260921T225952827`, covering Chrome, Edge, Firefox,
  WebKit, desktop/mobile/320px and four languages. Includes exact-source rating
  enrichment, one snapshot/capture and zero plays after upgrade, reload, numeric
  rating filtering/sorting, regional isolation, source switches and Forget races.
- Shared-logo/catalog checks: 100 passed in `shared-logos-20260921T230303341`.
  Known versions use mapped media; unmapped versions share the missing fallback.
- Localization: 921 messages and all recorded review fingerprints pass. English
  import and Japanese Settings fictional screenshots were visually reviewed.
- All 1,484 final artifact files match their declared hashes; its implementation
  inputs match the staged source. Browser build SHA256:
  `414ca3999c5e4f04b14992f2aa455014d27729d8c9f25ce26f5c1f29d3434a11`.
  It is served only on loopback port 8896. The real approved canary was imported
  once, upgraded from the older null-rating data, and restored on final reload.
  The first displayed contribution is 306 RT; loaded jacket images and the
  linked, region-free card were checked in the actual in-app browser. No raw
  player payload, real-player screenshot file or remembered live connection was
  created for this verification.

Earlier failures exposed stale MAGiCAL-only fixture/release assumptions and a
Windows test-server MIME default. Those were removed/fixed. The new rating test
also needed to expand Your results before clicking its inert controls. These
failures were resolved and the affected checks passed; no forced clicks were
used to bypass the collapsed controls. No deployment or workflow was dispatched.

Fictional screenshots are retained under the final delivery workspace's
`tests/browser/test-results`, including `profile-import-*.png`,
`profile-settings-*.png` and `maishift-browser-fictional.png`.

## Clear and replacement follow-up

Settings includes **Clear player data** whenever a temporary or saved profile
exists, including when scores are hidden. Clear removes the current scores, tab
cache, saved dataset and refresh connection. The transactional invalidation epoch
also records a clear marker, so other tabs discard scores and a tab that missed
notifications catches up when focused. Requests and pending commits from the old
generation cannot restore the cleared profile. Storage failures preserve the
working data and offer a normal retry. Announcement and site preferences remain
separate. **Forget remembered player data** retains its existing narrower behavior:
stop persistence/refresh while keeping the current scores visible in that tab.

When scores are already loaded, the source picker shows one short red notice.
The existing profile confirmation identifies an update for the same player or
replacement by a different player/provider/region. Same-player history merging,
newer observations, file defaults and report handoffs remain unchanged; cancel
does not replace scores. Temporary imports still do not overwrite an independently
remembered profile unless the existing same-connection opt-out rule applies.

AI contextual review covered seven added messages in English, Simplified Chinese,
Korean and Japanese. Clear means removing imported browser data, not deleting the
upstream account. Replacement and same-player history retention are distinguished
in every translation. No regional terminology, song identities or numeric
placeholders changed. This is not native-speaker certification.

Verification: the documented browser wrapper passed 18 focused checks in
`20260921T232000394-3edacf27`. The staged full-artwork build passed all 432 player
checks in `clear-import-delivery-20260921T232034146`, including Chrome, Edge,
Firefox, WebKit, desktop/mobile/320px, four languages, pending refresh/commit
cancellation, missed cross-tab notifications, stale writes and failed-clear
rollback. The initial pending-commit test used an already reconciled different
player, which never entered its artificial hash delay; changing the fixture to a
same-player merge exercised that delay and passed. No product timeout was hidden.

All 928 staged localization messages and review fingerprints pass. Narrow English
import and Korean Settings fictional screenshots were visually checked. The
staged implementation matches the tested snapshot; all 1,484 pilot artifact files
match their manifest. Browser build SHA256:
`de2f47322d17c586ffe52b6cf80c8a48bc97dfa3df46f43eb7a1190b0752c8bd`.
This build now serves the existing local preview on port 8896. The actual in-app
tab shows Clear in Settings and the red import notice while retaining its current
scores. No extra upstream read or public deployment was needed. Fictional
`import-replacement-*.png` and `profile-settings-*.png` remain in the test results.

## Production hotfix integration (2026-09-21)

Fetched and merged production PR #41 at
`98d1cc8e62d90eff050117771e3e965158d115e1` into `codex/maishift-proxy`.
Local merge commit: `cfb26eef1c5c0b0102e859433a8603d687f3a7fb`.
The demo includes the reviewed genre normalization, latest-catalog URL behavior,
availability controls, cabinet labels and literal version/brand names, alongside
the staged Maishift, rating, shared artwork and Clear/import-notice changes.

Preservation snapshots remain in Git: `4b6f1f556dfa945698a4ae76e5d49ce4d8c3a7e4`
contains the original index, tracked edits and untracked files;
`511f466659be5d51f8e5996a23cede1472cfefbd` contains the tracked-work snapshot.
All pre-integration file contents were accounted for against those snapshots.
Localization review records were combined semantically; one duplicated hotfix
test block introduced by the merge was removed. The shared International message
now belongs to the production messages catalog, with its duplicate removed from
the Maishift catalog. Unrelated development-layout edits and untracked work remain
outside the staged delivery. No recovery stash was dropped.

The live site's versioned loader and bundled registry/comparison/overview sources
were checked against the fetched production commit. The static check receipt and
pre-integration file manifest are retained in the DevCache workspace
`prod-hotfix-integration-20260921`. No player data was part of this comparison.

The staged full-artwork demo is in `prod-hotfix-demo-20260922T000300386` beneath
the registry's approved DevCache workspaces. All 1,484 artifact files match their
manifest, and the staged implementation inputs were checked. Browser build SHA256:
`5560f752d46228db3973bd7c96c3b66ad71ee9b7b5ba463184fe073f4212fe46`.
It serves the existing loopback preview on port 8896. The actual in-app tab was
reloaded: availability and six genre choices are present, while existing scores,
chart ratings, loaded jackets, the linked profile card and Clear player data
remain available. No additional upstream profile read was made.

The Python wrapper ran 532 tests successfully, with seven skipped, in
`20260922T000212422-ab2147fa`. All 942 localization messages and their review
fingerprints passed. The integrated browser run passed 659 of 660 checks; the
remaining WebKit check attempted to scroll an activity figure while progressive
loading replaced it. Its test now scrolls the stable chart row, following the
existing progressive-loading test pattern. Product code was unchanged by this
test correction. The documented browser wrapper then passed all 48 localization
checks in `20260922T001042620-fa0e5b6a`, including the corrected WebKit check,
desktop/mobile/narrow layouts and all four languages. Together these runs cover
all 660 selected checks, with the initial timing failure retained as evidence.

This is a local integration, not a deployment or push. Hosted pilot activation,
real-upload chronology and the remaining release gates are still incomplete.

## Chart count placement follow-up

Moved the existing live chart count below the sorting controls, immediately above
the list headings. It is right aligned, bold and 16.8px, with its localized text
and status semantics unchanged. The rebuilt local preview is
`chart-count-preview-20260922T001735145` (browser build
`bcd3edecc037f5225cb541c0ed5f7cf7034f3bfb58d43bad7f0c867f9ec911c0`).
Browser checks at 1280px and 320px confirmed all four languages fit without
clipping or page overflow; desktop and narrow Japanese layouts were visually
checked. Zero-result and restored full-result counts were also checked. The
existing loopback demo was updated; no public deployment was made.

## Last Updated semantics follow-up

Settings now shows the time of the last successful import or refresh into Party,
not the provider's observation date. `lastImportedAt` belongs to local dataset
storage and the temporary tab cache, outside the portable v1 dataset. Import
confirmation determines the time; opening a preview or restoring saved data does
not advance it. Remembered sources without this new field can restore their
existing local `lastSuccess`; old file/temporary imports without a recorded local
time show the localized Date unknown until imported again.

A successful unchanged refresh updates this metadata atomically with the saved
connection and notifies other remembered tabs. The portable bytes/revision and
observation history stay unchanged. Failed reads, rejected older responses and
failed local commits preserve the previous time. Forget retains the timestamp
with the still-visible in-memory scores; Clear removes it with those scores.
Refresh attempt timestamps and cooldowns remain intact.

The documented browser wrapper passed 453 checks in
`20260922T002449867-fe6d3fda`. A final refinement preserves the claimed attempt
timestamp when saving unchanged data; its exact staged full-artwork build is
`import-time-preview-20260922T002619283`, browser build SHA256
`4aebb9c494c2395ce25d452f1e9b0ef2e34a93d667409041eb9387b95c7f4072`.
All 1,484 artifact files and the modified staged implementation/test inputs were
verified. All 942 localization messages and review fingerprints pass. Narrow
English and Simplified Chinese fictional Settings screenshots were visually
checked. This build serves port 8896 and the existing demo tab was reloaded; no
extra live profile read or public deployment was performed.

The final staged build passed all 147 browser-pilot checks across Chrome, Edge,
Firefox, WebKit, desktop/mobile/320px and four languages. Timestamp checks cover
delayed confirmation, remembered and temporary file reloads, unchanged refreshes,
cross-tab synchronization, repeat-click cooldown, failed reads and commits, older
upstream data, legacy local timestamps, and unchanged portable history.

## Grade display and concise overwrite notice

Maishift's public client confirms all achievement-to-grade thresholds; the source
URL and hash are recorded in `MAISHIFT_INTEGRATION.md`. A display fallback now
fills blank Maishift grades in current records and history rows. The list, grade
filter and sort share that value. Null achievements remain unknown, and exact
zero is D. Portable bytes, hashes, observations and their dates remain unchanged;
previously imported scores gain grades on reload without reimporting.

The source picker uses Adam's exact text: "Importing will overwrite data from the
currently imported account." It appears only with an active account during a new
manual import. Different-account confirmation repeats it; same-account previews,
first imports, ordinary Settings and refresh do not. Existing reconciliation and
different-provider/region isolation remain unchanged. Simplified Chinese, Korean
and Japanese wording was reviewed in context and recorded in the localization
review; this is an AI language review, not native-speaker certification.

The documented browser wrapper passed **467 tests** in
`20260922T003803680-2160c9a4`. The exact staged full-artwork build in
`grade-preview-20260922T003848610` passed **42 focused browser checks**, covering
Chrome, Edge, Firefox, WebKit, desktop/mobile/320px and all four languages. All 940
localization messages and review fingerprints pass. Boundary checks cover every
grade floor, one unit below, zero, null, invalid inputs and the reported examples.
Reload, history, filtering and both sort directions preserve the stored dataset.
Fictional narrow grade and Japanese overwrite screenshots were visually checked.
All 1,484 artifact file hashes and five changed implementation/test inputs match.
Browser build: `bab475f7c071840708b99adaae6fec547bf405ad563e420742a7a85d7110cfc9`.

Port 8896 now serves this build and both existing demo tabs were reloaded. One
explicitly approved sample-profile import was checked through the UI: the two
reported known achievements display SSS+ with their existing RT contributions.
The sample was imported once into the demo tab; no raw profile fixture or real
account screenshot was written. Production emergency changes, shared artwork,
Clear/Forget, the count placement and local import timestamp remain included.
Hosted pilot deployment, wider live-account acceptance, release announcement and
monitoring activation remain pending as documented in `PLAYER_IMPORT_DELIVERY.md`.

## Prominent header entry — local follow-up, September 21

Historical iteration: this header placement was superseded by the navy action
beside the catalog heading. The September 22 hosted updates and current layout
are recorded in `MAISHIFT_HOSTED_PILOT_RELEASE.md`.

After the hosted pilot release recorded in `MAISHIFT_HOSTED_PILOT_RELEASE.md`,
the shared browser header now includes a large, localized Import player data
button at the top right. It remains available across Charts, Pattern dictionary,
Compare charts and About, including after import or hiding/clearing scores. The
Settings entry remains available. Both open the existing source chooser without
a request; Escape and Cancel restore focus to the entry point used. The pilot
banner now contains only its test notice. At narrow widths the button sits
beside the brand, with navigation on the next row. It is not a floating overlay.

This follow-up is implemented locally and is **not in the hosted release**.
The documented browser wrapper passed 182 checks, including Chrome, Edge,
Firefox, WebKit, mobile and 320px. Header checks cover all four languages at
320, 390, 600, 740, 1061, 1100 and 1280px, keyboard focus, overlap and text
clipping in both the ordinary browser and pilot. Four existing phone-navigation
checks also pass. The 940-message localization check and language-review
fingerprints pass; no new copy was introduced. Desktop and Japanese 320px
screenshots were visually reviewed. Test artifacts are retained under
`C:\DevCache\projects\maimai-chart-browser-registry\6c15e789d6fd4518\workspaces\20260922T025356059-d5eee4d4`.

The hosted smoke checker accepts either the existing pilot-banner entry or the
new shared header entry, so it remains usable before and after this UI ships.
No live profile reads or hosted changes were needed for this follow-up.

## Results controls and title readings — September 22

The hosted pilot now shows every matching canonical chart as a separate row,
including different difficulties and STD/DX charts. With the default title sort,
the hardest level comes first within a title; explicitly selected sorts take
priority. Each row retains a native difficulty dropdown containing that song's
matching difficulties within the same format and variant. A selection replaces
only that row's contents and preserves its position, keyboard focus and expanded
details. Scores, comparison actions, links and measurements follow the selected
chart. Refresh retains the selection; an explicit sort restores the individual
chart ordering. Filters exclude incompatible choices, and exact chart links
restore the linked chart in its original row. The count continues to describe
matching canonical charts, not the current dropdown selections.

Original titles remain dominant. English adds a smaller, muted romaji accessory
where an authored pronunciation or faithful kana reading is available (485
stored title readings). Approximate generated sort keys and nicknames remain
search-only. Other UI languages hide the accessory; no chart identity or catalog
record changes.

Combo and Sync choices include the existing 24px game badges and localized text
in keyboard-accessible popups. Native internal select values remain compatible.
Exact provider aliases normalize for display and filtering without rewriting
portable datasets or inventing observations. This fixes Maishift underscore
enums and preserves Session Report spaced/legacy labels, including AP/AP+ and
FS/FS+/FDX/FDX+/SYNC where supplied. Missing values remain unknown: the approved
public Session Report checked during this work supplied no AP/AP+ observations
and no sync values. No raw profile data or real-account screenshot was retained.

The final source snapshot passed 42 focused checks across Chrome, Edge, Firefox,
WebKit, desktop, mobile and 320px, plus 117 catalog regressions. Exact-package
checks include 32 localized title/difficulty layouts, 64 badge popup cases and
the prior import/range/recovery layout suite. Release hashes and hosted checks
are recorded in `MAISHIFT_HOSTED_PILOT_RELEASE.md`.
