"""Explicit data products exchanged by corpus preparation stages."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal


@dataclass(frozen=True)
class SourceRefresh:
    additions: dict[str, Any]
    audit: dict[str, Any]


@dataclass(frozen=True)
class PreparedCorpus:
    descriptor: dict[str, Any]
    charts: list[dict[str, Any]]
    links: dict[str, Any]
    audit: dict[str, Any]
    package: Path


@dataclass(frozen=True)
class PreparedRegistry(PreparedCorpus):
    accepted: dict[str, Any]
    prepared: dict[str, Any]
    coverage_audit: dict[str, Any]
    refresh: SourceRefresh | None
    source_mode: Literal["accepted_registry"] = "accepted_registry"


@dataclass(frozen=True)
class PreparedLegacy(PreparedCorpus):
    source_mode: Literal["retained_snapshot"] = "retained_snapshot"


PreparedResult = PreparedRegistry | PreparedLegacy


@dataclass(frozen=True)
class RegistryContext:
    store: Path
    run: Path
    before: dict[str, Any]
    previous_browser: Path
    package: Path | None
    use_retained_analysis: bool
