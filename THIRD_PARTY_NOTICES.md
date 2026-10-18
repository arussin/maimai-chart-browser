# Attribution and data boundaries

## Import service marks

The import dialog bundles identifying marks for Maishift, Kamaitachi,
Diving-Fish, LXNS and DXRating, plus the existing Party ring. Sources and
retained permission notices are in
[Import service marks](docs/IMPORT_SERVICE_ICONS.md). Provider trademarks remain
their owners' and do not imply endorsement.
The Tomomai, mai-tools, JiETNG and AquaDX sections use original maimai.party
service pictograms under this project's MIT license, not provider logos.

## Personal result graphics

The optional personal layer uses SEGA combo/sync icons and rating frames from
the pinned public Tomomai asset collection. These graphics are excluded from
the MIT software license. [Provenance, hashes and ownership notes](docs/PLAYER_ARTWORK.md)
describe the source and exact lossless conversion. No score data or images are
sent to Tomomai or SEGA when displaying these locally packaged assets.

The downloadable score images also reuse the collection's decorative background,
character illustration, normal banner, result labels and achievement digit atlases.
[Export artwork provenance](docs/SCORE_EXPORT_ARTWORK.md) describes the original
hashes, lazy packaging, lossless conversions and quality-90 background conversion.
These game graphics retain the same ownership and software-license exclusions.

## Source and data boundaries

The analyzer, recommendation engine, catalog explorer, Challenge Lab, supporting
scripts and existing tests were extracted from arussin/maimai-report-starter at
commit `1503c87f6da7ba3fa564f0a5b112784119464e70`. Copyright (c) 2026 arussin;
MIT License. `docs/extraction.json` records source paths and SHA-256 hashes.
The dependency-free packaging backend derives from the same source.

This repository contains no personal captures, credentials, music,
or downloaded chart corpus. Authored synthetic fixtures are explicitly fictional.
The separately acquired Maichart-Converts research corpus retains its source
revision, attribution, qualification and review boundaries. Running its analysis
does not establish official identity, availability or permission to redistribute.

maimai is a SEGA game. This project is independent of SEGA and Kamaitachi.

The optional provider mapping includes a minimal chart/song identity registry
derived from public Kamaitachi seed data at Tachi revision
`f08148f8644e40de9b178445df4bd59da712d3de`. Its source URLs, input hashes and
derived registry hash are recorded in
`src/maimai_intelligence/assets/provider-registry-source.json`. It contains
chart metadata, current/legacy IDs and availability, with no player records,
chart notation, music or artwork. The exact mapping remains separate from
personalized report recommendations.

Optional, separately prepared public artwork uses SEGA's maimai song metadata
and static jackets. Historical version thumbnails are retained from
Matsuk1/JiETNG-maimai-dx-bot, revision
`f6eb5ebc6e1f3200b9769060a34325b2ea4e1eb7`. Jackets and logos belong to
SEGA and their respective rights holders; they are not covered by this code's
MIT license. The generated artwork manifest records every source URL and hash.
The retained version logos are bundled under `assets/version-artwork`, with
source URLs, original hashes and provenance in its manifest. No code from that
logo repository is included. Jackets remain separately prepared. Exact
title/artist matching follows arussin/maimai-session-report's
artwork helper, without taking a runtime dependency on the report library.

Export-sized song jackets use a separate reviewed index and explicitly supplied
image store. Sources include the [LXNS public jacket service](https://maimai.lxns.net/docs/api/maimai),
accepted SEGA mobile jackets, and the pinned public otoge-db artwork source.
[Export assembly and bounds](docs/EXPORT_ARTWORK.md) and the
[image provenance inventory](docs/export-jacket-provenance.json) describe identity
checks, dimensions, source hashes and fallbacks. Ordinary thumbnails and catalog
identities remain unchanged. These jackets retain their original ownership and
are excluded from this code's MIT license; public availability does not establish
new redistribution rights or endorsement.

The bundled PRiSM (748×350), PRiSM PLUS (800×315) and CiRCLE (799×357)
logos use the larger originals retained in
[Tomomai's pinned logo collection](https://github.com/shedaniel/tomomai/tree/7608b9c250f4a8778cdfd4768cdecb7628cd5889/apps/render/public/res/logo).
CiRCLE PLUS (801×375) uses the logo linked by
[SEGA's official international website](https://maimai.sega.com/assets/img/circle/top/kv_logo.png).
Their lossless WebP copies preserve original dimensions and identical RGBA pixels;
the bundled manifest records source URLs, original hashes and packaged hashes.
The previous thumbnails remain available for existing immutable references.
These third-party logos are not relicensed by Tomomai's software license.

The remaining release mappings also use larger genuine originals. PiNK,
MURASAKi, MiLK, DX, Splash and UNiVERSE use exact alpha-bound crops from
[SEGA's official tenth-anniversary logo sprite](https://maimai.sega.jp/10th/storage/site-titlelogos/splite-titlelogo.png?202206201502),
whose release cells are identified by the site's published stylesheet.
FiNALE and MiLK PLUS use standalone artwork from SEGA's archived FiNALE site.
Original maimai, GreeN PLUS and ORANGE PLUS use the native PNGs at the same
pinned Matsuk1 source revision, verified against the previously retained source
hashes. GreeN PLUS preserves its intentional opaque backing.
GreeN and ORANGE use original-size images linked by
[Logopedia](https://logos.fandom.com/wiki/Maimai_(video_game)); other PLUS and
early DX originals come from [Maimai Wiki](https://maimai.fandom.com/).
These community file pages do not provide independently verified upstream
publisher provenance or a separate artwork license. Every source URL, hash,
dimension and crop is recorded in the bundled manifest. Except for a documented
BUDDiES downsample from 1054×603 to 800×458, the lossless WebP images preserve
the original RGBA pixels of their complete logo or exact crop. No image is
redrawn or AI-upscaled. The preceding ownership and software-license exclusions
apply to the entire set.

## Website identity and visible credits

The browser is branded **maimai.party**. Its custom text wordmark uses the five
Deluxe-inspired colors for `.party`; version logos identify game releases.
The site is an independent fan project, not affiliated with or endorsed by SEGA
or the projects below. The code license grants no rights to third-party game
content. Game names, logos, charts, music and artwork belong to SEGA and their
respective creators, publishers and rights holders.

Both browser pages include a visible rights notice, a link to the public
[project repository](https://github.com/arussin/maimai-chart-browser), and an
expandable **Credits & thanks** reference. Attribution does not resolve reuse
or publication permissions. The research source's stated research-use and
noncommercial restrictions remain in effect.

| Contributor or source | Role in this project |
| --- | --- |
| [SEGA / maimai](https://maimai.sega.jp/) and the creators credited in the game | Original game and licensed content; [public song metadata](https://maimai.sega.jp/data/maimai_songs.json) and maimai DX NET jackets. |
| [Neskol / Maichart-Converts](https://github.com/Neskol/Maichart-Converts) | Retained research chart corpus at `e164add85213bab150e1487d5eb15ccb631aedb9`; upstream describes research use and prohibits commercial use. |
| [MaichartConverter](https://github.com/Neskol/MaichartConverter) and [MaiLib](https://github.com/Neskol/MaiLib) | Upstream conversion tools credited by the corpus; neither is bundled or executed by this package. |
| [Matsuk1 / JiETNG-maimai-dx-bot](https://github.com/Matsuk1/JiETNG-maimai-dx-bot) | Version-logo collection at the pinned revision above, with original game ownership retained. |
| [Simai community](https://w.atwiki.jp/simai/), [notation documentation](https://w.atwiki.jp/simai/pages/1002.html) and [chart collection](https://w.atwiki.jp/simai/pages/32.html) | Notation references for the independently written parser, and public transcriptions used in early studies and the automated analysis fallback. |
| [Surone](https://www.youtube.com/watch?v=DQgnFASwiOM) and [なめあ](https://note.com/namea_chunibyo/n/n8c7bc59683ff) | Tutorial transcript and illustrated explanation informing the scoped, authored Umiyuri lesson; no copied video or article illustrations are bundled. |
| [Kamaitachi](https://kamai.tachi.ac/) / [Tachi](https://docs.tachi.ac/) contributors | Optional read-only score acquisition. Personal data is never included in public catalog assets. |
| [arussin / maimai-session-report](https://github.com/arussin/maimai-session-report) | Original code and test foundations, with extraction history preserved above. |
| [PySimaiParser](https://github.com/Choimoe/PySimaiParser), [MajSimai](https://github.com/TeamMajdata/MajSimai), [MaiMuriDX](https://github.com/Minepig/MaiMuriDX), [MaiDiffPredictor](https://github.com/Choimoe/MaiDiffPredictor) | Research references reviewed in the [source audit](docs/source-notes/CHART_SOURCE_AUDIT.md); no code, model, weight or label from these projects was adopted. |
| [Python](https://www.python.org/), [Node.js](https://nodejs.org/), [Pillow](https://python-pillow.github.io/), [Ruff](https://github.com/astral-sh/ruff), [Playwright](https://playwright.dev/) and [axe-core](https://github.com/dequelabs/axe-core) | Runtime, optional local artwork preparation, development and accessibility checks. The Python package still has no third-party runtime dependency. |

The website credits distinguish original content ownership, retained data,
upstream tools, teaching references and tools reviewed without adoption.
Pinned artwork URLs and hashes remain in the separately prepared artwork
manifest. The GitHub link does not change repository visibility; hosting on
maimai.party and any public release are separate rollout steps.

## Song search aliases

Language buttons use the unmodified 16×11 pixel **Famfamfam Flags** by Mark James,
from [legacy-icons/famfamfam-flags](https://github.com/legacy-icons/famfamfam-flags),
revision `a79ec57f332a43717170cdcf159692bcf0012872`. The four original icons are
public domain; [upstream license](docs/FLAG_ICONS_LICENSE.md) and per-file hashes
in `assets/flag-icons-source.json` are retained. Icons are bundled locally and
do not call a flag CDN.

Multilingual search additionally uses offline [pypinyin](https://github.com/mozillazg/python-pinyin),
[OpenCC's Python reimplementation](https://github.com/yichen0831/opencc-python),
and BSD-licensed [CMUdict data](https://github.com/cmusphinx/cmudict), parsed directly
without the GPL Python wrapper.
Pinned versions, generation provenance and correction rules are in
[Localization](docs/LOCALIZATION.md); [license notices](docs/LOCALIZATION_LICENSES.md)
retain the pinyin, OpenCC and CMU dictionary notices. Generated aliases are
approximate search aids, not official translations or native-reviewed names.

Public title, artist, `altTitles` and `searchTerms` metadata is derived from
[Tachi's maimai DX seed data](https://github.com/zkldi/Tachi/blob/f08148f8644e40de9b178445df4bd59da712d3de/db/seeds/songs-maimaidx.json)
and its [maimai seed data](https://github.com/zkldi/Tachi/blob/f08148f8644e40de9b178445df4bd59da712d3de/db/seeds/songs-maimai.json),
pinned to commit `f08148f8644e40de9b178445df4bd59da712d3de`. Tachi's README identifies
seed data as Unlicense. Thank you to zkldi and Tachi's community contributors.
The derived search asset records source hashes; it includes no Tachi application
code, chart definitions, scores or player records. Search aliases do not qualify
personal chart mappings or establish game availability. See [song search](docs/SONG_SEARCH.md).

## Optional website analytics

[Google Analytics](https://analytics.google.com/) is an optional hosted service
for visits and broad page views on the published maimai.party domain. The Google
tag loads from Google's servers only after visitor opt-in. Google's script is
not bundled or licensed under this project's MIT license. The footer links to
Google's privacy policy, explains the data boundaries and provides withdrawal.
Personal results, searches and chart selections are excluded. See
[configuration and validation](docs/ANALYTICS.md).

## Supplemental catalog sources

[mai-notes (maiノーツ)](https://mai-notes.com/) and its creator provide the chart
simulator, public metadata and note counts. The updater uses these to fill
missing fields and link exact difficulties, and checks its public chart-text
endpoint for additional experimental analysis. It tries the [Simai community chart collection](https://w.atwiki.jp/simai/pages/32.html)
when a mai-notes transcription is unavailable or unsupported. Analysis requires
resolved identity, supported notation and matching counts for all five note
categories. These checks do not establish exact game fidelity.

[Arcade Songs / zetaraku](https://arcade-songs.zetaraku.dev/maimai/),
[OTOGE DB / zvuc](https://github.com/zvuc/otoge-db), and the
[maimai Wiki on Gamerch](https://gamerch.com/maimai/) and their contributors
supply supplemental BPM, constants and chart reference data. SEGA's
[Japan](https://maimai.sega.jp/data/maimai_songs.json) and
[International](https://maimai.sega.com/assets/data/maimai_songs.json) listings
supply accepted regional inventory observations. Numeric metadata and
transcriptions have separate provenance; metadata does not create analysis.

The update store retains source URLs, captured bytes, timestamps and checksums.
Raw chart text, simulator code, music, account records and scores are excluded
from public assets. Public metadata and derived measurements retain their source
attribution and experimental qualifications. This project's MIT license does not
license third-party datasets or original game content. About thanks these sources
and distinguishes their actual roles.

## Party ring favicon

The embedded five-color ring favicon was created for maimai.party with OpenAI's
image-generation tool and is shared with the Session Report. It uses the site's
party palette and contains no character artwork. It is not an official SEGA logo
or endorsement.

## Sharing service icons

The locally bundled sharing glyphs are from [Simple Icons](https://github.com/simple-icons/simple-icons),
version 16.32.0, commit `b86d5c9a0bdd4f3f5c30898a63654dd32f39fd76`, under CC0-1.0.
The unmodified path geometry is embedded in `settings-menu.js`; source URLs and
hashes are retained in `assets/share-icons-source.json`. The [license text](docs/SHARE_ICONS_LICENSE.md)
is retained locally. Brand names and marks belong to their respective owners;
their use identifies sharing destinations and does not imply endorsement.
No Simple Icons, AddToAny, or social-provider request is made to render these icons.

### MAGiCAL version logo

The selected MAGiCAL logo is the native 558×341 PC logo from
[SEGA's official maimai site](https://maimai.sega.jp/storage/root/logo_pc.png),
retrieved October 11, 2026. Its PNG SHA-256 is
`e337075d15247d41c9d74a3f3b1e2a053787234bff974efeaf5294ff4f972c5e`.
The lossless WebP preserves identical RGBA pixels; the manifest records both
hashes and the source page. The earlier smaller logo retrieved September 21,
2026 (source PNG SHA-256
`9f659f914d7d8c7fea2a49331166748ade47dfc0f194e9d8c54e9878878966d7`)
remains retained for immutable references. Ownership remains with SEGA and the
respective rights holders; this artwork does not establish chart identity.


### Achievement result artwork

The optional MAGiCAL でらっくま and カナデラ illustrations are unchanged public
promotional WebPs from [SEGA's official maimai site](https://maimai.sega.jp/).
Official result badge components and difficulty ribbons are retained from the
same pinned Tomomai asset source described in [score export artwork](docs/SCORE_EXPORT_ARTWORK.md).
The rainbow Japanese 「でらっくす」 chart badge is the unchanged PNG embedded in
[SEGA's official song stylesheet](https://maimai.sega.jp/song/song.css?20260916).
The [result asset inventory](docs/score-export-result-artwork-provenance.json)
records all source URLs, hashes and dimensions. These game assets remain owned by
SEGA and the respective rights holders and are excluded from the project's MIT
license; no separate redistribution grant or endorsement is claimed. The canvas
composition and vector rank lettering are original project code, without upstream
renderer code.


The expanded partner roster also includes illustrations from SEGA's official
[popularity poll](https://maimai.sega.jp/popularity-poll/) and seasonal illustrations
preserved by [maimai Wiki](https://maimai.fandom.com/), whose individual file pages
cite official sources. The result inventory records those file-page citations
without implying that archived original bytes or separate image licensing were
independently verified. Wiki prose and renderer code are not bundled. Artwork
ownership and the MIT exclusion above continue to apply.
