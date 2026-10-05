# Indonesian localization — source implementation, release validation pending

Date: 2026-10-04. Language: Indonesian (`id`), displayed as **Bahasa Indonesia**.
Implementer/reviewer: ChatGPT AI assistant. Review is AI authoring and contextual
source self-review, not independent review or native-speaker certification.

## Completed source work

All **961 UI messages** across **17 message catalogs** have Indonesian values.
The eighteenth catalog, `invariants.json`, contains no messages and is unchanged.
Catalog checks preserve every existing English key, Japanese/Korean/Simplified
Chinese value, placeholder and invariant. Six filter defaults were shortened to
**Semua** after reviewing the existing concise non-English control behavior.

Indonesian is registered in maintained TypeScript/Python sources for language
selection, `id-ID` browser negotiation, saved preferences, browser-state restore,
`/id/` song/version routes, SEO metadata/sitemaps, title-state labels, navigation,
loading/error diagnostics, static recovery and import help. The SEO document
count uses the locale registry rather than a hard-coded four-language multiplier.
The pinned, unmodified Famfamfam Indonesia flag and provenance were added.

The complete `README.id.md` and bundled player-import help were translated.
All five root READMEs link to every language. Maintenance/terminology documents
and review-export language coverage were updated; the exporter now includes the
existing card-history catalog. Picker grids accommodate a fifth button in source,
and Indonesian-only narrow navigation can wrap. Actual visual fit is not certified.

Language remains independent of game region. No song-title alias corpus, player
identity, chart matching, data acquisition, analytics consent or payment behavior
was changed. Generated/minified application JavaScript has NOT been edited.

## Source and preservation

Work is saved in the existing release worktree:
`C:\Dev\worktrees\maimai-card-history-20261004`.
Branch: `codex/chart-card-history-refinement`.
Initial HEAD: `2731429fb4bd6e1f85d276978ca09bb8bee11683`.
Local origin/main observation: `35d330fd911dca808b5109f219f6c5ea129a8ed8`.
The older Maishift branch in the primary checkout was not used for this work.

A read-only Git-index comparison found no working-file differences against the
index or extra source files before editing. This does not certify index/HEAD
parity. No Git refs or index were intentionally changed; no branch switch,
stash, reset, commit, push, merge or deployment was performed. Existing source,
retention/automation holds and recovery material remain in place.

## Checks actually completed

- **52 dependency-free Node source tests passed**, zero failed or skipped:
  16 new Indonesian tests, 7 route-recovery tests and 29 existing domain tests.
- All 961 Indonesian entries are nonempty and preserve placeholder multisets;
  keys are unique and all four non-English locales are present.
- Removing the new `id` values reproduces every original catalog exactly.
- Five-README fenced commands, inline code, link destinations and heading
  structure match canonical English.
- Six changed TypeScript files parsed in memory using Node's TypeScript syntax
  transformer. This is NOT TypeScript typechecking or a maintained build.
- Reviewed source fingerprints match the recorded inputs. Prior unrelated review
  records/fingerprints were preserved. This is a freshness check, not fluency.

Reproduce the completed Node subset from `web` using the existing Node executable:

```powershell
& 'C:\Program Files\nodejs\node.exe' --test tests/analysis-model.test.mjs tests/artwork.test.mjs tests/catalog-genres.test.mjs tests/catalog-row-selection.test.mjs tests/challenge-matching.test.mjs tests/song-model.test.mjs tests/indonesian.test.mjs tests/recovery.test.mjs
```

## Remaining validation and precise blocker

The final direct access recheck still returned Windows `EPERM` for:
`C:\DevCache\projects\maimai-chart-browser-registry\3a960df9ab5f0df1\venv\Scripts\python.exe`.
`C:\DevTools` metadata could be inspected, but Commander could not resolve/list
that directory. Approved Git and PowerShell 7 commands were not discoverable in
the current process PATH. Source-file permissions themselves are working.

Do not bypass these denials, broaden ACLs, switch identity, retrieve credentials,
or install replacement dependencies in Dev. Any remaining access correction
belongs to the existing owner-controlled workflow and should be scoped to this
worktree's approved environment and shared toolchains.

Still required before release: maintained DevCache environment/build; formatter,
TypeScript typecheck, full Python/architecture/generated-consistency checks;
review and promotion of declared generated assets; real Playwright/visual tests
(including mobile navigation, Support checkout controls, imports, lessons and
static routes); and release capacity/inventory verification. New Indonesian
browser tests are authored but NOT run. Existing four-language browser matrices
have not all been expanded; validate the wider feature coverage explicitly.

The current changes are **uncommitted source work, not a deployable release**.
Production is unchanged. No completion time, deployment approval or future
background execution is implied.

Evidence: `indonesian-20261004-review.json` records the actual source-review
method and corrections; `indonesian-20261004-implementation.json` records file
hashes, preservation checks, executed tests and remaining work.
