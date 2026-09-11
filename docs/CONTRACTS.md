# Versioned data contracts

All new envelopes use `schema_version: "1.0.0"`. The existing public catalog
schema and lossless `maimai-dictionary-1` encoding are unchanged. Canonical hashes
use UTF-8 JSON, sorted keys, compact separators, Unicode preserved and no NaN.
Hashes identify content; they are not signatures or proof that a source is true.

## Public catalogs

`site` publishes `manifest.json`: `default: {id, version}` and `catalogs`, whose
entries carry `id`, `version`, `sha256`, `path`, `bytes`, `label`, and
`evaluation_only`. `path` is exactly `catalogs/<sha256>.json`; the hash covers the
file bytes. The loader accepts same-origin assets only, omits credentials, bounds
reads to 32 MiB and checks integrity before decoding. Each catalog release is
immutable. The manifest is the only discovery interface; consumers never scan
directories or infer the newest version from filenames.

URLs use `?catalog=ID&version=VERSION&chart=EXACT_ID`, optionally `section`,
`pattern`, and comparison `mode`. Missing versions are recoverable through the
catalog selector; missing charts/sections are reported without guessing a match.
Older catalog releases remain available after subsequent builds.

## Downloader snapshots

One store is scoped to `{provider: "kamaitachi", username, game}`. Its manifest
contains successful `captures` and a `latest` snapshot ID. Immutable records live
at `captures/<snapshot_id>/{pbs,recent,snapshot}.json`. `snapshot_id` hashes the
normalized snapshot excluding that ID itself. The snapshot contains source,
cutoff, original PB body, deduplicated observed attempts, coverage and raw hashes.
Raw responses are retained separately. Credentials are not part of these records.

Acquisition performs two GET requests to the existing PB and recent-score read
endpoints. Both responses must succeed before a capture is committed. A store
lock prevents concurrent writers. Files are flushed and the complete capture is
renamed into place before one atomic manifest replacement. A failed manifest
write may leave a complete unlisted capture; the same retry verifies and adopts
it. It cannot advance the previous latest pointer prematurely.

PB timestamps are not play history. Observed attempts accumulate by exact score
ID, conflicting duplicates fail, and missing earlier/intervening attempts remain
unknown. Capture time is distinct from PB and attempt times. No all-time-history
claim is made from the recent-score endpoint.

## Reviewed mapping and personal bundle

The explicit mapping document contains:

```json
{
  "schema_version": "1.0.0",
  "provider": "kamaitachi",
  "verification": "reviewed",
  "source_ids": ["your-mapping-review-reference"],
  "catalog": {"id": "catalog-id", "version": "release-version", "sha256": "catalog-file-sha256"},
  "charts": {"exact-provider-chart-id": "exact-catalog-chart-id"}
}
```

Mappings must be one-to-one and point to existing catalog IDs. Titles are never
used for joins. Review metadata records an explicit caller-supplied review; it
does not automatically verify identities. Research/evaluation catalogs remain
ineligible regardless of the mapping declaration.

`maimai-personal` bundles contain the catalog reference, snapshot ID, cutoff,
engine version, recommendation settings, mapping digest, validated personal
overlay, prepared recommendations and small chart summaries for report cards.
The bundle excludes raw responses, credentials and account identifiers. Results
are still private. The site validates the exact selected catalog/engine version,
record types, IDs, duplicates and cutoffs before replacing an active view.

The browser reads personal files through the local file picker only. It neither
uploads them nor stores them in localStorage, sessionStorage or a database.
Catalog changes, clear and reload discard the active personal view. A personal
bundle cannot cause the site to fetch a URL or select an arbitrary hosted source.

Recommendation options are the existing `policy`, `complete`, `practice_pattern`,
`practice_goal` and `quotas` settings. Preserve explicit release/region policies,
qualification, completeness and evidence limits. Re-prepare a bundle to change
goals. Normal filtering and structural comparisons remain interactive.
