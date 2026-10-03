# Private hosted usage dashboard

This Worker serves only `https://adamrussin.com/maimai-dash` and its trailing-slash variant. Each authenticated GET reads the latest two aggregate tables and renders the existing dashboard. The page makes no background API requests; its refresh button reloads the document and therefore queries fresh data.

## Access boundary

Deploying this changes a protected access boundary and requires the owner security-sensitive workflow. Prepare the reviewed bundle first. Before attaching routes, create a separate self-hosted Access application for `adamrussin.com/maimai-dash`, hidden from the launcher, with only the owner's exact email allow policy. Do not inherit the broader `/maimai*` application's bypass policy or change that existing application.

The Worker independently verifies the Access JWT signature, RS256 algorithm, issuer, application audience, expiry/issue time, subject and exact owner email. Missing configuration, missing/forged/expired tokens, a different audience, and another identity all fail closed before a D1 query. There are no service tokens or new standing agent credentials. Agent access uses the owner's authorized browser session.

Required bindings are `ACCESS_ISSUER`, `ACCESS_AUD`, `OWNER_EMAIL` and `USAGE_DB`. Keep actual owner configuration outside Git. The D1 binding is a database capability; it is not database-enforced read-only. This reviewed Worker exposes only two fixed SELECT statements, no write endpoint, arbitrary SQL, CORS endpoint or public asset route.

Keep workers.dev, preview URLs, invocation/request logs, observability, logpush and tail consumers disabled. Responses, including errors, use no-store/noindex, a restrictive CSP and anti-framing headers. Do not add the path to the public navigation or sitemap.

## Local verification and build

Use a small current-source snapshot with dependencies and output in DevCache. Do not install dependencies under Dev. Node 24 is required.

```sh
npm ci --prefix usage-worker/dashboard-hosted --ignore-scripts --no-audit --no-fund
npm test --prefix usage-worker/dashboard-hosted
node usage-worker/dashboard-hosted/build.mjs --output /absolute/path/outside-source/worker.mjs
```

The build uses the reviewed `web/node_modules/esbuild` installation. A separate existing installation can be selected with `MAIMAI_ESBUILD_MODULE`; the release review must record its version and source hashes. No deployment command runs during build/test.

Before production acceptance, verify signed-out and forged-token denial, the owner view, fresh data on reload, query-failure handling, both path forms, no-store/noindex headers, disabled alternate endpoints/logging and preservation of the existing website and Session Report routes. Restore only the newly introduced route/Worker changes if acceptance fails; do not overwrite unrelated Access or routing state.

## What the report measures

The maintained finite contract reports daily received page-type views, filter-type first-use counts, search use, chart/detail expansion, comparison/similar requests, import methods/outcomes/failure categories, sharing destinations/results, resource links and data controls. First filter use is deduplicated by filter type within one page's in-memory collector lifetime.

It does not retain selected filter values, search text, individual song/chart URLs or IDs, people, sessions, sequential click paths, funnels, IPs or referrers. Opt-outs and dropped batches are not measurable. An empty row set is not proof of no activity. Coverage remains explicitly owner-maintained; today's data is incomplete.
