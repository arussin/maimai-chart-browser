"""Compact public research Flow and pattern observations, joined by exact identity."""

from typing import Any

from maimai_analyzer.contracts import content_hash
from maimai_analyzer.core import analyze_overview
from maimai_analyzer.patterns import (
    DETECTOR_VERSION,
    IMPLEMENTED,
    REGISTRY_VERSION,
    pattern_registry,
)

VERSION = "research-overview-2"
PATTERNS = sorted(IMPLEMENTED)
LEGACY_PATTERNS = sorted(
    [
        "pattern.two_position_alternation",
        "pattern.same_position_repetition",
        "pattern.simultaneous_group",
        "pattern.same_head_slide_fan",
        "pattern.moving_slide_overlap",
        "pattern.slide_tap_interleave",
        "pattern.delayed_slide_interleave",
        "pattern.connected_slide_chain",
        "pattern.hold_tap_interleave",
        "trait.backloaded_density",
        "trait.frontloaded_density",
        "trait.bursty_density",
        "trait.steady_density",
        "trait.slide_occupancy",
    ]
)


def chart_overview(chart):
    result = analyze_overview(chart)
    flow = result["flow"]
    evidence = {
        o["occurrence_id"]: {
            key: value
            for key, value in o["measurements"].items()
            if key in {"target_pattern_id", "form", "repeat_count", "motif_id", "span_basis"}
        }
        for o in result["occurrences"]
    }
    return {
        "source_hash": chart["source"].get("byte_hash") or content_hash(chart),
        "span": [flow["span_start_us"], flow["span_end_us"]],
        "basis": flow["basis"],
        "segments": [
            [s["start_us"], s["end_us"]]
            + [
                s[m][k]
                for m in ("density", "estimated_demand")
                for k in ("mean", "peak", "coverage")
            ]
            for s in flow["segments"]
        ],
        "tags": [
            [
                PATTERNS.index(t["pattern_id"]),
                t["status"],
                t["occurrence_count"],
                t["prevalence"],
                t["coverage"],
                t["occurrences_truncated"],
                [[s["start_us"], s["end_us"]] for s in t["representative_sections"]],
                [evidence[s["occurrence_id"]] for s in t["representative_sections"]],
            ]
            for t in result["tags"]
            if t["pattern_id"] in PATTERNS
        ],
    }


def overview_package(charts):
    return {
        "version": VERSION,
        "patterns": PATTERNS,
        "detector_version": DETECTOR_VERSION,
        "registry_version": REGISTRY_VERSION,
        "definitions": {
            entry["pattern_id"]: {
                key: entry[key]
                for key in (
                    "definition",
                    "definition_version",
                    "required_capabilities",
                    "name_origin",
                )
            }
            for entry in pattern_registry()["entries"]
        },
        "segment_fields": [
            "start_us",
            "end_us",
            "density_mean",
            "density_peak",
            "density_coverage",
            "demand_mean",
            "demand_peak",
            "demand_coverage",
        ],
        "tag_fields": [
            "pattern_index",
            "status",
            "occurrence_count",
            "prevalence",
            "coverage",
            "occurrences_truncated",
            "representative_spans_us",
            "representative_evidence",
        ],
        "charts": charts,
        "qualification": (
            "Experimental detectors; authored synthetic tests only. "
            "No reviewed named-family labels."
        ),
    }


def validate_overview(value: dict[str, Any], catalog: list[dict[str, Any]]) -> dict[str, Any]:
    expected = {"research-overview-1": LEGACY_PATTERNS, VERSION: PATTERNS}.get(value.get("version"))
    if expected is None or value.get("patterns") != expected:
        raise ValueError("Incompatible research overview")
    by_id = {c["chart_id"]: c for c in catalog}
    for chart_id, record in value["charts"].items():
        if chart_id not in by_id or record["source_hash"] != by_id[chart_id]["source_hash"]:
            raise ValueError("Research overview chart identity mismatch")
    return value
