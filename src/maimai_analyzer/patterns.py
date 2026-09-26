"""Explicit versioned experimental rules; independent qualification is separate."""

from __future__ import annotations

import json
from bisect import bisect_left
from collections import defaultdict
from importlib.resources import files

from .chart_input import content_hash
from .flow import is_known, quantize
from .pattern_community import CATALOG as COMMUNITY_CATALOG
from .pattern_community import DEFINITIONS as COMMUNITY_DEFINITIONS
from .pattern_community import detect_community, registry_entries
from .pattern_community import supported as community_supported
from .pattern_compounds import DEFINITIONS as COMPOUND_DEFINITIONS
from .pattern_compounds import detect_compounds
from .pattern_intervals import DEFINITIONS as INTERVAL_DEFINITIONS
from .pattern_intervals import detect_intervals
from .pattern_names import english_aliases
from .pattern_sequences import DEFINITIONS as SEQUENCE_DEFINITIONS
from .pattern_sequences import detect_sequences
from .pattern_traits import DEFINITIONS as TRAIT_DEFINITIONS
from .pattern_traits import detect_traits
from .rational import decode_rational

REGISTRY_VERSION = "0.3.0-synthetic-experimental"
DETECTOR_VERSION = "0.3.0"
MAX_OCCURRENCES = 4096
IMPLEMENTED = {
    "pattern.two_position_alternation": (
        ["timing", "positions", "beat_grid"],
        "At least six monophonic A/B onsets, distinct buttons, exactly equal rational beat gaps "
        "no greater than one beat and no greater than one second. Split at simultaneous onsets.",
    ),
    "pattern.same_position_repetition": (
        ["timing", "positions"],
        "At least three consecutive monophonic button onsets at one position, each positive "
        "gap at most one second. A sustained hold is a single onset.",
    ),
    "pattern.simultaneous_group": (
        ["timing", "authored_simultaneity"],
        "Two or more distinct input onsets with one explicit authored simultaneous-group ID. "
        "Equal timestamps alone are insufficient.",
    ),
    "pattern.same_head_slide_fan": (
        ["timing", "slide_groups", "slide_movement"],
        "At least two path IDs sharing one existing star-tap head; count that input once.",
    ),
    "pattern.moving_slide_overlap": (
        ["timing", "slide_movement"],
        "Maximal connected intervals with at least two active half-open slide movements; "
        "touching endpoints do not overlap.",
    ),
    "pattern.slide_tap_interleave": (
        ["timing", "slide_movement"],
        "At least one independent tap/star input inside a half-open slide movement. "
        "Generic interaction only; this is not an Umiyuri recognizer.",
    ),
    "pattern.delayed_slide_interleave": (
        ["timing", "slide_wait"],
        "At least one independent tap/star input inside a half-open slide wait, excluding "
        "its own shared head and the wait-end boundary.",
    ),
    "pattern.connected_slide_chain": (
        ["timing", "slide_groups", "slide_movement"],
        "One normalized path with at least two explicitly ordered connected segment IDs. "
        "Segments never create additional physical input onsets.",
    ),
    "pattern.hold_tap_interleave": (
        ["timing", "hold_intervals"],
        "At least one independent tap/star input during a half-open held interval.",
    ),
    "trait.backloaded_density": (
        ["timing", "span"],
        "Fully covered chart has at least eight onsets; final-third onset rate is at least "
        "1.5 times first-third and at least two onsets/second greater. Not a hard-ending claim.",
    ),
    "trait.frontloaded_density": (
        ["timing", "span"],
        "Fully covered chart has at least eight onsets; first-third onset rate is at least "
        "1.5 times final-third and at least two onsets/second greater.",
    ),
    "trait.bursty_density": (
        ["timing", "span"],
        "Fully covered chart spans at least four seconds and has at least eight onsets; "
        "250 ms peak density is at least twice the chart mean and exceeds it by four onsets/s.",
    ),
    "trait.steady_density": (
        ["timing", "span"],
        "Fully covered chart spans at least four seconds and has at least eight onsets; "
        "24 segment density coefficient of variation is at most 0.2, with positive mean.",
    ),
    "trait.slide_occupancy": (
        ["timing", "slide_movement", "span"],
        "At least one moving path occupies at least half of the fully covered chart span; "
        "overlapping paths do not double the occupied duration.",
    ),
}
LEGACY_INPUT_PATTERNS = frozenset(p for p in IMPLEMENTED if p.startswith("pattern."))
IMPLEMENTED.update(SEQUENCE_DEFINITIONS)
IMPLEMENTED.update(INTERVAL_DEFINITIONS)
IMPLEMENTED.update(TRAIT_DEFINITIONS)
IMPLEMENTED.update(COMPOUND_DEFINITIONS)
IMPLEMENTED.update(COMMUNITY_DEFINITIONS)
# A fully observed transcription has a measurable event span even when audio
# duration is unavailable. Preserve that basis explicitly, never invent silence.
for _pattern_id in (
    "trait.backloaded_density",
    "trait.frontloaded_density",
    "trait.bursty_density",
    "trait.steady_density",
    "trait.slide_occupancy",
):
    _required, _grammar = IMPLEMENTED[_pattern_id]
    IMPLEMENTED[_pattern_id] = (
        [cap for cap in _required if cap != "span"],
        _grammar + " Measured over the observed chart span; "
        "unknown leading/trailing audio silence is excluded.",
    )


def pattern_registry() -> dict:
    seed = json.loads(
        files("maimai_analyzer").joinpath("pattern_registry.seed.json").read_text("utf-8")
    )
    entries = []
    for original in [*seed["entries"], *registry_entries()]:
        community = original["id"] in COMMUNITY_DEFINITIONS
        named = original["id"] in COMPOUND_DEFINITIONS or (
            community and COMMUNITY_CATALOG[original["id"].removeprefix("pattern.")][2]
        )
        entry = {
            **original,
            "aliases": english_aliases(original),
            "pattern_id": original["id"],
            "definition_version": "0.3.0"
            if community
            else "0.1.0"
            if original["id"] in LEGACY_INPUT_PATTERNS
            else "0.2.0",
            "definition_sources": original["source_ids"],
            "reference_sections": [],
            "detector_evaluation": {
                "corpus": "none",
                "real_chart_positives": 0,
                "real_chart_negatives": 0,
            },
            "reviewer": None,
            "allowed_transforms": [],
            "tolerances": {},
            "migration_aliases": [],
        }
        if original["id"] in IMPLEMENTED:
            required, grammar = IMPLEMENTED[original["id"]]
            entry.update(
                {
                    "name_origin": original["name_origin"] if named else "project_defined",
                    "definition_status": "operational_experimental",
                    "recognition_scope": "scoped_community_form" if named else "operational_rule",
                    "detector_status": "experimental",
                    "automatic_tagging_enabled": True,
                    "required_capabilities": required,
                    "grammar": grammar,
                    "definition": grammar,
                    "detector_version": DETECTOR_VERSION,
                    "detector_evaluation": {
                        "corpus": "authored synthetic fixtures only",
                        "real_chart_positives": 0,
                        "real_chart_negatives": 0,
                    },
                    "allowed_transforms": ["rotation"] if "position" in original["id"] else [],
                }
            )
        entries.append(entry)
    return {
        "schema_version": "1.0.0",
        "registry_version": REGISTRY_VERSION,
        "status": "experimental_primitives_with_disabled_design_seed",
        "scope": (
            "Synthetic-tested project definitions. No validated community motif or training claim."
        ),
        "entries": entries,
    }


def _run_matches(chart: dict, alternate: bool) -> list[tuple]:
    events = chart["onsets"]
    counts: dict[int, int] = defaultdict(int)
    for event in events:
        counts[event["time_us"]] += 1
    runs, current = [], []
    minimum = 6 if alternate else 3
    for event in events:
        eligible = (
            type(event["position"]) is int
            and counts[event["time_us"]] == 1
            and event["role"] in {"tap", "star_tap"}
        )
        compatible = eligible
        if current and eligible:
            gap = event["time_us"] - current[-1]["time_us"]
            compatible = 0 < gap <= 1_000_000
            if alternate:
                beat_gap = decode_rational(event["beat"]) - decode_rational(current[-1]["beat"])
                compatible &= 0 < beat_gap <= 1
                compatible &= event["position"] != current[-1]["position"]
                if len(current) >= 2:
                    compatible &= event["position"] == current[-2]["position"]
                    compatible &= beat_gap == decode_rational(
                        current[-1]["beat"]
                    ) - decode_rational(current[-2]["beat"])
            else:
                compatible &= event["position"] == current[-1]["position"]
        if not compatible:
            if len(current) >= minimum:
                runs.append(current)
            # Preserve a potential new alternation beginning with the preceding onset.
            previous = current[-1:] if alternate and eligible and current else []
            current = previous if previous and previous[0]["position"] != event["position"] else []
        if eligible:
            current.append(event)
        else:
            current = []
    if len(current) >= minimum:
        runs.append(current)
    return [
        (
            run[0]["time_us"],
            run[-1]["time_us"] + 1,
            [event["event_id"] for event in run],
            [],
            {"onset_count": len(run)},
        )
        for run in runs
    ]


def _interactions(chart: dict, mode: str) -> list[tuple]:
    taps = [event for event in chart["onsets"] if event["role"] in {"tap", "star_tap"}]
    times = [event["time_us"] for event in taps]
    tap_times = {event["event_id"]: event["time_us"] for event in taps}
    matches = []
    paths = chart["holds"] if mode == "hold" else chart["slides"]
    for path in paths:
        if mode == "hold":
            start, end, head, path_id = (
                path["start_us"],
                path["end_us"],
                path["onset_id"],
                path["hold_id"],
            )
        else:
            start, end = path[f"{mode}_start_us"], path[f"{mode}_end_us"]
            head, path_id = path["head_id"], path["path_id"]
        left, right = bisect_left(times, start), bisect_left(times, end)
        found = [
            event["event_id"]
            for event in taps[left : min(right, left + 65)]
            if event["event_id"] != head
        ]
        if found:
            ids = ([head] if head else []) + found[:64]
            matches.append(
                (
                    start,
                    end,
                    ids,
                    [path_id],
                    {
                        "independent_onset_count": right
                        - left
                        - int(head in tap_times and start <= tap_times[head] < end),
                        "event_evidence_truncated": right - left > 64,
                    },
                )
            )
        if len(matches) >= MAX_OCCURRENCES:
            break
    return matches


def _moving_overlap(chart: dict) -> list[tuple]:
    changes: dict[int, list[tuple[str, int]]] = defaultdict(list)
    for path in chart["slides"]:
        if path["movement_start_us"] < path["movement_end_us"]:
            changes[path["movement_start_us"]].append((path["path_id"], 1))
            changes[path["movement_end_us"]].append((path["path_id"], -1))
    active: set[str] = set()
    matches, start, evidence, peak = [], None, set(), 0
    for time in sorted(changes):
        for path_id, change in sorted(changes[time], key=lambda item: item[1]):
            if change < 0:
                active.discard(path_id)
            else:
                active.add(path_id)
        if len(active) >= 2:
            if start is None:
                start = time
            # Keep bounded deterministic supporting paths while tracking exact concurrency.
            if len(evidence) < 64:
                evidence.update(sorted(active)[: 64 - len(evidence)])
            peak = max(peak, len(active))
        elif start is not None:
            matches.append((start, time, [], sorted(evidence)[:64], {"peak_concurrency": peak}))
            start, evidence, peak = None, set(), 0
    return matches


def _union_duration(intervals: list[tuple[int, int]]) -> int:
    total, previous_end = 0, -1
    for start, end in sorted(intervals):
        total += max(0, end - max(start, previous_end))
        previous_end = max(previous_end, end)
    return total


def detect_patterns(chart: dict, flow: dict, metrics: dict, registry: dict) -> tuple[list, list]:
    caps = set(chart["capabilities"])
    found: dict[str, list] = defaultdict(list)
    if {"timing", "positions", "beat_grid"} <= caps:
        found["pattern.two_position_alternation"] = _run_matches(chart, True)
    if {"timing", "positions"} <= caps:
        found["pattern.same_position_repetition"] = _run_matches(chart, False)
    groups: dict[str, list] = defaultdict(list)
    heads: dict[str, list] = defaultdict(list)
    for event in chart["onsets"]:
        if event["group_id"] is not None:
            groups[event["group_id"]].append(event)
    for group in groups.values():
        if len(group) > 1:
            found["pattern.simultaneous_group"].append(
                (
                    group[0]["time_us"],
                    group[0]["time_us"] + 1,
                    [event["event_id"] for event in group],
                    [],
                    {"input_count": len(group)},
                )
            )
    for slide in chart["slides"]:
        if slide["head_id"] is not None:
            heads[slide["head_id"]].append(slide)
        if len(slide["segment_ids"]) >= 2:
            found["pattern.connected_slide_chain"].append(
                (
                    slide["movement_start_us"],
                    slide["movement_end_us"],
                    [slide["head_id"]] if slide["head_id"] else [],
                    [slide["path_id"]],
                    {"segment_count": len(slide["segment_ids"])},
                )
            )
    for head, paths in heads.items():
        if len(paths) >= 2:
            found["pattern.same_head_slide_fan"].append(
                (
                    min(path["wait_start_us"] for path in paths),
                    max(path["movement_end_us"] for path in paths),
                    [head],
                    [path["path_id"] for path in paths],
                    {"branch_count": len(paths)},
                )
            )
    found["pattern.slide_tap_interleave"] = _interactions(chart, "movement")
    found["pattern.delayed_slide_interleave"] = _interactions(chart, "wait")
    found["pattern.hold_tap_interleave"] = _interactions(chart, "hold")
    found["pattern.moving_slide_overlap"] = _moving_overlap(chart)
    found.update(detect_sequences(chart))
    found.update(detect_intervals(chart))
    found.update(detect_compounds(chart))
    found.update(detect_community(chart))
    eligible = {
        definition["pattern_id"]
        for definition in registry["entries"]
        if definition["automatic_tagging_enabled"]
        and set(definition["required_capabilities"]) <= caps
        and community_supported(chart, definition["pattern_id"])
    }
    found.update(detect_traits(chart, found, eligible))
    start, end = chart["span_start_us"], chart["span_end_us"]
    duration = end - start
    if duration and is_known(start, end, chart):
        times = [event["time_us"] for event in chart["onsets"]]
        third = duration / 3
        front = bisect_left(times, start + third) * 1_000_000 / third
        back = (len(times) - bisect_left(times, end - third)) * 1_000_000 / third
        trait_ids = []
        if len(times) >= 8:
            if back >= front * 1.5 and back - front >= 2:
                trait_ids.append("trait.backloaded_density")
            if front >= back * 1.5 and front - back >= 2:
                trait_ids.append("trait.frontloaded_density")
            summary = flow["density_summary"]
            if duration >= 4_000_000 and summary["peak"] is not None:
                if (
                    summary["peak"] >= 2 * summary["mean"]
                    and summary["peak"] - summary["mean"] >= 4
                ):
                    trait_ids.append("trait.bursty_density")
                if summary["mean"] > 0 and summary["variation"] <= 0.2:
                    trait_ids.append("trait.steady_density")
        if (metrics.get("slide_movement_occupancy") or 0) >= 0.5:
            trait_ids.append("trait.slide_occupancy")
        for pattern_id in trait_ids:
            found[pattern_id].append(
                (
                    start,
                    end,
                    [event["event_id"] for event in chart["onsets"][:64]],
                    [],
                    {
                        "first_third_onset_rate": quantize(front),
                        "last_third_onset_rate": quantize(back),
                        "span_basis": chart["span_basis"],
                        "event_evidence_truncated": len(times) > 64,
                    },
                )
            )
    occurrences, tags = [], []
    for definition in registry["entries"]:
        pattern_id = definition["pattern_id"]
        supported = (
            definition["automatic_tagging_enabled"]
            and set(definition["required_capabilities"]) <= caps
            and chart["source"]["identity_status"] in {"exact", "reviewed"}
            and community_supported(chart, pattern_id)
            and (
                pattern_id != "pattern.variable_slide_wait"
                or (
                    bool(chart["bpm_segments"])
                    and all(
                        s["wait_start_us"] >= chart["bpm_segments"][0]["time_us"]
                        for s in chart["slides"]
                    )
                )
            )
            and (
                pattern_id != "trait.repeated_motif"
                or not (chart["holds"] or chart["slides"])
                or (
                    bool(chart["bpm_segments"])
                    and all(
                        s["path"] and s["wait_start_us"] >= chart["bpm_segments"][0]["time_us"]
                        for s in chart["slides"]
                    )
                    and all(
                        h["start_us"] >= chart["bpm_segments"][0]["time_us"] for h in chart["holds"]
                    )
                )
            )
        )
        matches = found.get(pattern_id, []) if supported else []
        own = []
        # One maximal run or one interval relation, never a sliding-window occurrence explosion.
        seen = set()
        for left, right, event_ids, path_ids, measurements in matches[:MAX_OCCURRENCES]:
            if not is_known(left, right, chart):
                continue
            context = measurements.get("context_span_us")
            if context and not is_known(*context, chart):
                continue
            identity = [
                chart["chart_id"],
                pattern_id,
                left,
                right,
                sorted(event_ids),
                sorted(path_ids),
            ]
            if "target_pattern_id" in measurements:
                identity.append(measurements["target_pattern_id"])
            key = content_hash(identity)
            if key in seen:
                continue
            seen.add(key)
            own.append(
                {
                    "occurrence_id": f"occ:{key[:24]}",
                    "chart_id": chart["chart_id"],
                    "pattern_id": pattern_id,
                    "definition_version": definition["definition_version"],
                    "detector_version": DETECTOR_VERSION,
                    "start_us": left,
                    "end_us": right,
                    "event_ids": sorted(set(event_ids))[:64],
                    "path_ids": sorted(set(path_ids))[:64],
                    "measurements": measurements,
                    "transform": "original",
                    "evidence": {
                        "source_kind": chart["source"]["kind"],
                        "identity": chart["source"]["identity_status"],
                        "timing": "supported_section",
                        "definition": "project_experimental",
                        "detector": "synthetic_tested_experimental",
                    },
                }
            )
        own.sort(key=lambda item: (item["start_us"], item["end_us"], item["occurrence_id"]))
        truncated = len(matches) >= MAX_OCCURRENCES
        full_coverage = supported and is_known(start, end, chart) and not truncated
        status = (
            "detected"
            if own
            else "not-detected-with-supported-coverage"
            if full_coverage
            else "unknown"
        )
        union = _union_duration([(item["start_us"], item["end_us"]) for item in own])
        sections = [
            {
                "occurrence_id": item["occurrence_id"],
                "start_us": item["start_us"],
                "end_us": item["end_us"],
            }
            for item in own[:4]
        ]
        rates = [
            (item["measurements"]["onset_count"] - 1)
            * 1_000_000
            / (item["end_us"] - item["start_us"] - 1)
            for item in own
            if item["measurements"].get("onset_count", 0) >= 2
            and item["end_us"] - item["start_us"] > 1
        ]
        tags.append(
            {
                "pattern_id": pattern_id,
                "status": status,
                "occurrence_count": len(own) if status != "unknown" else None,
                "union_duration_us": union if status != "unknown" else None,
                "prevalence": quantize(union / duration)
                if duration and status != "unknown"
                else None,
                "longest_run_us": max(
                    (item["end_us"] - item["start_us"] for item in own), default=0
                )
                if status != "unknown"
                else None,
                "speed_range": [quantize(min(rates)), quantize(max(rates))] if rates else None,
                "speed_unit": "supporting input intervals/second",
                "representative_sections": sections,
                "coverage": "complete" if full_coverage else "partial",
                "occurrences_truncated": truncated,
                "review_status": definition["detector_status"],
            }
        )
        occurrences.extend(own)
    occurrences.sort(key=lambda item: (item["start_us"], item["pattern_id"], item["occurrence_id"]))
    return occurrences, tags
