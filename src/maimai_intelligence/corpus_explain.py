"""Pure, derived explanations of accepted identities and their recorded evidence."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping
from typing import Any


def source_references(value: object) -> set[str]:
    found: set[str] = set()
    if isinstance(value, dict):
        for key, item in value.items():
            if key in {"snapshot_id", "availability_snapshot_id"} and isinstance(item, str):
                found.add(item)
            else:
                found.update(source_references(item))
    elif isinstance(value, (list, tuple)):
        for item in value:
            found.update(source_references(item))
    return found


def _explain_record(
    registry: Mapping[str, Any],
    identifier: str,
    observations: list[dict[str, Any]],
    mappings: list[dict[str, Any]],
    charts: list[str],
    *,
    compact: bool = False,
) -> dict[str, Any]:
    table = "songs" if identifier in registry["songs"] else "charts"
    if identifier not in registry[table]:
        raise ValueError("Unknown canonical identity")
    record = registry[table][identifier]
    song_id = identifier if table == "songs" else record["song_id"]
    references = source_references([record, observations, mappings])
    evidence = []
    for source_id in sorted(references):
        source = registry["sources"].get(source_id)
        if source is None:
            raise ValueError("Accepted record refers to missing source evidence")
        evidence.append(
            {
                "source_id": source_id,
                **({} if compact else {"assertion": source}),
                "retained_bytes": "not_checked",
            }
        )
    origin = {"kind": "source_assertions", "references": evidence}
    if not references:
        # Be explicit about older admissions without capture references. Never invent a source.
        origin = {"kind": "legacy_origin", "evidence": record["evidence"]}
    return {
        "id": identifier,
        "kind": table,
        "song_id": song_id,
        "record": record,
        "observations": observations,
        "mappings": mappings,
        "origin": origin,
        "artwork": registry["songs"][song_id].get("enrichment", {}).get("artwork", {}),
        "charts": charts,
        "outstanding": [row for row in mappings if row.get("state") != "accepted"],
    }


def explain_record(registry: Mapping[str, Any], identifier: str) -> dict[str, Any]:
    song_id = (
        identifier
        if identifier in registry["songs"]
        else registry["charts"].get(identifier, {}).get("song_id")
    )
    return _explain_record(
        registry,
        identifier,
        [row for row in registry["observations"].values() if row["subject_id"] == identifier],
        [row for row in registry["mappings"].values() if row.get("subject_id") == identifier],
        [row["chart_id"] for row in registry["charts"].values() if row["song_id"] == song_id],
    )


def explain_registry(registry: Mapping[str, Any], *, compact: bool = False) -> list[dict[str, Any]]:
    """Index each table once; explaining a corpus must not rescan it for every chart."""
    observations: dict[str, list[dict[str, Any]]] = defaultdict(list)
    mappings: dict[str, list[dict[str, Any]]] = defaultdict(list)
    charts: dict[str, list[str]] = defaultdict(list)
    for row in registry["observations"].values():
        observations[row["subject_id"]].append(row)
    for row in registry["mappings"].values():
        mappings[row.get("subject_id", "")].append(row)
    for row in registry["charts"].values():
        charts[row["song_id"]].append(row["chart_id"])
    return [
        _explain_record(
            registry,
            identity,
            observations[identity],
            mappings[identity],
            charts[identity if table == "songs" else registry[table][identity]["song_id"]],
            compact=compact,
        )
        for table in ("songs", "charts")
        for identity in sorted(registry[table])
    ]
