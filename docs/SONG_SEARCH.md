# Romaji and alternate-title search

Charts, Explore and both comparison pickers use the same local search helper.
For example, `Umiyuri`, `Umiyuri Kaiteitan`, `umi yuri` and full-width `Ｕｍｉｙｕｒｉ`
find ウミユリ海底譚 by n-buna. `Senbonzakura` also matches Tachi's spaced
`Senbon Zakura` alias for 千本桜. Displayed titles, chart IDs and catalog releases
remain unchanged. Search continues to combine with existing filters.

The packaged `song-aliases.json` contains 1,417 title/artist pairs derived from
Tachi's public maimai and maimai DX song metadata. At the current research
release, 1,069 distinct title/artist pairs gain additional aliases. These include
romaji, alternate titles and community shorthand. Coverage follows the source;
an unlisted reading, especially for a newer song, may still need an alias.
No automatic kanji pronunciation guessing or live translation service is used.

Aliases attach only when normalized **title and artist both match**. A different
artist sharing a title does not inherit them. The browser also respects aliases
already present in a prepared public catalog. These are search conveniences,
not reviewed provider-to-chart mappings or personal-recommendation qualifications.

Matching ignores case and full-width differences. A compact comparison tolerates
spaces and punctuation; multiword queries can combine title, artist and picker
difficulty/format. Punctuation-only searches still require literal matches.
Each chart's search text is cached in memory. Typing does not fetch data, write
storage, modify chart records, or send search terms to Analytics.

## Source and refresh

The public Tachi files are pinned to commit
`f08148f8644e40de9b178445df4bd59da712d3de`:

- [maimai DX songs](https://github.com/zkldi/Tachi/blob/f08148f8644e40de9b178445df4bd59da712d3de/db/seeds/songs-maimaidx.json)
- [maimai songs](https://github.com/zkldi/Tachi/blob/f08148f8644e40de9b178445df4bd59da712d3de/db/seeds/songs-maimai.json)

The asset records each raw file's SHA-256, row count and source URL. Tachi's
README identifies seed data as Unlicense. The shared footer and third-party
notices credit Tachi's community contributors. Only public title/artist/alias
strings enter the generated search script; provenance URLs stay in the source
asset. No chart corpus, account records or Tachi application code is included.

To refresh from explicitly downloaded, retained public seed files:

```sh
python scripts/prepare_song_aliases.py --dx PATH/songs-maimaidx.json --standard PATH/songs-maimai.json --revision FULL_TACHI_COMMIT --output src/maimai_intelligence/assets/song-aliases.json
```

The preparation command is offline. Rebuild using the existing site/demo/lab
commands. Aliases are display/search assets independent of immutable analysis
releases, so existing deep links continue working without reanalysis or backfill.
The research page fingerprints its loader and search/browser script URLs, so a
refresh picks up rebuilt code even when the catalog version has not changed.

Browser checks use authored profiles with public title labels, not actual song
analyses. They cover romaji in each search surface, Japanese titles, wrong-artist
isolation, catalog aliases, spacing/case/width variations, filter intersections,
keyboard selection, exact comparison IDs and the absence of search requests.
