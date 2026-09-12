"""Lossless sparse storage for the v2 research tag matrix.

Detected rows retain all evidence. Complete supported absences use index lists;
all other unlisted patterns are unknown. This never infers absence from omission.
"""

import json
from copy import deepcopy

REPRESENTATION = "sparse-tags-3"


def compact_overview(value):
    if value.get("version") != "research-overview-2":
        raise ValueError("Sparse tags require research overview v2")
    if value.get("representation") == REPRESENTATION:
        return value
    result = {
        **value,
        "representation": REPRESENTATION,
        "charts": {},
        "tag_fields": [
            "pattern_index",
            "state_bits",
            "occurrence_count",
            "prevalence",
            "representative_spans_us",
            "representative_evidence_indices",
        ],
        "tag_state_bits": {
            "detected": 1,
            "supported_absence": 2,
            "complete_coverage": 4,
            "truncated": 8,
        },
        "evidence_pool": [],
    }
    evidence_index = {}

    def intern(evidence):
        key = json.dumps(evidence, sort_keys=True, separators=(",", ":"))
        if key not in evidence_index:
            evidence_index[key] = len(result["evidence_pool"])
            result["evidence_pool"].append(deepcopy(evidence))
        return evidence_index[key]

    for chart_id, record in value["charts"].items():
        tags, absent = [], []
        count = (
            max(
                [
                    len(value.get("patterns", [])) - 1,
                    *record.get("absent", []),
                    *(t[0] for t in record["tags"]),
                ]
            )
            + 1
        )
        for row in expand_tags(record, count, value.get("evidence_pool")):
            if row[1:] == ["not-detected-with-supported-coverage", 0, 0, "complete", False, [], []]:
                absent.append(row[0])
            elif row[1:] != ["unknown", None, None, "partial", False, [], []]:
                state = {"detected": 1, "not-detected-with-supported-coverage": 2, "unknown": 0}[
                    row[1]
                ]
                state |= 4 if row[4] == "complete" else 0
                state |= 8 if row[5] else 0
                tags.append(
                    [row[0], state, row[2], row[3], deepcopy(row[6]), [intern(e) for e in row[7]]]
                )
        result["charts"][chart_id] = {**record, "tags": tags, "absent": absent}
    return result


def expand_tags(record, pattern_count, evidence_pool=None):
    """Reconstruct the exact observation state; also used by offline audit tools."""
    retained = {}
    for row in record["tags"]:
        if len(row) == 6:
            state = row[1]
            retained[row[0]] = [
                row[0],
                {0: "unknown", 1: "detected", 2: "not-detected-with-supported-coverage"}[state & 3],
                row[2],
                row[3],
                "complete" if state & 4 else "partial",
                bool(state & 8),
                row[4],
                [evidence_pool[i] for i in row[5]] if evidence_pool is not None else row[5],
            ]
        else:
            retained[row[0]] = row
    absent = set(record.get("absent", []))
    return [
        retained.get(
            i,
            [i, "not-detected-with-supported-coverage", 0, 0, "complete", False, [], []]
            if i in absent
            else [i, "unknown", None, None, "partial", False, [], []],
        )
        for i in range(pattern_count)
    ]
