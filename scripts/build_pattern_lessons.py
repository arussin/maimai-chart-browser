"""Build authored teaching examples; no chart acquisition, recognition or player data."""
# ruff: noqa: E501 -- Long lines retain readable authored lesson prose.

from __future__ import annotations

import json
from pathlib import Path


def timeline(notes=(), *, slides=(), holds=(), duration=8, bands=()):
    events = [list(n) if len(n) == 3 else [*n, "tap"] for n in notes]
    for head, _start, _end, path in slides:
        note = [head, path[0], "star"]
        if note not in events:
            events.append(note)
    for start, _end, position in holds:
        events.append([start, position, "hold"])
    return {
        "kind": "notes",
        "duration": duration,
        "unit": "beats",
        "notes": sorted(events, key=lambda n: (n[0], str(n[1]), n[2])),
        "slides": [list(s) for s in slides],
        "holds": [list(h) for h in holds],
        "bands": [list(b) for b in bands],
    }


def bars(values, *, second=None, bands=()):
    series = [{"label": "Inputs / s", "values": values}]
    if second is not None:
        series.append({"label": "Break inputs / s", "values": second})
    return {
        "kind": "bars",
        "duration": len(values),
        "unit": "seconds",
        "series": series,
        "bands": [list(b) for b in bands],
    }


def taps(times, positions=(1, 5)):
    return [(t, positions[i % len(positions)]) for i, t in enumerate(times)]


def build_lessons():
    lessons = {}

    def add(key, summary, watch, contrast, variants, example, counterexample, *, scope=None):
        lessons[key] = {
            "summary": summary,
            "watch": watch,
            "contrast": contrast,
            "variants": variants,
            "example": example,
            "counterexample": counterexample,
            "scope": scope or "Authored illustration of this project's descriptive definition.",
            "sources": [],
            "review_status": "authored_and_checked_not_independently_validated",
        }

    add(
        "pattern.two_position_alternation",
        "Alternate between two positions: A, B, A, B.",
        "Follow the evenly spaced notes. Every next note changes to the other position.",
        "A, A, B, B repeats positions in pairs instead of alternating on every note.",
        "The two positions and speed can change. Simultaneous notes or extra positions need a separate description.",
        timeline(taps([0.5, 1, 1.5, 2, 2.5, 3]), duration=4),
        timeline(taps([0.5, 1, 1.5, 2, 2.5, 3], (1, 1, 5, 5)), duration=4),
    )
    add(
        "pattern.same_position_repetition",
        "Tap the same position repeatedly.",
        "Each circle is a new input, even though it returns to the same place.",
        "One long hold has a single beginning. It is not a series of repeated taps.",
        "Spacing may vary. Button repetition and touch repetition should keep their input type visible.",
        timeline(taps([0.5, 1, 1.5, 2, 2.5, 3], (1,)), duration=4),
        timeline(holds=[(0.5, 3, 1)], duration=4),
    )
    add(
        "pattern.gallop_pairs",
        "Repeat short-long timing pairs.",
        "Read the gaps: short, long, short, long. The pattern is in the spacing between inputs.",
        "Evenly spaced inputs have no alternating short-long gap.",
        "Positions and the gap ratio may change. This descriptive label does not specify one musical subdivision.",
        timeline(taps([0.5, 0.75, 1.5, 1.75, 2.5, 2.75, 3.5, 3.75]), duration=4),
        timeline(taps([0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75]), duration=4),
    )
    add(
        "pattern.three_note_burst",
        "Three close inputs form one short burst.",
        "Longer gaps separate each group of three from the next group.",
        "A continuous stream has no larger gap marking three-note groups.",
        "A three-note burst can use many rhythms. Three notes do not automatically mean triplets.",
        timeline(taps([0.5, 0.75, 1, 2.5, 2.75, 3]), duration=4),
        timeline(taps([0.5, 0.75, 1, 1.25, 1.5, 1.75]), duration=4),
    )
    add(
        "pattern.triplet_grid",
        "Divide each beat into three equal parts.",
        "Three evenly spaced inputs fit between each pair of whole-beat guide lines.",
        "Four equal inputs per beat use a four-part subdivision, even if only three happen to be visible.",
        "The beat reference matters. Counting three notes alone cannot establish a triplet rhythm.",
        timeline(taps([1 + i / 3 for i in range(9)]), duration=4),
        timeline(taps([1 + i / 4 for i in range(12)]), duration=4),
    )
    add(
        "pattern.offbeat_onsets",
        "Repeat inputs between the main beats.",
        "These notes land halfway between the numbered beat lines.",
        "Notes on the numbered lines are on the beat, not the offbeat shown here.",
        "This lesson illustrates the half-beat offbeat. Other displaced phases should be named explicitly.",
        timeline(taps([0.5, 1.5, 2.5, 3.5]), duration=4),
        timeline(taps([0, 1, 2, 3]), duration=4),
    )
    add(
        "pattern.simultaneous_group",
        "Play two or more inputs together.",
        "Notes aligned vertically share one authored time.",
        "A small time gap makes these successive inputs, even if they look close together.",
        "The input types and positions can vary. Visual proximity alone does not establish simultaneity.",
        timeline([(t, p) for t in [1, 2, 3] for p in [1, 5]], duration=4),
        timeline(
            [(t + offset, p) for t in [1, 2, 3] for offset, p in [(0, 1), (0.2, 5)]], duration=4
        ),
    )
    add(
        "pattern.chord_stream",
        "Repeat groups of simultaneous inputs.",
        "Each time column contains a pair, and the paired groups continue in sequence.",
        "One simultaneous pair followed by single inputs is not a stream of paired groups.",
        "Group size, positions and spacing may change. No particular hand assignment is implied.",
        timeline([(t, p) for t in [0.5, 1, 1.5, 2, 2.5, 3] for p in [1, 5]], duration=4),
        timeline([(0.5, 1), (0.5, 5), (1, 1), (1.5, 5), (2, 1), (2.5, 5), (3, 1)], duration=4),
    )
    add(
        "pattern.tap_staircase",
        "Step through neighboring buttons along a short arc.",
        "The highlighted position moves 1 → 2 → 3 → 4, one neighboring button at a time.",
        "The 1 → 3 → 5 → 7 sequence skips buttons; it is not this neighboring-button staircase.",
        "A staircase can start elsewhere or reverse its direction. A long traversal is described as a perimeter run.",
        timeline(taps([0.5, 1, 1.5, 2], (1, 2, 3, 4)), duration=4),
        timeline(taps([0.5, 1, 1.5, 2], (1, 3, 5, 7)), duration=4),
    )
    add(
        "pattern.perimeter_run",
        "Progress around much of the outer button ring.",
        "The sequence visits all eight buttons in ring order.",
        "Alternating between two opposite buttons does not travel around the ring.",
        "Runs can cover a partial or full circuit and begin at any position. This example makes no claim about required hands.",
        timeline(taps([0.5 + i * 0.5 for i in range(8)], tuple(range(1, 9))), duration=5),
        timeline(taps([0.5 + i * 0.5 for i in range(8)]), duration=5),
    )
    add(
        "pattern.direction_reversal",
        "Change direction within a button run.",
        "The sequence goes 1 → 2 → 3 → 4, then returns through 3 → 2 → 1.",
        "Continuing 1 → 2 → 3 → 4 → 5 → 6 → 7 keeps the same direction.",
        "The turn can occur anywhere. A jump across the ring is not enough to establish a reversed traversal.",
        timeline(taps([0.5 + i * 0.5 for i in range(7)], (1, 2, 3, 4, 3, 2, 1)), duration=4),
        timeline(taps([0.5 + i * 0.5 for i in range(7)], (1, 2, 3, 4, 5, 6, 7)), duration=4),
    )
    add(
        "pattern.same_head_slide_fan",
        "One star starts multiple slide branches.",
        "Both paths share the same star input at button 1. The head is pressed once.",
        "Two separate stars at different buttons start independent slides, not one shared-head fan.",
        "Branch paths and timing can differ. Count the shared physical head once.",
        timeline(slides=[(0.5, 1.5, 3.5, [1, 3]), (0.5, 1.5, 3.5, [1, 7])], duration=4),
        timeline(slides=[(0.5, 1.5, 3.5, [1, 3]), (0.5, 1.5, 3.5, [5, 7])], duration=4),
    )
    add(
        "pattern.staggered_slide_starts",
        "Start overlapping slide movements at different times.",
        "The second solid movement line starts while the first is still moving.",
        "Both movements starting together creates overlap without staggered starts.",
        "Different star times do not guarantee different movement starts; compare the solid lines after each wait.",
        timeline(slides=[(0.5, 1.5, 3.5, [1, 3]), (1, 2, 3.5, [5, 7])], duration=4),
        timeline(slides=[(0.5, 1.5, 3.5, [1, 3]), (0.5, 1.5, 3.5, [5, 7])], duration=4),
    )
    add(
        "pattern.moving_slide_overlap",
        "Two or more slide paths move at once.",
        "The solid movement intervals overlap. Waiting paths do not count as moving.",
        "The first path finishes exactly when the second starts. Their movements do not overlap.",
        "Head times and path shapes can vary; the defining feature is a shared interval of movement.",
        timeline(slides=[(0.5, 1.5, 3.5, [1, 3]), (1, 2, 3.75, [5, 7])], duration=4),
        timeline(slides=[(0, 0.5, 2, [1, 3]), (1, 2, 3.75, [5, 7])], duration=4),
    )
    add(
        "pattern.slide_tap_interleave",
        "Tap while another slide is moving.",
        "The independent tap lands inside the slide's solid movement interval.",
        "A tap during the dashed waiting interval is a waiting-phase interaction instead.",
        "Many arrangements contain this broad interaction. It does not by itself identify Umiyuri.",
        timeline([(2, 5), (3, 5)], slides=[(0.5, 1.5, 3.5, [1, 3])], duration=4),
        timeline([(1, 5)], slides=[(0.5, 1.5, 3.5, [1, 3])], duration=4),
    )
    add(
        "pattern.delayed_slide_interleave",
        "Tap during another slide's waiting interval.",
        "The tap occurs after the star input but before the solid movement line begins.",
        "This tap lands after movement starts, outside the waiting interval.",
        "Wait length can vary. The slide's own head is not an independent intervening tap.",
        timeline([(1, 5)], slides=[(0.5, 1.5, 3.5, [1, 3])], duration=4),
        timeline([(2, 5)], slides=[(0.5, 1.5, 3.5, [1, 3])], duration=4),
    )
    add(
        "pattern.variable_slide_wait",
        "Change the delay from star input to slide movement.",
        "Compare the dashed waits: the first lasts one beat and the second lasts half a beat.",
        "These two slides have the same wait. Different travel lengths alone would not change that.",
        "Compare waits in a stated unit. A tempo change can alter seconds without changing the wait in beats.",
        timeline(slides=[(0.5, 1.5, 2.5, [1, 3]), (3, 3.5, 4.5, [5, 7])], duration=5),
        timeline(slides=[(0.5, 1.5, 2.5, [1, 3]), (3, 4, 4.75, [5, 7])], duration=5),
    )
    add(
        "pattern.connected_slide_chain",
        "Follow several connected segments as one slide.",
        "One star begins the continuous route 1 → 3 → 5 → 7. The intermediate points are not new inputs.",
        "Three separately started slides each have their own star and wait.",
        "Real connected segments may use different shapes or speeds. The straight segments here illustrate continuity only.",
        timeline(slides=[(0.5, 1.5, 4.5, [1, 3, 5, 7])], duration=5),
        timeline(
            slides=[(0, 0.5, 1.5, [1, 3]), (1.5, 2, 3, [3, 5]), (3, 3.5, 4.5, [5, 7])], duration=5
        ),
    )
    add(
        "pattern.hold_tap_interleave",
        "Keep one input held while other taps arrive.",
        "The long amber interval is active when the independent taps appear.",
        "Here the hold ends before the taps start, so they do not occur during it.",
        "The held input can be a supported touch hold. A hold beginning is one input, not a repeated-tap stream.",
        timeline([(1.5, 5), (2.5, 5)], holds=[(0.5, 3, 1)], duration=4),
        timeline([(1.5, 5), (2.5, 5)], holds=[(0.5, 1, 1)], duration=4),
    )
    add(
        "pattern.hold_slide_overlap",
        "A hold stays active while a slide moves.",
        "The hold interval and solid slide movement share part of the timeline.",
        "The hold ends at the slide's launch, so only its waiting interval overlaps the hold.",
        "Do not infer a required hand assignment from these intervals. Positions and geometry still matter.",
        timeline(holds=[(0.5, 3, 5)], slides=[(0.5, 1.5, 3.5, [1, 3])], duration=4),
        timeline(holds=[(0.5, 1.5, 5)], slides=[(0.5, 1.5, 3.5, [1, 3])], duration=4),
    )
    add(
        "pattern.touch_tap_interleave",
        "Alternate inner touch inputs with button taps.",
        "Square marks are touches in the inner screen area; circles are perimeter-button taps.",
        "Alternating between two perimeter buttons changes position but never changes to an inner touch.",
        "Touch positions and order can vary. A touch at the same time as a button is a simultaneous mixed group.",
        timeline(
            [
                (0.5, 1),
                (1, "C", "touch"),
                (1.5, 5),
                (2, "B1", "touch"),
                (2.5, 1),
                (3, "C", "touch"),
            ],
            duration=4,
        ),
        timeline(taps([0.5, 1, 1.5, 2, 2.5, 3]), duration=4),
    )

    # A scoped recurring example inferred from the retained S6/S8 explanation.
    umi_slides = [(0.5 + i, 1.5 + i, 2 + i, [8, 4] if i % 2 == 0 else [1, 5]) for i in range(4)]
    umi_taps = [
        (t, p)
        for i in range(4)
        for t, p in [(0.5 + i, 1 if i % 2 == 0 else 8), (1 + i, 7 if i % 2 == 0 else 2)]
    ]
    add(
        "pattern.umiyuri",
        "Repeat a star-and-tap pair, an intervening tap, then launch the previous slide at the next pair.",
        "Step through pair → intervening tap → next pair plus previous launch. The star role alternates between the two starting positions.",
        "One tap during one slide lacks this recurring phase relationship.",
        "This lesson shows one regular form. Omitted taps, changed paths and phrase boundaries need variant-specific treatment; no compulsory hands are assigned.",
        timeline(umi_taps, slides=umi_slides, duration=5),
        timeline([(2, 5)], slides=[(0.5, 1.5, 3, [1, 3])], duration=5),
        scope="Illustration inferred from the cited explanations. It is not a song transcription or a complete definition of every Umiyuri variant.",
    )
    lessons["pattern.umiyuri"]["sources"] = [
        {
            "label": "なめあ: first-chorus explanation",
            "url": "https://note.com/namea_chunibyo/n/n8c7bc59683ff",
            "note": "Text and illustrated timing explanation; one scoped form.",
        },
        {
            "label": "Surone: The Umiyuri Pattern Explained",
            "url": "https://www.youtube.com/watch?v=DQgnFASwiOM",
            "note": "Retained transcript review: 3:59–7:12 and 12:03–13:45; automatic captions may contain errors.",
        },
    ]

    steady = [6] * 12

    def trait(key, summary, watch, contrast, variants, positive, negative):
        add("trait." + key, summary, watch, contrast, variants, positive, negative)

    trait(
        "high_onset_density",
        "Many new inputs arrive in a short time.",
        "This example has 12 inputs per second, compared with 3 in the contrast. The vertical axes use the same scale.",
        "The lower rate is less dense under this stated comparison.",
        "High density needs a stated threshold or reference group. Break value and ongoing movement do not add new onsets.",
        bars([12] * 12),
        bars([3] * 12),
    )
    trait(
        "bursty_density",
        "Short busy bursts interrupt quieter stretches.",
        "The isolated busy sections rise sharply above the chart's usual activity.",
        "An even rate has no local burst, even if its overall input count is substantial.",
        "Bin width affects apparent burst size. A density burst is not necessarily a three-note burst.",
        bars([2, 2, 16, 14, 2, 2, 2, 15, 14, 2, 2, 2]),
        bars(steady),
    )
    trait(
        "sustained_density",
        "A busy rate continues across a long stretch.",
        "Six consecutive sections stay at 10 inputs per second. Compare this run with the isolated peak.",
        "One busy second followed by quieter activity is a spike rather than sustained activity.",
        "State both the rate threshold and required duration. These values illustrate the idea, not a universal difficulty cutoff.",
        bars([2, 2, 10, 10, 10, 10, 10, 10, 2, 2, 2, 2]),
        bars([2, 2, 16, 2, 2, 2, 2, 2, 2, 2, 2, 2]),
    )
    trait(
        "backloaded_density",
        "More inputs arrive toward the end.",
        "Compare equal-length early and late sections on the same scale.",
        "The contrasting activity is concentrated near the beginning instead.",
        "A busier ending is not necessarily a harder ending; note types and coordination can differ.",
        bars([2, 2, 3, 3, 4, 4, 6, 7, 9, 10, 11, 12]),
        bars([12, 11, 10, 9, 7, 6, 4, 4, 3, 3, 2, 2]),
    )
    trait(
        "frontloaded_density",
        "More inputs arrive toward the beginning.",
        "The early sections contain more new inputs per second than the later sections.",
        "The contrasting activity builds toward the end.",
        "Compare sections of equal duration. This describes activity placement, not total difficulty.",
        bars([12, 11, 10, 9, 7, 6, 4, 4, 3, 3, 2, 2]),
        bars([2, 2, 3, 3, 4, 4, 6, 7, 9, 10, 11, 12]),
    )
    trait(
        "isolated_density_spike",
        "One separated busy peak stands out.",
        "One section rises clearly above the quieter sections on both sides.",
        "Several separated peaks do not form a single isolated spike.",
        "Peak prominence and bin width must be stated when measuring real charts.",
        bars([2, 2, 3, 2, 2, 16, 2, 3, 2, 2, 2, 2]),
        bars([2, 14, 2, 2, 13, 2, 2, 15, 2, 2, 14, 2]),
    )
    trait(
        "multi_peak_density",
        "Several separated busy peaks recur.",
        "Quieter sections separate the prominent peaks.",
        "One broad busy plateau has no quiet gaps separating multiple peaks.",
        "Changing the analysis window can merge nearby peaks. The graph uses equal one-second sections.",
        bars([2, 14, 2, 2, 13, 2, 2, 15, 2, 2, 14, 2]),
        bars([2, 2, 12, 12, 12, 12, 12, 12, 12, 2, 2, 2]),
    )
    trait(
        "steady_density",
        "New inputs arrive at a fairly even rate.",
        "Each one-second section has the same number of inputs.",
        "Large swings between busy and quiet sections are not steady activity.",
        "Even onset counts do not prove that note spacing, coordination or difficulty are constant.",
        bars(steady),
        bars([1, 12, 2, 10, 1, 14, 2, 10, 1, 12, 2, 10]),
    )
    trait(
        "low_onset_gaps",
        "Few new notes arrive, though ongoing actions may remain.",
        "The input rate drops in the middle. The labeled interval shows a slide still moving through that gap.",
        "Continuing input activity provides no low-onset gap.",
        "A gap in new inputs is not automatically a rest; retain holds and slide movement separately.",
        bars([6, 6, 6, 0, 0, 0, 0, 0, 6, 6, 6, 6], bands=[(3, 8, "Slide still moving")]),
        bars(steady),
    )
    trait(
        "break_concentration",
        "Break inputs cluster in particular sections.",
        "The outlined break counts cluster in the middle; total input activity stays unchanged.",
        "The same total break count spread evenly across sections is less concentrated.",
        "Break inputs are included in the total, not added to physical density. Scoring risk needs a separate interpretation.",
        bars(steady, second=[0, 0, 0, 4, 4, 4, 0, 0, 0, 0, 0, 0]),
        bars(steady, second=[1] * 12),
    )
    trait(
        "rhythm_variability",
        "The spacing between successive inputs changes.",
        "Read the changing gaps along the beat grid, rather than just the total count.",
        "The same number of evenly spaced inputs has less timing variation.",
        "Variation alone does not establish musical complexity. Tempo changes and chosen beat units affect the measurement.",
        timeline(taps([0.25, 0.5, 1.25, 1.5, 1.75, 2.75, 3, 3.5]), duration=4),
        timeline(taps([0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75]), duration=4),
    )
    trait(
        "slide_occupancy",
        "Slide movement fills much of the timeline.",
        "The labeled movement intervals cover ten of these twelve seconds. Overlap is counted once.",
        "Short movement intervals occupy much less of the same span.",
        "Waiting slides are excluded. High occupancy does not identify a particular named motif.",
        bars([1] * 12, bands=[(1, 7, "Moving slide A"), (6, 11, "Moving slide B")]),
        bars([1] * 12, bands=[(1, 2, "Moving slide A"), (7, 8, "Moving slide B")]),
    )
    motif = [(t + start, p) for start in [0, 3, 6] for t, p in [(0.5, 1), (1, 5), (1.5, 5), (2, 1)]]
    trait(
        "repeated_motif",
        "A recognizable phrase appears again.",
        "Each labeled phrase repeats the same A, B, B, A input order and timing.",
        "Equal note counts with changed positions and timing do not establish the same phrase.",
        "A real matcher must state whether rotation, reflection or tempo changes are allowed. Shared broad tags are not enough.",
        timeline(
            motif,
            duration=9,
            bands=[(0, 2.5, "Phrase A"), (3, 5.5, "Phrase A"), (6, 8.5, "Phrase A")],
        ),
        timeline(
            taps([0.5, 1, 1.5, 2, 3.5, 3.75, 4.5, 5, 6.5, 7, 7.75, 8], (1, 2, 5, 3)), duration=9
        ),
    )
    target = taps([2, 2.5, 3, 3.5, 4, 4.5])
    trait(
        "isolated_pattern_sections",
        "A chosen pattern has little competing activity around it.",
        "The highlighted A/B alternation sits by itself. Compare the extra simultaneous inputs in the other example.",
        "The same target sequence remains, but additional inputs compete with it.",
        "Isolation is specific to a target pattern and neighborhood. It does not by itself prove practice effectiveness.",
        timeline(target, duration=6, bands=[(1.75, 4.75, "Target A/B sequence")]),
        timeline(
            target + [(t, 3) for t in [2, 2.5, 3, 3.5, 4, 4.5]],
            duration=6,
            bands=[(1.75, 4.75, "Target plus extra inputs")],
        ),
    )
    return {
        "version": "pattern-lessons-1",
        "basis": "Authored teaching illustrations; no real-chart assignments",
        "lessons": lessons,
    }


if __name__ == "__main__":
    destination = Path("src/maimai_intelligence/assets/pattern-lessons.json")
    destination.write_text(
        json.dumps(build_lessons(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
