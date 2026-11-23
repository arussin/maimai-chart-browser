# Static publication metadata

The public planner publishes the Party-ring `favicon.ico` and one shared
`og-image.png`. The icon is an ICO container around the exact 16, 32 and 48 pixel
PNG payloads already in `assets/favicon.html`; Maishift's icon is unrelated.
Inline PNG icons remain in the self-contained offline exports.

The 1200 by 630 preview PNG uses the measured vector `assets/party-ring.svg`,
rendered locally with Pillow at eight times the target resolution and downsampled
with Lanczos. The ring retains its original 192 by 192 canvas at (504, 110).
Every pixel outside that canvas, including the original System.Drawing wordmark
and white background, is preserved from the prior PNG. The wordmark uses the
site's existing Segoe UI system-font fallback and `site-brand.css` colours; no
font file, image or artwork was downloaded. The SVG is included by the existing
package rules without configuration changes; public metadata still uses the PNG.

The vector was fitted against the embedded **48 px** PNG, on white: centre
(23.97, 24.00), outer/inner arc radii 20.12/10.95 px and 0.85 px outline/gaps in
measured dark `#003054`. Clockwise boundaries, in degrees from the right with
positive angles downward, are -128.40, -51.54, 17.56, 90.02 and 162.46.
Median interior colours, clockwise from the top, are red `#ec5153`, orange
`#f28f34`, yellow `#f7c729`, green `#8bbe48` and blue `#23aae4`.
The 48 px comparison has mean absolute RGB error 3.58/255 (RMSE 8.39/255).
Clean circular edges and flat fills replace the source PNG's faint edge
highlights and pixel-level colour variation. The centre is explicitly white;
the original centre is transparent and appears white on this background.
The 16/32/48 PNG icons and ICO remain unchanged.

Generation scripts, measurements and review copies are retained in
`C:\DevCache\projects\maimai-chart-browser-registry\og-image-20261122`:
`fit-ring.py` measures/fits the PNG, `write-vector.py` records that geometry as
SVG, and `generate-og-image.py` renders the SVG's circular paths and replaces
only the ring canvas in retained `og-image-original.png`. Run with the Python
environment selected by `tools/Use-DevelopmentEnvironment.ps1` (Pillow 13).
Outputs include `og-image.png` (35,287 bytes), `ring-compare.png` (old left,
new right at the preview size), `ring-compare-48.png`, and `validation.json`
with dimensions, hashes and the pixel-preservation check. No build, deployment
or favicon regeneration is part of this image-generation script.

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
