"""Pure profile construction. No acquisition, private scores or report imports."""

from __future__ import annotations

import json
from bisect import bisect_left, bisect_right
from collections import Counter
from fractions import Fraction
from itertools import groupby
from math import lcm, sqrt

from .contracts import (
    ANALYZER_VERSION,
    EXACT_RATIONAL_SCHEMA_VERSION,
    content_hash,
    normalize_chart,
)
from .flow import build_flow, is_known, quantize, validated_config
from .patterns import REGISTRY_VERSION, detect_patterns, pattern_registry
from .rational import MAX_RATIONAL_INTEGER, decode_rational, encode_rational


def _profile_schema(chart: dict) -> str:
    """Select string-capable output before fingerprinting derived occurrence beats.

    Even legacy safe-integer input can need a larger denominator when evaluating
    its beat grid at an integer microsecond. A conservative exact common-denominator
    bound covers every occurrence endpoint without running pattern extraction.
    """
    if chart["schema_version"] == EXACT_RATIONAL_SCHEMA_VERSION:
        return EXACT_RATIONAL_SCHEMA_VERSION
    for anchor in chart["bpm_segments"]:
        beat = decode_rational(anchor["beat"])
        step = decode_rational(anchor["bpm"]) / 60_000_000
        denominator = lcm(beat.denominator, step.denominator)
        if denominator > MAX_RATIONAL_INTEGER or any(
            abs((beat + (instant - anchor["time_us"]) * step) * denominator) > MAX_RATIONAL_INTEGER
            for instant in (chart["span_start_us"], chart["span_end_us"])
        ):
            return EXACT_RATIONAL_SCHEMA_VERSION
    return chart["schema_version"]


def _weighted_channel(frames: list[dict], key: str) -> float | None:
    if any(frame["channels"][key] is None for frame in frames):
        return None
    duration = sum(frame["end_us"] - frame["start_us"] for frame in frames)
    return (
        quantize(
            sum(frame["channels"][key] * (frame["end_us"] - frame["start_us"]) for frame in frames)
            / duration
        )
        if duration
        else 0
    )


def _metrics(chart: dict, frames: list[dict], onsets: list[dict], start: int, end: int) -> dict:
    complete = is_known(start, end, chart)
    seconds = (end - start) / 1_000_000
    point_only = chart["span_basis"] == "chart_span" and 0 < end - start <= 1
    groups = Counter(event["group_id"] for event in onsets if event["group_id"] is not None)
    return {
        "observed_onset_count": len(onsets),
        "onset_count": len(onsets) if complete else None,
        "duration_us": end - start,
        "onset_rate": quantize(len(onsets) / seconds)
        if complete and seconds and not point_only
        else (0 if complete and not point_only else None),
        "peak_onset_rate": max(
            (frame["rate_1s"] for frame in frames if frame["rate_1s"] is not None), default=None
        )
        if complete
        else None,
        "sustained_onset_rate": max(
            (frame["rate_4s"] for frame in frames if frame["rate_4s"] is not None), default=None
        )
        if complete
        else None,
        "hold_occupancy": _weighted_channel(frames, "hold_occupancy"),
        "slide_movement_occupancy": _weighted_channel(frames, "slide_movement_occupancy"),
        "slide_wait_occupancy": _weighted_channel(frames, "slide_wait_occupancy"),
        "max_concurrency": max(
            (
                frame["channels"]["active_concurrency"]
                for frame in frames
                if frame["channels"]["active_concurrency"] is not None
            ),
            default=None,
        )
        if complete and {"hold_intervals", "slide_movement"} <= set(chart["capabilities"])
        else None,
        "simultaneous_group_count": sum(value > 1 for value in groups.values())
        if "authored_simultaneity" in chart["capabilities"] and complete
        else None,
    }


def _event_relations(chart: dict) -> dict:
    """Linear sweeps after sorting; authored roles remain independent of movement."""
    intervals = {
        "hold": [(hold["start_us"], hold["end_us"]) for hold in chart["holds"]],
        "movement": [
            (slide["movement_start_us"], slide["movement_end_us"]) for slide in chart["slides"]
        ],
        "wait": [(slide["wait_start_us"], slide["wait_end_us"]) for slide in chart["slides"]],
    }
    sweep = {}
    for key, values in intervals.items():
        sweep[key] = (
            sorted(start for start, end in values if end > start),
            sorted(end for start, end in values if end > start),
        )
    groups = Counter(
        event["group_id"] for event in chart["onsets"] if event["group_id"] is not None
    )
    branches = Counter(
        slide["head_id"] for slide in chart["slides"] if slide["head_id"] is not None
    )
    result = {}
    for event in chart["onsets"]:
        time = event["time_us"]
        relation = {
            key: bisect_right(starts, time) - bisect_right(ends, time)
            for key, (starts, ends) in sweep.items()
        }
        relation["group"] = groups.get(event["group_id"], 1)
        relation["branches"] = branches.get(event["event_id"], 0)
        result[event["event_id"]] = relation
    return result


def _descriptor(chart: dict, events: list[dict], metrics: dict, relations: dict) -> dict:
    caps = set(chart["capabilities"])
    complete = metrics["onset_count"] is not None
    count = len(events)
    roles = Counter(event["role"] for event in events)
    gap_beats = [
        decode_rational(right["beat"]) - decode_rational(left["beat"])
        for left, right in zip(events, events[1:], strict=False)
        if left["beat"] is not None and right["beat"] is not None
    ]
    mean_beat = sum(gap_beats) / len(gap_beats) if gap_beats else None
    variation = (
        sqrt(sum(float(gap - mean_beat) ** 2 for gap in gap_beats) / len(gap_beats))
        / float(mean_beat)
        if mean_beat and mean_beat > 0
        else 0
    )
    branches = [
        relations[event["event_id"]]["branches"]
        for event in events
        if relations[event["event_id"]]["branches"]
    ]
    features = {
        "tap_fraction": roles["tap"] / count if count and complete else None,
        "touch_fraction": (roles["touch"] + roles["touch_hold"]) / count
        if count and complete
        else None,
        "hold_fraction": (roles["hold_onset"] + roles["touch_hold"]) / count
        if count and complete
        else None,
        "star_fraction": roles["star_tap"] / count if count and complete else None,
        "simultaneous_fraction": sum(relations[event["event_id"]]["group"] > 1 for event in events)
        / count
        if count and complete and "authored_simultaneity" in caps
        else None,
        "branches_per_head": (sum(branches) / len(branches) if branches else 0)
        if complete and "slide_groups" in caps
        else None,
        "mean_beat_interval": float(mean_beat)
        if mean_beat is not None and complete and "beat_grid" in caps
        else None,
        "beat_interval_variation": variation
        if mean_beat is not None and complete and "beat_grid" in caps
        else None,
        "hold_occupancy": metrics["hold_occupancy"],
        "slide_movement_occupancy": metrics["slide_movement_occupancy"],
        "slide_wait_occupancy": metrics["slide_wait_occupancy"],
    }
    features = {
        key: quantize(value) if value is not None else None for key, value in features.items()
    }
    sequence = None
    # Absent geometry/beat anchors cannot masquerade as tempo-normalized evidence.
    if (
        {
            "timing",
            "positions",
            "beat_grid",
            "authored_simultaneity",
            "hold_intervals",
            "slide_movement",
            "slide_wait",
            "slide_groups",
        }
        <= caps
        and complete
        and events
    ):
        sequence = _canonical_sequence(events, relations)
    ngrams = None
    if sequence:
        width = min(3, len(sequence))
        ngrams = dict(
            sorted(
                Counter(
                    json.dumps(sequence[index : index + width], separators=(",", ":"))
                    for index in range(len(sequence) - width + 1)
                ).items()
            )
        )
    supported = sum(value is not None for value in features.values())
    return {
        "policy_version": "ordered-role-position-beat-0.2",
        "features": features,
        "sequence": sequence[:128] if sequence is not None else None,
        "sequence_truncated": sequence is not None and len(sequence) > 128,
        "sequence_length": len(sequence) if sequence is not None else None,
        "ngrams": ngrams,
        "transforms": ["rotation_of_button_positions"],
        "mirror_invariant": False,
        "coverage": {
            "supported_features": supported,
            "total_features": len(features),
            "fraction": quantize(supported / len(features)),
            "sequence": "supported" if sequence is not None else "unknown",
        },
    }


def _canonical_sequence(events: list[dict], relations: dict) -> list[str]:
    """Semantic ties, never ID order; eight rotations of chords, no reflections.

    Authored groups carry a stable group-shape fingerprint. Equal-time independent
    events stay explicitly independent. The global rotation search handles symmetric
    chords without inventing a unique geometric origin or a physical hand assignment.
    """
    batches = [list(batch) for _, batch in groupby(events, key=lambda event: event["time_us"])]
    groups: dict[str, list[dict]] = {}
    for event in events:
        if event["group_id"] is not None:
            groups.setdefault(event["group_id"], []).append(event)
    best = None
    rotations = range(8) if any(len(batch) > 1 for batch in batches) else range(1)
    for rotation in rotations:

        def position_key(position, rotation=rotation):
            return (
                str((position - 1 + rotation) % 8 + 1)
                if type(position) is int
                else f"zone:{position}"
            )

        signatures = {
            group_id: content_hash(
                sorted((event["role"], position_key(event["position"])) for event in group)
            )[:16]
            for group_id, group in groups.items()
            if len(group) > 1
        }
        ordered = []
        for batch in batches:
            ordered.extend(
                sorted(
                    batch,
                    key=lambda event: (
                        event["role"],
                        position_key(event["position"]),
                        signatures.get(event["group_id"], "independent"),
                        tuple(relations[event["event_id"]].values()),
                    ),
                )
            )
        sequence, previous = [], None
        for event in ordered:
            position, last_position = event["position"], previous["position"] if previous else None
            if previous is None:
                step = "origin"
            elif type(position) is int and type(last_position) is int:
                delta = (position - last_position) % 8
                step = str(delta if delta <= 4 else delta - 8)
            else:
                step = f"{last_position}>{position}"
            gap = (
                decode_rational(event["beat"]) - decode_rational(previous["beat"])
                if previous
                else Fraction(0)
            )
            relation = relations[event["event_id"]]
            sequence.append(
                "|".join(
                    [
                        event["role"],
                        step,
                        str(gap),
                        str(relation["group"]),
                        str(relation["hold"]),
                        str(relation["movement"]),
                        str(relation["wait"]),
                        str(relation["branches"]),
                        signatures.get(event["group_id"], "independent"),
                    ]
                )
            )
            previous = event
        if best is None or sequence < best:
            best = sequence
    return best or []


def _prepare_analysis(chart: dict, config: dict | None = None) -> tuple[dict, dict, dict, dict]:
    normalized = normalize_chart(chart)
    policy = validated_config(config)
    registry = pattern_registry()
    normalized_hash = content_hash(normalized)
    source_hash = normalized["source"].get("byte_hash", normalized_hash)
    config_hash = content_hash(policy)
    registry_hash = content_hash(registry)
    profile_schema = _profile_schema(normalized)
    cache_key = content_hash(
        {
            "source_hash": source_hash,
            "normalized_hash": normalized_hash,
            "parser": normalized["source"]["parser_version"],
            "normalizer": normalized["source"]["normalizer_version"],
            "analyzer": ANALYZER_VERSION,
            "registry": REGISTRY_VERSION,
            "registry_hash": registry_hash,
            "config_hash": config_hash,
            "geometry": normalized["geometry_version"],
            "reference_scale_id": policy["reference_scale_id"],
            **(
                {"profile_schema_version": profile_schema}
                if profile_schema != normalized["schema_version"]
                else {}
            ),
        }
    )
    identity = {
        "schema_version": profile_schema,
        "analyzer_version": ANALYZER_VERSION,
        "registry_version": REGISTRY_VERSION,
        "registry_hash": registry_hash,
        "source_hash": source_hash,
        "normalized_hash": normalized_hash,
        "config_hash": config_hash,
        "cache_key": cache_key,
        "profile_id": f"profile:{cache_key}",
        "reference_scale_id": policy["reference_scale_id"],
        **{
            key: normalized[key]
            for key in ("chart_id", "song_id", "format", "difficulty", "revision")
        },
    }
    return normalized, policy, registry, identity


def analysis_fingerprint(chart: dict, config: dict | None = None) -> dict:
    """Validate/normalize and hash inputs without running feature extraction or detectors."""
    return _prepare_analysis(chart, config)[3]


def analyze_overview(chart: dict, config: dict | None = None) -> dict:
    """Build Flow and experimental tags without section or similarity descriptors."""
    normalized, policy, registry, identity = _prepare_analysis(chart, config)
    flow = build_flow(normalized, policy)
    metrics = _metrics(
        normalized,
        flow["frames"],
        normalized["onsets"],
        normalized["span_start_us"],
        normalized["span_end_us"],
    )
    _, tags = detect_patterns(normalized, flow, metrics, registry)
    return {**identity, "flow": flow, "tags": tags}


def analyze(chart: dict, config: dict | None = None) -> dict:
    """Analyze explicit normalized events into one deterministic nonpersonal profile."""
    normalized, policy, registry, identity = _prepare_analysis(chart, config)
    flow = build_flow(normalized, policy)
    start, end = normalized["span_start_us"], normalized["span_end_us"]
    metrics = _metrics(normalized, flow["frames"], normalized["onsets"], start, end)
    occurrences, tags = detect_patterns(normalized, flow, metrics, registry)
    anchor_times = [segment["time_us"] for segment in normalized["bpm_segments"]]
    for occurrence in occurrences:
        occurrence["profile_id"] = identity["profile_id"]
        for key in ("start", "end"):
            instant = occurrence[f"{key}_us"]
            anchor_index = bisect_right(anchor_times, instant) - 1
            beat = None
            if anchor_index >= 0 and "beat_grid" in normalized["capabilities"]:
                anchor = normalized["bpm_segments"][anchor_index]
                beat = decode_rational(anchor["beat"]) + Fraction(
                    instant - anchor["time_us"], 60_000_000
                ) * decode_rational(anchor["bpm"])
            occurrence[f"{key}_beat"] = encode_rational(beat) if beat is not None else None
    relations = _event_relations(normalized)
    descriptor = _descriptor(normalized, normalized["onsets"], metrics, relations)
    times = [event["time_us"] for event in normalized["onsets"]]
    sections = []
    for index, left in enumerate(range(start, end, policy["section_us"])):
        right = min(end, left + policy["section_us"])
        events = normalized["onsets"][bisect_left(times, left) : bisect_left(times, right)]
        first_frame = (left - start) // policy["frame_us"]
        last_frame = (right - start + policy["frame_us"] - 1) // policy["frame_us"]
        section_metrics = _metrics(
            normalized, flow["frames"][first_frame:last_frame], events, left, right
        )
        sections.append(
            {
                "section_id": f"{normalized['chart_id']}:section:{index}",
                "start_us": left,
                "end_us": right,
                "metrics": section_metrics,
                "descriptor": _descriptor(normalized, events, section_metrics, relations),
                "pattern_ids": sorted(
                    {
                        item["pattern_id"]
                        for item in occurrences
                        if item["start_us"] < right and item["end_us"] > left
                    }
                ),
            }
        )
    core_caps = {
        "timing",
        "positions",
        "beat_grid",
        "authored_simultaneity",
        "hold_intervals",
        "slide_movement",
        "slide_wait",
        "slide_groups",
    }
    analysis_status = (
        "complete"
        if (
            core_caps <= set(normalized["capabilities"])
            and is_known(start, end, normalized)
            and normalized["source"]["identity_status"] in {"exact", "reviewed"}
            and normalized["source"]["kind"] != "public_transcription_evaluation"
        )
        else "partial"
    )
    coverage = {
        capability: "supported" if capability in normalized["capabilities"] else "unknown"
        for capability in sorted(core_caps)
    }
    coverage.update(
        {
            "analysis": analysis_status,
            "source": "available",
            "identity": normalized["source"]["identity_status"],
            "parsing": "complete" if analysis_status == "complete" else "partial",
            "reviewed_named_patterns": 0,
            "experimental_detectors": len(
                [entry for entry in registry["entries"] if entry["automatic_tagging_enabled"]]
            ),
        }
    )
    return {
        **identity,
        "source": normalized["source"],
        "coverage": coverage,
        "metrics": metrics,
        "time_basis": {
            "origin_shift_us": normalized["origin_shift_us"],
            "source_offset_us": normalized["source_offset_us"],
            "audio_offset_us": normalized["audio_offset_us"],
            "labels": "chart time",
        },
        "diagnostics": normalized["diagnostics"],
        "occurrences": occurrences,
        "tags": tags,
        "flow": flow,
        "sections": sections,
        "descriptor": descriptor,
        "limitations": [
            "Experimental project definitions; synthetic tests only.",
            "No inferred hand assignment, personal mistakes or validated training outcomes.",
        ]
        + (
            [
                "Public transcription evaluation only: measurements describe the supplied "
                "transcription, not verified game-chart fidelity or redistribution permission."
            ]
            if normalized["source"]["kind"] == "public_transcription_evaluation"
            else []
        ),
    }
