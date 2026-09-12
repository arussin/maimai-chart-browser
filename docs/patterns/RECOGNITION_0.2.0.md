# Experimental pattern recognition 0.2.0

Every dictionary entry has an explicit recognition rule and authored positive/negative checks.
The pinned research catalog has 6,959 chart variants; every one of the 36 types has at least one detected example.
This reports implementation coverage, not independently measured precision or recall.

| Pattern or trait | Charts with a match |
| --- | ---: |
| Umiyuri pattern | 17 |
| Trill / two-position alternation | 1,207 |
| Repeated-button notes | 5,218 |
| Gallop notes | 1,299 |
| Three-note burst | 1,174 |
| Triplet-grid sequence | 754 |
| Offbeat-onset run | 806 |
| Simultaneous-note group | 6,937 |
| Repeated simultaneous groups | 5,858 |
| Button staircase | 3,624 |
| Perimeter run | 1,622 |
| Direction-reversal run | 747 |
| Shared-head slide fan | 1,790 |
| Staggered slide starts | 477 |
| Overlapping moving slides | 4,869 |
| Slide/tap interleave | 2,898 |
| Tap-while-slide-waits | 5,065 |
| Changing slide waits | 2 |
| Connected slide chain | 860 |
| Hold/tap interleave | 3,699 |
| Hold/slide overlap | 2,153 |
| Touch/button interleave | 28 |
| High onset density | 1,511 |
| Bursty density | 6,921 |
| Sustained density | 1,063 |
| Backloaded density | 374 |
| Frontloaded density | 7 |
| Isolated density spike | 661 |
| Multiple density peaks | 2,416 |
| Steady density | 173 |
| Low-onset gaps | 6,338 |
| Break-note concentration | 475 |
| Variable onset spacing | 1,501 |
| High moving-slide occupancy | 6 |
| Repeated motif | 2,369 |
| Isolated pattern sections | 6,804 |

## Recognition rules

Rules use normalized events, rational beat positions and half-open time intervals.
They never infer which hands a player must use. A chart title never establishes a match.
The dictionary displays the rule retained in the selected catalog release.

### Umiyuri pattern

Scoped recurring-pair form: at least four one-beat star/tap pairs at two positions, alternating which position is the star, with exactly one intervening tap at each half beat. The previous slide launches at the next pair within two microseconds of timing rounding. Each star links one path; extra intervening inputs break the form. Rotation, reflection and path shapes are unrestricted; omitted taps and changing pair positions are outside this version. This is an experimental form of the named family, not a complete or independently reviewed community classifier.

Definition 0.2.0; required data: timing, beat_grid, positions, authored_simultaneity, slide_movement, slide_wait, slide_groups.

### Trill / two-position alternation

At least six monophonic A/B onsets, distinct buttons, exactly equal rational beat gaps no greater than one beat and no greater than one second. Split at simultaneous onsets.

Definition 0.1.0; required data: timing, positions, beat_grid.

### Repeated-button notes

At least three consecutive monophonic button onsets at one position, each positive gap at most one second. A sustained hold is a single onset.

Definition 0.1.0; required data: timing, positions.

### Gallop notes

At least three single-input short-long pairs with exact recurring beat gaps, a long/short ratio of 2 or 3, a short gap at most half a beat, and every gap at most one beat and one second. Simultaneous inputs split a run.

Definition 0.2.0; required data: timing, beat_grid.

### Three-note burst

Exactly three consecutive single inputs, each inner gap at most a quarter beat and 250 ms. Both neighboring gaps must be at least half a beat and twice the larger inner gap; clipped boundary triples do not qualify.

Definition 0.2.0; required data: timing, beat_grid.

### Triplet-grid sequence

At least six consecutive single inputs on the authored beat grid, equally spaced by 1/3, 1/6 or 1/12 beat, with every gap at most one second. A three-note burst alone is insufficient; no audio downbeat is inferred.

Definition 0.2.0; required data: timing, beat_grid.

### Offbeat-onset run

At least four consecutive single inputs at the half-beat phase of the authored grid, exactly one beat apart and at most two seconds apart. This is a notation-grid observation, not a claim of musical syncopation.

Definition 0.2.0; required data: timing, beat_grid.

### Simultaneous-note group

Two or more distinct input onsets with one explicit authored simultaneous-group ID. Equal timestamps alone are insufficient.

Definition 0.1.0; required data: timing, authored_simultaneity.

### Repeated simultaneous groups

At least three consecutive authored simultaneous groups, each containing at least two inputs, with equal positive beat gaps no greater than one beat or one second. Group sizes and button shapes may differ.

Definition 0.2.0; required data: timing, beat_grid, authored_simultaneity.

### Button staircase

A maximal run of four to seven single tap/star inputs stepping to adjacent buttons in one circular direction. Gaps are at most one beat and one second. Runs of eight or more inputs are perimeter runs instead.

Definition 0.2.0; required data: timing, beat_grid, positions.

### Perimeter run

At least eight consecutive single tap/star inputs visiting the full button ring in one direction, with adjacent steps and gaps at most one beat and one second. Circular wraparound is retained.

Definition 0.2.0; required data: timing, beat_grid, positions.

### Direction-reversal run

A consecutive single tap/star neighbor run changes direction after at least two steps and continues at least two steps in the opposite direction. Gaps are at most one beat and one second; a two-position trill is excluded.

Definition 0.2.0; required data: timing, beat_grid, positions.

### Shared-head slide fan

At least two path IDs sharing one existing star-tap head; count that input once.

Definition 0.1.0; required data: timing, slide_groups, slide_movement.

### Staggered slide starts

A connected interval contains at least two moving slide paths with different movement start times. Waiting stars alone and paths that only touch at an endpoint do not qualify. Shared-head branches may qualify.

Definition 0.2.0; required data: timing, slide_movement.

### Overlapping moving slides

Maximal connected intervals with at least two active half-open slide movements; touching endpoints do not overlap.

Definition 0.1.0; required data: timing, slide_movement.

### Slide/tap interleave

At least one independent tap/star input inside a half-open slide movement. Generic interaction only; this is not an Umiyuri recognizer.

Definition 0.1.0; required data: timing, slide_movement.

### Tap-while-slide-waits

At least one independent tap/star input inside a half-open slide wait, excluding its own shared head and the wait-end boundary.

Definition 0.1.0; required data: timing, slide_wait.

### Changing slide waits

At least three consecutive distinct slide heads have positive waits whose lengths differ by at least a quarter beat, allowing two microseconds of clock rounding. Heads are at most four beats and four seconds apart. A tempo map is required; equal beat waits at changing BPM are not variable waits. Heads whose branches have different waits split the sequence.

Definition 0.2.0; required data: timing, beat_grid, slide_wait, slide_groups.

### Connected slide chain

One normalized path with at least two explicitly ordered connected segment IDs. Segments never create additional physical input onsets.

Definition 0.1.0; required data: timing, slide_groups, slide_movement.

### Hold/tap interleave

At least one independent tap/star input during a half-open held interval.

Definition 0.1.0; required data: timing, hold_intervals.

### Hold/slide overlap

A positive-length, half-open held interval overlaps a slide's movement. Waiting slides and touching endpoints do not qualify. No mandatory hand assignment is inferred.

Definition 0.2.0; required data: timing, hold_intervals, slide_movement.

### Touch/button interleave

At least four consecutive single inputs alternate between a touch/touch-hold onset and a tap/star button input, with positive gaps at most half a beat and one second. Simultaneous touch/button chords do not count as alternation.

Definition 0.2.0; required data: timing, beat_grid, touch_zones.

### High onset density

A complete one-second window contains at least 12 physical input onsets at four or more distinct times. Windows advance by 250 ms; overlapping hits merge. This absolute threshold describes input rate, not player difficulty.

Definition 0.2.0; required data: timing.

### Bursty density

Fully covered chart spans at least four seconds and has at least eight onsets; 250 ms peak density is at least twice the chart mean and exceeds it by four onsets/s. Measured over the observed chart span; unknown leading/trailing audio silence is excluded.

Definition 0.2.0; required data: timing.

### Sustained density

At least four consecutive complete one-second bins each contain eight or more inputs at four or more distinct times. Bins start at the observed chart start. Missing time or a lower-density bin splits a stretch.

Definition 0.2.0; required data: timing.

### Backloaded density

Fully covered chart has at least eight onsets; final-third onset rate is at least 1.5 times first-third and at least two onsets/second greater. Not a hard-ending claim. Measured over the observed chart span; unknown leading/trailing audio silence is excluded.

Definition 0.2.0; required data: timing.

### Frontloaded density

Fully covered chart has at least eight onsets; first-third onset rate is at least 1.5 times final-third and at least two onsets/second greater. Measured over the observed chart span; unknown leading/trailing audio silence is excluded.

Definition 0.2.0; required data: timing.

### Isolated density spike

Exactly one interior group of one-second bins reaches at least eight inputs/s and twice the median bin count of a fully observed chart span. Lower bins bracket it; a peak is not a difficulty or scoring claim.

Definition 0.2.0; required data: timing.

### Multiple density peaks

Two or more interior groups meet the same peak rule: at least eight inputs/s and twice the median one-second bin count, with a lower bin on both sides and at least one lower bin between groups, over a fully observed chart span.

Definition 0.2.0; required data: timing.

### Steady density

Fully covered chart spans at least four seconds and has at least eight onsets; 24 segment density coefficient of variation is at most 0.2, with positive mean. Measured over the observed chart span; unknown leading/trailing audio silence is excluded.

Definition 0.2.0; required data: timing.

### Low-onset gaps

At least two consecutive complete one-second bins contain at most one new input each, in a chart with at least four observed inputs. Ongoing holds and slides may remain, so this does not claim a rest or recovery opportunity.

Definition 0.2.0; required data: timing.

### Break-note concentration

A four-second window contains at least four break inputs, at least 40% of the chart's break inputs, and a break fraction of at least 25% and 1.5 times the chart-wide fraction. Windows advance by one second; overlapping hits merge. Counts concern break input flags, not rating-weighted scoring objects.

Definition 0.2.0; required data: timing, note_flags.

### Variable onset spacing

At least 12 consecutive single inputs have positive gaps no greater than one beat or one second, two or more distinct beat gaps, coefficient of variation at least 0.35, and changed spacing at at least 35% of transitions. Beat units prevent tempo changes alone from creating variability.

Definition 0.2.0; required data: timing, beat_grid.

### High moving-slide occupancy

At least one moving path occupies at least half of the fully covered chart span; overlapping paths do not double the occupied duration. Measured over the observed chart span; unknown leading/trailing audio silence is excluded.

Definition 0.2.0; required data: timing, slide_movement.

### Repeated motif

Two disjoint eight-onset-group phrases, spanning two to eight beats, have the same beat gaps, input roles, positions, flags, hold lengths and slide wait/movement lengths and source path strings. Phrases require at least two input positions or roles; single repeated-button streams are excluded. Slide paths must be present. Exact layout only; no reflection or playable-strategy equivalence is inferred.

Definition 0.2.0; required data: timing, beat_grid, positions, note_flags, hold_intervals, slide_wait, slide_movement, slide_groups.

### Isolated pattern sections

A supported input pattern spanning at least 250 ms and three inputs has no unrelated overlapping hold/slide movement, at most 20% extra inputs inside it, and at most two extra inputs in its half-second surroundings. This is target-specific isolation, not evidence of training effectiveness.

Definition 0.2.0; required data: timing, hold_intervals, slide_movement.

## Validation and limits

- The 397-test Python suite passes (seven existing optional checks skipped); code style checks pass.
- Across all 6,959 retained charts, exact source joins, Flow spans and segments, and all 62,631 results from the original nine input detectors are unchanged.
- Six authored profiles preserve their metrics and Flow; the original rating and recommendation fixture remains identical.
- The scoped Umiyuri form finds four six-pair runs in the retained Master chart; Basic, Advanced and Expert have none. This is a development regression, not a held-out accuracy result.
- Missing capabilities or unknown time cannot establish supported absence. Unknown, complete absence, partial positives and truncated evidence remain separate through the compact format.
- All 6,959 tag matrices were compared before and after storage compaction, including occurrence times, target patterns and motif identities. No observations or Flow samples were removed.
- Browser checks covered all 36 discovery buttons, real Umiyuri search/mapping/highlighting, pattern comparison, mobile reflow, keyboard stepping/focus return, and an older catalog link. No browser errors were recorded.
- All 36 lessons retain their examples and contrasts. New chart matches remain experimental, with independent teaching review and held-out passage labels pending.
- Research source/game identity and content-use qualifications are unchanged. These assignments do not qualify personal recommendations.

See [coverage data](coverage-0.2.0.json), [Umiyuri regression](umiyuri-regression.json), and [the source audit](../source-notes/CHART_SOURCE_AUDIT.md).
