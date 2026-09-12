# maimai.party analytics

GA4 is configured for the future published site. Creating the property and building
the integration does not deploy the website or produce live visitor data.

## Property and stream

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

## Visitor choice and data boundaries

The shared footer provides **Privacy & analytics** and, on the published domain,
**Analytics settings**. A small notice offers equally accessible **Allow analytics**
and **No thanks** buttons. Google is not contacted until opt-in. This is basic
consent mode, without denied-consent pings or a second tag-manager container.

Only HTTPS on `maimai.party` and `www.maimai.party` activates the integration.
Local previews, other domains and HTTP are excluded before reading or writing
analytics preferences. Global Privacy Control and Do Not Track disable collection,
including when a device has previously opted in.

The local preference `maimai.party.analytics.v1` expires after 180 days. Analytics
cookies expire after 90 days without a rolling refresh. Refusing analytics does
not create Google cookies. Revocation sets Google's documented opt-out flag,
removes this property's analytics cookies and synchronizes the choice between
tabs on the same origin. It preserves imported results and filters. Already
collected data is not retroactively deleted. If local storage is unavailable,
the choice works for the current tab only.

We send manual `page_view` events for exactly three fixed virtual pages:

| Browser view | Analytics page location | Analytics page title |
| --- | --- | --- |
| Charts (including main Explore) | `https://maimai.party/charts` | maimai.party · Charts |
| Pattern dictionary | `https://maimai.party/patterns` | maimai.party · Pattern dictionary |
| Compare charts | `https://maimai.party/compare` | maimai.party · Compare charts |

Actual URLs, query strings, hashes, document titles and referrers are not sent.
Campaign fields are explicitly blank. Catalog versions, chart and pattern IDs,
searches, file names, player identifiers, attempts, scores and recommendations
never enter the analytics event payload. Filters, individual charts, comparisons,
imports and clearing personal data do not produce custom analytics events.
Repeated selection of the same view is deduplicated. Navigation through a chart
action uses the same view notification as the tabs.

GA4 supplies its standard session, first-visit and engagement measurements from
the consented tag. Google processes requests, including connection IP addresses
and browser information. This setup does not claim anonymous or zero-data
tracking. Advertising consent is denied and ad personalization/signals are off.
No accounts, upload endpoint or personal-data server were added.

## Build and launch

The existing `site`, `demo` and `lab` commands include the shared integration;
there is no new Python dependency. The host must preserve the generated content
security policy's limited Google tag and Analytics endpoint allowances. Don't
install a duplicate Google tag through a hosting integration or enable automatic
enhanced measurement: either can bypass the event restrictions or double count.

After deployment, open the HTTPS site in a fresh browser profile, opt in, and
visit Charts, Pattern dictionary and Compare charts. Check **Reports → Realtime**
in the property for those broad page views. Then test refusal and withdrawal.
The local development server intentionally cannot validate live collection.
Visitors who decline or block analytics will not appear in these statistics.

## Validation

`tests/browser/analytics.spec.js` serves synthetic builds under intercepted HTTPS
origins. All third-party requests are fulfilled locally, including collection
requests, so tests cannot create fake production visitors. The regular suite uses
a stub tag and verifies opt-in, refusal, expiry, storage failure, cross-tab
revocation, privacy signals, cookie removal, personal import isolation, fixed
page fields, keyboard access, accessibility and mobile layout.

For an additional local audit, download the official public script from
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
