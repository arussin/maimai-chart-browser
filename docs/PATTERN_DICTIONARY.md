# Completing the pattern dictionary

The dictionary has 36 entries: 22 patterns and 14 chart traits. Fourteen have
authored schematic demos and experimental detectors; 22 have no demo. Of those
22, 21 already have proposed descriptive definitions. Umiyuri is the one
community-named entry whose exact family definition remains unresolved.

Missing demo, draft definition and unvalidated detection are separate states.
The browser now shows each written definition instead of using a generic
"definition under review" placeholder for every missing demo.

## Finish the teaching reference

Each entry should have a short plain-language explanation, an explicit example,
a contrasting example that does not qualify, a playable/steppable illustration,
and notes on meaningful variants. Name origins and references should distinguish
community terminology from this project's descriptive names. Density traits
need timelines or graphs; they should not be presented as button patterns.

The 21 descriptive entries needing demos are:

- Rhythm: gallop pairs, three-note bursts, triplet grid and offbeat onsets.
- Coordination and layout: chord streams, tap staircases, perimeter runs and
  direction reversals.
- Mixed inputs: staggered slide starts, variable slide waits, hold/slide overlap
  and touch/tap interleaving.
- Chart traits: high onset density, sustained density, isolated density spikes,
  multiple density peaks, low-onset gaps, break concentration, variable onset
  spacing, repeated motifs and isolated pattern sections.

The existing 14 demos also need counterexample illustrations and a teaching
review. Having an experimental detector does not establish a useful explanation
or compulsory hand strategy.

Umiyuri is not starting from zero. The retained [source audit](source-notes/CHART_SOURCE_AUDIT.md)
records a tutorial transcript, inspected explanatory stills and a narrow
candidate grammar. The next step is to reconcile the recurrence/launch phases,
allowed omissions and variants with exact chart passages, then author an
illustration with a clearly stated scope. Generic tap/slide overlap is too broad.
This reference work does not require a full-catalog analysis run.

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

The remaining work is explanation, illustration and labeled evaluation before
another catalog-wide processing step. Personal recommendations still require
the separate reviewed catalog mapping and recommendation qualifications.
