# Supplemental SEO and title-state language review

Review date: 2026-09-22. Reviewer: OpenAI coding agent, contextual AI review.
This records an AI review of the exact source below, not native-speaker certification.

The review covers English, Japanese, Korean and Simplified Chinese UI copy in
`seo.py`, including headings, facts, actions, regional checkbox, language links,
experimental-analysis qualification and intentional-blank/missing-title labels.
The existing translation catalog supplies game difficulty terminology: Korean
keeps BASIC/ADVANCED/EXPERT/MASTER/Re:MASTER; Chinese uses 初级/高级/专家/大师/宗师.
No generated transliteration or translated song/artist name becomes a display title.

The Japanese, Korean and Chinese actions convey opening the same song/chart and
returning to the preceding results. Their international-data checkbox refers to
game data preference, independently of page language. The qualification says the
analysis is experimental and unavailable information is not inferred. Blank labels
explicitly distinguish an intentional blank from unavailable title metadata. A
verified nonblank international title displays normally; differing unproven blank
regional metadata is missing, while unchanged canonical metadata keeps its state.
`catalog-query.ts` and the Python SEO projection use the same four-language labels.

Route locale selection in `localization.js` was reviewed: explicit localized routes
and valid language query selection override saved/browser preference without
silently changing region or persisting an automatic language choice. The browser
and static-page tests exercise all four locale folders, Unicode routes, regional
projection, narrow widths and exact navigation restoration. The route language
controls retain localized URL/canonical metadata; returning to a saved browser
restores its captured locale without overwriting the new persisted preference.
Version enhancement mounts language controls in its visible browser header.

| Source | SHA-256 reviewed |
| --- | --- |
| `src/maimai_intelligence/seo.py` | `25b8a0438d6be526b7dc1c26c51156c0c645159267d9903e2e1bfc3d89c39e6c` |
| `src/maimai_intelligence/assets/localization.js` | `731df478fee69eed891ab775721dacda407214c2cf3a350610e13803c8a2f8b2` |
| `web/src/catalog-query.ts` | `e73d4612527f75863eb4659d3c0758a76cf03d3a82a4a96c9a5f4403fc17cf25` |
| `src/maimai_intelligence/assets/locales/pattern-aliases.json` | `5943dcd14e0d09460c08e2892f8b7d4a610d0dc0c34bbb6a5fa9d8056edbca4a` |
| `src/maimai_intelligence/assets/seo-navigation.js` | `b0a22a7f9c470d471b8b9722777c62f07b3d18772dc7dce7b982dbec25b2e787` |
