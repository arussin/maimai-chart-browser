"""Inspectable provisional practice preferences and exact-chart attempt heuristics.

These weights express a product policy, not measured learning benefit. Unknown
terms retain null values and contribute uncertainty bounds, never invented facts.
"""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Mapping, Sequence
from copy import deepcopy
from dataclasses import dataclass
from heapq import heappop, heappush
from statistics import median

from .rating import LAMPS, _achievement, _lamp

DAY_MS = 86_400_000
SCORING_VERSION = "practice-evidence-v1-experimental"
REACHABILITY_VERSION = "same-chart-attempts-v1-experimental"
WEIGHTS = (
    ("relevance", 0.25),
    ("repetitions", 0.15),
    ("isolation", 0.15),
    ("prerequisite_readiness", 0.15),
    ("source_confidence", 0.10),
    ("freshness", 0.05),
    ("diversity", 0.05),
    ("retry_saturation", -0.10),
)


def _number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _cutoff(as_of):
    if type(as_of) is not int or not 0 <= as_of < 8.64e15:
        raise ValueError("Scoring requires an explicit retained cutoff in milliseconds")


@dataclass(frozen=True)
class Prerequisite:
    """A user-selected demonstration objective, not a verified skill dependency."""

    chart_id: str
    target_achievement: float
    target_lamp: str = "CLEAR"

    def __post_init__(self):
        if not isinstance(self.chart_id, str) or not 0 < len(self.chart_id) <= 256:
            raise ValueError("Prerequisite requires an exact chart ID")
        _achievement(self.target_achievement)
        _lamp(self.target_lamp)
        if self.target_lamp == "FAILED":
            raise ValueError("A prerequisite lamp objective cannot be FAILED")


@dataclass(frozen=True)
class PracticeGoal:
    pattern_id: str
    target_achievement: float | None = None
    target_lamp: str = "CLEAR"
    prerequisites: tuple[Prerequisite, ...] = ()

    def __post_init__(self):
        if not isinstance(self.pattern_id, str) or not 0 < len(self.pattern_id) <= 256:
            raise ValueError("Practice goal requires an explicit pattern ID")
        if self.target_achievement is not None:
            _achievement(self.target_achievement)
        _lamp(self.target_lamp)
        if self.target_lamp == "FAILED":
            raise ValueError("A practice lamp objective cannot be FAILED")
        if len(self.prerequisites) > 20 or any(
            not isinstance(item, Prerequisite) for item in self.prerequisites
        ):
            raise ValueError("Practice goal allows at most 20 explicit prerequisites")
        if len({item.chart_id for item in self.prerequisites}) != len(self.prerequisites):
            raise ValueError("Duplicate prerequisite chart ID")

    @classmethod
    def from_mapping(cls, value):
        allowed = {"pattern_id", "target_achievement", "target_lamp", "prerequisites"}
        if not isinstance(value, Mapping) or set(value) - allowed:
            raise ValueError("Practice goal contains fields outside its allowlist")
        prerequisites = value.get("prerequisites", [])
        if not isinstance(prerequisites, list):
            raise ValueError("Practice prerequisites must be a list")
        parsed = []
        for item in prerequisites:
            if not isinstance(item, Mapping) or set(item) - {
                "chart_id",
                "target_achievement",
                "target_lamp",
            }:
                raise ValueError("Prerequisite contains fields outside its allowlist")
            if not {"chart_id", "target_achievement"} <= item.keys():
                raise ValueError("Prerequisite needs chart ID and achievement objective")
            parsed.append(Prerequisite(**item))
        return cls(
            value.get("pattern_id"),
            value.get("target_achievement"),
            value.get("target_lamp", "CLEAR"),
            tuple(parsed),
        )

    def metadata(self):
        return {
            "pattern_id": self.pattern_id,
            "target_achievement": self.target_achievement,
            "target_lamp": self.target_lamp,
            "prerequisites": [vars(item) for item in self.prerequisites],
            "prerequisite_basis": "user-selected objectives; skill relationship unvalidated",
        }


def retained_attempts(attempts, *, as_of):
    """Deduplicate stable actual attempt IDs; PB snapshots are never accepted here."""
    _cutoff(as_of)
    if not isinstance(attempts, Sequence) or isinstance(attempts, (str, bytes)):
        raise ValueError("Attempts must be an explicit sequence")
    if len(attempts) > 100_000:
        raise ValueError("Too many supplied attempts")
    seen = {}
    for item in attempts:
        if not isinstance(item, Mapping):
            raise ValueError("Each attempt must be an object")
        aid, when = item.get("attempt_id"), item.get("recorded_at")
        if not isinstance(aid, str) or not 0 < len(aid) <= 256:
            raise ValueError("Attempt needs a stable nonempty ID")
        if when is not None and (type(when) is not int or not 0 <= when <= as_of):
            raise ValueError("Attempt occurs after retained cutoff or has an invalid time")
        percent, lamp = item.get("percent"), item.get("lamp")
        if lamp == "":
            lamp = None
        if percent is not None:
            percent = float(_achievement(percent))
        if lamp is not None:
            _lamp(lamp)
        record = {"attempt_id": aid, "recorded_at": when, "percent": percent, "lamp": lamp}
        if aid in seen and seen[aid] != record:
            raise ValueError("Conflicting duplicate attempt ID")
        seen[aid] = record
    return sorted(
        seen.values(),
        key=lambda a: (a["recorded_at"] is None, a["recorded_at"] or 0, a["attempt_id"]),
    )


def _recent(attempts, as_of, days):
    return [
        a
        for a in attempts
        if a["recorded_at"] is not None and a["recorded_at"] >= as_of - days * DAY_MS
    ]


def attempt_reachability(attempts, target_achievement, target_lamp="CLEAR", *, as_of):
    """Classify only repeated recent performances on this exact candidate chart."""
    records = retained_attempts(attempts, as_of=as_of)
    result = {
        "status": "unknown",
        "label": None,
        "policy_id": REACHABILITY_VERSION,
        "reason": "A PB maximum or structural resemblance does not establish repeatability.",
        "evidence": {"supplied_attempt_count": len(records)},
        "limitations": [
            "Uncalibrated heuristic, not a probability or training prediction.",
            "Supplied attempts may be incomplete; no cross-chart ability inference.",
        ],
    }
    if target_achievement is None:
        result["reason"] = (
            "No explicit achievement objective; structural practice benefit is unknown."
        )
        return result
    target = float(_achievement(target_achievement))
    _lamp(target_lamp)
    recent = [
        a for a in _recent(records, as_of, 30) if a["percent"] is not None and a["lamp"] is not None
    ][-20:]
    result["evidence"].update(
        {"considered_attempt_count": len(recent), "window_days": 30, "latest_limit": 20}
    )
    if len(recent) < 5 or recent[-1]["recorded_at"] - recent[0]["recorded_at"] < DAY_MS:
        result["reason"] = "Need five distinct recent attempts spanning at least 24 hours."
        return result
    if as_of - recent[-1]["recorded_at"] > 14 * DAY_MS:
        result["reason"] = "Latest usable attempt is older than 14 days."
        return result
    values = [a["percent"] for a in recent]
    middle, spread = median(values), max(values) - min(values)
    lamp_count = sum(LAMPS.index(a["lamp"]) >= LAMPS.index(target_lamp) for a in recent)
    result["evidence"].update(
        {
            "median_achievement": middle,
            "best_achievement": max(values),
            "range_points": round(spread, 6),
            "lamp_demonstrations": lamp_count,
            "target_achievement": target,
            "target_lamp": target_lamp,
            "median_gap_points": round(target - middle, 6),
        }
    )
    if spread > 1.0 or lamp_count < 2:
        result["reason"] = (
            "Observed spread exceeds one point or the requested lamp lacks two demonstrations."
        )
        return result
    gap = target - middle
    if gap <= 0.2 and spread <= 0.6:
        label = "near-term"
    elif gap <= 1.0 and target - max(values) <= 0.5:
        label = "plausible"
    else:
        label = "stretch"
    result.update(
        {
            "status": "heuristic",
            "label": label,
            "reason": (
                f"{label.capitalize()} under an uncalibrated same-chart rule: target is "
                f"{gap:.4f} points above the recent median; observed range {spread:.4f}."
            ),
        }
    )
    return result


def _term(name, value, reason, *, status="observed_proxy", evidence=None):
    return {
        "name": name,
        "status": "unknown" if value is None else status,
        "value": None if value is None else round(value, 6),
        "weight": dict(WEIGHTS)[name],
        "contribution": None,
        "reason": reason,
        "evidence": evidence or {},
    }


def _score(terms):
    total = lower = upper = known = 0.0
    for term in terms:
        weight, value = term["weight"], term["value"]
        if value is None:
            lower += min(0, weight) * 100
            upper += max(0, weight) * 100
        else:
            contribution = round(weight * value * 100, 6)
            term["contribution"] = contribution
            total += contribution
            lower += contribution
            upper += contribution
            known += abs(weight)
    return {
        "policy_id": SCORING_VERSION,
        "score": round(total, 6),
        "bounds": [round(lower, 6), round(upper, 6)],
        "ranking_score": round(lower, 6),
        "coverage": round(known, 6),
        "terms": terms,
        "meaning": (
            "Supported preference points; rank by conservative lower bound. "
            "Not ability, probability or learning gain."
        ),
    }


def _intervals(chart, pattern_id):
    result = set()
    for occurrence in chart.get("occurrences", []):
        start, end = occurrence.get("start_us"), occurrence.get("end_us")
        if (
            occurrence.get("pattern_id") == pattern_id
            and type(start) is int
            and type(end) is int
            and 0 <= start < end
        ):
            result.add((start, end))
    merged = []
    for start, end in sorted(result):
        if merged and start < merged[-1][1]:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    return merged


def _prerequisites(goal, histories, as_of):
    observations = []
    for objective in goal.prerequisites:
        attempts = retained_attempts(histories.get(objective.chart_id, []), as_of=as_of)
        usable = [
            a
            for a in _recent(attempts, as_of, 30)
            if a["percent"] is not None and a["lamp"] is not None
        ]
        successes = [
            a
            for a in usable
            if a["percent"] >= float(objective.target_achievement)
            and LAMPS.index(a["lamp"]) >= LAMPS.index(objective.target_lamp)
        ]
        met = (
            len(successes) >= 2
            and successes[-1]["recorded_at"] - successes[0]["recorded_at"] >= DAY_MS
        )
        observations.append(
            {
                "chart_id": objective.chart_id,
                "target_achievement": objective.target_achievement,
                "target_lamp": objective.target_lamp,
                "observed_successes": len(successes),
                "status": "demonstrated_in_supplied_attempts" if met else "unknown",
            }
        )
    if not observations or any(item["status"] == "unknown" for item in observations):
        return _term(
            "prerequisite_readiness",
            None,
            "Required objectives are undefined or lack repeated demonstrations; "
            "player readiness remains unknown.",
            evidence={"objectives": observations},
        )
    return _term(
        "prerequisite_readiness",
        1.0,
        "User-selected objectives each demonstrated twice at least 24 hours apart; "
        "their skill relationship remains unvalidated.",
        evidence={"objectives": observations},
    )


def _isolation(intervals, sections):
    # Sweep section endpoints once. Overlap uses the worst supported context;
    # unknown overlap remains unknown. No occurrence-by-section Cartesian scan.
    if len(intervals) + len(sections) > 20_000:
        return None, 0
    events = defaultdict(list)
    for index, section in enumerate(sections):
        start, end = section.get("start_us"), section.get("end_us")
        if type(start) is not int or type(end) is not int or not 0 <= start < end:
            return None, 0
        metrics = section.get("metrics", {})
        values = [
            metrics.get(k)
            for k in (
                "max_concurrency",
                "hold_occupancy",
                "slide_movement_occupancy",
                "slide_wait_occupancy",
            )
        ]
        activity = (
            max(0, values[0] - 1) + sum(values[1:])
            if all(_number(v) and v >= 0 for v in values)
            else None
        )
        events[start].append((index, True, activity))
        events[end].append((index, False, activity))
    active, unknown, heap, pieces = set(), set(), [], []
    bounds = sorted(events)
    for left, right in zip(bounds, bounds[1:], strict=False):
        for index, entering, activity in events[left]:
            if entering:
                active.add(index)
                if activity is None:
                    unknown.add(index)
                else:
                    heappush(heap, (-activity, index))
            else:
                active.discard(index)
                unknown.discard(index)
        while heap and heap[0][1] not in active:
            heappop(heap)
        value = 1 / (1 - heap[0][0]) if active and not unknown and heap else None
        pieces.append((left, right, value))
    observed = supported = pointer = 0
    for start, end in intervals:
        while pointer < len(pieces) and pieces[pointer][1] <= start:
            pointer += 1
        index = pointer
        while index < len(pieces) and pieces[index][0] < end:
            left, right, value = pieces[index]
            overlap = max(0, min(end, right) - max(start, left))
            if value is not None:
                supported += overlap
                observed += overlap * value
            index += 1
    duration = sum(end - start for start, end in intervals)
    return (observed / duration if duration and supported == duration else None), supported


def score_practice_candidate(chart, match, goal, *, histories=None, as_of):
    """Score one adequate selected-pattern match without treating unknowns as zero."""
    _cutoff(as_of)
    histories = histories or {}
    intervals = _intervals(chart, goal.pattern_id)
    tags = [
        t
        for t in chart.get("tags", [])
        if t.get("pattern_id") == goal.pattern_id
        and t.get("status") in {"detected", "reviewed-present"}
    ]
    distance, coverage = match.get("distance"), match.get("coverage")
    if (
        not intervals
        or not tags
        or not _number(distance)
        or not 0 <= distance <= 0.6
        or not _number(coverage)
        or not 0.6 <= coverage <= 1
    ):
        return None
    tag = tags[0]
    terms = [
        _term(
            "relevance",
            1 - distance,
            "Selected pattern has explicit occurrences and an adequate structural match.",
            evidence={
                "pattern_id": goal.pattern_id,
                "distance": distance,
                "shared_coverage": coverage,
            },
        )
    ]
    # Only deduplicated occurrence windows count. One long run is one opportunity,
    # not hundreds of practice repetitions; actual repetitions need richer grammar.
    terms.append(
        _term(
            "repetitions",
            min(len(intervals) / 4, 1),
            "Up to four separate observed occurrence windows; this does not establish "
            "learning value or count notes as repetitions.",
            evidence={
                "observed_windows": len(intervals),
                "tag_occurrence_count": tag.get("occurrence_count"),
                "coverage": tag.get("coverage"),
                "truncated": bool(tag.get("occurrences_truncated")),
            },
        )
    )
    selected_duration = sum(end - start for start, end in intervals)
    sections = chart.get("sections", [])
    value, supported_duration = _isolation(intervals, sections)
    terms.append(
        _term(
            "isolation",
            value,
            "Inverse concurrent/held/moving activity in fully measured supporting sections; "
            "coarse context may include the selected pattern itself.",
            evidence={
                "occurrence_duration_us": selected_duration,
                "supported_context_us": supported_duration,
                "context_budget_exceeded": len(intervals) + len(sections) > 20_000,
            },
        )
    )
    terms.append(_prerequisites(goal, histories, as_of))
    occurrences = sorted(
        [o for o in chart.get("occurrences", []) if o.get("pattern_id") == goal.pattern_id],
        key=lambda o: (o.get("start_us", 0), o.get("end_us", 0), o.get("occurrence_id", "")),
    )
    quality = []
    for o in occurrences:
        evidence = o.get("evidence", {})
        acceptable = {
            "source_kind": {"authored_synthetic", "reviewed_permitted_local"},
            "identity": {"exact", "reviewed"},
            "timing": {"supported_section"},
            "definition": {"project_experimental", "reviewed"},
            "detector": {"synthetic_tested_experimental", "reviewed"},
        }
        if all(evidence.get(key) in values for key, values in acceptable.items()):
            # An experimental definition/detector cannot receive reviewed credit.
            components = (
                evidence["source_kind"] in {"authored_synthetic", "reviewed_permitted_local"},
                evidence["identity"] in {"exact", "reviewed"},
                evidence["timing"] == "supported_section",
                evidence["definition"] == "reviewed",
                evidence["detector"] == "reviewed",
            )
            quality.append(sum(components) / 5)
    source_value = min(quality) if quality and len(quality) == len(occurrences) else None
    terms.append(
        _term(
            "source_confidence",
            source_value,
            "Equal credit for five explicit provenance fields; experimental grammar/detectors "
            "earn no reviewed credit. This is a reference-quality preference, "
            "not calibrated confidence.",
            evidence={
                "source_id": chart.get("source_id"),
                "quality_fields": [dict(o.get("evidence", {})) for o in occurrences[:4]],
                "additional_occurrences": max(0, len(occurrences) - 4),
            },
        )
    )
    attempts = retained_attempts(histories.get(chart["chart_id"], []), as_of=as_of)
    dated = [a for a in attempts if a["recorded_at"] is not None]
    age = (as_of - dated[-1]["recorded_at"]) / DAY_MS if dated else None
    terms.append(
        _term(
            "freshness",
            min(age / 14, 1) if age is not None else None,
            "Time since latest supplied attempt, capped at 14 days; missing history "
            "does not establish an unplayed chart.",
            evidence={"days_since_supplied_attempt": age},
        )
    )
    terms.append(
        _term(
            "diversity",
            1.0,
            "No previously selected overlapping context; recomputed during shortlist selection.",
            status="policy_preference",
        )
    )
    recent = [a for a in _recent(attempts, as_of, 7) if a["percent"] is not None]
    saturation, improvement = None, None
    if len(recent) >= 6:
        halfway = len(recent) // 2
        improvement = max(a["percent"] for a in recent[halfway:]) - max(
            a["percent"] for a in recent[:halfway]
        )
        saturation = min((len(recent) - 3) / 5, 1) if improvement <= 0.1 else 0
    terms.append(
        _term(
            "retry_saturation",
            saturation,
            "Penalty only after six supplied attempts within seven days and at most "
            "0.1-point improvement between halves; suggests an alternative, "
            "not a diagnosed plateau.",
            evidence={"recent_attempt_count": len(recent), "best_change_points": improvement},
        )
    )
    return _score(terms)


def diversify_practice_card(card, selected):
    """Recompute one explicit policy term; the selected goal itself is exempt."""
    result = deepcopy(card)
    score = result.get("practice_score")
    if not score:
        return result
    context = set(result.get("context_patterns", [])) - set(result.get("targeted_patterns", []))
    overlaps = sum(bool(context & set(item.get("context_patterns", []))) for item in selected)
    for term in score["terms"]:
        if term["name"] == "diversity":
            term.update(
                value=round(1 / (1 + overlaps), 6),
                reason=(
                    "Avoid repeated surrounding pattern contexts; "
                    "an explicitly selected target pattern is exempt."
                ),
                evidence={"overlapping_selected_cards": overlaps},
            )
    result["practice_score"] = _score(score["terms"])
    return result


def rescore_relevance(score, match):
    """Reuse candidate/history terms when a better qualifying anchor is found."""
    terms = deepcopy(score["terms"])
    relevance = next(term for term in terms if term["name"] == "relevance")
    relevance["value"] = round(1 - match["distance"], 6)
    relevance["evidence"].update(distance=match["distance"], shared_coverage=match["coverage"])
    return _score(terms)
