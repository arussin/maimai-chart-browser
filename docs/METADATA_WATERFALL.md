# Metadata and transcription source policy

## September 17 metadata correction

Missing transcription analysis is not missing song metadata. The local registry
now retains source-bound BPM and constant observations independently of chart
bodies. Of the 292 added chart slots, 288 have BPM and 189 have explicit decimal
constants after enrichment. Dear Player2 accounts for the four remaining missing
BPM slots. BASIC/ADVANCED constants are often genuinely absent from these captures.

Examples:

| Song | BPM | BASIC | ADVANCED | EXPERT | MASTER |
|---|---:|---:|---:|---:|---:|
| 光線歌 / Guiano | 138 | unknown | unknown | 10.2 | 12.8 |
| ソテリア / Rafutsuri feat.桜あおい | 160 | 4.0 | 8.2 | 12.0 | 14.1 |

Soteria's constants above are explicitly **CiRCLE PLUS, Japan** observations
from the Wiki. The mai-notes MASTER page also displays CiRCLE+ / 14.1. Arcade
Songs currently reports 14.0 with no constant-specific game-version field.
Both observations are retained; 14.1 is the reviewed, version-scoped choice.
This does not assert that 14.1 is the current MAGiCAL or International constant.
The source and version appear in the existing constant hover text. No metadata
paragraph is added to chart details.

## Field-by-field waterfall

1. Keep an existing accepted metric. Enrichment never overwrites it.
2. Use explicitly reviewed public song/chart page observations when provided,
   including exact Wiki tables with their stated release/region.
3. Use [Arcade Songs](https://dp4p6x0xfi5o9.cloudfront.net/maimai/data.json).
4. Fill remaining fields from [OTOGE DB](https://github.com/zvuc/otoge-db).

Arcade Songs uses community constant sheets; OTOGE DB credits the Wiki for
metadata. Their agreement is not automatically independent corroboration.
Song introduction version is never treated as the version of a chart constant.

Each field falls through separately. Only an exact unique normalized title,
artist, format and difficulty match creates a proposal. Duplicate matches stay
unresolved. Source hashes, capture timestamps, exact public URLs, acceptance
evidence, region and known release are retained. Each provider's latest accepted
observation competes by the explicit priority above within its region. The
default supplemental constant prefers Japan, then International, then an
unscoped observation; competing values remain in the owner data. Failure or absence never deletes an accepted observation.

Only explicit `internalLevel` (Arcade Songs) and `*_i` (OTOGE DB) constants are
read. Arcade Songs' `internalLevelValue` can be generated from a printed level;
it is deliberately excluded. Empty values, zero, ranges, NaN and infinity remain
unknown. The International preference changes available values without hiding
charts. When an International constant is missing, the known Japanese or retained
constant remains visible with its actual source and region in the hover text.
Existing unscoped Neskol constants keep their existing behavior.

Capture once per provider, with bounded reads, a timeout and no redirects:

```text
python -m scripts.capture_registry_metadata --output output/metadata-capture-NEW
python -m scripts.prepare_registry_metadata --registry registry --captures output/metadata-capture-NEW --output output/metadata-proposals-NEW
```

The second command is offline. Review the proposals before acceptance. A review
contains `proposal_sha256`, `evidence` and an `accept` list of observation IDs.
Optional `song_aliases` entries map existing song IDs to `aliases` and `evidence`.
Then repeat preparation with `--review REVIEW.json` and a fresh output directory.
The proposal hash also binds the original registry, making stale reviews fail.
Replace accepted registry tables only after review and preserve a backup.
Build the usual catalog candidate from that registry with `update_catalog`.

For Wiki or another public page, a reviewed extraction may be added to
`captures.json` as provider `reviewed-page`. Its JSON schema is
`reviewed-public-metadata-1`, with `charts` containing exact identities, numeric
fields, explicit region/release, `source_url` and `evidence`. The capture metadata
must hash these extraction bytes. This is labeled a reviewed extraction, not a
raw automated page capture. Direct Gamerch requests returned HTTP 503 during this
review; the browser/search-visible tables were checked separately. This workflow
does not crawl the Wiki or silently retry around failed access.

## Transcription findings and recommendation

Neskol/Maichart-Converts remains the broad retained analysis baseline: 6,959
prepared charts. The accepted pin `e164add85213bab150e1487d5eb15ccb631aedb9`
is also the repository's current head as checked September 17. Its commit date
is April 7, 2026; simply updating the pin will not add September's missing tracks.
The provider describes research-only use and prohibits commercial use in its
[README](https://github.com/Neskol/Maichart-Converts). This source statement is
not a determination of the underlying charts' rights.

Our retained mai-notes index already links 65 of the 292 charts without analysis:
47 MASTER, 15 EXPERT, and one each BASIC, ADVANCED and RE:MASTER. This measures
available linked transcriptions in the retained index, not 65 validated analyses
or a fresh complete audit of the service. It complements the baseline; it is not
evidence that mai-notes can replace all 6,959 prepared charts.

The user-selected [Soteria MASTER page](https://mai-notes.com/player/72bcc10d-6b35-4054-bfb2-cbe5ef7190a6)
contains downloadable simai. A local evaluation on September 17 parsed it and
matched all five [Wiki note counts](https://gamerch.com/maimai/974035): 569 taps,
43 holds, 135 slides, 61 touches and 82 breaks (890 total). Its computed local
analysis is retained under `output/metadata-waterfall/soteria-study`. This proves
usable analysis input for this chart; aggregate note-count agreement does not
prove every timing or path is identical to the game chart. This pilot has not
been imported as browser or Session Report analysis.

Recommended acquisition policy: keep accepted per-chart transcriptions stable;
check refreshed Neskol captures for missing or corrected variants, then mai-notes,
then Wiki simai where supplied. An explicitly reviewed correction can outrank a
retained body. Record all candidates, but select one complete transcription per
chart rather than stitching bodies across providers. Check exact difficulty,
body hash, parser support, note-count agreement and changed-body regressions.
Preserve provenance and implementation fingerprints and keep source acquisition
separate from analysis qualification. Reuse terms and stable acquisition still
need evaluation before adopting mai-notes for routine bulk collection.

## UI changes in the local registry branch

- Added an unchecked **Use maimai international data** checkbox. Both states
  include all charts; default values prefer Japan, while checking it prefers
  available International values and keeps known fallbacks. Genre, version and
  difficulty retain three columns on desktop and two on mobile.
- Renamed the constant heading/sort label to Source constant; its hover text
  now identifies supplemental source/context without a provenance paragraph.
- Included metadata-only charts in search, grouping, filters, difficulty
  selection and comparisons. Counts include these charts; version labels now
  include MAGiCAL. Existing cells show dashes/Unknown where analysis is absent.
- Unprepared charts show unavailable Flow/pattern states and cannot start
  Find similar. Direct comparisons explain insufficient shared measurements.
- Preserved legacy chart/comparison URLs and old release selection. Existing
  mai-notes link controls now cover additional reviewed chart variants.
- Existing player-file import can match accepted metadata-only variants;
  the player-data layout, controls and handoff protocol are unchanged.
- Added the user-supplied Soteria search alias for the exact accepted song.
- Removed the verbose metadata/source-date/analysis-warning detail block.

No Session Report source or UI was edited. No live maimai.party deployment was
made. Main Explore/home content, the pattern lessons, About, Settings, personal
data controls, Analytics and support UI were not redesigned in this branch.
