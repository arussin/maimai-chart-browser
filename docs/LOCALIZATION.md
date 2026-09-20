# Localization maintenance

The public chart browser, pattern lessons, comparison view, player-data controls,
About/credits, analytics choices, Support dialog, standalone Support page and
payment-return page support English (`en`), Simplified Chinese (`zh-Hans`), Korean
(`ko`) and Japanese (`ja`). Session Report and historical research viewers have
separate release scopes.

## Canonical copy and future changes

`src/maimai_intelligence/assets/locales/*.json` is the canonical translation
catalog, grouped by feature. Each exact existing English phrase is a key; its
values supply all three translations. English continues to come from existing
HTML/JavaScript, retaining punctuation, spacing and markup. Do not rephrase
English as part of a translation correction.

For every feature change:

1. Add or update the phrase and all three translations in the same change. Search
   for the key first: duplicate keys, absent locales and mismatched placeholders
   fail validation.
2. Static template copy is bound once. Generated elements use
   `maimaiI18n.text(node, english)`, `attribute(node, name, english)` and `option`.
   Existing element factories already use these helpers.
3. For new dynamic prose prefer `message('Found {0} charts', [count])`, registering
   that exact template. Wrap titles, artists and user names in `verbatim(value)`.
   `parts(values, separator)` composes UI labels with literal data. Existing
   concatenated prose uses anchored catalog templates; `$translate` explicitly
   marks parameters that are UI labels. Other captured parameters stay literal.
   Never insert a translation as HTML.
4. Preserve IDs, data/source URLs, option values, player records, analytical values
   and region preferences. The marked project GitHub link selects a translated
   README as documented below. A title that happens to equal `Close` must stay `Close`.
5. Run the checks below. A proper name or protocol token can be registered in
   `invariants.json` with a specific reason and source. Do not exempt UI prose.

The Python checker inventories public templates and accessible attributes,
pattern names/visible aliases and lesson prose/diagram labels. The JavaScript
checker parses browser modules (including new modules), prose, template strings
and text-sink literals. CI gates both, plus search reproducibility and browser
tests. These gates catch omissions; they do not certify native fluency.

Use the [review workflow](LOCALIZATION_REVIEW.md) for AI or contributor reviews,
per-language evidence and search-alias triage. Follow the maintained
[regional terminology guide](LOCALIZATION_TERMINOLOGY.md). The owner does not
need to speak the target languages to maintain this process.

Run in the approved development environment. On Windows use the documented
DevCache workspace so dependencies and generated test output stay outside source:

```text
python scripts/check_localization.py
node scripts/localization_sources.mjs .
python scripts/prepare_multilingual_search.py --registry registry --output src/maimai_intelligence/assets/song-localizations.json --check
python -m unittest discover -s tests
```

The Node checker uses pinned Acorn from `npm ci` in `tests/browser`; Acorn is
never shipped. Set `MAIMAI_NODE_MODULES_ROOT` to the disposable workspace root
when checking canonical source with dependencies stored in DevCache.

## Repository README translations

`README.md` is the canonical English document. `README.zh-Hans.md`, `README.ko.md`
and `README.ja.md` are complete Simplified Chinese, Korean and Japanese versions
in the repository root. All four include the same language navigation links.
GitHub renders the default README; it does not negotiate our translated filenames
from the visitor's language. See [GitHub's README documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes).

The site's marked `data-localized-readme` GitHub link changes destination with
the selected UI language. English retains the existing repository-homepage URL;
the other languages link to `blob/main/README.<locale>.md`. Keep those translated
files in the same release as the site change so the links resolve on GitHub.
Source credits and other external links are not redirected. Linked technical
documents have their own scope and currently remain English.

When English README content changes, update the corresponding passages in all
three translations in the same change. Preserve commands, file paths, API names,
game titles, version names, links, numerical claims and limitations. Use the
existing terminology guide and UI catalog for visible control names. AI review
is acceptable; the owner does not need to translate or find native reviewers.
Review the complete changed passages in context, then record the reviewer,
method and date in `docs/localization-review/ai-review.json` and update the four
README fingerprints with `scripts.check_localization_review.file_fingerprint`.
Do not refresh fingerprints without doing that review.

The existing CI review check now covers these Markdown files as well as UI and
alias JSON. It fails on changed English, changed translations or missing reviewed
files; line-ending changes alone do not fail. Tests also compare code examples,
inline code, link destinations and heading structure against English, and exercise
the site link through language changes and a reload. These checks detect drift
and structural omissions, not fluency.

## Switching and Support

Unmodified Famfamfam pixel flags have native language names in accessible labels. The saved
`maimai-language-v1` choice takes precedence over the browser language list;
unsupported preferences fall back to English. Chinese browser variants select
Simplified Chinese. Same-origin pages and tabs share the choice. Blocked storage
still permits switching in memory. No account or translation request is needed.

Switching updates bound text and accessible labels without reloading the catalog,
resetting filters, changing game region, reimporting player data or restarting
payment. Support also has flags inside its modal. CJK fonts apply only outside
English. Existing English wording and styling remain unchanged apart from the
added controls. JavaScript is required; the existing no-JavaScript fallback is
English.

All site-owned Support invitations, buttons, waiting/retry/error messages,
confirmation text and return statuses are included. Stripe's cross-origin form,
receipts and payment-method availability remain provider-controlled, using the
existing Stripe/browser language behavior. Switching the site language does not
destroy an active checkout to replace provider-owned text.

## Game terminology

Language is independent of Japan/International metadata preference. It does not
infer mainland-China availability. Song titles, artists, version logos/names,
STD, DX, difficulty names, ranks and game identifiers retain the accepted source
spelling. Genres and site explanations have localized labels with stable IDs.

The September 20, 2026 review checked [SEGA Japan](https://maimai.sega.jp/),
[SEGA International](https://maimai.sega.com/) and
[Uniana's Korean page](https://www.uniana.com/games/?mode=detail&prd=98).
Japan's MAGiCAL and International's CiRCLE PLUS are distinct regional releases,
not translations of one another. Uniana retains stylized release and difficulty
labels within Korean prose. Recheck official sources when releases change.
Lesson terms are explanatory translations, not official SEGA naming.

## Search rebuild and correction workflow

`requirements-localization.txt` pins offline builder dependencies. The existing
owner-run `scripts/update_catalog.py prepare` / `refresh` generates aliases after
identity reconciliation and before catalog projection, retaining
`multilingual-search.json` in each candidate. Offline and source-replay builds use
the same step. This introduces no schedule, hosted updater or publishing
authority. The accepted registry stays unchanged; only the search projection
gains aliases.

`assets/song-pronunciations.json` contains corrections and additional aliases by
stable song ID, guarded by expected title and artist. The generator uses accepted
titles/readings, authored kana mappings, CMU English pronunciations, OpenCC script
conversion and pypinyin. SEGA title_kana can be a **sort key with voicing removed**:
derived forms are approximate; an authored reading overrides it. A title written
in kana takes precedence over the lossy sorting key. Explicit locale aliases
replace that locale's generated fallback; a complete authored reading may also
supply Hangul. Mixed, unconverted Japanese/Latin letters cannot count as generated
Hangul coverage. Japanese kana cannot enter Chinese script aliases or pinyin.
Original
Japanese and existing Tachi/romaji aliases remain searchable.

`assets/song-localizations.json` is a reproducible bundled fallback for retained
catalogs. Each alias records locale, kind and provenance. The initial accepted
catalog has Chinese, pinyin and Hangul aliases. `coverage.by_review_status`
distinguishes **AI-reviewed** records from generated approximations. The September
20 language pass reviewed the initial 855 overrides and added targeted corrections;
it did not establish every alias as a common regional name. Chinese search aids
can be literal glosses or transliterations. Automatic phonetics are approximate,
especially stylized Latin titles, mixed scripts and sort keys. Coverage is not a
quality claim. Aliases never become official titles or evidence for chart,
artwork, source or player identity. No unlicensed community alias dataset was
imported to fill coverage.

To correct a song or cover a new entry:

1. Find its accepted ID and verify title/artist. Add reading for a misleading
   Japanese sort key, or arrays in aliases.en, .ja, .zh-Hans and .ko. Preserve
   useful aliases and the canonical title.
2. Record provenance/review notes. After an actual AI language pass, use
   `review_status: ai-reviewed` with the reviewer, method, date and languages
   checked. Add source URLs for confirmed community names. Use
   `machine-assisted-draft` for unreviewed suggestions; never claim native
   review for an AI pass. Contributor review is welcome but is not an owner
   translation requirement or an automatic release gate.
3. Run the generator command above without --check. Review the diff and
   coverage.review_queue: missing_aliases counts script gaps, while drafts and
   generated approximations remain visible for quality review. Unknown Latin words do not count as Hangul
   coverage. Identity changes fail rather than matching fuzzily.
4. Run --check and tests. Commit the correction and regenerated artifact together.
   The complete-registry CI check rejects stale output, orphan IDs and missing
   Chinese/Hangul coverage. Small retained catalogs can use a subset.

Pinyin is tone-free and supports spaced or compact search. Search normalizes
width, case, punctuation and Unicode composition in every UI language. IME
filtering waits for committed text. The builder never receives personal records
or calls a translation service.
