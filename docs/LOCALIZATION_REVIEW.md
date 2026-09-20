# Reviewing localization

The owner is not expected to translate or recruit reviewers. A developer or AI
agent can perform the language review, consult the
[regional terminology sources](LOCALIZATION_TERMINOLOGY.md), apply corrections
directly to the canonical catalogs, and run the checks. Record the actual method;
an AI pass is not native-speaker certification. Optional contributor feedback can
use the workbook below.

The September 20 AI pass reviewed all 773 UI entries in Korean, Simplified Chinese
and Japanese, including every Support entry, and read the original 855 song
override records. `localization-review/ai-review-changes.json` records actual
copy/alias corrections; `localization-review/ai-review.json` fingerprints the
reviewed files. Generated-only song aliases remain explicitly approximate.
The initial workbook is a historical, pre-correction snapshot, not the current
review status. Do not overwrite a returned or edited workbook.

CI runs `python scripts/check_localization_review.py` to detect new catalogs,
changed copy, changed song overrides or changed README files after this review. This is a freshness
check, not a fluency score. Review the changed entries against their UI context
and regional sources, record corrections and reviewer/method/date, and only then
refresh the corresponding JSON fingerprints in the review record using
`scripts.prepare_localization_review.fingerprint`. Preserve prior change records.
Do not simply refresh hashes to make CI pass. No owner translation is required.

For README changes, use the [README maintenance workflow](LOCALIZATION.md#repository-readme-translations).
English remains canonical, and all three complete translations must be updated
and reviewed together. Record Markdown fingerprints with
`scripts.check_localization_review.file_fingerprint`, which normalizes line endings.

The review workbook places each English phrase beside its current Korean,
Simplified Chinese or Japanese translation. The separate Search aliases tab
contains the generator's review queue. It does not rename songs or artists.

Start with **UI Korean**, whose first entries cover Support. Work down the tab or
filter by Area. The other language tabs use the same order. Edit the amber
correction, status, reviewer and notes cells:

- **Approved:** the current text is suitable. Leave the correction blank.
- **Correction proposed:** enter the complete replacement and explain any
  regional terminology in Notes.
- **Needs context:** record the question or missing context in Notes.
- **Needs review:** no decision yet.

Use a reviewer name or handle. The entry check and opening progress counts require
that attribution. A proposed correction also requires replacement text. These
counts describe review completion, not whether a change has reached the site.

Preserve English, placeholders such as `{0}`, official song titles, artists,
version names, difficulty/rank labels and identifiers. Support includes the
site's invitations, payment states and return messages; Stripe owns its embedded
form and receipts. Chinese review uses Simplified Chinese.

## Song search review

The initial workbook includes all 852 queued songs from the 1,694-song catalog.
The 361 entries marked First have missing aliases, unresolved words or residual
Latin/Japanese/Han characters in a Korean alias. These are deterministic triage
signals, not confirmed errors or fluency scores. The remaining 491 queued songs
follow. Songs outside the queue have not thereby passed native review.

Review all aliases listed for the song, using the title and artist to identify
it. Check what local players actually type, including natural Hangul readings,
established Chinese names and common alternative spellings. Generated literal
glosses and syllable substitutions can be unnatural even when every language
has an entry. Put one term per line in a proposed replacement list, preserving
useful existing forms. Mark unwanted generated forms in Notes as well: they may
need a reading or generator correction rather than an additional override.
Pinyin is regenerated from the accepted Chinese forms.

## Applying returned reviews

Return the edited workbook. Its English keys, song IDs and source fingerprints
keep corrections associated with their original entries after sorting. Retain
the matching `review-source.json` beside it. Do not regenerate over reviewer work.

Before applying a returned row, verify that its fingerprint still matches the
canonical source. Resolve stale or conflicting edits explicitly. Apply only
the reviewed language's correction, preserving English and unrelated aliases.
Record actual reviewer attribution; do not turn an AI pass or a blank status
into native-speaker approval. For a partial song review, retain its draft status
until the remaining requested languages have been reviewed. An AI review may use
`ai-reviewed`, with its method and evidence recorded honestly; it need not wait
for the owner to find a speaker.

Update the appropriate `assets/locales/*.json` catalog or
`assets/song-pronunciations.json`, then regenerate the search artifact when
needed. Run the copy/placeholder checks and search reproducibility check, followed
by focused language-switching, search or Support tests for affected behavior.
Use the [maintenance guide](LOCALIZATION.md) for the canonical commands. Workbook
edits alone never change or publish the site.

## Refreshing the review package

From canonical source in the documented development environment:

```text
python scripts/prepare_localization_review.py --output <new-review-directory>/review-source.json
```

This validates catalog coverage and exports all phrases plus the current search
review queue. It refuses to overwrite an existing snapshot. The snapshot carries
a content fingerprint rather than inferring freshness from a Git branch name.
When adding a new catalog, add its review label/order to the exporter too.

The optional workbook builder uses the desktop's bundled `@oai/artifact-tool`:

```text
node scripts/build_localization_review.mjs <snapshot.json> <new-review.xlsx> <preview-directory>
```

Set `MAIMAI_ARTIFACT_MODULES` to the bundled `node_modules` directory returned by
the desktop dependency loader. This review-only tool adds no site or data-builder
dependency. Temporary previews and draft workbooks belong in DevCache. Retain
only the selected finished workbook and its source snapshot. The builder refuses
to overwrite an existing workbook, tests progress formulas, and renders every
sheet for visual inspection. Future exports start a new review; carry forward
actual reviewer decisions only after matching record IDs and fingerprints.

The September 20 package begins with every entry marked Needs review. Existing
automated site checks remain separate from native-language review. The package
does not deploy a preview, publish the site or contact reviewers.
