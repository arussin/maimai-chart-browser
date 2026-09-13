# maimai.party · Chart Browser

A standalone static chart browser, reusable Python intelligence engine and
read-only Kamaitachi downloader. Personal recommendations are calculated during
download/export; searching, filtering, Flow and structural comparisons are interactive.

Requires Python 3.11+. The package has no runtime dependencies and does not require
the report library. Install from this checkout with `python -m pip install .`.

## Preview

```sh
maimai-chart demo --output output/site
python -m http.server 8765 --bind 127.0.0.1 --directory output/site
```

Open `http://127.0.0.1:8765`. The bundled demo is fictional, not game coverage.
Build with real reviewed metadata using
`maimai-chart site --catalog catalog.json --catalog-version RELEASE --output output/site`.
Catalog versions are immutable; repeated builds retain older releases and links.
Serve the generated directory as static files, including its manifest and assets.
No account service, upload endpoint or application server is required.
The [public release plan](docs/PUBLIC_RELEASE.md) follows completion of the active
pattern-detection goal. It covers public source, maimai.party hosting, community
contributions and owner-only official corpus publication. See [contributing](CONTRIBUTING.md).

Both browser pages use the maimai.party wordmark, with Deluxe-inspired colors
on `.party`. Their shared footer includes creator support, the GitHub link,
an independent-fan-project rights notice and **Credits & thanks**. See
[attribution and source roles](THIRD_PARTY_NOTICES.md). The project repository is
public; contributions use issues and pull requests. Official site publication is
an explicit owner operation described in [the owner guide](docs/OWNER_PUBLICATION.md).

The published HTTPS site includes optional Google Analytics for broad page views.
It loads only after visitor opt-in; local previews are excluded. Personal files,
searches, chart selections and full URLs are never analytics event data. The
footer includes privacy details and a way to withdraw consent without clearing
results. See [Analytics setup and launch verification](docs/ANALYTICS.md).

To open the full research browser alongside Explore, add
`--lab-package PATH/TO/challenge-v1` to the demo or site command. It verifies the
pinned research package and externalizes its data behind an immutable release
manifest. The main page links to the research browser, with three views:

- **Charts:** combine genre, version, difficulty, format and level-range filters.
  Select multiple versions together. Each song/format row offers a difficulty
  selector containing the exact charts that match the filters, including
  same-level MASTER/RE:MASTER variants. The selected difficulty colors the row
  and supplies its level, source BPM, input rate and comparison actions. Click
  anywhere else on the row to open details. Click column headings to sort and
  reverse; Shift-click or **Keep sort priorities** adds tie-breakers. Visible
  priority chips can remove a rule. Sorting always uses the selected chart.
  Changing sort or search retains the filters.
  Song search also accepts community romaji and alternate titles: **Umiyuri**
  finds **ウミユリ海底譚**, and **Senbonzakura** finds **千本桜**. Spaces, punctuation,
  capitalization and full-width Latin letters are tolerated. The same aliases
  work in Explore and both comparison pickers; original titles remain displayed.
  [Alias coverage and source details](docs/SONG_SEARCH.md).
  Source song BPM is display metadata; passages may change tempo. Unknown BPM
  remains unknown and sorts last in either direction.
  **YouTube search** opens a new tab using the song title, chart format and selected
  difficulty. The same links appear on comparison selections and similar matches.
  These are searches, not verified video matches; availability is not guaranteed.
  No YouTube video, thumbnail or request loads until a visitor follows a link.
  Blank-title entries have no search link.
  Prepared experimental pattern tags link to lessons; the pattern filter keeps
  only matching difficulties. Details show observed counts and chart-time spans.
  Each row has a 24-section Flow graph with density means and brief peak marks.
  Mini graphs use their own peak scale; comparisons share one vertical scale.
- **Pattern dictionary:** all 56 lessons have an authored example and a contrast,
  explanations, variants and limits. Play, Step, speed and progress controls work
  across the 56 primary demos; contrasting cases remain in the lesson data.
  Input patterns use timing and position views; chart traits
  use activity graphs or highlighted phrases. A current-event readout describes
  each step. Umiyuri has a scoped, source-linked illustration of one recurring
  form. Teaching examples do not assign real-chart labels or validate detectors.
  English aliases include jacks, sweeps, spins and connected slides. Ten added
  community motifs and ten related structural forms have English lessons,
  schematic curves where needed, and scoped experimental recognition rules.
  See the [community-pattern reference and coverage](docs/patterns/COMMUNITY_PATTERNS.md).
  See the [dictionary checklist and remaining review](docs/PATTERN_DICTIONARY.md).
- **Compare charts:** choose any two charts using the searchable pickers, or
  choose one and **Find similar** across the catalog. Comparisons use existing
  chart measurements for input speed, rhythm, simultaneous inputs, holds, slides
  and layout. Similar matches show one chart per song family; optionally apply
  the active chart filters. Links retain both chart IDs and the catalog version.
  Shared and differing patterns, occurrence counts/rates and paired Flow graphs
  appear before the measurement table. **Patterns & measurements** prioritizes
  experimental pattern presence, occurrence rate and time covered (60% total),
  with measured demands contributing 40%. Rarer patterns receive more weight;
  unsupported coverage never counts as absence. **Measurements** retains the
  previous ranking. These are experimental comparisons, not qualified community
  family labels or personal recommendations. Synchronized passage animations remain available
  for prepared pairs, with the original examples under **Prepared passage
  demonstrations**.

The interface follows the report site's white/teal presentation. Dictionary
links retain the research catalog version and pattern ID. Research data is not
included in the Python distribution or source repository and cannot accept
personal results.

To prepare the research pattern/Flow extension from retained inputs:

```sh
python scripts/build_research_overview.py RETAINED_SOURCE EXISTING_PACKAGE NEW_PACKAGE
maimai-chart demo --output output/site --lab-package NEW_PACKAGE
```

This offline command runs the existing 14 experimental detectors and Flow
calculation for each exact chart, preserving source hashes. It writes resumable
caches and publishes a new package manifest only after all charts finish. The
original package, rankings, archives and personal services are unchanged. The
browser build adds an immutable release; older links retain their earlier data.

## Download and prepare personal results

```sh
maimai-chart download USERNAME --game maimaidx --store .snapshots/player
maimai-chart prepare --snapshot .snapshots/player/captures/SNAPSHOT_ID/snapshot.json --catalog catalog.json --catalog-version RELEASE --mapping reviewed-mapping.json --output output/my-results.json
```

The downloader reads existing Kamaitachi PBs and recent scores. It never triggers
a game import. If access requires a token, supply `KAMAITACHI_API_TOKEN` through
the process environment; it is never written into a snapshot or browser file.
No automatic retries or scheduled requests are performed.

To download and prepare in one command, add the four preparation options to
`download`. Optional `--settings settings.json` selects the existing recommendation
policy, practice goal and quotas. Changing a goal requires preparing another file.
Open the resulting file using **Open my results**. It stays in the tab's memory;
**Clear my results** or a page reload removes it. Nothing personal is uploaded.

Each store belongs to one player/game. Its manifest lists successful immutable
captures and the latest identity. Each capture contains `pbs.json`, `recent.json`
and `snapshot.json`. Available attempts accumulate by exact score ID, but history
remains incomplete: polling recent scores cannot reconstruct every past attempt.
An interrupted capture cannot replace the previous latest pointer. A stale lock
requires checking that no writer is running before manually removing it.

## Integration

Python interfaces: `maimai_analyzer.catalog.build_catalog`,
`maimai_intelligence.snapshots.download_snapshot`,
`maimai_intelligence.bundles.prepare_player_bundle` and `export_report_bundle`.
For public summary matching, `maimai_analyzer.challenge_similarity.query_demands`
accepts existing chart profiles and a reference scale without requiring passage
windows. The browser uses equivalent percentile and distance calculations.
See [the versioned contracts](docs/CONTRACTS.md) and
[report integration](docs/REPORT_INTEGRATION.md).

Normal report installations need neither this repository nor the engine.
Prepared cards and catalog-specific links are an optional report feature.
Existing archives require no migration or historical backfill.

The current transcription study is evaluation data. It remains nonpersonal and
cannot be used for verified rating recommendations. A personal bundle requires
an explicitly reviewed exact provider-to-catalog mapping and a qualified catalog.
Unknown achievements, missing attempts and unverified availability stay unknown.

## Development

Run `python -m unittest discover -s tests` with `PYTHONPATH=src` (and repository
root on the import path). Browser tests live under `tests/browser`; install their
locked dependencies with `npm ci`, install Playwright browsers, and run `npm test`.
The build backend supports wheel and source distributions without downloading
build dependencies. Original analyzer and Python/JavaScript similarity parity
fixtures are retained.

The existing research acquisition/build scripts and Challenge Lab renderer are
preserved separately. They remain explicit offline/research workflows; opening
the main browser does not run them. Attribution: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).


## Chart filters

Difficulty is a checkbox menu: choose any combination of BASIC through RE:MASTER.
Rows retain a selector for the matching difficulty currently displayed.
The level range has two draggable, keyboard-accessible handles plus editable
From/To fields. Enter or leave a field to apply it; `13.5` is accepted as `13+`.
Bounds use the levels present in the selected catalog. Invalid text leaves the
applied range unchanged, and typing a bound past the other moves both to that
level. Clear a field to restore that end of the full range. Reset levels leaves
other filters intact. Comparisons use the same difficulty/range constraints when
“Use chart filters for matches” is enabled. Patterns use a searchable checkbox menu;
search includes aliases and selections match any chosen pattern. Selected patterns
remain as removable chips and round-trip through repeated `pattern-filter` URL
parameters; existing single-pattern links and dictionary discovery still work.
Patterns without supported coverage are shown disabled.

## Optional public artwork

Prepare jackets and version logos once, then serve the generated local WebP files.
Preparation requires Pillow (`python -m pip install Pillow`); browsing and building
an already prepared package keep the normal dependency-free installation.

```sh
python -m scripts.prepare_public_artwork output/challenge-patterns-v1 output/challenge-artwork-v1 --cache output/artwork-cache/downloads
maimai-chart demo --output output/site --lab-package output/challenge-artwork-v1
```

The command reads public metadata and images only. `--offline` reuses the cache
without network access. A missing image becomes a neutral placeholder. Jackets
require a unique normalized title **and artist** match; this display lookup does
not establish chart identity or enable personalization. The package records source
URLs, source hashes and converted image hashes. Browsers load only same-site assets,
with no account information, remote image requests or third-party scripts.

The retained source already includes CiRCLE (78 song/format entries, 315 charts)
and CiRCLE PLUS (18 entries, 75 charts). Its upstream default branch was checked on
2026-09-11: commit `e164add85213bab150e1487d5eb15ccb631aedb9` still matches the
retained tree, with no added or changed paths. The latest upstream release is
[v1.66_1.0.9.0](https://github.com/Neskol/Maichart-Converts/releases/tag/v1.66_1.0.9.0),
the CiRCLE PLUS launch update; this is source coverage, not a complete current-game
catalog. Versions in the selector show their actual song and chart counts.
