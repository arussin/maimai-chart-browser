# Maishift investigation and release gate

Status: **blocked; no live Maishift adapter or proxy is enabled**. A follow-up
investigation found structured full-record data, but direct browser CORS fails,
access permission is unresolved, and exact chart joins remain unverified. The import
selector explains the unavailable status. The combined `player-import-sources-v1`
announcement remains disabled. File and Session Report imports work independently.

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
and no proxy was used or built.

The legal pages render their content after hydration, explaining why the earlier
HTML-only inspection found only the footer. Ordinary browser navigation now read:

- [Terms of Service](https://maimai.shiftpsh.com/en@na/terms), displayed effective
  date July 10, 2026. Section 8 addresses members' rights in supplied records and
  limited uses/disclosure. Section 9 prohibits members from reverse engineering,
  among other prohibited conduct. This is an access concern requiring service-owner
  clarification, not a legal conclusion about a particular integration.
- [Privacy Policy](https://maimai.shiftpsh.com/en@na/privacy), whose English text
  says the Korean version is authoritative. It lists a user-chosen handle and
  optional linked profile/play records. The page header displayed July 10 while
  the policy body gave July 11, 2026; the discrepancy was not resolved.

Internal-endpoint investigation stopped when that terms provision was found.
No further endpoint probing, maintainer contact or permission acceptance followed.
The publicly discoverable [older repository](https://github.com/shiftpsh/shiftpsh.com-maimai)
is archived (February 15, 2025), describes a personal tracker and uses React/Vite;
it does not establish a supported contract for today's application.

### Recommended next owner action

Seek a supported public read API or data export, and permission for user-initiated
imports/remembered refresh. Establish allowed load, CORS, immutable IDs, complete
snapshot semantics and chart metadata before writing an adapter. A proxy could
address transport only after access permission and contract review; it cannot
resolve those gaps itself. No proxy implementation is authorized in this scope.

Draft inquiry, **not sent**:

> We are working on optional player-data imports for maimai.party. Does Maishift
> offer a supported API or structured export for a consenting user's public
> profile, covering played PBs at every difficulty and both STD/DX formats? We
> would like to confirm permitted access, request limits, stable profile/chart
> identifiers, Japan/International region semantics, snapshot dates/completeness,
> and whether credential-free CORS reads from https://maimai.party can be supported.
> Remembered refresh would be opt-in, at most once per 15 minutes while the user
> is visiting the page. We have not enabled an integration or deployed a proxy.

## Decisions and missing evidence

Full available PB access is required; Best 50 alone cannot enable the feature.
Do not infer a schema from presentation labels or execute hydration scripts.
No live adapter fixtures, source-ID parser, fabricated IDs, or fuzzy matches are
provided as substitutes for that contract. Raw rows without usable identities
must eventually have a bounded local diagnostic representation with disclosed
counts. Normalization and those diagnostics remain deferred until permitted access
and the observed candidate contract are accepted and frozen.

The additive portable v1 identity namespace is implemented independently of
transport: `maishift:maimaidx:<jp|intl>:<URI-encoded-source-identity>`, preserving
case. `username` carries that exact source identity; `displayName` carries its
label. Chart IDs must use `maishift:<jp|intl>:<provider-chart-identity>`. This is
Party's contract, not a claim that upstream currently supplies immutable IDs.
Before enabling normalization, select an evidence-backed identity and document
handle limitations. No Maishift IDs currently join the Kamaitachi mapping.
Existing Kamaitachi keys, datasets, hashes and handoff v1 remain valid.

To clear the gate, establish permitted use of a supported resource, definitive PB
completeness and consistency, exact region and chart identities, source revision
semantics and synthetic transport fixtures. Then implement and test normalization,
unknown/unmatched preservation, bounded reads, and browser-origin access. Until
then `maimaiPlayerSources.capabilities.maishift` stays false.

## On-demand proxy proposal — not implemented

A candidate full-record resource now exists, but permission and browser access
are unresolved. Review a separate proxy only after access permission and contract
approval, before any implementation or deployment. It would accept a
validated provider identity and supported region, construct a fixed upstream
URL, and reject arbitrary URLs and redirects. Any necessary redirects would
require per-hop validation against an exact allowlist.

Proposed limits: at most one concurrent upstream request per identity; 10-second
connect/30-second total deadline; 4 MiB per response and 16 MiB per complete read;
no more than 10 pages, subject to adjustment using measured full-PB sizes before
approval. Abort rather than truncate. Suggested starting request limits are one
automatic read per identity per 15 minutes and 10 requests per minute per client,
honoring longer upstream retry instructions. These are proposed load controls,
not Maishift's published limits.

No login material, score database, retained response bodies, periodic population
crawl, or third-party scraper. Responses are `no-store`. Proposed ephemeral
coordination expires after 15 minutes; an owner must review any platform request
logging retention before deployment. Logs contain failure categories and counts,
not identities, URLs or scores. Privacy copy must explicitly disclose that
imported scores pass through the proxy. The existing payment Worker is not a
score transport and is not changed for this purpose.

## Manual probe and proposed monitoring

`scripts/probe_maishift.mjs` requires `MAISHIFT_CANARY_URL` and
`MAISHIFT_CANARY_APPROVED=true`. Run it with browser dependencies and temporary
files in the documented DevCache environment. Output is sanitized JSON only.
This existing probe tests the profile HTML, not the newly located full-record
function, and must not be treated as a full-data contract check. Further internal
endpoint investigation requires resolving the terms/access gate above.
Its nonzero exit intentionally reports `blocked-unverified`; transport success
alone can never certify full PB coverage or normalization.

The `Maishift contract investigation` workflow has **workflow_dispatch only**,
read-only repository permissions, an explicit per-run canary approval, a five
minute timeout, no artifacts, and no alert publishing. It has not been dispatched.

After the adapter gate passes, replace the diagnostic-only outcome with checks
for the frozen required structure, full coverage, exact-match sanity and actual
normalization. Add deployed-browser checks separately. Proposed owner activation:
once daily at 05:17 UTC, one retry after 60 seconds for transient failures, one
deduplicated alert after three consecutive failed runs and one recovery notice.
No ordinary third-party profile may silently become that canary. The schedule,
alert writes and approved canary require a separate owner action. Existing
workflow and automation holds stay unchanged.

A future build-time capability change can disable new Maishift requests while
preserving saved data. This static application has no instant remote kill switch.
