"""Deterministic coarse retrieval and bounded passage alignment for review.

Scores are internal distances, not probabilities or measured player difficulty.
No relevance threshold is claimed until independent judgments are supplied.
"""

from __future__ import annotations

import math
from bisect import bisect_left, bisect_right
from collections import Counter
from statistics import mean

from .challenge import GROUPS, VERSION
from .contracts import content_hash

POLICY = "challenge-retrieval-1-experimental"
WEIGHTS = {"demand": 0.5, "structure": 0.35, "progression": 0.15}


def reference_scale(profiles):
    values = {}
    for profile in profiles:
        if profile.get("version") != VERSION:
            raise ValueError("Incompatible challenge profile")
        for group in GROUPS:
            for key, value in profile["demand"][group].items():
                if type(value) not in (int, float) or not math.isfinite(value):
                    raise ValueError("Nonfinite demand measurement")
                values.setdefault(group + "." + key, []).append(value)
    value = {key: sorted(items) for key, items in sorted(values.items())}
    return {"version": POLICY, "values": value, "scale_id": content_hash(value)}


def _percentile(value, reference):
    return (bisect_left(reference, value) + bisect_right(reference, value)) / (2 * len(reference))


def vector(demand, scale):
    return {
        group: {
            key: _percentile(value, scale["values"][group + "." + key])
            for key, value in demand[group].items()
            if group + "." + key in scale["values"]
        }
        for group in GROUPS
    }


def demand_distance(left, right):
    differences = {}
    for group in GROUPS:
        keys = left[group].keys() & right[group].keys()
        if keys:
            differences[group] = mean(abs(left[group][k] - right[group][k]) for k in sorted(keys))
    return (
        (mean(differences.values()), differences) if len(differences) >= 4 else (None, differences)
    )


def query_demands(query, profiles, scale, *, limit=8, eligible_ids=None):
    """Interactive summary matching; no passage alignment or coaching claim.

    Reuses the shared percentile/group distance calculations, and scans every
    eligible profile. Unlike detailed retrieval this also accepts public
    profiles whose per-passage windows were omitted from the catalog.
    """
    if type(limit) is not int or not 1 <= limit <= 100:
        raise ValueError("Result limit must be 1..100")
    if scale.get("version") != POLICY or query.get("version") != VERSION:
        raise ValueError("Incompatible retrieval policy or profile")
    query_vector = vector(query["demand"], scale)
    query_family = query.get("song_family", query["song_id"])
    rows = []
    for candidate in profiles:
        if eligible_ids is not None and candidate["chart_id"] not in eligible_ids:
            continue
        if candidate.get("version") != VERSION:
            raise ValueError("Mixed challenge profile versions")
        if (
            candidate["chart_id"] == query["chart_id"]
            or candidate.get("song_family", candidate["song_id"]) == query_family
        ):
            continue
        distance, differences = demand_distance(query_vector, vector(candidate["demand"], scale))
        if distance is not None:
            rows.append(
                {
                    "chart_id": candidate["chart_id"],
                    "distance": round(distance, 6),
                    "closest_groups": sorted(differences, key=lambda k: (differences[k], k))[:2],
                    "largest_difference": max(differences, key=lambda k: (differences[k], k)),
                }
            )
    rows.sort(key=lambda row: (row["distance"], row["chart_id"]))
    by_id = {p["chart_id"]: p for p in profiles}
    selected, families = [], set()
    for row in rows:
        profile = by_id[row["chart_id"]]
        family = profile.get("song_family", profile["song_id"])
        if family in families:
            continue
        selected.append(row)
        families.add(family)
        if len(selected) == limit:
            break
    return selected


def _substitution(a, b):
    # Equal roles/rhythm with a minor layout edit remain comparable. Reflection
    # is not normalized. Relative positions preserve the initial orientation.
    gap = abs(a[0] - b[0]) / max(1, a[0], b[0])
    roles = 0 if a[1] == b[1] else 1
    layout = 0 if a[2:] == b[2:] else 1
    return 0.35 * gap + 0.35 * roles + 0.30 * layout


def align(left, right):
    """Banded edit distance on complete bounded onset-group sequences."""
    if not left or not right or max(len(left), len(right)) > 96:
        return None
    n, m = len(left), len(right)
    if max(n, m) > 2 * min(n, m):
        return 1.0
    band = max(abs(n - m), 8)
    row = [float(i) for i in range(m + 1)]
    for i, a in enumerate(left, 1):
        new = [float(i)] + [float("inf")] * m
        for j in range(max(1, i - band), min(m, i + band) + 1):
            new[j] = min(row[j] + 1, new[j - 1] + 1, row[j - 1] + _substitution(a, right[j - 1]))
        row = new
    return round(min(1, row[m] / max(n, m)), 6)


def _representatives(profile):
    """Twelve deterministic temporal representatives; report the sampling scope."""
    windows = [w for w in profile["windows"] if w["width_beats"] == 8 and w["complete"]]
    if len(windows) <= 12:
        return windows
    return [windows[round(i * (len(windows) - 1) / 11)] for i in range(12)]


def _mechanics(window):
    roles = Counter(role for token in window["tokens"] for role in token[1])
    count = sum(roles.values()) or 1
    return [roles[k] / count for k in ("tap", "star_tap", "hold_onset", "touch", "touch_hold")]


def _passages(query, candidate):
    left, right = _representatives(query), _representatives(candidate)
    if not left or not right:
        return None
    lm, rm = [_mechanics(w) for w in left], [_mechanics(w) for w in right]
    pairs = {}
    # Bidirectional coverage: no single best passage can define a whole chart.
    for a, am, b, bm, reverse in ((left, lm, right, rm, False), (right, rm, left, lm, True)):
        for i, window in enumerate(a):
            choices = sorted(
                range(len(b)),
                key=lambda j: (sum(abs(x - y) for x, y in zip(am[i], bm[j], strict=False)), j),
            )[:2]
            for j in choices:
                key = (j, i) if reverse else (i, j)
                if key not in pairs:
                    pairs[key] = align(window["tokens"], b[j]["tokens"])
    forward = [min(v for (i, _), v in pairs.items() if i == index) for index in range(len(left))]
    backward = [min(v for (_, j), v in pairs.items() if j == index) for index in range(len(right))]
    evidence = []
    used_left, used_right = set(), set()
    for (i, j), value in sorted(pairs.items(), key=lambda p: (p[1], p[0])):
        if i in used_left or j in used_right:
            continue
        used_left.add(i)
        used_right.add(j)
        evidence.append(
            {
                "query_window": left[i]["window_id"],
                "candidate_window": right[j]["window_id"],
                "alignment_distance": value,
            }
        )
        if len(evidence) == 3:
            break
    return {
        "distance": (mean(forward) + mean(backward)) / 2,
        "passages": evidence,
        "query_windows": len(left),
        "candidate_windows": len(right),
        "scope": "bidirectional sample of complete eight-beat windows; maximum twelve per chart",
    }


def _progression(profile):
    windows = _representatives(profile)
    values = [w["demand"]["cadence"].get("mean_onsets_s", 0) for w in windows]
    maximum = max(values, default=0)
    return [values[round(i * (len(values) - 1) / 7)] / maximum if maximum else 0 for i in range(8)]


def query_challenges(query, profiles, scale, *, limit=5, detail=True):
    if type(limit) is not int or not 1 <= limit <= 100:
        raise ValueError("Result limit must be 1..100")
    if scale.get("version") != POLICY or query.get("version") != VERSION:
        raise ValueError("Incompatible retrieval policy or profile")
    qvector = vector(query["demand"], scale)
    coarse = []
    for candidate in profiles:
        if candidate["chart_id"] == query["chart_id"] or candidate.get(
            "song_family", candidate["song_id"]
        ) == query.get("song_family", query["song_id"]):
            continue
        if candidate.get("version") != VERSION:
            raise ValueError("Mixed challenge profile versions")
        value, differences = demand_distance(qvector, vector(candidate["demand"], scale))
        if value is not None and _representatives(candidate):
            coarse.append((value, candidate["chart_id"], candidate, differences))
    coarse.sort(key=lambda row: (row[0], row[1]))
    matches = []
    for value, _, candidate, differences in coarse[:200]:
        passages = _passages(query, candidate) if detail else None
        if detail and passages is None:
            continue
        progression = mean(
            abs(a - b) for a, b in zip(_progression(query), _progression(candidate), strict=False)
        )
        score = 0.5 * value + 0.35 * passages["distance"] + 0.15 * progression if detail else value
        matches.append(
            {
                "chart_id": candidate["chart_id"],
                "song_id": candidate["song_id"],
                "song_family": candidate.get("song_family", candidate["song_id"]),
                "distance": round(score, 6),
                "demand_distance": round(value, 6),
                "shared_groups": sorted(differences),
                "closest_groups": sorted(differences, key=lambda k: (differences[k], k))[:2],
                "largest_difference": max(differences, key=lambda k: (differences[k], k)),
                "passages": passages["passages"] if passages else [],
                "structure": passages,
                "progression_distance": round(progression, 6),
                "policy": POLICY,
                "relevance": "unjudged",
                "candidate_count": len(coarse),
                "reranked_count": min(200, len(coarse)),
            }
        )
    matches.sort(key=lambda m: (m["distance"], m["chart_id"]))
    selected, used = [], set()
    for match in matches:
        if match["song_family"] in used:
            continue
        used.add(match["song_family"])
        selected.append(match)
        if len(selected) == limit:
            break
    return selected
