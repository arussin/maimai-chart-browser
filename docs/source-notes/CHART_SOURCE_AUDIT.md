# Chart Intelligence source and pattern audit

Reviewed 2026-09-10 for the first implementation slice. This is a research record, not a chart catalog, recognition benchmark, legal opinion, or teaching validation. No external parser was installed or executed. No raw commercial charts or music were downloaded. No maimai account data was accessed.

## Decision

Umiyuri has been checked against an actual explanatory transcript and a separate illustrated explanation of a chart section. Evidence now exceeds the handoff's title-only attestation. A narrow candidate event grammar is supportable; automatic community-family tagging remains disabled because variant boundaries, exact source identities, and independent occurrence validation are incomplete. Generic slide/tap overlap must never stand in for Umiyuri.

The other 35 seed entries retain their stated project/descriptive naming origins. This audit does not promote any of them to community-standard terminology. Project operational detectors can be tested against authored synthetic fixtures without claiming community or real-chart validation.

## Umiyuri: inspected evidence

### S6 — Surone's English tutorial

[The "Umiyuri Pattern" EXPLAINED](https://www.youtube.com/watch?v=DQgnFASwiOM), published 2025-06-13. The web reader returned an internal error. A browser fallback loaded the public video and exported its English **auto-generated** transcript; it was read through 14:15. Names in captions contain transcription errors. No raw video was downloaded. The actual gameplay portions were not watched frame by frame.

Relevant tutorial times:

- **3:59–7:12:** opening example uses simultaneous A1 tap/A8 star; half a beat later, A7 tap during the slide wait; at the next beat, A1/A8 recur while the prior slide starts and A1 becomes the next star; another half beat later, A2 tap. Head roles alternate as this repeats.
- **9:40–10:50:** original-chart example, then changed button positions and slide shape.
- **12:03–13:45:** variants can omit initial/intermediate intervening taps and change slide geometry. The auto-captioned chart name “refrain” and unnamed Ado chart are unresolved leads, not canonical mappings.

This supports phased recurrence beyond generic overlap. The presenter's practice advice is anecdotal; no measured training effect or occurrence benchmark is supplied.

### S8 — なめあ's illustrated explanation

[ウミユリ配置をゆる〜く解説](https://note.com/namea_chunibyo/n/n8c7bc59683ff), published 2025-02-07. Full article text read; its rhythm schematic and three successive chart images were visually inspected in the browser. The author explicitly limits the explanation to the opening of the first chorus of ウミユリ海底譚.

The schematic marks half-beat steps and alternating slide movement. Images labeled first-beat offbeat, second beat, and second-beat offbeat show a star/tap pair, an intervening single tap, then another pair with the previous slide launching. The first image's combo counter is approximately 301; this is an image locator, not an independently reconciled event index.

Inspected illustrations, linked without copying them into the product:

- [Rhythm schematic](https://assets.st-note.com/img/1738851711-glcJ8WVMLUSZRk5spPoz6y1X.jpg?width=1200)
- [First simultaneous pair](https://assets.st-note.com/img/1738852182-AHoEeCxNhJfSMgmbTF0tpvPk.jpg?width=1200)
- [Intervening tap](https://assets.st-note.com/img/1738852190-tp7bw5FTa1qGnOymekzlU9Yv.jpg?width=1200)
- [Next pair and launch](https://assets.st-note.com/img/1738852234-KGs6918ib2BJyVME3tucDaln.jpg?width=1200)

The author describes one possible hand strategy. This does not justify inferred compulsory hand assignments. A revision/hash, normalized event correspondence and exact audio/chart timestamps remain unverified.

### S7 — Japanese tutorial lead

[【maimai解説】ウミユリ配置について全部教えます【音ゲー×Vtuber】](https://www.youtube.com/watch?v=vzRYyKz9CNI). Direct web access returned an internal error. Its video/transcript was not reviewed in this audit; keep the handoff's title-only scope for this source.

### Rejected evidence transfer

[如月ゆかり's tenth-anniversary article](https://note.com/kisaragi_ykr/n/n2f87ee3602d2) was read. It discusses the author's **CHUNITHM** chart and its inspiration from maimai. Its measure numbers, related-chart examples and AIR mechanics must not become maimai reference occurrences. No maimai detector constraints were adopted from it.

## Candidate grammar and unresolved boundaries

The following is an inference from S6/S8 for a research prototype, not a validated general family definition:

1. Recurrent authored simultaneous onset pairs include a slide head and a separate button onset.
2. Successive pairs recur about one local beat apart; the prior head's slide begins moving at a later pair.
3. An intervening button onset occurs near the half-beat phase during the prior slide's wait; repeated slide-head roles change across the phrase.
4. Initial/final boundaries and skipped intervening onsets require separately specified variants. They must not be accepted by silently widening timing tolerance.

Keep spatial roles and path shape in evidence. The first reference permits a starting hypothesis, but it does not establish every valid rotation/reflection, connected-slide interpretation, shared-head case, alternate wait duration, minimum phrase length, or tolerance. Do not impose the original song's title or exact A1/A8 positions as a universal definition.

Before promotion, resolve canonical chart format/difficulty/revision, source hash and section timestamps; create independently labeled positives/hard negatives with shared phrase variants kept in one evaluation partition; test one-off overlaps, wrong launch phase, absent recurrence, changed head roles, and truncated boundaries. The handoff's proposed 20 positives/20 hard negatives and held-out targets remain unmet. Actual counts here: one original-song section visually inspected via explanatory stills, one tutorial transcript reviewed, **zero independently normalized real-chart occurrences**, **zero held-out positives/negatives**, and **zero real charts automatically tagged**. Precision, recall, source-catalog coverage and training effectiveness are unavailable.

## Parser and chart-source audit

These are observations of moving public branches on the review date, not selected dependency pins. An adoption requires an immutable revision plus code, packaged-asset, dependency and compatibility review.

| Source | Primary files inspected | Finding and disposition |
|---|---|---|
| PySimaiParser (S3) | [README](https://github.com/Choimoe/PySimaiParser), [LICENSE.txt](https://github.com/Choimoe/PySimaiParser/blob/main/LICENSE.txt), [pyproject.toml](https://github.com/Choimoe/PySimaiParser/blob/main/pyproject.toml) | License file read through GitHub connector: MIT, copyright 2025 Chσimσε. Metadata says version 0.2.3, Python >=3.7, no declared runtime dependencies; build dependencies include setuptools/wheel and optional development packages. Packaged slide geometry JSON exists in metadata but was not audited. README claims include timing, modifiers, shared heads and pseudo-simultaneity; those claims were not execution-tested. Candidate only. |
| MajSimai (S2) | [README](https://github.com/TeamMajdata/MajSimai), [MajSimai.csproj](https://github.com/TeamMajdata/MajSimai/blob/master/MajSimai.csproj), [package.json](https://github.com/TeamMajdata/MajSimai/blob/master/package.json) | Project metadata declares GPL-3.0-or-later and version 2.2.1; Unity package's license field is empty and repository metadata reports no detected license. The project references System.Runtime.CompilerServices.Unsafe 6.1.2. README documents connected/shared-head/no-head slides, waits and pseudo-simultaneity. Do not mistake the missing GitHub badge for permission to copy, or treat README support as verified compatibility. Not adopted. |
| MaiMuriDX (S4) | [README](https://github.com/Minepig/MaiMuriDX), [pyproject.toml](https://github.com/Minepig/MaiMuriDX/blob/master/pyproject.toml) | A static/dynamic interaction checker with configurable geometric/hand assumptions and documented possible render-mode false reports. Metadata declares Python ^3.11 and pygame ^2.5.2; no license declaration was observed in the inspected README/project metadata/root listing. An exhaustive license/code audit was not performed. Neither its code nor hand-model conclusions were adopted. |
| MaiDiffPredictor (S5) | [README](https://github.com/Choimoe/MaiDiffPredictor) | Author reports reliance on duration, average density and dataset statistics, with weak complex-pattern recognition. Its License section contains an unresolved placeholder. No model, training data, labels, learned weights or code were adopted; advertised skill dimensions are not coaching validation. |
| Simai collection (S1) | [Standard collection introduction](https://w.atwiki.jp/simai/pages/32.html) | Collection describes community transcriptions and explicitly warns that note placement, holds and slide speeds can differ from the game. Standard/DX lists are separate. No full-catalog coverage audit or redistribution/automated-use permission was established; no chart text was imported. Public accessibility and parser software licensing do not establish chart rights. |

At this initial audit checkpoint the implementation used authored fixtures and a
validated normalized-event input; no Simai parser had been adopted. This audit
does not authorize replacing it with an external package or publishing community
chart files.

## Public-transcription pilot addendum — 2026-09-10

The later user-requested [offline pilot](REAL_CHART_PILOT.md) acquired the public
Expert/Master bodies of ウミユリ海底譚 into ignored local research output and ran an
independently implemented strict fixed-BPM reader. No third-party parser code or
package was installed or executed. This supersedes the initial checkpoint's
zero-transcriptions-analyzed count, while leaving production catalog coverage
and all reviewed community-family counts unchanged.

Exact source-body hashes, 463/759 note totals, 16 reconciled onset groups and six
reconciled slide paths are recorded in that pilot. The previously illustrated
Master first-chorus section now has source-body/event correspondence at 60–64 s
notation time. Game-video/audio alignment, complete source fidelity, independent
family labels, positives/hard negatives and outcome evaluation remain unresolved.
These two research profiles cannot enter a reusable catalog or recommendations.

## Expanded study and contextual browsing

The [expanded study](REAL_CHART_STUDY.md) adds Starlight Disco Master, Garakuta
Doll Play Expert/Master, and メランコリック Master: six accepted transcriptions
across four songs including the unchanged Umiyuri pair. Three additional bodies
remain rejected and visible as unavailable. The exact hashes, written description
scopes and two new independently calculated section rubrics are recorded there.

The later explicit research-catalog path permits standalone inspection in Explore
while keeping unverified game identity and experimental project tags visible.
It does not admit these profiles into ordinary catalogs, private reports or
recommendations. No community-family detector or training claim is promoted.

## Complete-index baseline

The user-requested [corpus audit](SIMAI_CORPUS_AUDIT.md) extends acquisition to the
frozen Standard/DX indexes and records every advertised variant, including absent
links and empty or ambiguous chart sections. Acquisition and hermetic analysis
remain separate commands. Exact source snapshots, parser rejections, pattern
prevalence and sampled-neighbor results are local research evidence. Bulk parse
success does not extend the pilot's independently checked sections or establish
community-family accuracy, reuse permission, game fidelity or coaching outcomes.
