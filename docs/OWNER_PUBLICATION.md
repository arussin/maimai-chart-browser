# Owner publication and rollback

The official site is a static Cloudflare Pages Direct Upload project named
`maimai-party`, with `main` as its production branch and `maimai.party` as its
custom domain. These are intended settings, not a claim that deployment exists.
On 12 September 2026 the connected Cloudflare API could read the active domain,
but rejected project creation with authentication error 10000. GitHub returned
404 for the private `arussin/maimai-chart-browser` repository. Resolve those
access issues before completing the public launch.

## Ownership boundary

Only arussin should hold hosting write permission and official corpus publication
credentials. Keep those credentials in the owner's local authentication store,
outside this repository and all site assets. Review Cloudflare account members
and tokens before launch. The public repository's tests use synthetic data and
read-only permissions; they have no automatic hosting job or corpus writer.
Forks and pull requests can propose engine improvements without publishing data.
The website itself has no server, upload endpoint or catalog-update endpoint.

Do not enable Git integration, deploy hooks, or automatic publication from pull
requests. Direct Upload deliberately separates code contributions from official
catalog updates. Public source allows anyone to run their own copy; owner-only
publication controls the official site, not other people's independent copies.

## Prepare the reviewed assets

Install this package and run these commands from the checkout. Replace the
example accepted package/version with the explicitly reviewed release when
updating the corpus. An ordinary interface release reuses the accepted package.

```text
maimai-chart lab --package output/challenge-patterns-v2 --output output/site/lab --catalog-version research-8295bb80a71d
maimai-chart public-release --source output/site/lab --output output/public-release-20260912
```

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

The current build contains 1,475 files, seven catalog versions and at most 8 MiB
per file. Use Wrangler rather than the dashboard uploader, whose 1,000-file
limit is too small. Cloudflare documents [Direct Upload and its limits](https://developers.cloudflare.com/pages/get-started/direct-upload/).

## Publish after owner access is available

Use current Wrangler 4 from the official npm registry, authenticated as the
owner. Confirm the selected Cloudflare account and project before sending files.
The initial creation command is needed only if the project does not already exist.
These commands publish only the named prepared directory; they do not download,
import game data, recalculate the corpus, or touch report history.

```text
npx wrangler@4 whoami
npx wrangler@4 pages project create maimai-party --production-branch main
npx wrangler@4 pages deploy output/public-release-20260912 --project-name maimai-party --branch main
```

Record the deployment ID, immutable preview URL, source commit, catalog version,
and public manifest checksum outside the site assets. First verify the returned
Pages URL. Then add `maimai.party` in the project's Custom domains settings and
verify DNS, certificate issuance and HTTPS. Configure `www` only after its domain
association is ready; a canonical redirect should retain paths and query strings.
See [Cloudflare custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/).

After source history review and repository access are complete, push the retained
attribution history, set the repository public, verify anonymous access, enforce
the owner/branch rules in [PUBLIC_RELEASE.md](PUBLIC_RELEASE.md), and remove the
private footer label. Rebuild the interface and public release after that change.
Do not change an existing catalog's contents under the same version ID.

Before declaring launch complete, check the root page, an older catalog, chart
and comparison links, pattern discovery, mobile/keyboard use, invalid versions,
consent settings and a consented GA Realtime visit on the actual HTTPS domain.
Do not send search terms, chart IDs or personal content to analytics.

## Rollback

Retain the prior complete deployment and its recorded ID. In Pages deployment
history, choose that successful production deployment and Rollback. Verify the
homepage's default version and a deep link afterward. Do not delete older
deployments or mutate catalog files to perform rollback. The local equivalent
is to serve the previous complete release directory.

Live rollback, repository rules and account-member checks remain launch checks;
they have not been exercised while deployment access is unavailable.

Existing reports, archived inputs, personal snapshots and the live history
service remain unchanged. This release requires no historical backfill.
