# Conditional rating and shortlist contract

This engine is opt-in. Every call requires an explicit `RatingPolicy`; it never
guesses a current release, region, applicable version group, or lamp bonus.
The engine uses the existing calculations and does not modify historical inputs
or the legacy selector.

Pass all eligible PBs, including uncounted entries, as `PersonalBest` values and
exact chart variants as `RatingChart` values. Recorded rates are the immutable
baseline. Callers must establish that these rates, constants, availability and
version names correspond to the supplied policy/cutoff; this module does not
reconcile a historical rate against a later ruleset. Unknown collection coverage
must use `complete=False`. Future-dated PBs are rejected when `as_of` is supplied.

`simulate_targets` preserves the stronger achievement, lamp and recorded chart
rate independently, then invokes the existing complete Old35/New15 simulation.
Multiple targets are evaluated together, so two replacements cannot both claim
the same pool floor. A tied candidate earns zero. A non-full but completely
observed pool is distinct from an incomplete PB collection. Incomplete or
unresolvable scenarios return `gain_if_achieved=None` and a separately labeled
snapshot result. No input object is mutated.

`rating_opportunities` returns all positive-gain configured coefficient
boundaries, the first 0.0001% increment that increases or enters rating, and an
AP-lamp objective when enabled. Decimal arithmetic and monotone binary search
preserve one-tick boundary jumps. The engine does not establish whether every
0.0001% value is attainable under a chart's judgment granularity; the minimal
target is a mathematical achievement threshold. Use `select_shortlist` to obtain
the bounded default of two rating, two practice and one discovery card, with
song diversity and honest evidence shortfalls. Smaller achievement steps are a
selection heuristic, not an attainment probability. The optional private adapter
can attach explicitly uncalibrated same-chart reachability labels from repeated
recent actual attempts; PB-only evidence remains unknown.

`structural_card` accepts explicit supported match evidence from the similarity
adapter. Practice needs an exact target-pattern occurrence, a supported lower mean
rate within the selected runs, and bounded surrounding demand; a lower whole-chart
mean caused by added silence cannot qualify. These are candidate
practice settings: prerequisites, context difficulty and skill transfer remain
unverified. Cards retain feature differences, occurrence windows, Flow, limitations
and an `alternative_query` for the reusable Explore component.

`scoring.py` implements the inspectable eight-term experimental practice policy,
private `PracticeGoal`/`Prerequisite` inputs and attempt-only reachability heuristic.
Selection ranks conservative score bounds and recomputes context diversity.
Unknown observations retain null values and explicit scoring-term coverage.
See [the full scoring audit and contract](../../../docs/source-notes/SCORING_ENGINE_STATUS.md)
for weights, thresholds, CLI inputs, synthetic review fixtures and remaining gaps.

## Source check, 2026-09-10

- [SEGA's Japanese CiRCLE announcement](https://info-maimai.sega.jp/7725/), dated
  2025-09-08, explicitly establishes the changed New15 scope (previous/current
  version) and one-point bonus for AP or better. This is not evidence that every
  region or earlier release uses that policy. The
  [CiRCLE PLUS announcement](https://info-maimai.sega.jp/8674/) was also checked;
  it does not provide a complete numeric coefficient table.
- The [mai-tools rank definitions](https://github.com/myjian/mai-tools/blob/gh-pages/src/common/rank-functions.ts)
  and [rating functions](https://github.com/myjian/mai-tools/blob/gh-pages/src/common/rating-functions.ts)
  provide a community reference. The reviewed source blobs are
  `8daceb4b520951c006d1c5f2a3d0253991f03eb8` and
  `834e3df8de302f43c5926557f3316767bb14e76a`, respectively.
  This is a community-maintained primary implementation, **not an official SEGA
  numeric formula publication**. It has distinct jumps at 79.9999, 96.9999,
  98.9999, 99.9999 and 100.4999, as well as ordinary rank thresholds; the old
  frontend's simplified table omits these. No source code or dependency from
  that project was copied or installed. A fully authoritative coefficient audit,
  especially low-achievement behavior and region/release applicability, remains
  open. There is intentionally no automatic live-game coefficient policy here.

Policies declare `verification: synthetic` or `reviewed_reference` and safe local
`source_ids`. This field records the caller's evidence assertion, not automatic
verification by the parser. Build-time source URLs stay in documentation rather
than the sealed report. Bundled tests use an intentionally invented synthetic
coefficient schedule, not copied scores or charts.

The tests cover both pools, complete/non-full versus incomplete collections,
counted/uncounted/no-result charts, one-tick thresholds, caps/AP changes, stronger
PB retention, tied zero gain, combined replacements, unknowns, input immutability,
historical cutoff and shortlist evidence gates. Real-chart outcome calibration
and the full-pool recommendation performance benchmark are outstanding.
