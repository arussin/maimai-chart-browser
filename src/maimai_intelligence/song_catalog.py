"""Bounded, locale-independent song inputs for the shared interactive workspace."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from .catalog_loading import project_chart, project_maishift_join, project_provider_join


def prepare_song_catalog(
    data: dict[str, Any], song_id: str, charts: list[dict[str, Any]]
) -> dict[str, Any]:
    """Project accepted public records; acquisition and recommendation work is never repeated."""
    ids = {chart["chart_id"] for chart in charts}
    if not ids or len(ids) != len(charts):
        raise ValueError("Song projection requires unique accepted chart identities")
    inventory = data.get("schema_version") == "maimai-browser-catalog-2"
    navigation = data.get("navigation", {})
    selected_navigation = {
        cid: deepcopy(row) for cid, row in navigation.get("charts", {}).items() if cid in ids
    }
    scopes = [
        *selected_navigation.values(),
        *(row for chart in charts for row in chart.get("regional", {}).values()),
    ]
    genres = {row.get("genre") for row in scopes}
    versions = {row.get("version") for row in scopes}
    result: dict[str, Any] = {
        "schema_version": data.get("schema_version", "maimai-browser-catalog-1"),
        "catalog": [project_chart(chart, inventory) for chart in charts],
        "navigation": {
            "charts": selected_navigation,
            "genres": [
                deepcopy(row) for row in navigation.get("genres", []) if row["id"] in genres
            ],
            "versions": [value for value in navigation.get("versions", []) if value in versions],
        },
        "snippets": {
            cid: deepcopy(row) for cid, row in data.get("snippets", {}).items() if cid in ids
        },
    }
    # Redirected songs may retain charts under their original canonical identities.
    source_songs = {chart["song_id"] for chart in charts}
    for key, project in (
        ("provider_mapping", project_provider_join),
        ("maishift_mapping", project_maishift_join),
    ):
        if key in data:
            mapping = data[key]
            result[key] = project(
                {
                    **mapping,
                    "charts": {
                        key: row
                        for key, row in mapping.get("charts", {}).items()
                        if row.get("chart_id") in ids
                    },
                }
            )
    if "mai_notes" in data:
        links = data["mai_notes"]
        result["mai_notes"] = {
            "version": links["version"],
            "charts": {
                cid: deepcopy(row) for cid, row in links.get("charts", {}).items() if cid in ids
            },
        }
    if "analysis" in data:
        analysis = data["analysis"]
        selected = {
            cid: deepcopy(row) for cid, row in analysis.get("charts", {}).items() if cid in ids
        }
        result["analysis"] = {
            **{
                key: deepcopy(value)
                for key, value in analysis.items()
                if key not in {"charts", "evidence_pool"}
            },
            "charts": selected,
        }
        if "evidence_pool" in analysis:
            pool: list[Any] = []
            positions: dict[int, int] = {}
            for row in selected.values():
                for tag in row["tags"]:
                    remapped = []
                    for position in tag[5]:
                        if type(position) is not int or not 0 <= position < len(
                            analysis["evidence_pool"]
                        ):
                            raise ValueError("Invalid accepted analysis evidence index")
                        if position not in positions:
                            positions[position] = len(pool)
                            pool.append(deepcopy(analysis["evidence_pool"][position]))
                        remapped.append(positions[position])
                    tag[5] = remapped
            result["analysis"]["evidence_pool"] = pool
    if "artwork" in data:
        art = data["artwork"]
        songs = {
            sid: deepcopy(row) for sid, row in art.get("songs", {}).items() if sid in source_songs
        }
        version_art = {
            key: value for key, value in art.get("versions", {}).items() if key in versions
        }
        paths = set(version_art.values())
        for row in songs.values():
            paths.add(row.get("path"))
            paths.update(value.get("path") for value in row.get("regions", {}).values())
        result["artwork"] = {
            "version": art["version"],
            "songs": songs,
            "versions": version_art,
            "assets": {
                path: deepcopy(row) for path, row in art.get("assets", {}).items() if path in paths
            },
        }
    return {
        "schema_version": "maimai-song-catalog-2",
        "song_id": song_id,
        "source_song_ids": sorted(source_songs),
        "data": result,
    }


def validate_song_binding(
    binding: dict[str, Any], catalog_sha: str, envelope: dict[str, Any]
) -> None:
    """Verify external membership independently of reusable song-content identity."""
    scope = binding.get("source_song_ids")
    if (
        binding.get("schema_version") != "maimai-song-binding-1"
        or binding.get("source_catalog_sha256") != catalog_sha
        or not isinstance(scope, list)
        or not 1 <= len(scope) <= 256
        or any(not isinstance(sid, str) or not sid for sid in scope)
        or len(scope) != len(set(scope))
        or binding.get("song_id") not in scope
        or envelope.get("schema_version") != "maimai-song-catalog-2"
        or envelope.get("song_id") != binding.get("song_id")
        or envelope.get("source_song_ids") != scope
        or not isinstance(envelope.get("data"), dict)
        or "source_catalog_sha256" in envelope["data"]
    ):
        raise ValueError("Invalid song catalog membership binding")


def validate_song_membership(envelope: dict[str, Any], catalog: dict[str, Any]) -> None:
    """Retained bindings cannot authorize foreign, partial or altered canonical charts."""
    scope = set(envelope["source_song_ids"])
    inventory = catalog.get("schema_version") == "maimai-browser-catalog-2"
    expected = {
        chart["chart_id"]: project_chart(chart, inventory)
        for chart in catalog["catalog"]
        if chart["song_id"] in scope
    }
    charts = envelope["data"].get("catalog", [])
    if (
        not isinstance(charts, list)
        or not charts
        or any(
            not isinstance(chart, dict) or not isinstance(chart.get("chart_id"), str)
            for chart in charts
        )
        or len(charts) != len(expected)
        or {chart["chart_id"]: chart for chart in charts} != expected
        or {chart["song_id"] for chart in charts} != scope
    ):
        raise ValueError("Song content differs from its canonical catalog membership")
