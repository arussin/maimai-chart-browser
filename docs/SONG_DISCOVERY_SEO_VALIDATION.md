# Song discovery SEO implementation and validation

16 October 2026. Branch `codex/song-discovery-seo-20261016`, based directly on
production `30de8cdf7ec79fea47ee9f78d9a02e1efe7cb362`. No connector changes are
included. This is a review candidate; it has not been deployed.

## Change and review scope

- `song_search.py`: an identity-bound presentation allowlist reuses the accepted
  reading compiler. A separately reviewed alternate name must match the stable
  song ID, exact title/artist and pinned Tachi alias, with kind, locale and sources.
- `song-display-readings.json`: one English evidence-reviewed abbreviation,
  **BOGE**, for **Beat of getting entangled / Shoichiro Hirata**. The 321 existing
  reviewed pronunciation records are unchanged.
- `seo.py`: original H1 plus subtle English full reading in initial HTML;
  matching metadata, actual artist/MASTER/Re:MASTER format/level/constant facts;
  artist and format context distinguish duplicate titles. Regional identity drift
  suppresses readings. Other locales retain their language and original names.
- `seo-pages.css`: 253 additional bytes for the two small text styles. No browser
  TypeScript, generated JavaScript, analytics, search semantics or data changes.
- SEO/search tests and the route-recovery inventory fixtures cover publication
  quality, identity collisions, absence, escaping, duplicates and locale behavior.
  The three recovery golden inventories were compared against production:
  only titles/descriptions changed in 25 fictional song documents. Route paths,
  bodies, version pages and recovery decisions remained identical.
- [Research](SONG_DISCOVERY_SEO_RESEARCH.md) includes the 36-song sample and sources;
  [localization review](localization-review/song-discovery-20261016.md) records the
  actual AI review and its limits. No private Search Console data is committed.

## Coverage

| Measure | Production | Candidate |
| --- | ---: | ---: |
| Accepted song IDs / versions | 1,694 / 28 | 1,694 / 28 |
| Existing compiled display-reading rows | 806 | 806 |
| Full readings matching current catalog identity | 799 | 799 |
| English static pages exposing that reading | 0 | 799 |
| Evidence-reviewed visible abbreviations | 0 | 1 |
| Verified visible community nicknames | 0 | 0 |
| Generated/approximate search-only records | 5,881 | 5,881 |
| Unresolved Japanese-script song IDs | 160 | 160 |

The 5,881 count includes generated phonetics, pinyin, script conversions,
approximate sorting keys and approximate titles; it excludes faithful full-kana
readings already accepted by the maintained compiler. The broader search stores
retain 2,199 Tachi alias values and 8,716 multilingual records. These categories
overlap and are not independent song counts. Seven previously displayable artist
records fail the stricter exact current-identity check and remain withheld.

## Full accepted-catalog validation

Input: `research-89929673b56e`, SHA-256
`bd7d42107cb191949bb6f2129ebde70101682ef9b46516c79f1ebb84a00c2e9d`.
The maintained public-catalog reader validated the accepted multipart input.
Both generators used the same saved permalink ledger and catalog; production
generation used the exact baseline source loaded into memory. The maintained
`seal_browser_resources` step reproduced retained production bytes before the
candidate comparison. No separate SEO song dataset or full release copy was made.

All **8,610** initial documents passed: one original H1, one self canonical,
six reciprocal alternatives (five locales plus x-default), correct page language,
**8,470 distinct song-page titles**, 799 English secondary readings, and exactly
one alternate-name line. All **68,595** contextual/language links resolved.
The complete path set, sitemap bytes, permalink ledger and song-catalog bindings
remain unchanged. Existing private-route exclusions remain in effect.

Version **content and links** remain byte-identical before resource binding.
The release sealer updates the immutable stylesheet descriptor in activating
documents, including versions and the homepage; these descriptor changes do not
change their byte lengths. Previous immutable assets remain retained.

## Size, performance and capacity

| Measure | Before | After |
| --- | ---: | ---: |
| All song HTML, 8,470 pages | 81,292,779 B | 81,945,722 B |
| Median song HTML | 9,425.5 B | 9,508 B |
| Umiyuri English HTML | 9,659 B | 9,913 B |
| Umiyuri compressed document transfer, local Chrome | 3,169 B | 3,234 B |
| All version HTML, 140 pages | 3,035,193 B | 3,035,193 B |
| Homepage HTML | 77,274 B | 77,274 B |
| Homepage gzip body, same local compression | 22,759 B | 22,760 B |
| Hosted JavaScript entry | 23,696 B | 23,696 B |
| Five preloaded JavaScript modules | 297,566 B | 297,566 B |
| Static generation and immutable resource binding, wall time | 52.14 s | 52.86 s |
| Same generation, process CPU time | 50.33 s | 50.84 s |
| Complete retained release file count | 34,397 | 34,398 |
| Complete retained release size | 1,712,069,423 B | 1,712,727,783 B |
| Largest file | 25,100,660 B | 25,100,660 B |

The complete projection grows **658,360 bytes (0.039%)** and one content-addressed
stylesheet. Existing JavaScript bytes and startup module requests are unchanged.
Generation timing covers all 8,610 documents with the same already decoded input,
including the maintained resource-binding step; it excludes filesystem assembly.
The paired wall-time increase was 0.72 seconds (1.4%), with 1.0% more process CPU.
For three alternating fresh browser contexts per version at 390 px, median song
startup was 274.8 → 241.3 ms, opening the catalog 879.8 → 877.6 ms, and measured
CLS was 0 in every run. These local measurements show no regression; they are not
claims of a production speedup. The local host used the same gzip/cache settings.

Paired Lighthouse **13.5.0 desktop** audits used an isolated cached Chromium,
identical simulated throttling and disabled error reporting:

| Metric | Song before → after | Homepage before → after |
| --- | --- | --- |
| Performance score | 99 → 99 | 55 → 56 |
| Accessibility / SEO | 100 / 100 → 100 / 100 | 100 / 100 → 100 / 100 |
| FCP | 562.6 → 562.2 ms | 566.6 → 567.0 ms |
| LCP | 985.4 → 984.8 ms | 2,417.9 → 2,437.6 ms |
| Total blocking time | 0 → 0 ms | 224 → 200 ms |
| CLS | 0 → 0 | 1.0111 → 1.0111 |

The homepage's pre-existing layout shift remains a separate performance issue.
The song-page best-practices score was 96 in both runs because the local retained
release has no `/favicon.ico`; that request returned 404 in the preview server.
Homepage best practices scored 100 in both runs. No new application error or
layout regression was observed. These lab runs are not field Core Web Vitals.

The default 20,000-file composition guard correctly rejected the candidate.
The existing three-evidence capacity review passed
the maintained reader and pure composition planner at **2026-10-16 13:52 UTC**:
34,398 / 100,000 files; largest file below 25 MiB. That review expires at
**2026-10-17 03:04:00.897 UTC**. No numeric override or expired authorization was
used. The inventory is a virtual complete composition, **not an assembled or
deployable release**. Publication must refresh the applicable owner gates.

## Validation commands and results

Completed candidate checks:

| Command / check | Result |
| --- | --- |
| `python -B -m ruff check --no-cache .` | Pass |
| `python -B -m ruff format --check --no-cache .` | Pass |
| `python -B -m unittest tests.test_route_recovery tests.test_seo tests.test_song_search` | 42 passed |
| `python -B scripts/run_offline_tests.py` | Suite passed: 965 tests, 10 environment-dependent skips, zero non-loopback attempts |
| `python -B -m unittest tests.test_source_metrics` with the explicit locked web runtime | 6 passed; resolves the three optional metrics skips above |
| `python -B scripts/check_corpus_boundaries.py` | Strict typing: 39 files; 260 tests passed; all 370 required branches covered |
| `python -B scripts/check_localization.py` | 1,031 messages validated across four translations |
| `python -B scripts/check_localization_review.py` | Review fingerprints current |
| `python -B scripts/prepare_multilingual_search.py --registry registry --output src/maimai_intelligence/assets/song-localizations.json --check` | 1,694 songs; unchanged 741-entry review queue |
| `npm run check` in `web` | Formatting, TypeScript, architecture/decision gates and byte-for-byte generated assets passed |
| `npm test` in `web` | 204 passed |
| Full-catalog raw HTML / immutable resource binding / composition audit | Pass, as quantified above |
| Real-catalog isolated browser and Lighthouse audits | Pass within the limitations below |

The seven remaining skip records require symbolic-link creation unavailable in
this Windows context; no permissions were changed to enable it. PR CI results
are reported in the final handoff against the exact commit.
The initial boundary run passed strict typing but found the expected recovery
inventory changes; the reviewed fingerprints above and 42-test rerun resolve that
failure. The maintained Windows `tools/Test-Development.ps1` / `tools/Test-Web.ps1`
source-copy run requires the requested bounded cache allocation. That allocation
remains an owner decision; the independent checks above reuse existing external
dependencies and do not create a replacement source checkout.

The real-catalog browser check uses the existing pinned Playwright dependencies,
an isolated browser and a loopback-only sample preview. It passed 50 combinations
of five languages, JP/International data and 320/360/390/414/1280 px; 20 pages with
JavaScript disabled; axe checks of the affected document in all languages; and
six direct-entry → chart browser → Back journeys. No application errors or
external requests occurred. Five 320 px captures were visually reviewed.

An initial manual Chinese check was confounded by Chrome's automatic translation
(`translated-ltr` and injected font wrappers changed Japanese titles into English).
The isolated browser passed with the actual Chinese UI. No user browser setting
or application translation behavior was changed.

## Publication and indexing follow-up

No merge, production deployment, account setting change, tracking change,
Search Console indexing request or sitemap submission is part of this work.
Source publication status and final checks are recorded in the PR/final handoff.
Indexing remains an independent constraint. Use the private Search Console
baseline and the research report's fixed sample and 28-day comparison plan after
an owner-approved release and observable recrawling.
