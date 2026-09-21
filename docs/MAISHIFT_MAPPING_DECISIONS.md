# Maishift exception decisions and durable mapping

Reviewed 2026-09-21. **All 56 exceptional regional chart identities can be
resolved.** Forty have shortened artist credits; sixteen have blank/whitespace
metadata. These decisions are retained in
[`registry/maishift-review-20260921.json`](../registry/maishift-review-20260921.json).
Their status is `reviewed-not-installed`: the analysis is complete, but the
production registry export and browser overlay do not consume them yet.

## Evidence and conclusions

The Maishift metadata captured earlier today was checked against the live
[International SEGA catalog](https://maimai.sega.com/assets/data/maimai_songs.json)
and [Japan SEGA catalog](https://maimai.sega.jp/data/maimai_songs.json).
Both complete response hashes still equal the registry's accepted September 17
captures. Every exception has an exact regional jacket filename and an explicit
ordinary STD/DX difficulty slot. Titles agree, allowing the specifically reviewed
empty versus ideographic-space title. No music files, jackets or chart bodies
were downloaded; no personal scores are in the review record.

Each row below covers BASIC, ADVANCED, EXPERT and MASTER. There are no additional
RE:MASTER exceptions in this group.

| Song | Format | Region | Chart decisions | Finding |
| --- | --- | --- | ---: | --- |
| Blank title, artist `x0o0x_` | DX | International + Japan | 8 | Empty source title versus U+3000 in the canonical title; same artist/jacket |
| ぽっぴっぽー | STD | International + Japan | 8 | Empty source artist versus whitespace in SEGA; canonical artist already empty |
| 紅に染まる恋の花 | DX | International | 4 | Shortened 幽閉サテライト credit |
| 今、誰が為のかがり火へ | DX | International | 4 | Shortened 幽閉サテライト credit |
| 泡沫、哀のまほろば | STD | International | 4 | Shortened 幽閉サテライト credit |
| 華鳥風月 | STD | International | 4 | Shortened 幽閉サテライト credit |
| 月に叢雲華に風 | STD + DX | International | 8 | Shortened 幽閉サテライト credit |
| 色は匂へど散りぬるを | STD + DX | International | 8 | Shortened 幽閉サテライト credit |
| オトヒメモリー☆ウタゲーション | STD | International | 4 | `Junky` omits `feat. 乙姫(CV:浅川悠)` |
| LOSTPHANTASIA | DX | International | 4 | `岸田教団&THE明星ロケッツ` omits `×草野華余子` |

The circle's full accepted credit is
`幽閉サテライト(Produce:嵯峨飛鳥 Arranged:Iceon)`. The exact title, jacket and slot
evidence supports these specific identities despite the shorter credit. This
does not authorize dropping parentheticals, featured artists or collaborators
from other songs. The canonical display titles and artists remain unchanged.
Printed levels are observations, not identity: the regional ADVANCED levels for
ぽっぴっぽー differ, while the ordinary chart identity still agrees.

The review contains 14 region/format groups with 56 explicit source-ID-to-UUID
decisions: 48 International and 8 Japan. No target is duplicated within a region.
It completes the exception review behind the earlier 6,031 International and
6,443 Japan unique-candidate totals. The other exact-match candidates still need
the same controlled import/export path; counts alone do not install mappings.

## How the mappings will be preserved

1. **Keep the reviewed decision in Git.** The retained file includes every
   provider chart ID, raw source title/artist, format/difficulty, jacket filename,
   canonical song/chart UUID, reason, SEGA mapping/snapshot/record reference,
   source-identity checksum and decision checksum. It contains the necessary
   exception evidence even if the disposable DevCache investigation is removed.
   Checksums detect changes; they are not reviewer signatures or authorization.
2. **Import through the existing registry acceptance mechanism.** Use provider
   `maishift`, game `maimaidx`, and a region-qualified `provider_id` such as
   `intl:1691`. Its subject is the existing Party chart UUID. Add a source entry
   bound to the retained public metadata/review, then use `accept_mapping` with
   `acceptance_basis: reviewed`. That function already refuses silent redirects
   of an accepted provider identity. Build a candidate registry in DevCache and
   review its diff before promoting it; never partially overwrite the six-table
   registry or bypass its manifest.
3. **Export an additive Maishift lookup.** The current catalog exporter and
   browser overlay support Kamaitachi mappings. Keep that contract intact and
   add a separately versioned Maishift map keyed by `maishift:<region>:<trackID>`.
   A map entry carries the canonical UUID, expected raw title/artist/format/
   difficulty and review reference. Browser and Python consumers must use the
   same accepted map. Do not stuff Maishift IDs into the Kamaitachi map.
4. **Check identity at use time.** Resolve the exact region/track ID, then compare
   the imported chart's title, artist, format and difficulty with the recorded
   source assertion. Changed metadata or an unknown ID stays unmatched pending
   review, while its PB remains preserved. Jacket metadata supports review; it
   is not fetched by the browser. Do not fall back to title similarity or a
   generic artist-credit stripping rule.
5. **Preserve accepted IDs across refreshes.** Refresh proposals never regenerate
   UUIDs or replace accepted decisions. A new provider ID, unexpected reuse,
   changed source assertion, conflicting target or canonical redirect creates a
   review item. Removed upstream rows retain their historical mapping evidence.
   Deliberate remaps require a new documented decision and migration review.

Portable v1 datasets keep their original provider chart IDs and measurements.
Mapping is a lookup used by overlays; it must not rewrite records, manufacture
plays or merge STD/DX, regions, or providers. A saved unmatched PB can become
visible once a later accepted lookup covers it, without altering the PB itself.

`scripts/check_maishift_review.py` verifies the retained exception decisions
against the current accepted registry, entirely offline. It rejects altered
decisions, changed evidence, wrong regions/jackets/slots and duplicate mappings.
It emits only counts and does not mutate the registry or enable the connector.
Whole-registry file hashes in the review describe the investigation baseline;
the checker binds relevant evidence rather than invalidating these decisions
whenever an unrelated chart is added.

## Player identity: use the supplied username

The selected model is a user-directed public-profile connection:

`maishift:maimaidx:<jp|intl>:<exact username>`

The existing JavaScript and Python portable validators already implement that
namespace. Keep handle case as supplied until upstream case rules are verified;
`@na` and `@intl` address the same International record region. Display name,
rating, avatar, friend code and profile dates are not identity keys. No immutable
account ID is required for this source-following model, and no login/ownership
verification is claimed.

On refresh, the returned handle and region must match the selected connection.
An explicitly changed username or region follows the existing player-switch
confirmation and never merges with the old key. A rename requires reconnecting;
Party does not infer a rename or transfer history automatically. Identical PB
content still creates no new history. A later lower PB retains the existing
correction rules and source-timestamp checks.

The invalid cross-refresh `createdAt` equality guard has been removed. It could
reject a legitimate new score upload and never proved account ownership. The
legacy descriptor field remains record metadata for local compatibility. The
proxy still checks profile consistency before/after each individual fetch; that
protects a single read from a changing snapshot, not long-term account identity.

**Limit:** if Maishift reassigns the same username to someone else, Party cannot
detect that from the currently observed public contract and may combine that
source's new PB observations with saved ones. Username-based refresh follows the
public source address; it cannot promise continuity of a natural person. A user
who knows a name was reassigned must Forget before reconnecting. An immutable
provider ID could improve this later without blocking the chosen username model.

The connector remains disabled until the accepted crosswalk is installed and
used consistently, source chronology is validated, and deployment/browser
acceptance is complete. This review does not deploy anything or release the
combined announcement.

## Validation

- The offline checker accepts all 56 retained decisions. Seven deterministic
  regression cases cover source-text edits, a rehashed wrong chart target,
  wrong region/jacket, duplicate decisions, absent official chart slots and
  independence from printed level changes.
- `tools/Test-Development.ps1 -Check python`: 517 tests, OK with 7 skips, in
  DevCache workspace `20260921T054146719-09118d3f`.
- The final Maishift browser matrix passed 77 tests in
  `20260921T054503282-1500745f`: Chrome, Edge, Firefox, WebKit, desktop, mobile
  and 320px layouts, including all four languages. The username/region failure
  test proves each mismatch sends a fresh request and preserves the saved data.
  Changed snapshot `createdAt` with unchanged PBs refreshes without new history.
- Changed Python files pass Ruff formatting and lint checks. No portable schema
  or pinned Session Report library revision changed.

The retained review JSON is ordinary public metadata deliberately kept in source.
Dependencies, fixtures, test results and formatter caches remain in DevCache.
