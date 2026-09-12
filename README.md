# maimai Chart Browser

A standalone static chart browser, reusable Python intelligence engine and
read-only Kamaitachi downloader. Personal recommendations are calculated during
download/export; searching, filtering, Flow and structural comparisons are interactive.

Requires Python 3.11+. The package has no runtime dependencies and does not require
the report library. Install from this private checkout with `python -m pip install .`.

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
Permanent hosting is a separate rollout.

To open the full research browser alongside Explore, add
`--lab-package PATH/TO/challenge-v1` to the demo or site command. It verifies the
pinned research package and externalizes its data behind an immutable release
manifest. The main page links to the research browser, with three views:

- **Charts:** combine genre, version, difficulty, format and level-range filters.
  Select multiple versions together. Click anywhere on a chart row to open its
  details and choose **Compare this chart** or **Find similar**.
  Three ordered sort rules apply to individual chart variants and break ties in
  order. Changing sort or search retains the selected filters.
- **Pattern dictionary:** all 36 reference definitions, including 14 authored
  schematic demos with play, step, speed and progress controls. Supported input
  patterns also show an animated eight-button layout. Definitions awaiting
  review remain available without invented demos or real-chart assignments.
- **Compare charts:** choose any two charts using the searchable pickers, or
  choose one and **Find similar** across the catalog. Comparisons use existing
  chart measurements for input speed, rhythm, simultaneous inputs, holds, slides
  and layout. Similar matches show one chart per song family; optionally apply
  the active chart filters. Links retain both chart IDs and the catalog version.
  These are experimental demand comparisons, not named-pattern recognition or
  personal recommendations. Synchronized passage animations remain available
  for prepared pairs, with the original examples under **Prepared passage
  demonstrations**.

The interface follows the report site's white/teal presentation. Dictionary
links retain the research catalog version and pattern ID. Research data is not
included in the Python distribution or source repository and cannot accept
personal results.

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

Normal report installations need neither this private repository nor the engine.
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
