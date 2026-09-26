# Daily product counts

This local candidate replaces the public Cloudflare Web Analytics browser beacon. Existing opt-in Google Analytics stays separate. It is not a deployed collector.

The Worker accepts only POST https://maimai.party/__usage with the production Origin and exact application/json type. The contract is web/src/usage-contract.ts: at most 16 rows, 4 KiB, count 1–100 and known event/page/detail/failure combinations. Unknown fields reject the whole batch. D1 receives only reconstructed daily totals; no individual event table, IP or hash, identity, URL, referrer, query/search/filter value, chart identity, player data, raw error or client timestamp is stored. USAGE_ENABLED=false is the independent server-write kill. window.maimaiUsageEnabled=false (set before startup) suppresses client requests. The application uses an imported collector instance; no global service API is exposed. GPC and DNT suppress both. Network failures drop data and never retry.

Days use America/New_York. Totals are retained indefinitely. The optional owner-maintained usage_coverage ledger records complete/partial/off by day and instrumentation version. Missing ledger rows mean unknown coverage, even when counts exist; zero is measurable only for a day the owner has confirmed complete. Never infer exact unobserved drop counts, users, sessions, funnels, retention, geography or owner exclusion.

## Local validation

Use tools/Test-Web.ps1 from the linked checkout. Dependencies, emitted test bundles and local D1 state belong in the disposable DevCache workspace. Tests cover the real local D1 API, concurrent increments, batch rollback, strict rejection, opt-out, no retries and daylight-saving boundaries.

After building, run from the disposable usage-worker directory:

    node report.mjs --input synthetic-export.json --output C:\DevCache\path\usage-report
    node report.mjs --database maimai-usage-local --persist-to C:\DevCache\path\local-state --output C:\DevCache\path\usage-report

The second form issues exactly two read-only SELECTs through Wrangler. It defaults to local. The --remote flag must be explicitly supplied by the owner after production setup review. Optional --from/--to select completed New York dates; the default is 30 completed days. --activated records the owner-supplied activation date. Reports include JSON, Markdown and CSV; JSON/Markdown carry coverage and limitations; a companion `.coverage.csv` preserves activation, daily UTC boundaries, and unknown versus measured-zero days. Query failure is an error, never a zero report.

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

No account, database, route, schedule or credential is provisioned here. The all-zero database ID is a local placeholder and MUST NOT be deployed. The release checklist must record the actual D1 binding, quota/cost review, exact route, migrated schema, USAGE_ENABLED=true, client enabled state, disabled account-level beacon injection, and absence of request/payload logging in inherited invocation logs, traces, tail consumers and export sinks. Keep unrelated security logging unchanged.

This crosses the protected security boundary and needs the security-sensitive / privileged workflow.

Prepare a reviewed production config separately after the full SEO+coverage+usage candidate passes. Do not launch SEO alone or claim collection is active until the deployed browser, aggregate database and owner report are verified together with an approved non-personal canary. Use the independent kills for emergency degradation, then explicitly report the combined launch as degraded. Rollback restores the previous deployment and never deletes aggregate totals.

References: https://developers.cloudflare.com/d1/worker-api/d1-database/#batch
