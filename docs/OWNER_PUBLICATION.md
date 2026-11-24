# Owner publication and rollback

## Current production

The [3 October 2026 release](PRODUCTION_RELEASE_20261003.md) records the current source, candidate and compatible recovery deployments, combined usage activation, sitemap submission and remaining verification limits. The launch record below is historical (12 September), not the current deployment. Reuse the sealed release files; never rerun a stopped release executor.

For catalog and mai-notes updates, use the [owner-run catalog workflow](CATALOG_UPDATES.md).
It joins the source, metadata, analysis, link preparation, change report and
verified Direct Upload stages. Ordinary interface-only releases can still reuse
the accepted package with the commands below.

## Release tools (since November 22, 2026)

Every release since November 22, 2026 has been assembled over the previous
release with these owner scripts, so that no published path disappears. They
were kept outside the repository at first and were added here on November 23.
None of them uploads, deploys, changes an account or deletes anything, and each
refuses to write into an existing folder. Run them with `python -B` and
`PYTHONPATH=<repo>/src;<repo>`.

- `scripts/prepare_interface_release.py` assembles an interface-only release.
  It takes the previous release folder (`public`, `planner-input`,
  `inventory.json.gz`), a clean checkout at the commit being released and a
  hosting check. A changed `_headers` needs `--allow-headers-change`; a changed
  sitemap needs `--release-date YYYY-MM-DD`. Authored shell templates must be
  unchanged since the previous release. `--allow-invitation-change` permits only
  replacement of `support.invitation` text, recording the exact old/new text in
  `planner_refresh.invitation_change`; payment, feature and other configuration
  changes still fail, even with this flag.
- `scripts/prepare_data_release.py` assembles a catalog release from a ready
  `update_catalog prepare` run. It verifies a re-plan with export artwork and
  the Web Analytics allowance (also accepting older runs missing those options),
  overlays the previous release to retain all published paths, and writes the
  `planner-input` the next interface release starts from. The current pipeline
  carries artwork and the allowance but still omits unreferenced historical
  paths; this tool remains necessary. It does not bypass readiness/source checks.
- `scripts/retain_release_state.py` writes one archive of a published release
  folder, and any extra folders, for keeping outside the build cache. Run it
  after every release; the next one cannot be built without the previous
  `public` tree and `planner-input`.
- `scripts/write_capacity_review.py` and
  `scripts/write_reconciliation_review.py` write the capacity review and the
  new-song reconciliation review that `update_catalog` requires. The second
  stops when a new official song might match an existing one; that decision
  stays with a person.

The hosting check is a small JSON file with schema `maimai-hosting-check-1`,
read from the Cloudflare API no more than an hour before preparation:
`observed_at`, `project` (`maimai-party`), `source` (`direct-upload`),
`zone_plan`, `pages_wrangler_major_version` and `production_deployment`. The
tools stop unless production is the release the candidate is built on and the
live `manifest.json` matches the base release byte for byte.

After preparation, upload `public` as a preview with the reviewed Wrangler,
check it, and publish to production only with the owner's approval. Record the
deployment in `deployment.json` beside `preparation.json`.

### Offline release driver

Use `python -B -m scripts.release_driver` with `PYTHONPATH=<source>/src;<source>`.
The driver never runs Wrangler, reads authentication stores or contacts hosting.
It calls the existing prepare tool, verifies the result, and records explicit
owner-supplied upload/check results. Uploaded deployment ids and check results
are assertions from the operator, not independent network verification.

Start with a JSON specification outside the checkout, using absolute paths:

```json
{
  "kind": "interface",
  "source": "C:/Dev/maimai/maimai-chart-browser-registry",
  "expected_commit": "FULL_40_CHARACTER_COMMIT_SHA",
  "base_commit": "FULL_40_CHARACTER_BASE_COMMIT_SHA",
  "base_release": "C:/DevCache/projects/maimai-chart-browser-registry/CACHE/releases/BASE",
  "base_deployment": "FULL_BASE_DEPLOYMENT_UUID",
  "release": "C:/DevCache/projects/maimai-chart-browser-registry/CACHE/releases/NEW",
  "hosting_check": "C:/DevCache/REVIEW/hosting.json",
  "observed_manifest": "C:/DevCache/REVIEW/live-manifest.json",
  "node": "C:/DevTools/REVIEWED/node.exe",
  "wrangler": "C:/DevTools/REVIEWED/wrangler/bin/wrangler.js",
  "wrangler_sha256": "REVIEWED_WRANGLER_ENTRYPOINT_SHA256",
  "preview_branch": "review-release",
  "release_date": "2026-11-23",
  "allow_headers_change": false,
  "allow_invitation_change": false
}
```

For a catalog release set `kind` to `catalog`, replace `base_commit` and the
interface-only date/opt-in fields with `run` (ready update run folder) and
`export_artwork_source`. Interface releases may also specify export artwork.
The source must be clean and exactly at the full commit, with Git line endings;
the imported library must come from that source. The release must not exist and
its parent must exist. Unknown specification fields fail rather than being ignored.

The hosting JSON retains the existing one-hour check, paid-plan profile and base
deployment binding. For offline preparation it additionally needs
`live_manifest_sha256`, the SHA-256 of the separately saved live manifest from
that same observation. The saved bytes must match the base release. Do not copy
the base manifest and describe it as a fresh live observation. Direct prepare
tools accept `--observed-manifest` for the same offline path; omitting it retains
their existing live read. Receipts distinguish saved observations from live reads.

```text
python -B -m scripts.release_driver prepare --spec SPEC.json
python -B -m scripts.release_driver status --release RELEASE
python -B -m scripts.release_driver upload-command --release RELEASE --stage preview
```

Preparation prints changed/added files and pages, the headers diff and previous/
candidate sitemap dates, and retains `review-summary.json`. Inspect that summary.
`upload-command` prints a PowerShell command using the explicit local Node and
reviewed Wrangler, fixed project `maimai-party`, the preview branch and source
commit. Run that command separately only when authorized; the driver never
executes it. No `npx`, installation or implicit uploader discovery is used.

After uploading and checking the preview, supply a checks JSON:

```json
{
  "passed": true,
  "manifest_sha256": "SHA256_OF_VERIFIED_DEPLOYMENT_MANIFEST",
  "checks": {
    "headers": "Describe the observed headers",
    "browser": "Describe the tested pages and results"
  }
}
```

```text
python -B -m scripts.release_driver record --release RELEASE --stage preview --deployment-id UUID --checks preview-checks.json --ran-at 2026-11-23T12:00:00Z --released-by OPERATOR
```

The preview receipt records the exact command, id, operator-supplied upload time
and checks. Recording twice is refused. Once Adam approves the checked preview,
write an approval JSON with `approved: true`, `approved_by: "Adam"`, `approved_at`
(with timezone), `evidence` (his actual instruction), `preparation_sha256` (from
`driver.json`) and `preview_deployment` (the full checked preview UUID). This
records existing approval; it is not a new confirmation phrase or a substitute
for approval. Production commands are gated on that bound approval and preview.

```text
python -B -m scripts.release_driver upload-command --release RELEASE --stage production --approval approval.json
python -B -m scripts.release_driver record --release RELEASE --stage production --deployment-id UUID --checks production-checks.json --ran-at 2026-11-23T13:00:00Z --released-by OPERATOR
python -B -m scripts.release_driver retain --release RELEASE --target ARCHIVE.zip --root CACHE_ROOT
python -B -m scripts.release_driver status --release RELEASE
```

Production checks additionally require `live_manifest_sha256`, matching the
prepared manifest after checking the custom domain. `record` writes the existing
`maimai-release-deployment-1` shape, including source, site, changes, before/after
checks and rollback base. It refuses production before approval. It does not
claim to update the catalog store's `latest.json` or Worker deployments.

Every subsequent operation verifies the entire public inventory and bound
preparation/summary. Node and Wrangler entrypoint hashes are checked before
printing or recording commands. Keep the reviewed Wrangler installation and its
dependencies unchanged. `retain` invokes the existing archiver with the release
and, for catalog releases, the retained run inputs/receipts excluding its redundant
`public` tree and disposable caches. It rejects missing inputs, archive overwrite,
or an archive inside its own inputs. The archive's hash is checked and recorded;
`status` checks it again. Retention is a local archive check, not backup recovery
acceptance. Status leaves the production record and `WORKSPACE-RETENTION.md`
updates as an explicit final owner gate; it never silently marks them done.

To automate hosting observations later, a separately authorized broker/connector
would need to return the plan, Pages upload setting, production deployment and
timestamp through an existing authenticated read-only interface, plus fetch and
hash the public manifest in the same observation. The driver would consume only
that non-secret output. This change implements no broker, token access or
authentication-store reader. Fresh hosting evidence and approval remain necessary
at the actual upload; this offline driver cannot prevent someone running a printed
command later against changed hosting state.

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

A larger composition is permitted only through the existing owner-reviewed
capacity interface, after actual entitlement, price and the supported upload
method are verified. `read_capacity_review(path, reviewed_sha256)` binds all three
evidence files and rejects reviews older than 24 hours or dated in the future.
The fixed reviewed profile permits up to 100,000 files; the per-file limit remains
25 MiB. A numeric override cannot opt into that profile. Review evidence and
fictional test fixtures are never publication authorization.

Pass the returned review to `plan_release_composition` as capacity, together
with an explicit aware `capacity_checked_at` from the caller's clock. Pass that
same review to `assemble_release(capacity=...)`. The pure planner detaches and
binds the complete authority; the assembly adapter rejects another review,
rechecks freshness before writing and before its private completion receipt.
The completion records the selected profile and evidence digests. Omit the
review for the unchanged 20,000-file default. Optional numeric limits can only
tighten the selected profile. A deliberately nondeployable review bundle remains
the correct output while owner evidence is unavailable; never use test approvals
to turn one into a release.

## Publish an update

Use the reviewed local Wrangler installation matching the repository lockfile
(4.135.0 for this candidate), authenticated through the existing owner workflow.
Record its package integrity and entry-point path in the capacity evidence;
do not implicitly install a different uploader during publication.
Confirm the selected Cloudflare account and project before sending files.
The `maimai-party` project already exists; do not recreate it.
These commands publish only the named prepared directory; they do not download,
import game data, recalculate the corpus, or touch report history.

```text
node REVIEWED_WRANGLER_ENTRY whoami
node REVIEWED_WRANGLER_ENTRY pages deploy REVIEWED_PUBLIC_DIRECTORY --project-name maimai-party --branch main --commit-hash REVIEWED_MAIN_COMMIT
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
