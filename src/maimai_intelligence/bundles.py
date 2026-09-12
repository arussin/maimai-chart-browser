"""Versioned personal files shared by the browser and optional report adapter."""

from __future__ import annotations

from copy import deepcopy

from maimai_analyzer.wire import encode_pack

from . import __version__
from .chart_intelligence import player_overlay
from .explorer import validate_exploration_pack, validate_player_overlay
from .intelligence_recommendations import prepare_recommendations
from .snapshots import SCHEMA_VERSION, digest, normalize_snapshot, validate_snapshot

BUNDLE_FORMAT = "maimai-personal"


def catalog_reference(pack, version):
    checked = validate_exploration_pack(pack)
    if not isinstance(version, str) or not version.strip() or len(version) > 120:
        raise ValueError("An explicit catalog release version is required")
    return {"id": checked["catalog_id"], "version": version, "sha256": digest(encode_pack(checked))}


def validate_mapping(mapping, pack, reference):
    if mapping.get("schema_version") != SCHEMA_VERSION or mapping.get("catalog") != reference:
        raise ValueError("Chart mapping must name this exact catalog release")
    if mapping.get("provider") != "kamaitachi" or mapping.get("verification") != "reviewed":
        raise ValueError("Personal views require an explicitly reviewed provider mapping")
    if not mapping.get("source_ids") or not all(
        isinstance(x, str) and x for x in mapping["source_ids"]
    ):
        raise ValueError("Mapping review requires source identifiers")
    charts = mapping.get("charts")
    valid = {chart["chart_id"] for chart in pack["charts"]}
    if (
        not isinstance(charts, dict)
        or not charts
        or any(
            not isinstance(key, str) or not key or value not in valid
            for key, value in charts.items()
        )
        or len(set(charts.values())) != len(charts)
    ):
        raise ValueError("Mapping requires unique exact provider and catalog IDs")
    return charts


def prepare_player_bundle(pack, snapshot, mapping, *, catalog_version, settings=None):
    pack = validate_exploration_pack(pack)
    if pack.get("evaluation_only"):
        raise ValueError("Research catalogs cannot supply personal views")
    snapshot = validate_snapshot(snapshot)
    if snapshot.get("source", {}).get("provider") != "kamaitachi":
        raise ValueError("Personal preparation requires an explicit Kamaitachi snapshot")
    reference = catalog_reference(pack, catalog_version)
    chart_map = validate_mapping(mapping, pack, reference)
    options = deepcopy(settings or {})
    if set(options) - {"policy", "complete", "practice_pattern", "practice_goal", "quotas"}:
        raise ValueError("Unknown recommendation setting")
    overlay = player_overlay(
        snapshot["pbs"],
        chart_map,
        cutoff_ms=snapshot["cutoff_ms"],
        attempts=snapshot["attempts"],
        capture_ids=(snapshot["snapshot_id"],),
    )
    overlay["coverage"]["scope"] = snapshot["coverage"]["scope"]
    overlay["coverage"]["recent_only"] = True
    overlay = validate_player_overlay(overlay, report_cutoff_ms=snapshot["cutoff_ms"])
    recommendations = prepare_recommendations(pack, overlay, snapshot["pbs"], chart_map, **options)
    selected = {card["chart_id"] for card in recommendations["cards"]}
    summaries = [
        {key: chart.get(key, "") for key in ("chart_id", "title", "difficulty", "format", "level")}
        for chart in pack["charts"]
        if chart["chart_id"] in selected
    ]
    return {
        "format": BUNDLE_FORMAT,
        "schema_version": SCHEMA_VERSION,
        "catalog": reference,
        "snapshot_id": snapshot["snapshot_id"],
        "cutoff_ms": snapshot["cutoff_ms"],
        "engine_version": __version__,
        "settings": options,
        "mapping_sha256": digest(mapping),
        "overlay": overlay,
        "recommendations": recommendations,
        "chart_summaries": summaries,
    }


def export_report_bundle(
    report, after_pbs, mapping, pack, *, catalog_version, attempts=(), settings=None
):
    """Build from retained report inputs only; no acquisition or archive writes."""
    from .chart_intelligence import cutoff_from_report

    snapshot = normalize_snapshot(
        after_pbs,
        {"scores": list(attempts)},
        source={"provider": "kamaitachi", "kind": "retained-report"},
        cutoff_ms=cutoff_from_report(report),
    )
    return prepare_player_bundle(
        pack, snapshot, mapping, catalog_version=catalog_version, settings=settings
    )
