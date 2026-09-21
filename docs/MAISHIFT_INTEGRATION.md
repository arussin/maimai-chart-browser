# Maishift investigation and release gate

Status: **blocked; no live Maishift adapter or proxy is enabled**. The import
selector explains this status. The combined `player-import-sources-v1`
announcement remains disabled. File and Session Report imports work independently.

## Observations (2026-09-21 UTC)

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

## Decisions and missing evidence

Full available PB access is required; Best 50 alone cannot enable the feature.
Do not infer a schema from presentation labels or execute hydration scripts.
No live adapter fixtures, source-ID parser, fabricated IDs, or fuzzy matches are
provided as substitutes for that contract. Raw rows without usable identities
must eventually have a bounded local diagnostic representation with disclosed
counts; that representation is deferred with the blocked adapter because its
source evidence is not yet defined.

The additive portable v1 identity namespace is implemented independently of
transport: `maishift:maimaidx:<jp|intl>:<URI-encoded-source-identity>`, preserving
case. `username` carries that exact source identity; `displayName` carries its
label. Chart IDs must use `maishift:<jp|intl>:<provider-chart-identity>`. This is
Party's contract, not a claim that upstream currently supplies immutable IDs.
Before enabling normalization, select an evidence-backed identity and document
handle limitations. No Maishift IDs currently join the Kamaitachi mapping.
Existing Kamaitachi keys, datasets, hashes and handoff v1 remain valid.

To clear the gate, establish a supported resource and allowed access, full PB
coverage and consistency, exact region and chart identities, source revision
semantics and synthetic transport fixtures. Then implement and test normalization,
unknown/unmatched preservation, bounded reads, and browser-origin access. Until
then `maimaiPlayerSources.capabilities.maishift` stays false.

## On-demand proxy proposal — not implemented

If an appropriate full-PB resource exists but browser reads cannot be enabled,
review a separate proxy before implementation or deployment. It would accept a
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
