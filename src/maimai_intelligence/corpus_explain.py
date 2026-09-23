"""Pure, derived explanations of accepted identities and their recorded evidence."""

from __future__ import annotations

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


def explain_record(registry: Mapping[str, Any], identifier: str) -> dict[str, Any]:
    table = "songs" if identifier in registry["songs"] else "charts"
    if identifier not in registry[table]:
        raise ValueError("Unknown canonical identity")
    record = registry[table][identifier]
    song_id = identifier if table == "songs" else record["song_id"]
    observations = [
        row for row in registry["observations"].values() if row["subject_id"] == identifier
    ]
    mappings = [row for row in registry["mappings"].values() if row.get("subject_id") == identifier]
    references = source_references([record, observations, mappings])
    evidence = []
    for source_id in sorted(references):
        source = registry["sources"].get(source_id)
        if source is None:
            raise ValueError("Accepted record refers to missing source evidence")
        evidence.append(
            {"source_id": source_id, "assertion": source, "retained_bytes": "not_checked"}
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
        "charts": [
            row["chart_id"] for row in registry["charts"].values() if row["song_id"] == song_id
        ],
        "outstanding": [row for row in mappings if row.get("state") != "accepted"],
    }


def explain_registry(registry: Mapping[str, Any]) -> list[dict[str, Any]]:
    return [
        explain_record(registry, identity)
        for table in ("songs", "charts")
        for identity in sorted(registry[table])
    ]
