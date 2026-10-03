"""Pure supplemental claim selection, retaining primary metrics and latest evidence."""

from __future__ import annotations

from typing import Any

from .metadata_policy import FIELDS, number


def eligible_claims(
    projection: dict[str, Any],
    proposal: dict[str, Any],
    observations: dict[str, Any],
    sources: dict[str, Any],
) -> list[dict[str, Any]]:
    wanted = {
        c["chart_id"]: {
            f
            for f in FIELDS
            if number(projection["navigation"]["charts"][c["chart_id"]].get(f), f) is None
            or f in projection["navigation"]["charts"][c["chart_id"]].get("metric_sources", {})
        }
        for c in projection["catalog"]
    }
    latest = {}
    for observation in sorted(
        observations.values(),
        key=lambda o: (o.get("observed_at", ""), o.get("observation_id", "")),
    ):
        if observation.get("policy") == "metadata-waterfall-1":
            scope = (
                observation["subject_id"],
                observation["field"],
                observation["region"],
                observation.get("release"),
                sources[observation["snapshot_id"]]["provider"],
            )
            latest[scope] = observation["value"]
    existing = {(*scope[:4], metric, scope[4]) for scope, metric in latest.items()}
    claims = [
        c
        for c in proposal["claims"]
        if c["field"] in wanted[c["subject_id"]]
        and (
            c["subject_id"],
            c["field"],
            c["region"],
            c.get("release"),
            c["value"],
            proposal["sources"][c["snapshot_id"]]["provider"],
        )
        not in existing
    ]
    return claims
