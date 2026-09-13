# Cloudflare aggregate analytics: owner activation

## Status and scope

The code supports Cloudflare Pages' hosting-managed Web Analytics snippet.
This is configuration readiness, **not a record of activation or deployment**.
No Cloudflare account setting was changed, token created, service enabled or
production release published by adding these files.

Use one Cloudflare Web Analytics installation, independent of opt-in GA4. The
Google Analytics code remains basic consent mode: no Google requests before
opt-in or after refusal. The banner, dialog and privacy notice explain that
Cloudflare's cookie-free measurement can run independently of that Google choice.

Cloudflare's beacon is third-party JavaScript and collects page/referrer and
performance metadata. Cookie-free does not mean no data processing or automatic
exemption from every consent/transparency requirement. Review applicable
requirements and the live payload before enabling broad geographic coverage.
The application's GPC/DNT logic only controls GA; do not claim that it also stops
a host-injected Cloudflare beacon. Local/offline copies are not configured to
inject a Cloudflare script.

## Activate on the existing project

1. Sign in as the owner and confirm the existing **maimai-party** Pages project
   and **maimai.party** domain. Do not create a replacement project or change DNS.
2. In **Workers & Pages → maimai-party → Metrics → Web Analytics**, select
   **Enable**, unless already enabled. Inspect existing zone-level Web Analytics
   or Observatory injection first; do not create a second installation. The
   Pages integration inserts its real site token, so no placeholder token or
   Cloudflare API credential belongs in this repo.
3. In **Web Analytics → Manage site**, inspect enabled hosts, rules and regional
   exclusions. Restrict tracking to the intended public site, not private report
   subdomains or other projects. An EU/EEA-excluding setting is not worldwide
   measurement. Record the selected coverage and any deliberate exclusions.
4. Follow [OWNER_PUBLICATION.md](OWNER_PUBLICATION.md) to merge checked source,
   rebuild the interface from the accepted catalog and perform an owner-authorized
   Direct Upload. Cloudflare documents that Pages injection takes effect on the
   **next deployment**. A GitHub merge alone does not publish this site.
5. Verify the real HTTPS custom domain and the dashboard as below. Record the
   deployment ID, source commit, verification date, coverage and account/site
   association. Do not call the integration live until these checks pass.

## CSP and deployment boundaries

Both the standalone page and research browser allow only the Cloudflare beacon
script path: `https://static.cloudflareinsights.com/beacon.min.js`, plus its
versioned path beneath `https://static.cloudflareinsights.com/beacon.min.js/`.
Other scripts on that host remain blocked. There is no new `unsafe-inline`,
`unsafe-eval`, wildcard or general HTTPS script allowance.

The existing `connect-src 'self'` supports same-origin `/cdn-cgi/rum`; the
additional `https://cloudflareinsights.com` allows the external collector used
by Cloudflare snippets. Existing Google and checkout restrictions are retained.
`Referrer-Policy: no-referrer` remains unchanged; do not weaken it simply to make
analytics work. Cloudflare documents possible Origin/Referer validation failures,
so confirm successful ingestion with the real snippet, not just its download.

The public `/lab/` compatibility redirect intentionally retains its stricter CSP
and does not run analytics before redirecting. This avoids counting that hop as
a second application visit. Sealed personal exports and offline report policies
are not loosened. Do not enable zone-wide injection on private report origins.

## Live verification checklist

- In a fresh profile, confirm exactly one Cloudflare beacon is inserted. Confirm
  no Google tag or GA collection requests before a choice, after **No thanks**,
  after reload with a saved refusal, and with GPC/DNT. With Cloudflare enabled,
  the statement is **no Google requests**, not no external requests.
- Check that the beacon script loads without CSP errors and its collector POSTs
  succeed when the page loads and the tab becomes hidden. Inspect both request
  and response; a script download alone is not proof of ingestion. Verify a
  corresponding page view in **Cloudflare → Web Analytics** for this site.
- Inspect real outbound payloads using only synthetic search terms, chart links
  and personal import sentinels. Check page/referrer fields and performance
  resource metadata, including after SPA navigation. Do not upload genuine
  personal data as a test. GA's virtual URL sanitization is not applied to the
  Cloudflare vendor script. Stop activation and reassess if the payload violates
  the intended privacy boundary; do not quietly relax it.
- Check that GA opt-in still sends only its four broad views and withdrawal
  stops further GA collection. Blocking the Cloudflare script must not break
  chart browsing, imports, settings or GA choice controls.
- Review preview/redirect behavior and geographic rules. Do not extrapolate
  worldwide traffic from an EU/EEA-excluding deployment.

## Reading the numbers

Use **Cloudflare Visits** and **Page Views** for aggregate traffic; use GA only
for its consenting subset. Cloudflare visits, GA sessions and GA users have
different definitions. Do not subtract them to count declined users.

Visits are not distinct humans: repeat visits, devices, bots, referrer rules,
blockers and network failures all affect interpretation. Cloudflare also documents
sampling/aggregation in reporting. There is no historical backfill for periods
before measurement was enabled. HTTP/edge request totals, where available, are a
separate metric that can include assets and bots, not a replacement human count.

## Tests and references

The regular browser CI includes `cloudflare.spec.js` for desktop, mobile and
narrow layouts. It intercepts every request and uses a synthetic beacon, so it
never contacts Cloudflare or Google. This proves CSP compatibility and separation
from GA refusal, not the production vendor's privacy behavior or actual ingestion.

- [Enable on Pages](https://developers.cloudflare.com/pages/how-to/web-analytics/)
- [Setup and regional options](https://developers.cloudflare.com/web-analytics/get-started/)
- [CSP, blockers, reporting and query strings](https://developers.cloudflare.com/web-analytics/faq/)
- [Beacon data and privacy](https://developers.cloudflare.com/speed/observatory/rum-beacon/)
- [Visits and page views](https://developers.cloudflare.com/web-analytics/data-metrics/high-level-metrics/)
