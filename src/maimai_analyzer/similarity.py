"""Explainable sequence/section retrieval; no pairwise index or player dependencies.

Ordered trigram overlap preserves local event order; it is not an exact phrase
alignment and cannot establish equivalent ergonomics or learning transfer.
"""

from __future__ import annotations

import json
import math
from collections import Counter
from collections.abc import Iterable, Mapping

POLICY_VERSION = "ordered-structure-v3"
MODES = {"overall", "same-pattern", "easier", "next-step", "discovery", "section"}
FEATURE_KEYS = (
    "tap_fraction",
    "hold_fraction",
    "touch_fraction",
    "star_fraction",
    "simultaneous_fraction",
    "branches_per_head",
    "mean_beat_interval",
    "beat_interval_variation",
    "hold_occupancy",
    "slide_movement_occupancy",
    "slide_wait_occupancy",
)
DEMAND_KEYS = (
    "onset_rate",
    "peak_onset_rate",
    "hold_occupancy",
    "slide_movement_occupancy",
    "slide_wait_occupancy",
    "max_concurrency",
)
MINIMUM_COVERAGE = 0.6
RATE_FAMILY = frozenset({"onset_rate", "peak_onset_rate"})
NUMERIC_TOLERANCE = 0.000001
LOCAL_RUN_PATTERNS = {"pattern.two_position_alternation", "pattern.same_position_repetition"}
MAX_LOCAL_OCCURRENCES = 4096


def _number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def sequence_counts(descriptor: Mapping) -> dict[str, int]:
    """Compact exact multiset of local sequences, also accepted by the browser."""
    if "ngrams" in descriptor:
        return dict(descriptor["ngrams"] or {})
    tokens = [
        json.dumps(t, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        if not isinstance(t, str)
        else t
        for t in (descriptor.get("sequence") or [])
    ]
    if not tokens:
        return {}
    width = min(3, len(tokens))
    return dict(
        sorted(
            Counter(
                json.dumps(tokens[i : i + width], ensure_ascii=False, separators=(",", ":"))
                for i in range(len(tokens) - width + 1)
            ).items()
        )
    )


def compact_descriptor(descriptor: Mapping) -> dict:
    """Retain all trigram counts, never an arbitrary nearest-neighbor shortlist."""
    return {
        "ngrams": sequence_counts(descriptor),
        "features": {k: descriptor.get("features", {}).get(k) for k in FEATURE_KEYS},
        "coverage": _coverage(descriptor.get("coverage", 0)),
        "policy_version": POLICY_VERSION,
    }


def _coverage(value) -> float:
    if _number(value):
        return min(1, max(0, value))
    if isinstance(value, dict):
        return _coverage(value.get("fraction", 0))
    return 0


def distance(left: Mapping, right: Mapping) -> dict | None:
    a, b = sequence_counts(left), sequence_counts(right)
    sequence_coverage = min(_coverage(left.get("coverage")), _coverage(right.get("coverage")))
    if not a or not b or sequence_coverage < MINIMUM_COVERAGE:
        return None
    af, bf = left.get("features", {}), right.get("features", {})
    known = [k for k in FEATURE_KEYS if _number(af.get(k)) and _number(bf.get(k))]
    # Sequence evidence is 75% of the supported representation. Missing scalar
    # dimensions are omitted, never imputed as zero.
    coverage = sequence_coverage * (0.75 + 0.25 * len(known) / len(FEATURE_KEYS))
    if coverage < MINIMUM_COVERAGE:
        return None
    common = sum(min(count, b.get(key, 0)) for key, count in a.items())
    sequence_distance = 1 - 2 * common / (sum(a.values()) + sum(b.values()))
    scalar = (
        sum(abs(af[k] - bf[k]) / max(abs(af[k]), abs(bf[k]), 1) for k in known) / len(known)
        if known
        else 0
    )
    scalar_weight = 0.25 * len(known) / len(FEATURE_KEYS)
    result = (0.75 * sequence_distance + scalar_weight * scalar) / (0.75 + scalar_weight)
    return {
        "distance": round(result, 6),
        "coverage": round(coverage, 6),
        "sequence_distance": round(sequence_distance, 6),
        "matched_trigrams": common,
        "shared_features": known,
    }


def _patterns(value: Mapping) -> set[str]:
    if "pattern_ids" in value:
        return set(value["pattern_ids"])
    return {
        t["pattern_id"]
        for t in value.get("tags", [])
        if t.get("status") in {"detected", "reviewed-present"}
    }


def _local_run_rates(chart: Mapping, pattern_id: str, section: Mapping | None = None):
    """Exact v0 run cadence; full counts survive truncation of example event IDs.

    These two detectors define bounds as [first onset, last onset + 1 us).
    Other grammars do not establish this measurement and remain unsupported.
    """
    if pattern_id not in LOCAL_RUN_PATTERNS:
        return None
    tags = [t for t in chart.get("tags", []) if t.get("pattern_id") == pattern_id]
    occurrences = chart.get("occurrences", [])
    if len(tags) != 1 or len(occurrences) > 100_000:
        return None
    tag = tags[0]
    if (
        tag.get("status") not in {"detected", "reviewed-present"}
        or tag.get("coverage") != "complete"
        or tag.get("occurrences_truncated") is not False
        or type(tag.get("occurrence_count")) is not int
        or not 1 <= tag["occurrence_count"] <= MAX_LOCAL_OCCURRENCES
    ):
        return None
    selected = [o for o in occurrences if o.get("pattern_id") == pattern_id]
    if len(selected) != tag["occurrence_count"]:
        return None
    rates, seen = [], set()
    for occurrence in selected:
        start, end = occurrence.get("start_us"), occurrence.get("end_us")
        count = occurrence.get("measurements", {}).get("onset_count")
        oid = occurrence.get("occurrence_id")
        if (
            not isinstance(oid, str)
            or not oid
            or oid in seen
            or occurrence.get("definition_version") != "0.1.0"
            or occurrence.get("detector_version") not in {"0.1.0", "0.2.0", "0.3.0"}
            or occurrence.get("evidence", {}).get("timing") != "supported_section"
            or type(count) is not int
            or not 2 <= count <= 100_000
            or type(start) is not int
            or type(end) is not int
            or not 0 <= start < end - 1 <= 3_600_000_000
        ):
            return None
        seen.add(oid)
        if section is not None and not (
            section.get("start_us", end) <= start and section.get("end_us", start) >= end
        ):
            continue
        rates.append((count - 1) * 1_000_000 / (end - start - 1))
    return rates or None


def _local_relation(qr, candidate, pattern_id, mode, dimension, csection):
    if dimension != "onset_rate":
        return None
    cr = _local_run_rates(candidate, pattern_id, csection)
    if qr is None or cr is None:
        return None
    if mode == "easier":
        supported = max(cr) <= 0.95 * min(qr)
        criterion = "candidate maximum <= 95% of query minimum"
    else:
        supported = min(cr) >= 1.05 * max(qr) and max(cr) <= 1.25 * min(qr)
        criterion = "every candidate run is 105%..125% of every query run"
    if not supported:
        return None
    return {
        "metric": "mean_onset_cadence_within_selected_runs",
        "unit": "onsets/second",
        "query": {"min": round(min(qr), 6), "max": round(max(qr), 6), "occurrence_count": len(qr)},
        "candidate": {
            "min": round(min(cr), 6),
            "max": round(max(cr), 6),
            "occurrence_count": len(cr),
        },
        "criterion": criterion,
        "evidence_scope": "Complete retained v0.1.0 runs; (onset_count - 1) / first-to-last time. "
        "Mean cadence does not establish peak cadence, ergonomics or learning benefit.",
    }


def query_profiles(
    query: Mapping,
    candidates: Iterable[Mapping],
    *,
    mode="overall",
    pattern_id=None,
    section_id=None,
    lower_dimension="onset_rate",
    eligible_ids=None,
    recorded_ids=(),
    limit=20,
) -> list[dict]:
    """Hard filters precede ranking. Lower demand is a directed measured relation."""
    if mode not in MODES or lower_dimension not in DEMAND_KEYS:
        raise ValueError("Unsupported similarity mode or demand dimension")
    if not isinstance(limit, int) or not 1 <= limit <= 100:
        raise ValueError("Similarity limit must be 1..100")
    if mode in {"same-pattern", "easier"} and not pattern_id:
        return []
    qsection = None
    if section_id:
        qsection = next(
            (s for s in query.get("sections", []) if s["section_id"] == section_id), None
        )
        if qsection is None:
            raise ValueError("Query section does not belong to the chart")
    if mode == "section" and qsection is None:
        return []
    q = qsection or query
    if pattern_id and pattern_id not in _patterns(q):
        return []
    local_query_rates = None
    if mode in {"easier", "next-step"} and pattern_id:
        if lower_dimension != "onset_rate":
            return []
        local_query_rates = _local_run_rates(query, pattern_id, qsection)
        if local_query_rates is None:
            return []
    eligible = None if eligible_ids is None else set(eligible_ids)
    recorded = set(recorded_ids)
    matches = []
    for chart in candidates:
        cid = chart["chart_id"]
        if cid == query["chart_id"] or (eligible is not None and cid not in eligible):
            continue
        if mode == "discovery" and cid in recorded:
            continue
        choices = chart.get("sections", []) if qsection else [chart]
        best = None
        for candidate in choices:
            if pattern_id and pattern_id not in _patterns(candidate):
                continue
            result = distance(q.get("descriptor", {}), candidate.get("descriptor", {}))
            if result is None or result["distance"] > 0.6 or not result["matched_trigrams"]:
                continue
            qm, cm = q.get("metrics", {}), candidate.get("metrics", {})
            differences = {
                k: {"query": qm[k], "candidate": cm[k], "delta": round(cm[k] - qm[k], 6)}
                for k in DEMAND_KEYS
                if _number(qm.get(k)) and _number(cm.get(k))
            }
            local_relation = None
            if mode in {"easier", "next-step"}:
                if pattern_id:
                    local_relation = _local_relation(
                        local_query_rates,
                        chart,
                        pattern_id,
                        mode,
                        lower_dimension,
                        candidate if qsection else None,
                    )
                    if local_relation is None:
                        continue
                selected = differences.get(lower_dimension)
                if selected is None or selected["query"] <= 0:
                    continue
                ratio = selected["candidate"] / selected["query"]
                if mode == "easier" and not ratio <= 0.95:
                    continue
                if mode == "next-step" and not 1.05 <= ratio <= 1.25:
                    continue
                # All prerequisite dimensions must be measured for this claim.
                if len(differences) != len(DEMAND_KEYS):
                    continue
                if mode == "easier":
                    if any(
                        d["candidate"] > d["query"] * 1.25 + 0.1
                        for k, d in differences.items()
                        if k != lower_dimension
                    ):
                        continue
                else:
                    # Raise one independent demand family. Average/peak onset
                    # rates may covary, while other prerequisites must not rise.
                    selected_family = (
                        RATE_FAMILY if lower_dimension in RATE_FAMILY else {lower_dimension}
                    )
                    if any(
                        d["candidate"]
                        > d["query"] * (1.25 if k in selected_family else 1) + NUMERIC_TOLERANCE
                        for k, d in differences.items()
                        if k != lower_dimension
                    ):
                        continue
            explanation = [
                f"Shares {result['matched_trigrams']} ordered event-role/spacing trigrams.",
                "Local sequence resemblance; ergonomics and learning benefit unverified.",
            ]
            if pattern_id:
                explanation.insert(1, f"Supporting occurrences of {pattern_id} in both settings.")
            if mode in {"easier", "next-step"}:
                d = differences[lower_dimension]
                explanation.insert(
                    1,
                    f"{lower_dimension}: {d['query']:g} → {d['candidate']:g}; "
                    "other measured demands bounded by policy.",
                )
                if mode == "next-step":
                    explanation.insert(
                        2,
                        "Only the selected demand family may increase; "
                        "average and peak onset rates may covary.",
                    )
                if local_relation:
                    explanation.append(
                        "Selected-run mean onset cadence: "
                        f"{local_relation['query']['min']:g}–{local_relation['query']['max']:g} → "
                        f"{local_relation['candidate']['min']:g}–"
                        f"{local_relation['candidate']['max']:g} onsets/second. "
                        "Full retained run counts; local peak cadence and ergonomics unverified."
                    )
            if mode == "discovery":
                explanation.append(
                    "No recorded result in supplied overlay; play history may be incomplete."
                )
            match = {
                "chart_id": cid,
                "section_id": candidate.get("section_id"),
                **result,
                "differences": differences,
                "explanation": explanation,
                "policy_version": POLICY_VERSION,
                "transformation": "Authored relative button steps; reflection not normalized",
            }
            if local_relation:
                match["local_demand_relation"] = local_relation
            if best is None or (match["distance"], match.get("section_id") or "") < (
                best["distance"],
                best.get("section_id") or "",
            ):
                best = match
        if best:
            matches.append(best)
    return sorted(matches, key=lambda m: (m["distance"], m["chart_id"], m["section_id"] or ""))[
        :limit
    ]
