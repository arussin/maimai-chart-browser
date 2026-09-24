# Browser application boundaries

The hosted, version-page and offline entries build the maintained TypeScript graph
in `web/src`. Python packages include those generated assets; Python installation
and report generation do not need Node. Build output is enumerated in
`src/maimai_intelligence/assets/browser-assets.json`, not an independent script list.

## Ownership and loading

| Owner | Responsibility |
| --- | --- |
| `runtime/navigation.ts` | Navigation intent, cancellation, route activation, language and page metadata |
| `runtime/history.ts` | Browser history writes and traversal |
| `runtime/browser-state.ts` | Browser filters, sorting, comparison and restoration |
| `runtime/catalog.ts` / `runtime/song-catalog.ts` | Bounded verified public data and historical format adaptation |
| `views/player-data.ts` | One player session, import transactions, readiness, refresh and Forget |
| `components/chart-card.ts` | Chart presentation shared by browser and song views |
| `components/song-view.ts` | Song component composition, independent of browser filters |
| `usage.ts` | Finite events from committed actions; no player data or operational error payloads |

`application.ts` constructs shell controls and the player session once. A direct
song arrival loads its small song projection before constructing a full browser.
Comparison, browser tabs, dictionary use or returning to results requests the full
catalog on demand. The full browser controller is initialized once. Existing
browser-to-song navigation reuses the already loaded catalog.

The navigation coordinator owns the permission to commit after either request.
A superseded request may finish, but cannot mount a song, change the selected tab,
or activate an obsolete page. Song chart choices do not overwrite browser state.
Personal readiness uses the existing session and preserves focused song controls.

A direct song's full-catalog request is pinned to the source hash embedded in its
HTML. A later manifest default cannot silently move that session onto a different
corpus. Explicit historical `version` requests retain their existing precedence.
Historical song documents without a scoped reference use the full-catalog reader.

## Song data contract

The static generator prepares `maimai-song-catalog-2` from the accepted canonical
catalog. All languages reference one content-addressed `song-catalog/<sha256>.json`
per song. No player data enters this projection. It contains:

- The canonical song and chart identities, regional metadata and display inputs.
- Only relevant provider joins, chart links, artwork, snippets and analysis records.
- A locally remapped analysis evidence pool with the original observations intact.
- Only genre/release labels and version artwork referenced by those charts.
- Shared analysis vocabulary/definitions, whose changes legitimately affect interpretation.

The reusable content does not contain a parent catalog hash. A
`maimai-song-binding-1` record in the HTML binds the expected catalog hash, page
song, original source-song scope, content hash/path and byte length. `prepare_seo`
returns the generated assets and those same structured bindings; release planning
does not parse generated JSON to reconstruct them. `build_seo` remains a thin
tuple-returning public compatibility wrapper.

The HTTPS page is the existing trusted root for references; the binding does not
authenticate a malicious replacement of that root. The reader requires this
binding for v2 content, validates its page/catalog scope and asset integrity, and
only then adds the catalog hash to the runtime context. There is no new request
or additional asset family. Historical v1 page attributes and content still use
the original embedded-parent check. New content cannot use that legacy fallback.

Official inventory identity does not require a transcription hash. When an actual
transcription exists, the existing identity checks continue to govern its analysis
and personal-score joins. A missing transcription never creates analysis or a map.

The browser reader verifies the 8 MiB asset bound, hash, byte count, schema, song
scope and referenced chart membership before handing data to components. Invalid
or unavailable data preserves the crawlable public table and provides localized
failure feedback. Failed full-catalog loading leaves the current song usable;
retry reloads the page. Operational codes stay local and bounded.

A release lists content-addressed song inventories in each catalog's
`song_catalog_indexes`. Each inventory binds its canonical catalog and enumerates
its song assets. The v2 inventory contains the prepared binding records; retention
checks their chart content against the verified canonical catalog as well as their
hashes, byte counts and scope. The v1 inventory reader stays available. Publication
verifies and retains previous inventories and assets,
including when a later projection policy changes their bytes. Repeated identical
preparation adds no duplicate inventory. Missing, tampered or incorrectly bound
retained data stops publication preparation.

These additional assets count toward the existing 20,000-file guard and 25 MiB
per-file limit. Song loading does not authorize a larger hosting profile or a
production release.

## Verification

- `web/tests/song-catalog.test.mjs`: scope, format, bounds, tampering and official identity.
- `web/tests/runtime.test.mjs`: immutable catalog pins, cancellation and shared state.
- `tests/test_song_catalog.py`: lossless evidence, detached projections and language sharing.
- `tests/test_song_content.py`: unrelated title, genre, release and artwork edits leave other song bytes unchanged.
- `tests/test_song_bindings.py`: canonical membership, redirects, stale/forged bindings and historical retention.
- `tests/test_public_release.py`: retained song URLs across projection changes and corruption.
- `tests/browser/song-workspace.spec.js`: four languages, three widths, delayed storage,
  lazy/failed catalog loading, superseding navigation, shared imports and Forget.
- `scripts/check_corpus_boundaries.py`: strict Python boundaries and at least 95%
  branch coverage per extracted pure module, including song projection.

Use the existing isolated fixture harness. Performance measurements require its
separate non-intercepting local-server harness; functional test timings are not
page-performance claims.
