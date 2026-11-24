# DXRating public sheet IDs

The DXRating file importer accepts bare arrays from "All records" and "Best 50",
as well as legacy `__dxrt__` sheet IDs. Scores in test fixtures are synthetic;
public song/sheet IDs and catalog labels are metadata, not player records.

`web/src/domain/import-dxrating-metadata.json` projects the public v1 catalog into
song tuples `[public song ID, title, artist]` and sheet tuples
`[song index, type, difficulty]`. Song indexes are internal storage offsets only.
The importer retains public IDs as source identities and uses the existing exact
title/artist/type/difficulty matching rules. Catalog identity is never inferred
from a display route, numeric suffix, or public ID spelling.

Only `normalizeFileImportDocument` for DXRating dynamically loads the table.
Hosted startup and other providers do not load it; the self-contained offline
distribution necessarily embeds its bytes. The browser makes no DXRating request.
Legacy metadata and legacy parsing remain unchanged. Optional source/provider
configuration and unknown export fields do not become application or collector data.

## Data source and permission

Data from [DXRating](https://dxrating.net).

- Source: <https://miruku.dxrating.net/api/v1/dxdata> (no key or sign-in).
- [Developer terms](https://dxrating.net/developers): free use including commercial
  use; cache responses and revalidate with `If-None-Match`.
- [Pinned data notice](https://github.com/gekichumai/dxrating/blob/1599d1dced3e7ff151ba81dc861cb231f0e63d4e/packages/dxdata/LICENSE):
  permits use of the data in projects; credit is appreciated, not required. This
  is the data-specific permission, distinct from the repository's MIT code licence.
  SEGA/rightsholder game content rights are reserved. No artwork or chart bodies
  are redistributed by this projection.
- The repository's `packages/dxdata/dxdata.json` at that commit is still a legacy
  catalog without public sheet IDs. Use the v1 API document, not that file.

The generated file records capture date, producer update time, source URL,
SHA-256 of the exact captured bytes, pinned notice URL and attribution, following
the existing `build_import_metadata.py` provenance pattern.

## Refresh

1. Review the current developer terms and data notice. Capture the public v1 API
   response once into the task's DevCache evidence directory; retain response
   headers/ETag and raw bytes. Revalidate an existing capture with its ETag.
2. From canonical source with the development Python environment, run:

   ```powershell
   & $RegistryPython scripts/build_dxrating_metadata.py CAPTURE.json web/src/domain/import-dxrating-metadata.json --captured-on YYYY-MM-DD
   ```

3. Format the generated JSON with the pinned web Prettier, run the generator tests
   and web/browser checks, then build in the approved DevCache workspace. Explicitly
   promote only generated assets and manifests, checking hashes before removing
   superseded build-owned chunks. No refresh is automatic or scheduled.

The generator performs no network requests and rejects invalid/duplicate public
IDs and the legacy schema. Removed charts and Utage entries remain in the table,
so the parser, rather than the generator, applies existing chart handling rules.

## Validation behavior

Well-formed optional public identities must agree on song ID, type and difficulty.
Malformed optional identity objects are ignored, as in current DXRating file
parsing; they cannot override pinned metadata. The legacy identity check is unchanged.
Known `utage` types are excluded/count toward the existing Utage notice; all-Utage
files fail. Other unsupported types (including legacy `utage2p`) still fail.

Unknown chart metadata is normally retained unmatched by our importers, not
silently skipped. An unknown public sheet with a complete structured identity can
likewise retain its score with empty title/artist, preventing a guessed join. A
bare unknown ID has no type/difficulty and cannot satisfy the portable contract;
it fails with the existing `record_identity` category and a lookup-refresh message.
No placeholder chart type is invented. Known public metadata that is absent from
our catalog remains retained unmatched.

Null/non-numeric/out-of-range achievements, precision beyond four decimal places,
and other invalid ordinary scores reject the whole file, as existing importers do.
The accepted achievement range remains 0–101 inclusive. No new collector fields,
events or diagnostic reason categories are introduced.
