# Search visibility

The [3 October production release](PRODUCTION_RELEASE_20261003.md) serves static
song and version documents in English, Japanese, Korean and Simplified Chinese.
Initial HTML includes descriptive titles, descriptions, canonical URLs and
language alternatives. Visitors and crawlers receive the same HTML; existing
interactive browser controls progressively enhance it.

`robots.txt` permits crawling and points to <https://maimai.party/sitemap.xml>.
The sitemap index references `sitemap-pages.xml` (one homepage) and
`sitemap-en.xml`, `sitemap-ja.xml`, `sitemap-ko.xml`, `sitemap-zh-hans.xml`
(1,722 URLs each: 1,694 songs and 28 versions). The release therefore publishes
6,889 canonical URLs. Persisted permalink identities determine routes; display
labels are not canonical matching keys.

Search/filter combinations, comparison pairs, personal data, private reports,
payment routes and query/fragment state are not sitemap entries. The sitemap is
generated with the reviewed public release; do not maintain a separate manual
list or replace verified release files solely to resubmit it.

## Google Search Console

The existing verified `maimai.party` domain property accepted the updated sitemap
on 3 October 2026. The live sitemap index, all five children and robots.txt were
checked against sealed release bytes; every URL had its expected canonical HTML.
No new property or verification DNS change was needed.

Open [Sitemaps](https://search.google.com/search-console/sitemaps?resource_id=sc-domain%3Amaimai.party)
to see processing. Immediately after submission, the table retained the prior
27 September crawl and one discovered page; that historical count is not the new
sitemap size. Submission enables discovery but does not guarantee indexing or
ranking. Google must recrawl and process the pages.

After processing, review **Page indexing** for exclusions and **Performance** for
impressions/clicks. Use **URL inspection** and **Test live URL** for representative
song/version pages when diagnosing an issue. Do not interpret a valid sitemap or
local HTML test as proof that Google indexed every page.

References:
- [Build and submit a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Sitemaps report](https://support.google.com/webmasters/answer/7451001)
