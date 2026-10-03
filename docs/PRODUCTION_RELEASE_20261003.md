# Production release: 3 October 2026

The combined architecture, multilingual search pages, first-party usage collector
and owner reports are live at [maimai.party](https://maimai.party/). The final
production smoke completed at 05:55 UTC on 3 October after 600 seconds.

## Deployed release

| Item | Verified value |
| --- | --- |
| Application source | `f9b74cc8caadef0110eda5655c47f13c15059f51` |
| Production deployment | `5f503f2f-c113-4f3f-8e0d-41caa082b4e2` |
| Immutable candidate | <https://5f503f2f.maimai-party.pages.dev> |
| Compatible recovery | `5a7c5044-308a-459b-8307-400450c89bd3` |
| Immutable recovery | <https://5a7c5044.maimai-party.pages.dev> |
| Candidate manifest SHA-256 | `180a916b2bf5282376d2fd38043c90ae88c3d8b47c370ec81707a73d79f1384f` |
| Recovery manifest SHA-256 | `fefc0bc79898b7b3e80ba0e61269e32dc28af5abe6baf3f0f1d63c033d792a9b` |
| Sealed files per layout | 32,542 |

The release reused the verified corpus and sealed candidate/recovery layouts.
Each was uploaded once. The approved Pages capacity setting was read back and
preserved. The original executor was not rerun. Later documentation commits do
not change these deployed bytes. GitHub source publication and Pages Direct
Upload remain separate operations.

## What is available

- Stable song and version pages with initial HTML in English, Japanese, Korean
  and Simplified Chinese: 1,694 songs and 28 versions in each language. Canonical
  routes, language alternatives and an index of five sitemaps expose 6,889 URLs,
  including the homepage, without submitting personal or transient app state.
- Song pages share chart details, analysis, personal-result and comparison
  controls with the browser. Selected-chart links and return navigation preserve
  the relevant browser state. Historical public asset URLs remain available.
- Maintained typed browser modules and explicit catalog/report preparation
  interfaces replace duplicated ownership while retaining the existing static
  deployment model and visual components. Identity, regional display, provider
  matching and player data remain separate.
- A dedicated `maimai-private-usage` Worker on the exact `/__usage` route writes
  finite action totals to `maimai-usage` D1. Read-only owner reports produce JSON,
  Markdown, totals CSV and coverage CSV. This is not a new public dashboard.
  See [the usage guide](../usage-worker/README.md).

Existing Cloudflare Web Analytics, opt-in Google Analytics and their consumers
were preserved. The first-party collector stores daily aggregates, not individual
events, URLs, searches, chart/player identities, IPs, visitors or sessions. Its
independent kill switches, GPC/DNT handling and best-effort delivery remain.

## Production acceptance

Fresh provider readback verified the dedicated database, schema, collector
binding and route, disabled workers.dev/preview endpoints, and disabled Worker
observability/logpush. Immutable and production routes and resource hashes were
checked. One approved non-personal canary returned 204 and incremented its exact
counter from zero to one. That canary was never replayed. The owner report was
generated from actual read-only D1 results.

The final smoke passed retained old-tab search/details, reload and navigation,
fresh-tab navigation, throttled navigation, four-language routes, compatibility
assets, hashes and repeated current-deployment/configuration checks. Earlier
stopped attempts and automatic collector-off/recovery transitions remain in the
evidence. Continuation fixes addressed CLI SQL argument parsing and browser-test
readiness/expanded-row assertions; they did not change the deployed product.

The existing local, cross-browser, visual, package and corpus verification remains
source-bound in [the architecture acceptance record](architecture/REVISION.md).
Those checks were reused rather than represented as a new full-suite run.

## Search Console

On 3 October the authenticated `maimai.party` domain property accepted
<https://maimai.party/sitemap.xml> with “Sitemap submitted successfully.” All five
child sitemaps and robots.txt matched the sealed production bytes. Every sitemap
URL mapped to its canonical local HTML and permalink identity.

At submission, Google's table still showed its previous 27 September crawl and
one discovered page. That is a historical crawl result, not evidence that the new
6,889 URLs have already been indexed. Google controls crawling and indexing; use
[Search Console](https://search.google.com/search-console/sitemaps?resource_id=sc-domain%3Amaimai.party)
to review processing, exclusions and impressions after it refreshes.

## Limits and follow-up

- Usage activation is 3 October (America/New_York). Earlier dates are unknown,
  not zero. The launch day includes one synthetic canary and acceptance activity.
  Missing coverage-ledger rows remain unknown even when counts exist. Owner
  exclusion, unique users, sessions and funnels cannot be inferred.
- Hosted warm recovery-manifest cache evidence remains inconclusive; the hosted
  delayed-response switch scenario remains unrun. These are follow-up coverage,
  not passing test claims.
- Follow up on Search Console crawl/indexing results and establish an explicit
  coverage/reporting practice after the first completed production day. A
  scheduled report or graphical usage dashboard is a separate future change.

The private release record is retained under
`C:/Dev/maimai/release-completion-20260924/production-continuation-20261003/`:
`FINAL-RELEASE-RESULT.json`, `FINAL-PRODUCTION-HANDOFF.txt`, all stopped journals,
`execution-v5/completion.json`, owner reports and the sitemap audit. Do not rerun
any attempted executor. Start future release work with fresh deployment readback.
