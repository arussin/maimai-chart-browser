"""Versioned rhythm and button-sequence rules over normalized authored timing.

These are operational observations, not inferred hands or music/audio alignment.
Matches retain maximal runs and exact supporting events. Chords break single-input
runs; equal wall-clock spacing at changing BPM does not establish a rhythm.
"""

from collections import defaultdict
from fractions import Fraction

from .flow import is_known
from .rational import decode_rational

DEFINITIONS = {
    "pattern.gallop_pairs": (
        ["timing", "beat_grid"],
        "At least three single-input short-long pairs with exact recurring beat gaps, "
        "a long/short ratio of 2 or 3, a short gap at most half a beat, and every gap "
        "at most one beat and one second. Simultaneous inputs split a run.",
    ),
    "pattern.three_note_burst": (
        ["timing", "beat_grid"],
        "Exactly three consecutive single inputs, each inner gap at most a quarter "
        "beat and 250 ms. Both neighboring gaps must be at least half a beat and "
        "twice the larger inner gap; clipped boundary triples do not qualify.",
    ),
    "pattern.triplet_grid": (
        ["timing", "beat_grid"],
        "At least six consecutive single inputs on the authored beat grid, equally "
        "spaced by 1/3, 1/6 or 1/12 beat, with every gap at most one second. "
        "A three-note burst alone is insufficient; no audio downbeat is inferred.",
    ),
    "pattern.offbeat_onsets": (
        ["timing", "beat_grid"],
        "At least four consecutive single inputs at the half-beat phase of the "
        "authored grid, exactly one beat apart and at most two seconds apart. "
        "This is a notation-grid observation, not a claim of musical syncopation.",
    ),
    "pattern.chord_stream": (
        ["timing", "beat_grid", "authored_simultaneity"],
        "At least three consecutive authored simultaneous groups, each containing "
        "at least two inputs, with equal positive beat gaps no greater than one "
        "beat or one second. Group sizes and button shapes may differ.",
    ),
    "pattern.tap_staircase": (
        ["timing", "beat_grid", "positions"],
        "A maximal run of four to seven single tap/star inputs stepping to adjacent "
        "buttons in one circular direction. Gaps are at most one beat and one second. "
        "Runs of eight or more inputs are perimeter runs instead.",
    ),
    "pattern.perimeter_run": (
        ["timing", "beat_grid", "positions"],
        "At least eight consecutive single tap/star inputs visiting the full button "
        "ring in one direction, with adjacent steps and gaps at most one beat and "
        "one second. Circular wraparound is retained.",
    ),
    "pattern.direction_reversal": (
        ["timing", "beat_grid", "positions"],
        "A consecutive single tap/star neighbor run changes direction after at least "
        "two steps and continues at least two steps in the opposite direction. "
        "Gaps are at most one beat and one second; a two-position trill is excluded.",
    ),
}


def occurrence(events, **measurements):
    return (
        events[0]["time_us"],
        events[-1]["time_us"] + 1,
        [event["event_id"] for event in events],
        [],
        {"onset_count": len(events), **measurements},
    )


def _groups(chart):
    grouped = defaultdict(list)
    for event in chart["onsets"]:
        grouped[event["time_us"]].append(event)
    return list(grouped.values())


def _single_runs(groups, *, buttons=False, chart=None):
    run = []
    for group in groups:
        event = group[0]
        if run and chart and not is_known(run[-1]["time_us"], event["time_us"] + 1, chart):
            yield run
            run = []
        eligible = (
            len(group) == 1
            and (
                not buttons
                or (type(event["position"]) is int and event["role"] in {"tap", "star_tap"})
            )
            and (chart is None or is_known(event["time_us"], event["time_us"] + 1, chart))
        )
        if not eligible:
            if run:
                yield run
            run = []
        else:
            run.append(event)
    if run:
        yield run


def _gap(left, right):
    return decode_rational(right["beat"]) - decode_rational(left["beat"])


def _near(left, right, *, seconds=1):
    return 0 < _gap(left, right) <= 1 and 0 < right["time_us"] - left["time_us"] <= seconds * 1e6


def _cadences(events, accepted, minimum, *, phase=None, seconds=1):
    """Maximal fixed-gap runs; a failed edge may start a new valid cadence."""
    matches, run, step = [], [], None
    for event in events:
        eligible = phase is None or phase(decode_rational(event["beat"]))
        compatible = eligible
        gap = _gap(run[-1], event) if run and eligible else None
        if run and eligible:
            compatible = (
                gap in accepted
                and (step is None or gap == step)
                and _near(run[-1], event, seconds=seconds)
            )
        if not compatible:
            if len(run) >= minimum:
                matches.append(occurrence(run))
            previous = run[-1:]
            run, step = [], None
            if (
                eligible
                and previous
                and gap in accepted
                and _near(previous[0], event, seconds=seconds)
            ):
                run, step = previous, gap
        if eligible:
            if run and step is None:
                step = _gap(run[-1], event)
            run.append(event)
    if len(run) >= minimum:
        matches.append(occurrence(run))
    return matches


def _rhythm(events):
    result = defaultdict(list)
    beats = [decode_rational(e["beat"]) for e in events]
    gaps = [b - a for a, b in zip(beats, beats[1:], strict=False)]
    i = 0
    while i + 5 < len(events):
        short, long = gaps[i : i + 2]
        if not (0 < short <= Fraction(1, 2) and long <= 1 and long / short in (2, 3)):
            i += 1
            continue
        end = i + 1
        while end < len(events) and gaps[end - 1] == (short if (end - i) % 2 else long):
            if not _near(events[end - 1], events[end]):
                break
            end += 1
        # Complete pairs only: a trailing first note is not another pair.
        pair_end = i + (end - i) // 2 * 2
        if pair_end - i >= 6:
            result["pattern.gallop_pairs"].append(
                occurrence(
                    events[i:pair_end], pair_count=(pair_end - i) // 2, gap_ratio=int(long / short)
                )
            )
            i = pair_end
        else:
            i += 1
    for i in range(1, len(events) - 3):
        inner = gaps[i : i + 2]
        if (
            all(0 < g <= Fraction(1, 4) for g in inner)
            and gaps[i - 1] >= max(Fraction(1, 2), 2 * max(inner))
            and gaps[i + 2] >= max(Fraction(1, 2), 2 * max(inner))
            and all(events[j + 1]["time_us"] - events[j]["time_us"] <= 250_000 for j in (i, i + 1))
        ):
            result["pattern.three_note_burst"].append(
                occurrence(
                    events[i : i + 3],
                    context_span_us=[events[i - 1]["time_us"], events[i + 3]["time_us"] + 1],
                )
            )
    result["pattern.triplet_grid"] = _cadences(
        events,
        {Fraction(1, 3), Fraction(1, 6), Fraction(1, 12)},
        6,
        phase=lambda beat: (beat * 12).denominator == 1,
    )
    result["pattern.offbeat_onsets"] = _cadences(
        events,
        {Fraction(1)},
        4,
        phase=lambda beat: beat % 1 == Fraction(1, 2),
        seconds=2,
    )
    return result


def _direction(left, right):
    difference = (right["position"] - left["position"]) % 8
    return 1 if difference == 1 else -1 if difference == 7 else 0


def _layouts(events):
    result = defaultdict(list)
    run, direction = [], None

    def store_straight():
        if len(run) >= 4:
            name = "tap_staircase" if len(run) < 8 else "perimeter_run"
            result["pattern." + name].append(occurrence(run, direction=direction))

    for event in events:
        step = _direction(run[-1], event) if run else 0
        if run and (not _near(run[-1], event) or not step or direction not in (None, step)):
            store_straight()
            previous = run[-1:]
            run, direction = [], None
            if step and _near(previous[0], event):
                run, direction = previous, step
        if run and direction is None:
            direction = _direction(run[-1], event)
        run.append(event)
    store_straight()

    run = []

    def store_reversal():
        directions = [_direction(a, b) for a, b in zip(run, run[1:], strict=False)]
        blocks = []
        for step in directions:
            if blocks and blocks[-1][0] == step:
                blocks[-1][1] += 1
            else:
                blocks.append([step, 1])
        if any(a[1] >= 2 and b[1] >= 2 for a, b in zip(blocks, blocks[1:], strict=False)):
            result["pattern.direction_reversal"].append(
                occurrence(run, direction_changes=len(blocks) - 1)
            )

    for event in events:
        if run and (not _direction(run[-1], event) or not _near(run[-1], event)):
            store_reversal()
            run = []
        run.append(event)
    store_reversal()
    return result


def detect_sequences(chart):
    result = defaultdict(list)
    if not {"timing", "beat_grid"} <= set(chart["capabilities"]):
        return result
    groups = _groups(chart)
    for run in _single_runs(groups, chart=chart):
        for key, matches in _rhythm(run).items():
            result[key].extend(matches)
    if "positions" in chart["capabilities"]:
        for run in _single_runs(groups, buttons=True, chart=chart):
            for key, matches in _layouts(run).items():
                result[key].extend(matches)
    if "authored_simultaneity" in chart["capabilities"]:
        chord_runs, run = [], []
        for group in groups:
            if run and not is_known(run[-1][0]["time_us"], group[0]["time_us"] + 1, chart):
                chord_runs.append(run)
                run = []
            if (
                len(group) >= 2
                and is_known(group[0]["time_us"], group[0]["time_us"] + 1, chart)
                and group[0]["group_id"] is not None
                and len({e["group_id"] for e in group}) == 1
            ):
                run.append(group)
            else:
                if run:
                    chord_runs.append(run)
                run = []
        if run:
            chord_runs.append(run)
        for chords in chord_runs:
            # Each maximal equal-spacing sequence is found over chord representatives.
            by_id = {g[0]["event_id"]: g for g in chords}
            representatives = [g[0] for g in chords]
            accepted = {
                _gap(a, b) for a, b in zip(representatives, representatives[1:], strict=False)
            }
            accepted = {gap for gap in accepted if 0 < gap <= 1}
            for start, end, ids, paths, _measurements in _cadences(representatives, accepted, 3):
                supporting = [event for key in ids for event in by_id[key]]
                result["pattern.chord_stream"].append(
                    (
                        start,
                        end,
                        [e["event_id"] for e in supporting],
                        paths,
                        {"group_count": len(ids), "onset_count": len(supporting)},
                    )
                )
    return result
