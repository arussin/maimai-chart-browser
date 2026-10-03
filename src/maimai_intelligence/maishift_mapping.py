"""Reviewed provider identities; raw source metadata must still agree at import."""

from __future__ import annotations

import re
from typing import Any

SCHEMA = "maishift-mapping-1"
IDENTITY_FIELDS = ("title", "artist", "format", "difficulty")


def validate_mapping(mapping: dict[str, Any], catalog: list[dict[str, Any]]) -> dict[str, Any]:
    if (
        mapping.get("schema_version") != SCHEMA
        or mapping.get("provider") != "maishift"
        or mapping.get("game") != "maimaidx"
        or not isinstance(mapping.get("charts"), dict)
        or set(mapping) != {"schema_version", "provider", "game", "charts"}
    ):
        raise ValueError("Unsupported Maishift mapping")
    charts = {c["chart_id"]: c for c in catalog}
    targets = set()
    for pid, row in mapping["charts"].items():
        match = re.fullmatch(r"maishift:(intl|jp):([1-9][0-9]{0,15})", pid)
        source = row.get("expected_source", {})
        target = charts.get(row.get("chart_id"))
        if (
            not match
            or not target
            or row.get("acceptance_basis") != "reviewed"
            or set(row) != {"chart_id", "expected_source", "acceptance_basis", "snapshot_id"}
            or set(source) != set(IDENTITY_FIELDS)
            or not all(isinstance(source.get(k), str) for k in IDENTITY_FIELDS)
            or any(source[k] != target[k] for k in ("format", "difficulty"))
            or (match[1], target["chart_id"]) in targets
        ):
            raise ValueError("Invalid or ambiguous Maishift mapping")
        targets.add((match[1], target["chart_id"]))
    return mapping


def match_chart(player, chart, row, target):
    """Return no match on changed metadata; keep the original portable record."""
    if not row or not target or player.get("provider") != "maishift":
        return False
    identity = player.get("key", "").split(":")
    source = row.get("expected_source", {})
    return (
        len(identity) == 4
        and identity[:2] == ["maishift", "maimaidx"]
        and identity[2] in {"intl", "jp"}
        and re.fullmatch(r"maishift:" + identity[2] + r":[1-9][0-9]{0,15}", chart["chartID"])
        is not None
        and row.get("acceptance_basis") == "reviewed"
        and row.get("chart_id") == target.get("chart_id")
        and all(
            isinstance(source.get(k), str) and source[k] == chart.get(k) for k in IDENTITY_FIELDS
        )
        and all(source.get(k) == target.get(k) for k in ("format", "difficulty"))
    )
