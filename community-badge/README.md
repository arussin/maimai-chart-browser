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

The Worker now expects `CF_ZONE_ID` (the 32-hex maimai.party zone ID) and the
existing `CF_ANALYTICS_TOKEN` secret with **Zone > Analytics > Read**, scoped to
the maimai.party zone. `CF_ACCOUNT_ID` is no longer read by the new code. Configure
settings first through the owner-controlled workflow; never commit credential
values. Private Wrangler configuration and owner tooling stay local. This source
change does not deploy a Worker or change account permissions.

Fresh analytics snapshots are cached for one hour, with five-minute browser caching.
Refresh occurs on a request after expiry. Failure can use a labelled valid snapshot
under 24 hours old in the current UTC month, with five-minute retry backoff.
Invalid/missing configuration, token permission failures or rejected analytics
fields show an HTTP 200 SVG marked `unavailable` if no eligible v6 cache exists;
they never become zero or fall back to an unfiltered/account query. A missing token
can still use that zone's valid v6 cache; a missing/changed zone cannot find it.
Snapshot/cache version **6**, zone ID, scope and both policy versions isolate all
previous account-scoped counts, including v5. A v5 object placed under the new key
is also rejected. Existing downstream image caches can display an earlier response
until their own cache expires; changing the internal key cannot purge those caches.

## Network policy and owner rollout

The November 22 local source in
`C:\Dev\tidbyt-suite\cloudflare\traffic-worker\traffic-networks.mjs` is the
dashboard feed's policy source. Its byte-identical copy here excludes AS132203
using `clientAsn_neq: "132203"` inside `AND`, alongside the existing user-agent
exclusions. The query uses `viewer.zones`, `ZoneHttpRequestsAdaptiveGroupsFilter_InputObject`,
`CF_ZONE_ID`, the exact `maimai.party` host and `eyeball` source for both totals
and countries. The policy applies only to maimai.party; the Free-plan site must
not receive this field. Other scanner traffic can still contribute.

`traffic-policy.mjs` is **untouched** and remains byte-identical to the feed.
`X-Traffic-Policy` is unchanged; `X-Traffic-Network-Policy` identifies the added
policy, matching the dashboard feed. Do not fork network lists or bump the shared
user-agent policy to represent a network change. Before publishing either Worker,
synchronize both policy files and run the byte comparison from the prepared badge
directory (it fails on any difference):

```sh
node tools/check-policy-sync.mjs C:/Dev/tidbyt-suite/cloudflare/traffic-worker
node tools/build-assets.mjs
node --test tests/*.test.mjs
```

Owner checklist:

1. Save the currently deployed badge version/configuration. **Settings first:**
   add `CF_ZONE_ID` for maimai.party and ensure `CF_ANALYTICS_TOKEN` has
   **Zone > Analytics > Read** on that zone. Retain `CF_ACCOUNT_ID` and the old
   token's existing permissions during the rollback window so the old code keeps
   working. No account ID, token or account state was accessed for this change.
2. Verify the maimai.party zone accepts the exact network-filtered query with
   that token; the local dashboard source records success on this paid zone but
   this task performs no live verification. Do not broaden the query to Free
   zones or silently remove the filter on an error. Run the policy parity guard.
3. Deploy the badge code, generated assets and all imported policy modules with
   the existing `/badges/community.svg` route and existing logging settings.
   Check `X-Badge-State: fresh`, both policy headers, the SVG exclusion text and
   the 30-day query window. Internal cache starts cold; v5 is deliberately unused.
4. On failure, prefer retaining the new code's labelled v6 stale cache while
   correcting configuration. If code rollback is necessary, restore the saved
   version with its retained `CF_ACCOUNT_ID` and token permissions. That version
   again shows account-scoped counts including the scanner network: do not describe
   it as network-filtered. Keep v6 cache separate; do not relabel/copy v5 values.
   No static site release is involved.

The SVG embeds artwork, flags and lettering without external asset requests. See ARTWORK.md and artwork/provenance.json for attribution and hashes.

The visible headline retains the approved “freely serving [count] visitors this month” design, using the original Nunito outlines, colors and positioning. The SVG title and description specify that the underlying metric is sampled rolling-30-day visits.
