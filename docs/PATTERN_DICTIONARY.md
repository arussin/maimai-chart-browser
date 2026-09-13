# Completing the pattern dictionary

The current implementation has **56 English lessons: 42 patterns and 14 chart
traits**, with English search aliases shared by dictionary and chart discovery.
The 0.3.0 extension adds ten named community motifs and ten structural forms,
each with an authored positive, confusing negative, and explicit experimental
recognition scope. Named forms retain community attribution. Neither their
names nor their reference songs substitute for event-based recognition.
See [the additions, reference passages and validation](patterns/COMMUNITY_PATTERNS.md).

The remaining sections document the earlier 0.2.0 pass and its baseline mapping;
they are historical results, not claims about a newly published release.

## Original 0.2.0 teaching pass

The dictionary has 36 lessons: 22 patterns and 14 chart traits. All 36 now have
an authored example and a contrasting example, explanatory text, variants and
limits, and interactive playback. This completes the authored teaching pass;
independent teaching review and real-chart labeling remain outstanding.

All 36 entries now have explicit experimental recognition rules and authored
positive/negative checks. Independent teaching review and held-out real-passage
accuracy evaluation remain separate qualifications. See the complete
[0.2.0 recognition report](patterns/RECOGNITION_0.2.0.md).

## Current research chart mapping

The browser prepares all 6,959 retained charts with 36 experimental pattern/trait
detectors and Flow calculation. Every assignment
joins an exact chart ID and source hash. Rows, difficulty choices, pattern
filters and dictionary discovery use those observations. Chart details include
counts, partial-coverage labels and up to four representative time spans.
Comparisons show shared/differing observations, occurrence rates and shared-scale
activity graphs; an optional ranking gives pattern similarity the greater weight.

The new release is `research-8295bb80a71d`. All 36 types have matching chart
variants. Shape traits explicitly use the observed chart span without inventing
leading or trailing audio silence. Umiyuri covers one documented recurring-pair
form and finds 17 chart variants; it does not claim every community variant.
Isolated sections identify their target pattern, and repeated motifs retain
their phrase identities. All original Flow data and 62,631 results from the
original nine input detectors are unchanged.

This remains research discovery, not independent label qualification.
Supported non-detection, partial coverage and unknown detection remain distinct.
Compact storage preserves all results and keeps the public payload within the
existing 32 MiB limit. Earlier immutable catalog versions remain available.

## Finish the teaching reference

Completed in this pass:

- [x] Plain-language summaries, what to watch, contrasting explanations and
  variant/limit notes for all 36 entries.
- [x] All 72 example/contrast diagrams with Play, Pause, Step, Restart, speed and
  progress controls. Steps use event times, hold boundaries and slide phases.
- [x] Input-position diagrams for note sequences; activity graphs and highlighted
  intervals for chart traits. Comparison graph axes retain one shared scale.
- [x] A textual current-event readout and slider description, keyboard operation,
  reduced-motion support and mobile reflow.
- [x] Distinct name origins, a scoped Umiyuri explanation with source links, and
  explicit separation from real-chart assignments.
- [x] Authored-fixture checks of timing contrasts, shared slide heads, triplet
  spacing, break subsets and the narrow Umiyuri recurrence grammar.
- [ ] Independent teaching review, including rhythm terminology, visual clarity,
  meaningful counterexamples and coverage of community variants.

The 21 previously missing descriptive demos are now included:

- Rhythm: gallop pairs, three-note bursts, triplet grid and offbeat onsets.
- Coordination and layout: chord streams, tap staircases, perimeter runs and
  direction reversals.
- Mixed inputs: staggered slide starts, variable slide waits, hold/slide overlap
  and touch/tap interleaving.
- Chart traits: high onset density, sustained density, isolated density spikes,
  multiple density peaks, low-onset gaps, break concentration, variable onset
  spacing, repeated motifs and isolated pattern sections.

The previous 14 demos now also have contrasts, revised explanations and explicit
timing models. No compulsory hand strategies are inferred.

Umiyuri is not starting from zero. The retained [source audit](source-notes/CHART_SOURCE_AUDIT.md)
records a tutorial transcript, inspected explanatory stills and a narrow
candidate grammar. The new authored lesson shows four recurring star/tap pairs,
intervening taps, alternating head roles and previous-slide launches at the next
pair. It matches the existing narrow research detector in a synthetic fixture;
generic tap/slide overlap is its contrast. It does not define all omissions,
geometries or phrase boundaries and is not presented as a song transcription.
The source article and tutorial transcript remain retained audit evidence.
The 0.2.0 mapping run uses the same retained, hash-verified corpus; it requires
no new downloads, personal-score imports or historical backfill.

## Add reliable chart examples and discovery

Teaching definitions and automatic chart tags have different completion gates.
To connect the dictionary to real charts:

1. Record exact chart ID, format, difficulty, source revision/hash and section
   boundaries for reviewed examples and confusing non-examples.
2. Review the labels independently, preserving disagreements. For Umiyuri, the
   earlier proposed starting set of 20 positives and 20 hard negatives remains
   unfulfilled; those counts alone would not validate the detector.
3. Maintain the implemented detectors' checks for recurrence, timing tolerances,
   boundaries, permitted transformations and misleading overlaps. Keep related
   passages out of both the development and held-out evaluation sets.
4. Measure precision and recall on the held-out examples, inspect mistakes, and
   record the evidence and limitations for each detector.
5. Only then promote the relevant research observations to qualified labels and
   expose validated discovery or training claims. Experimental browsing does not
   pass this gate; new detectors need their own evaluation before promotion.

The operational recognition and versioned mapping pass is complete. Independent
teaching review and labeled real-chart evaluation remain the next qualification
work; they must not be presented as finished or assigned invented accuracy scores.
Personal recommendations still require the separate reviewed catalog
mapping and recommendation qualifications.

## Maintaining the lessons

`scripts/build_pattern_lessons.py` is the authored source for the bundled
`pattern-lessons.json` asset. Its version is `pattern-lessons-1`. Rebuild the asset
after changing lesson content, then run the Python lesson checks and browser
lesson playback checks. This is presentation data: it must never be used as
independent detector evaluation or automatically joined to catalog charts.
