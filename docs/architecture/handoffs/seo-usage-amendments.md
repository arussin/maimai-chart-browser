# Accepted planning refinements

These refine the original handoff. The integrated design adds the recorded Maishift base, architecture boundaries and legacy-asset capacity gate.

# Multilingual catalog pages and private usage reporting

## Summary

Deliver one combined release containing crawlable song/version pages, active first-party usage counts, and private reporting with ongoing daily history.

Preserving the browser experience is the central requirement: chart clicks continue opening inline, and returning from a separate song page restores the user’s browsing context exactly.

Work in the canonical registry checkout, preserve its unrelated uncommitted changes, and use the existing owner-controlled publication process. This plan does not authorize deployment or account changes.

## Browsing experience and public routes

- Generate `/en/`, `/ja/`, `/ko/`, and `/zh-hans/` song and version routes. Keep the existing browser at `/`. Language remains independent of game region.
- Song pages provide lightweight, factual initial HTML and a prominent “Open in chart browser” action above the fold. Chart links open the corresponding chart directly, without requiring another search.
- Keep existing inline chart expansion unchanged. Add a separate, clearly labeled song-page link within chart details.
- When opening a song page from the browser, retain the mounted browser and its data. Use browser history to show the song page; “Back to results” and browser Back restore search, every filter, regional preference, sorting, selected difficulties, expanded rows, loaded result count, scroll, and keyboard focus.
- Save a versioned browsing-state snapshot in browser history for reload and non-BFCache restoration. This is local application state, entirely inaccessible to telemetry. Continue using existing player-data persistence; do not duplicate scores into navigation snapshots.
- Direct song arrivals use ordinary working links into the browser. Never send an external arrival “back” to Google when they choose the browser action.
- Version pages contain crawlable song links immediately, then progressively initialize the existing browser with the appropriate version selected. Failed JavaScript leaves the static page usable. Automatic initialization and restoration never count as filter actions.
- Use one navigation lifecycle for actual route activations. Initial loading, enhancement, rerenders, and filter changes do not create duplicate page views. Back, Forward, and BFCache returns each count once.

## Static generation, languages, and capacity

- Extend the Python release builder using the accepted public catalog. Generate public metadata only; retain existing qualifications around unavailable or experimental analysis. No runtime SSR, homepage SEO copy, or per-page catalog duplication.
- Use stable registry song IDs with a persisted permalink map containing only identities and routes. Initial slugs use normalized Unicode titles plus a short ID suffix; published slugs remain unchanged after title corrections. Resolve collisions deterministically and preserve redirects after identity merges.
- Generate translated initial HTML, titles, descriptions, and interface text for all four languages. Preserve canonical song and artist names. Each translation has its own canonical URL, reciprocal `hreflang` links, and an English `x-default`; explicit language URLs override browser-language detection. This follows [Google’s multilingual guidance](https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites).
- Use lowercase language prefixes and trailing-slash canonical routes. Unprefixed song/version links redirect to English. Unknown routes return a real 404. Generate a sitemap index and language sitemaps; omit arbitrary filters, player data, reports, and payment routes. Omit the optional song index in v1.
- Share styles, scripts, artwork, and lazy permalink data. Do not introduce an eagerly downloaded homepage-wide SEO route table.
- Add a backwards-compatible shared-detail format so identical chart-detail files can be reused across catalog versions. Keep accepted catalog bytes unchanged, retain the catalog hash in its index, and verify each referenced detail file’s checksum, expected chart membership, and source identities. Continue supporting older formats.
- Preserve all retained catalog versions. The historical accepted release contained 14,837 files; read-only analysis suggests sharing duplicate detail files could bring the four-language projection to approximately 13,900. Verify the actual release rather than treating this projection as acceptance. Keep the 20,000-file build guard and report remaining growth capacity.

## Private usage collection and reporting

- Replace the existing Cloudflare Web Analytics browser beacon at combined launch. Preserve opt-in GA’s four sanitized page categories and existing support events. Verify that the retired beacon is absent from both direct loads and in-app navigation.
- Add a dedicated collector at `/__usage`, isolated from payments and imports, with exact host/path validation. Its narrow Worker route also catches and rejects malformed suffixes or query-bearing requests.
- Use a versioned, finite contract: event, broad page category, approved detail/failure enums, and bounded integer count. Reject unknown fields and validate the entire batch before writing.
- Cover the handoff’s existing-feature action dictionary: settings, filters, search, chart exploration, comparison, imports, personal-data controls, sharing, resources, and issue reporting. Include implemented file, hosted-session, and Maishift flows. Record successful application of imported data separately from dialog closure; exclude automatic restoration and refresh from deliberate import actions.
- Keep telemetry entirely in memory: at most 16 pending counter rows, 4 KiB per request, counts bounded to 1–100, a 10-second sparse flush, and best-effort exit delivery. Use credentials omitted, no referrer, no redirects, no retries, and no UI dependency on collection. Test the approximately 5 KiB compressed instrumentation ceiling.
- Suppress requests for GPC/DNT and nonproduction builds. Preserve the chosen disclosure-only approach without a new toggle or banner; update existing wording to distinguish optional GA from first-party counts.
- Store counters directly in a dedicated **D1 database**, replacing the handoff’s Analytics Engine proposal. Atomically increment daily totals keyed by instrumentation version and finite event dimensions. Store no raw event history, identifiers, URLs, search text, player content, or individual receipt timestamps.
- Assign reporting days server-side in `America/New_York`, retaining daily totals without automatic expiry. Reports show the corresponding UTC boundaries, including daylight-saving transitions.
- Provide an owner-run reporting command producing Markdown, CSV, and JSON. Default to the last 30 completed reporting days, with explicit date-range selection. Include activation and instrumentation coverage, partial/unavailable periods, collection failures, and limitations. Describe received action counts—not unique people, sessions, or conversion funnels.
- Disable collector invocation/payload logging and tracing; inspect inherited logging destinations. Provide independent server write-disable and client request-suppression controls. No scheduled exports or new automation.

## Verification and combined release gates

1. **Baseline and proof of concept:** Capture production-equivalent performance, then build five representative songs—including Unicode, punctuation, and duplicate titles—and two versions in all four languages. Prove navigation, raw HTML, translations, privacy, shared-detail integrity, and file scaling before generating the full corpus.
2. **State restoration:** Test browser → song → Back and “Back to results” with combined filters, searches, sorting, expanded charts, personal controls, and scroll. Include multiple song visits, Forward, reload, BFCache disabled, direct arrival, new tabs, slow loads, and failed loads.
3. **SEO and integrity:** Verify canonicals, language alternates, redirects, escaping, sitemap completeness, unknown routes, title changes, identity merges, and old catalog links. Reject wrong, missing, or tampered detail files.
4. **Telemetry:** Intercept all analytics traffic using private-data sentinels. Test initialization versus deliberate actions, navigation deduplication, GPC/DNT, malformed/oversized batches, transactional failures, concurrent increments, day boundaries, and slow/offline collectors. Keep synthetic data isolated from production.
5. **Performance and regressions:** Compare baseline, SEO-only, and SEO-plus-usage under identical repeated conditions. Measure homepage transfer/execution, interaction timings, lightweight arrivals, version initialization, return-to-results latency, layout shifts, build duration, and file counts. Investigate meaningful regressions; a percentage threshold is not automatic acceptance.
6. **Activation:** Verify account quotas, costs, bindings, logging, privacy basis, disclosures, and the selected objection mechanism. Subscription/billing access remains unresolved. If disclosure plus GPC/DNT proves insufficient, hold the combined release and return the concrete conflict to Adam.
7. **Publication:** Release SEO, active counts, and working reports together only through the owner-controlled process. Verify deployed HTML, browser requests, received counters, and report output before declaring launch complete. Keep independent rollback available without deleting history.

Any new reporting credentials or account permissions require the protected workflow: “This crosses the protected security boundary and needs the security-sensitive / privileged workflow.” Prepare the concrete configuration and reviewable release before seeking that approval.
