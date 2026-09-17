# Catalog updates

For the current persistent inventory workflow, begin with
[Persistent official inventory](REGISTRY_IMPLEMENTATION.md#owner-preparation).
Pass `--registry registry` to prepare from accepted regional observations and
reviewed mappings. That path retains accepted mai-notes links without fetching
the index and permits an inventory-only build without a chart package. The
acquisition and source-hash link rules below describe the legacy package path.

`python -m scripts.update_catalog` is the owner-run preparation and publication
workflow. It has no schedule, public endpoint, GitHub deployment workflow or
automatic trigger. Contributions continue through ordinary pull requests; only
arussin's authenticated owner environment can publish the official site.

Run from the repository with the package installed (or `PYTHONPATH=src;.` on
Windows). Source preparation also needs Pillow for existing artwork conversion.
The tools preserve research qualifications and do not access personal scores,
report archives or the private report service.

## Prepare an update

For a full source update, first review the upstream commit and set its exact SHA
in `maimai_analyzer.dataset.SOURCE_LOCK` through the normal code review/checks.
The workflow deliberately refuses a different revision; it never follows an
unreviewed upstream branch automatically.

```text
python -m scripts.update_catalog prepare --store output/catalog-updates --previous-browser output/site/lab --revision e164add85213bab150e1487d5eb15ccb631aedb9 --artwork-cache output/artwork-cache/downloads --overrides config/mai-notes-overrides.json
```

This captures the pinned public chart text, verifies its Git blob hashes,
extracts exact difficulties, builds profiles and pattern/Flow data, restores
decimal constants, refreshes SEGA jacket metadata (reusing cached artwork), and
fetches the mai-notes metadata index once. Profile and overview caches under the
update store are bound to source bytes and implementation hashes; unchanged
analysis can be reused across candidate runs. Existing curated version logos and
search aliases retain their reviewed source pins. Updating the search-alias pin
uses the existing [song search preparation](SONG_SEARCH.md) before this workflow.

To refresh mai-notes and prepare a release from an already accepted chart package:

```text
python -m scripts.update_catalog prepare --store output/catalog-updates --previous-browser output/site/lab --package output/challenge-constants-v1 --overrides config/mai-notes-overrides.json
```

This mode preserves chart analysis. It is also the first-run path for adding
mai-notes to the currently accepted catalog. Use `--mai-notes-snapshot PATH` to
replay an explicitly retained metadata file. With `--offline`, that snapshot is
required and source/artwork acquisition uses only available caches. Reports
distinguish a retained snapshot from a fresh download.

Each invocation creates a fresh `STORE/runs/RUN_ID/` containing:

- `report.md`: counts and review instructions.
- `changes.json`: chart additions/removals/changes and player-link changes.
- `mai-notes-audit.json`: matched, unavailable, ambiguous and unmatched charts.
- `package/`: the complete versioned research package with its link index.
- `browser/`: a preview retaining earlier catalog versions and deep links.
- `public/`: only allowlisted public assets, ready for static hosting.
- `ready.json`: source/implementation identity and every public file's checksum.

The readiness receipt is written last. Downloads, validation or partial writes
that fail cannot produce a publishable candidate or advance `latest.json`.
Inputs are never overwritten. A writer lock prevents overlapping updates. After
a process crash, inspect its PID and run state before removing a stale lock;
there is no automatic lock expiry or forced takeover.

For subsequent updates, use the previously published run's `browser/` as
`--previous-browser`, and its `package/` for a metadata-only refresh. This retains
all accepted releases. `STORE/latest.json` identifies the most recently verified
publication from this workflow; preparing a candidate does not change it.

## Review and publish

Serve the candidate's `browser/` or `public/` using a local static server. Check
the change report, affected rows and comparisons, mobile wrapping, old links and
the new source's metadata coverage. Source code must pass the repository's
required checks and be merged to `main` before publication.

```text
python -m scripts.update_catalog publish output/catalog-updates/runs/RUN_ID --gh PATH/gh.exe --git PATH/git.exe --node PATH/node.exe --wrangler PATH/wrangler/bin/wrangler.js
```

Tool flags may be omitted when those tools are installed at their defaults.
Use the existing trusted Wrangler installation and owner authentication described
in [Owner publication](OWNER_PUBLICATION.md). Credentials stay outside source and
site assets. Publication verifies the owner, clean checked main commit, unchanged
implementation, candidate checksums, existing Direct Upload project and expected
live base catalog. It uploads only `public/` from an isolated working directory.

After upload it verifies the manifest at the immutable deployment URL and
maimai.party, records `publication.json`, then atomically advances `latest.json`.
A changed live base requires preparing against the newer accepted browser.
An uncertain upload leaves `publish-attempt.json` and blocks automatic retries:
inspect hosting history and the live manifest before resolving that attempt.
Reinvoking a successfully recorded publication returns its existing receipt.
Rollback remains the existing Cloudflare Pages operation; no historical backfill
is needed. After a rollback, use the restored catalog's browser as the next base.

## mai-notes link rules

The only acquisition is one bounded request to
<https://mai-notes.com/data/manifest.json> per online preparation, with no retries,
redirect following, account access or chart/audio downloads. HTTP errors and
invalid index schemas stop preparation. This is a public site asset, not a
documented stable integration API; recheck the source contract if it changes.

Link discovery requires a unique normalized title **and artist**, STD/DX format,
and exact difficulty, plus `has_chart_data: true`. Normalization permits Unicode
width, case and spacing differences, not fuzzy title guesses. Duplicate local or
provider identities remain unresolved. Levels/constants are not identity keys.
Each published link is bound to our chart ID and source hash. A missing or
uncertain mapping produces no link or placeholder. The row's difficulty selector
updates the plain `mai-notes simai player` link beside YouTube; comparison
selections and similar-chart cards use the same helper.

`config/mai-notes-overrides.json` holds explicit reviewed naming exceptions:

```json
[
  {
    "chart_id": "exact local chart ID",
    "source_hash": "exact current chart source SHA-256",
    "mai_notes_id": "exact provider chart UUID",
    "evidence": "What was checked to establish this specific chart match"
  }
]
```

Overrides cannot change format/difficulty or map multiple charts to one player.
Stale exceptions stop preparation for review. The public index contains only
link identities and provenance timestamps/hashes. Provider score fields, raw
responses and matching audits never enter public assets. Browsing, searching and
changing difficulty make no requests to mai-notes; following a link opens their
player without a referrer. These links are display conveniences and do not
qualify research charts for personal recommendations. Earlier catalog versions
without a player index remain usable and show only their existing links.
