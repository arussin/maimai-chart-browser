# Persistent official inventory

The registry determines which ordinary charts the browser knows about. SEGA's
Japanese and International listings provide observed song metadata and explicit
STD/DX difficulty slots. Retained transcriptions, experimental analysis, player
links and provider mappings enrich those chart identities independently.

This implements the approved registry migration and its browser compatibility
work. It does not acquire new chart bodies, change the accepted transcription
source pin, upgrade experimental analysis qualification, change the player-file
protocol, or deploy the site. Future source acquisition and a new Session Report
integration contract remain separate work.

## Initial accepted inventory

The September 17, 2026 reconciliation retains all 6,959 previously published
charts and adds 292 explicit ordinary chart slots: 7,251 charts across 1,694
active songs. All 51 titles in the missing CiRCLE PLUS audit are represented
(205 chart slots). The registry also includes 17 MAGiCAL titles and additional
chart variants for existing songs. The new slots have metadata but no prepared
analysis. None receives a placeholder source hash or demand profile. Missing numeric
metadata was subsequently filled from the reviewed metadata waterfall.

| Retained official capture | Ordinary songs | Explicit slots | Utage rows outside scope |
|---|---:|---:|---:|
| Japan | 1,498 | 6,443 | 96 |
| International | 1,388 | 5,967 | 79 |

These are capture counts, not claims about playability on a particular machine
or an exhaustive historical inventory. International data was retrieved on
September 17 but its retained Last-Modified header is July 17; retrieval does
not establish that its contents are as recent as Japan's.

Official source URLs and SHA-256 digests:

- `https://maimai.sega.jp/data/maimai_songs.json`:
  `109e93dc03f476e385118ff557dcbb55f9ac7b2a819646d14123b081c832deae`
- `https://maimai.sega.com/assets/data/maimai_songs.json`:
  `78416cd5fa103d4e5c04c2123cb4f741810a806f8409bde53ff9a3a3d16bed41`

`registry/reconciliation-20260917.json` records source-bound decisions, including
71 merges of previously separate STD/DX song families with disjoint chart slots
and 11 reviewed artist-credit differences. Chart IDs remain unchanged by those
song merges. Distinct artists with the same title (including Link) stay distinct.

`registry/enrichment-review-20260917.json` records 65 additional mai-notes links
and four Kamaitachi mappings for Break The Speakers. The retained mai-notes
snapshot is the same one used by the accepted September 13 release:
`86a795f88e235e10736b8518e4d6473de4bea42feaf86ac7b099ea8673b0fe0f`.
The Tachi pin remains `f08148f8644e40de9b178445df4bd59da712d3de`.
Only sanitized song/chart metadata is admitted; unrelated fields in a source
index are not copied into the registry or public assets.

The accepted Neskol revision remains
`e164add85213bab150e1487d5eb15ccb631aedb9`. Its original measurements and the
latest hash-verified published pattern analysis are preserved. Search aliases
for 1,073 songs retain their published provenance. Existing mappings retain
`legacy_published` acceptance; the migration does not imply a new manual review
of every historical mapping.

## Storage and identity

`registry/manifest.json` binds the exact bytes of six ordinary JSON tables:
`songs`, `charts`, `observations`, `mappings`, `legacy-ids` and `sources`.
Their schema is `maimai-registry-1`. Keep this directory under version control.
It contains accepted metadata and provenance, not chart text or personal data.

Song and chart IDs are opaque UUIDs minted once and retained. A chart identity
belongs to a song, format and exact difficulty. Neither display text, SEGA sort
order, printed level, body hash nor a provider ID is the persistent identity.
Source title/artist assertion hashes are reconciliation keys only. New matches
are proposals until an explicit, evidenced decision accepts them. Song redirects
retain their history; merges require disjoint variants and explicit evidence.

Each observation is bound to a source snapshot and region. Repeated identical
capture bytes do not become a newer observation. A chart missing from a complete
later capture becomes `not_observed_in_latest_capture`, without losing its
identity or last positive metadata. `removed` and `announced` states require a
separate notice source, effective date and evidence; absence alone cannot create
either state. Initial deployment contains no inferred removal notices.

Selected transcription revisions retain body/container hashes, byte bounds,
input ID and selection history. Explicit revision selection keeps the same chart
ID. Importing an older published alias cannot revert a reviewed current
transcription. Analysis caches cover effective body and container bytes, byte
bounds, parser/analyzer versions and implementation hashes. Registry metadata
edits do not invalidate analysis. A container-byte change conservatively does,
even when its individual body is unchanged.

## Browser and integration contracts

| Surface | Current inventory release | Retained releases |
|---|---|---|
| Browser catalog | `maimai-browser-catalog-2` | Original bytes |
| Research package | `challenge-package-2` | Existing package reader supported |
| Startup index / details | `catalog-index-2` / `chart-details-2` | Version 1 supported |
| Public release manifest | `1.3.0` | All previous entries retained |
| Browser provider mapping | `provider-mapping-2` | Version 1 supported |
| Browser mai-notes links | `mai-notes-links-2` | Version 1 supported |
| Session Report integration | `maimai-public-integration-1` | Unchanged |
| Player file and handoff | Schema 1 | Unchanged |

The internal retained browser manifest remains `1.0.0`; the deployable manifest
is `1.3.0`. Legacy full-catalog and integration URLs retain their exact bytes.
Legacy chart and comparison IDs resolve through the current release's alias
table, while explicitly selected old releases continue using their original IDs.

Charts without analysis participate in search, song/format grouping, filters,
details, provider lookup and comparison selection. Demand, patterns and Flow
remain unknown. They cannot seed similarity or contribute fabricated zeros.
Progressive loading does not request a nonexistent analysis bucket or offer an
endless retry for an intentionally unprepared chart.

The catalog always includes every retained chart, including International-only
and historical entries. The unchecked **Use maimai international data** checkbox
prefers Japan values, falling back to International and then retained metadata
per field. Checking it prefers available International titles, artists, printed
levels, genre, introduction version and supplemental constants; missing values
keep the default fallback. It never filters regional membership. Reset filters
also restores the unchecked preference. Constant hover text follows the actual
selected source, including when a Japanese value is used as a fallback.
The genre/version/difficulty controls keep their original three-column layout.
The verbose metadata detail block was removed after user review. Existing source
constants retain their scope; missing BPM and constants follow the reviewed
[metadata waterfall](METADATA_WATERFALL.md). No decimal is guessed from a printed
level.

The Session Report adapter exports only genuine legacy experimental profiles,
their original IDs and body hashes, and their matching analysis. Its
`matching_version` stays 1 and its mapping remains `provider-mapping-1`.
Metadata-only charts are excluded from that adapter. Browser schema-1 player
files may still map to a metadata-only chart through an accepted exact variant
mapping; doing so does not qualify chart analysis. Browser storage, merging and
handoff acknowledgement behavior are unchanged.

## Owner preparation

Use a real checkout outside OneDrive, for example
`C:\Users\adamr\Projects\maimai-chart-browser-registry`. Keep environments,
dependency trees, caches and development outputs there. Do not rebuild the
checked-in registry from scratch: that would mint different persistent IDs.

Run the following from the repository with the package installed, or set
`PYTHONPATH=src;.` on Windows. Every output directory should be fresh.

1. Capture both fixed official endpoints, with bounded reads and no redirects:

   ```text
   python -m scripts.capture_official_inventory --output output/registry-sources/NEW_CAPTURE
   ```

   Both sources must validate before `complete.json` is written. Retain the raw
   bytes, HTTP metadata, hashes and original timestamps outside public assets.

2. Prepare reconciliation proposals against the accepted registry:

   ```text
   python -m scripts.prepare_official_registry --registry registry --jp-capture output/registry-sources/NEW_CAPTURE/sega-jp.json --jp-metadata output/registry-sources/NEW_CAPTURE/sega-jp-metadata.json --intl-capture output/registry-sources/NEW_CAPTURE/sega-intl.json --intl-metadata output/registry-sources/NEW_CAPTURE/sega-intl-metadata.json --output output/registry-proposals
   ```

   Review new title/artist assertions and exact slots. The review schema is
   `official-reconciliation-1`, with `regions.JP` and `regions.INTL`, each
   containing `source_sha256` and a `decisions` map keyed by assertion hash.
   Decisions use `action: link` with `song_id`, or `action: admit`; both require
   `evidence`. Optional `song_merges` name `source`, `target` and `evidence`.
   A decrease greater than 10% requires a written `count_review`. Unknown chart
   slots, duplicate assertions and malformed rows stop preparation.

3. Run the same command with `--decisions REVIEW.json` and a fresh output
   directory. Review the new tables and sibling coverage file before replacing
   the accepted registry through normal code review. Keep the review JSON.
   Preparation never automatically accepts a metadata candidate.

4. To select an already accepted transcription package, use
   `scripts.prepare_registry_transcriptions` with `--registry`, `--package`,
   `--review` and a fresh `--output`. The review schema
   `transcription-selection-1` binds `package_sha256` and a `selections` map
   keyed by input ID. Each selection binds `body_sha256`, `container_sha256`,
   `chart_id` and `evidence`. Missing or unsupported outcomes do not remove
   registry entries. Acquisition from any new provider requires its own review.

5. Build the public candidate from accepted metadata and retained analysis:

   ```text
   python -m scripts.update_catalog prepare --store output/registry-updates --previous-browser PREVIOUS_RUN/browser --package ACCEPTED_PACKAGE --registry registry --offline
   ```

   Omitting `--package` intentionally produces inventory without prepared
   measurements; known chart identities, source metadata and accepted links
   remain. No mai-notes network refresh is performed in the registry path.
   When the retained package's profiles exactly match the previous published
   profile set, the latest verified published overview is preserved.

Review `report.md`, `changes.json`, `registry-provenance.json`, the local preview
and `ready.json`. The readiness receipt is written last and binds source code,
the accepted registry and every public file. It becomes invalid after an
implementation or registry change; prepare a fresh run. All 11 historical
releases remain in the initial migration candidate.

Publication is the separate owner operation in
[Catalog updates](CATALOG_UPDATES.md#review-and-publish). The existing writer
lock, clean checked main requirement, live-base check, allowlisted output,
uncertain-upload marker and verified `latest.json` update remain enforced.

## Validation

Run the repository's Python tests, Ruff checks, demo build and browser suite.
Registry cases cover persistent identity, regional disagreement, missing
analysis, reviewed mapping without transcription, corrected-body invalidation,
older-alias import, capture failure, retained release integrity, and the genuine
v1 integration adapter. Browser cases cover metadata-only search and comparison,
regional preferences, legacy links, synthetic schema-1 player data, responsive
layout and Chromium/WebKit. Personal score files are not needed for validation.
