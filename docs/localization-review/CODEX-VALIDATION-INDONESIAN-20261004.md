# Indonesian localization — local acceptance, 4 October 2026

The handed-off Indonesian implementation is finished and locally validated in
`C:\Dev\worktrees\maimai-card-history-20261004` on `codex/chart-card-history-refinement`. At the end of this local validation, HEAD was
`2731429fb4bd6e1f85d276978ca09bb8bee11683`; no commit, push, merge, account change or deployment had been performed.
This is the dated local acceptance record; subsequent PR and CI status is recorded on GitHub.

This follows [the original handoff](CODEX-HANDOFF-INDONESIAN-20261004.md); its
pending-state observations are historical. Source review remains AI authoring and
contextual self-review, not independent or native-speaker certification.

## Delivered behavior

- All 961 messages across 17 catalogs have Indonesian values. English keys,
  previous translations, placeholders and invariants are preserved. No Indonesian
  wording was changed after the handoff; the six concise defaults remain `Semua`.
- The fifth flag uses the pinned Indonesia asset and the accessible name
  `Bahasa Indonesia`. `id-ID` negotiation, saved preferences, denied storage,
  query/route precedence, reload and browser-state restoration are covered.
- Language remains separate from JP/International data preference, canonical
  song/chart identities, imported player records and multilingual search aliases.
  No Indonesian alias corpus was added.
- Current all-language matrices now include Indonesian. Explicit CJK one-line
  navigation checks, provider-specific language lists and historical visual
  baselines retain their narrower purpose.
- Header labels wrap at word boundaries. At 280px the five flags occupy their
  own row above the brand; regional availability labels fit without truncation.
  App navigation spacing leaves static language-link layouts unchanged.
  Support uses five controls in its compact header.
- README, bundled import help, diagnostics, recovery, settings, privacy, lessons,
  comparison, imports, history, sources, Maishift and site-owned Support strings
  were checked. The embedded payment provider was a local test double.
- The source prose checker recognizes exact catalog translations within explicit
  locale tables while rejecting unregistered, unbound or wrong-locale text and
  translated literals in English UI binding slots.

## Generated files

Built with the maintained pinned web toolchain and promoted only declared outputs:

- `src/maimai_intelligence/assets/browser/browser-entry-NYJEP4KX.js`
- `src/maimai_intelligence/assets/browser/application-2A2C2365.js`
- `src/maimai_intelligence/assets/browser/browser-offline-GV2BVUS7.js`
- `src/maimai_intelligence/assets/browser-assets.json`
- `src/maimai_intelligence/assets/localization.js`
- `src/maimai_intelligence/assets/chart-overview.js`
- `web/generated-assets.json`

The prior `browser-entry-NKHEMMEC.js`, `application-HQLV3THK.js` and
`browser-offline-6Y6CUW36.js` chunks were removed only after checking their old
manifest hashes. Both current manifests and generated consistency checks pass.
Full promotion hashes are in `generated-promotion.json` in the evidence directory.

## Validation actually run

All commands used the maintained project environment and disposable DevCache
copies, with current edited and untracked source. The final test copy was byte-bound
to all 848 source files; it was not edited in place.
Its only differences from the complete product-validation copy are the readiness
helpers in `standalone.spec.js` and `share-site.spec.js`. All other source bytes
are identical. The follow-up reused hash-verified fixtures from that unchanged
product, and reran both complete affected files in every applicable project.

| Command | Result |
| --- | --- |
| `tools/Test-Development.ps1 -Check prepare -Offline` | Build preparation passed and explicitly closed |
| `npm ci --offline --no-audit --no-fund` in `web` | Pinned dependencies installed |
| `npm run build`, `npm run check`, `npm test` in `web` | Generation, TypeScript, formatting and consistency passed; 138 tests passed |
| `tools/Test-Web.ps1 -Offline` after promotion, then again on the final product source | Passed; 138 web tests and 22 usage-worker tests |
| `python -B -m ruff check --no-cache .` | Passed |
| `python -B -m ruff format --no-cache --check .` | Passed |
| `python -B scripts/check_localization.py` | All 961 messages validated |
| `python -B scripts/check_localization_review.py` | Review fingerprints current |
| `python -B scripts/prepare_multilingual_search.py --registry registry --output src/maimai_intelligence/assets/song-localizations.json --check` | Passed; alias corpus unchanged |
| `python -B scripts/run_offline_tests.py` | 954 tests run; zero failures, seven Windows symlink skips; zero non-loopback attempts |
| `python -B scripts/check_corpus_boundaries.py` | 255 tests passed; type checks passed for 39 source files; checked branch coverage complete |
| `python -B tests/browser/prepare.py` | Final fixtures built |
| `python -B scripts/build_maishift_pilot.py --output <browser-output>/maishift-pilot` | Pilot fixtures built |
| `npm ci --offline --ignore-scripts --no-audit --no-fund` in `tests/browser` | Pinned dependencies installed |
| `node --test scripts/localization_literals.test.mjs` | Five scanner regressions passed |
| `node scripts/localization_sources.mjs .` | No unclassified shipped UI prose |
| Targeted `npm test` selection recorded in `browser-final-repaired-focus.json` | All 83 repaired-layout, accessibility, popup, static-style and search-network checks passed |
| `npm test -- --grep-invert="7000-chart startup and interactions" --max-failures=12 --trace=off --reporter=line,json --output <workspace>/output/test-results-final-broad` | 2087 passed; 5 intentional project-specific skips; five readiness failures subsequently repaired and rerun |
| `npm test -- standalone.spec.js share-site.spec.js --project=desktop --project=mobile --project=narrow --project=webkit-comparison --trace=off --max-failures=5 --reporter=line,json` | All 241 cases passed; zero failures or flaky tests |
| `npm test -- performance.spec.js --project=desktop --workers=1 --reporter=line,json --output <workspace>/output/test-results-final-performance` | 2 isolated performance tests passed |
| `node <evidence>/review-surfaces.mjs` | 84 states passed: three engines × four widths × seven surfaces |
| `python -B <evidence>/prepare-release-review.py` | Production inventory and offline release delta verified |
| `node <evidence>/check-candidate.mjs` | Actual baseline-plus-delta candidate passed loopback-only Chromium smoke at 280px and 320px, including all five availability languages/states |
| `git diff --check` and final source/hash comparison | Passed |

Combined coverage is **2,094 distinct passing browser cases and
5 intentional skips**, with no unresolved failures. This is
the complete broad run plus replacement results for both changed test files and
the isolated performance checks, not one all-green invocation. The reconciliation
in `combined-browser-coverage.json` requires every affected case to appear in the
follow-up and preserves all five earlier failure records.

`MAIMAI_METRICS_WEB_RUNTIME` pointed to the final pinned web runtime, so its three
optional source-metric tests ran. The seven remaining Python skips require Windows
symbolic-link creation unavailable to this runtime; no privilege changes were made.

Browser projects covered Chromium desktop/mobile/narrow, installed Chrome and
Edge, Firefox, WebKit desktop and iPhone emulation. Focused headers exercised
280, 320, 360, 390, 420, 768 and 1280px; all five locales preserve search and chart
identity at those widths. Support exercised 280, 320, 360, 390, 420 and 1280px in
default and Verdana fonts. Additional Indonesian settings, analytics, privacy,
patterns, lessons, comparison and import captures cover 280, 320, 390 and 1280px
in Chromium, Firefox and WebKit. Selected screenshots were visually inspected.

The initial focused run passed 56 of 57 checks; a new assertion incorrectly
expected the branded Support heading's accessible label as visible text. The
assertion was corrected and is covered by the final full suite. Six initial Python
failures were stale four-locale counts or inventory snapshots. The old snapshots
were reproduced exactly before reviewing the added Indonesian route/link delta.

The first completed broad run stopped at its 12-failure limit: 1,807 cases passed,
five skipped, two were interrupted and 271 did not run. It exposed two localized
layout defects (280px availability labels and app-only nav spacing affecting static
pages), which were fixed. Test setups were also corrected to select a supported
locale before opening WeChat, wait for the filter fade before measuring contrast,
prime lazy public artwork before auditing search requests, and finish intercepted
resource responses before context teardown. No accessibility or network assertions
were removed. All remaining cases are included in the final complete run.

That complete run exposed four further lazy-artwork races in two standalone tests
and one WebKit keyboard setup race. The request observers now start after public
fixture artwork has decoded. The share helper waits for its client-created dialog,
which is attached after the settings keyboard handler is installed, rather than
only waiting for the server-rendered trigger. The unchanged WebKit case also passed
10 isolated diagnostic repetitions. Both entire affected files were then rerun on
the final helper source. The first follow-up passed 240 cases and exposed one more
artwork geometry race: `boundingBox()` returned null before the row became visible.
That test now waits for visibility and polls its original positional requirement;
it still observes all requests from navigation onward. Its failed preparation and
report are preserved under `followup-attempt-1` and the matching verified archive.
The final 241-case follow-up passed. Product code and the reviewed release delta
did not change.

An initial broad browser run was interrupted to bound its temporary trace storage.
Its evidence is preserved separately. The final complete run used tracing disabled;
test assertions and enforced network isolation remained enabled. No results from
the interrupted run are counted in the final pass total.

## SEO and release evidence

The maintained planner produced Indonesian pages for **1,694 songs and 28
versions**. `sitemap-id.xml` contains **1,722 unique, existing routes**. The root
sitemap includes all five locale sitemaps and `sitemap-pages.xml`.

Every one of the **8,610 localized song/version pages** was checked for its
matching HTML language and canonical URL, five reciprocal locale alternates and
English `x-default`. Indonesian pages include their native language link and
Indonesian initial copy. Real-browser tests also cover enhancement, return
navigation, locale switching, JS-disabled content and regional preference.

The actual retained baseline plus delta was also served through a read-only local
overlay. Chromium loaded `/id/songs/ケロ9destiny-a918f4a43945/`,
`/id/versions/maimai-71c5d44dd7d2/`, and the Indonesian main catalog at 320px,
switched both routes to English and back, and reported no application errors or
unexpected external requests. The temporary server was stopped after verification.

The candidate inventory retains all prior immutable files and has **34,292 files**
and **1,664,366,180 bytes**. Catalog/media resources, the public manifest, feature
configuration and analytics configuration were verified unchanged against the
retained production baseline. The delta changes 8,633 files and adds 1,732 files.

This fits the existing reviewed **100,000-file** capacity profile. It exceeds the
default **20,000-file** guard, which remains unchanged. The reused capacity receipt
expires at **2026-10-05 13:35:26 UTC**; an actual publication must use then-current
capacity evidence and the normal release gate. No account entitlement was queried
or changed, and this local review does not authorize publication.
Under the worktree's 20,000-file release rule, this is an over-capacity review
bundle, not authorization to bypass the publication guard. The normal release
process must reconcile the reviewed capacity profile with its current gate.

The retained artifact is a verified baseline plus delta, not a duplicate expanded
corpus. The baseline is the previously retained `card-history-35d330f-20261004/public`.
The delta ZIP has SHA-256
`b6a53fdc1b9040171df2ac13f3cf0b9f1124b8f8d7f453d1aee077dd46fbfd56`.
The complete candidate inventory digest is
`b855215fb2d8ac44875c44d4e40906d217326cd7545ff2b60c9529fd67dc3500`.

## Retained evidence and deferred work

Evidence directory: `C:\Dev\maimai\investigations\indonesian-20261004`.

Key records: `FINAL-RESULT.json`, `final-source-binding.json`, `followup-source-binding.json`,
`final-source.zip`, `final-browser-evidence.zip`, `final-preservation.json`,
`browser-final-broad.json`, `browser-final-followup.json`, `combined-browser-coverage.json`,
`browser-final-performance.json`, `surface-review.json`,
`candidate-smoke.json`,
`release-review.json`, `release-inventory.json.gz`, `indonesian-release-delta.zip`,
`release-artifact-preservation.json`, `generated-promotion.json`,
`catalog-preservation.json`, `recovery-fixture-review.json`, and `final-checks/`.
The controls beside those records contain the exact environment and command lines.

Native-speaker review is optional and has not been performed. Hosted CI, an actual
Stripe provider form, production indexing and deployment are not claimed. Normal
publication remains a separate explicitly authorized step. No release guard,
automation hold, protected resource or permissions policy was changed.
