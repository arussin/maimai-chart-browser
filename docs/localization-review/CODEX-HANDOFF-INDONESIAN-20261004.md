# Codex handoff — add Indonesian to maimai.party

Date: 2026-10-04
Owner request: finish Indonesian as a first-class supported language for maimai.party and prepare it for normal release.
Status at handoff: source implementation is substantially complete; generated assets, five-language regression coverage, maintained build/test validation, and release verification remain.

## 1. Work only in the existing project/worktree

Canonical project:
C:\Dev\maimai\maimai-chart-browser-registry

Continue the already-started implementation in:
C:\Dev\worktrees\maimai-card-history-20261004

Branch recorded when the work began:
codex/chart-card-history-refinement

Initial HEAD recorded before the Indonesian edits:
2731429fb4bd6e1f85d276978ca09bb8bee11683

Do not create a parallel/shadow checkout. Preserve all unrelated work, Git state, retained output snapshots, migration/recovery material, and existing holds. Read and follow:
- C:\Dev\AGENTS.md
- C:\Dev\general\development-layout-plan\MIGRATION-REGISTER.md
- C:\Dev\maimai\AGENTS.md
- C:\Dev\maimai\maimai-chart-browser-registry\AGENTS.md
- C:\Dev\maimai\WORKSPACE-RETENTION.md
- this worktree's DEVELOPMENT.md

Use the maintained DevCache workflow from DEVELOPMENT.md. Do not install dependencies into Dev, do not use a shared global Python environment, and do not copy disposable workspaces back wholesale.

## 2. User-visible goal

Indonesian must behave exactly like the existing English, Simplified Chinese, Korean, and Japanese UI languages wherever language support is intended:
- language button with Indonesia flag
- displayed language name: Bahasa Indonesia
- locale code: id
- browser negotiation including id-ID
- saved language preference
- query-language handling
- browser-state restore
- /id/songs/... and /id/versions/... public routes
- localized SEO copy
- canonical/hreflang metadata
- Indonesian sitemap
- localized diagnostics and recovery paths
- README and bundled player-import help
- accessibility strings
- narrow/mobile layouts
- Support/payment-site-owned strings
- existing feature surfaces that use the shared translation catalog

Language remains independent from JP/International game-data preference.

Do NOT create an Indonesian song-title/artist alias corpus as part of this task. Indonesian uses Latin script and this is not required for first-class UI localization. Preserve existing multilingual-search logic for Japanese/Korean/Chinese aliases.

## 3. Source work already completed

### Translation catalogs

All 961 current UI messages across 17 message catalogs have Indonesian values. The 18th locale JSON, invariants.json, contains no messages and remains unchanged.

The implementation record verified:
- English keys preserved
- Japanese/Korean/Simplified Chinese values preserved
- placeholders preserved
- existing invariants preserved
- Indonesian values nonempty

The six concise filter defaults intentionally use "Semua":
- All charts
- All genres
- All versions
- All difficulties
- All patterns
- All lessons

Do not casually replace these with longer wording; the concise behavior matches the other localized filter controls and accessible names retain the context.

Primary evidence:
- docs/localization-review/indonesian-20261004.md
- docs/localization-review/indonesian-20261004-review.json
- docs/localization-review/indonesian-20261004-implementation.json

The review is AI authoring/contextual source review, not native-speaker certification. Preserve that characterization.

### Language registration

Already changed in maintained source:
- src/maimai_intelligence/localization.py
  - LOCALES includes id
  - flag map includes id -> flag-id.png
- src/maimai_intelligence/assets/public-routes.json
  - id -> id
- web/src/runtime/contracts.ts
  - Locale includes id
- web/src/runtime/browser-state.ts
  - valid stored locales include id
- web/src/views/localization.ts
  - fifth language
  - Bahasa Indonesia
  - /^id(?:-|$)/ browser negotiation
  - /id/ route recognition
- web/src/catalog-query.ts
  - Indonesian title-state labels
- web/src/runtime/diagnostics.ts
  - Indonesian loading/failure/retry strings
- web/src/runtime/navigation.ts
  - Indonesian song-page/back labels
- src/maimai_intelligence/player_help.py
  - Indonesian bundled help output
- additional Python/release/recovery sources listed in the implementation JSON

### Flag button

The flag work is already in source:
- src/maimai_intelligence/assets/flag-id.png
- src/maimai_intelligence/assets/flag-icons-source.json

Pinned flag SHA-256:
1f85c9e9a1a0def09db35b63b9aae2a3c4f92202d701322621c8cfddf8880162

Pinned source is the existing Famfamfam flags revision:
a79ec57f332a43717170cdcf159692bcf0012872
dist/png/id.png

The language control source creates five buttons and uses the native name "Bahasa Indonesia".

### Layout changes

src/maimai_intelligence/assets/localization.css already contains fifth-button/narrow-layout source changes, including:
- general narrow language-control grid
- Indonesian mobile nav wrapping treatment
- Support header behavior
- 5-column Support language-control layout at <=360px

These still require real-browser validation.

### README/help

Already added:
- README.id.md
- src/maimai_intelligence/assets/import-help/README.id.md

Existing root READMEs were updated to include Indonesian in the language navigation.

Structure checks already confirmed that all five root READMEs preserve canonical English:
- fenced commands
- inline code
- link destinations
- heading structure

### SEO/routes/sitemap source

src/maimai_intelligence/assets/public-routes.json contains id.

src/maimai_intelligence/seo.py already contains:
- Indonesian SEO word table
- Indonesian title-state labels
- Indonesian difficulty labels
- Bahasa Indonesia static route language label
- locale-registry-driven localized document count
- locale-registry-driven alternate hreflang generation
- locale-registry-driven sitemap generation

Because sitemap generation iterates the locale registry, a maintained build should emit:
- sitemap-id.xml
- sitemap.xml containing sitemap-id.xml
- reciprocal hreflang="id" on localized song/version pages
- x-default remains English

There are no checked-in sitemap XML files in this source tree; they are build outputs.

## 4. Critical known incomplete item: generated shipped assets are stale

DO NOT treat the current tree as release-ready until maintained generation has been run and reviewed.

Verified stale generated files include:
- src/maimai_intelligence/assets/localization.js
  - still hard-codes ["en","zh-Hans","ko","ja"]
  - no Indonesian negotiation/button/name yet
- src/maimai_intelligence/assets/chart-overview.js
  - generated title-state table still lacks id
- src/maimai_intelligence/assets/browser/*.js
  - current built bundles still include four-language copies in generated code

Likely other generated browser/configuration hashes/references must update through the normal build.

Do not hand-edit minified/generated JS. Use the maintained generation/build process, then promote only declared generated outputs as DEVELOPMENT.md requires.

DEVELOPMENT.md specifically says:
- use tools/Test-Web.ps1 for pinned TS/esbuild validation
- after editing web/src, run npm run build inside the prepared DevCache copy
- review outputs enumerated by:
  - src/maimai_intelligence/assets/browser-assets.json
  - web/generated-assets.json
- promote only those generated outputs
- remove superseded build-owned chunks only after checking recorded hashes
- npm run check must reject stale generated bytes

## 5. Known incomplete item: active "all languages" test matrices still contain four-language assumptions

A new focused Indonesian browser test exists:
tests/browser/indonesian.spec.js

A focused Node test exists:
web/tests/indonesian.test.mjs

These are useful but are NOT sufficient. Existing maintained tests whose semantic intent is "all supported languages" need to include Indonesian where applicable.

Verified active examples that still explicitly use only EN/ZH/KO/JA include:

tests/browser/localization.spec.js
- several loops still use ['en','zh-Hans','ko','ja']
- labels/cabinet-label matrices need Indonesian entries where the test means all supported UI languages

tests/browser/player-history.spec.js
- bounded real imported history loop

tests/browser/player-maishift-browser.spec.js
- narrow controls/browser pilot language loop

tests/browser/player-maishift-pilot.spec.js
- pilot controls language loop

tests/browser/player-ranges.spec.js
- localized range layout/screenshot loop

tests/browser/player-results.spec.js
- language loop

tests/browser/player-sources.spec.js
- layout/source-selection loops

tests/browser/registry.spec.js
- filter-disclosure language matrix
- availability-control language matrix

tests/browser/seo-navigation.spec.js
- static route loops still use en/ja/ko/zh-hans
- JavaScript-disabled public-page test still describes "four languages"
- nested-route asset-resolution loop still excludes id
- visual/static language matrices need Indonesian where the test means every supported locale

tests/browser/startup-interactions.spec.js
- catalog failure/retry localization test still has only four choices

tests/browser/check-english-baseline.mjs
- language screenshot loop currently has four

scripts/check_import_placement_preview.mjs
- language loops currently have four

scripts/check_results_pilot_preview.mjs
- language loops currently have four

This list is known, not necessarily exhaustive. Search the maintained active code/tests for hard-coded language arrays and phrases like "all four languages"/"four-language". Historical release documentation can remain historically accurate; active tests, current maintenance docs, and current scripts must reflect five supported languages.

## 6. Concrete SEO test change already identified

In tests/browser/seo-navigation.spec.js, the JavaScript-disabled public-page test currently:
- loops over en, ja, ko, zh-hans only
- expects 5 <link rel="alternate"> elements

With Indonesian first-class support, the intended static page set is:
- en
- ja
- ko
- zh-hans
- id
- plus x-default alternate

Therefore update the test to exercise id and expect 6 alternate links, assuming the maintained generator emits one alternate per locale plus x-default.

Also expand any other route loops that are explicitly intended to cover all supported locales.

## 7. Tests/checks already completed

Completed dependency-free Node source subset:
- 52 tests passed
- 0 failed
- 0 skipped

Files:
- analysis-model.test.mjs
- artwork.test.mjs
- catalog-genres.test.mjs
- catalog-row-selection.test.mjs
- challenge-matching.test.mjs
- song-model.test.mjs
- indonesian.test.mjs
- recovery.test.mjs

Recorded Node version:
v24.14.1

Also completed:
- 961 Indonesian entries nonempty
- placeholder multisets preserved
- unique English keys
- all four non-English locales present on each message row
- removing id reproduced previous translation catalogs
- five-README structural parity
- syntax-only TS parsing for six edited TS files
- syntax-only JS parsing for edited/new test/script files
- source review fingerprint freshness

These checks are evidence, not substitutes for the maintained project test suite.

## 8. Validation not yet completed

Before release, perform the maintained checks from the approved DevCache environment.

Required categories:
1. maintained build/generation
2. formatter/lint
3. TypeScript typecheck
4. npm generated-consistency check
5. localization completeness/checker
6. localization-review freshness
7. Python unit/integration suite
8. architecture/release assembly checks
9. Playwright browser suite
10. narrow/mobile visual validation
11. Support dialog/checkout-owned UI validation
12. static SEO/public-route validation
13. generated sitemap validation
14. release capacity/file inventory validation

Use the exact project scripts documented by DEVELOPMENT.md rather than inventing parallel commands or environments.

Relevant maintained entrypoints:
- tools/Test-Development.ps1
- tools/Test-Development.ps1 -Check browser
- tools/Test-Development.ps1 -Check prepare
- tools/Test-Web.ps1
- npm run build inside the prepared web workspace
- npm run check after generated promotion

For localization maintenance, follow docs/LOCALIZATION.md and docs/LOCALIZATION_REVIEW.md.

## 9. Browser/visual acceptance requirements

AGENTS.md explicitly requires localized/responsive UI changes to be tested with all supported languages, relevant states, and narrow widths.

At minimum verify Indonesian in real browsers for:
- main header language control: exactly five buttons, correct pressed state
- Bahasa Indonesia accessible name
- 280/320/360/390/420-ish narrow widths plus desktop
- no page horizontal overflow
- no flag-button overlap/clipping
- Indonesian nav labels do not clip
- Settings menu
- About/README link
- charts/filter controls
- pattern lessons
- comparison
- player import
- player history
- player source selection
- Maishift pilot/runtime surfaces included in current release scope
- privacy UI
- Support dialog and its five-language header layout
- site-owned checkout status/retry/cancel strings
- failure/loading diagnostics
- persisted language after reload
- storage-denied behavior
- route/query precedence
- switching locale does not alter catalog identity, filters, personal data, or JP/International region state

Do not claim Stripe's provider-owned embedded form is translated by this project.

## 10. Static SEO/public-route acceptance

Build a release candidate and verify:
- /id/songs/<slug>/ exists for representative songs
- /id/versions/<slug>/ exists for representative versions
- <html lang="id">
- canonical URL points to the id route
- every localized page has reciprocal alternates for all five locales
- x-default points to English
- language links include Bahasa Indonesia
- Indonesian initial HTML contains Indonesian SEO/UI wording
- canonical song/artist/version identities remain unchanged
- Indonesian route can enhance into the app and return correctly
- changing language on a static route moves to the matching locale route
- JP/International selection survives locale changes
- JS-disabled Indonesian page remains useful/crawlable

Sitemap verification:
- sitemap-id.xml exists
- sitemap-id.xml contains the expected /id/songs/... and /id/versions/... routes
- sitemap.xml references sitemap-id.xml
- prior sitemap locales remain present
- no duplicate/broken route forms
- capacity/file count remains under the existing release guard

## 11. Generated-asset acceptance

After npm/build generation:
- generated localization.js must visibly include id, Bahasa Indonesia, /^id/, and /id/ route support
- generated chart overview must include Indonesian title-state labels
- browser bundles must include the five-language localization implementation
- browser-assets.json and generated-assets.json must match promoted bytes
- npm run check must pass
- no old chunk should be deleted until the build manifest proves it is superseded
- do not modify historical retained output snapshots merely to make checks pass

## 12. Translation/review handling

Preserve the existing review record:
docs/localization-review/indonesian-20261004-review.json

It intentionally says:
- AI authoring/contextual source self-review
- not independent review
- not native-speaker certification

If Codex changes Indonesian copy, update the review record honestly and refresh only the corresponding reviewed fingerprints after actually reviewing the changed copy in context.

Do not simply refresh hashes to silence the freshness checker.

A native-speaker review is welcome but is not a release prerequisite unless Adam separately asks for it.

## 13. Documentation cleanup

Current maintenance docs were partly updated, but search active/current documentation for statements that now incorrectly say the current product supports only four languages.

Do NOT rewrite historical release evidence to pretend prior releases had Indonesian. Historical documents saying "four languages" can remain correct for their dated release.

Current/future-facing docs such as LOCALIZATION.md should consistently describe:
- English plus four translated languages
- five total UI languages

Be careful with wording:
- "all four translations" can be correct when referring specifically to non-English translations
- "all four languages" is no longer correct for the current UI if it meant total supported languages

## 14. Preservation / scope boundaries

Do not:
- create a shadow checkout
- reset/stash/discard unrelated work
- rewrite unrelated translation values
- alter song identity or chart identity
- add Indonesian song alias data without a separate need
- broaden permissions to finish
- install hidden dependencies inside Dev
- use a shared global Python environment
- manually edit generated minified JS as the final solution
- deploy automatically merely because tests pass
- claim production changed before an actual approved publish
- change retained historical output/receipts to mask path or generation differences

## 15. Known environment blocker observed by ChatGPT

At the time of this handoff, the Commander ai-agent could read/write the source tree but still received EPERM for:
C:\DevCache\projects\maimai-chart-browser-registry\3a960df9ab5f0df1\venv\Scripts\python.exe

Commander also could not resolve/list:
C:\DevTools

Do not work around these by broadening ACLs or creating replacement environments in Dev. If Codex has the owner-approved environment access now, use the existing supported workflow and continue normally. If the same denial still exists, use the established owner-controlled permission workflow.

## 16. Definition of done

Do not call the Indonesian work complete until all of the following are true:

- [ ] 961-message Indonesian catalog remains complete and validated
- [ ] Indonesia flag appears as the fifth language button
- [ ] Bahasa Indonesia accessible/native label is correct
- [ ] browser negotiation/persistence/query/route restore works for id/id-ID
- [ ] all active "all supported languages" test matrices include Indonesian where applicable
- [ ] generated localization.js rebuilt and includes Indonesian
- [ ] generated browser bundles rebuilt and promoted through declared manifests
- [ ] generated chart-overview output includes Indonesian labels
- [ ] README.id.md and player-import-help Indonesian output pass maintained checks
- [ ] /id/songs and /id/versions public routes build
- [ ] hreflang has five locales plus x-default
- [ ] sitemap-id.xml builds
- [ ] root sitemap.xml references sitemap-id.xml
- [ ] Python checks pass
- [ ] TypeScript/build/check passes
- [ ] localization/review freshness checks pass
- [ ] release assembly/architecture checks pass
- [ ] Playwright suite passes
- [ ] Indonesian narrow/mobile visual checks pass
- [ ] Support five-button layout and Indonesian site-owned copy pass
- [ ] file/capacity guard passes
- [ ] no unrelated source/Git state lost
- [ ] final actual delivered tree is reviewed, not only a disposable preview
- [ ] any generated-file promotion is reviewed against the declared manifests
- [ ] production remains unchanged until the normal publication step is explicitly performed

## 17. Final delivery expected from Codex

Return a concise completion report with:
1. exact worktree/branch and resulting commit(s), if a commit is created
2. generated assets promoted/removed
3. full test/build commands actually run and pass/fail counts
4. browser engines and widths exercised
5. proof that sitemap-id.xml and root sitemap.xml are correct
6. proof that /id song/version routes and hreflang/canonical metadata are correct
7. any Indonesian copy changed after this handoff
8. release file/capacity result
9. anything still blocked or intentionally deferred
10. explicit statement whether anything was pushed/merged/deployed

Do not silently downgrade remaining failures. If a check cannot be run, say exactly which one and why.

## 18. Existing implementation evidence to read first

Before changing anything, read:
- docs/localization-review/indonesian-20261004.md
- docs/localization-review/indonesian-20261004-review.json
- docs/localization-review/indonesian-20261004-implementation.json
- docs/LOCALIZATION.md
- docs/LOCALIZATION_REVIEW.md
- DEVELOPMENT.md
- AGENTS.md

The implementation JSON contains the complete recorded changed-file/add-file inventory and hashes. Use it to distinguish intentional Indonesian work from unrelated edits.

The current task is to FINISH and validate the existing Indonesian implementation, not restart it from scratch.
