"""Pinned source policy, explicit identity joins and reproducible review partitions."""

from __future__ import annotations

import hashlib
from collections import defaultdict

from .contracts import content_hash

SOURCE_LOCK = {
    "repository": "Neskol/Maichart-Converts",
    "revision": "e164add85213bab150e1487d5eb15ccb631aedb9",
    "credit": "Neskol / Maichart-Converts; converted with MaichartConverter",
    "notice": "Upstream describes research use and prohibits commercial use. "
    "Original charts and media belong to their respective copyright holders.",
    "url": "https://github.com/Neskol/Maichart-Converts",
}
BENCHMARK_VERSION = "challenge-review-1"


def identity_join(source, mappings, overlay):
    """Only an explicit reviewed, body-bound, one-to-one mapping can attach a PB."""
    rows = [m for m in mappings if m.get("source_chart_id") == source["chart_id"]]
    if len(rows) != 1:
        return None
    mapping = rows[0]
    target = mapping.get("report_chart_id")
    if (
        mapping.get("status") != "reviewed"
        or not mapping.get("evidence")
        or mapping.get("source_hash") != source.get("source_hash")
        or mapping.get("format") != source.get("format")
        or mapping.get("difficulty") != source.get("difficulty")
        or not target
        or sum(m.get("report_chart_id") == target for m in mappings) != 1
    ):
        return None
    return overlay.get(target)


def inventory_delta(before, after):
    """Compare source identities, not title similarity or generated profile IDs."""

    def index(rows):
        result = {r["input_id"]: r for r in rows}
        if len(result) != len(rows):
            raise ValueError("Duplicate input identity")
        return result

    left, right = index(before), index(after)
    changes = {}
    for key in sorted(left.keys() & right.keys()):
        fields = [
            f
            for f in ("body_sha256", "source_song_id", "format", "difficulty", "identity_resolved")
            if left[key].get(f) != right[key].get(f)
        ]
        if fields:
            changes[key] = fields
    return {
        "added": sorted(right.keys() - left.keys()),
        "removed": sorted(left.keys() - right.keys()),
        "changed": changes,
    }


def review_benchmark(profiles, count=48):
    """Stratified deterministic queries; one source song family per partition.

    Explicit song_family overrides allow reviewed STD/DX equivalences. Titles are
    never used as implicit official identity mappings. Labels start unjudged.
    """
    if type(count) is not int or count < 4 or count % 4:
        raise ValueError("Benchmark count must be a positive multiple of four, at least four")
    buckets = defaultdict(list)
    for p in profiles:
        if p.get("format") not in {"STD", "DX"}:
            continue
        demands = p.get("demand", {})
        family = "slide" if (demands.get("slides", {}).get("occupancy") or 0) > 0.15 else "tap"
        try:
            level = float(str(p.get("level", "")).replace("+", ".5"))
            band = "under10" if level < 10 else "10to12" if level < 13 else "13plus"
        except ValueError:
            band = "unknown"
        buckets[(p["format"], p["difficulty"], band, family)].append(p)
    for bucket in buckets.values():
        bucket.sort(key=lambda p: hashlib.sha256(p["chart_id"].encode()).hexdigest())
    selected, used = [], set()
    while len(selected) < count:
        progressed = False
        for key in sorted(buckets):
            bucket = buckets[key]
            while bucket:
                candidate = bucket.pop(0)
                family = candidate.get("song_family", candidate["song_id"])
                if family not in used:
                    used.add(family)
                    selected.append(candidate)
                    progressed = True
                    break
            if len(selected) == count:
                break
        if not progressed:
            break
    queries = [
        {
            "chart_id": p["chart_id"],
            "source_hash": p["source_hash"],
            "song_family": p.get("song_family", p["song_id"]),
            "partition": "development" if i % 2 == 0 else "held_out",
            "review_status": "unjudged",
        }
        for i, p in enumerate(selected)
    ]
    result = {
        "version": BENCHMARK_VERSION,
        "requested": count,
        "queries": queries,
        "complete": len(queries) == count,
        "family_mapping_status": "source families; reviewed equivalences still required",
        "annotation_status": "independent labels pending",
    }
    return {**result, "benchmark_hash": content_hash(result)}
