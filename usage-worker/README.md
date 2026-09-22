# Daily product counts

This local candidate replaces the public Cloudflare Web Analytics browser beacon. Existing opt-in Google Analytics stays separate. It is not a deployed collector.

The Worker accepts only POST https://maimai.party/__usage with the production Origin and exact application/json type. The contract is web/src/usage-contract.ts: at most 16 rows, 4 KiB, count 1–100 and known event/page/detail/failure combinations. Unknown fields reject the whole batch. D1 receives only reconstructed daily totals; no individual event table, IP or hash, identity, URL, referrer, query/search/filter value, chart identity, player data, raw error or client timestamp is stored. USAGE_ENABLED=false is the independent server-write kill. window.maimaiUsageEnabled=false (set before startup) or maimaiUsage.disable() suppresses client requests. GPC and DNT suppress both. Network failures drop data and never retry.

Days use America/New_York. Totals are retained indefinitely. The optional owner-maintained usage_coverage ledger records complete/partial/off by day and instrumentation version. Missing ledger rows mean unknown coverage, even when counts exist; zero is measurable only for a day the owner has confirmed complete. Never infer exact unobserved drop counts, users, sessions, funnels, retention, geography or owner exclusion.

## Local validation

Use tools/Test-Web.ps1 from the linked checkout. Dependencies, emitted test bundles and local D1 state belong in the disposable DevCache workspace. Tests cover the real local D1 API, concurrent increments, batch rollback, strict rejection, opt-out, no retries and daylight-saving boundaries.

After building, run from the disposable usage-worker directory:

    node report.mjs --input synthetic-export.json --output C:\DevCache\path\usage-report
    node report.mjs --database maimai-usage-local --persist-to C:\DevCache\path\local-state --output C:\DevCache\path\usage-report

The second form issues exactly two read-only SELECTs through Wrangler. It defaults to local. The --remote flag must be explicitly supplied by the owner after production setup review. Optional --from/--to select completed New York dates; the default is 30 completed days. --activated records the owner-supplied activation date. Reports include JSON, Markdown and CSV; JSON/Markdown carry coverage and limitations; a companion `.coverage.csv` preserves activation, daily UTC boundaries, and unknown versus measured-zero days. Query failure is an error, never a zero report.

## Coordinated activation

No account, database, route, schedule or credential is provisioned here. The all-zero database ID is a local placeholder and MUST NOT be deployed. The release checklist must record the actual D1 binding, quota/cost review, exact route, migrated schema, USAGE_ENABLED=true, client enabled state, disabled account-level beacon injection, and absence of request/payload logging in inherited invocation logs, traces, tail consumers and export sinks. Keep unrelated security logging unchanged.

This crosses the protected security boundary and needs the security-sensitive / privileged workflow.

Prepare a reviewed production config separately after the full SEO+coverage+usage candidate passes. Do not launch SEO alone or claim collection is active until the deployed browser, aggregate database and owner report are verified together with an approved non-personal canary. Use the independent kills for emergency degradation, then explicitly report the combined launch as degraded. Rollback restores the previous deployment and never deletes aggregate totals.

References: https://developers.cloudflare.com/d1/worker-api/d1-database/#batch
