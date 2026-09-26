"""Typed corpus requests and source modes, independent of acquisition and rendering."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, TypedDict

from .corpus_failures import CorpusInputError
from .corpus_policy import CaptureRequest, SourceSelection


@dataclass(frozen=True)
class RetainedPackage:
    path: Path


@dataclass(frozen=True)
class ReviewedRevision:
    revision: str
    artwork_cache: Path


PackageSource = RetainedPackage | ReviewedRevision


@dataclass(frozen=True)
class RegistrySource:
    path: Path
    captures: CaptureRequest
    reviews: dict[str, Any] | None
    verify_legacy_identity: bool = False


@dataclass(frozen=True)
class LegacySource:
    snapshot: Path
    overrides: Path | None = None


@dataclass(frozen=True)
class CapacityRequest:
    review: Path
    sha256: str


class AttemptFields(TypedDict):
    """Historical receipt fields, serialized only at the attempt compatibility boundary."""

    previous_browser: Path
    previous_public: Path | None
    package: Path | None
    revision: str | None
    registry: Path | None
    artwork_cache: Path | None
    mai_notes_snapshot: Path | None
    overrides: Path | None
    offline: bool
    coverage_reviews: dict[str, Any] | None
    reassess_captured_policy: bool
    replay_sources: Path | None
    capacity_review: Path | None
    capacity_sha256: str | None
    player_maishift: bool | None


@dataclass(frozen=True)
class HistoricalInputs:
    """Only redundant historical bindings; never used to choose pipeline behavior."""

    snapshot: Path | None = None
    overrides: Path | None = None
    artwork_cache: Path | None = None
    legacy_reviews: dict[str, Any] | None = None


@dataclass(frozen=True)
class PreparationRequest:
    store: Path
    previous_browser: Path
    previous_public: Path | None
    source: RegistrySource | LegacySource
    package: PackageSource | None
    capacity: CapacityRequest | None
    player_maishift: bool | None
    predecessor: dict[str, str] | None
    historical: HistoricalInputs

    def __post_init__(self) -> None:
        if isinstance(self.source, LegacySource) and self.package is None:
            raise CorpusInputError("Legacy preparation requires a retained package or revision")

    def attempt_fields(self) -> AttemptFields:
        """Derive historical receipt fields from the actual executable request."""
        registry = self.source if isinstance(self.source, RegistrySource) else None
        legacy = self.source if isinstance(self.source, LegacySource) else None
        package = self.package
        return {
            "previous_browser": self.previous_browser,
            "previous_public": self.previous_public,
            "package": package.path if isinstance(package, RetainedPackage) else None,
            "revision": package.revision if isinstance(package, ReviewedRevision) else None,
            "registry": registry.path if registry else None,
            "artwork_cache": package.artwork_cache
            if isinstance(package, ReviewedRevision)
            else self.historical.artwork_cache,
            "mai_notes_snapshot": legacy.snapshot if legacy else self.historical.snapshot,
            "overrides": legacy.overrides if legacy else self.historical.overrides,
            "offline": registry.captures.offline if registry else True,
            "coverage_reviews": registry.reviews if registry else self.historical.legacy_reviews,
            "reassess_captured_policy": registry.captures.mode == "reassess" if registry else False,
            "replay_sources": Path(registry.captures.receipt)
            if registry and registry.captures.receipt is not None
            else None,
            "capacity_review": self.capacity.review if self.capacity else None,
            "capacity_sha256": self.capacity.sha256 if self.capacity else None,
            "player_maishift": self.player_maishift,
        }


def preparation_request(
    store: Path | str,
    previous_browser: Path | str,
    *,
    package: Path | str | None = None,
    revision: str | None = None,
    artwork_cache: Path | str | None = None,
    mai_notes_snapshot: Path | str | None = None,
    registry: Path | str | None = None,
    overrides: Path | str | None = None,
    offline: bool = True,
    replay_sources: Path | str | None = None,
    coverage_reviews: dict[str, Any] | None = None,
    reassess_captured_policy: bool = False,
    previous_public: Path | str | None = None,
    capacity_review: Path | str | None = None,
    capacity_sha256: str | None = None,
    player_maishift: bool | None = None,
    registry_seed: Path | str | None = None,
    predecessor: dict[str, str] | None = None,
) -> PreparationRequest:
    """Normalize CLI/legacy arguments once; downstream stages receive this request."""
    if player_maishift is not None and type(player_maishift) is not bool:
        raise CorpusInputError("Maishift capability must be an explicit boolean")
    if (capacity_review is None) != (capacity_sha256 is None):
        raise CorpusInputError(
            "Capacity review and its explicitly reviewed SHA256 are required together"
        )
    SourceSelection(
        package is not None,
        revision is not None,
        registry is not None,
        offline,
        replay_sources is not None,
        artwork_cache is not None,
        mai_notes_snapshot is not None,
    ).validate()
    if reassess_captured_policy and replay_sources is None:
        raise CorpusInputError("Captured reassessment requires a verified replay receipt")
    store, previous_browser = Path(store).resolve(), Path(previous_browser).resolve()
    for value in (
        previous_browser,
        previous_public,
        package,
        mai_notes_snapshot,
        registry,
        overrides,
        artwork_cache,
        registry_seed,
    ):
        if value is not None and store.is_relative_to(Path(value).resolve()):
            raise CorpusInputError("Update store must not replace or sit inside an input directory")

    def path(value: Path | str | None) -> Path | None:
        return Path(value).resolve() if value is not None else None

    package_path, snapshot, cache = path(package), path(mai_notes_snapshot), path(artwork_cache)
    selected: PackageSource | None = None
    if package_path is not None:
        selected = RetainedPackage(package_path)
    elif revision is not None:
        assert cache is not None
        selected = ReviewedRevision(revision, cache)
    source: RegistrySource | LegacySource
    registry_path = path(registry)
    seeded = registry_path is None and not offline
    if seeded:
        registry_path = path(registry_seed)
        if registry_path is None:
            raise CorpusInputError("Online preparation requires an explicit accepted registry")
    capture = CaptureRequest(
        "reassess"
        if reassess_captured_policy
        else "replay"
        if replay_sources is not None
        else "retained"
        if offline
        else "online",
        str(Path(replay_sources).resolve()) if replay_sources is not None else None,
    )
    if registry_path is not None:
        source = RegistrySource(registry_path, capture, coverage_reviews, seeded)
    else:
        assert snapshot is not None
        source = LegacySource(snapshot, path(overrides))
    capacity = None
    if capacity_review is not None:
        assert capacity_sha256 is not None
        capacity = CapacityRequest(Path(capacity_review).resolve(), capacity_sha256)
    return PreparationRequest(
        store,
        previous_browser,
        path(previous_public),
        source,
        selected,
        capacity,
        player_maishift,
        predecessor,
        HistoricalInputs(snapshot, path(overrides), cache, coverage_reviews),
    )
