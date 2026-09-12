# Completing the pattern dictionary

The dictionary has 36 lessons: 22 patterns and 14 chart traits. All 36 now have
an authored example and a contrasting example, explanatory text, variants and
limits, and interactive playback. This completes the authored teaching pass;
independent teaching review and real-chart labeling remain outstanding.

Missing demo, draft definition and unvalidated detection are separate states.
The browser shows the teaching content directly. Detector status is unchanged:
14 experimental primitives exist, and broader or community-named detection is
not promoted by adding these illustrations.

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
The source article was reread for this pass; the tutorial transcript remains the
retained audit evidence. This work required no full-catalog analysis run.

## Add reliable chart examples and discovery

Teaching definitions and automatic chart tags have different completion gates.
To connect the dictionary to real charts:

1. Record exact chart ID, format, difficulty, source revision/hash and section
   boundaries for reviewed examples and confusing non-examples.
2. Review the labels independently, preserving disagreements. For Umiyuri, the
   earlier proposed starting set of 20 positives and 20 hard negatives remains
   unfulfilled; those counts alone would not validate the detector.
3. Implement missing detectors and test recurrence, timing tolerances, boundaries,
   permitted transformations and misleading overlaps. Keep related passages out
   of both the development and held-out evaluation sets.
4. Measure precision and recall on the held-out examples, inspect mistakes, and
   record the evidence and limitations for each detector.
5. Only then run the qualified detectors over the retained catalog and expose
   chart links, passage demos and pattern filtering for the validated coverage.

The next checklist work is independent teaching review and labeled real-chart
evaluation. Another catalog-wide processing step follows qualified detector
evaluation. Personal recommendations still require the separate reviewed catalog
mapping and recommendation qualifications.

## Maintaining the lessons

`scripts/build_pattern_lessons.py` is the authored source for the bundled
`pattern-lessons.json` asset. Its version is `pattern-lessons-1`. Rebuild the asset
after changing lesson content, then run the Python lesson checks and browser
lesson playback checks. This is presentation data: it must never be used as
independent detector evaluation or automatically joined to catalog charts.
