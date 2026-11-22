# Static publication metadata

The public planner publishes the Party-ring `favicon.ico` and one shared
`og-image.png`. The icon is an ICO container around the exact 16, 32 and 48 pixel
PNG payloads already in `assets/favicon.html`; Maishift's icon is unrelated.
Inline PNG icons remain in the self-contained offline exports.

The 1200 by 630 preview PNG was drawn locally with Windows System.Drawing: white
background, the existing 48 pixel Party ring scaled to 192 pixels, and the
`site-brand.html` wordmark in its existing Segoe UI system-font fallback, bold
italic, using the exact colors from `site-brand.css`. No font file, image or
artwork was downloaded. Only the PNG is a packaged preview asset. Its small
generation script and Adam's review copy are in
`C:\DevCache\projects\maimai-chart-browser-registry\audit-source-fixes-20261122`
(`generate-brand-assets.ps1`, `og-image.png`).

Home metadata replacement removes managed tags only within the head and is
idempotent. The old implementation unconditionally appended tags; feeding a
previously published/annotated shell through it twice reproduces the duplication.
This establishes a possible mechanism, not the provenance of the November 21
deployment. Clean source generation produces one set. Song/version documents
use the same escaped social metadata and the first-party shared preview.

## Dates and release inputs

Supply the intended release date explicitly as `--release-date YYYY-MM-DD` to
`maimai-chart public-release` (the interface/public planner),
`maimai-chart corpus prepare`, or owner `scripts/update_catalog.py prepare`
and `refresh`. Python callers pass `release_date` to `plan_public_release`,
`build_public_release`, or `prepare_update`. There is no clock or source-capture
fallback: capture dates do not reliably describe an interface change. Omission
leaves new/changed URLs undated and preserves dates for unchanged URLs.

Sitemaps are dated after the final browser resources are sealed. A localized song
or version page changes when its parsed markup, text, search/social metadata,
artwork references or own data binding changes, excluding shared browser resource
descriptors, browser entry scripts, generated module preloads, stylesheet links,
runtime CSP/base metadata and release-wide catalog membership checksums.
The song binding's path, checksum and byte count verify its referenced data, then
the comparison retains its identities and a semantic digest of that data, so a
song's data change counts even when its static text stays the same; changes to
shared scripts or styles alone do not advance localized page dates. The digest
excludes artwork acquisition URLs/source hashes and dimension annotations (the
image's immutable path, bytes and hash still count), and normalizes regional
artwork records that select exactly the same path/title/artist as their fallback.
This follows `web/src/domain/artwork.ts`; it does not suppress changed artwork,
regional titles/artists, charts, constants, analysis or other own data. The
November 22 catalog refresh updated artwork provenance and added redundant JP
records widely, so comparing raw song payload hashes would also over-date pages.

Read-only comparison of `import-diagnostics-pr67-20261122/public` with
`catalog-38c3efcc0fdf-20261122/public` finds **2,035 of 8,670** current localized
pages changed: 60 additions, 955 changed rendered documents, and 1,020 whose own
data changed without changing the static document. Of the latter, 850 gained
Mai Notes data, 25 changed Mai Notes and provider mappings, 140 changed provider
mappings, and 5 changed analysis/catalog/navigation/provider data. The other
6,635 pages are unchanged; none were removed. Thus the brief's expectation of
only a few dozen changed songs does not describe these complete release trees,
even after excluding shared runtime and artwork provenance churn. The read-only
comparison script and per-page/category receipts are `compare-page-content.py`,
`followup-real-data.json` and `followup-change-categories.json` in the work folder
above; no full release plan was run against the published trees.

This comparison is only a dating projection of maintained HTML, never an input to
catalog or application assembly. Home and other nonlocalized pages keep exact
byte comparison, and home also compares the default catalog checksum. Unchanged
URLs retain their preceding date; changed/new URLs use the explicit release date
or remain undated when it is omitted. The sitemap index uses the maximum child
URL date only when every URL is dated; URL removals additionally require the
explicit release date and include it in that maximum, so deletions cannot leave
a stale index date. An unchanged child preserves its preceding index date,
including a date established by an earlier removal. Missing historical dates are seeded
on the first explicitly dated release. Catalog bytes and permalink identities
are untouched. The planner/build summary records the input; corpus attempts,
release-inputs and ready receipts bind it, and resume/replay preserve it.

The cache-only `release-tools/prepare_interface_release.py` is an older owner
adapter, not canonical source. It currently freezes `_headers` and sitemaps and
reseals against a full production manifest. It must not be used unchanged for
this release: it will reject the intended metadata changes. The canonical
`public-release` API/CLI above supports the date input and final-content comparison.
Any adapter that reseals again must call `date_sitemaps` only after that final
seal, with the verified preceding public directory and the recorded release
date, and include new brand assets. Dating is idempotent, so a second finalization
replaces intermediate dates instead of appending duplicates.
Do not waive its inventory/catalog checks or the canonical 20,000-file guard.

## Headers and immutable browser assets

Only `_headers` changes response policy. The global rule adds
`Content-Security-Policy: frame-ancestors 'none'`; the separate restrictive
support-return policies and noindex directives remain. No meta CSP is changed
for this protection. Browser graphs require a generated eight-character esbuild
hash or a sixteen-character SHA suffix, with manifest byte/checksum validation.
The final planner rejects unlisted `/browser/` files and reuse of a preceding
browser path with different bytes. `Test-Web.ps1` verifies the graph against the
typed build. `/browser/*` is immutable; mutable `browser-resources.json` is
explicitly `no-cache`. There is no global Cache-Control rule to collide with
either path rule.

The [hosted pilot notes](MAISHIFT_HOSTED_PILOT_RELEASE.md#service-configuration-and-privacy)
record that Pages concatenates duplicate header values; a later, more specific
rule must not be assumed to override a global rule. Cache rules here have only
one match for each tested browser/resource path. Global and support-return CSP
values form separate policies, which browsers enforce together. The full return
policy retains frame denial too, so either policy protects it. Offline tests
check the declarations; actual Pages responses and framing remain unverified
in this network-forbidden task and must be checked before shipping.

## Publication impact

The retained November 22 inventory and five localized sitemaps contain 8,670
localized documents (the scoping report's estimate was 8,610):

| Item | Public files affected |
| --- | --- |
| Party favicon | 1 new root ICO; about 8,670 localized HTML icon links (shared with the preview rewrite) |
| Social preview | 1 new PNG; index, browser shell, their immutable shell snapshot and browser-resources.json, plus about 8,670 localized HTML files |
| Idempotent home metadata | No additional files on a clean build; up to the same 4 shell/resource files when repairing a duplicated input |
| Sitemap dates | 7 XML files with localized SEO, or 1 fallback sitemap |
| Frame ancestors | 1 `_headers` file |
| Immutable browser scripts | The same `_headers` file; no generated script bytes change |

These counts overlap and are estimates, not a completed full-corpus release
inventory. No Worker source or catalog data is changed. Adam reviews the PNG;
Claude reviews the uncommitted source and owns commit/PR preparation.
