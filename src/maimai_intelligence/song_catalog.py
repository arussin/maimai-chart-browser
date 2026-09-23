"""Bounded, locale-independent song inputs for the shared interactive workspace."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from .catalog_loading import project_chart, project_maishift_join, project_provider_join


def prepare_song_catalog(
    data: dict[str, Any], song_id: str, charts: list[dict[str, Any]], catalog_sha: str
) -> dict[str, Any]:
    """Project accepted public records; acquisition and recommendation work is never repeated."""
    ids = {chart["chart_id"] for chart in charts}
    if not ids or len(ids) != len(charts):
        raise ValueError("Song projection requires unique accepted chart identities")
    inventory = data.get("schema_version") == "maimai-browser-catalog-2"
    navigation = data.get("navigation", {})
    result: dict[str, Any] = {
        "schema_version": data.get("schema_version", "maimai-browser-catalog-1"),
        "source_catalog_sha256": catalog_sha,
        "catalog": [project_chart(chart, inventory) for chart in charts],
        "navigation": {
            "charts": {
                cid: deepcopy(row)
                for cid, row in navigation.get("charts", {}).items()
                if cid in ids
            },
            "genres": deepcopy(navigation.get("genres", [])),
            "versions": deepcopy(navigation.get("versions", [])),
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
        paths = set(art.get("versions", {}).values())
        for row in songs.values():
            paths.add(row.get("path"))
            paths.update(value.get("path") for value in row.get("regions", {}).values())
        result["artwork"] = {
            "version": art["version"],
            "songs": songs,
            "versions": deepcopy(art.get("versions", {})),
            "assets": {
                path: deepcopy(row) for path, row in art.get("assets", {}).items() if path in paths
            },
        }
    return {
        "schema_version": "maimai-song-catalog-1",
        "song_id": song_id,
        "source_song_ids": sorted(source_songs),
        "data": result,
    }
