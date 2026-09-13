# maimai.party analytics

GA4 is configured for the published site. The repository also supports
Cloudflare Pages' hosting-managed Web Analytics integration for aggregate
traffic. Source support is not proof that hosting analytics is enabled or that
a new release has been deployed; follow [the activation guide](CLOUDFLARE_ANALYTICS.md).

## Property and stream

Recorded setup on 12 September 2026 under the owner's existing Analytics account:

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
These recorded settings should be rechecked in the account when changing tracking.

## Google Analytics choice and data boundaries

The shared footer provides **Privacy & analytics** and the settings menu opens
**Google Analytics settings**. A small notice offers equally accessible
**Allow Google Analytics** and **No thanks** buttons. Google is not contacted
until opt-in. This is basic consent mode, without denied-consent pings or a
second tag-manager container. The notice distinguishes this Google choice from
Cloudflare's separate cookie-free aggregate measurement when enabled by the host.

Only HTTPS on `maimai.party` and `www.maimai.party` activates the GA integration.
Local previews, other domains and HTTP are excluded before reading or writing
analytics preferences. Global Privacy Control and Do Not Track disable GA collection,
including when a device has previously opted in. These application controls do
not control a beacon injected separately by Cloudflare hosting.

The local preference `maimai.party.analytics.v1` expires after 180 days. Analytics
cookies expire after 90 days without a rolling refresh. Refusing Google Analytics
does not create Google cookies. Revocation sets Google's documented opt-out flag,
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

Actual URLs, query strings, hashes, document titles and referrers are not sent to GA.
Campaign fields are explicitly blank. Catalog versions, chart and pattern IDs,
searches, file names, player identifiers, attempts, scores and recommendations
never enter the GA event payload. Filters, individual charts, comparisons,
imports and clearing personal data do not produce custom analytics events.
Repeated selection of the same view is deduplicated. Navigation through a chart
action uses the same view notification as the tabs.

GA4 supplies its standard session, first-visit and engagement measurements from
the consented tag. Google processes requests, including connection IP addresses
and browser information. This setup does not claim anonymous or zero-data
tracking. Advertising consent is denied and ad personalization/signals are off.
No accounts, upload endpoint or personal-data server were added.

## Aggregate Cloudflare traffic

Cloudflare Web Analytics is a separate, hosting-managed measurement layer, not
a fallback Google tag. Once enabled and deployed, it can measure visits and
page views from visitors who decline Google Analytics, subject to blockers,
network loss, hosting rules and geographic exclusions. Visits are not unique
humans, nor are they directly comparable to GA users or sessions. Neither system
is an exact census; do not subtract their different metrics to estimate refusals.

Cloudflare's beacon does not use cookies, browser storage or fingerprinting to
identify visitors. It still processes page/referrer and browser performance
metadata and receives a connection IP address. Do not describe it as zero-data
tracking or assume GA's fixed virtual-page sanitization applies to it. Cloudflare
currently documents that query strings are not logged, but that is not a promise
that every field in every transmitted vendor payload is sanitized by this app.
The application does not pass imported personal results to Cloudflare.

See [CLOUDFLARE_ANALYTICS.md](CLOUDFLARE_ANALYTICS.md) for activation, scope,
CSP, live payload validation, geographic coverage and metric limitations.

## Build and launch

The existing `site`, `demo` and `lab` commands include the shared GA integration;
there is no new Python dependency. The host must preserve the generated content
security policy's limited Google tag, Cloudflare beacon and collection endpoint
allowances. Cloudflare activation is a separate owner operation; the repo does
not embed a beacon token, install a second snippet or enable any hosting service.
Don't install a duplicate Google tag or enable automatic enhanced measurement:
either can bypass the event restrictions or double count.

After deployment, open the HTTPS site in a fresh browser profile, opt in, and
visit Charts, Pattern dictionary, Compare charts and About. Check **Reports →
Realtime** in the property for those broad page views. Then test refusal and
withdrawal. The local development server intentionally cannot validate live
collection. Visitors who decline or block Google Analytics will not appear in
GA statistics; Cloudflare counts, when activated, are in its separate dashboard.

## Validation

`tests/browser/analytics.spec.js` serves synthetic builds under intercepted HTTPS
origins. All third-party requests are fulfilled locally, including collection
requests, so tests cannot create fake production visitors. The regular suite uses
a stub tag and verifies opt-in, refusal, expiry, storage failure, cross-tab
revocation, privacy signals, cookie removal, personal import isolation, fixed
page fields, keyboard access, accessibility and mobile layout.

`tests/browser/cloudflare.spec.js` simulates a hosting-injected beacon against the
built page CSPs. It tests exact/versioned beacon URLs, same-origin and external
collection, GA refusal across reloads, narrow script permissions and blocked
beacon resilience. The Cloudflare script is a local stub: this verifies CSP and
consent independence, not the real vendor payload, account activation or ingestion.

For an additional local GA audit, download the official public script from
`https://www.googletagmanager.com/gtag/js?id=G-FP9V9NF63J` into ignored `output/`,
set `GA_SDK_PATH` to its absolute path and run the same suite. This executes the
real tag but intercepts every outgoing collection request. It checks serialized
payloads for synthetic private-value sentinels and verifies that withdrawal also
works when the script arrives late. The downloaded vendor script is not bundled,
committed or redistributed with this package. Google may change its script or
property configuration; rerun this audit when changing tracking behavior.

## References

- [GA4 configuration fields](https://developers.google.com/analytics/devguides/collection/ga4/reference/config)
- [Google tag privacy controls and opt-out](https://developers.google.com/tag-platform/security/guides/privacy)
- [Consent implementation](https://developers.google.com/tag-platform/security/guides/consent)
- [Enhanced measurement](https://support.google.com/analytics/answer/9216061)
- [Data retention](https://support.google.com/analytics/answer/7667196)
- [Google privacy policy](https://policies.google.com/privacy)
- [Cloudflare Pages Web Analytics](https://developers.cloudflare.com/pages/how-to/web-analytics/)
- [Cloudflare RUM data and privacy](https://developers.cloudflare.com/speed/observatory/rum-beacon/)
- [Cloudflare Web Analytics FAQs](https://developers.cloudflare.com/web-analytics/faq/)
