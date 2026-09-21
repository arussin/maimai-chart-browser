# Maishift pilot copy review

Date: September 21, 2026. Reviewer: Codex. Method: AI contextual translation and
review of the pilot form, consent, result states, errors and summary/privacy copy
in English, Simplified Chinese, Korean and Japanese. Not native-speaker certification.

Reviewed all 51 entries in `assets/locales/maishift-pilot.json` against
`maishift-pilot.html` and `maishift-pilot.js`. Existing
[regional terminology](../LOCALIZATION_TERMINOLOGY.md) was retained: 谱面 / 채보 /
譜面 and local descriptions of PBs. No new game terms, chart names, aliases or
release names were introduced. UI language and game region remain separate.

Checked that each locale distinguishes consent to read a public profile from
saving player data, a successful single observation from release approval, and
missing/unchanged data from a passed test. All locales disclose the public link,
manual summary sharing, tab-only data, six-read limit and retry timing. Correction
wording describes a lowered score without encouraging a fabricated correction.
Numeric placeholders remain identical.

Browser validation covers keyboard consent/submission, translated titles, result
states, overflow and control clipping at 320px. The page uses the site's existing
language controls; no network translation is involved. Automated checks establish
coverage/layout, not linguistic fluency. The canonical review record contains the
catalog fingerprint and this review's scope.
