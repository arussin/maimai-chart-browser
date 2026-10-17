# Export-sized song artwork

PNG generation uses a separate reviewed export index. Canonical chart/song IDs,
accepted catalogs, regional projections and the ordinary 128px jacket assets remain
unchanged. The browser loads the export resolver only while generating an image;
image requests remain same-origin, content-addressed WebP with omitted credentials.
There are no runtime calls to external artwork providers.

`assets/export-artwork/manifest.json` binds each override to a canonical song UUID,
JP or INTL region, exact selected title/artist, and the accepted thumbnail hash.
A changed identity or thumbnail invalidates the override. CN, PRIVATE and unknown
regions keep their accepted existing image; this index does not claim a reviewed
China catalog projection. A jacketless song requires its own explicit binding.
Missing overrides keep the thumbnail, and failed larger-image requests may use the
accepted thumbnail within the same bounded export job.

Image bytes are intentionally absent from the source package. The reviewed input
store for this release is `C:\Dev\maimai\artwork-inputs\export-jackets-20261017`.
It retains source URLs, original hashes and dimensions, comparison evidence,
converted file hashes and per-song missing/fallback outcomes. The approved
50-song handoff remains recoverable in its `seed/` records; it is a reference set,
not the production coverage definition. The current coverage receipt is in
`coverage.json`; full acquisition evidence is in `provenance.json`.

## Release and preview assembly

Supply the reviewed source explicitly when preparing a release:

```python
plan = plan_public_release(
    accepted_browser,
    previous_public=retained_production,
    export_artwork_source=reviewed_export_input,
)
```

The planner reads the packaged index, verifies every referenced file in that
store, and merges only verified immutable media paths. Its ordinary 20,000-file
capacity guard remains mandatory. An over-capacity review artifact is not a
deployable release; paid-capacity review and deployment authorization remain
separate gates. No catalog payload or reference is rewritten for artwork.

Ordinary lab/test preparation does not copy this image corpus. A local demo may
explicitly copy only the reviewed paths it exercises:

```python
copy_export_artwork(reviewed_export_input, demo_output, paths=selected_media_paths)
```

Without an explicit source store, the release planner includes no larger image
bytes. The export loader's accepted-thumbnail fallback preserves local operation.
A production release claiming larger-art coverage must supply and validate the
complete store. Do not copy the full image store into source or every DevCache
snapshot, and do not infer coverage from a demo screenshot.

## Review bounds

The separate export inventory permits at most 2,048 assets, 4,096 regional
bindings, a 4 MiB index, 512 KiB per lossless WebP and 512 MiB total image bytes.
Dimensions must be greater than 128 and no more than 512 in either direction.
Ordinary thumbnail validation retains its existing 256 KiB bound. The acquisition
store has a separate 512 MiB total bound including metadata and evidence.

Acquisition uses public metadata and bounded image reads, records failures, never
upscales images, and does not infer identity from filenames or numerical IDs alone.
Current primary endpoints and the exact acquisition policy are retained with the
input receipts. Source image dimensions establish the available resolution; they
do not establish that every upstream file is an original unscaled master.

Song jackets belong to SEGA and their respective rights holders. Public access to
source images is provenance, not a grant of new ownership or a claim of licensing.
