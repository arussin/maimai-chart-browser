"""Deterministic 250 ms feature grid, rate windows and peak-preserving Flow."""

from __future__ import annotations

from bisect import bisect_left
from copy import deepcopy
from math import sqrt

from .chart_input import ChartInputError

DEFAULT_CONFIG = {
    "policy_version": "structural-demand-0.1-experimental",
    "frame_us": 250_000,
    "section_us": 4_000_000,
    "segment_count": 24,
    "demand_weights": {
        "density": 0.55,
        "coordination": 0.25,
        "sustained_activity": 0.15,
        "rhythm_variation": 0.05,
    },
    "reference_scale_id": "absolute-flow-bands-0.1",
}
SCALES = {
    "reference_scale_id": "absolute-flow-bands-0.1",
    "kind": "shared_absolute",
    "density": {"unit": "onsets/second", "bands": [0, 2, 4, 6, 8, 12]},
    "estimated_demand": {"unit": "provisional demand units", "bands": [0, 1, 2, 3, 4, 6]},
    "interpretation": "Display bands, not validated skill or difficulty thresholds.",
}


def validated_config(config: dict | None) -> dict:
    value = {**DEFAULT_CONFIG, "demand_weights": dict(DEFAULT_CONFIG["demand_weights"])}
    if config is None:
        return value
    if not isinstance(config, dict) or set(config) - {"demand_weights"}:
        raise ChartInputError("Only explicit experimental demand weights are configurable in v0")
    weights = config.get("demand_weights", value["demand_weights"])
    if not isinstance(weights, dict) or set(weights) != set(value["demand_weights"]):
        raise ChartInputError("Demand weights must specify all four supported groups")
    if any(type(weight) not in {int, float} or not 0 <= weight <= 1 for weight in weights.values()):
        raise ChartInputError("Demand weights must be finite numbers in [0,1]")
    if abs(sum(weights.values()) - 1) > 0.000001:
        raise ChartInputError("Demand weights must sum to 1")
    value["demand_weights"] = dict(weights)
    return value


def quantize(value: float) -> float:
    """Six decimals; Python round ties to even in the pinned supported runtime."""
    return round(value, 6)


def covered_us(start: int, end: int, intervals: list[list[int]]) -> int:
    return sum(max(0, min(end, right) - max(start, left)) for left, right in intervals)


def is_known(start: int, end: int, chart: dict) -> bool:
    return "timing" in chart["capabilities"] and (
        start == end or covered_us(start, end, chart["known_intervals"]) == end - start
    )


def interval_grid(
    intervals: list[tuple[int, int]], starts: list[int], ends: list[int]
) -> list[dict]:
    """Sweep half-open intervals; ends precede starts at shared boundaries."""
    changes: dict[int, int] = {}
    for start, end in intervals:
        if end > start:
            changes[start] = changes.get(start, 0) + 1
            changes[end] = changes.get(end, 0) - 1
    points = sorted(changes)
    index = count = 0
    result = []
    for start, end in zip(starts, ends, strict=True):
        while index < len(points) and points[index] <= start:
            count += changes[points[index]]
            index += 1
        current, total, occupied, peak = start, 0, 0, count
        while index < len(points) and points[index] < end:
            point = points[index]
            total += (point - current) * count
            occupied += (point - current) * bool(count)
            count += changes[point]
            peak = max(peak, count)
            current = point
            index += 1
        total += (end - current) * count
        occupied += (end - current) * bool(count)
        duration = end - start
        result.append(
            {
                "occupancy": quantize(occupied / duration) if duration else 0,
                "mean_concurrency": quantize(total / duration) if duration else 0,
                "peak_concurrency": peak,
            }
        )
    return result


def _summary(segments: list[dict], metric: str) -> dict:
    valid = [segment for segment in segments if segment[metric]["mean"] is not None]
    lengths = [(item["end_us"] - item["start_us"]) * item[metric]["coverage"] for item in valid]
    duration = sum(lengths)
    total_duration = sum(item["end_us"] - item["start_us"] for item in segments)
    mean = sum(item[metric]["mean"] * length for item, length in zip(valid, lengths, strict=True))
    peak = max((item[metric]["peak"] for item in valid), default=None)
    average = mean / duration if duration else (0 if valid else None)
    cv = (
        sqrt(
            sum(
                (item[metric]["mean"] - average) ** 2 * length
                for item, length in zip(valid, lengths, strict=True)
            )
            / duration
        )
        / average
        if average and duration
        else 0
    )
    peak_index = max(
        range(len(segments)), key=lambda i: segments[i][metric]["peak"] or 0, default=None
    )
    return {
        "mean": quantize(average) if average is not None else None,
        "peak": peak,
        "peak_segment": peak_index if valid else None,
        "variation": quantize(cv) if average is not None else None,
        "coverage": quantize(duration / total_duration) if total_duration else 0,
    }


def build_flow(chart: dict, config: dict) -> dict:
    start, end = chart["span_start_us"], chart["span_end_us"]
    caps = chart["capabilities"]
    frame_us = config["frame_us"]
    starts = list(range(start, end, frame_us)) or [start]
    ends = [min(value + frame_us, end) for value in starts]
    hold = [(item["start_us"], item["end_us"]) for item in chart["holds"]]
    moving = [(item["movement_start_us"], item["movement_end_us"]) for item in chart["slides"]]
    waiting = [(item["wait_start_us"], item["wait_end_us"]) for item in chart["slides"]]
    grids = {
        "hold": interval_grid(hold, starts, ends),
        "movement": interval_grid(moving, starts, ends),
        "wait": interval_grid(waiting, starts, ends),
        "activity": interval_grid(hold + moving, starts, ends),
    }
    times = [event["time_us"] for event in chart["onsets"]]
    groups: dict[str, list[dict]] = {}
    for event in chart["onsets"]:
        if event["group_id"] is not None:
            groups.setdefault(event["group_id"], []).append(event)
    group_times = sorted(group[0]["time_us"] for group in groups.values() if len(group) > 1)
    demand_caps = {
        "timing",
        "hold_intervals",
        "slide_movement",
        "slide_wait",
        "authored_simultaneity",
    }
    frames = []
    for index, (left, right) in enumerate(zip(starts, ends, strict=True)):
        duration = right - left
        coverage = covered_us(left, right, chart["known_intervals"]) / duration if duration else 1
        if "timing" not in caps:
            coverage = 0
        complete = coverage == 1
        lo, hi = bisect_left(times, left), bisect_left(times, right)
        # Sample a trailing 250 ms window at frame end. A final 1 us point-inclusion
        # frame must not reinterpret its one onset as one million onsets/second.
        density_start = max(start, right - frame_us)
        density_duration = right - density_start
        density_count = bisect_left(times, right) - bisect_left(times, density_start)
        point_only = chart["span_basis"] == "chart_span" and end - start <= 1
        density_known = is_known(density_start, right, chart) and not point_only
        density = density_count * 1_000_000 / density_duration if density_duration else 0
        rates = {}
        for seconds in (1, 4):
            window_start = max(start, right - seconds * 1_000_000)
            window_length = right - window_start
            count = bisect_left(times, right) - bisect_left(times, window_start)
            rates[f"rate_{seconds}s"] = (
                quantize(count * 1_000_000 / window_length)
                if window_length and is_known(window_start, right, chart) and not point_only
                else (0 if not window_length and complete and not point_only else None)
            )
        channels = {
            "hold_occupancy": grids["hold"][index]["occupancy"]
            if "hold_intervals" in caps
            else None,
            "slide_movement_occupancy": grids["movement"][index]["occupancy"]
            if "slide_movement" in caps
            else None,
            "slide_wait_occupancy": grids["wait"][index]["occupancy"]
            if "slide_wait" in caps
            else None,
            "moving_concurrency": grids["movement"][index]["peak_concurrency"]
            if "slide_movement" in caps
            else None,
            "active_concurrency": grids["activity"][index]["peak_concurrency"]
            if {"slide_movement", "hold_intervals"} <= set(caps)
            else None,
        }
        chords = bisect_left(group_times, right) - bisect_left(group_times, left)
        coordination = min(4, chords + grids["activity"][index]["mean_concurrency"])
        sustained = min(4, grids["activity"][index]["mean_concurrency"])
        local_times = times[max(0, lo - 1) : hi]
        gaps = [b - a for a, b in zip(local_times, local_times[1:], strict=False) if b > a]
        mean_gap = sum(gaps) / len(gaps) if gaps else 0
        variation = (
            min(4, sqrt(sum((gap - mean_gap) ** 2 for gap in gaps) / len(gaps)) / mean_gap)
            if mean_gap
            else 0
        )
        terms = {
            "density": density,
            "coordination": coordination,
            "sustained_activity": sustained,
            "rhythm_variation": variation,
        }
        demand = (
            sum(config["demand_weights"][key] * value for key, value in terms.items())
            if complete and density_known and demand_caps <= set(caps)
            else None
        )
        frames.append(
            {
                "start_us": left,
                "end_us": right,
                "coverage": quantize(coverage),
                "onset_count": hi - lo,
                "density": quantize(density) if density_known else None,
                "density_window_us": density_duration,
                "estimated_demand": quantize(demand) if demand is not None else None,
                **rates,
                "channels": {key: value if complete else None for key, value in channels.items()},
                "demand_terms": {key: quantize(value) for key, value in terms.items()}
                if demand is not None
                else None,
            }
        )
    segments = []
    for index in range(config["segment_count"] if end - start >= config["segment_count"] else 0):
        left = start + (end - start) * index // config["segment_count"]
        right = start + (end - start) * (index + 1) // config["segment_count"]
        overlaps = [
            (frame, max(0, min(right, frame["end_us"]) - max(left, frame["start_us"])))
            for frame in frames[
                max(0, (left - start) // frame_us) : min(
                    len(frames), (right - start) // frame_us + 1
                )
            ]
        ]
        if not right - left:
            overlaps = [(frames[0], 0)]
        segment = {
            "start_us": left,
            "end_us": right,
            "coverage": quantize(covered_us(left, right, chart["known_intervals"]) / (right - left))
            if right > left and "timing" in caps
            else (1 if "timing" in caps else 0),
        }
        for metric in ("density", "estimated_demand"):
            valid = [
                (frame[metric], duration)
                for frame, duration in overlaps
                if frame[metric] is not None and (duration or right == left)
            ]
            length = sum(duration for _, duration in valid)
            metric_coverage = length / (right - left) if right > left else bool(valid)
            # Partial means cover measured frames only and must carry their own coverage.
            segment[metric] = {
                "mean": quantize(sum(value * duration for value, duration in valid) / length)
                if length
                else (0 if valid else None),
                "peak": max((value for value, _ in valid), default=None),
                "coverage": quantize(metric_coverage),
            }
        contributions = {
            key: sum(
                frame["demand_terms"][key] * duration
                for frame, duration in overlaps
                if frame["demand_terms"] is not None
            )
            for key in config["demand_weights"]
        }
        segment["contributors"] = (
            sorted(contributions, key=lambda key: (-contributions[key], key))[:2]
            if any(frame["demand_terms"] is not None for frame, _ in overlaps)
            else []
        )
        segments.append(segment)
    return {
        "span_start_us": start,
        "span_end_us": end,
        "basis": chart["span_basis"],
        "frame_us": frame_us,
        "density_window_policy": "Trailing 250 ms at each frame end; explicit effective length.",
        "frames": frames,
        "segments": segments,
        "scales": deepcopy(SCALES),
        "demand_policy": config,
        "density_summary": _summary(segments, "density"),
        "demand_summary": _summary(segments, "estimated_demand"),
        "relative_mode": "Divide observed mean/peak by this chart's supported peak; shape only.",
        "unavailable_reason": "Chart span too short for a 24-segment microsecond timeline."
        if end - start < config["segment_count"]
        else None,
    }
