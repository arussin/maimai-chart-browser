# Owner publication and rollback

For catalog and mai-notes updates, use the [owner-run catalog workflow](CATALOG_UPDATES.md).
It joins the source, metadata, analysis, link preparation, change report and
verified Direct Upload stages. Ordinary interface-only releases can still reuse
the accepted package with the commands below.

The official site is a static Cloudflare Pages Direct Upload project named
`maimai-party`, with `main` as its production branch and `maimai.party` as its
custom domain. The site launched on 12 September 2026 at
[maimai.party](https://maimai.party). The public repository's `main` branch now
contains the complete browser, engine, tooling, tests and retained attribution
history, merged through [pull request #1](https://github.com/arussin/maimai-chart-browser/pull/1).

## Verified launch

- Source: `4447e819d6c35fd56e58644aa98db4b406f58c53` (merge commit; same
  application tree as checked head `1c346d37de660435541ff24315329b1d070bd105`).
- Production: `1b2ba178-955b-408f-8094-83dc9d1e0432`, also available at
  [its immutable deployment address](https://1b2ba178.maimai-party.pages.dev).
- Previous production: `ef3de3bc-c7b1-46fb-8a55-33893684ecf9`. Both deployments
  contain identical public assets. Live rollback to the previous deployment and
  restoration of the merged-main deployment succeeded; the comparison deep link
  still loaded afterward.
- Catalog: `research-8295bb80a71d`; engine and package: `0.2.0`.
  Public manifest SHA-256:
  `31729b74adc20497596f74d2fdbcfac423ee4e749a46c5e174aa6f004a681c6e`.
- Required CI passed on Linux Python 3.11/3.13 and Windows Python 3.13.
  The browser job passed 156 checks, with three optional skips. The local Python
  suite ran 405 tests, with seven optional skips.
- Live checks covered catalog loading, romaji search, difficulty selection,
  exact-chart pattern occurrences, Flow, similarity, two-chart comparison,
  keyboard focus, and an older catalog through the `/lab/` compatibility link.
  HTTP navigation reached HTTPS with the version and view preserved. Responsive
  layouts, imports/clearing, incompatible files and privacy behavior also passed CI.
- GA4 Realtime received the consented visit and showed only the expected broad
  page titles: Charts, Pattern dictionary and Compare charts. The public footer
  links to GitHub without a private label and retains creator support and credits.

Pattern recognition remains experimental. Independent held-out accuracy and
teaching review are still pending; this release does not qualify research chart
identities for personal recommendations.

## Ownership boundary

Only arussin should hold hosting write permission and official corpus publication
credentials. Keep those credentials in the owner's local authentication store,
outside this repository and all site assets. The launch account-member check
found only the owner's accepted Super Administrator membership, and GitHub listed
arussin as the sole collaborator. The public repository's tests use synthetic data and
read-only permissions; they have no automatic hosting job or corpus writer.
Forks and pull requests can propose engine improvements without publishing data.
The website itself has no server, upload endpoint or catalog-update endpoint.

Do not enable Git integration, deploy hooks, or automatic publication from pull
requests. Direct Upload deliberately separates code contributions from official
catalog updates. Public source allows anyone to run their own copy; owner-only
publication controls the official site, not other people's independent copies.

Two active GitHub rulesets protect `main`: **Production history and required
checks** prevents deletion and force-push and requires all four CI jobs, with no
bypass; **Owner-controlled production updates** restricts updates to arussin and
requires owner review for outside contributions. Only arussin has an exception
for the sole maintainer's own review requirement. That exception does not waive
the separate test and history protections.

## Prepare the reviewed assets

Install this package and run these commands from the checkout. Replace the
example accepted package/version with the explicitly reviewed release when
updating the corpus. An ordinary interface release reuses the accepted package.

```text
maimai-chart lab --package output/challenge-constants-v1 --output output/site/lab --catalog-version research-9fed7bd21e1f
maimai-chart public-release --source output/site/lab --output output/public-release-next
```

The current package restores the retained decimal chart constants; see
[chart constant preparation](CHART_CONSTANTS.md). Existing analysis is preserved.

Choose a fresh destination for every build. Existing nonempty outputs are refused.
The builder validates all input hashes before writing and writes the manifest
last. If a write fails, keep the previous complete release and use a new directory
on retry. Never upload a directory whose build failed.

Only the browser interface, accepted catalog versions and declared artwork are
copied. Personal exports, raw responses, source caches, and the fictional demo
are excluded. Catalogs are divided into pieces of at most 8 MiB. Manifest 1.1
records each piece's checksum and size; the browser checks all pieces and the
original whole-catalog checksum before loading. Original version IDs, chart IDs
and data remain unchanged. Both old 1.0 and new 1.1 manifests are supported.
The `/lab/` compatibility page preserves query parameters and fragments while
redirecting to the real browser at `/`.

The builder checks Cloudflare Pages' limits before writing any release files:
no more than 20,000 files and no file larger than 25 MiB. Full catalogs retain
their original bytes in 8 MiB parts. The startup index omits duplicate regional
observation details while keeping every field needed by the data preference.
Use Wrangler rather than the dashboard uploader, whose 1,000-file limit is too
small for retained history. Cloudflare documents [Direct Upload and its limits](https://developers.cloudflare.com/pages/get-started/direct-upload/).

## Publish an update

Use Wrangler 4.131.1 from the official npm registry, authenticated as the
owner. Confirm the selected Cloudflare account and project before sending files.
The `maimai-party` project already exists; do not recreate it.
These commands publish only the named prepared directory; they do not download,
import game data, recalculate the corpus, or touch report history.

```text
npx wrangler@4.131.1 whoami
npx wrangler@4.131.1 pages deploy output/public-release-next --project-name maimai-party --branch main --commit-hash REVIEWED_MAIN_COMMIT
```

Record the deployment ID, immutable preview URL, source commit, catalog version,
and public manifest checksum outside the site assets. First verify the returned
Pages URL and the existing `maimai.party` custom domain, whose DNS and certificate
are active. The launch uses the apex domain; `www` is not configured. If adding
`www` later, establish its domain association before its DNS record and preserve
paths and queries in the canonical redirect.
See [Cloudflare custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/).

For source changes, open a short-lived branch and pull request, wait for required
checks, and merge into `main` with the original commits retained. The repository
is already public and was verified without authentication. Keep the rules in
[PUBLIC_RELEASE.md](PUBLIC_RELEASE.md) enforced. Rebuild the interface for an
interface release; never change a catalog's contents under an existing version ID.

For each release, check the root page, an older catalog, chart
and comparison links, pattern discovery, mobile/keyboard use, invalid versions,
consent settings and a consented GA Realtime visit on the actual HTTPS domain.
Do not send search terms, chart IDs or personal content to analytics.

## Rollback

Retain the prior complete deployment and its recorded ID. In Pages deployment
history, choose that successful production deployment and Rollback. Verify the
homepage's default version and a deep link afterward. Do not delete older
deployments or mutate catalog files to perform rollback. The local equivalent
is to serve the previous complete release directory.

This procedure was exercised at launch using the two production IDs above.
Cloudflare also permits restoring a newer successful production deployment after
a rollback; preview deployments are not rollback targets. See the
[Cloudflare rollback instructions](https://developers.cloudflare.com/pages/configuration/rollbacks/).

Existing reports, archived inputs, personal snapshots and the live history
service remain unchanged. This release requires no historical backfill.
