"""Read prepared analysis from receipt-bound public artifacts without recalculation."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from .catalog_document import decode_catalog_document
from .corpus_attempts import input_inventory
from .public_release import read_public_catalog_inputs
from .registry_catalog import validate_catalog
from .research_overview import validate_overview
from .research_package import read_package
from .serialization import digest
from .snapshots import MAX_BYTES, read_json


def unavailable_analysis(reason: str) -> dict[str, Any]:
    return {"status": "unavailable", "reason": reason, "charts": {}}


def _prepared_charts(
    data: dict[str, Any], registry: dict[str, Any] | None
) -> dict[str, dict[str, Any]]:
    overview = data.get("analysis")
    if overview is not None:
        validate_overview(overview, data["catalog"])
    records = overview["charts"] if overview is not None else {}
    charts = {}
    for chart in data["catalog"]:
        identity = chart["chart_id"]
        if identity in charts:
            raise ValueError("Duplicate prepared analysis chart identity")
        selected = None
        if registry is not None:
            accepted = registry["charts"].get(identity)
            if accepted is None or accepted["song_id"] != chart.get("song_id"):
                raise ValueError("Prepared analysis chart differs from accepted registry")
            selected = accepted.get("transcription")
            if (
                chart.get("source_hash")
                and selected
                and (selected.get("source_hash") != chart["source_hash"])
            ):
                raise ValueError("Prepared analysis source differs from selected transcription")
        profile = (
            {key: chart[key] for key in ("version", "source_hash", "demand") if key in chart}
            if chart.get("source_hash")
            else {}
        )
        charts[identity] = {
            "status": "available" if "demand" in profile or identity in records else "unavailable",
            "capabilities": chart.get("capabilities", {}),
            "profile": profile,
            "overview": records.get(identity),
            "origin": {
                "kind": "selected_transcription" if selected else "legacy_prepared_artifact",
                "transcription": selected,
                "capture_bytes": "not_checked",
            },
        }
    return charts


def _read_analysis_catalog(
    run: Path, receipt: dict[str, Any], registry: dict[str, Any] | None
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Bind the inspected public document and registry to the original receipt."""
    public = (run / "public").resolve()
    if not public.is_relative_to(run.resolve()):
        raise ValueError("Prepared analysis assets leave the candidate")
    with (public / "manifest.json").open("rb") as stream:
        raw = stream.read(MAX_BYTES + 1)
    expected = receipt.get("files", {}).get("manifest.json")
    if len(raw) > MAX_BYTES or expected != {
        "bytes": len(raw),
        "sha256": hashlib.sha256(raw).hexdigest(),
    }:
        raise ValueError("Prepared analysis manifest differs from candidate receipt")
    manifest = json.loads(raw)
    if (
        not isinstance(manifest, dict)
        or not isinstance(manifest.get("releases"), list)
        or not all(isinstance(row, dict) for row in manifest["releases"])
    ):
        raise ValueError("Invalid prepared analysis manifest")
    version = receipt.get("catalog_version")
    matches = [row for row in manifest["releases"] if row.get("version") == version]
    if len(matches) != 1 or manifest.get("default") != version:
        raise ValueError("Prepared analysis catalog differs from candidate receipt")
    entry = matches[0]
    raw, integration = read_public_catalog_inputs(public, entry)
    data = decode_catalog_document(entry, raw, integration).data
    if registry is not None and receipt.get("registry_files") != input_inventory(run / "registry"):
        raise ValueError("Prepared analysis registry differs from candidate receipt")
    return entry, data


def inspect_prepared_analysis(
    run: Path,
    registry: dict[str, Any] | None,
    *,
    package: Path | None = None,
    package_sha256: str | None = None,
) -> dict[str, Any]:
    """Verify only the inspected catalog/evidence binding, not release readiness.

    Without a completion receipt, only a complete, verified run-owned package
    bound to the inspected registry exposes preparation-only analysis. Other
    interrupted output remains unavailable. A completed receipt whose selected
    artifacts changed is an integrity failure. Historical producer code and
    source capture bytes are not reverified.
    """
    if package is not None:
        return inspect_package_analysis(package, registry, descriptor_sha256=package_sha256)
    if package_sha256 is not None:
        raise ValueError("A package descriptor hash requires an explicit package")
    receipt_path = run / "ready.json"
    if not receipt_path.is_file():
        owned_package = run / "package"
        if (owned_package / "package.json").is_file() and registry is not None:
            return inspect_package_analysis(owned_package, registry, owned=True)
        return unavailable_analysis("candidate_not_complete")
    receipt = read_json(receipt_path)
    if not isinstance(receipt, dict):
        raise ValueError("Invalid candidate receipt for prepared analysis")
    if "version" not in receipt:
        return unavailable_analysis("legacy_receipt_without_analysis_binding")
    if receipt.get("version") != "catalog-update-1" or receipt.get("status") != "ready":
        raise ValueError("Invalid candidate receipt for prepared analysis")
    if not isinstance(receipt.get("files"), dict):
        raise ValueError("Invalid prepared analysis file inventory")
    if "registry_files" in receipt and registry is None:
        raise ValueError("Prepared analysis registry is missing")
    entry, data = _read_analysis_catalog(run, receipt, registry)
    return _analysis_view(
        data,
        registry,
        "receipt_bound_catalog_and_registry" if registry is not None else "receipt_bound_catalog",
        {key: entry[key] for key in ("version", "path", "sha256")},
    )


def _analysis_view(
    data: dict[str, Any],
    registry: dict[str, Any] | None,
    verification: str,
    catalog: dict[str, Any],
) -> dict[str, Any]:
    charts = _prepared_charts(data, registry)
    overview = data.get("analysis", {})
    package = data["package"]
    recipe = {
        key: package[key]
        for key in (
            "implementation",
            "source_files",
            "builder_hash",
            "profile_version",
            "overview_version",
        )
        if key in package
    }
    return {
        "status": "available",
        "verification": verification,
        "catalog": catalog,
        "metadata": {key: value for key, value in overview.items() if key != "charts"},
        "preparation": {
            "kind": "recorded_preparation" if recipe else "legacy_prepared_artifact",
            "recipe": recipe or "not_recorded",
            "source": package.get("source"),
            "capture_bytes": "not_checked",
        },
        "charts": charts,
    }


def inspect_package_analysis(
    package: Path,
    registry: dict[str, Any] | None,
    *,
    descriptor_sha256: str | None = None,
    owned: bool = False,
) -> dict[str, Any]:
    """Inspect a verified preparation even when rendering/publication has failed."""
    if registry is None:
        raise ValueError("Prepared package inspection requires its accepted registry")
    if not owned and (
        not isinstance(descriptor_sha256, str)
        or re.fullmatch(r"[a-f0-9]{64}", descriptor_sha256) is None
    ):
        raise ValueError("External prepared package requires its retained descriptor SHA256")
    with (package / "package.json").open("rb") as stream:
        raw = stream.read(MAX_BYTES + 1)
    observed = hashlib.sha256(raw).hexdigest()
    if len(raw) > MAX_BYTES or (descriptor_sha256 is not None and observed != descriptor_sha256):
        raise ValueError("Prepared package descriptor differs from retained evidence")
    descriptor, retained = read_package(package)
    if descriptor != json.loads(raw):
        raise ValueError("Prepared package descriptor changed during inspection")
    binding = {"schema_version": registry["schema_version"], "sha256": digest(registry)}
    metadata = json.loads(retained.get("browser-metadata.json", b"{}"))
    if (
        not isinstance(metadata, dict)
        or descriptor.get("registry") != binding
        or metadata.get("registry") != binding
    ):
        raise ValueError("Prepared package differs from accepted registry")
    data = {
        **metadata,
        "package": descriptor,
        "catalog": json.loads(retained["catalog.json"]),
        "navigation": json.loads(retained["navigation.json"]),
        **(
            {"analysis": json.loads(retained["analysis.json"])}
            if "analysis.json" in retained
            else {}
        ),
    }
    validate_catalog(data)
    result = _analysis_view(
        data,
        registry,
        "run_preparation_package_and_registry" if owned else "retained_package_and_registry",
        {"path": "catalog.json", "sha256": hashlib.sha256(retained["catalog.json"]).hexdigest()},
    )
    result["package"] = {"descriptor_sha256": observed, "publication_readiness": "not_verified"}
    return result
