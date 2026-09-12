"""Authored fictional browser data, not detector evaluation or real chart evidence."""

from copy import deepcopy


def catalog_fixture(count=4):
    pattern = {
        "pattern_id": "synthetic.alternation",
        "display_name": "Synthetic alternation",
        "kind": "motif",
        "naming_origin": "project_defined",
        "definition_status": "synthetic_test_fixture",
        "detector_status": "illustrative_only",
        "description": "Authored UI fixture; no real chart or training claim.",
        "aliases": ["Synthetic A/B"],
        "limitations": ["UI fixture only."],
        "source_ids": [],
    }
    chart = {
        "chart_id": "synthetic:study:STD:EXPERT:r1",
        "song_id": "synthetic:study",
        "title": "Fictional Study",
        "artist": "Synthetic Artist",
        "format": "STD",
        "difficulty": "Expert",
        "revision": "r1",
        "level": "9",
        "constant": 9.2,
        "release": "Fictional Release",
        "region": "test",
        "availability": "unknown",
        "analysis_status": "complete",
        "source_id": "authored-synthetic",
        "source_revision": "r1",
        "identity_status": "exact",
        "parse_status": "complete",
        "metrics": {"onset_rate": 4.0, "max_concurrency": 1},
        "descriptor": {
            "ngrams": {'["tap","tap","tap"]': 4},
            "features": {"tap_fraction": 1.0},
            "coverage": 1.0,
            "policy_version": "ordered-structure-v1",
        },
        "tags": [
            {
                "pattern_id": pattern["pattern_id"],
                "status": "detected",
                "occurrence_count": 1,
                "prevalence": 0.25,
            }
        ],
        "occurrences": [
            {
                "occurrence_id": "synthetic:occurrence:1",
                "pattern_id": pattern["pattern_id"],
                "start_us": 0,
                "end_us": 4_000_000,
            }
        ],
        "sections": [
            {
                "section_id": "synthetic:section:1",
                "start_us": 0,
                "end_us": 4_000_000,
                "pattern_ids": [pattern["pattern_id"]],
            }
        ],
        "flow": {
            "span_start_us": 0,
            "span_end_us": 24_000_000,
            "basis": "chart span",
            "scales": {
                "density": {
                    "id": "synthetic-density-v1",
                    "bands": [2, 4, 6, 8],
                    "unit": "onsets/second",
                }
            },
            "segments": [
                {
                    "start_us": index * 1_000_000,
                    "end_us": (index + 1) * 1_000_000,
                    "coverage": 0.0 if index == 23 else 1.0,
                    "density": {
                        "mean": None if index == 23 else float(index % 8),
                        "peak": None if index == 23 else float(index % 8) + 4,
                    },
                    "estimated_demand": {"mean": None, "peak": None},
                    "contributors": [],
                }
                for index in range(24)
            ],
        },
    }
    charts = []
    for index in range(count):
        item = deepcopy(chart)
        item["chart_id"] = f"synthetic:study:{index:03d}"
        if index == 1:
            item["difficulty"] = "Advanced"
            item["tags"][0]["status"] = "not-detected-with-supported-coverage"
            item["tags"][0]["occurrence_count"] = 0
            item["tags"][0]["prevalence"] = 0.0
            item["occurrences"] = []
        elif index == 2:
            item["format"] = "DX"
            item["tags"] = []
            item["flow"] = {}
            item["analysis_status"] = "unavailable"
            item.pop("descriptor")
            item.pop("metrics")
            item["occurrences"] = []
            item["sections"] = []
        elif index >= 3:
            item["title"] = f"Synthetic Pagination {index:03d}"
            item["song_id"] = f"synthetic:page:{index}"
        charts.append(item)
    return {
        "schema_version": "1.0.0",
        "catalog_id": "synthetic-ui-fixture",
        "charts": charts,
        "patterns": [pattern],
        "coverage": {
            "summary": "Authored UI fixtures only; no real chart coverage.",
            "reviewed_named_patterns": 0,
        },
    }


def overlay_fixture():
    return {
        "entries": [
            {
                "chart_id": "synthetic:study:000",
                "percent": 93.2,
                "rate": 100,
                "grade": "AA",
                "lamp": "CLEAR",
                "attempt_count": 1,
                "last_played": 1_000_000,
            }
        ],
        "coverage": {"history_complete": False, "scope": "fictional retained interval"},
    }
