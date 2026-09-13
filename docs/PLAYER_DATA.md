# Personal data and public integration v1

maimai.party remains a static public chart browser. The optional personal layer reads a compressed player file in the browser, or receives the same file from a report after consent. There is no account, score upload service, report-generator import, or personalized recommendation engine in this layer.

## Player file

The filename is normally `player.maimai.json.gz`: gzip containing UTF-8 JSON. The normative validators are [player_data.py](../src/maimai_intelligence/player_data.py) and [player-data-core.js](../src/maimai_intelligence/assets/player-data-core.js). Unknown schema versions, unexpected fields, invalid references, invalid hashes and over-limit files are rejected before active data is changed.

Top-level fields:

| Field | Meaning |
| --- | --- |
| `format`, `schemaVersion` | `maimai-player-data`, integer `1` |
| `revision` | SHA-256 of canonical JSON excluding this field |
| `player` | Provider, game, username, display name and normalized source identity |
| `charts` | Exact provider chart references, including STD/DX and difficulty |
| `records` | Content-addressed score observations shared by plays and PB snapshots |
| `plays` | Original source play IDs pointing to observations |
| `snapshots` | Content-addressed PB collections, date, before/after phase, completeness and version groups |
| `captures` | Capture/source/session IDs, date, coverage and play/snapshot associations |

Canonical JSON has sorted keys, no insignificant whitespace, UTF-8 text and integers rather than floating-point measurements. Achievement uses 0.0001% units; chart constants use tenths; dates use UTC milliseconds. Unknown optional score measurements are null. Available clear/sync, DX score, combo, timing and judgement fields are retained. Credentials, deployment settings, artwork, HTML and recommendation cards are excluded.

A current PB is the newest applicable snapshot observation, not the maximum percentage ever retained. A complete snapshot replaces the current collection; later incomplete snapshots add observed charts. At the same date, after-capture observations follow before-capture observations. Earlier observations remain available as history. Plays deduplicate by provider identity; provider corrections use the newest associated capture. A snapshot never manufactures a play.

The limits are 32 MiB compressed, 128 MiB expanded, and one million entries per collection. Errors preserve usable data and do not truncate history. Gzip byte sequences may differ across implementations; decoded canonical JSON and dataset revision are the interoperability boundary.

## Personal browsing

Settings contains Import player data, Hide/Show player data, and Forget remembered player data. The import dialog identifies the player and date. Same-player imports retain both histories; a different player replaces the active selection without merging records.

Expanded cards keep chart measurements and pattern activity together, followed by player achievements and history. The two section controls share their expanded/collapsed preferences across songs, tabs and visits. These presentation preferences store only two booleans, independently of the choice to remember player records. Comparison actions and version artwork stay in the primary card.

Remember on this device is explicit and uses IndexedDB. Otherwise the compressed dataset is stored for the tab session, including reloads, in sessionStorage. Browser quota or storage denial produces an explicit error before replacement. Remembered imports use a transactional revision check so a stale tab cannot overwrite another tab's update. Forget removes the remembered copy; the current in-memory view remains until the tab closes or reloads.

The status strip reports identity, capture date and retained-only coverage. Personal filters evaluate exact chart variants before grouping songs. Sorting and displayed achievements use the selected difficulty and STD/DX variant; absent records remain unknown. Chart details distinguish individual plays from before/after PB observations and show retained achievement progress. No session dashboard is introduced.

## Public mapping and matching API

Each immutable catalog release in `manifest.json` includes an `integration` reference with path, SHA-256 and byte count. It points to `integration/<sha256>.json`, schema `maimai-public-integration-1`, matching version 1. It contains public comparison profiles, compact pattern coverage, provider mapping and catalog version. It excludes player data and private recommendations.

`provider-mapping-1` joins provider chart IDs to exact public chart IDs and source hashes. Current and legacy Kamaitachi IDs are retained as aliases. Joins require unambiguous normalized title, artist, format and difficulty. Ambiguities remain unmatched until reviewed centrally in [provider-mapping-overrides.json](../src/maimai_intelligence/assets/provider-mapping-overrides.json), where each override requires a source hash and reason. Users do not match songs manually.

Refresh the minimal provider registry using `python scripts/update_provider_registry.py --ref FULL_COMMIT_SHA`. The bundled provenance records the immutable provider revision and input/output hashes. Catalog generation publishes the mapping automatically; release validation verifies its exact catalog associations.

The standalone Python interface is:

```python
from maimai_intelligence.public_matching import API_VERSION, ComparisonIndex

index = ComparisonIndex(integration["catalog"], integration.get("analysis"))
pair = index.compare(first_chart_id, second_chart_id)
matches = index.similar(first_chart_id, eligible_ids=allowed_ids, limit=8)
```

It preserves the browser's measurement normalization, coverage requirements, pattern weighting and one-result-per-song-family ranking. Missing pattern evidence falls back to measurements; insufficient measurement coverage yields no match. This describes chart structure, not predicted performance. Session Report pins these small public modules with provenance and owns its own target selection.

Full retained public catalogs allow 64 MiB and are published in verified 8 MiB
parts. The browser startup index retains its separate 32 MiB bound and carries
only the provider fields needed for exact personal matching. Complete provider
metadata stays in the integration artifact. The reviewed 6,959-chart release
produces an approximately 17.1 MiB startup index and 17.5 MiB integration artifact.

## Navigation and handoff

- Details: `?version=V&view=catalog&chart=ID`
- Similar charts: `?version=V&view=compare&left=ID&similar=1`
- Unmapped charts: explicitly labeled title-search fallback, with the personal record retained.

A report opens a new tab and passes only a one-use nonce in its fragment. The receiver removes that fragment before analytics can load. Protocol `maimai-player-handoff/1` binds messages to the opener/opened window, fixed destination origin and nonce. An offer contains identity, date, counts and retained observation IDs; the compressed payload travels over a MessageChannel only after acceptance. Local file openers use their browser-defined opaque origin. Scores never enter query strings, analytics events or messages back to the report.

Matching/subset data is reused. Newer remembered results retain precedence while missing history can be added. Refusal hides personal results for this arrival and preserves remembered data. The destination chart/view remains selected through import, refusal and reload. Blocked/interrupted transfers have a download/import recovery path.

## Validation

`tests/test_public_contracts.py` checks exact mapping ambiguity handling and Python/JavaScript measurement and pattern ranking parity. The downstream synthetic browser acceptance suite tests Chrome, Edge, Firefox and WebKit across local HTML, local serving and protected report pages. Public catalog/release tests verify integration artifact hashes and retained catalog versions.

Publish this public catalog and importer before enabling newly generated connected reports. Existing immutable public releases remain available. This change does not publish the site by itself.
