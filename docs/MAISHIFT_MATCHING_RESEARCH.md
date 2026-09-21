# Maishift chart, coverage and identity research

Observed 2026-09-21 UTC. **Chart matching appears feasible, and full public PB
access is demonstrated for the official sample in both regions. Safe account
continuity on refresh was unresolved at this investigation stage.** The later
[exception review and username decision](MAISHIFT_MAPPING_DECISIONS.md) resolves
the 56 exception identities and selects username-scoped source identity. The
connector and announcement stay disabled. The candidates from this investigation
were subsequently [installed and tested locally](MAISHIFT_MAPPING_TESTS.md).

Only the official `shiftpsh` sample was queried, without credentials or referrers.
No other accounts were enumerated. PB values and profile metadata stayed in
memory; retained outputs contain aggregate counts and public song/chart metadata.
There was no deployment, workflow dispatch, schedule change or maintainer contact.

## Completeness and transport

The served [main client](https://maimai.shiftpsh.com/assets/main-B0wkGPQy.js)
explicitly restricts its full-chart provider to records, grinding and export.
Its export route uses the observed GET server function
`ca4efd7b63caa72a7c873fad22347161ae254a3562ed2006800d903e45c4a271`, taking exactly
`{handle, region}` and returning `{banned, reason, packed: {songs, tracks}}`.
The same credentials-omitting transport is used as the frozen records function.
The export function is research-only; it was not added to the proxy allowlist.

For each region, the investigation read profile, full tracks, export, then profile
again. Selected identity/timestamp metadata stayed identical across each read.
Sorting records by their content and resolving song indexes produced **identical
full rows** from the tracks and export loaders, including all PB measurements.
No cursor or additional page request appears in these observed full-data loaders.

| Observed official sample | International / ASIA | Japan / JAPAN |
| --- | ---: | ---: |
| Full chart rows in each loader | 6,031 | 6,443 |
| Played PB rows in each loader | 2,010 | 200 |
| BASIC PBs | 109 | 1 |
| ADVANCED PBs | 97 | 5 |
| EXPERT PBs | 446 | 3 |
| MASTER PBs | 1,232 | 172 |
| RE:MASTER PBs | 126 | 19 |
| STD PBs | 779 | 22 |
| DX PBs | 1,231 | 178 |
| Profile-summary PB rows | 100 | 69 |

`tracksComplete:false` appears in the **profile summary**, whose embedded tracks
are truncated. It is not evidence that the separately loaded full track response
is limited to Best 50. Conversely, agreement between two client loaders does not
prove that Maishift received every score from a player's original game account:
the loaders may share a backend. The adapter continues to record partial PB
observations, preserving other known PBs and inventing no plays or sessions.

This clears the narrow question of whether the public sample exposes lower
difficulties and both chart formats. It does not establish lifetime/deleted-chart
coverage, future versions, every profile, or a supported public API contract.
Party-origin direct browser CORS remains blocked as documented in the main
integration investigation; server fetchability and browser access are separate.

## Exact chart candidates

The offline comparison uses canonical ordinary charts only. It never uses search
aliases, fuzzy titles, constants, approximate artist matching, or provider IDs from
another service as chart identities.

| Candidate evidence | International | Japan |
| --- | ---: | ---: |
| Exact title + artist + STD/DX + difficulty | 5,983 | 6,435 |
| Regional SEGA title/artist + exact jacket filename + chart slot, after whitespace normalization | 8 | 8 |
| Exact title + jacket + chart slot; artist credit requires explicit review | 40 | 0 |
| Total unique candidates | 6,031 | 6,443 |
| Ambiguous candidates / duplicate canonical targets | 0 / 0 | 0 / 0 |

The direct exact matches include 1,996/2,010 played International PBs and all
200 played Japan PBs. Cross-checking the rest uses the registry's accepted,
reviewed `sega-intl` and `sega-jp` song mappings and exact ordinary chart slots.
Jacket **filenames** were compared as metadata; no images were downloaded.

The eight whitespace cases per region are the intentionally blank title by
`x0o0x_` and `ぽっぴっぽー` with a blank artist. The 40 remaining International
charts are ten STD/DX song variants, four difficulties each. Differences are:

- `幽閉サテライト` versus the expanded Produce/Arranged credit: eight variants
  across six song titles.
- `Junky` versus `Junky feat. 乙姫(CV:浅川悠)`: one variant.
- `岸田教団&THE明星ロケッツ` versus the credit including `×草野華余子`: one variant.

Those candidates agree on exact title, official regional jacket filename and
format/difficulty. The later review preserves all 56 exceptional regional chart
decisions in `registry/maishift-review-20260921.json`. Those decisions were
subsequently installed in the local crosswalk with [browser test evidence](MAISHIFT_MAPPING_TESTS.md).
No general rule stripping artist credits was implemented.

Numeric track IDs are unique within each response. The regional catalogs have
**zero overlapping IDs**, so a region namespace is essential. The tracks/export
comparison verifies IDs across those two presentations at this observation time;
stability through later upstream catalog revisions is not established.

The research found a decoder correction: Seroval strings have literal escapes
inside JSON strings. A single inert escape-table pass now preserves `<`, quotes
and backslashes in exact chart text. The table was verified in the served client's
`fQ/Ks` and `pQ/_u` functions. Unknown types remain rejected; no JavaScript is
evaluated. Fictional fixtures and a regression test cover one-pass decoding,
literal backslashes, quoted keys and inert script-like text.

## Player identity and dates

The public profile contains the requested handle and region, display name and
profile metadata, but no verified immutable account ID. Handle case, renaming and
reuse remain unverified. The client exposes a friend code, but its stability,
availability and ownership semantics have not been established; no friend code
was retained or proposed as an automatic fallback.

`profile.createdAt` and `updatedAt` differ between the two regions of the same
sample. The public [profile component](https://maimai.shiftpsh.com/assets/_handle-CC8sHRq7.js)
and [export component](https://maimai.shiftpsh.com/assets/index-R7KvJhuN.js) use
`createdAt` for the displayed date and game-version week. **Inference:** this is
record/snapshot timing, not an immutable account-creation marker. A live update
or documented semantics is needed to confirm the exact meaning of both fields.
The former created-at equality check could reject a legitimate future upload.
It has now been removed in favor of the explicit username/region source identity
model documented in `MAISHIFT_MAPPING_DECISIONS.md`.

That model follows the public source address and does not claim verified account
ownership or detect reassigned handles. Reconnecting a different handle/region
requires the existing player-switch confirmation. Source chronology still needs
validation: do not substitute fetch time for unverified source chronology.

## Reproduction and retained evidence

`scripts/research_maishift.mjs` requires explicit per-run canary approval, an ASCII
handle and a DevCache output directory. It performs at most eight sequential
credential-free reads, with 20-second/4-MiB bounds per request. It retains no score
dump. `scripts/research_maishift_matches.mjs` then operates offline on public chart
metadata, saves candidates only in DevCache and never edits the registry.

Research workspace:
`C:\DevCache\projects\maimai-chart-browser-registry\6c15e789d6fd4518\workspaces\20260921T050638007-eab0910f\maishift-research\decoded-contract`.
Review `summary.json`, `matching-summary.json` and the candidate crosswalks there.
They are disposable evidence, not a production mapping source.

Candidate SHA256s (including source evidence and artist-review flags):

- International: `983e5f8d8c14f4453b4ba5817844a991a0fd49806c55286763e6c56ce4139f5a`
- Japan: `c330f5462f2b49d54c66522726bcda2951b7891afd8d2a205b9cd891f9b33b03`

Input file SHA256s:

- Served `main-B0wkGPQy.js`: `8e8e0485856e2da861e630feeebd2ba13ac897334114be1b26eeaa41a0ec7d8d`
- `registry/charts.json`: `f06ad4e8d6d209137cbc2267432f87d5c1467ce2cedc4e757bdd960cbd3e4bfc`
- `registry/songs.json`: `920322fd9588c4271e8a28372024e6ae092be6ce84c442e8e2c05ab70f7c01aa`
- `registry/mappings.json`: `008ff0cb21929a2eb96a7fbdbb63df7fc0ae90ea3365e7384453e35d1f10ae50`

The reviewed crosswalk is now installed/exported with conflict detection.
[Runtime and chronology verification](MAISHIFT_RUNTIME_VERIFICATION.md) records
the next stage: local full-profile runtime checks pass, but source chronology and
deployed acceptance remain incomplete. The connector and combined announcement
remain disabled.
