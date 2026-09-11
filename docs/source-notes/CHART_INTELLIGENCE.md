# Chart Intelligence: experimental local implementation

This feature branch adds a player-independent analyzer, evidence-bearing project
patterns, structural and section retrieval, a reusable Explore view, compact Flow,
and opt-in chart-aware Targets. Its examples are authored synthetic charts.
It is not a reviewed maimai chart database or a validated coaching system.

The implementation base is canonical main
`79ec9670a0d7a410c086b848d7302c49e6888b09`. Main and open PRs were rechecked before
work; there were no open PRs. The existing rating-contribution implementation,
historical originals, and verified-correction/original fallback are preserved.
Explore remains opt-in. Follow-up presentation fixes restore the official rating
frames and add sortable Scores headers; these change newly rendered HTML while
leaving retained historical artifacts untouched.

## Run the first end-to-end slice

Use the pinned contributor environment described in [CONTRIBUTING](../CONTRIBUTING.md).
These commands consume bundled synthetic inputs or explicitly selected local files:

```console
python -m maimai_analyzer demo --output output/synthetic-profiles.json
maimai-report explore --demo --output output/chart-catalog.html
maimai-report explore --demo --private-demo --output output/chart-report.html
```

The standalone catalog contains no report or private-overlay payload. The private
demo retains the normal four report views and adds Explore, with a separate fictional
PB overlay and a structural practice candidate. Legacy Targets remain accessible.
It does not retrofit the analyzer examples into the unrelated legacy rating fixture.

Analyze a normalized chart and prepare a catalog from explicit inputs:

```console
python -m maimai_analyzer analyze normalized-chart.json --output output/profile.json --cache-dir output/profile-cache
maimai-report build-catalog --metadata catalog-metadata.json --profiles output/profile.json --output output/catalog.json
maimai-report explore --pack output/catalog.json --output output/explore.html
```

These preparation commands reject resolved output or manifest paths that alias
their explicit input files. Keep inputs and derived artifacts at distinct paths.

Metadata is an object with `catalog_id` and `charts`. Each chart requires
`chart_id`, `song_id`, `format` (`STD`/`DX`), `difficulty`, `revision`, and `title`.
Optional fields are artist/aliases, level/constant, release/region/availability,
source ID/revision/status/hash, and identity status. Defaults are unknown or
missing. Profiles attach only to matching exact variants and compatible source,
registry, analyzer and frozen configuration. One failed or stale profile remains
an explicitly unavailable catalog entry. The separate manifest records hashes,
coverage and diagnostics. Neither file accepts a player overlay.

Saved catalog packs and embedded HTML use lossless `maimai-dictionary-1` encoding
for repeated schemas, strings and structural records. Decoding precedes strict
catalog validation; encoding follows it. The browser holds deeply frozen shared
records, while the Python decoder returns independent mutable containers. No
raw chart bodies or all-pairs similarity matrix are embedded. See the measured
[review checkpoint](CHART_INTELLIGENCE_REVIEW.md) for payload and capacity limits.

An independent strict Simai reader supports the initial
[two-transcription evaluation](REAL_CHART_PILOT.md), the
[expanded study](REAL_CHART_STUDY.md), and a
[broader notation adapter](SIMAI_NOTATION_SUPPORT.md) tested against the frozen
public transcription corpus. Research results use the same standalone Explore
interface with an explicit research flag. This is not a general chart importer;
ordinary catalog builds and private recommendations withhold evaluation profiles. See the
[normalized input contract](ANALYZER_CONTRACT.md) and
[source audit](CHART_SOURCE_AUDIT.md) before onboarding permitted chart sources.

## Optional private report integration

Existing local `render` accepts `--explore-pack output/catalog.json` and optionally
`--chart-map reviewed-chart-map.json`. The latter is an exact provider-chart-ID to
catalog-chart-ID object; absent a map, only identical IDs join. Titles never join
variants. The renderer uses the retained `generatedAt` cutoff. PBs are maxima,
not attempts; unknown attempt counts and last-play times remain unknown. Supplied
attempts are deduplicated by stable ID and later attempts do not leak into earlier
reports. PB achievement time is separate from last recorded attempt time.

Direct `build_html` and `render_report` calls enforce the same retained-report
date boundary. A supplied private overlay requires a timezone-bearing
`generatedAt`; later result dates or a later declared overlay cutoff are rejected.
An omitted overlay cutoff stays omitted, and an older cutoff remains an additional
bound. The synthetic private demo derives its dates from its fictional report.

`--practice-pattern pattern.two_position_alternation` requests a specific structural
practice search. Without a selected pattern, Targets does not diagnose a weakness.
Practice requires occurrence evidence and a measured reduction in the selected
demand with bounded changes in all other measured prerequisite dimensions.
Discovery says **no recorded result**, never verified unplayed.

The follow-up scorer adds explicit relevance, occurrence-window repetitions,
section isolation, prerequisite observations, provenance quality, freshness,
context diversity and retry-saturation terms. Unknown terms retain null values
and widen score bounds; weights are provisional preferences. Directed practice
also requires supported timing within the selected pattern, so extra silence
cannot make a faster pattern appear simpler. This local gate currently supports
only the two v0.1.0 run grammars documented in [structural retrieval](STRUCTURAL_SIMILARITY.md).

`render` also accepts `--practice-goal GOAL.json`, `--attempts ATTEMPTS.json` and
`--target-quotas 2 2 1`. These consume explicit private local inputs with the same
date and overwrite guards; they perform no score import or account request.
Goals and attempts never enter the catalog-only output. See the
[scoring engine audit](SCORING_ENGINE_STATUS.md) for schemas, exact weights,
thresholds, computed synthetic fixtures and unimplemented validation gates.

For conditional rating opportunities, additionally supply `--rating-policy policy.json`
and explicitly declare `--pb-snapshot-complete`. All relevant PBs, including
uncounted charts, must map; missing or mismatched region/version/availability facts
prevent exact complete-pool claims. The policy's region/release, current-version
names, coefficient boundaries, achievement cap, AP behavior and source IDs are
explicit. No live policy is chosen implicitly. See
[rating policy and evidence](../src/maimai_report/recommendations/README.md).

The recommender simulates Old35/New15 pools with the existing calculation as its
baseline, exposes useful score boundaries and minimum increments, and distinguishes
gain **if achieved** from reachability. PB-only evidence remains unknown; repeated
recent attempts can produce explicitly uncalibrated same-chart labels. The full API can recompute combined
targets; cards explicitly warn that competing individual gains cannot be added.
An unattainably fine mathematical achievement increment is not a promised judgment
combination or a success probability.

## Interpretation and known limits

- The supplied 36 definitions remain a seed catalog. Fourteen individually
  implemented primitives/traits are experimental project operational definitions;
  the remaining entries do not produce confident tags. No detector is described
  as trained, and no learning effect has been established.
- Umiyuri was researched beyond title metadata: an explanatory transcript and
  annotated first-chorus chart stills were inspected. Its family grammar, exact
  normalized references and held-out recognition evaluation remain incomplete,
  so automatic Umiyuri tagging stays disabled.
- Flow uses prepared 250 ms frames and 24 display segments, measured density and
  a separate explicitly provisional structural-demand composite. Shared fixed
  bands and within-chart shape are different modes. Unknown coverage is hatched;
  peaks have a non-color notch. Source/audio offsets remain separate from chart time.
- Similarity compares ordered role/relative-position/beat-spacing sequences and
  supported scalar structure. Exact trigram multisets cover all tokens; preview
  truncation does not discard the rest of the sequence. This detects local sequence
  resemblance, not global phrase alignment, exact hand assignment, mirror
  equivalence or a proven globally easier chart.
- Filters run before retrieval. No all-pairs neighbor matrix, service, trained model
  or live browser API exists. Pagination bounds displayed chart rows to 50.
- Rich complete-attempt history, empirical reachability calibration, general Simai
  parsing, broad real-chart source coverage and validated named-family recognition
  remain separate uncompleted acceptance gates. Only backed filters are exposed.

Source URLs stay in research documentation. The default generated HTML rejects all
external HTTP/HTTPS URLs and uses local assets and safe script-data encoding. New
optional analysis does not run during sync, installation, archival, or publication.

## Review and maintenance

The [public transcription corpus baseline](SIMAI_CORPUS_AUDIT.md) records an
explicit acquisition of the frozen Standard/DX source indexes and a separate
hermetic run over every advertised variant. Its research catalogs and failure
audit remain local evaluation artifacts; this does not promote them into account
reports or establish validated game-catalog coverage.

Run the original lint/unit/Worker/browser checks plus the new analyzer, catalog,
similarity, recommendation and Explorer tests. Linux CI additionally runs the
analyzer suite and demo inside an operating-system network namespace with no
network interfaces. Windows-local in-process network guards are complementary;
they are not claimed as equivalent OS isolation. Cache reuse requires all source,
normalized, parser, registry, config, geometry and reference identities to match.

Each detector change needs an explicit version and positive/hard-negative evidence.
Keep full research locators, exact chart variants and evidence scope in preparation
manifests. Review recognition and teaching claims independently. Never promote a
definition by toggling all seed flags, guessing from a song title, or treating
source access failure as zero chart coverage.

The [approved specification](CHART_INTELLIGENCE_SPEC.md) remains the full contract.
The review checkpoint records measured tests, capacity limits and remaining work;
this experimental slice does not declare all of that contract complete. Merge,
installation-pin changes, real score imports and deployment are separate actions.
