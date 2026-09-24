"""Validated catalog documents shared by browser and public artifact preparation.

The detached model has one preparation owner and read-only consumers. Artifact
bytes are immutable; external historical bytes enter only through the decoder.
"""

from __future__ import annotations

import hashlib
import json
import re
from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from .catalog_loading import MAX_CATALOG_BYTES
from .mai_notes import validate_links
from .provider_mapping import integration_catalog, validate_mapping
from .serialization import MAX_BYTES, canonical


@dataclass(frozen=True)
class CatalogDocument:
    """One detached catalog model and its prepared public encodings."""

    data: dict[str, Any]
    raw: bytes
    entry: dict[str, Any]
    integration: bytes | None

    def require_binding(self, entry: dict[str, Any]) -> None:
        if self.entry != entry:
            raise ValueError("Prepared catalog does not match the release manifest")


def _validate_catalog(data: dict[str, Any]) -> None:
    if data.get("package", {}).get("status") != "research_preview":
        raise ValueError("Only nonpersonal research catalogs belong in this release")
    if set(data) - {
        "package",
        "catalog",
        "review",
        "snippets",
        "benchmark_hash",
        "navigation",
        "analysis",
        "artwork",
        "mai_notes",
        "provider_mapping",
        "maishift_mapping",
        "schema_version",
        "registry",
        "legacy_ids",
        "sources",
        "coverage",
    }:
        raise ValueError("Unexpected fields in public research catalog")
    if "schema_version" in data:
        from .registry_catalog import validate_catalog

        validate_catalog(data)
    elif "navigation" in data:
        from .registry_catalog import validate_genres

        validate_genres(data)
    if "mai_notes" in data:
        validate_links(data["mai_notes"], data["catalog"])
    if "provider_mapping" in data:
        validate_mapping(data["provider_mapping"], data["catalog"])
    if "maishift_mapping" in data:
        from .maishift_mapping import validate_mapping as validate_maishift

        validate_maishift(data["maishift_mapping"], data["catalog"])


def validate_catalog_reference(entry: dict[str, Any]) -> None:
    sha, version = entry.get("sha256"), entry.get("version")
    if (
        not isinstance(sha, str)
        or not re.fullmatch(r"[a-f0-9]{64}", sha)
        or entry.get("path") != f"catalogs/{sha}.json"
        or not isinstance(version, str)
        or not version
    ):
        raise ValueError("Invalid or duplicate research release identity")
    if "integration" in entry:
        ref = entry["integration"]
        if (
            not isinstance(ref, dict)
            or not isinstance(ref.get("sha256"), str)
            or not re.fullmatch(r"[a-f0-9]{64}", ref["sha256"])
            or ref.get("path") != f"integration/{ref['sha256']}.json"
        ):
            raise ValueError("Invalid integration catalog reference")


def prepare_catalog_document(data: dict[str, Any], version: str) -> CatalogDocument:
    """Take ownership of prepared data and calculate each public encoding once."""
    _validate_catalog(data)
    raw = canonical(data)
    if len(raw) > MAX_CATALOG_BYTES:
        raise ValueError("Full research catalog exceeds 64 MiB")
    sha = hashlib.sha256(raw).hexdigest()
    entry: dict[str, Any] = {"version": version, "sha256": sha, "path": f"catalogs/{sha}.json"}
    validate_catalog_reference(entry)
    if "schema_version" in data:
        entry["inventory_schema"] = data["schema_version"]
    integration = canonical(integration_catalog(data, version))
    if len(integration) > MAX_BYTES:
        raise ValueError("Integration catalog exceeds its byte budget")
    digest = hashlib.sha256(integration).hexdigest()
    entry["integration"] = {
        "path": f"integration/{digest}.json",
        "sha256": digest,
        "bytes": len(integration),
    }
    return CatalogDocument(data, raw, entry, integration)


def decode_catalog_document(
    entry: dict[str, Any], raw: bytes, integration: bytes | None
) -> CatalogDocument:
    """Adapt verified historical bytes into the same maintained publication path."""
    validate_catalog_reference(entry)
    if len(raw) > MAX_CATALOG_BYTES or hashlib.sha256(raw).hexdigest() != entry["sha256"]:
        raise ValueError("Accepted catalog integrity mismatch")
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("Expected a public catalog object")
    _validate_catalog(data)
    if "integration" in entry:
        ref = entry["integration"]
        if (
            integration is None
            or len(integration) > MAX_BYTES
            or len(integration) != ref.get("bytes")
            or hashlib.sha256(integration).hexdigest() != ref["sha256"]
        ):
            raise ValueError("Integration catalog integrity mismatch")
        if integration != canonical(integration_catalog(data, entry["version"])):
            raise ValueError("Integration data differs from public chart catalog")
    elif integration is not None:
        raise ValueError("Unexpected integration catalog")
    return CatalogDocument(data, raw, deepcopy(entry), integration)
