# Search visibility

The public release adds a descriptive title, description, canonical URL and social
preview metadata in the document head. It adds no visible page copy or hidden
keyword text, and serves the same HTML to visitors and crawlers.

`robots.txt` permits crawling and points to `https://maimai.party/sitemap.xml`.
The sitemap lists the app's canonical homepage. Search/filter combinations,
comparison pairs, personal state and retained catalog versions are not submitted
as separate pages. A sitemap lists URLs; the search description belongs in the
page metadata. The existing app still supplies its content through JavaScript.

## Google Search Console setup

1. Open <https://search.google.com/search-console> and sign in to the Google
   account that should own the site.
2. Choose **Add property**, then **Domain**, enter `maimai.party` (no `https://`
   and no path), and continue.
3. If Google offers Cloudflare verification, follow its domain-verification flow.
   Otherwise copy the supplied `google-site-verification=...` TXT value. In
   Cloudflare, open **maimai.party → DNS → Records → Add record**. Select **TXT**,
   name **@**, paste the exact value, leave TTL on **Auto**, and save. Keep this
   verification record after verification succeeds.
4. Return to Search Console and choose **Verify**. If the DNS record is not found
   yet, wait for propagation and try again.
5. Open **Sitemaps**, submit `https://maimai.party/sitemap.xml`, and confirm that
   Google reports success after processing it.
6. Use the top **URL inspection** field for `https://maimai.party/`. Choose
   **Test live URL**, inspect the rendered page, and **Request indexing** if the
   URL is eligible. Later, review **Page indexing** and **Performance** for
   indexing status, queries and impressions.

Setup does not require Google Analytics, a public page banner or a paid service.

References:
- [Verify ownership](https://support.google.com/webmasters/answer/9008080)
- [Build and submit a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)
