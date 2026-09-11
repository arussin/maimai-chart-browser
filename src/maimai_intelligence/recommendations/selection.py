"""Small diverse shortlists; structural claims require supplied match evidence."""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping
from typing import Any

from .scoring import diversify_practice_card


def structural_card(
    match: Mapping[str, Any],
    *,
    pattern_id: str | None = None,
    role: str = "practice",
    query_chart_id: str | None = None,
) -> dict[str, Any] | None:
    """Adapt a reviewed structural result, never a level-only training claim.

    Adapter input: chart_id, song_id, supported, occurrences, differences, flow.
    Practice needs the selected occurrences, a verified local run-rate relation,
    and lower global demand evidence. Surrounding demands remain limitations.
    """
    if role not in {"practice", "discovery"}:
        raise ValueError("structural card role must be practice or discovery")
    if match.get("supported") is not True or not match.get("chart_id"):
        return None
    occurrences = [
        dict(item)
        for item in match.get("occurrences", [])
        if isinstance(item, Mapping)
        and item.get("pattern_id") == pattern_id
        and type(item.get("start_us")) is int
        and type(item.get("end_us")) is int
        and item["end_us"] > item["start_us"]
    ]
    differences = [dict(item) for item in match.get("differences", []) if isinstance(item, Mapping)]
    lower = [item for item in differences if item.get("direction") == "lower"]
    relation = match.get("local_demand_relation") or {}
    query_min = relation.get("query", {}).get("min")
    candidate_max = relation.get("candidate", {}).get("max")
    local_lower = (
        relation.get("metric") == "mean_onset_cadence_within_selected_runs"
        and all(
            isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
            for v in (query_min, candidate_max)
        )
        # Retrieval verifies unrounded values; its displayed extrema retain six
        # decimals, so permit only their rounding error at the 5% boundary.
        and 0 < candidate_max <= 0.95 * query_min + 1e-6
    )
    if role == "practice" and (not pattern_id or not occurrences or not lower or not local_lower):
        return None
    query = {
        "chart_id": query_chart_id or match["chart_id"],
        "mode": "easier" if role == "practice" else "discovery",
    }
    if pattern_id:
        query["pattern_id"] = pattern_id
    return {
        "category": role,
        "chart_id": match["chart_id"],
        "song_id": match.get("song_id"),
        "targeted_patterns": [pattern_id] if pattern_id else [],
        "supporting_occurrences": occurrences,
        "feature_differences": differences,
        "intended_role": "lower mean onset rate within selected runs"
        if role == "practice"
        else "structural breadth",
        "objective": (
            "Compare the identified sections and practice their authored timing."
            if role == "practice"
            else "Explore a structural neighbor without a recorded result and assess its fit."
        ),
        "flow": match.get("flow"),
        "local_demand_relation": dict(relation) if relation else None,
        "alternative_query": query,
        "reachability": {"status": "unknown"},
        "evidence_limitations": [
            "Structure identifies a practice candidate, not demonstrated skill transfer.",
            "Player prerequisites and manageable surrounding demands are not verified.",
            *match.get("limitations", []),
        ],
    }


def select_shortlist(
    rating: Iterable[Mapping[str, Any]],
    practice: Iterable[Mapping[str, Any]] = (),
    discovery: Iterable[Mapping[str, Any]] = (),
    *,
    quotas: tuple[int, int, int] = (2, 2, 1),
) -> dict[str, Any]:
    """Pick at most one card per song, retaining fewer cards when evidence lacks.

    Recorded charts prefer the smallest positive achievement step; unrecorded
    charts prefer an explicit score threshold over a tiny mathematical entry
    increment. This is a transparent UI heuristic, not calibrated ability.
    """
    if len(quotas) != 3 or any(type(value) is not int or not 0 <= value <= 20 for value in quotas):
        raise ValueError("shortlist quotas must be three integers in 0..20")
    by_chart: dict[str, Mapping[str, Any]] = {}
    for item in rating:
        if not item.get("chart_id") or not (item.get("gain_if_achieved") or 0) > 0:
            continue
        key = str(item["chart_id"])
        prior = by_chart.get(key)
        order = lambda value: (  # noqa: E731
            value.get("previous_achievement") is None
            and "score_threshold" not in value.get("kinds", []),
            value.get("target_achievement", 102),
            -value["gain_if_achieved"],
            value.get("target_lamp", ""),
        )
        if prior is None or order(item) < order(prior):
            by_chart[key] = item
    rating_candidates = sorted(
        by_chart.values(), key=lambda item: (-item["gain_if_achieved"], str(item["chart_id"]))
    )
    selected: list[dict[str, Any]] = []
    seen: set[str] = set()
    missing: list[str] = []
    for category, limit, items in zip(
        ("rating", "practice", "discovery"),
        quotas,
        (rating_candidates, list(practice), list(discovery)),
        strict=True,
    ):
        count = 0
        pending = list(items)
        while pending and count < limit:
            pending = [
                item
                for item in pending
                if item.get("chart_id") and str(item.get("song_id") or item["chart_id"]) not in seen
            ]
            if not pending:
                break
            if category == "practice" and any(item.get("practice_score") for item in pending):
                unique = {}
                for item in pending:
                    key = (item["chart_id"], item.get("alternative_query", {}).get("chart_id"))
                    prior = unique.get(key)
                    if prior is None or item.get("practice_score", {}).get(
                        "ranking_score", -100
                    ) > prior.get("practice_score", {}).get("ranking_score", -100):
                        unique[key] = item
                pending = list(unique.values())
                pending = [diversify_practice_card(item, selected) for item in pending]
                pending.sort(
                    key=lambda item: (
                        -item.get("practice_score", {}).get("ranking_score", -100),
                        -item.get("practice_score", {}).get("coverage", 0),
                        str(item.get("chart_id")),
                        str(item.get("alternative_query", {}).get("chart_id", "")),
                    )
                )
            item = pending.pop(0)
            song = str(item.get("song_id") or item.get("chart_id"))
            if not item.get("chart_id") or song in seen:
                continue
            selected.append(dict(item))
            seen.add(song)
            count += 1
        if count < limit:
            missing.append(f"{category}: fewer independent supported candidates than requested")
    return {
        "cards": selected,
        "diagnostics": missing,
        "policy_id": "shortlist-v2-evidence-scoring-song-context-diversity",
        "quotas": list(quotas),
    }
