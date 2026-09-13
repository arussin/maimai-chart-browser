"""Bounded structural forms of community patterns, independent of chart titles.

Source taxonomy: https://mai-notes.com/tag (read 2026-09-12).
Path spelling: https://w.atwiki.jp/simai/pages/1003.html.
See docs/patterns/COMMUNITY_PATTERNS.md for reference passages and scope.
No rule infers compulsory hands, sensor judgments, or practice suitability.
"""

import re
from bisect import bisect_left
from collections import defaultdict
from fractions import Fraction

from .flow import is_known
from .pattern_intervals import beat_clock
from .pattern_sequences import _direction, _gap, _groups, _near, occurrence

SOURCE = "https://mai-notes.com/tag"
BASE = ["timing", "beat_grid", "positions"]
SLIDES = [*BASE, "slide_groups", "slide_movement", "slide_wait"]

# Stable IDs and English names. The last field marks named community forms.
CATALOG = {
    "anchored_trill": ("Anchored trill", ["axis trill", "moving trill with a fixed anchor"], False),
    "scattered_taps": ("Scattered tap stream", ["random stream", "scattered stream"], False),
    "touch_stream": ("Touch stream", ["scattered touch notes"], False),
    "touch_sweep": ("Touch sweep", ["touch staircase"], False),
    "touch_rotation": ("Touch rotation", ["touch spin", "touch perimeter run"], False),
    "repeated_slide_heads": (
        "Repeated same-start slides",
        ["repeated slide heads", "same-start slide stream"],
        False,
    ),
    "alternating_slide_heads": ("Alternating slide launches", ["alternating slide stream"], False),
    "different_slide_speeds": (
        "Different-speed paired slides",
        ["unequal slide speeds", "mixed-speed slides"],
        False,
    ),
    "extended_slide_wait": (
        "Extended slide wait",
        ["delayed slide", "slide stop", "long slide wait"],
        False,
    ),
    "return_slides": ("Back-and-forth slides", ["return slides", "opposing slides"], False),
    "cycles": ("CYCLES pattern", ["Cycles", "Cycle pattern"], True),
    "slip_flip": ("Slip Flip pattern", ["Slipflip"], True),
    "death_scythe": (
        "Death Scythe pattern",
        ["Deathscythe", "counter-rotating tap and slide pattern"],
        True,
    ),
    "sugarbitter": (
        "Sugarbitter pattern",
        ["Sugar Song and Bitter Step pattern", "Shugabita pattern"],
        True,
    ),
    "future": ("Future Re:MASTER pattern", ["Future pattern", "Future white pattern"], True),
    "gekishou": (
        "Gekishou pattern",
        ["The Intense Voice of Hatsune Miku pattern", "EACH-linked opposing sweeps"],
        True,
    ),
    "hoshizora": (
        "Hoshizora Spectacle pattern",
        ["Hoshizora pattern"],
        True,
    ),
    "outlaw": ("Outlaw pattern", ["Outlaw's Lullaby pattern", "shifting EACH-linked sweeps"], True),
    "amazing_mightyyy": (
        "AMAZING MIGHTYYYY!!!! EXPERT pattern",
        ["Amazing Mightyyy Expert pattern", "Amemai Expert pattern", "dotted-eighth stream"],
        True,
    ),
    "magic_circle": ("Magic-circle pattern", ["magic circle", "rotating diagonal slides"], True),
}

DEFINITIONS = {
    "anchored_trill": (
        BASE,
        (
            "At least eight equally spaced single button inputs alternate a fixed "
            "anchor with a moving position. At least three distinct non-anchor "
            "positions occur. Gaps are at most half a beat and one second; chords split"
            " the sequence."
        ),
    ),
    "scattered_taps": (
        BASE,
        (
            "At least eight equally spaced consecutive single tap/star inputs visit at "
            "least four buttons, with gaps at most half a beat and one second. At least"
            " three transitions jump to a distinct non-neighboring button. Fixed-anchor"
            " alternations are excluded. This scoped scattered-stream rule is not a "
            "catch-all difficulty label."
        ),
    ),
    "touch_stream": (
        ["timing", "beat_grid", "touch_zones"],
        (
            "At least six consecutive single touch onsets visit at least three zones, "
            "with gaps at most half a beat and one second. Button inputs, touch holds "
            "and simultaneous touches split the stream."
        ),
    ),
    "touch_sweep": (
        ["timing", "beat_grid", "touch_zones"],
        (
            "A maximal run of four to seven single touch inputs steps between "
            "neighboring numbered zones on the same A, B, D or E ring in one direction."
            " Gaps are at most half a beat and one second. Central and cross-ring "
            "touches split the sequence."
        ),
    ),
    "touch_rotation": (
        ["timing", "beat_grid", "touch_zones"],
        (
            "At least eight consecutive single touch inputs traverse one numbered A, B,"
            " D or E ring in one direction with adjacent steps. Gaps are at most half a"
            " beat and one second. Central and cross-ring touches split the sequence."
        ),
    ),
    "repeated_slide_heads": (
        SLIDES,
        (
            "At least three consecutive distinct slide heads at one button, spaced "
            "equally by at most one beat and one second. Each head owns exactly one "
            "path. Additional non-slide inputs split the sequence. One shared branching"
            " head is not repeated heads."
        ),
    ),
    "alternating_slide_heads": (
        SLIDES,
        (
            "At least four consecutive single-path slide heads alternate between two "
            "distinct buttons, with equal gaps at most one beat and one second. "
            "Additional non-slide inputs and branching heads split the sequence."
        ),
    ),
    "different_slide_speeds": (
        [*SLIDES, "authored_simultaneity"],
        (
            "Two authored simultaneous single-path slide heads launch together within "
            "two microseconds. Their simple paths have equal shape length under "
            "rotation/reflection, but movement durations differ by a ratio of at least "
            "1.25. Unequal-length and connected paths are outside this form; differing "
            "durations alone do not establish different speed."
        ),
    ),
    "extended_slide_wait": (
        SLIDES,
        (
            "A slide waits more than one authored beat between its wait start and "
            "movement start, allowing two microseconds of clock rounding. Requires a "
            "covering tempo map. A normal one-beat wait at a slow BPM is excluded."
        ),
    ),
    "return_slides": (
        SLIDES,
        (
            "Two consecutive simple straight or arc slides retrace the same path in "
            "opposite directions. The second head arrives after the first, no more than"
            " two beats and two seconds later, while their wait/movement lifetimes "
            "overlap. Merely crossing paths do not qualify."
        ),
    ),
    "cycles": (
        [*SLIDES, "authored_simultaneity"],
        (
            "At least three consecutive equally spaced two-head EACH slide groups at "
            "fixed opposite buttons alternate between two arcs and two p/q loops. Each "
            "head owns one simple path; launches are paired. Group gaps are at most one"
            " beat and one second. This recognizes an arc-pair/loop-pair form, not all "
            "CYCLES variants."
        ),
    ),
    "slip_flip": (
        [*SLIDES, "authored_simultaneity"],
        (
            "At least three consecutive equally spaced EACH slide pairs at fixed "
            "opposite buttons each combine one simple arc and one p/q loop. The arc and"
            " loop retain their respective head positions; paired launches coincide. "
            "Group gaps are at most one beat and one second. This mixed-pair form is "
            "distinct from CYCLES."
        ),
    ),
    "death_scythe": (
        SLIDES,
        (
            "A single-input button run of at least eight adjacent steps in one "
            "direction contains at least two simple arc slide heads whose arcs travel "
            "in the opposite direction. Each arc overlaps an independent input in that "
            "run. Input gaps are at most half a beat and one second. Straight slides "
            "and mere tap/slide overlap do not qualify."
        ),
    ),
    "sugarbitter": (
        SLIDES,
        (
            "At least three equally spaced consecutive heads at one button each share "
            "exactly two distinct simple straight slide branches with simultaneous "
            "launches. Gaps are at most one beat and one second. One fan or repeated "
            "unbranched slides do not establish this form."
        ),
    ),
    "future": (
        [*SLIDES, "authored_simultaneity"],
        (
            "At least three consecutive one-beat EACH groups contain one single-path "
            "slide head and one tap. Slide heads change position; each later tap "
            "revisits the previous head, and the previous slide launches at the next "
            "group within two microseconds. No intervening onsets are allowed. This "
            "positional form does not infer a required hand switch."
        ),
    ),
    "gekishou": (
        [*BASE, "authored_simultaneity"],
        (
            "At least two consecutive short neighbor sweeps share EACH endpoints. Each "
            "sweep has three or four inputs with equal gaps at most a quarter beat and "
            "one second. Successive sweeps travel in opposite directions, use different"
            " endpoint notes at their shared chord, and occupy disjoint button sets. "
            "Hands are not inferred."
        ),
    ),
    "hoshizora": (
        BASE,
        (
            "Six equally spaced single button onsets follow the relative position "
            "sequence 1,3,5,1,7,5, allowing rotation and reflection. Tap, star and hold"
            " onsets qualify; gaps are at most half a beat and one second. This source-"
            "observed six-input form is not a general classifier of crossing or "
            "required hands."
        ),
    ),
    "outlaw": (
        [*BASE, "authored_simultaneity"],
        (
            "At least two consecutive three- or four-input neighbor sweeps share EACH "
            "endpoints, using different notes at each shared chord. Their directions "
            "and lengths agree, while each successive starting button moves one "
            "neighbor step in that direction. Equal gaps are at most a quarter beat and"
            " one second."
        ),
    ),
    "amazing_mightyyy": (
        ["timing", "beat_grid"],
        (
            "At least five consecutive authored onset groups are separated by exactly "
            "three quarters of a beat and at most one second. Chords may occur within a"
            " group. This dotted-eighth timing form does not require the source song or"
            " a specific hand assignment."
        ),
    ),
    "magic_circle": (
        SLIDES,
        (
            "At least four consecutive equally spaced single-head straight slides each "
            "connect opposite buttons. Starting positions progress by one adjacent "
            "button in a consistent circular direction. Gaps are at most one beat and "
            "one second. Parallel or arbitrary diagonal slides do not establish the "
            "progression."
        ),
    ),
}
DEFINITIONS = {"pattern." + key: value for key, value in DEFINITIONS.items()}
SHAPE_RULES = frozenset(
    "pattern." + key
    for key in (
        "different_slide_speeds",
        "return_slides",
        "cycles",
        "slip_flip",
        "death_scythe",
        "sugarbitter",
        "magic_circle",
    )
)
TEMPO_RULES = {"pattern.extended_slide_wait"}
SEGMENT = re.compile(r"(pp|qq|[-^<>vpqszw]|V)([1-8]{2}|[1-8])")


def path_shape(path):
    """Read one simple documented Simai shape; connected paths are known but excluded."""
    if not isinstance(path, str) or not path.startswith("simai:"):
        return None
    text = path[6:]
    if not text or text[0] not in "12345678":
        return None
    segments, cursor = [], 1
    while cursor < len(text):
        match = SEGMENT.match(text, cursor)
        if not match or len(match[2]) != (2 if match[1] == "V" else 1):
            return None
        segments.append((match[1], int(match[2][-1])))
        cursor = match.end()
    if not segments:
        return None
    return (
        (int(text[0]), segments[0][0], segments[0][1])
        if len(segments) == 1
        else (int(text[0]), "connected", segments[-1][1])
    )


def arc_direction(shape):
    start, kind, end = shape
    if kind == "^":
        delta = (end - start) % 8
        return 1 if 0 < delta < 4 else -1 if delta > 4 else 0
    if kind in "<>":
        # < and > are screen-facing signs, not global clockwise/counterclockwise.
        return (1 if start in (1, 2, 7, 8) else -1) * (1 if kind == ">" else -1)
    return 0


def _length_key(shape):
    start, kind, end = shape
    delta = (end - start) % 8
    if kind == "-":
        return ("straight", min(delta, (-delta) % 8))
    direction = arc_direction(shape)
    if direction:
        return ("arc", (direction * delta) % 8 or 8)
    if kind in ("p", "q"):
        return ("loop", (delta * (1 if kind == "p" else -1)) % 8)
    return None


def supported(chart, pattern_id):
    if pattern_id in SHAPE_RULES:
        heads = {e["event_id"]: e["position"] for e in chart["onsets"]}
        if any(
            (shape := path_shape(s["path"])) is None
            or s["head_id"] is not None
            and shape[0] != heads.get(s["head_id"])
            for s in chart["slides"]
        ):
            return False
    if pattern_id in TEMPO_RULES:
        return bool(chart["bpm_segments"]) and all(
            s["wait_start_us"] >= chart["bpm_segments"][0]["time_us"] for s in chart["slides"]
        )
    return True


def registry_entries():
    return [
        {
            "id": "pattern." + key,
            "display_name": name,
            "kind": "motif",
            "family": "community_motifs" if named else "input_patterns",
            "name_origin": "community_attested" if named else "generic_descriptive",
            "aliases": [{"text": a, "language": "en", "relation": "search_alias"} for a in aliases],
            "definition_status": "operational_experimental",
            "definition": DEFINITIONS["pattern." + key][1],
            "detector_status": "experimental",
            "automatic_tagging_enabled": True,
            "source_ids": ["MAI_NOTES_TAGS"],
            "sources": [{"label": "mai-notes pattern reference", "url": SOURCE}],
            "counterexamples_and_limits": [
                (
                    "Recognition covers the stated structural form; community variants "
                    "and compulsory hands are not inferred."
                )
            ],
            "required_capabilities": DEFINITIONS["pattern." + key][0],
            "verified_chart_examples": [],
        }
        for key, (name, aliases, named) in CATALOG.items()
    ]


def _match(events, slides=(), **measurements):
    events = sorted({e["event_id"]: e for e in events}.values(), key=lambda e: e["time_us"])
    start, end, ids, _, base = occurrence(events)
    return (
        start,
        max([end, *(s["movement_end_us"] for s in slides)]),
        ids,
        [s["path_id"] for s in slides],
        {**base, **measurements},
    )


def _regular_runs(items, representative, eligible, chart, maximum=Fraction(1), equal=True):
    run, step = [], None
    for item in items:
        event = representative(item)
        valid = eligible(item) and is_known(event["time_us"], event["time_us"] + 1, chart)
        gap = _gap(representative(run[-1]), event) if run and valid else None
        edge = (
            run
            and valid
            and 0 < gap <= maximum
            and _near(representative(run[-1]), event)
            and is_known(representative(run[-1])["time_us"], event["time_us"] + 1, chart)
        )
        compatible = not run or edge and (not equal or step is None or step == gap)
        if not valid or not compatible:
            if run:
                yield run
            previous = run[-1:] if edge else []
            run, step = previous, gap if previous else None
        if valid:
            if run and step is None:
                step = _gap(representative(run[-1]), event)
            run.append(item)
    if run:
        yield run


def _anchored(events):
    return len(events) >= 8 and any(
        len({e["position"] for e in events[phase::2]}) == 1
        and len({e["position"] for e in events[1 - phase :: 2]}) >= 3
        and not (
            {e["position"] for e in events[phase::2]}
            & {e["position"] for e in events[1 - phase :: 2]}
        )
        for phase in (0, 1)
    )


def _tap_patterns(chart, result):
    groups = _groups(chart)
    if set(BASE) <= set(chart["capabilities"]):
        for run in _regular_runs(
            groups,
            lambda g: g[0],
            lambda g: (
                len(g) == 1
                and type(g[0]["position"]) is int
                and g[0]["role"] in {"tap", "star_tap"}
            ),
            chart,
            Fraction(1, 2),
        ):
            events = [g[0] for g in run]
            # A moving-anchor phrase can begin inside a longer regular stream.
            index = 0
            while index + 8 <= len(events):
                end = index + 8
                if not _anchored(events[index:end]):
                    index += 1
                    continue
                phrase = events[index:end]
                phase = next(p for p in (0, 1) if len({e["position"] for e in phrase[p::2]}) == 1)
                anchor = phrase[phase]["position"]
                while end < len(events) and (
                    (events[end]["position"] == anchor) == ((end - index) % 2 == phase)
                ):
                    end += 1
                result["anchored_trill"].append(_match(events[index:end]))
                index = end
            if (
                len(events) >= 8
                and len({e["position"] for e in events}) >= 4
                and not _anchored(events)
                and sum(
                    a["position"] != b["position"] and not _direction(a, b)
                    for a, b in zip(events, events[1:], strict=False)
                )
                >= 3
            ):
                result["scattered_taps"].append(_match(events))
        for run in _regular_runs(
            groups,
            lambda g: g[0],
            lambda g: (
                len(g) == 1
                and type(g[0]["position"]) is int
                and g[0]["role"] in {"tap", "star_tap", "hold_onset"}
            ),
            chart,
            Fraction(1, 2),
        ):
            events = [g[0] for g in run]
            i = 0
            while i + 6 <= len(events):
                phrase = events[i : i + 6]
                positions = [e["position"] for e in phrase]
                relative = [(p - positions[0]) % 8 for p in positions]
                if relative in ([0, 2, 4, 0, 6, 4], [0, 6, 4, 0, 2, 4]):
                    result["hoshizora"].append(_match(phrase, form="six-input-crossing-stream"))
                    i += 6
                else:
                    i += 1
    if {"timing", "beat_grid"} <= set(chart["capabilities"]):
        for run in _regular_runs(groups, lambda g: g[0], lambda g: True, chart):
            if len(run) >= 5 and _gap(run[0][0], run[1][0]) == Fraction(3, 4):
                result["amazing_mightyyy"].append(_match([e for g in run for e in g]))


def _touch_patterns(chart, result):
    if not {"timing", "beat_grid", "touch_zones"} <= set(chart["capabilities"]):
        return
    for run in _regular_runs(
        _groups(chart),
        lambda g: g[0],
        lambda g: len(g) == 1 and g[0]["role"] == "touch",
        chart,
        Fraction(1, 2),
        False,
    ):
        events = [g[0] for g in run]
        if len(events) >= 6 and len({e["position"] for e in events}) >= 3:
            result["touch_stream"].append(_match(events))
        sequence, direction = [], None

        def flush(sequence):
            if len(sequence) >= 4:
                result["touch_sweep" if len(sequence) < 8 else "touch_rotation"].append(
                    _match(sequence)
                )

        for e in events:
            zone = e["position"]
            valid = isinstance(zone, str) and re.fullmatch(r"[ABDE][1-8]", zone)
            step = 0
            if sequence and valid and sequence[-1]["position"][0] == zone[0]:
                delta = (int(zone[1]) - int(sequence[-1]["position"][1])) % 8
                step = 1 if delta == 1 else -1 if delta == 7 else 0
            if not valid or sequence and (not step or direction not in (None, step)):
                flush(sequence)
                previous = sequence[-1:] if step else []
                sequence, direction = previous, step if previous else None
            if valid:
                if sequence and direction is None:
                    direction = step
                sequence.append(e)
        flush(sequence)


def _slide_patterns(chart, result):
    if not set(SLIDES) <= set(chart["capabilities"]):
        return
    by_head = defaultdict(list)
    for slide in chart["slides"]:
        if slide["head_id"]:
            by_head[slide["head_id"]].append(slide)
    groups = _groups(chart)
    for run in _regular_runs(
        groups, lambda g: g[0], lambda g: len(g) == 1 and len(by_head[g[0]["event_id"]]) == 1, chart
    ):
        events = [g[0] for g in run]
        for mode, minimum in (
            ("repeated_slide_heads", 3),
            ("alternating_slide_heads", 4),
            ("magic_circle", 4),
        ):
            i = 0
            while i + minimum <= len(events):

                def valid(part, mode=mode):
                    p = [e["position"] for e in part]
                    if mode == "repeated_slide_heads":
                        return len(set(p)) == 1
                    if mode == "alternating_slide_heads":
                        return p[0] != p[1] and all(v == p[j % 2] for j, v in enumerate(p))
                    shapes = [path_shape(by_head[e["event_id"]][0]["path"]) for e in part]
                    steps = [_direction(a, b) for a, b in zip(part, part[1:], strict=False)]
                    return (
                        all(s and s[1] == "-" and (s[2] - s[0]) % 8 == 4 for s in shapes)
                        and steps[0] != 0
                        and len(set(steps)) == 1
                    )

                end = i + minimum
                if not valid(events[i:end]):
                    i += 1
                    continue
                first = events[i]["position"]
                step = _direction(events[i], events[i + 1])
                while end < len(events):
                    position = events[end]["position"]
                    if mode == "repeated_slide_heads":
                        extends = position == first
                    elif mode == "alternating_slide_heads":
                        extends = position == events[i + (end - i) % 2]["position"]
                    else:
                        shape = path_shape(by_head[events[end]["event_id"]][0]["path"])
                        extends = (
                            shape
                            and shape[1] == "-"
                            and (shape[2] - shape[0]) % 8 == 4
                            and _direction(events[end - 1], events[end]) == step
                        )
                    if not extends:
                        break
                    end += 1
                part = events[i:end]
                result[mode].append(
                    _match(part, [by_head[e["event_id"]][0] for e in part], head_count=len(part))
                )
                i = end
    for run in _regular_runs(
        groups, lambda g: g[0], lambda g: len(g) == 1 and len(by_head[g[0]["event_id"]]) == 2, chart
    ):
        sequence = []

        def flush_fans(sequence):
            if len(sequence) >= 3:
                result["sugarbitter"].append(
                    _match(sequence, [s for e in sequence for s in by_head[e["event_id"]]])
                )

        for group in run:
            event = group[0]
            paths = by_head[event["event_id"]]
            shapes = [path_shape(s["path"]) for s in paths]
            valid = (
                all(s and s[1] == "-" for s in shapes)
                and shapes[0] != shapes[1]
                and abs(paths[0]["movement_start_us"] - paths[1]["movement_start_us"]) <= 2
            )
            if not valid or sequence and sequence[-1]["position"] != event["position"]:
                flush_fans(sequence)
                sequence = []
            if valid:
                sequence.append(event)
        flush_fans(sequence)
    if supported(chart, "pattern.extended_slide_wait"):
        at = beat_clock(chart)
        events = {e["event_id"]: e for e in chart["onsets"]}
        for slide in chart["slides"]:
            # Compare at two microseconds before movement to tolerate rounding only.
            if (
                slide["head_id"]
                and at(max(slide["wait_start_us"], slide["movement_start_us"] - 2))
                - at(slide["wait_start_us"])
                > 1
            ):
                result["extended_slide_wait"].append(_match([events[slide["head_id"]]], [slide]))
    _pairs(chart, groups, by_head, result)
    _returns(chart, by_head, result)
    _counter_rotation(chart, by_head, result)


def _authored_pair(group):
    return (
        len(group) == 2
        and group[0]["group_id"] is not None
        and group[0]["group_id"] == group[1]["group_id"]
    )


def _pairs(chart, groups, by_head, result):
    if "authored_simultaneity" not in chart["capabilities"]:
        return

    def paired(g):
        return _authored_pair(g) and all(len(by_head[e["event_id"]]) == 1 for e in g)

    for run in _regular_runs(groups, lambda g: g[0], paired, chart):
        for g in run:
            paths = [by_head[e["event_id"]][0] for e in g]
            shapes = [path_shape(s["path"]) for s in paths]
            durations = [s["movement_end_us"] - s["movement_start_us"] for s in paths]
            if (
                all(shapes)
                and abs(paths[0]["movement_start_us"] - paths[1]["movement_start_us"]) <= 2
                and min(durations) > 0
                and _length_key(shapes[0])
                and _length_key(shapes[0]) == _length_key(shapes[1])
                and max(durations) >= min(durations) * 1.25
            ):
                result["different_slide_speeds"].append(_match(g, paths))
        for mode in ("cycles", "slip_flip"):
            sequence = []

            def category(g, mode=mode):
                p = sorted(g, key=lambda e: e["position"])
                paths = [by_head[e["event_id"]][0] for e in p]
                shapes = [path_shape(s["path"]) for s in paths]
                if (
                    not all(shapes)
                    or (p[1]["position"] - p[0]["position"]) % 8 != 4
                    or abs(paths[0]["movement_start_us"] - paths[1]["movement_start_us"]) > 2
                ):
                    return None
                kinds = tuple(
                    "arc" if arc_direction(s) else "loop" if s[1] in ("p", "q") else "other"
                    for s in shapes
                )
                if mode == "cycles" and kinds in (("arc", "arc"), ("loop", "loop")):
                    return kinds
                if mode == "slip_flip" and set(kinds) == {"arc", "loop"}:
                    return kinds
                return None

            def flush(sequence, mode=mode):
                if len(sequence) >= 3:
                    result[mode].append(
                        _match(
                            [e for g in sequence for e in g],
                            [by_head[e["event_id"]][0] for g in sequence for e in g],
                        )
                    )

            for g in run:
                cat = category(g)
                same_heads = not sequence or {e["position"] for e in sequence[-1]} == {
                    e["position"] for e in g
                }
                compatible = not sequence or (
                    category(sequence[-1]) != cat
                    if mode == "cycles"
                    else category(sequence[-1]) == cat
                )
                if cat is None or not same_heads or not compatible:
                    flush(sequence)
                    sequence = []
                if cat is not None:
                    sequence.append(g)
            flush(sequence)

    def future_pair(g):
        return (
            _authored_pair(g)
            and sorted(len(by_head[e["event_id"]]) for e in g) == [0, 1]
            and all(e["role"] in ("tap", "star_tap") for e in g)
        )

    for run in _regular_runs(groups, lambda g: g[0], future_pair, chart):
        sequence = []

        def head(g):
            return next(e for e in g if by_head[e["event_id"]])

        def flush_future(sequence):
            if len(sequence) >= 3:
                result["future"].append(
                    _match(
                        [e for g in sequence for e in g],
                        [by_head[head(g)["event_id"]][0] for g in sequence],
                    )
                )

        for g in run:
            if sequence:
                previous = head(sequence[-1])
                current = head(g)
                tap = next(e for e in g if e is not current)
                if (
                    _gap(previous, current) != 1
                    or current["position"] == previous["position"]
                    or tap["position"] != previous["position"]
                    or abs(
                        by_head[previous["event_id"]][0]["movement_start_us"] - current["time_us"]
                    )
                    > 2
                ):
                    flush_future(sequence)
                    sequence = []
            sequence.append(g)
        flush_future(sequence)


def _returns(chart, by_head, result):
    events = [e for e in chart["onsets"] if len(by_head[e["event_id"]]) == 1]
    for a, b in zip(events, events[1:], strict=False):
        left, right = by_head[a["event_id"]][0], by_head[b["event_id"]][0]
        x, y = path_shape(left["path"]), path_shape(right["path"])
        if not x or not y or x[0] != y[2] or x[2] != y[0]:
            continue
        reverse = (
            x[1] == y[1] == "-"
            and x[0] != x[2]
            or arc_direction(x)
            and arc_direction(x) == -arc_direction(y)
            and _length_key(x) == _length_key(y)
        )
        if (
            reverse
            and 0 < _gap(a, b) <= 2
            and 0 < b["time_us"] - a["time_us"] <= 2_000_000
            and right["wait_start_us"] < left["movement_end_us"]
        ):
            result["return_slides"].append(_match([a, b], [left, right]))


def _counter_rotation(chart, by_head, result):
    for run in _regular_runs(
        _groups(chart),
        lambda g: g[0],
        lambda g: (
            len(g) == 1 and type(g[0]["position"]) is int and g[0]["role"] in ("tap", "star_tap")
        ),
        chart,
        Fraction(1, 2),
        False,
    ):
        sequence = []
        direction = None

        def flush(sequence, direction):
            if len(sequence) < 8:
                return
            times = [e["time_us"] for e in sequence]

            def independent_overlap(slide):
                index = bisect_left(times, slide["movement_start_us"])
                if index < len(sequence) and sequence[index]["event_id"] == slide["head_id"]:
                    index += 1
                return index < len(sequence) and times[index] < slide["movement_end_us"]

            paths = [
                s
                for e in sequence
                for s in by_head[e["event_id"]]
                if (shape := path_shape(s["path"]))
                and arc_direction(shape) == -direction
                and independent_overlap(s)
            ]
            if len({s["head_id"] for s in paths}) >= 2:
                result["death_scythe"].append(_match(sequence, paths))

        for e in [g[0] for g in run]:
            step = _direction(sequence[-1], e) if sequence else 0
            if sequence and (not step or direction not in (None, step)):
                flush(sequence, direction)
                sequence = sequence[-1:] if step else []
                direction = None
            if sequence and direction is None:
                direction = step
            sequence.append(e)
        flush(sequence, direction)


def _linked_sweeps(chart, result):
    if not {*BASE, "authored_simultaneity"} <= set(chart["capabilities"]):
        return
    groups = _groups(chart)
    segments = []
    for i, g in enumerate(groups):
        if not _authored_pair(g) or any(
            type(e["position"]) is not int or e["role"] not in ("tap", "star_tap") for e in g
        ):
            continue
        for end in (i + 2, i + 3):
            if end >= len(groups) or not _authored_pair(groups[end]):
                continue
            part = groups[i : end + 1]
            if any(len(x) != 1 for x in part[1:-1]) or any(
                e["role"] not in ("tap", "star_tap") or type(e["position"]) is not int
                for x in part
                for e in x
            ):
                continue
            gaps = [_gap(a[0], b[0]) for a, b in zip(part, part[1:], strict=False)]
            if (
                len(set(gaps)) != 1
                or not 0 < gaps[0] <= Fraction(1, 4)
                or not all(_near(a[0], b[0]) for a, b in zip(part, part[1:], strict=False))
            ):
                continue
            for first in g:
                for last in part[-1]:
                    path = [first, *[x[0] for x in part[1:-1]], last]
                    steps = [_direction(a, b) for a, b in zip(path, path[1:], strict=False)]
                    if steps[0] and len(set(steps)) == 1:
                        segments.append(
                            {
                                "start": i,
                                "end": end,
                                "path": path,
                                "groups": part,
                                "direction": steps[0],
                                "gap": gaps[0],
                            }
                        )
    by_start = defaultdict(list)
    for segment in segments:
        by_start[segment["start"]].append(segment)
    for mode in ("gekishou", "outlaw"):
        consumed = set()
        for initial in segments:
            identity = (initial["start"], initial["path"][0]["event_id"])
            if identity in consumed:
                continue
            chain = [initial]
            while True:
                previous = chain[-1]
                candidates = []
                for other in by_start[previous["end"]]:
                    if (
                        previous["path"][-1]["event_id"] == other["path"][0]["event_id"]
                        or previous["gap"] != other["gap"]
                    ):
                        continue
                    if mode == "gekishou":
                        valid = previous["direction"] == -other["direction"] and not (
                            {e["position"] for e in previous["path"]}
                            & {e["position"] for e in other["path"]}
                        )
                    else:
                        valid = (
                            previous["direction"] == other["direction"]
                            and len(previous["path"]) == len(other["path"])
                            and _direction(previous["path"][0], other["path"][0])
                            == previous["direction"]
                        )
                    if valid:
                        candidates.append(other)
                if len(candidates) != 1:
                    break
                chain.append(candidates[0])
            if len(chain) >= 2:
                result[mode].append(
                    _match(
                        [e for s in chain for g in s["groups"] for e in g], sweep_count=len(chain)
                    )
                )
                consumed.update((s["start"], s["path"][0]["event_id"]) for s in chain)


def detect_community(chart):
    result = defaultdict(list)
    _tap_patterns(chart, result)
    _touch_patterns(chart, result)
    _slide_patterns(chart, result)
    _linked_sweeps(chart, result)
    return {"pattern." + key: values for key, values in result.items()}
