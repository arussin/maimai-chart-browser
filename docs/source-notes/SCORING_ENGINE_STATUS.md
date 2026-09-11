# Scoring engine audit and implemented scope

The audit started at `f541a57061f6ee595d8413c20490689d3dc24e5c` against
`CHART_INTELLIGENCE_SPEC.md`, especially sections 10.1–10.4. At that revision,
the chart analyzer and conditional rating simulator existed, but the proposed
practice scoring engine did not. `structural_card` checked supporting occurrences
and lower whole-chart demand; `select_shortlist` consumed practice input order
with song quotas. Every reachability result was unknown. Describing that state
as the complete discussed scoring engine would have overstated the implementation.

## What the engines actually do

| Contract area | Implemented behavior | Remaining limitation |
| --- | --- | --- |
| Chart measurements and Flow | Hermetic normalized events, separate onset/wait/movement measures, partial coverage, 250 ms grid and 24 Flow segments, inspectable provisional demand weights; expanded Simai notation adapter for offline research | Chart demand is not a player ability score. No universal/native-game parser, complete game corpus, learned difficulty model, or calibrated game difficulty |
| Pattern evidence | Fourteen experimental project-defined primitives with actual occurrence evidence; remaining proposed seed entries disabled | No validated community-named detector, including Umiyuri; the isolated public-transcription studies do not measure detector accuracy or training outcomes |
| Conditional rating | Complete eligible Old/New pool simulation, retained PB rates, configured thresholds and minimal increments, independent lamp upgrades, competing replacements | Requires explicit release/region policy and complete mapped PB collection. Bundled policies are invented synthetic examples, not verified current game coefficients |
| Practice calculation, section 10.3 | Selected goal, supported local pattern-rate gate, eight recorded preference terms, uncertainty bounds, deterministic ranking and context diversity | Weights, thresholds and prerequisite relationships are unvalidated engineering choices. Occurrence windows are opportunities for review, not demonstrated useful practice repetitions |
| Reachability, section 10.2 | Conservative same-chart labels from distinct retained attempts; PB-only and inadequate evidence remain unknown | No probabilities, trained model, cross-chart attainment prediction, or calibrated learning/transfer outcomes |
| Goals and output, section 10.1 | Private goal/prerequisite JSON, category quotas, explanation fields, actual supporting windows, Flow and alternative queries | No inferred personal weakness, physiological diagnosis, persistent practice queue, or automatic goal tracking |
| Evaluation, section 10.4 | Synthetic counterfactuals, cutoff/dedup tests, ordering/diversity tests and computed review fixtures | No real chronological outcome evaluation, recommendation adoption study, cross-user training or causal skill-transfer evidence |

## Practice policy

The [public-transcription pilot](REAL_CHART_PILOT.md) reconstructs Expert/Master
note counts and checks one timed section. It does not run player recommendations,
change production catalog coverage, or calibrate this scoring policy.

The [expanded study](REAL_CHART_STUDY.md) adds Starlight Disco, Garakuta Doll Play
and メランコリック, with six accepted charts across four songs and two additional
passage checks. It uses a flagged standalone Explore pack; private report and
recommendation inputs reject that pack. These are structural checks, not a new
player-outcome evaluation. Targets now presents the existing engine output as
compact goal/gain, PB, readiness and practice cards with Flow/Similar actions.
Targets no longer exposes a scoring-detail action; the prepared engine output
retains those measurements for offline evaluation.

The [complete-index corpus baseline](SIMAI_CORPUS_AUDIT.md) separately measures
public source availability, strict-parser coverage and sampled structural
neighbors. It does not run private Targets or validate recommendation outcomes.
The [expanded notation replay](SIMAI_NOTATION_SUPPORT.md) measures recovered
source coverage against the same frozen bodies; parsing success does not extend
the six-chart study's independent section checks to the rest of the corpus.

`practice-evidence-v1-experimental` is defined in
`src/maimai_report/recommendations/scoring.py`. It does not replace the analyzer's
separate estimated-demand composite or any rating formula.

| Term | Weight | Observation or preference |
| --- | ---: | --- |
| Relevance | +0.25 | `1 - structural_distance`, only for a supported selected-pattern match with at least 60% shared structural coverage |
| Repetitions | +0.15 | `min(separate_observed_windows / 4, 1)`. Duplicate and overlapping occurrence windows merge; one long run is one window, regardless of note count |
| Isolation | +0.15 | Duration-weighted `1 / (1 + max(concurrency - 1, 0) + hold_occupancy + movement_occupancy + wait_occupancy)` in supporting sections |
| Prerequisite readiness | +0.15 | Available only when every explicitly selected exact-chart objective has two qualifying actual attempts at least 24 hours apart in the previous 30 days |
| Source confidence | +0.10 | Equal preference credit for explicit permitted source, resolved identity, supported timing, reviewed definition and reviewed detector. Current synthetic experimental occurrences receive 3/5, not reviewed-definition/detector credit |
| Freshness | +0.05 | Days since the latest **supplied attempt**, divided by 14 and capped at one. A missing attempt history remains unknown, not unplayed |
| Diversity | +0.05 | `1 / (1 + selected_cards_with_overlapping_context_patterns)`. The explicitly selected goal pattern is exempt; one card per song remains a hard rule |
| Retry saturation | −0.10 | Only with at least six actual attempts in seven days: `min((count - 3) / 5, 1)` when the later half's best improves by at most 0.1 achievement points; otherwise zero |

Every term returns its name, status, value, weight, contribution, reason and
supporting measurements. An unknown term has `value: null` and
`contribution: null`. `score` is the sum of supported contributions in preference
points. It is neither a percentage nor an ability measure. Unknown term values
span `[0,1]`, creating explicit lower and upper score bounds. `ranking_score` is
the conservative lower bound; missing positive evidence does not earn credit,
and a missing retry observation does not imply zero saturation.

`coverage` is the sum of absolute weights with observed term values. It describes
**scoring-term evidence coverage**, independently of chart-analysis coverage or
source accuracy. No renormalization makes missing evidence appear complete.

The source-confidence term records provenance quality preferences. A value of
0.6 is not 60% detector accuracy, real chart coverage, or a probability.
Prerequisite demonstrations establish only those user-selected outcomes in the
supplied records. Their relationship to the target skill remains unvalidated;
missing demonstrations do not establish that a player lacks the skill.

Section isolation is a coarse context proxy and can include the target pattern's
own activity. All selected occurrence time must have measured context. Overlapping
sections use the highest observed activity, and unknown overlapping context
remains unknown. A sorted endpoint sweep avoids a Cartesian scan. More than
20,000 occurrence/section intervals makes isolation unknown with an explicit
budget flag; other score terms remain available. Low isolation below 0.25 changes
the card's role to an uncertain transfer test rather than an isolated learning
setting.

## Selected-pattern demand gate

A lower whole-chart average can result from longer silence while the target
pattern gets faster. It cannot establish a simpler setting for that pattern.
Practice cards require the directed similarity policy's supported local timing
relation in addition to its global prerequisite bounds.
The relation's metric ID is `mean_onset_cadence_within_selected_runs`.

The first local rule supports version 0.1.0 two-position alternation and
same-position repetition occurrences, whose detector emits `[first, last+1 us)`
and `onset_count`. The mean within a run is
`(onset_count - 1) * 1,000,000 / (end_us - start_us - 1)`.
Tags must have complete, untruncated coverage and all occurrence windows must be
retained. Every candidate run's mean must be at least 5% below every query run's
mean. The output retains the selected local relation. This concerns mean run
timing, not global ease or a claim about every instantaneous interval.

Other pattern-local dimensions or missing local timing are withheld. They are
not replaced with whole-chart averages or unrelated surrounding note density.
The additional global bounds remain conservative checks, not evidence of player
readiness.

The adapter evaluates adequate practice candidates in batches of at most 100
charts rather than scoring only the nearest 20. It retains the best qualifying
anchor per candidate and reuses candidate/history terms if that anchor changes.
Disabled quota categories skip retrieval. Selection removes already-selected
songs before recomputing diversity, so a song shortfall cannot trigger repeated
quadratic rescoring.

## Attempt-based reachability

`same-chart-attempts-v1-experimental` uses only stable actual attempt IDs on the
exact candidate chart. Identical IDs deduplicate; conflicting duplicates and
future-dated records fail. A PB snapshot is never accepted as an attempt.
Unknown dates or lamps cannot establish repeatability. The overlay's empty lamp
representation becomes unknown, not a parse failure or a CLEAR claim.

For an explicit achievement/lamp objective, the rule considers at most the latest
20 usable attempts from 30 days. It requires at least five distinct attempts
spanning 24 hours, a usable attempt in the last 14 days, an observed achievement
range no greater than one point, and at least two demonstrations of the requested
lamp. Otherwise reachability remains unknown.

- **Near-term heuristic:** target at most 0.2 points above the recent median,
  with range at most 0.6 points.
- **Plausible heuristic:** target at most one point above the median and at most
  0.5 points above the best considered attempt.
- **Stretch heuristic:** the other cases that pass the evidence gate.

These manually chosen boundaries only describe the supplied performance record.
They are not calibrated probabilities or advice that a target will be achieved.
Rating gain remains conditional and separate. An AP objective without repeated
observed AP lamps stays unknown. A structural practice goal without an explicit
achievement objective also stays unknown. No cross-chart reachability is inferred
from similar descriptors.

## Explicit private inputs

`prepare_recommendations(..., practice_goal=..., quotas=(2,2,1))` accepts a
`PracticeGoal` or this allowlisted mapping:

```json
{
  "pattern_id": "pattern.two_position_alternation",
  "target_achievement": 97,
  "target_lamp": "CLEAR",
  "prerequisites": [
    {"chart_id": "synthetic:orbit:STD:EXPERT:r1", "target_achievement": 99}
  ]
}
```

Only `pattern_id` is required. Unknown keys, duplicate prerequisite chart IDs,
unresolved catalog IDs and invalid goals fail. The goal remains in the private
recommendation result; it is never added to the reusable chart catalog. A
`practice_pattern` argument alone creates a default explicit goal. Conflicting
pattern IDs fail.

The existing local `render --explore-pack PACK` path accepts:

- `--practice-goal GOAL.json` for the private goal above;
- `--attempts ATTEMPTS.json` for `{ "attempts": [...] }` containing explicitly
  supplied provider score records (`scoreID`, `chartID`, `timeAchieved`,
  `scoreData.percent`, optional `scoreData.lamp`);
- `--target-quotas RATING PRACTICE DISCOVERY`, three integers in `0..20`.

These options require the explicit Explore pack. They perform no score import,
account fetch or network request. No attempt file means no invented attempts.
The existing adapter retains only records at the report cutoff, and the renderer
independently enforces that cutoff. New optional render inputs cannot alias the
output. Development and tests use authored synthetic input only.

## Computed review fixture and test evidence

`tests/recommendation_fixture.py:scoring_fixture` runs the actual analyzer catalog,
rating simulator, private adapter and scorer. It uses the six authored chart
profiles plus the explicitly missing catalog entry, an invented coefficient
policy, fictional PBs and separate fictional attempts. It does not hand-author
recommendation cards. The lower-rate Orbit variant deliberately has no constant
in this fixture, exercising structural recommendations independent of rating.

The default result contains two conditional rating cards and one practice card.
There is only one adequate structural alternative in this tiny corpus, and song
diversity prevents placing it in both practice and discovery. Shortfalls stay
visible. With `(2,0,1)` quotas the computed third card is discovery. There are no
fabricated extra candidates to reach five cards.

`tests/test_scoring_engine.py` covers term sensitivity, missing evidence and bounds,
overlapping windows/context, work bounds, explicit prerequisites, freshness and
retry observations, deterministic diversity, cutoff/deduplication, reachability
unknowns, API and local CLI integration, and the computed review fixture. Existing
rating tests retain both-pool, incomplete-input, threshold, AP, stronger-PB and
competing-replacement checks. Directed similarity tests include a hard negative
whose global mean falls through extra silence while its selected pattern speeds
up. These tests verify engineering behavior, not empirical training effectiveness.
