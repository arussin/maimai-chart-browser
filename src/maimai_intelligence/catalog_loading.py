"""Derived browsing index and immutable detail shards for accepted public catalogs.

The original catalog remains available, byte for byte. This projection changes
delivery only: all ranking measurements and pattern coverage stay in the index.
"""

import hashlib
from copy import deepcopy

from .snapshots import MAX_BYTES, canonical

# Full immutable releases are delivered in 8 MiB parts. The startup projection
# remains bounded separately at 32 MiB and does not need provider coaching metadata.
MAX_CATALOG_BYTES = 64 * 1024 * 1024

PROFILE_FIELDS = {
    "version",
    "chart_id",
    "source_hash",
    "source_container_id",
    "song_id",
    "song_family",
    "title",
    "artist",
    "aliases",
    "difficulty",
    "format",
    "level",
    "demand",
}


def progressive_catalog(data, catalog_sha):
    if not data.get("catalog") or not all(isinstance(c, dict) for c in data["catalog"]):
        return None, {}
    index = deepcopy(data)
    if "provider_mapping" in index:
        index["provider_mapping"]["charts"] = {
            cid: {
                k: v
                for k, v in row.items()
                if k in {"chart_id", "source_hash", "format", "difficulty", "aliasOf"}
            }
            for cid, row in index["provider_mapping"]["charts"].items()
        }
    index["catalog"] = []
    index["snippets"] = {}
    index["detail_buckets"] = {}
    index["source_catalog_sha256"] = catalog_sha
    buckets, assets = {}, {}
    analysis = index.get("analysis", {})
    representation = analysis.get("representation", "")
    for chart in data["catalog"]:
        cid = chart["chart_id"]
        # At most 1,024 small shards per version, independent of source ordering.
        bucket = f"{int(hashlib.sha256(cid.encode()).hexdigest()[:3], 16) // 4:03x}"
        index["catalog"].append(
            {**{k: v for k, v in chart.items() if k in PROFILE_FIELDS}, "detail_bucket": bucket}
        )
        detail = buckets.setdefault(bucket, {"charts": {}, "snippets": {}})
        record = data.get("analysis", {}).get("charts", {}).get(cid)
        if record is not None:
            detail["charts"][cid] = record
            summary = analysis["charts"][cid]
            peaks = [s[3] for s in record["segments"] if s[3] is not None and s[4] > 0]
            summary["flow_peak"] = max(peaks) if peaks else None
            summary["segments"] = []
            evidence_start = 4 if representation in {"sparse-tags-2", "sparse-tags-3"} else 6
            summary["tags"] = [t[:evidence_start] + [[], []] for t in record["tags"]]
        if cid in data.get("snippets", {}):
            detail["snippets"][cid] = data["snippets"][cid]
        detail.setdefault("identities", {})[cid] = chart["source_hash"]
    for bucket, detail in buckets.items():
        raw = canonical(
            {"schema_version": "chart-details-1", "source_catalog_sha256": catalog_sha, **detail}
        )
        if len(raw) > 8 * 1024 * 1024:
            raise ValueError("Chart detail shard exceeds 8 MiB")
        digest = hashlib.sha256(raw).hexdigest()
        path = f"chart-details/{digest}.json"
        assets[path] = raw
        index["detail_buckets"][bucket] = {"path": path, "sha256": digest, "bytes": len(raw)}
    raw = canonical(index)
    if len(raw) > MAX_BYTES:
        raise ValueError("Browsing index exceeds 32 MiB")
    digest = hashlib.sha256(raw).hexdigest()
    path = f"catalog-index/{digest}.json"
    assets[path] = raw
    return {"path": path, "sha256": digest, "bytes": len(raw)}, assets
