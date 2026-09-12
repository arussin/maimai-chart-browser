"""Experimental, player-independent challenge measurements and beat windows.

This parallel profile leaves legacy analyzer output intact for baseline replay.
No difficulty estimate, hand assignment, or calibrated relevance is implied.
"""

from __future__ import annotations

import math
import re
from bisect import bisect_left, bisect_right
from collections import Counter
from fractions import Fraction
from statistics import mean

from .contracts import content_hash, normalize_chart
from .rational import decode_rational, encode_rational

VERSION = "challenge-profile-1-experimental"
GEOMETRY_VERSION = "schematic-line-v-1"
GROUPS = ("cadence", "rhythm", "coordination", "holds", "slides", "spatial")


def point(position):
    """Unit circle, button 1 at upper right, clockwise; touch radii schematic."""
    if position == "C":
        return [0.0, 0.0]
    if type(position) is int and 1 <= position <= 8:
        number, radius, offset = position, 1.0, 0
    elif isinstance(position, str) and re.fullmatch("[ABDE][1-8]", position):
        number = int(position[1])
        radius = {"A": 1.0, "B": 0.55, "D": 1.0, "E": 0.55}[position[0]]
        offset = -0.5 if position[0] in "DE" else 0
    else:
        return None
    angle = (number - 0.5 + offset) * math.pi / 4
    return [round(radius * math.sin(angle), 6), round(-radius * math.cos(angle), 6)]


def path_geometry(notation):
    """Only independently defined straight/center-V schematics; no guessed curves."""
    match = re.fullmatch(r"simai:([1-8])([-v])([1-8])", notation or "")
    if not match:
        return None
    start, shape, end = match.groups()
    if start == end:
        return None
    points = [point(int(start)), point(int(end))]
    if shape == "v":
        points.insert(1, [0.0, 0.0])
    return {
        "version": GEOMETRY_VERSION,
        "points": points,
        "status": "schematic",
        "game_fidelity": "unverified",
    }


def _mean(values):
    return round(mean(values), 6) if values else 0.0


def _quantile(values, q):
    return sorted(values)[min(len(values) - 1, int((len(values) - 1) * q))] if values else 0


def _clock(chart):
    anchors = chart["bpm_segments"]
    times = [a["time_us"] for a in anchors]
    beats = [decode_rational(a["beat"]) for a in anchors]

    def beat_at(t):
        i = max(0, bisect_right(times, t) - 1)
        return beats[i] + Fraction(t - times[i], 60_000_000) * decode_rational(anchors[i]["bpm"])

    def time_at(b):
        i = max(0, bisect_right(beats, b) - 1)
        return times[i] + round((b - beats[i]) * 60_000_000 / decode_rational(anchors[i]["bpm"]))

    return beat_at, time_at


def _occupancy(intervals, left, right):
    return round(
        sum(max(0, min(b, right) - max(a, left)) for a, b in intervals) / (right - left), 6
    )


def _measure(events, left, right, holds, slides):
    duration = (right - left) / 1_000_000
    times = [e["time_us"] for e in events]
    counts = [bisect_left(times, t + 1_000_000) - i for i, t in enumerate(times)]
    beats = sorted({decode_rational(e["beat"]) for e in events if e["beat"] is not None})
    gaps = [float(b - a) for a, b in zip(beats, beats[1:], strict=False)]
    gap_mean = _mean(gaps)
    groups = Counter(e["group_id"] for e in events if e.get("group_id"))
    button_groups = []
    for t in sorted(set(times)):
        button_groups.append(
            [
                e["position"]
                for e in events[bisect_left(times, t) : bisect_right(times, t)]
                if type(e["position"]) is int
            ]
        )
    steps = [
        min((b[0] - a[0]) % 8, (a[0] - b[0]) % 8)
        for a, b in zip(button_groups, button_groups[1:], strict=False)
        if len(a) == len(b) == 1
    ]
    spans = [
        max(min((a - b) % 8, (b - a) % 8) for a in group for b in group)
        for group in button_groups
        if len(group) > 1
    ]
    touching = sum(isinstance(e["position"], str) for e in events)
    count = len(events)
    return {
        "cadence": {
            "mean_onsets_s": round(count / duration, 6),
            "peak_onsets_s": max(counts, default=0),
            "p90_onsets_s": _quantile(counts, 0.9),
        },
        "rhythm": {
            "gap_beats": gap_mean,
            "gap_variation": round(
                math.sqrt(_mean([(x - gap_mean) ** 2 for x in gaps])) / gap_mean, 6
            )
            if gap_mean
            else 0,
        },
        "coordination": {
            "simultaneous_fraction": round(sum(v for v in groups.values() if v > 1) / count, 6)
            if count
            else 0,
            "maximum_group": max(groups.values(), default=1 if count else 0),
        },
        "holds": {"occupancy": _occupancy(holds, left, right)},
        "slides": {
            "occupancy": _occupancy(
                [(s["movement_start_us"], s["movement_end_us"]) for s in slides], left, right
            ),
            "wait_occupancy": _occupancy(
                [(s["wait_start_us"], s["wait_end_us"]) for s in slides], left, right
            ),
        },
        "spatial": {
            "single_step_buttons": _mean(steps),
            "simultaneous_span_buttons": _mean(spans),
            "touch_fraction": round(touching / count, 6) if count else 0,
        },
    }


def _tokens(events, relations=None):
    """Group equal-beat inputs; retain authored grouping and relative button steps."""
    grouped = []
    for event in events:
        beat = decode_rational(event["beat"])
        if not grouped or grouped[-1][0] != beat:
            grouped.append((beat, []))
        grouped[-1][1].append(event)
    previous, origin, tokens = None, None, []
    for beat, group in grouped:
        buttons = [e["position"] for e in group if type(e["position"]) is int]
        if origin is None and buttons:
            origin = min(buttons)
        roles = sorted(e["role"] for e in group)
        positions = sorted((p - origin) % 8 for p in buttons) if origin is not None else []
        touch = sorted(e["position"] for e in group if isinstance(e["position"], str))
        gap = float(beat - previous) if previous is not None else 0
        tokens.append(
            [
                round(gap, 6),
                roles,
                positions,
                touch,
                len({e["group_id"] for e in group if e.get("group_id")}),
                sorted((relations or {}).get(e["event_id"], []) for e in group),
            ]
        )
        previous = beat
    if not any(token[3] for token in tokens):
        # Canonicalize the entire phrase, including simultaneous groups that
        # cross button eight/one. Choosing the first group's minimum alone is
        # not rotation invariant.
        layouts = min(
            tuple(tuple(sorted((p - shift) % 8 for p in token[2])) for token in tokens)
            for shift in range(8)
        )
        for token, layout in zip(tokens, layouts, strict=False):
            token[2] = list(layout)
    return tokens


def profile_chart(raw):
    chart = normalize_chart(raw)
    events = chart["onsets"]
    if not events or "beat_grid" not in chart["capabilities"] or not chart["bpm_segments"]:
        raise ValueError("Challenge analysis needs playable events and an explicit beat grid")
    if any(e["beat"] is None for e in events):
        raise ValueError("Challenge analysis needs complete onset beat evidence")
    lookup = {e["event_id"]: e for e in events}
    holds = [(lookup[h["onset_id"]]["time_us"], h["end_us"]) for h in chart["holds"]]
    slides = chart["slides"]
    start = min([events[0]["time_us"]] + [s["wait_start_us"] for s in slides])
    end = max(
        [events[-1]["time_us"] + 1] + [b for _, b in holds] + [s["movement_end_us"] for s in slides]
    )
    beat_at, time_at = _clock(chart)
    relations = {}
    for event in events:
        t = event["time_us"]
        paths = [s for s in slides if s["head_id"] == event["event_id"]]
        relations[event["event_id"]] = [
            sum(a <= t < b for a, b in holds),
            sum(s["wait_start_us"] <= t < s["wait_end_us"] for s in slides),
            sum(s["movement_start_us"] <= t < s["movement_end_us"] for s in slides),
            sorted(
                [
                    re.sub(r"[0-9]", "", s.get("path") or "unknown"),
                    round(float(beat_at(s["movement_start_us"]) - beat_at(s["wait_start_us"])), 6),
                    round(
                        float(beat_at(s["movement_end_us"]) - beat_at(s["movement_start_us"])), 6
                    ),
                ]
                for s in paths
            ),
        ]
    first_beat, last_beat = beat_at(start), beat_at(end)
    times = [e["time_us"] for e in events]
    windows = []
    for width in (4, 8, 16):
        at = Fraction(math.floor(first_beat / (width // 2)) * (width // 2))
        while at < last_beat:
            left, right = max(start, time_at(at)), min(end, time_at(at + width))
            if right > left:
                subset = events[bisect_left(times, left) : bisect_left(times, right)]
                if subset:
                    tokens = _tokens(subset, relations)
                    windows.append(
                        {
                            "window_id": f"{width}:{at}",
                            "width_beats": width,
                            "start_us": left,
                            "end_us": right,
                            "start_beat": encode_rational(beat_at(left)),
                            "end_beat": encode_rational(beat_at(right)),
                            "demand": _measure(subset, left, right, holds, slides),
                            "tokens": tokens[:96],
                            "token_count": len(tokens),
                            "complete": len(tokens) <= 96
                            and beat_at(right) - beat_at(left) >= width / 2,
                            "token_coverage": "complete" if len(tokens) <= 96 else "truncated",
                        }
                    )
            at += width // 2
            if len(windows) > 10000:
                raise ValueError("Beat-window resource limit exceeded")
    caps = set(chart["capabilities"])
    required = {
        "cadence": {"timing"},
        "rhythm": {"beat_grid"},
        "coordination": {"authored_simultaneity"},
        "holds": {"hold_intervals"},
        "slides": {"slide_movement", "slide_wait"},
        "spatial": {"positions"},
    }
    demand = _measure(events, start, end, holds, slides)
    for name in GROUPS:
        if not required[name] <= caps:
            demand[name] = {}
            for window in windows:
                window["demand"][name] = {}
    result = {
        "version": VERSION,
        **{key: chart[key] for key in ("chart_id", "song_id", "format", "difficulty", "revision")},
        "source_hash": chart["source"].get("byte_hash") or content_hash(raw),
        "active_span": {"start_us": start, "end_us": end, "basis": "active_events"},
        "demand": demand,
        "windows": windows,
        "geometry_coverage": {
            "supported": sum(path_geometry(s.get("path")) is not None for s in slides),
            "total": len(slides),
            "version": GEOMETRY_VERSION,
        },
        "validation": "experimental; independent review pending",
    }
    return {**result, "profile_hash": content_hash(result)}


def snippet(raw, window):
    chart = normalize_chart(raw)
    left, right = window["start_us"], window["end_us"]
    events = [e for e in chart["onsets"] if left <= e["time_us"] < right]
    ids = {e["event_id"] for e in events}
    lookup = {e["event_id"]: e for e in chart["onsets"]}
    holds = []
    for h in chart["holds"]:
        event = lookup[h["onset_id"]]
        if event["time_us"] < right and h["end_us"] > left:
            holds.append({**h, "start_us": event["time_us"], "position": event["position"]})
    slides = [
        {**s, "geometry": path_geometry(s.get("path"))}
        for s in chart["slides"]
        if s["wait_start_us"] < right and s["movement_end_us"] > left
    ]
    if len(events) > 512 or len(slides) > 256:
        raise ValueError("Snippet exceeds bounded event budget")
    return {
        "version": VERSION,
        "start_us": left,
        "end_us": right,
        "events": events,
        "holds": holds,
        "slides": slides,
        "highlight_ids": sorted(ids),
        "bpm_segments": chart["bpm_segments"],
        "window_id": window["window_id"],
    }
