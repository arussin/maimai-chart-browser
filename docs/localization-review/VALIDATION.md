# September 20 language review

The AI review read all 773 UI entries in Korean, Simplified Chinese and Japanese,
including Support. It applied 95 translation corrections. English keys and
placeholders remain unchanged. Regional terminology and source links are recorded
in [the terminology guide](../LOCALIZATION_TERMINOLOGY.md).

Search corrections affected 115 distinct songs. The rebuilt 1,694-song artifact
has no missing Chinese or Hangul coverage. It distinguishes 953 AI-reviewed
override records from 741 generated approximations. The latter remain in the
quality queue; complete script coverage is not proof of natural local wording.
The review does not certify every alias as an established community nickname.
Titles, artists and registry identities remain canonical.

The builder now preserves kana-title pronunciation over lossy sorting keys,
honors locale corrections over generated fallbacks, and rejects partly
unconverted generated aliases. It also preserves nasals across syllable-separating
interpuncts. Source-backed nicknames carry per-song URLs separately from
AI-authored glosses and phonetic aids.

The Japanese/Simplified Chinese cross-check found no swapped UI translations or
flag mappings. The Chinese catalog retains the creator name なめあ intentionally;
shared terms such as 定数, 配置 and 曲名 were checked in context. Chinese uses
Simplified Chinese copy and an SC font fallback; Japanese uses Japanese copy and
a JP font fallback. The rendered 320px views were inspected separately.

The same check found one generated search alias for ㋰責任集合体 that incorrectly
mixed ム with simplified characters, plus its derived pinyin form. Both were
removed by normalizing Unicode before the builder's script check. A regression
test covers circled kana, and a full artifact scan found no remaining Chinese
aliases containing kana letters or Hangul. The canonical song title is unchanged.

Filter defaults now use すべて / 全部 / 전체 where an adjacent label supplies the
context. Accessible names retain that context. Japanese phone navigation no
longer wraps or crowds the settings control; the English layout is unchanged.

Validation on Windows:

- Python suite: 498 passed, 7 skipped (505 total).
- Final focused localization suite: 10 passed, including the new circled-kana
  regression after the broader Python run.
- Related browser suite: 87 passed across desktop, mobile, 320px and WebKit.
- After the final phone layout fixes: all 70 language/Support cases passed.
  Navigation checks cover Japanese, Simplified Chinese and Korean at 320, 360,
  375, 390 and 414px in Chromium and WebKit, including text crowding and wrapping.
  Compact Support errors also keep the flags and close control inside the dialog.
- English text and page geometry matched the previously validated candidate
  for Catalog, Patterns, Compare and About at 1280px, 390px and 320px (12 checks).
  Only added flag-control spacing changed in narrow Support dialogs.
- All 773 English catalog keys match the pre-review snapshot exactly.
- Copy/placeholder coverage, browser source inventory, deterministic search
  rebuild, review fingerprints, focused Ruff checks and whitespace checks passed.

The initial workbook remains a historical snapshot. Current review evidence is
in [ai-review.json](ai-review.json) and exact corrections in
[ai-review-changes.json](ai-review-changes.json). CI detects changed localization
inputs after the recorded review. No deployment or hosted payment request was
performed; payment tests used local test doubles.

README follow-up: complete Simplified Chinese, Korean and Japanese README files
were translated and reviewed against the unchanged English body, with language
navigation added to all four files. Commands, inline code, link destinations and
heading structure match; every relative link resolves locally. The site GitHub
link follows the selected language, including after reload, and restores the
original repository-homepage link for English. All 32 localization browser checks
and 12 focused Python tests passed. CI review fingerprints now cover the README
source and translations, with regression tests for source edits, translation
edits, removed files and Windows/Linux line-ending equivalence. Linked technical
documents remain English. The translated GitHub destinations require publication
of these files; no push or deployment was performed.

Release preparation: the complete local Python suite passed 501 tests with 7
configured skips (508 total), the complete browser suite passed 372 tests with 15
configured skips, and all 13 payment Worker regressions passed. Ruff, canonical
copy/source inventory, review freshness and deterministic alias checks passed.
These checks used a fresh disposable DevCache workspace containing the current
source. Publication and production verification are recorded separately.
