# maimai.party community badge

This source renders the public badge from Cloudflare HTTP visits over the rolling past 30 days. Counts are visits, not unique people. Both reports now use the same maintained user-agent policy to exclude identifiable automated tests, monitors and crawlers, including ClaudeBot, headless browser tests and marked verification clients. The filter applies to every total, country group and daily history bucket. Ordinary and unknown browser identities remain eligible; historical tests that impersonated an ordinary browser cannot be reliably removed. The policy does not block crawlers from accessing or indexing the site. Sampling metadata remains explicit.

The broader policy was deployed October 3, 2026, replacing the October 2 monitor-only filter. Live account- and zone-level queries, public responses and the GitHub profile image were verified. All 25 badge tests passed. Publishing this directory tracks the maintained source; it does not deploy a Worker.

## Build and test

Use Node 24 in a disposable workspace outside canonical source. On Windows, use a current-source copy under C:\DevCache; GitHub Actions uses a copy under its runner temporary directory. No package installation is needed for these commands:

```sh
node tools/build-assets.mjs
node --test tests/*.test.mjs
```

The asset builder uses the committed template, flag images encoded in JSON, and font outlines. It generates ignored assets.mjs. CI builds these assets and runs fictional tests without credentials or deployment.

## Runtime and release

The Worker expects CF_ACCOUNT_ID and the existing CF_ANALYTICS_TOKEN secret. Configure them only through the owner-controlled workflow; never commit credential values. Account-specific Wrangler configuration, private environment files and owner tooling stay local. A production release needs a separate readback and approval; this source push does not activate a release or change access/logging.

Fresh analytics snapshots are cached for one hour, with five-minute browser caching. Refresh occurs on a request after expiry. Failure can use a labelled valid snapshot for at most 24 hours with five-minute retry backoff. Invalid/missing data shows unavailable. Snapshot/cache version 5 isolates the broader policy from every earlier count, including the monitor-only version 4. Old pre-filter cache versions cannot masquerade as filtered counts.

The SVG embeds artwork, flags and lettering without external asset requests. See ARTWORK.md and artwork/provenance.json for attribution and hashes.

The visible headline retains the approved “freely serving [count] visitors this month” design, using the original Nunito outlines, colors and positioning. The SVG title and description specify that the underlying metric is sampled rolling-30-day visits.
