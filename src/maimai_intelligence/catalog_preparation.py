"""Prepare the structured public catalog independently of its HTML presentation."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from maimai_analyzer.patterns import pattern_registry

from .provider_mapping import default_mapping


@dataclass(frozen=True)
class PreparedCatalog:
    """Detached public data shared by catalog publication and the HTML assembler."""

    data: dict[str, Any]
    patterns: list[dict[str, Any]]


def prepare_catalog(
    package: dict[str, Any],
    catalog: list[dict[str, Any]],
    review: dict[str, Any],
    snippets: dict[str, Any],
    benchmark: dict[str, Any],
    navigation: dict[str, Any] | None = None,
    overview: dict[str, Any] | None = None,
    artwork: dict[str, Any] | None = None,
    mai_notes: dict[str, Any] | None = None,
    provider_mapping: dict[str, Any] | None = None,
    browser_metadata: dict[str, Any] | None = None,
    maishift_mapping: dict[str, Any] | None = None,
) -> PreparedCatalog:
    """Validate and assemble data once without rendering, parsing HTML, or writing files."""
    data = {
        "package": package,
        "catalog": catalog,
        "review": review,
        "snippets": snippets,
        "benchmark_hash": benchmark["benchmark_hash"],
        "navigation": navigation or {"charts": {}, "genres": [], "versions": []},
        "provider_mapping": provider_mapping
        if provider_mapping is not None
        else default_mapping(catalog),
    }
    if overview is not None:
        data["analysis"] = overview
    if artwork is not None:
        data["artwork"] = artwork
    if mai_notes is not None:
        data["mai_notes"] = mai_notes
    if maishift_mapping is not None:
        from .maishift_mapping import validate_mapping

        data["maishift_mapping"] = validate_mapping(maishift_mapping, catalog)
    if browser_metadata is not None:
        required = {"schema_version", "registry", "legacy_ids", "sources"}
        if not required <= set(browser_metadata) or set(browser_metadata) - required - {"coverage"}:
            raise ValueError("Unexpected browser registry metadata")
        data.update(browser_metadata)
        from .registry_catalog import validate_catalog

        validate_catalog(data)
    # Showing a public reference definition never assigns it to a catalog chart.
    patterns = [
        {
            key: entry[key]
            for key in (
                "pattern_id",
                "display_name",
                "family",
                "kind",
                "aliases",
                "definition",
                "name_origin",
                "definition_status",
                "counterexamples_and_limits",
                "source_ids",
            )
        }
        for entry in pattern_registry()["entries"]
    ]
    return PreparedCatalog(deepcopy(data), deepcopy(patterns))
