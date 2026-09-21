# Maishift investigation and release gate

Status: **local proxy and browser adapter implemented; release remains incomplete
and disabled**. The approved official sample now passes the frozen server reader
and v1 normalization: 6,031 chart rows, 2,010 played PBs, 2,010 imported PBs, zero
excluded records, and zero invented plays. The [follow-up matching and completeness
research](MAISHIFT_MATCHING_RESEARCH.md) verifies agreement with Maishift's full
export loader in both regions and finds unique chart candidates throughout both
catalogs. Stable handle ownership and a reviewed production crosswalk are still
unverified. Direct browser
CORS still fails. The combined `player-import-sources-v1` announcement is unreleased.

The user subsequently approved implementing the described proxy locally. That
supersedes the earlier proposal-only scope. Deployment, maintainer contact,
workflow dispatch, scheduling, and alert publication remain separate owner actions.
See [local proxy delivery and release checklist](MAISHIFT_PROXY.md).

## Initial observations (2026-09-21 UTC)

The approved, bounded investigation used only the official sample linked from
[Maishift](https://maimai.shiftpsh.com/en). No other profile was enumerated, no
authentication was supplied, and no score dump, avatar, or jacket was retained.

- The sample `/en/profile/shiftpsh/home` resolved in the browser to
  `/en@na/profile/shiftpsh/home`. The UI's regional filter was `na`, while the
  profile label was `Intl`. Language, availability filtering and record region
  are therefore distinct; no mapping from locale to identity is assumed.
- A logged-out GET of that canonical HTTPS page with `Origin: https://maimai.party`
  returned HTTP 200, `text/html; charset=utf-8`, and no
  `Access-Control-Allow-Origin`. Two observed bodies were 262,837 and 262,470
  bytes. Variable page bytes are not a player-data revision.
- An isolated Chromium context attempted a credential-free, no-referrer read
  from a synthetic document at the actual `https://maimai.party` origin. The
  browser could not read the response. The sanitized probe reports
  `cors-or-transport`; together with the missing CORS header, this does not
  qualify as a browser-direct data resource. This test did not modify or load
  the deployed Party application and is not deployed-application acceptance.
- Records exposed filters for all five difficulties, STD/DX, versions, NA
  availability, combo/sync and achievements. A displayed 6,031-chart count is
  **not** evidence that all rows are played PBs, all records are loaded, or that
  pagination is complete. Snapshot consistency and complete PB extraction were
  not established.
- Export exposed presentation controls and a Download button. No supported
  JSON/CSV export contract was identified. No download was made.
- The profile presents an update date and version and links to a versioned
  profile variant. Stable immutable identities, handle reuse/rename semantics,
  exact chart identifiers/crosswalks, actual play timestamps and full source
  revision semantics remain unverified.
- A focused public search did not establish a current documented API. This is
  not proof that one does not exist. Terms/privacy pages yielded no substantive
  integration terms in the earlier web-reader inspection. The robots request
  encountered an insecure redirect that was not followed. Robots/terms approval
  remains unestablished; no maintainer has been contacted.

## Follow-up: full-record data located (2026-09-21 UTC)

This supersedes the initial uncertainty about whether structured PBs exist.
Only the official sample was deliberately queried. Searches incidentally returned
other public profiles; those results were not opened or used as canaries.
The following findings are observations of a deployed internal contract, **not a
supported API specification or permission to ship a connector**.

### Transport and coverage

The current public application is a TanStack Start client. Its served
[main bundle](https://maimai.shiftpsh.com/assets/main-B0wkGPQy.js) separates profile
summary loading, the Records first page and a full `profile-tracks` query.
The [Records chunk](https://maimai.shiftpsh.com/assets/index-lBg7ohlL.js) issues that
full read with `{data: {handle, region}}`. This was observed during ordinary
logged-out navigation in an isolated browser, then reproduced without cookies.
No application or hydration code was evaluated by the static inspection scripts;
the browser ran the site's ordinary page in its own origin.

Observed full-record read:

- Method: GET; internal function path
  `/_serverFn/4596ec22247ca585a111f9481e9c4ce1f2553f7b0f3fc7b98a4324205365ef54`.
- Query: `payload`, a Seroval-encoded object containing `data.handle` and
  `data.region`. Public client header: `x-tsr-serverFn: true`; JSON is accepted.
- Logged-out result: HTTP 200, `application/json`, approximately 2,031,700 bytes.
  Small byte-size changes were observed; response bytes are not a revision ID.
- Seroval envelope projects to `{result, error, context}`. Successful `result`
  contains `songs` and `tracks`. Projection inspected only primitive/object/array
  nodes; it did not execute functions, resolve arbitrary constructors or evaluate
  downloaded JavaScript.
- One complete response contained 1,472 song/format entries and 6,031 distinct
  numeric track IDs. Of those chart rows, 2,010 had a record (`r`). The inspected
  HTML hydration contained only 150 record-shaped entries; that initial summary
  does not establish full PB coverage.
- The full response had no observed cursor, continuation token, timestamp or
  revision/completeness field. The client consumes the response as the complete
  track set. This establishes broad PB availability, but not source-of-truth
  completeness, atomic consistency with the separately loaded profile metadata,
  or preservation of removed/unavailable charts across revisions.

Played-record coverage in this single sample response:

| Difficulty | STD | DX |
| --- | ---: | ---: |
| BASIC | 88 | 21 |
| ADVANCED | 74 | 23 |
| EXPERT | 125 | 321 |
| MASTER | 419 | 813 |
| RE:MASTER | 73 | 53 |
| Total | 779 | 1,231 |

No individual scores, friend code, avatar, profile dump, trace or screenshot was
retained. These aggregates do not create play or session history.

### Observed record and identity shape

The public [packed-track decoder](https://maimai.shiftpsh.com/assets/packedTracks-BdfXGpoT.js)
connects each track's `s` to the response's song array and exposes `i` as `trackId`,
`d` as difficulty, and the song's `type` as STANDARD or DX. Other observed track
fields include level `l`, accuracy flag `x`, and optional `p`; the decoder also
handles display-level/delta fields. A numeric track ID is provider-local. Its
cross-release/region stability and relationship to Party's IDs are unestablished.
The local registry and existing provider crosswalk contain no Maishift entries.
No title-derived or numeric-ID-derived join was installed.

A played row's `r` contained `a`, `d`, `m`, `g`, and optionally `c`/`y`. The decoder
labels these achievement, DX score, maximum DX score, rating, combo and sync.
Achievements were integers in this response; authoritative scaling and missing
value semantics still require a frozen contract. Combo values observed were
FULL_COMBO, FULL_COMBO_PLUS, ALL_PERFECT and ALL_PERFECT_PLUS; sync values included
SYNC_PLAY, FULL_SYNC, FULL_SYNC_PLUS, FULL_SYNC_DX and FULL_SYNC_DX_PLUS.
Absence of combo/sync is not an invented game result. No per-chart play timestamp
was observed. No play/session can be constructed from this PB response alone.

The main client maps `jp` to the record region JAPAN and both `intl` and `na` to
ASIA. NA therefore changes availability display, not the underlying player region.
Locale remains separate. The privacy policy describes a handle as user-chosen;
the inspected full response contains no immutable player ID. Handle renaming,
reuse, case normalization and region-specific account linkage remain unresolved.

### Browser CORS and terms findings

The actual full-record GET, not merely the HTML page, was tested from an isolated
synthetic document at `https://maimai.party`. A credential-omitting, no-referrer
browser fetch was unreadable. Its required-header preflight returned HTTP **405**
with no Access-Control-Allow-Origin, Allow-Methods or Allow-Headers. The successful
server-side GET also lacked Access-Control-Allow-Origin. Current direct browser
integration therefore fails the transport gate. Browser security was not disabled,
and no proxy was used or built during that initial CORS investigation.

The legal pages render their content after hydration, explaining why the earlier
HTML-only inspection found only the footer. Ordinary browser navigation now read:

- [Terms of Service](https://maimai.shiftpsh.com/en@na/terms), displayed effective
  date July 10, 2026. Section 8 addresses members' rights in supplied records and
  limited uses/disclosure. Section 9.1.1 includes reverse-engineering and attack language; section 9.1.2
  separately addresses abnormal uploads. Those are different provisions. The
  upload restriction alone does not establish that an authorized import of a
  user’s own public records is prohibited. No legal conclusion about this
  integration or claim of an officially supported API is inferred.
- [Privacy Policy](https://maimai.shiftpsh.com/en@na/privacy), whose English text
  says the Korean version is authoritative. It lists a user-chosen handle and
  optional linked profile/play records. The page header displayed July 10 while
  the policy body gave July 11, 2026; the discrepancy was not resolved.

The initial investigation paused at that terms provision. After discussion, the
user approved further public-data investigation and the local proxy. No maintainer
was contacted and no service terms were accepted on anyone’s behalf.
The publicly discoverable [older repository](https://github.com/shiftpsh/shiftpsh.com-maimai)
is archived (February 15, 2025), describes a personal tracker and uses React/Vite;
it does not establish a supported contract for today's application.

## Decisions and missing evidence

Full available PB access is required; Best 50 alone cannot enable the feature.
The observed transport is frozen in `player-import-worker/observed-contract.json`.
All checked-in fixtures are fictional. The decoder handles only the observed
inert Seroval subset and never executes fetched scripts. Valid provider IDs with
blank titles or artists remain importable. Rows lacking sufficient chart identity
are excluded from portable exports and overlays; at most 100 row-index/reason
entries and a total count stay in the local connection descriptor.

The additive portable v1 identity namespace is implemented independently of
transport: `maishift:maimaidx:<jp|intl>:<URI-encoded-source-identity>`, preserving
case. `username` carries that exact source identity; `displayName` carries its
label. Chart IDs must use `maishift:<jp|intl>:<provider-chart-identity>`. This is
Party's contract, not a claim that upstream currently supplies immutable IDs.
The adapter conservatively accepts ASCII handles with an explicit game region.
Created-at continuity is currently checked on refresh as a conservative rejection
guard. Follow-up research shows different values by game region and public-client
use as a displayed score date/version week. It must not be treated as account
creation or immutable identity; the refresh design needs verified identity semantics
before release. No Maishift IDs currently join the Kamaitachi mapping.
Existing Kamaitachi keys, datasets, hashes and handoff v1 remain valid.

To clear the gate, establish definitive PB completeness and consistency, stable
identity/revision semantics, and an exact reviewed chart crosswalk. The sample’s
successful normalization is evidence of extraction, not a proof that every public
profile or region is complete. `maimaiPlayerSources.capabilities.maishift` remains
false. There is no fuzzy title matching and no Maishift-to-Kamaitachi ID reuse.

## Local on-demand proxy

The implementation and operations checklist are in [MAISHIFT_PROXY.md](MAISHIFT_PROXY.md).
It accepts a handle and region in a same-origin POST body, constructs only the two
frozen upstream RPC destinations, and makes three sequential requests: profile,
tracks, profile. Redirects are rejected. Request bounds are 2 KiB input/5 seconds,
4 MiB per upstream response, three reads/30 seconds total. The server holds a
45-second expiring lease per profile, with 30-second manual and 15-minute automatic
cooldowns, plus longer upstream retry timing. A separate rate binding is required
for the proposed 10-per-minute client limit. These are Party limits, not published
Maishift limits.

No PBs, response bodies, handles, or profile URLs are stored on the server. The
transient coordination record contains a random lease and times, addressed by a
hash of region/handle. Hashing is minimization, not anonymity. An alarm clears
expired coordination; it never fetches profiles. Scores pass through the proxy
in memory and are saved in the browser only after confirmation. Application logs
and Wrangler telemetry are disabled; account-wide log retention needs owner review
before deployment. The payment Worker is unchanged.

## Manual probe and proposed monitoring

`scripts/probe_maishift.mjs` requires `MAISHIFT_CANARY_URL` and
`MAISHIFT_CANARY_APPROVED=true`. Run it with browser dependencies and temporary
files in the documented DevCache environment. Output is sanitized JSON only.
This existing probe tests the profile HTML, not the newly located full-record
function, and must not be treated as a full-data contract check. The new
`player-import-worker/live-contract.mjs` runs the frozen server reader plus v1
normalization with an approved canary URL, region and explicit per-run consent.
It outputs aggregate counts only and continues to label the release incomplete.
Its nonzero exit intentionally reports `blocked-unverified`; transport success
alone can never certify full PB coverage or normalization.

The `Maishift contract investigation` workflow has **workflow_dispatch only**,
read-only repository permissions, an explicit per-run canary approval, a five
minute timeout, no artifacts, and no alert publishing. It has not been dispatched.

After the release gates pass, promote the frozen contract check to the workflow
and add full coverage/exact-match assertions. Deployed-browser checks remain
separate. Proposed owner activation:
once daily at 05:17 UTC, one retry after 60 seconds for transient failures, one
deduplicated alert after three consecutive failed runs and one recovery notice.
No ordinary third-party profile may silently become that canary. The schedule,
alert writes and approved canary require a separate owner action. Existing
workflow and automation holds stay unchanged.

A future build-time capability change can disable new Maishift requests while
preserving saved data. This static application has no instant remote kill switch.
