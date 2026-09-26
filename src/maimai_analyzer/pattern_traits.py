"""Chart-shape observations with published thresholds and traceable time spans.

Whole-chart comparisons use the observed chart span. No missing audio intro,
outro, physical strain, score risk or recovery benefit is inferred.
"""

from bisect import bisect_left, bisect_right
from collections import defaultdict
from math import sqrt
from statistics import median

from .chart_input import content_hash
from .flow import is_known
from .pattern_intervals import beat_clock
from .pattern_sequences import _gap, _groups, _single_runs, occurrence
from .rational import decode_rational

DEFINITIONS = {
    "trait.high_onset_density": (
        ["timing"],
        "A complete one-second window contains at least 12 physical input onsets at "
        "four or more distinct times. Windows advance by 250 ms; overlapping hits "
        "merge. This absolute threshold describes input rate, not player difficulty.",
    ),
    "trait.sustained_density": (
        ["timing"],
        "At least four consecutive complete one-second bins each contain eight or "
        "more inputs at four or more distinct times. Bins start at the observed "
        "chart start. Missing time or a lower-density bin splits a stretch.",
    ),
    "trait.isolated_density_spike": (
        ["timing"],
        "Exactly one interior group of one-second bins reaches at least eight "
        "inputs/s and twice the median bin count of a fully observed chart span. "
        "Lower bins bracket it; a peak is not a difficulty or scoring claim.",
    ),
    "trait.multi_peak_density": (
        ["timing"],
        "Two or more interior groups meet the same peak rule: at least eight inputs/s "
        "and twice the median one-second bin count, with a lower bin on both sides "
        "and at least one lower bin between groups, over a fully observed chart span.",
    ),
    "trait.low_onset_gaps": (
        ["timing"],
        "At least two consecutive complete one-second bins contain at most one new "
        "input each, in a chart with at least four observed inputs. Ongoing holds "
        "and slides may remain, so this does not claim a rest or recovery opportunity.",
    ),
    "trait.break_concentration": (
        ["timing", "note_flags"],
        "A four-second window contains at least four break inputs, at least 40% of "
        "the chart's break inputs, and a break fraction of at least 25% and 1.5 times "
        "the chart-wide fraction. Windows advance by one second; overlapping hits "
        "merge. Counts concern break input flags, not rating-weighted scoring objects.",
    ),
    "trait.rhythm_variability": (
        ["timing", "beat_grid"],
        "At least 12 consecutive single inputs have positive gaps no greater than "
        "one beat or one second, two or more distinct beat gaps, coefficient of "
        "variation at least 0.35, and changed spacing at at least 35% of transitions. "
        "Beat units prevent tempo changes alone from creating variability.",
    ),
    "trait.repeated_motif": (
        [
            "timing",
            "beat_grid",
            "positions",
            "note_flags",
            "hold_intervals",
            "slide_wait",
            "slide_movement",
            "slide_groups",
        ],
        "Two disjoint eight-onset-group phrases, spanning two to eight beats, have "
        "the same beat gaps, input roles, positions, flags, hold lengths and slide "
        "wait/movement lengths and source path strings. Phrases require at least "
        "two input positions or roles; single repeated-button streams are excluded. "
        "Slide paths must be present. Exact layout only; no reflection or "
        "playable-strategy equivalence is inferred.",
    ),
    "trait.isolated_pattern_sections": (
        ["timing", "hold_intervals", "slide_movement"],
        "A supported input pattern spanning at least 250 ms and three inputs has "
        "no unrelated overlapping hold/slide movement, at most 20% extra inputs "
        "inside it, and at most two extra inputs in its half-second surroundings. "
        "This is target-specific isolation, not evidence of training effectiveness.",
    ),
}


def _merge(rows):
    merged = []
    for start, end in rows:
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(end, merged[-1][1])
        else:
            merged.append([start, end])
    return merged


def _stretches(rows, minimum):
    return [(a, b) for a, b in _merge(rows) if b - a >= minimum]


def _density(chart):
    result = defaultdict(list)
    events = chart["onsets"]
    times = [e["time_us"] for e in events]
    distinct = sorted(set(times))
    start, end = chart["span_start_us"], chart["span_end_us"]
    if end - start < 1_000_000:
        return result

    def count(a, b, values=times):
        return bisect_left(values, b) - bisect_left(values, a)

    def record(name, spans, **measurements):
        for a, b in spans:
            selected = events[bisect_left(times, a) : bisect_left(times, b)]
            result[name].append(
                (
                    a,
                    b,
                    [e["event_id"] for e in selected],
                    [],
                    {
                        "onset_count": len(selected),
                        "span_basis": chart["span_basis"],
                        **measurements,
                    },
                )
            )

    high = []
    for a in range(start, end - 1_000_000 + 1, 250_000):
        b = a + 1_000_000
        if count(a, b) >= 12 and count(a, b, distinct) >= 4 and is_known(a, b, chart):
            high.append((a, b))
    record("trait.high_onset_density", _merge(high), threshold_onsets_per_second=12)
    bins = [(a, a + 1_000_000) for a in range(start, end - 1_000_000 + 1, 1_000_000)]
    counts = [count(a, b) for a, b in bins]
    sustained = [
        (a, b)
        for (a, b), n in zip(bins, counts, strict=True)
        if n >= 8 and count(a, b, distinct) >= 4 and is_known(a, b, chart)
    ]
    record(
        "trait.sustained_density", _stretches(sustained, 4_000_000), threshold_onsets_per_second=8
    )
    if len(events) >= 4:
        quiet = [
            (a, b)
            for (a, b), n in zip(bins, counts, strict=True)
            if n <= 1 and is_known(a, b, chart)
        ]
        record("trait.low_onset_gaps", _stretches(quiet, 2_000_000))
    if not is_known(start, end, chart):
        return result
    if len(bins) >= 3:
        threshold = max(8, 2 * median(counts))
        peak_rows = [(a, b) for (a, b), n in zip(bins, counts, strict=True) if n >= threshold]
        peaks = [(a, b) for a, b in _merge(peak_rows) if a > start and b < bins[-1][1]]
        if peaks:
            name = "trait.isolated_density_spike" if len(peaks) == 1 else "trait.multi_peak_density"
            record(
                name,
                peaks,
                threshold_onsets_per_second=threshold,
                context_span_us=[start, end],
                peak_count=len(peaks),
            )
    if "note_flags" in chart["capabilities"]:
        breaks = [e["time_us"] for e in events if e["break"]]
        whole_fraction = len(breaks) / len(events) if events else 0
        concentrated = []
        for a in range(start, end - 4_000_000 + 1, 1_000_000):
            b = a + 4_000_000
            total, flagged = count(a, b), count(a, b, breaks)
            if (
                flagged >= 4
                and flagged >= len(breaks) * 0.4
                and flagged / total >= max(0.25, 1.5 * whole_fraction)
            ):
                concentrated.append((a, b))
        record("trait.break_concentration", _merge(concentrated), context_span_us=[start, end])
    return result


def _rhythm_variability(chart):
    found = []

    def store(run):
        if len(run) < 12:
            return
        gaps = [_gap(a, b) for a, b in zip(run, run[1:], strict=False)]
        mean = sum(gaps) / len(gaps)
        variation = sqrt(float(sum((g - mean) ** 2 for g in gaps) / len(gaps))) / float(mean)
        transitions = sum(a != b for a, b in zip(gaps, gaps[1:], strict=False)) / (len(gaps) - 1)
        if len(set(gaps)) >= 2 and variation >= 0.35 and transitions >= 0.35:
            found.append(
                occurrence(
                    run,
                    beat_gap_variation=round(variation, 6),
                    changed_gap_fraction=round(transitions, 6),
                )
            )

    for events in _single_runs(_groups(chart), chart=chart):
        run = []
        for event in events:
            if run and not (
                0 < _gap(run[-1], event) <= 1 and event["time_us"] - run[-1]["time_us"] <= 1_000_000
            ):
                store(run)
                run = []
            run.append(event)
        store(run)
    return found


def _repeated(chart):
    groups = _groups(chart)
    holds, slides = {}, defaultdict(list)
    at = beat_clock(chart)
    for hold in chart["holds"]:
        a, b = at(hold["start_us"]), at(hold["end_us"])
        holds[hold["onset_id"]] = (
            round(float(b - a), 5)
            if a is not None and b is not None and is_known(hold["start_us"], hold["end_us"], chart)
            else None
        )
    for slide in chart["slides"]:
        moments = [
            at(slide[k])
            for k in ("wait_start_us", "wait_end_us", "movement_start_us", "movement_end_us")
        ]
        if (
            not slide["path"]
            or None in moments
            or not is_known(slide["wait_start_us"], slide["movement_end_us"], chart)
        ):
            slides[slide["head_id"]].append(None)
        else:
            slides[slide["head_id"]].append(
                (
                    slide["path"],
                    round(float(moments[1] - moments[0]), 5),
                    round(float(moments[3] - moments[2]), 5),
                    len(slide["segment_ids"]),
                )
            )
    signatures = []
    for group in groups:
        fields = []
        for e in group:
            h, paths = holds.get(e["event_id"]), slides.get(e["event_id"], [])
            if (e["event_id"] in holds and h is None) or None in paths:
                fields = None
                break
            fields.append(
                (e["role"], e["position"], e["break"], e["ex"], h, tuple(sorted(paths, key=repr)))
            )
        signatures.append(tuple(sorted(fields, key=repr)) if fields is not None else None)
    buckets = defaultdict(list)
    for i in range(len(groups) - 7):
        selected = groups[i : i + 8]
        if any(s is None for s in signatures[i : i + 8]):
            continue
        beats = [decode_rational(g[0]["beat"]) for g in selected]
        gaps = tuple(b - a for a, b in zip(beats, beats[1:], strict=False))
        if not (2 <= beats[-1] - beats[0] <= 8 and all(0 < g <= 1 for g in gaps)):
            continue
        if len({(e["role"], e["position"]) for group in selected for e in group}) < 2:
            continue
        if not is_known(selected[0][0]["time_us"], selected[-1][0]["time_us"] + 1, chart):
            continue
        key = (tuple((g.numerator, g.denominator) for g in gaps), tuple(signatures[i : i + 8]))
        buckets[key].append(i)
    found, used = [], set()
    for signature, offsets in sorted(buckets.items(), key=lambda pair: pair[1][0]):
        chosen = []
        for offset in offsets:
            if (not chosen or offset >= chosen[-1] + 8) and not any(
                i in used for i in range(offset, offset + 8)
            ):
                chosen.append(offset)
        if len(chosen) < 2:
            continue
        motif_id = content_hash(signature)[:16]
        for offset in chosen:
            used.update(range(offset, offset + 8))
            events = [e for group in groups[offset : offset + 8] for e in group]
            found.append(
                occurrence(
                    events,
                    motif_id=motif_id,
                    repeat_count=len(chosen),
                    signature_policy="exact-layout-eight-groups-v1",
                )
            )
    return found


def _isolated(chart, patterns, eligible):
    events = chart["onsets"]
    times = [e["time_us"] for e in events]
    intervals, by_event, by_path = [], defaultdict(list), {}
    for kind, records in (("hold", chart["holds"]), ("slide", chart["slides"])):
        for item in records:
            a, b = (
                (item["start_us"], item["end_us"])
                if kind == "hold"
                else (item["movement_start_us"], item["movement_end_us"])
            )
            if a == b:
                continue
            identity = item["hold_id"] if kind == "hold" else item["path_id"]
            head = item["onset_id"] if kind == "hold" else item["head_id"]
            record = (kind, identity, a, b)
            intervals.append(record)
            by_event[head].append(record)
            by_path[(kind, identity)] = record
    starts, ends = sorted(r[2] for r in intervals), sorted(r[3] for r in intervals)
    found = []
    for pattern_id, matches in sorted(patterns.items()):
        if not pattern_id.startswith("pattern.") or pattern_id not in eligible:
            continue
        for a, b, ids, paths, measurements in matches:
            if not is_known(*measurements.get("context_span_us", [a, b]), chart):
                continue
            own = set(ids)
            if b - a < 250000 or len(own) < 3 or not is_known(a, b, chart):
                continue
            left, right = (
                max(chart["span_start_us"], a - 500000),
                min(chart["span_end_us"], b + 500000),
            )
            if not is_known(left, right, chart):
                continue
            inner = events[bisect_left(times, a) : bisect_left(times, b)]
            extra = sum(e["event_id"] not in own for e in inner)
            neighbors = bisect_left(times, right) - bisect_left(times, left) - len(inner)
            permitted = {r for e in own for r in by_event[e]}
            permitted.update(
                by_path[(kind, p)]
                for p in paths
                for kind in ("hold", "slide")
                if (kind, p) in by_path
            )
            overlap = bisect_left(starts, b) - bisect_right(ends, a)
            own_overlap = sum(r[2] < b and r[3] > a for r in permitted)
            if extra <= len(own) * 0.2 and neighbors <= 2 and overlap == own_overlap:
                found.append(
                    (
                        a,
                        b,
                        ids,
                        paths,
                        {
                            "target_pattern_id": pattern_id,
                            "extra_input_count": extra,
                            "surrounding_input_count": neighbors,
                            "context_span_us": [left, right],
                            "onset_count": len(own),
                        },
                    )
                )
    return found


def detect_traits(chart, patterns, eligible):
    caps = set(chart["capabilities"])
    result = _density(chart) if "timing" in caps else {}
    if {"timing", "beat_grid"} <= caps:
        result["trait.rhythm_variability"] = _rhythm_variability(chart)
    required = set(DEFINITIONS["trait.repeated_motif"][0])
    if required <= caps:
        result["trait.repeated_motif"] = _repeated(chart)
    if {"timing", "hold_intervals", "slide_movement"} <= caps:
        result["trait.isolated_pattern_sections"] = _isolated(chart, patterns, eligible)
    return result
