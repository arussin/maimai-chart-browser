# Song discovery SEO research

16 October 2026. Baseline: production source `30de8cdf7ec79fea47ee9f78d9a02e1efe7cb362`,
accepted catalog `research-89929673b56e`. This extends the existing static route
generator. It does not reopen issue #38 or establish a separate song database.

## Findings and confidence

**Observed, high confidence:** international players use full romanizations,
shortened names, spelling variants, abbreviations, difficulty and artwork to
identify songs. These are evidence of behavior, not relative search volume.

| Query family | Direct evidence | Consequence |
| --- | --- | --- |
| Full romaji and abbreviations | Players write both “Umiyuri Kaiteitan” and “Umiyuri” in a [Master-chart discussion](https://www.reddit.com/r/maimai/comments/1iwyxqf/); another thread uses [Umiyuuri](https://www.reddit.com/r/maimai/comments/1v3auaf/). | Put the accepted full reading in visible text and metadata; preserve spelling tolerance in internal search. |
| Community abbreviation | A player explicitly expands [boge to Beat of getting entangled](https://www.reddit.com/r/maimai/comments/1k78imt/). The pinned [Tachi seed](https://github.com/zkldi/Tachi/blob/f08148f8644e40de9b178445df4bd59da712d3de/db/seeds/songs-maimaidx.json) agrees on title and artist. | Publish one evidence-reviewed abbreviation, BOGE, in a short English alternate-name line. Do not call it romaji. |
| Jacket, chart and difficulty | A [song-identification request](https://www.reddit.com/r/maimai/comments/1jwuvyw/) describes a blue/starry jacket, slide behavior and roughly EXPERT 10+. Replies ask about genre, BPM and version; the player later identifies enchanted wanderer. | Keep the jacket and accurate chart facts. Do not invent color tags from uncertain recollections. |
| Difficulty/format | The [Master-chart discussion](https://www.reddit.com/r/maimai/comments/1iwyxqf/) uses MAS 10+/11 and named pattern practice. | Describe real MASTER/Re:MASTER formats, levels and known constants. No claims about difficulty-query volume. |
| Version/availability | Maishift's [song-navigation guide](https://maimai.shiftpsh.com/en/guide/song-navigation) uses version folders and warns that unlock progress changes the two newest folders. | Preserve version links and regional facts; do not equate a version label with universal availability. |
| Artist plus song | [RemyWiki](https://silentblue.remywiki.com/Umiyuri_kaiteitan) associates Umiyuri with n-buna and the original title. This sample did not establish a player-query frequency for the combined spelling. | Artist context is a supported disambiguation aid; gains for `maimai n-buna umiyuri` remain an untested hypothesis. Use the accepted artist in descriptions. |
| Chinese regional aliases | [LXNS song search](https://maimai.lxns.net/songs?game=maimai) accepts IDs, titles, artists and aliases; its [homepage](https://maimai.lxns.net/) describes voting/submission of aliases. [Diving-Fish](https://github.com/Diving-Fish/maimaidx-prober) uses 曲目/歌曲, 定数, DX Rating and difficulty filters, and qualifies metadata accuracy. | A search alias system is useful evidence of naming practice, not permission to republish every alias as a verified regional title. No external dataset was imported. |
| Korean naming | The [Korean community wiki](https://namu.moe/w/maimai%20%EC%8B%9C%EB%A6%AC%EC%A6%88/%EA%B8%B0%EB%84%A4%EC%8A%A4) uses 해저담/우미유리 for the pattern. Maishift keeps original song titles inside localized navigation and chart information. | Hangul helps search, but this bounded evidence does not certify the existing generated Korean alias collection for SEO display. |
| Indonesian context | A public [Indonesian arcade discussion](https://www.reddit.com/r/indonesia/comments/1nqs3b6/) discusses maimai and song availability. The bounded search did not establish a song-specific Indonesian nickname convention. | Preserve Indonesian page language and original titles; no invented local names. Further community evidence is an open research gap. |

**Observed competitor treatment:** [RemyWiki's Umiyuri page](https://silentblue.remywiki.com/Umiyuri_kaiteitan)
joins Japanese identity with romaji in its route/prose; the
[Maimai International Wiki](https://maimaieng.fandom.com/wiki/Umiyuri_Kaiteitan)
uses the romanized title as its heading and lists artist/chart facts.
[Gamerch](https://gamerch.com/maimai/533675) uses the Japanese title. These sites'
naming is evidence of discoverable wording, not a source for our current constants.
The existing Tachi seed is a broad search-alias source with provenance, not a
blanket full-title-reading approval.

## Bounded Google observation

Five manually inspected Google result pages in one signed-in browser session,
16 October 2026; no pagination, scraping, autocomplete counts or volume estimates.
Results are a dated, personalized observation, not a ranking benchmark.

| Query | Observable results | maimai.party observation |
| --- | --- | --- |
| `maimai umiyuri kaiteitan` | RemyWiki, Reddit pattern guide, International Wiki, videos and Vocaloid Wiki | Not present among the inspected first-page results |
| `maimai ウミユリ海底譚` | RemyWiki, videos, SEGA's UTAGE page, Gamerch and community discussions | Not present among the inspected first-page results |
| `maimai uma to shika` | Music videos, RemyWiki category and general music pages; several results omit maimai | Not present among the inspected first-page results |
| `maimai 馬と鹿` | maimai chart videos, Gamerch and RemyWiki's DX PLUS page | Not present among the inspected first-page results |
| `site:maimai.party/en/songs/ umiyuri` | A different song, Leave All Behind, with a shared Umiyuri tutorial-credit snippet | The intended Umiyuri page was not returned; `site:` is not a complete indexing census |

**Supported inference, high confidence:** indexing coverage is a major current
constraint and cannot be explained solely by missing romaji. Authorized read-only
Search Console inspection checked song-filtered queries/pages/countries, exclusion
reasons and two cached URL inspections. Detailed account observations are retained
privately, outside this public repository. They are not search-volume estimates.
The public Google comparison also fails to find the intended page for its original
Japanese title. Absence from one results page alone would not prove non-indexing.

**Supported inference, moderate confidence:** shared application/credit text may
make snippets less specific. The unrelated-song result above supports investigating
rendered content after publication; it does not prove a canonical or rendering bug.
This patch preserves the application shell and navigation contract.

**Untested hypotheses:** exposing approved readings will improve romanized-query
impressions/CTR after recrawling; the single abbreviation will help BOGE searches;
better chart facts will help chart-intent queries. No ranking, traffic or indexing
improvement has been demonstrated by local HTML validation.

Google [chooses title links using multiple page signals](https://developers.google.com/search/docs/appearance/title-link)
and advises concise, descriptive titles without keyword lists. Its
[recrawling guidance](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl)
explicitly does not guarantee indexing. The visible secondary title is therefore
part of this change, not just an HTML-title edit.

## Publication quality rules

1. **Full-title pronunciations:** reuse `display_readings` and its pinned source
   revision, approved-entry and title/artist validation. A publication lookup also
   requires the stable song ID and exact current title/artist. English only; the
   original heading remains dominant. No Japanese sorting-key guessing.
2. **Evidence-backed alternate names:** explicit kind (`abbreviation`, `nickname`
   or `alternate-spelling`), locale, evidence review and source links in the
   existing display-review manifest, plus agreement with the pinned alias source.
   Currently only BOGE qualifies, as an abbreviation. Verified nickname count is
   zero; no translations are promoted. These records do not alter browser search.
3. **Search-only approximations:** generated phonetics/pinyin/script conversions,
   partial readings, translations and unreviewed aliases stay in internal search.
   `ai-reviewed` on a search gloss does not make it an established regional name.

Do not replace titles, artists, IDs, saved slugs, redirects or catalog facts with
these labels. Regional title/artist drift suppresses the secondary name. Missing
and intentional-blank titles retain their maintained localized labels. All five
locales retain reciprocal alternatives, language declarations and self canonicals.

## Coverage and representative sample

The current accepted catalog still has **1,694 song IDs, 7,251 chart variants and
28 versions**: **8,610** song/version documents across five languages, plus the
homepage in the sitemap. The reviewed compiler has **806 song rows / 802 distinct
title-artist pairs**, including **321** specifically reviewed Tachi readings.
Exact matching to current public metadata permits **799 song IDs / 795 pairs**.
Seven older artist strings no longer exactly match the accepted catalog; they are
withheld pending reconciliation, rather than silently reassigned. Among 959
Japanese-script song IDs, 160 therefore have no published reading.

The packaged search collection remains **1,417 Tachi title/artist pairs** and
**8,716 multilingual alias records**. The latter includes 1,559 generated phonetics,
1,802 generated pinyin records and 108 generated script conversions. Counts overlap
with displayable readings; they are not disjoint song totals or quality scores.
The change adds no search aliases. Static English reading coverage goes from 0 to
799; evidence-reviewed abbreviations from 0 to 1; verified nicknames remain 0.

The 36-song sample below spans kanji, kana, Latin, mixed scripts, punctuation,
duplicate names and regional search aids. A dash is an intentional absence of
publication approval. Current Chinese/Korean search aliases for songs such as
Umiyuri remain search-only. Duplicate song IDs keep independent established routes.

| Original title / existing route | Format | Artist | Approved English secondary reading |
| --- | --- | --- | --- |
| [ウミユリ海底譚](https://maimai.party/en/songs/%E3%82%A6%E3%83%9F%E3%83%A6%E3%83%AA%E6%B5%B7%E5%BA%95%E8%AD%9A-ae37343c6020/) | STD | n-buna | Umiyuri Kaiteitan |
| [馬と鹿](https://maimai.party/en/songs/%E9%A6%AC%E3%81%A8%E9%B9%BF-55af6db7aad2/) | DX | 米津玄師 | Uma to Shika |
| [千本桜](https://maimai.party/en/songs/%E5%8D%83%E6%9C%AC%E6%A1%9C-a3db6c2bb91b/) | DX / STD | 黒うさP | Senbon Zakura |
| [深海少女](https://maimai.party/en/songs/%E6%B7%B1%E6%B5%B7%E5%B0%91%E5%A5%B3-a8235d5a0207/) | DX / STD | ゆうゆ | Shinkai Shoujo |
| [白い雪のプリンセスは](https://maimai.party/en/songs/%E7%99%BD%E3%81%84%E9%9B%AA%E3%81%AE%E3%83%97%E3%83%AA%E3%83%B3%E3%82%BB%E3%82%B9%E3%81%AF-338ad3de5a33/) | STD | のぼる↑ | — |
| [ソテリア](https://maimai.party/en/songs/%E3%82%BD%E3%83%86%E3%83%AA%E3%82%A2-10a7e3744d81/) | DX | Rafutsuri feat.桜あおい | soteria |
| [テオ](https://maimai.party/en/songs/%E3%83%86%E3%82%AA-e5b445781618/) | DX | Omoi | teo |
| [ラグトレイン](https://maimai.party/en/songs/%E3%83%A9%E3%82%B0%E3%83%88%E3%83%AC%E3%82%A4%E3%83%B3-09b3d576b30b/) | DX | 稲葉曇 | ragutorein |
| [夜に駆ける](https://maimai.party/en/songs/%E5%A4%9C%E3%81%AB%E9%A7%86%E3%81%91%E3%82%8B-b5dd9261adeb/) | DX | YOASOBI | Yoru ni Kakeru |
| [踊](https://maimai.party/en/songs/%E8%B8%8A-de5e4a259da0/) | DX | Ado | Odo |
| [脳漿炸裂ガール](https://maimai.party/en/songs/%E8%84%B3%E6%BC%BF%E7%82%B8%E8%A3%82%E3%82%AC%E3%83%BC%E3%83%AB-6ae60326aeb8/) | DX / STD | れるりり | Nou shou sakuretsu girl |
| [ロストワンの号哭](https://maimai.party/en/songs/%E3%83%AD%E3%82%B9%E3%83%88%E3%83%AF%E3%83%B3%E3%81%AE%E5%8F%B7%E5%93%AD-d7128033fb64/) | STD | Neru | — |
| [チルノのパーフェクトさんすう教室](https://maimai.party/en/songs/%E3%83%81%E3%83%AB%E3%83%8E%E3%81%AE%E3%83%91%E3%83%BC%E3%83%95%E3%82%A7%E3%82%AF%E3%83%88%E3%81%95%E3%82%93%E3%81%99%E3%81%86%E6%95%99%E5%AE%A4-325f192bae91/) | DX / STD | ARM＋夕野ヨシミ(IOSYS)feat. miko | — |
| [Beat of getting entangled](https://maimai.party/en/songs/beat-of-getting-entangled-7768659df9db/) | STD | Shoichiro Hirata | — |
| [enchanted wanderer](https://maimai.party/en/songs/enchanted-wanderer-8d7ad00a36c7/) | DX | linear ring | — |
| [Oshama Scramble!](https://maimai.party/en/songs/oshama-scramble-f876b9adccce/) | DX / STD | t+pazolite | — |
| [Garakuta Doll Play](https://maimai.party/en/songs/garakuta-doll-play-ad280072506b/) | STD | t+pazolite | — |
| [PANDORA PARADOXXX](https://maimai.party/en/songs/pandora-paradoxxx-93e12515e191/) | STD | 削除 | — |
| [Glorious Crown](https://maimai.party/en/songs/glorious-crown-71d2e91e360a/) | STD | xi | — |
| [QZKago Requiem](https://maimai.party/en/songs/qzkago-requiem-f9f4590de1fc/) | STD | t+pazolite | — |
| [シュガーソングとビターステップ](https://maimai.party/en/songs/%E3%82%B7%E3%83%A5%E3%82%AC%E3%83%BC%E3%82%BD%E3%83%B3%E3%82%B0%E3%81%A8%E3%83%93%E3%82%BF%E3%83%BC%E3%82%B9%E3%83%86%E3%83%83%E3%83%97-e0c5a85c5f7e/) | DX | UNISON SQUARE GARDEN | shugaasongutobitaasuteppu |
| [POP TEAM EPIC](https://maimai.party/en/songs/pop-team-epic-c8fa605218f7/) | STD | 上坂すみれ「ポプテピピック」 | — |
| [Daydream café](https://maimai.party/en/songs/daydream-caf%C3%A9-30c26df40ca2/) | DX | Petit Rabbit&#x27;s「ご注文はうさぎですか？」 | — |
| [Daydream café](https://maimai.party/en/songs/daydream-caf%C3%A9-283a6dee9496/) | STD | Petit Rabbit&#x27;s「ご注文はうさぎですか？」 | — |
| [かくしん的☆めたまるふぉ～ぜっ！](https://maimai.party/en/songs/%E3%81%8B%E3%81%8F%E3%81%97%E3%82%93%E7%9A%84-%E3%82%81%E3%81%9F%E3%81%BE%E3%82%8B%E3%81%B5%E3%81%89-%E3%81%9C%E3%81%A3-528bee059461/) | DX | 土間うまる [CV.田中あいみ]「干物妹！うまるちゃん」 | Kakushin teki metamarufooze |
| [コネクト](https://maimai.party/en/songs/%E3%82%B3%E3%83%8D%E3%82%AF%E3%83%88-e52f434499e3/) | STD | ClariS　「魔法少女まどか☆マギカ」 | konekuto |
| [Link](https://maimai.party/en/songs/link-16ed19a4a310/) | STD | Clean Tears feat. Youna | — |
| [Paradisus-Paradoxum](https://maimai.party/en/songs/paradisus-paradoxum-cb063bd0ec7f/) | STD | MYTH &amp; ROID「Re：ゼロから始める異世界生活」 | — |
| [POP TEAM EPIC](https://maimai.party/en/songs/pop-team-epic-895d1f77dc05/) | DX | 上坂すみれ「ポプテピピック」 | — |
| [君の知らない物語](https://maimai.party/en/songs/%E5%90%9B%E3%81%AE%E7%9F%A5%E3%82%89%E3%81%AA%E3%81%84%E7%89%A9%E8%AA%9E-8bff5e8b67f3/) | STD | supercell「化物語」 | Kimi no Shiranai Monogatari |
| [Seyana. ～何でも言うことを聞いてくれるアカネチャン～](https://maimai.party/en/songs/seyana-%E4%BD%95%E3%81%A7%E3%82%82%E8%A8%80%E3%81%86%E3%81%93%E3%81%A8%E3%82%92%E8%81%9E%E3%81%84%E3%81%A6%E3%81%8F%E3%82%8C%E3%82%8B%E3%82%A2%E3%82%AB%E3%83%8D%E3%83%81%E3%83%A3%E3%83%B3-311994f3f6d9/) | STD | GYARI | — |
| [いぇす！ゆゆゆ☆ゆるゆり♪♪](https://maimai.party/en/songs/%E3%81%84%E3%81%87%E3%81%99-%E3%82%86%E3%82%86%E3%82%86-%E3%82%86%E3%82%8B%E3%82%86%E3%82%8A-a44fb2559f68/) | STD | 七森中☆ごらく部「ゆるゆり♪♪」 | yesu!yuyuyu☆yuruyuri♪♪ |
| [最っ高のエンタメだ!!](https://maimai.party/en/songs/%E6%9C%80%E3%81%A3%E9%AB%98%E3%81%AE%E3%82%A8%E3%83%B3%E3%82%BF%E3%83%A1%E3%81%A0-e476bdb385fc/) | DX | 曲：本田正樹(Dream Monster)／歌：7EVENDAYS⇔HOLIDAYS [井之原 小星(CV：ももの はるな)、柏木 咲姫(CV：石見 舞菜香)] | Saikou no entame da |
| [CHOCOLATE BOMB!!!!](https://maimai.party/en/songs/chocolate-bomb-d992f29f4f71/) | DX | YUC&#x27;e | — |
| [Dive into The Sky ～initialized～](https://maimai.party/en/songs/dive-into-the-sky-initialized-c44d58e1c759/) | DX | A-One | — |
| [紅星ミゼラブル～廃憶編](https://maimai.party/en/songs/%E7%B4%85%E6%98%9F%E3%83%9F%E3%82%BC%E3%83%A9%E3%83%96%E3%83%AB-%E5%BB%83%E6%86%B6%E7%B7%A8-240d2225db84/) | DX | 東京アクティブNEETs | — |

The packaged regional aids demonstrate why locale and quality are separate fields:
Umiyuri includes `海百合海底谭`, `海底谭` and `우미유리 해저담` as authored
search aliases, alongside generated `우미유리카이테이탄`. Uma to Shika includes
`马与鹿` and `우마토 시카`. These are examples of the existing internal dataset,
not newly verified public display names. The source records and kind labels remain
unchanged. The Tachi collection contains 2,199 alias values across its 1,417 pairs.

### Generated metadata examples

These are candidate output, not claims about current Google snippets. Each title
below has the same approved reading immediately below the original visible H1.
BOGE instead appears only in its separate alternate-name line.

- **ウミユリ海底譚**
  - HTML title: `ウミユリ海底譚 (Umiyuri Kaiteitan) — maimai Charts | maimai.party`
  - Description: `ウミユリ海底譚 (Umiyuri Kaiteitan) — n-buna. maimai Charts: STD MASTER 13 (Constant 13.4)`
- **馬と鹿**
  - HTML title: `馬と鹿 (Uma to Shika) — maimai Charts | maimai.party`
  - Description: `馬と鹿 (Uma to Shika) — 米津玄師. maimai Charts: DX MASTER 12 (Constant 12.3)`
- **Beat of getting entangled**
  - HTML title: `Beat of getting entangled — maimai Charts | maimai.party`
  - Description: `Beat of getting entangled — Shoichiro Hirata. maimai Charts: STD MASTER 13+ (Constant 13.8); STD RE:MASTER 14 (Constant 14.5)`

## Context, size and accessibility choices

Jackets retain empty alternative text because the same song identity is already
adjacent in the heading and artist facts. The catalog does not contain reviewed
descriptions of artwork content. Repeating a title would not explain the jacket;
invented blue/star descriptors would be misleading. Existing dimensions and image
files remain unchanged.

Measured optional version-link readings would add 8,133 bytes to the English
CiRCLE page (26,104 shipped bytes, approximately 31%) using the maintained regional markup.
That is a poor tradeoff for this restrained patch. Version content and links remain byte-identical;
their existing contextual links still lead to the improved song pages.

Full-catalog before/after generation preserves every route, sitemap and song-data
binding. Measurements and validation commands are recorded in
[the implementation validation report](SONG_DISCOVERY_SEO_VALIDATION.md). There is
no runtime service, telemetry change, new JavaScript or alias-specific URL.

## After owner-approved publication

Compare equivalent 28-day windows after Google has recrawled: `/songs/` impressions,
clicks and CTR by locale/country; exact original/romanized query pairs; BOGE; chart
and version intent. Keep query reports private and acknowledge low counts and
anonymized/missing rows. Separate branded/operator traffic from player queries.

Track indexed/discovered/crawled-not-indexed counts by locale. Inspect a small
fixed sample (Umiyuri, Uma to Shika, BOGE, an unchanged Latin song and duplicate
STD/DX titles), including Google-selected canonical and rendered main content.
Use the unchanged sitemap inventory to distinguish discovery from indexing.
This work performs no indexing requests or sitemap resubmissions. A fresh capacity
review is required at publication; local tests do not authorize deployment.
