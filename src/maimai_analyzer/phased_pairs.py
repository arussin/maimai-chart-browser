"""Evidence taxonomy and the retained phased-pair research grammar.

The legacy candidate API does not qualify community labels. The experimental
Umiyuri recognizer uses its stricter form through pattern_compounds; neither
API claims independent review or coverage of the entire community family.
"""

from __future__ import annotations

from bisect import bisect_left, bisect_right
from collections import defaultdict
from fractions import Fraction

from .chart_input import content_hash, normalize_chart
from .flow import is_known
from .rational import decode_rational, encode_rational

VERSION = "pattern-evidence-1"
CANDIDATE = "research.phased_slide_pairs"


def phased_pairs(raw):
    """Four recurrent one-beat pairs, alternating head, half-beat intervening tap.

    Exact rational onset phases; movement starts within two microseconds of the
    next pair (normalizer rounding). No relaxed variants or clipped extensions.
    Maximal overlapping runs merge. Geometry and player hand strategy are not
    constraints of this deliberately narrower project-defined research grammar.
    """
    chart = normalize_chart(raw)
    return phased_pairs_normalized(chart)


def phased_pairs_normalized(chart, *, strict=False):
    """Evaluate the retained grammar; strict mode rejects extra intervening inputs."""
    required = {"beat_grid", "positions", "authored_simultaneity", "slide_movement", "slide_wait"}
    if not required <= set(chart["capabilities"]):
        return {"pattern_id": CANDIDATE, "status": "unknown", "occurrences": []}
    onsets = chart["onsets"]
    by_beat, groups, paths = defaultdict(list), defaultdict(list), defaultdict(list)
    for event in onsets:
        if event["beat"] is None:
            return {"pattern_id": CANDIDATE, "status": "unknown", "occurrences": []}
        by_beat[decode_rational(event["beat"])].append(event)
        if event["group_id"]:
            groups[event["group_id"]].append(event)
    for path in chart["slides"]:
        if path["head_id"]:
            paths[path["head_id"]].append(path)
    pairs = {}
    for events in groups.values():
        heads = [e for e in events if e["role"] == "star_tap" and len(paths[e["event_id"]]) == 1]
        if (
            len(events) != 2
            or len(heads) != 1
            or any(type(e["position"]) is not int for e in events)
        ):
            continue
        head = heads[0]
        other = next(e for e in events if e is not head)
        if other["role"] != "tap" or other["position"] == head["position"]:
            continue
        beat = decode_rational(head["beat"])
        if len(by_beat[beat]) != 2:
            continue
        pairs[beat] = (head, other, paths[head["event_id"]][0])
    ordered_beats = sorted(by_beat)
    links = {}
    for beat, (head, other, path) in pairs.items():
        following = pairs.get(beat + 1)
        between = by_beat.get(beat + Fraction(1, 2), [])
        if following is None or len(between) != 1 or between[0]["role"] != "tap":
            continue
        if strict and not is_known(head["time_us"], following[0]["time_us"] + 1, chart):
            continue
        if strict and ordered_beats[
            bisect_right(ordered_beats, beat) : bisect_left(ordered_beats, beat + 1)
        ] != [beat + Fraction(1, 2)]:
            continue
        if (
            following[0]["position"] != other["position"]
            or following[1]["position"] != head["position"]
            or abs(path["movement_start_us"] - following[0]["time_us"]) > 2
            or not path["wait_start_us"] <= between[0]["time_us"] < path["wait_end_us"]
        ):
            continue
        links[beat] = beat + 1
    occurrences = []
    for start in sorted(links):
        if start - 1 in links:
            continue
        end = start
        while end in links:
            end = links[end]
        if end - start < 3:
            continue
        selected = [
            e
            for beat in ordered_beats[
                bisect_left(ordered_beats, start) : bisect_right(ordered_beats, end)
            ]
            for e in by_beat[beat]
        ]
        selected.sort(key=lambda e: (e["time_us"], e["event_id"]))
        occurrence = {
            "pattern_id": CANDIDATE,
            "start_us": selected[0]["time_us"],
            "end_us": selected[-1]["time_us"] + 1,
            "start_beat": encode_rational(start),
            "end_beat": encode_rational(end),
            "pair_count": int(end - start) + 1,
            "event_ids": [e["event_id"] for e in selected],
            "definition_version": VERSION,
            "naming_origin": "project_defined_research",
            "community_assignment": "not_established",
        }
        occurrences.append({**occurrence, "occurrence_id": content_hash(occurrence)})
    return {
        "pattern_id": CANDIDATE,
        "status": "research_candidate" if occurrences else "not_detected",
        "automatic_community_tagging": False,
        "occurrences": occurrences,
    }
