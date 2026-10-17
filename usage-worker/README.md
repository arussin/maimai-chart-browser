# Daily product counts

The first-party daily counter coexists with the existing Cloudflare Web Analytics browser beacon and separate opt-in Google Analytics. Existing analytics consumers remain in place; their migration is deferred. Production activation and read-only owner reporting were verified on 3 October 2026; see the [release record](../docs/PRODUCTION_RELEASE_20261003.md). The repository configuration remains a non-deployable placeholder: use only the separately reviewed production binding, never its all-zero database ID. Activation is 2026-10-03 in America/New_York; launch-day totals include acceptance activity and one synthetic canary. The report is an owner-run export, not a new public dashboard.

The Worker accepts only POST https://maimai.party/__usage with the production Origin and exact application/json type. The contract is web/src/usage-contract.ts: at most 16 rows, 4 KiB, count 1–100 and known event/page/detail/failure combinations. Unknown fields reject the whole batch. D1 receives only reconstructed daily aggregate counts and server receipt bounds; no individual event table, IP or hash, identity, URL, referrer, query/search/filter value, chart identity, player data, raw error or client timestamp is stored. USAGE_ENABLED=false is the independent server-write kill. window.maimaiUsageEnabled=false (set before startup) suppresses client requests. The application uses an imported collector instance; no global service API is exposed. GPC and DNT suppress both. Network failures drop data and never retry.

Days use America/New_York. Aggregate counts and their known receipt bounds are retained indefinitely. The optional owner-maintained usage_coverage ledger records complete/partial/off by day and instrumentation version. Missing ledger rows mean unknown coverage, even when counts exist; zero is measurable only for a day the owner has confirmed complete. Never infer exact unobserved drop counts, users, sessions, funnels, retention, geography or owner exclusion.

## Import and provider actions

The maintained contract adds these finite counters. They describe explicit actions
and stages, with no account names, account/grant IDs, filenames, source URLs,
tokens, score values, source timestamps or raw errors. Import and provider
`*_failed` events use only `invalid`, `unavailable`, `storage`, `unknown`,
`popup_blocked`, `authorization_failed`, `timeout`, `network`, `rate_limited`,
`connection_expired`, `agreement_required`, `profile_missing`, `empty_scores`,
`invalid_response`, `account_mismatch` or `cleanup_required`. Other events have
an empty failure value. No provider response is passed to usage reporting.

| Event family | Detail values | Meaning |
|---|---|---|
| `import_{started,previewed,confirmed,completed,cancelled,failed}` | file, report, maishift, kamaitachi, diving-fish, lxns, file:mai-tools, file:dxrating, file:tomomai, file:jietng, file:aqua, file:tachi | Overall attempt, valid preview shown, confirmation, local browser commit, cancellation or failure; completed is emitted after local commit and before connection cleanup |
| `provider_connect_{started,completed,cancelled,failed}` | diving-fish, lxns | Explicit provider authorization; completed means the browser obtained a connection, before data-import consent |
| `provider_read_{started,completed,cancelled,failed}` | kamaitachi, diving-fish, lxns | Initial direct read; completed means the returned dataset was validated, before import consent |
| `provider_refresh_{started,completed,cancelled,failed}` | report, maishift, kamaitachi, diving-fish, lxns | Explicit manual refresh; completed includes a successful unchanged-data check |
| `provider_disconnect_{started,completed,failed}` | diving-fish, lxns | Explicit disconnect or release caused by the user's cancel/import-once/replacement/forget choice |
| `provider_cleanup_{started,completed,failed}` | diving-fish, lxns | Explicit retry-cleanup action, counted per affected provider, not per grant |
| `resource_opened` | diving_fish, lxns | User deliberately opens a tracker link; the target URL is never sent |

Automatic refresh, restored state, capability/status checks, popup status polling,
and background cleanup do not emit these counters. GPC/DNT, both kill switches,
preview/offline suppression, bounded batching and drop-without-retry still apply.
Version-2 diagnostics separately record automatic operation outcomes, including
refresh and connector-configuration failures. This does not add automatic actions
to version 1 or turn diagnostic stages into a linked import funnel.
Disconnect success means the browser's targeted connection is removed or no
longer accessible; it does **not** establish provider-side revocation.

Do not add these stage counters together as distinct imports, people, grants or
a linked funnel. Overall `import_*` and provider-stage counters describe overlapping
attempts. Portable files retain their existing `import_*/file` counters. Other
file importers use their exact finite `file:*` method from the table, so the owner
can distinguish each file format's attempts and outcomes. Bare names such as
`tomomai`, filenames, account IDs, and inferred file contents are never detail
values. File importers do not emit provider connect/read/refresh events, and there
is no separate file-fallback event. Cancellation and a failed subsequent grant cleanup are separate
outcomes. Received starts/terminals need not balance because the collector drops
blocked or failed batches and a tab can close before completing an action.

The browser and collector compile the same `web/src/usage-contract.ts` whitelist.
The owner Markdown/CSV report and dashboards import the maintained TypeScript
contract directly. Both
render every accepted event/detail/failure row without a separate hardcoded
feature list, and reject extra private aggregate fields. First apply the additive
`0002_import_receipts.sql` migration to the reviewed database while retaining
production's additive `0003_diagnostics.sql` table, then release the
matching collector and owner reports/dashboards, then release the browser's new
finite values, including the six new `file:*` methods. An old collector rejects
an entire batch containing an unknown event, method, or failure reason. No new
database migration is needed just for these method values. Updated reports query the receipt columns and fail safely
until the schema exists. No new logging sink is introduced. Retain the actual
activation date of the new counters, diagnostic categories and receipt fields;
older complete coverage does not prove that these features were instrumented.
Local fixtures verify all allowed lifecycle combinations, D1 writes, report
rendering, opt-outs and private-field rejection; they do not prove hosted
collection. The existing deployed collector is unchanged by this source work;
hosted acceptance of the new counters remains unverified. Production
configuration and activation are unchanged.

The nullable `first_received_at` and `last_received_at` columns record the first
and latest **known collector receipt** of each daily aggregate tuple, in ISO UTC.
They come from the collector clock, never from a client event, player record or
provider timestamp. Historical rows remain null until that tuple next receives a
counter; this does not recover its older receipt times. Old file exports without
these fields remain readable with unknown bounds. Invalid or reversed bounds,
timestamps outside the tuple's New York day, and receipts after a dashboard's
capture time are rejected. These are daily count bounds, not an event log. On a code rollback, retain the
additive columns and existing counts; do not reverse this migration, erase
receipt bounds or recreate the database. Stop new browser values before restoring
an older collector that does not recognize them.

The **Imports** section separates attempts, previews, confirmations, actual local
commits, cancellations and import failures by service and method. Session Report
file and URL are separate methods; each additional provider file importer has its
own labeled row. Runtime visibility changes do not erase historical counters,
and a hidden connector does not imply zero usage. A second table shows first/latest known
activity and the latest attempt, local commit and failure receipts. Failure rows
name the fixed stage and category; a connection cleanup failure can follow a
successful local commit. Stage counts overlap and must not be summed as distinct
imports or a conversion funnel. Missing new counters are unknown, even on an old
day with complete coverage. Raw counter tables and CSV exports remain available.

## Private local dashboard

`dashboard.mjs` renders a self-contained HTML dashboard from a successful
`usage-export-1` aggregate export. Use Node 24.14.1 (the repository's pinned
runtime); the renderer imports the maintained TypeScript usage contract directly,
so no dependency install or browser-asset rebuild is needed.

    node usage-worker/dashboard.mjs --input PRIVATE/usage-export.json --output PRIVATE/usage-dashboard.html --captured-at 2026-10-03T13:37:47.765Z

Use the actual query-completion timestamp for `--captured-at`. Open the generated
file locally. The view provides Today, completed 7/30-day and custom ranges,
page/action filters, daily received counts, import outcomes and receipt times,
feature detail, a coverage ledger and CSV export. All import tables follow the
same filters. Today and the day captured partway through remain incomplete even if
a ledger row says complete. Unknown or pre-activation coverage is never displayed
as a measured zero. Counts are actions, not visitors, sessions or funnels.

The HTML contains private aggregates and must stay outside public site assets and
Git. It contains no credentials, external scripts, fonts, trackers or network
calls; its CSP also disables connections. Refresh the aggregate export through
the existing owner read-only reporting workflow, render again, then use Reload
saved snapshot. A failed query or invalid export must not overwrite a good file.
There is no new authentication, hosted endpoint, public dashboard, schedule or
background collector in this renderer. It never modifies D1 or coverage records.

Run `node --test usage-worker/test/dashboard.test.mjs` for the focused data,
timezone, injection and offline-rendering checks. Normal usage-worker CI also
includes those tests. Existing owner reports and public collection are unchanged.

## Local validation

The shared finite contract also includes Best 50 and achievement-export actions;
see [their counting semantics](../docs/USAGE_AND_TRAFFIC_METRICS.md). The Markdown
report, local dashboard and hosted dashboard use the same reviewed action labels
and dedicated image-export section. Rebuild the collector and hosted dashboard
from the accepted source after applying the additive receipt-column migration,
and update their code before publishing browser code that sends new events. An
older collector rejects a batch containing unknown events or reasons. No database
binding, routes, Access policy, credentials or logging settings change is required.
Retain the separately reviewed production
configuration and verify those settings remain unchanged during code rollout.

Use tools/Test-Web.ps1 from the linked checkout. Dependencies, emitted test bundles and local D1 state belong in the disposable DevCache workspace. Tests cover the real local D1 API, concurrent increments, batch rollback, strict rejection, opt-out, no retries and daylight-saving boundaries.

After building, run from the disposable usage-worker directory:

    node report.mjs --input synthetic-export.json --output C:\DevCache\path\usage-report
    node report.mjs --database maimai-usage-local --persist-to C:\DevCache\path\local-state --output C:\DevCache\path\usage-report

The second form issues exactly three read-only SELECTs through Wrangler. It defaults to local. The --remote flag must be explicitly supplied by the owner after production setup review. Optional --from/--to select completed New York dates; the default is 30 completed days. Explicit `--include-today` permits today and makes it the default end date; today stays partial even if its coverage ledger says complete. --activated records the owner-supplied activation date. Reports include JSON, Markdown and CSV; JSON/Markdown carry coverage, diagnostic outcomes and health, import outcomes, known collector receipt times and limitations; a companion `.coverage.csv` preserves activation, daily UTC boundaries, and unknown versus measured-zero days. Query failure or a missing receipt-column or diagnostic-table migration is an error, never a zero report.

## Separate staging adapter

`worker.ts` binds the collector to `https://maimai.party`. `staging.ts` is a separate
entry that binds the same implementation to `https://maimai-party-staging.pages.dev`.
Neither accepts an environment override for origin. Local tests exercise both
entries against distinct real local D1 databases and reject cross-origin requests.
This is local isolation evidence, not evidence that hosted staging exists.

Provision staging with its own D1 database and an explicitly reviewed access policy.
The Pages project base hostname and every preview/custom hostname must be covered;
protecting only branch preview URLs is insufficient. Browser staging must use a
separate explicit test collector adapter. Never relax production eligibility to
make staging tests send events. Verify signed-out denial and intended-owner access
before enabling a staging collector or exposing a hosted preview.

### Browser staging artifact

From the disposable prepared `web` workspace, run:

    node build.mjs --staging-output NEW_EXTERNAL_DIRECTORY

The destination parent must exist; the destination itself must be new and outside
source. This emits the same hosted/offline entry graph. The hosted staging plugin
selects the fixed usage origin and changes only the two maintained public-file and
usage transport literals from `omit` to `same-origin`. Each replacement is bound
to its exact module path and refuses a missing or duplicated literal. No private
import or payment transport is changed. Production and offline compiler inputs
remain unchanged; `node build.mjs --check` must still match every packaged byte. `staging-build.json` binds its manifest to the packaged
production manifest and records the fixed staging origin. Production assets,
compatibility assets and manifests are untouched. This is a browser runtime
artifact for the separately prepared complete staging site, not a deployment or
a complete site upload by itself. Keep the receipt outside public site assets.

Production imports `usage.ts`; the staging build substitutes `usage-staging.ts`.
Both use the same finite collector implementation. No URL, query, global or
runtime origin setting can switch either profile. Both obey GPC/DNT and the
existing kill switch. Offline reports remain silent. Usage requires the exact
HTTPS origin, including its default port, as the server already requires.

`npm test` in `usage-worker` also verifies the actual local owner-report command
against collector-written persisted D1 data, including a missing-table failure.
It uses fictional dates/data, a child-process loopback transport guard and the
same pinned Wrangler CLI as the owner command. Failed fixtures remain in the
approved temporary directory for diagnosis; successful ones are removed.

## Private staging Pages transport

The separately compiled `pages/functions/__usage.ts` route calls the existing
staging collector through `USAGE_COLLECTOR`; it never calls a public Worker URL.
`pages/wrangler.jsonc` names only `maimai-party-staging`, with that binding targeting
`maimai-private-usage-staging`. It has no D1 binding. The collector has its own
`USAGE_DB` bound to `maimai-usage-staging`, its own kill switch, and no production
database or service. Keep `USAGE_ENABLED=false` until owner verification. Disable
the collector's workers.dev and preview URLs and give it no public route.

Access must protect the base hostname, every deployment/preview hostname, every
static asset and `/__usage`. There is no collector bypass policy. The browser
lets its normal same-origin cookie mechanism authenticate public-data and usage
requests; application code never reads cookies. Existing production/offline
requests still omit credentials. The bridge reconstructs a fresh streaming request
with only Content-Type, Origin, DNT and Sec-GPC. Cookies, authorization, Access JWTs,
identity headers, referrers and incoming `cf` metadata are not copied. The edge can
add mechanical Content-Length/Transfer-Encoding framing. The unchanged collector
owns size, finite-payload, origin, opt-out, kill and daily-aggregation checks.

The bridge accepts only the exact staging origin and `/__usage` without a query;
missing/failed bindings return empty 503 responses. It uses edge-supported manual
redirect mode and refuses any 3xx response without following or exposing its
Location. Browser public reads continue to use `redirect: 'error'`.

From a prepared disposable usage-worker workspace, assemble the **complete**
reviewed staging site under `pages/site`, using the separate staging browser
manifest when generating HTML and immutable resource references. Do not copy
only the new chunks over existing HTML. Keep receipts outside `site`. Then use
the existing pinned Wrangler, without an install or a new publishing mechanism:

    node node_modules/wrangler/bin/wrangler.js pages functions build pages/functions --project-directory pages --outdir pages/site/_worker.js

Place the reviewed `pages/_routes.json` at `pages/site/_routes.json`; only the usage
path invokes Functions, while other paths retain Pages asset handling. The
compiled `_worker.js` directory includes the generated router and its ASSETS
fallback. It belongs only in the separate staging artifact. Do not place it in
an accepted production artifact or point its config at the production project.

The explicit staging `nodejs_compat` flag binds compiler and runtime behavior.
Pinned Wrangler 4.135.0 defaults an unspecified Pages Node mode to its v1
polyfills, whose initial output imported `node:stream` and `node:events`. The
explicit current mode avoids that implicit build/runtime mismatch. This does not
change the production collector's compatibility settings. Binding declarations
are generated from the staging config, using the existing runtime declarations:

    cd pages
    node ../node_modules/wrangler/bin/wrangler.js types --config=wrangler.jsonc --include-runtime=false --env-interface=StagingPagesEnv pages-bindings.d.ts

Pages' Wrangler configuration does **not** accept the Worker's observability or
logpush fields. Before enabling the collector, the owner must separately verify
and retain readbacks that Pages invocation/request logs, payload logging, tail
consumers and export sinks are disabled, alongside the collector's
`observability.enabled=false` and `logpush=false`. Neither bridge nor collector
logs payloads. Do not disable unrelated Access security logs. Missing logging
readback is an open activation gate, not evidence of disabled logging.

Run web tests and `npm run check && npm test` in usage-worker. The latter compiles
the actual Pages router and exercises a native service binding into the existing
collector with a separate local D1, including no-write cases. Its CLI child has
isolated configuration, no credentials, disabled metrics/update banner and a
non-loopback transport denial; failed fixtures remain for diagnosis. Local
simulation cannot prove hosted Access. Retain signed-out denial, owner-authorized
file loads, one finite canary increment and actual owner-report readback before
claiming hosted collection. Staging rollback rehearsals also need an explicitly
reviewed staging-only credential adapter for the retained baseline's legacy
public loader; never alter the accepted baseline itself.

## Coordinated activation

No account, database, route, schedule or credential is provisioned here. The all-zero database ID is a local placeholder and MUST NOT be deployed. The release checklist must record the actual D1 binding, quota/cost review, exact route, migrated schema, USAGE_ENABLED=true, client enabled state, preserved existing single-source public Web Analytics injection, and absence of request/payload logging in inherited invocation logs, traces, tail consumers and export sinks. Keep unrelated security logging unchanged.

This crosses the protected security boundary and needs the security-sensitive / privileged workflow.

Prepare a reviewed production config separately after the full SEO+coverage+usage candidate passes. Do not launch SEO alone or claim collection is active until the deployed browser, aggregate database and owner report are verified together with an approved non-personal canary. Use the independent kills for emergency degradation, then explicitly report the combined launch as degraded. Rollback restores the previous deployment and never deletes aggregate totals.

References: https://developers.cloudflare.com/d1/worker-api/d1-database/#batch

## Diagnostic outcomes

The additive version-2 contract, local delivery status, compatibility order and
historical pre-connector rollout are in [DIAGNOSTIC_LOGGING.md](../docs/DIAGNOSTIC_LOGGING.md).
Version-1 action rows remain supported. Search counts mean search interactions.
The third SELECT reads finite diagnostic aggregates and server receipt times;
a receipt proves a past write only, and diagnostic coverage remains incomplete.

The connector release extends the shared `diagnostics-1` allowlist to the twelve
import methods, provider authorization/disconnect/cleanup and visibility-loading
operations. Existing diagnostic rows keep their meaning. Ship the updated
collector and report readers before the browser: a previously deployed version-2
collector can still reject a new category even though it advertises `1,2`.
Both versions acknowledge only a successful database batch with
`X-Maimai-Usage-Receipt: stored`; privacy no-ops remain unconfirmed. No new table
is required for the additional categories. Version-1 import receipts require
migration 0002 even when production already has migration 0003.
