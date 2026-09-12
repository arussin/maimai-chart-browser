# Public release of maimai.party

The owner requested this rollout on 12 September 2026, **after completion of
the active pattern-detection goal**. The target repository is the existing
`arussin/maimai-chart-browser`, which becomes public at release. The target
website is `https://maimai.party`. Report generation stays in its own repository.
This plan records authorized follow-on work; it does not claim deployment or
repository protection is already configured.

## 1. Finish and evaluate pattern detection

- Give each of the 36 dictionary entries an explicit, versioned recognition
  rule, required input capabilities, positive examples, and confusing negatives.
- Implement the missing recognizers and connect observations to exact chart IDs,
  difficulty, source hash, and occurrence timestamps. Never tag by song title.
- Evaluate held-out passages and inspect false positives and false negatives.
  Keep authored tests separate from independent evidence. Report limitations
  and unsupported cases; do not invent a review or turn unknown into absence.
- Build a new immutable catalog from retained inputs. Verify pattern filtering,
  dictionary song examples, chart details and comparison weighting together.
- Preserve the experimental labels until evidence supports changing them.

Recognition 0.2.0 now covers all 36 dictionary entries with versioned operational
rules, authored positive/negative checks, and a new mapping of all 6,959 retained
charts. Every type has matches; original input-detector results and Flow are
unchanged. See [the recognition report](patterns/RECOGNITION_0.2.0.md).

Independent held-out label accuracy and teaching sign-off remain pending. The
release must preserve experimental browsing and research qualifications; it must
not claim qualified community labels or personal recommendation mappings.

## 2. Publish the standalone code in reviewable units

Retain the existing extraction and attribution history. Do not create a second
copy of the analyzer or rewrite the interface. Organize changes in this order:

| Review unit | Contents | Completion evidence |
| --- | --- | --- |
| Engine and contracts | Parser, measurements, detector definitions, evaluation fixtures, recommendation preparation | Independent package install, analyzer/rating/ranking parity, detector evaluation |
| Browser | Catalog loading, patterns, comparison, Flow, search, artwork, links, personal-file import | Desktop/mobile/keyboard checks and no personal-data leakage |
| Corpus tooling | Acquisition, analysis, immutable manifests, reproducible provenance | Interrupted-write, integrity, repeat-run and rollback checks |
| Contributions and release controls | Contribution guide, code ownership, repository rules, isolated publication process | Fork contributions can test logic; only the owner can publish official data |
| Public launch | Hosting configuration, public repository transition, domain, footer and launch verification | Anonymous GitHub access and working HTTPS maimai.party |

Large retained downloads, raw chart corpus, personal snapshots, credentials,
local outputs and runtime caches stay out of Git and package distributions.
Review the full history and the exact public asset set before changing visibility.
Retain source/content qualifications and credits in the published site.

## 3. Public contributions; owner-controlled official corpus

Anyone can read the public engine, run it locally, file an issue, or propose a
pull request. Public code cannot prevent others from running their own copy.
**Only arussin may update the official corpus and its published latest pointer.**

Enforce that separation in the publishing credentials and repository settings:

- arussin remains the only maintainer with write/admin and publication access.
  Contributors use forks and pull requests; they do not receive corpus credentials.
- Protect the production branch against deletion and force-push. Require passing
  checks and owner review of outside contributions. Configure owner bypass only
  as needed for the sole maintainer's own changes; do not require self-approval.
- `.github/CODEOWNERS` requests arussin's review, including changes to itself,
  workflows, acquisition, manifests, analysis and deployment code. This file
  alone does not enforce access: verify the repository rules at rollout.
- Existing pull-request CI uses read-only permissions, hosted runners and
  synthetic fixtures. No production secrets, raw corpus or trusted writer runner
  are exposed to pull-request jobs. Never execute fork code in a privileged job.
- Corpus publication is a separate, explicit owner operation. It must not run
  on pull requests, ordinary pushes, automatic merges, or a public web endpoint.
  If implemented in Actions, require manual dispatch by arussin on the approved
  production branch, check both initiating and rerunning actor, and store writer
  credentials in a restricted publication environment. Verify the live settings.
- A normal website release consumes an already accepted catalog version; changing
  website or engine code does not implicitly refresh the official corpus.
- The writer publishes complete versioned assets first, verifies their hashes,
  and then updates the latest manifest. Keep earlier releases for stable links
  and rollback. Concurrent or failed updates cannot replace the accepted release.

These settings follow GitHub's [secure workflow guidance](https://docs.github.com/en/actions/reference/security/secure-use)
and [code-owner documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners).

## 4. Host the public browser

- Confirm access to the existing repository and domain/hosting account. Prepare
  the complete static deployment and owner-only release controls before enabling
  public access. Use scoped hosting credentials outside the site and source tree.
- Serve the real chart browser at the site's main entry point. Do not publish
  the fictional demo as the homepage. Preserve `/lab/` and existing versioned
  chart/pattern/comparison links through a tested compatibility route.
- Publish only the reviewed public build: catalogs, derived pattern/Flow data,
  browser assets and permitted artwork. Never deploy the entire local `output/`
  directory, raw acquisition cache, score snapshots or development server.
- Verify HTTPS, canonical domain behavior, cache refresh, old catalog links,
  missing/incompatible versions, mobile layout, personal import/clearing and
  analytics consent. Verify the real domain in GA Realtime using a consented visit.
- Confirm corpus updates fail for anyone other than arussin, and exercise rollback
  before declaring the deployment complete.

## 5. Make the repository public and finish the launch

After the preceding work is ready, change the existing repository to public and
verify it without authentication. Replace **GitHub (private)** with **GitHub** in
the shared footer at that transition; update README and attribution wording that
still describes the repository as private. Retain creator support and all credits.

Deliver the public repository link, working maimai.party link, current catalog
and engine revisions, and a short owner update/rollback guide. Existing reports,
retained inputs and the live history service remain unchanged; no backfill is
part of this release.
