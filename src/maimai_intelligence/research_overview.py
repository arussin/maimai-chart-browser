"""Compact public research Flow and pattern observations, joined by exact identity."""

from maimai_analyzer.contracts import content_hash
from maimai_analyzer.core import analyze_overview
from maimai_analyzer.patterns import IMPLEMENTED

VERSION = "research-overview-1"
PATTERNS = sorted(IMPLEMENTED)


def chart_overview(chart):
    result = analyze_overview(chart)
    flow = result["flow"]
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
            ]
            for t in result["tags"]
            if t["pattern_id"] in PATTERNS
        ],
    }


def overview_package(charts):
    return {
        "version": VERSION,
        "patterns": PATTERNS,
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
        ],
        "charts": charts,
        "qualification": (
            "Experimental detectors; authored synthetic tests only. "
            "No reviewed named-family labels."
        ),
    }


def validate_overview(value, catalog):
    if value.get("version") != VERSION or value.get("patterns") != PATTERNS:
        raise ValueError("Incompatible research overview")
    by_id = {c["chart_id"]: c for c in catalog}
    for chart_id, record in value["charts"].items():
        if chart_id not in by_id or record["source_hash"] != by_id[chart_id]["source_hash"]:
            raise ValueError("Research overview chart identity mismatch")
    return value
