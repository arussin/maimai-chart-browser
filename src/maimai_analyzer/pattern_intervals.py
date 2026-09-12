"""Mixed-input observations with half-open intervals and explicit beat timing."""

from bisect import bisect_right
from collections import Counter, defaultdict
from fractions import Fraction
from itertools import islice

from .pattern_sequences import _gap, _groups, _single_runs, occurrence
from .rational import decode_rational

DEFINITIONS = {
    "pattern.staggered_slide_starts": (
        ["timing", "slide_movement"],
        "A connected interval contains at least two moving slide paths with different "
        "movement start times. Waiting stars alone and paths that only touch at an "
        "endpoint do not qualify. Shared-head branches may qualify.",
    ),
    "pattern.variable_slide_wait": (
        ["timing", "beat_grid", "slide_wait", "slide_groups"],
        "At least three consecutive distinct slide heads have positive waits whose "
        "lengths differ by at least a quarter beat, allowing two microseconds of clock "
        "rounding. Heads are at most four beats and four seconds apart. A tempo map "
        "is required; equal beat waits at changing BPM are not variable waits. "
        "Heads whose branches have different waits split the sequence.",
    ),
    "pattern.hold_slide_overlap": (
        ["timing", "hold_intervals", "slide_movement"],
        "A positive-length, half-open held interval overlaps a slide's movement. "
        "Waiting slides and touching endpoints do not qualify. No mandatory hand "
        "assignment is inferred.",
    ),
    "pattern.touch_tap_interleave": (
        ["timing", "beat_grid", "touch_zones"],
        "At least four consecutive single inputs alternate between a touch/touch-hold "
        "onset and a tap/star button input, with positive gaps at most half a beat and "
        "one second. Simultaneous touch/button chords do not count as alternation.",
    ),
}


def beat_clock(chart):
    anchors = chart["bpm_segments"]
    times = [a["time_us"] for a in anchors]

    def at(time):
        index = bisect_right(times, time) - 1
        if index < 0:
            return None
        anchor = anchors[index]
        return decode_rational(anchor["beat"]) + Fraction(
            time - anchor["time_us"], 60_000_000
        ) * decode_rational(anchor["bpm"])

    return at


def _overlaps(chart, *, holds):
    changes = defaultdict(list)
    for slide in chart["slides"]:
        start, end = slide["movement_start_us"], slide["movement_end_us"]
        if start < end:
            value = ("slide", slide["path_id"], slide["head_id"], start)
            changes[start].append((1, value))
            changes[end].append((-1, value))
    if holds:
        for hold in chart["holds"]:
            start, end = hold["start_us"], hold["end_us"]
            if start < end:
                value = ("hold", hold["hold_id"], hold["onset_id"], start)
                changes[start].append((1, value))
                changes[end].append((-1, value))
    active = {"hold": {}, "slide": {}}
    starts = Counter()
    found, beginning, witnesses, peak = [], None, {}, 0
    for time, transitions in sorted(changes.items()):
        for change, value in sorted(transitions):
            kind, identity, head, start = value
            if change < 0:
                active[kind].pop(identity, None)
            else:
                active[kind][identity] = value
            if kind == "slide":
                starts[start] += change
                if not starts[start]:
                    del starts[start]
        matches = bool(active["hold"] and active["slide"]) if holds else len(starts) >= 2
        if matches:
            if beginning is None:
                beginning = time
            peak = max(peak, len(active["hold"]) + len(active["slide"]))
            # Bounded deterministic witnesses without sorting the whole active set.
            for kind in ("hold", "slide"):
                for value in islice(active[kind].values(), 32):
                    if len(witnesses) < 64:
                        witnesses[(value[0], value[1])] = value
        elif beginning is not None:
            values = list(witnesses.values())
            found.append(
                (
                    beginning,
                    time,
                    sorted({v[2] for v in values if v[2]}),
                    sorted({v[1] for v in values}),
                    {"peak_concurrency": peak},
                )
            )
            beginning, witnesses, peak = None, {}, 0
    return found


def _variable_waits(chart):
    at = beat_clock(chart)
    by_head = defaultdict(list)
    for slide in chart["slides"]:
        if slide["head_id"]:
            by_head[slide["head_id"]].append(slide)
    runs, run = [], []

    def store():
        if len(run) < 3:
            return
        waits = [r[2] for r in run]
        # Two microseconds at the largest admitted BPM is under 1/10000 beat.
        if max(waits) - min(waits) >= Fraction(1, 4) - Fraction(1, 10000):
            paths = [s for _, slides, _ in run for s in slides]
            runs.append(
                (
                    run[0][0]["time_us"],
                    max(s["wait_end_us"] for s in paths),
                    [e["event_id"] for e, _, _ in run],
                    [s["path_id"] for s in paths],
                    {
                        "head_count": len(run),
                        "minimum_wait_beats": round(float(min(waits)), 6),
                        "maximum_wait_beats": round(float(max(waits)), 6),
                    },
                )
            )

    for event in chart["onsets"]:
        paths = by_head.get(event["event_id"])
        if not paths:
            continue
        waits = []
        for path in paths:
            start, end = at(path["wait_start_us"]), at(path["wait_end_us"])
            if start is not None and end is not None:
                waits.append(end - start)
        valid = (
            len(waits) == len(paths)
            and min(waits) > 0
            and max(waits) - min(waits) <= Fraction(1, 10000)
        )
        adjacent = not run or (
            0 < _gap(run[-1][0], event) <= 4
            and event["time_us"] - run[-1][0]["time_us"] <= 4_000_000
        )
        if not valid or not adjacent:
            store()
            run = []
        if valid:
            run.append((event, paths, waits[0]))
    store()
    return runs


def _touch_interleaving(chart):
    found = []

    def kind(event):
        return (
            "touch"
            if event["role"] in {"touch", "touch_hold"}
            else "button"
            if event["role"] in {"tap", "star_tap"}
            else None
        )

    for singles in _single_runs(_groups(chart), chart=chart):
        run = []
        for event in singles:
            current = kind(event)
            compatible = current is not None and (
                not run
                or (
                    current != kind(run[-1])
                    and 0 < _gap(run[-1], event) <= Fraction(1, 2)
                    and 0 < event["time_us"] - run[-1]["time_us"] <= 1_000_000
                )
            )
            if not compatible:
                if len(run) >= 4:
                    found.append(occurrence(run))
                run = []
            if current:
                run.append(event)
        if len(run) >= 4:
            found.append(occurrence(run))
    return found


def detect_intervals(chart):
    caps = set(chart["capabilities"])
    result = {}
    if {"timing", "slide_movement"} <= caps:
        result["pattern.staggered_slide_starts"] = _overlaps(chart, holds=False)
    if {"timing", "hold_intervals", "slide_movement"} <= caps:
        result["pattern.hold_slide_overlap"] = _overlaps(chart, holds=True)
    if {"timing", "beat_grid", "slide_wait", "slide_groups"} <= caps and chart["bpm_segments"]:
        result["pattern.variable_slide_wait"] = _variable_waits(chart)
    if {"timing", "beat_grid", "touch_zones"} <= caps:
        result["pattern.touch_tap_interleave"] = _touch_interleaving(chart)
    return result
