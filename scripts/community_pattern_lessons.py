"""Authored English lessons for the community-pattern extension.

The notation below is newly authored teaching material, not song transcriptions.
Shape polylines are schematic and never feed recognition.
"""

import math

from maimai_analyzer.contracts import normalize_chart
from maimai_analyzer.pattern_community import CATALOG, SOURCE, arc_direction, path_shape
from maimai_analyzer.simai_subset import parse_simai_subset

# summary, what to watch, contrast, limitations, example, contrasting example
LESSONS = {
    "anchored_trill": (
        "Return to one anchor between taps at changing positions.",
        (
            "Button 1 repeats on every other input. The intervening input moves through"
            " buttons 3, 4, 5 and 6."
        ),
        "The contrast alternates only two fixed buttons, so it is an ordinary trill.",
        (
            "The anchor can be anywhere. Recognition requires eight inputs and at least"
            " three moving positions; it does not assign hands."
        ),
        "{8}1,3,1,4,1,5,1,6,",
        "{8}1,5,1,5,1,5,1,5,",
    ),
    "scattered_taps": (
        "Follow a stream that jumps among several buttons.",
        "Read each new position rather than assuming the next neighboring button.",
        "The contrast visits neighboring buttons around the ring instead of scattering across it.",
        (
            "This category recognizes one measurable scattered-stream form. Other "
            "streams may also fit community usage; this is not a difficulty rating."
        ),
        "{8}1,4,7,2,6,3,8,5,",
        "{8}1,2,3,4,5,6,7,8,",
    ),
    "touch_stream": (
        "Read a succession of touches at different screen zones.",
        "All six inputs are touches. Their positions change without an intervening button input.",
        "Button taps interrupt the touch-only sequence in the contrast.",
        (
            "The current form needs six single touches at three or more zones. Touch "
            "holds and simultaneous touches are separate cases."
        ),
        "{8}B1,B3,B6,B2,B5,B8,",
        "{8}B1,1,B3,3,B6,6,",
    ),
    "touch_sweep": (
        "Move through neighboring touch zones along a short arc.",
        "B7, B8, B1 and B2 stay on the same ring and continue through its wraparound.",
        "The contrast skips zones instead of following neighboring positions.",
        (
            "This form covers four to seven touches on one numbered A, B, D or E ring. "
            "Mixed-ring and center-touch sweeps need separate treatment."
        ),
        "{8}B7,B8,B1,B2,",
        "{8}B7,B1,B3,B5,",
    ),
    "touch_rotation": (
        "Continue a touch sweep around a complete ring.",
        "The example visits all eight B zones in order.",
        "The contrast changes direction and never completes the same circular run.",
        (
            "Rotation can run in either direction. The current form requires eight "
            "adjacent touches on one ring; it does not infer arm motion."
        ),
        "{8}B1,B2,B3,B4,B5,B6,B7,B8,",
        "{8}B1,B2,B3,B4,B3,B2,B1,B8,",
    ),
    "repeated_slide_heads": (
        "Launch successive slides from the same button.",
        "Each star is a separate input at button 1, followed by its own slide movement.",
        "The contrast has one star with several branches, not several successive heads.",
        (
            "Head spacing can be fast or slow. The current form requires three equally "
            "spaced, single-path heads and keeps branching fans separate."
        ),
        "{8}1-5[8:1],1-4[8:1],1-6[8:1],",
        "{8}1-5[8:1]*-4[8:1]*-6[8:1],",
    ),
    "alternating_slide_heads": (
        "Alternate slide launches between two starting buttons.",
        "The head sequence returns to 1, then 5, then 1, then 5.",
        "The contrast moves to a new starting button each time.",
        (
            "This identifies four equally spaced single-path heads. It does not "
            "prescribe alternating hands, and the slide endpoints may vary."
        ),
        "{8}1-5[8:1],5-1[8:1],1-5[8:1],5-1[8:1],",
        "{8}1-5[8:1],2-6[8:1],3-7[8:1],4-8[8:1],",
    ),
    "different_slide_speeds": (
        "Trace paired slides that move at different speeds.",
        "Both equal-length paths launch together. One finishes while the other is still moving.",
        "The contrast gives both paths the same movement duration.",
        (
            "Recognition currently compares equal-shape paths with durations differing "
            "by at least 25%. Different-length paths and connected chains are outside "
            "this form."
        ),
        "{4}1-5[4:1]/5-1[4:2],",
        "{4}1-5[4:1]/5-1[4:1],",
    ),
    "extended_slide_wait": (
        "Wait longer than one beat before tracing the slide.",
        "The dashed wait lasts two beats. The movement begins only after that delay.",
        "The contrast waits the usual one beat before moving.",
        (
            "A long wait differs from changing waits and slow slide movement. Timing is"
            " compared in beats, so a normal wait at a slow BPM is excluded."
        ),
        "{4}1-5[1##0.5],",
        "{4}1-5[4:1],",
    ),
    "return_slides": (
        "Trace a route and then its reverse.",
        "The second slide starts where the first ends and returns along the same line.",
        "The contrast ends at another button, so it does not retrace the complete route.",
        (
            "The current form covers simple straight and arc returns whose slide "
            "lifetimes overlap. Paths that merely cross are different."
        ),
        "{8}1-5[4:2],5-1[4:2],",
        "{8}1-5[4:2],5-2[4:2],",
    ),
    "cycles": (
        "Alternate a pair of arc slides with a pair of loop slides.",
        (
            "The first pair contains two arcs. The next contains two p loops, followed "
            "by another arc pair."
        ),
        "The contrast mixes an arc and a loop within every pair, which is the Slip Flip form.",
        (
            "CYCLES has community variants. This form uses fixed opposite heads and "
            "three or more alternating pairs. The curves illustrate shape families, not"
            " exact sensor geometry."
        ),
        "{4}1>4[8:1]/5<8[8:1],1p5[8:1]/5p1[8:1],1>4[8:1]/5<8[8:1],",
        "{4}1>4[8:1]/5p1[8:1],1<6[8:1]/5q1[8:1],1>4[8:1]/5p1[8:1],",
    ),
    "slip_flip": (
        "Repeat slide pairs with an arc on one side and a loop on the other.",
        (
            "Each pair has one arc and one p/q loop, with the shape roles staying on "
            "their respective heads."
        ),
        "The contrast alternates two arcs with two loops, which is the CYCLES form.",
        (
            "This scoped form needs three mixed pairs at fixed opposite heads. It does "
            "not cover every community variant. Curve drawings are schematic."
        ),
        "{4}1>4[8:1]/5p1[8:1],1<6[8:1]/5q1[8:1],1>4[8:1]/5p1[8:1],",
        "{4}1>4[8:1]/5<8[8:1],1p5[8:1]/5p1[8:1],1>4[8:1]/5<8[8:1],",
    ),
    "death_scythe": (
        "Follow rotating taps while arc slides move the other way.",
        "New inputs advance clockwise. The arc slides travel counterclockwise during that run.",
        "In the contrast, the arcs travel with the tap sequence instead of against it.",
        (
            "The current form requires an eight-input neighbor run and two opposing arc"
            " heads. General tap/slide overlap and straight slides do not establish "
            "this motif."
        ),
        "{8}7<4[4:1],8,1,2<7[4:1],3,4,5>2[4:1],6,7,8,",
        "{8}7>4[4:1],8,1,2>7[4:1],3,4,5<2[4:1],6,7,8,",
    ),
    "sugarbitter": (
        "Repeat pairs of straight slides from one shared starting button.",
        "Each of three separate stars branches into two straight paths.",
        "The contrast repeats heads with only one path each.",
        (
            "Also called the Sugar Song and Bitter Step pattern. This form combines "
            "repeated heads with two distinct straight branches; a single slide fan is "
            "insufficient."
        ),
        "{4}1-3[8:1]*-5[8:1],1-4[8:1]*-6[8:1],1-5[8:1]*-7[8:1],",
        "{4}1-3[8:1],1-4[8:1],1-5[8:1],",
    ),
    "future": (
        "Tap the previous slide head as the next star-and-tap pair arrives.",
        (
            "Pairs arrive one beat apart. The tap returns to the previous head while "
            "its slide launches."
        ),
        "The contrast taps a fixed unrelated button instead of revisiting the previous head.",
        (
            "The community name refers to Future Re:MASTER and frequent hand switching."
            " Recognition uses the shown positional relationship; it does not claim a "
            "required hand technique."
        ),
        "{4}7<4[8:1]/8,8>3[8:1]/7,4-7[8:1]/8,",
        "{4}7<4[8:1]/1,8>3[8:1]/1,4-7[8:1]/1,",
    ),
    "gekishou": (
        "Link short opposing sweeps through simultaneous endpoints.",
        "Follow 8, 7, 6, then 1, 2, 3. Each ending is paired with the start of the other sweep.",
        "The contrast separates the sweep endpoints instead of joining them as EACH inputs.",
        (
            "Named after The Intense Voice of Hatsune Miku. This form requires at least"
            " two linked, disjoint sweeps in opposite directions; it does not assign "
            "hands."
        ),
        "{16}3/8,7,1/6,2,3/8,",
        "{16}8,7,6,1,2,3,",
    ),
    "hoshizora": (
        "Read a six-input stream that jumps back across its earlier positions.",
        (
            "Follow 3, 5, 7, then 3, 1, 7. Some inputs begin short holds, but their "
            "onset order stays the same."
        ),
        "The contrast keeps stepping by two buttons instead of returning through the named form.",
        (
            "This is one source-observed Hoshizora Spectacle form, allowing rotation "
            "and reflection. Broader crossing streams and actual hand choices are "
            "outside the rule."
        ),
        "{12}3h[12:1],5,7h[12:1],3,1h[12:1],7,",
        "{12}3,5,7,1,3,5,",
    ),
    "outlaw": (
        "Shift the start of each EACH-linked sweep by one button.",
        (
            "Follow 2, 3, 4, 5, then 3, 4, 5, 6. The shared chord links the first "
            "ending to the next start."
        ),
        "The contrast returns to the same starting button, so the starts do not progress.",
        (
            "Named after Outlaw's Lullaby. The current form requires two equal-length "
            "linked sweeps in the same direction with adjacent starting positions."
        ),
        "{16}2/4,3,4,3/5,4,5,4/6,",
        "{16}2/4,3,4,2/5,3,4,2/5,",
    ),
    "amazing_mightyyy": (
        "Repeat inputs three quarters of a beat apart.",
        "Count three sixteenth-note slots between groups. The inputs drift across the main beats.",
        "The contrast uses evenly spaced eighth notes rather than dotted eighths.",
        (
            "The community name comes from AMAZING MIGHTYYYY!!!! EXPERT. This timing "
            "form accepts chords and needs five groups; it is different from a half-"
            "beat offbeat run."
        ),
        "{16}1/5,,,2,,,3/7,,,4,,,5/1,,,",
        "{8}1/5,2,3/7,4,5/1,",
    ),
    "magic_circle": (
        "Advance diagonal slides around the ring one starting button at a time.",
        "The heads move from 1 to 2 to 3 to 4. Every straight slide points to the opposite button.",
        "The contrast also shifts the heads, but its slides do not connect opposite buttons.",
        (
            "This form needs four consecutive diagonal slides with equally spaced "
            "adjacent heads. Arbitrary diagonals or repeated heads do not establish the"
            " progression."
        ),
        "{8}1-5[8:1],2-6[8:1],3-7[8:1],4-8[8:1],",
        "{8}1-4[8:1],2-5[8:1],3-6[8:1],4-7[8:1],",
    ),
}


def _point(position, radius=1):
    angle = (position - 0.5) * math.pi / 4
    return [round(math.sin(angle) * radius, 6), round(-math.cos(angle) * radius, 6)]


def _points(shape):
    start, kind, end = shape
    direction = arc_direction(shape)
    if direction:
        distance = (direction * (end - start)) % 8 or 8
        return [_point(start + direction * distance * i / 24) for i in range(25)]
    if kind in ("p", "q"):
        direction = -1 if kind == "p" else 1
        return [
            _point(start),
            *[_point(start + direction * 8 * i / 24, 0.45) for i in range(25)],
            _point(end),
        ]
    return [_point(start), _point(end)]


def _model(body):
    raw, _ = parse_simai_subset(
        "(120)" + body + "E",
        chart_id="authored-lesson",
        song_id="authored-lesson",
        format="STD",
        difficulty="MASTER",
        revision="1",
        source={
            "source_id": "authored-lesson",
            "revision": "1",
            "kind": "authored_synthetic",
            "identity_status": "exact",
        },
    )
    chart = normalize_chart(raw)
    notes = [
        [
            e["time_us"] / 500000,
            e["position"],
            {"star_tap": "star", "hold_onset": "hold", "touch_hold": "hold"}.get(
                e["role"], e["role"]
            ),
        ]
        for e in chart["onsets"]
    ]
    positions = {e["event_id"]: e["position"] for e in chart["onsets"]}
    slides = []
    points = []
    labels = []
    for s in sorted(chart["slides"], key=lambda s: (s["wait_start_us"], s["path_id"])):
        shape = path_shape(s["path"])
        slides.append(
            [
                s["wait_start_us"] / 500000,
                s["movement_start_us"] / 500000,
                s["movement_end_us"] / 500000,
                [shape[0], shape[2]],
            ]
        )
        points.append(_points(shape))
        labels.append({"p": "p loop", "q": "q loop", "-": "straight"}.get(shape[1], "arc"))
    holds = [
        [h["start_us"] / 500000, h["end_us"] / 500000, positions[h["onset_id"]]]
        for h in chart["holds"]
    ]
    return {
        "kind": "notes",
        "unit": "beats",
        "duration": math.ceil(chart["span_end_us"] / 500000) + 1,
        "notes": notes,
        "slides": slides,
        "holds": holds,
        "bands": [],
        "slide_points": points,
        "slide_labels": labels,
    }


def community_lessons():
    lessons = {}
    for key, (summary, watch, contrast, variants, positive, negative) in LESSONS.items():
        example, counterexample = _model(positive), _model(negative)
        duration = max(example["duration"], counterexample["duration"])
        example["duration"] = counterexample["duration"] = duration
        lessons["pattern." + key] = {
            "summary": summary,
            "watch": watch,
            "contrast": contrast,
            "variants": variants,
            "example": example,
            "counterexample": counterexample,
            ("scope"): (
                "Authored illustration of the stated structural form; no mandatory hand"
                " assignment or complete community-family coverage is implied."
            ),
            "sources": [
                {
                    "label": "mai-notes: " + CATALOG[key][0],
                    "url": SOURCE,
                    ("note"): (
                        "Community naming reference; operational recognition has a "
                        "narrower stated scope."
                    ),
                }
            ],
            "review_status": "authored_and_checked_not_independently_validated",
        }
    return lessons
