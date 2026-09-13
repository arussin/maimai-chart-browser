# maimai.party analytics

The published site has opt-in GA4 for broad page views. The source also permits
Cloudflare Pages' native cookie-free Web Analytics beacon for aggregate traffic.
These are separate systems: refusing Google Analytics does not enable it in a
reduced-data mode, and does not control Cloudflare's separate measurement.

**Cloudflare activation is a hosting operation, not a code change.** The CSP and
visitor disclosures are ready; this repository does not prove that Web Analytics
has been enabled in the account, deployed, or received any live beacons. Follow
the activation and verification checklist below before reporting it as active.

## Google Analytics property and stream

Created on 12 September 2026 under the owner's existing Analytics account:

| Setting | Value |
| --- | --- |
| Property | maimai.party (`553863747`) |
| Web stream | maimai.party web (`15763691369`) |
| Measurement ID | `G-FP9V9NF63J` (public identifier, not a secret) |
| Website | `https://maimai.party` |
| Reporting time zone / currency | New York / USD |
| Enhanced measurement | Off |
| Google signals / user-provided data | Off |
| Granular location and device data | Off |
| Ads personalization | Disallowed in all regions |
| User and event retention | 2 months; reset on new activity off |

Open the [property's web streams](https://analytics.google.com/analytics/web/#/a15384385p553863747/admin/streams/table/)
using the owner's Google account. The existing property for adamrussin.com was
not modified. Retention settings apply to detailed user/event data; standard
aggregated reports are governed by Google's separate retention behavior.

## Google Analytics choice and data boundaries

The shared footer provides **Privacy & analytics** and, on the published domain,
**Analytics settings**. A small notice offers equally accessible **Allow analytics**
and **No thanks** buttons. Google is not contacted until opt-in. This is basic
consent mode, without denied-consent pings or a second tag-manager container.
The notice and settings distinguish this choice from cookie-free Cloudflare
traffic measurement. No application changes were made to `analytics.js` for
Cloudflare support.

Only HTTPS on `maimai.party` and `www.maimai.party` activates the Google integration.
Local previews, other domains and HTTP are excluded before reading or writing
Google analytics preferences. Global Privacy Control and Do Not Track disable
Google collection, including when a device has previously opted in. Do not claim
that these Google-specific controls disable a host-injected Cloudflare beacon.

The local preference `maimai.party.analytics.v1` expires after 180 days. Analytics
cookies expire after 90 days without a rolling refresh. Refusing analytics does
not create Google cookies. Revocation sets Google's documented opt-out flag,
removes this property's analytics cookies and synchronizes the choice between
tabs on the same origin. It preserves imported results and filters. Already
collected data is not retroactively deleted. If local storage is unavailable,
the choice works for the current tab only.

We send manual `page_view` events for exactly four fixed virtual pages:

| Browser view | Analytics page location | Analytics page title |
| --- | --- | --- |
| Charts (including main Explore) | `https://maimai.party/charts` | maimai.party · Charts |
| Pattern dictionary | `https://maimai.party/patterns` | maimai.party · Pattern dictionary |
| Compare charts | `https://maimai.party/compare` | maimai.party · Compare charts |
| About | `https://maimai.party/about` | maimai.party · About |

Actual URLs, query strings, hashes, document titles and referrers are not sent to
Google Analytics. Campaign fields are explicitly blank. Catalog versions, chart
and pattern IDs, searches, file names, player identifiers, attempts, scores and
recommendations never enter the Google Analytics event payload. Filters,
individual charts, comparisons, imports and clearing personal data do not produce
custom analytics events. Repeated selection of the same view is deduplicated.
Navigation through a chart action uses the same view notification as the tabs.

GA4 supplies its standard session, first-visit and engagement measurements from
the consented tag. Google processes requests, including connection IP addresses
and browser information. This setup does not claim anonymous or zero-data
tracking. Advertising consent is denied and ad personalization/signals are off.
No accounts, upload endpoint or personal-data server were added.

## Cloudflare Web Analytics: aggregate traffic

Use the **native Pages integration**, not an additional hard-coded script, Google
Tag Manager container, proxy Worker, custom collector or second zone-level
injection. Cloudflare supplies the public site token and beacon at deployment.
Do not commit API credentials or change the owner-only publication boundary.

The generated browser CSP allows `https://static.cloudflareinsights.com` in
`script-src`. This covers Cloudflare's unversioned and versioned beacon paths.
Pages' native token-only snippet reports to
`https://cloudflareinsights.com/cdn-cgi/rum`, allowed at that exact path in
`connect-src`. Zone-level automatic injection instead uses same-origin
`/cdn-cgi/rum`, already allowed by `'self'`. These injection methods must not be
confused: the current Pages snippet needs the external collection permission.
No wildcard, `unsafe-inline` script permission or `unsafe-eval` is added. Local builds do not
embed a Cloudflare script; a CSP allowance alone collects nothing. The `/lab/`
redirect in a public release remains script-restricted to `'self'` so that the
redirect page cannot create an extra beacon before the destination loads.

The Cloudflare counter is independent of the Google choice. According to
[Cloudflare's privacy explanation](https://developers.cloudflare.com/web-analytics/about/),
Web Analytics does not use cookies, local storage or fingerprinting to identify
visitors. It still sends traffic/performance measurements and processes network
requests. This is not a promise of zero data processing, nor a determination that
consent is unnecessary in every jurisdiction. No score uploads or custom
interaction events are added by this application.

Cloudflare's beacon is vendor-managed. Its payload is not the four fixed virtual
pages used by Google Analytics. Cloudflare currently says it does not log query
strings; do not equate that statement with proof that every field of every future
beacon is safe. Preserve `Referrer-Policy: no-referrer`, audit the actual request
bodies and headers before activation, and recheck when the vendor changes.

### Owner activation and live verification

1. In Cloudflare, select **Workers & Pages → maimai-party → Metrics → Web Analytics → Enable**.
   Inspect existing Pages and zone-level settings first. Use exactly one native
   injection source, not a manual snippet as well. Confirm the intended hostname
   and any region exclusions; an EU-excluded configuration is not global coverage.
2. Rebuild the interface using the existing accepted catalog package and publish
   through [the owner Direct Upload procedure](OWNER_PUBLICATION.md). Merging a PR
   or clicking Enable alone does not publish these assets; Cloudflare documents
   that its Pages snippet appears on the **next deployment**. Do not enable Git
   deployment hooks or put Cloudflare credentials in CI.
3. With synthetic data in an isolated browser profile, inspect the deployed root
   page and an older-catalog deep link. Verify one Cloudflare beacon script, no CSP
   errors, and successful `POST https://cloudflareinsights.com/cdn-cgi/rum`
   collection from the native Pages snippet. Confirm that
   the `/lab/` redirect does not add a second measurement. Do not relax the global
   referrer policy or add broad CSP permissions to mask a failed request.
4. Before Google opt-in and after **No thanks**, verify no Google tag requests,
   Google collection requests or `_ga` cookies, while the Cloudflare beacon can
   still load. Check opt-in and subsequent withdrawal too; refusal must not become
   Google's advanced/cookieless consent mode. Inspect storage to distinguish the
   local consent preference from cookies used for identifying analytics visitors.
5. Search, change charts, use synthetic query/hash sentinels, and open a synthetic
   personal-results file. Capture the **real Cloudflare beacon's** request headers
   and bodies while preventing synthetic collection from reaching production.
   Check for player IDs, filenames, scores, searches and other private sentinels.
   Test page exit/visibility changes, not just initial loading. If private data is
   transmitted, leave Web Analytics disabled and redesign before activation.
   The stub tests below prove CSP/GA separation, not the vendor's payload safety.
6. View **Cloudflare → Web Analytics**, filter to the actual `maimai.party`
   hostname and desired date range, and verify Visits and Page Views appear.
   Record the deployment ID, date, hostname coverage and any exclusions. Exclude
   preview hosts and account for owner/test visits when evaluating launch traffic.

To roll back, disable Web Analytics at the host and redeploy if necessary; verify
that the script and collection requests have stopped. Restore the prior known-good
Pages deployment for an interface regression. The Google consent implementation
and the accepted catalog data do not need to change.

### Reading the numbers

**Visits** are Cloudflare's traffic metric, not unique humans, registrations or
proof that someone tried a particular feature. **Page Views** count page loads/
SPA navigation according to Cloudflare's rules, not our fixed GA view events.
Refusal no longer removes visitors from this separate counter when it is enabled,
but blockers, disabled JavaScript, failed requests, region exclusions, automated
traffic and repeat visits still affect coverage. Some reporting is sampled; do
not promise complete or exact totals. Cloudflare's Web Analytics cannot backfill
visits from before the beacon was activated. Existing edge/request analytics, if
available, are a different data source and must not be called a people count.

Compare trends within each system. Do not subtract GA **users** from Cloudflare
**visits** to calculate nonconsenters: those metrics have different definitions.
See Cloudflare's [metric definitions](https://developers.cloudflare.com/web-analytics/data-metrics/high-level-metrics/)
and [FAQ, including blockers and sampling](https://developers.cloudflare.com/web-analytics/faq/).

## Build and Google Analytics validation

The existing `site`, `demo` and `lab` commands include the shared Google integration;
there is no new Python dependency. The host must preserve the generated content
security policy. Don't install a duplicate Google tag through a hosting integration
or enable automatic enhanced measurement: either can bypass the event restrictions
or double count.

After deployment, open the HTTPS site in a fresh browser profile, opt in, and
visit Charts, Pattern dictionary, Compare charts and About. Check **Reports → Realtime**
in the property for those broad page views. Then test refusal and withdrawal.
The local development server intentionally cannot validate live collection.
Visitors who decline or block Google Analytics will not appear in GA statistics.

`tests/browser/analytics.spec.js` serves synthetic builds under intercepted HTTPS
origins. All third-party requests are fulfilled locally, including collection
requests, so tests cannot create fake production visitors. The regular suite uses
a stub tag and verifies opt-in, refusal, expiry, storage failure, cross-tab
revocation, privacy signals, cookie removal, personal import isolation, fixed
page fields, keyboard access, accessibility and mobile layout.

`tests/test_cloudflare_analytics.py` checks both browser CSPs and a generated public
release, including the uninstrumented redirect. The browser Cloudflare tests
insert a synthetic Pages snippet into HTML before the browser parses it. They
exercise CSP enforcement for both collection endpoints, refusal across reloads,
uninstrumented local/preview builds, and the public `/lab/` redirect. They are
included in the normal Playwright test list. No test contacts an analytics provider.

For an additional Cloudflare audit, download the public vendor script from
`https://static.cloudflareinsights.com/beacon.min.js` into ignored `output/`, set
`CF_SDK_PATH` to its absolute path, and run the browser suite. This checks actual
serialized request bodies and headers after synthetic imports, searches, chart
selection, navigation and page exit, including Google opt-in and withdrawal.
The current vendor code removes URL queries and fragments; this audit does not
prove the contents of future vendor payloads. Recheck on vendor changes.

For an additional local Google audit, download the official public script from
`https://www.googletagmanager.com/gtag/js?id=G-FP9V9NF63J` into ignored `output/`,
set `GA_SDK_PATH` to its absolute path and run the same suite. This executes the
real tag but intercepts every outgoing collection request. It checks serialized
payloads for synthetic private-value sentinels and verifies that withdrawal also
works when the script arrives late. The downloaded vendor script is not bundled,
committed or redistributed with this package. Google may change its script or
property configuration; rerun this audit when changing tracking behavior.

## References

- [Cloudflare Pages activation](https://developers.cloudflare.com/pages/how-to/web-analytics/)
- [Cloudflare beacon origins](https://developers.cloudflare.com/web-analytics/data-metrics/data-origin-and-collection/)
- [Cloudflare CSP and measurement FAQ](https://developers.cloudflare.com/web-analytics/faq/)
- [GA4 configuration fields](https://developers.google.com/analytics/devguides/collection/ga4/reference/config)
- [Google tag privacy controls and opt-out](https://developers.google.com/tag-platform/security/guides/privacy)
- [Consent implementation](https://developers.google.com/tag-platform/security/guides/consent)
- [Enhanced measurement](https://support.google.com/analytics/answer/9216061)
- [Data retention](https://support.google.com/analytics/answer/7667196)
- [Google privacy policy](https://policies.google.com/privacy)
