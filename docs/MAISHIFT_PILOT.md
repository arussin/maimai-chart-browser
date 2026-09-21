# Invited Maishift pilot

Prepared September 21, 2026. **Built and tested locally; not published.**
The proposed page is `https://maimai.party/pilot/maishift/`, using the separate
`/api/player-import/maishift` Worker. Normal Party imports and the combined
announcement remain disabled. This is an unlisted public link, not an access
control system. It does not add sign-in or change existing authentication.

## What this tests

The earlier [runtime verification](MAISHIFT_RUNTIME_VERIFICATION.md) established
bounded complete sample reads and deterministic behavior. Repeated unchanged
reads cannot establish what Maishift does when a player uploads new data. This
pilot collects that missing before/after evidence through the real browser and
proxy path, without committing experimental observations to saved Party history.

Each read uses the existing strict adapter and all 12,474 reviewed chart joins.
There are no fuzzy matches, guessed chart IDs, fabricated plays or sessions.
Source identity remains provider + game region + the exact supplied username;
it is not proof of account ownership or protection against username reassignment.

## Tester steps

1. Open the pilot in the browser you plan to keep open. Enter your public Maishift
   username or profile URL, select your game region, consent, and read the baseline.
2. Leave the tab open. Play and upload to Maishift normally. A changed PB or a
   newly played chart is needed; uploading unchanged data cannot pass this test.
3. Select what changed and choose **Check the upload**. Review the played-chart,
   exact-match, unmatched and excluded counts. Compare the coverage with your
   expected public profile; a pass is not an independent inventory of your account.
4. After at least 30 seconds, choose **Check again for stability**. There is no
   automatic polling. Upstream limits may require a longer wait.
5. Download the test summary and share it with your inviter through an agreed
   channel. Nothing is submitted automatically. Clear the test or close the tab.

The page is available in English, Simplified Chinese, Korean and Japanese. UI
language does not select a game region. Refreshing/navigating away loses the
baseline; the page deliberately cannot resume a test from browser storage.
Do not manufacture a correction or alter the official sample. Test a legitimate
lower correction or game-version transition only when one actually occurs.

## Interpreting a summary

| Result | Meaning and next action |
| --- | --- |
| `needs_changed_upload` | No genuine PB change yet; this is not successful chronology evidence. |
| `needs_stable_check` | Changed PB data had a newer source date and exact coverage; perform the final read. |
| `observed_pass` | That observed change had a newer source date and a subsequent matching snapshot. The report still says `releaseReady: false`. |
| `timestamp_failed` | Changed content had an equal or older source date. Stop release acceptance and investigate source ordering. |
| `mapping_or_coverage_review` / `missing_records_review` | Unmatched, excluded or disappeared records need investigation. Do not widen the rollout. |
| `snapshot_changed_again` | The follow-up differs; repeat the upload check after the source settles. |
| `needs_lower_correction` | The tester selected correction but no lower achievement was observed. |
| `read_failed` | A read failed; earlier successful observations remain available. Download the failure summary and retry only when permitted. |

An empty profile cannot pass. Unknown values remain unknown. A lower PB is
compared as an observation, not rejected just because it decreased. Version
changes are explicitly **tester-declared**: the pilot does not infer a release
from language, upload time or the user's selection.

Profile/tracks/profile consistency checks and one stable reread can detect some
interrupted publications; they cannot prove the provider always publishes an
atomic full snapshot. Several profiles, both game regions, genuine corrections
and real version transitions still require evaluation. If a mixed snapshot keeps
the same source date, this pilot may not detect it. An authoritative source
contract or additional evidence remains necessary before automatic imports.

## Data and request boundaries

- Raw profile/PB observations exist only in this page's tab memory. This page does
  not load Party's persistence controller or change saved datasets, connections,
  refresh consent, Forget state, filters or announcement preferences. The existing
  language preference remains separate. Consequently this pilot does not itself
  acceptance-test real-account remembered storage/refresh.
- Each click makes one same-origin POST with credentials omitted, no referrer,
  no cache and no redirects. The existing Worker performs at most three reads
  from the two fixed Maishift public RPCs. No arbitrary destination is accepted.
- Maximum six attempts per page lifetime, at least 30 seconds apart; clearing
  does not reset this limit or cooldown. Respect upstream retry timing. This is
  a courtesy limit, not a global account or spending cap. There is no background
  polling, scheduler, unattended fetcher or automatic retry.
- Clear aborts the local request and invalidates late completions. It cannot
  retract an upstream request that has already reached the Worker. Its bounded
  server read may finish, without restoring data in the cleared page.
- Downloaded JSON contains the build fingerprint, region, declared test type,
  safe error/outcome codes, aggregate coverage/variant/change counts and relative
  time ordering. It excludes usernames, URLs, display names, chart IDs, scores,
  source timestamps, payloads and source-content hashes. Counts can still be
  identifying in context; do not describe the report as guaranteed anonymous.
- No analytics, screenshots, traces, automatic report delivery or third-party
  scripts run on the pilot page. Normal network handling by Party/Cloudflare and
  Maishift still occurs. Worker observability is disabled in the proposal;
  account-level request/log retention must be checked before publication.

For unmatched records, this aggregate report deliberately cannot repair a join
by itself. Request the tester's explicit approval for a bounded follow-up read
of the named public profile and apply the existing reviewed mapping process.
Never infer a song match or scan other profiles from this report.

## Build and deployment review

Run `tools/Build-MaishiftPilot.ps1` in the canonical registry checkout. It produces
a new, isolated DevCache directory containing only `pilot/maishift/*`, a proposed
path-scoped `_headers` stanza and `pilot-artifact.json`. The manifest hashes every
deployable file. The build fingerprint includes the exact adapter, core, pilot
assets and chart mapping. Only pilot translations and four shared labels are
compiled, so unrelated unpublished UI catalogs are not bundled. No production
release tree is overwritten. CI uses its runner temporary directory for this
same deterministic fixture builder.

Publishing a small pilot is a separate owner release action, deliberately before
general Maishift chronology acceptance so volunteers can supply that evidence.
Review the following concrete deployment scope:

- Verify the intended account/project and live release revision. Publish only
  the pilot directory alongside the existing approved site artifact; **merge**
  the `/pilot/maishift/*` header stanza rather than replacing the site's existing
  `_headers`. Do not deploy the separate artifact as the whole site.
- Provision the existing isolated `maimai-player-imports` Worker and SQLite
  profile limiter, choose its unique client-rate-limit namespace and exact route
  `/api/player-import/maishift`, and enable that Worker for the pilot only. Keep
  Party's normal Maishift capability and announcement false. Leave support/payment
  routes and their Worker untouched.
- Accept the paid-plan CPU/budget proposal and verify intended-origin access,
  bindings, platform resource limits and log retention. Existing controls include
  per-profile leases, manual cooldown, proposed 10 requests/minute per client,
  two active imports per isolate, bounded response/input and time limits. These
  do not impose a global spending cap; per-isolate capacity is not global capacity.
- Confirm that an unlisted public link is acceptable for the small trial. Real
  access restrictions would require a separate security-sensitive design.
- Run the owner-approved hosted smoke check below, then invite a few consenting
  players. Invitations/messages are owner actions, not part of this build.

Rollback: disable `MAISHIFT_ENABLED` in the isolated Worker and remove the pilot
directory/header stanza from a preserved site release. Preserve existing player
storage and all other routes. No automatic cleanup or rollback is run here.

## Hosted smoke check after publication

`scripts/check_maishift_pilot_hosted.mjs` is separate from deterministic tests. It
requires `MAISHIFT_CANARY_APPROVED=true`, an explicitly approved public
`MAISHIFT_CANARY_URL`, `MAISHIFT_CANARY_REGION` (`intl` or `jp`), and
`MAISHIFT_PILOT_BUILD` from the reviewed manifest. Use the documented development
environment and set `MAIMAI_NODE_MODULES_ROOT` to a prepared DevCache browser
workspace. `TEMP` must remain in DevCache. Run with Node from canonical source.

It opens a fresh Chrome context on Party's proposed pilot URL, checks the no-store,
no-referrer, noindex and self-only connection headers, consents to exactly one
approved baseline read and checks the expected build, coverage and exact matches.
It rejects other origins, profile-bearing URLs, cookies/auth/referrers on the API,
and additional API calls. Output is an allowlisted aggregate. It saves no trace,
screenshot or browser-state export, and never claims genuine-upload acceptance.
No live smoke run, workflow dispatch, schedule or alert has been activated.

## Working local preview

A plain static server displays this page but cannot handle its POST requests.
Use `tools/Start-MaishiftPilot.ps1 -ProfileUrl <approved-public-URL> -Region intl`
instead. It builds in DevCache and serves both page and importer at
`http://127.0.0.1:8895/pilot/maishift/`. Use `-Region jp` only when testing Japan
data. It runs until stopped, with no startup entry, public route or deployment.

The local gateway verifies exact loopback Host/Origin, refuses credentials and
arbitrary URLs, checks the artifact manifest and permits only the explicitly
selected username/region. Six reads and the 30-second cooldown apply across tabs
for that server lifetime. Its in-memory coordinator is a development substitute,
not evidence of deployed Cloudflare rate limiting or Durable Object behavior.
To test a different profile/region, stop it and start with that explicit selection.
No profile content or raw errors are written to server logs or disk.

Profile URLs may end at the username, optionally with a trailing slash, as well
as `/home`, `/records` or `/export`. Other hosts, query strings, fragments and
region conflicts remain rejected. A reviewed public profile-root redirect
established the shorter URL form. An observed requested-Japan response returned
`region: ASIA`; the reader now reports `region_mismatch` and stops before reading
tracks instead of relabeling those scores or silently switching regions.

One user-supplied public profile was verified through the visible local browser
on September 21: International returned 1,719 played PBs, all exactly matched,
zero unmatched and zero excluded. The Japan fallback remained rejected. Only
these aggregate results are recorded here; there was no raw player artifact or
screenshot. This is baseline access evidence, not changed-upload, deployed-origin
or general-release acceptance.

## Validation and remaining gates

The deterministic suite drives the actual proxy contract and browser adapter
with fictional profiles. It checks changed/unchanged/lower observations, source
time failures, stable rereads, coverage failures, invalid/oversized responses,
source isolation, six-read limits, Retry-After, cancellation and sanitized exports.
The browser matrix covers Chrome, Edge, Firefox and WebKit, desktop and 320px,
keyboard operation, all four languages, no saved-data changes and omitted cookies
and referrers. Screenshots use fictional data only. Exact run evidence is recorded
in the delivery record; native-speaker certification and real-device testing are
not claimed.

The shared v1 library pin remains
`f1abe2c7d93ff7f0b6610dd0bb57d4e038f609c0`; no Session Report contract or pin changed.
Earlier file/report/remember/Forget checks remain in
[PLAYER_IMPORT_DELIVERY.md](PLAYER_IMPORT_DELIVERY.md). Still incomplete:
published-origin acceptance and operating limits, genuine upload/correction/version
evidence, full snapshot semantics, and general Maishift/announcement release.
Preparing this pilot does not mark the original integration plan complete.
