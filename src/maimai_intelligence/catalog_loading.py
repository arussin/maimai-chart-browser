"""Pure browser projections and their legacy/shared wire encodings.

The accepted catalog is never mutated. Projection is performed once; serializers
consume structured data without parsing one another's generated JSON.
"""

from __future__ import annotations

import hashlib
from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from .catalog_schema import CHART_FIELDS, PROFILE_FIELDS
from .serialization import MAX_BYTES, canonical

MAX_CATALOG_BYTES = 64 * 1024 * 1024
DETAIL_BYTES = 8 * 1024 * 1024

# Public presentation inputs. Acquisition diagnostics stay in the accepted catalog.
INDEX_FIELDS = {
    "package",
    "review",
    "benchmark_hash",
    "navigation",
    "artwork",
    "mai_notes",
    "schema_version",
    "registry",
    "legacy_ids",
    "sources",
    "coverage",
}
PROVIDER_JOIN_FIELDS = {
    "chart_id",
    "source_hash",
    "format",
    "difficulty",
    "aliasOf",
    "acceptance_basis",
}
REGIONAL_FIELDS = {"listing", "level", "genre", "version"}
REGIONAL_METADATA_FIELDS = {"title", "artist", "catcode", "version"}


@dataclass(frozen=True)
class CatalogProjection:
    """Detached, owned dictionaries; freezing does not imply deep immutability."""

    index: dict[str, Any]
    details: dict[str, dict[str, Any]]
    catalog_sha: str
    inventory: bool


def _select(value, fields):
    return {key: deepcopy(item) for key, item in value.items() if key in fields}


def _chart_row(chart, fields, inventory):
    row = _select(chart, fields - {"regional"})
    if inventory:
        row["regional"] = {
            region: {
                **_select(entry, REGIONAL_FIELDS),
                "metadata": _select(entry.get("metadata") or {}, REGIONAL_METADATA_FIELDS),
            }
            for region, entry in chart.get("regional", {}).items()
        }
    return row


def _analysis_summary(record, representation):
    summary = {
        key: deepcopy(value) for key, value in record.items() if key not in {"segments", "tags"}
    }
    peaks = [
        segment[3] for segment in record["segments"] if segment[3] is not None and segment[4] > 0
    ]
    evidence_start = 4 if representation in {"sparse-tags-2", "sparse-tags-3"} else 6
    summary.update(
        flow_peak=max(peaks) if peaks else None,
        segments=[],
        tags=[deepcopy(tag[:evidence_start]) + [[], []] for tag in record["tags"]],
    )
    return summary


def _provider_join(mapping):
    return {
        **{
            key: deepcopy(value)
            for key, value in mapping.items()
            if key not in {"charts", "unmatched"}
        },
        "charts": {
            key: _select(row, PROVIDER_JOIN_FIELDS) for key, row in mapping["charts"].items()
        },
    }


def _maishift_join(mapping):
    return {
        **{key: deepcopy(value) for key, value in mapping.items() if key != "charts"},
        "charts": {
            key: {field: deepcopy(value) for field, value in row.items() if field != "snapshot_id"}
            for key, row in mapping.get("charts", {}).items()
        },
    }


def prepare_catalog_projection(data, catalog_sha) -> CatalogProjection | None:
    """Select browser inputs and detail records, with no encoding or I/O."""
    if not data.get("catalog") or not all(isinstance(chart, dict) for chart in data["catalog"]):
        return None
    inventory = data.get("schema_version") == "maimai-browser-catalog-2"
    fields = PROFILE_FIELDS
    if inventory:
        fields = CHART_FIELDS - {"legacy_identity", "transcription", "capabilities", "input_id"}
    index = _select(data, INDEX_FIELDS)
    if inventory:
        index["index_schema_version"] = "catalog-index-2"
    if "maishift_mapping" in data:
        index["maishift_mapping"] = _maishift_join(data["maishift_mapping"])
    if "provider_mapping" in data:
        index["provider_mapping"] = _provider_join(data["provider_mapping"])
    index.update(catalog=[], snippets={}, detail_buckets={}, source_catalog_sha256=catalog_sha)
    original_analysis = data.get("analysis", {})
    representation = original_analysis.get("representation", "")
    if "analysis" in data:
        chart_ids = {chart["chart_id"] for chart in data["catalog"]}
        index["analysis"] = {
            **{key: deepcopy(value) for key, value in original_analysis.items() if key != "charts"},
            "charts": {
                cid: _analysis_summary(record, representation)
                if cid in chart_ids
                else deepcopy(record)
                for cid, record in original_analysis.get("charts", {}).items()
            },
        }
    details = {}
    for chart in data["catalog"]:
        cid = chart["chart_id"]
        record = original_analysis.get("charts", {}).get(cid)
        row = _chart_row(chart, fields, inventory)
        if inventory and record is None and cid not in data.get("snippets", {}):
            index["catalog"].append(row)
            continue
        bucket = f"{int(hashlib.sha256(cid.encode()).hexdigest()[:3], 16) // 4:03x}"
        index["catalog"].append({**row, "detail_bucket": bucket})
        detail = details.setdefault(bucket, {"charts": {}, "snippets": {}, "identities": {}})
        if record is not None:
            detail["charts"][cid] = deepcopy(record)
        if cid in data.get("snippets", {}):
            detail["snippets"][cid] = deepcopy(data["snippets"][cid])
        detail["identities"][cid] = chart.get("source_hash")
    return CatalogProjection(index, details, catalog_sha, inventory)


def _asset(raw, prefix, limit, assets):
    if len(raw) > limit:
        raise ValueError(f"{prefix} asset exceeds {limit // (1024 * 1024)} MiB")
    digest = hashlib.sha256(raw).hexdigest()
    path = f"{prefix}/{digest}.json"
    assets[path] = raw
    return {"path": path, "sha256": digest, "bytes": len(raw)}


def encode_catalog_projection(projection: CatalogProjection | None, *, shared=False):
    """Encode either supported wire format directly from the same projection."""
    if projection is None:
        return None, {}
    assets, references = {}, {}
    schema = "chart-details-2" if projection.inventory else "chart-details-1"
    for bucket, detail in projection.details.items():
        envelope = {"schema_version": "chart-details-shared-1" if shared else schema, **detail}
        if not shared:
            envelope["source_catalog_sha256"] = projection.catalog_sha
        references[bucket] = _asset(canonical(envelope), "chart-details", DETAIL_BYTES, assets)
    index = {**projection.index, "detail_buckets": references}
    if shared:
        index["index_schema_version"] = "catalog-index-shared-1"
    reference = _asset(canonical(index), "catalog-index", MAX_BYTES, assets)
    return reference, assets


def progressive_catalog(data, catalog_sha):
    return encode_catalog_projection(prepare_catalog_projection(data, catalog_sha))


def shared_catalog(data, catalog_sha, *, legacy=None):
    """Compatibility entry point; the old optimization hint is no longer needed.

    Accepted structured data remains authoritative, including when an older caller
    supplies its already serialized legacy bundle. No generated JSON is read back.
    """
    return encode_catalog_projection(prepare_catalog_projection(data, catalog_sha), shared=True)
