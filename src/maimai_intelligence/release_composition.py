"""Pure, explicit ownership for two retained static release artifacts.

This plans file selection only. Callers verify actual bytes and observation
receipts before writing anything. Declared runtime closures are not discovered
here, and a plan does not establish route, storage, cache or rollout safety.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Literal

from .capacity_policy import DEFAULT_FILES, PAID_FILES, CapacityAuthority
from .release_transition import Fingerprint
from .route_model import PublicRouteModel

Owner = Literal["baseline", "candidate", "recovery"]
Target = Literal["candidate", "recovery"]
MAX_FILES = DEFAULT_FILES
MAX_FILE_BYTES = 25 * 1024 * 1024


@dataclass(frozen=True)
class InventoryFile:
    path: str
    fingerprint: Fingerprint


@dataclass(frozen=True)
class ArtifactInventory:
    files: tuple[InventoryFile, ...]


@dataclass(frozen=True)
class RecoveryOverlay:
    """Prepared finite route documents bound to their generation evidence."""

    evidence_sha256: str
    inventory: ArtifactInventory
    candidate_inventory_sha256: str
    baseline_inventory_sha256: str
    route_model: PublicRouteModel | None = None


@dataclass(frozen=True)
class RuntimeClosure:
    """Exact required bytes at their existing URLs, bound to caller evidence."""

    observations_sha256: str
    files: tuple[InventoryFile, ...]


@dataclass(frozen=True)
class PathOwnership:
    path: str
    owner: Owner
    expected: Fingerprint
    reason: str


@dataclass(frozen=True)
class Collision:
    path: str
    baseline: Fingerprint
    candidate: Fingerprint
    owner: Owner

    @property
    def differs(self) -> bool:
        return self.baseline != self.candidate


@dataclass(frozen=True)
class CompositionPlan:
    target: Target
    baseline_inventory_sha256: str
    candidate_inventory_sha256: str
    baseline_observations_sha256: str
    candidate_observations_sha256: str
    files: tuple[PathOwnership, ...]
    collisions: tuple[Collision, ...]
    max_files: int
    max_file_bytes: int
    total_bytes: int
    scope: Literal["declared_file_composition_only"] = "declared_file_composition_only"
    recovery_inventory_sha256: str | None = None
    recovery_evidence_sha256: str | None = None
    capacity: CapacityAuthority | None = None

    @property
    def file_count(self) -> int:
        return len(self.files)


def _digest(value: object) -> str:
    if not isinstance(value, str) or re.fullmatch(r"[a-f0-9]{64}", value) is None:
        raise ValueError("Expected a lowercase SHA-256 digest")
    return value


def _path(value: object) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError("Expected a relative file path")
    if any(ord(c) < 32 or ord(c) == 127 for c in value) or any(c in value for c in '\\:%?#*"<>|'):
        raise ValueError("Expected a decoded file path without aliases")
    parts = value.split("/")
    if any(part in ("", ".", "..") or part.endswith((" ", ".")) for part in parts):
        raise ValueError("Expected a canonical relative file path")
    # Windows normalizes the stem before checking DOS device names, including
    # superscript digits. Keep this portable rule free of filesystem imports.
    if any(
        re.fullmatch(
            r"CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³]",
            part.partition(".")[0].rstrip(" ").upper(),
        )
        for part in parts
    ):
        raise ValueError("Windows device names cannot enter a release")
    return value


def _fingerprint(value: Fingerprint) -> Fingerprint:
    if not isinstance(value, Fingerprint) or type(value.bytes) is not int or value.bytes < 0:
        raise ValueError("Expected a nonnegative integer byte count")
    return Fingerprint(value.bytes, _digest(value.sha256))


def _index(files: tuple[InventoryFile, ...]) -> dict[str, Fingerprint]:
    if not isinstance(files, tuple):
        raise ValueError("Inventories and closures must be immutable tuples")
    records: dict[str, Fingerprint] = {}
    aliases: set[str] = set()
    directories: dict[str, str] = {}
    for file in files:
        if not isinstance(file, InventoryFile):
            raise ValueError("Expected an inventory file")
        path = _path(file.path)
        alias = path.casefold()
        if alias in aliases:
            raise ValueError("Duplicate or case-aliased release path")
        aliases.add(alias)
        parts = path.split("/")
        for end in range(1, len(parts)):
            prefix = "/".join(parts[:end])
            folded = prefix.casefold()
            previous = directories.setdefault(folded, prefix)
            if previous != prefix:
                raise ValueError("Directory prefixes require one exact spelling")
        records[path] = _fingerprint(file.fingerprint)
    for path in aliases:
        parts = path.split("/")
        if any("/".join(parts[:end]) in aliases for end in range(1, len(parts))):
            raise ValueError("A release file is also used as a directory")
    return records


def inventory_from_records(records: Mapping[str, Mapping[str, object]]) -> ArtifactInventory:
    """Detach the existing FileRecord mapping shape into immutable inputs."""
    if not isinstance(records, Mapping):
        raise ValueError("Expected an inventory mapping")
    files = []
    for path, record in records.items():
        if not isinstance(record, Mapping) or set(record) != {"bytes", "sha256"}:
            raise ValueError("Expected FileRecord bytes and sha256 fields")
        size = record["bytes"]
        if type(size) is not int:
            raise ValueError("Expected an integer byte count")
        files.append(InventoryFile(_path(path), Fingerprint(size, _digest(record["sha256"]))))
    indexed = _index(tuple(files))
    return ArtifactInventory(tuple(InventoryFile(path, indexed[path]) for path in sorted(indexed)))


def _inventory_id(records: Mapping[str, Fingerprint]) -> str:
    value = {
        path: {"bytes": record.bytes, "sha256": record.sha256} for path, record in records.items()
    }
    raw = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    return hashlib.sha256(raw).hexdigest()


def artifact_inventory_sha256(inventory: ArtifactInventory) -> str:
    """Validate and bind every artifact path, byte count and content hash."""
    if not isinstance(inventory, ArtifactInventory):
        raise ValueError("Expected an immutable artifact inventory")
    return _inventory_id(_index(inventory.files))


def _closure(closure: RuntimeClosure, source: Mapping[str, Fingerprint]) -> dict[str, Fingerprint]:
    if not isinstance(closure, RuntimeClosure):
        raise ValueError("Expected an evidence-bound runtime closure")
    _digest(closure.observations_sha256)
    records = _index(closure.files)
    if not records:
        raise ValueError("A runtime closure cannot be empty")
    for path, expected in records.items():
        if source.get(path) != expected:
            raise ValueError(f"Runtime closure does not match its source artifact: {path}")
    return records


def _recovery_documents(
    recovery: RecoveryOverlay | None,
    target: Target,
    baseline: Mapping[str, Fingerprint],
    candidate: Mapping[str, Fingerprint],
) -> dict[str, Fingerprint]:
    if recovery is None:
        return {}
    if target != "recovery":
        raise ValueError("Recovery documents require the recovery target")
    if not isinstance(recovery, RecoveryOverlay) or not isinstance(
        recovery.inventory, ArtifactInventory
    ):
        raise ValueError("Expected an immutable recovery overlay")
    _digest(recovery.evidence_sha256)
    if _digest(recovery.candidate_inventory_sha256) != _inventory_id(candidate):
        raise ValueError("Recovery documents do not match their candidate inventory")
    if _digest(recovery.baseline_inventory_sha256) != _inventory_id(baseline):
        raise ValueError("Recovery documents do not match their baseline inventory")
    if not isinstance(recovery.route_model, PublicRouteModel):
        raise ValueError("Recovery requires its validated public route model")
    records = _index(recovery.inventory.files)
    routes = {path for path in candidate if recovery.route_model.parse_filename(path) is not None}
    if not records or records.keys() != routes:
        raise ValueError("Recovery documents must replace exactly every candidate public route")
    return records


def plan_release_composition(
    baseline: ArtifactInventory,
    candidate: ArtifactInventory,
    *,
    target: Target,
    ownership: tuple[PathOwnership, ...],
    baseline_runtime: RuntimeClosure,
    candidate_runtime: RuntimeClosure,
    recovery: RecoveryOverlay | None = None,
    max_files: int | None = None,
    max_file_bytes: int = MAX_FILE_BYTES,
    capacity: CapacityAuthority | None = None,
    capacity_checked_at: datetime | None = None,
) -> CompositionPlan:
    """Require a reviewed owner for every path; never infer a conflict winner.

    Both inputs' path sets are retained. A recovery overlay may replace the exact
    finite candidate song/version document set, never scripts or configuration.
    Other byte changes and generated manifests belong to earlier preparation.
    Every declared runtime file must survive with exact bytes in either target.
    The default profile stays at 20,000 files. A detached reviewed authority and
    explicit current instant select the fixed paid profile; numeric limits can
    only tighten that selection. Assembly rechecks the same authority and clock.
    """
    if target not in ("candidate", "recovery"):
        raise ValueError("Expected candidate or recovery target")
    if not isinstance(baseline, ArtifactInventory) or not isinstance(candidate, ArtifactInventory):
        raise ValueError("Expected two immutable artifact inventories")
    old, new = _index(baseline.files), _index(candidate.files)
    if "index.html" not in old or "index.html" not in new:
        raise ValueError("Both complete artifacts must include index.html")
    all_paths = old.keys() | new.keys()
    # Validate cross-artifact aliases too, without selecting bytes implicitly.
    _index(tuple(InventoryFile(path, Fingerprint(0, "0" * 64)) for path in all_paths))
    closures = (_closure(baseline_runtime, old), _closure(candidate_runtime, new))
    recovery_files = _recovery_documents(recovery, target, old, new)
    sources = {"baseline": old, "candidate": new, "recovery": recovery_files}
    if not isinstance(ownership, tuple):
        raise ValueError("Ownership decisions must be an immutable tuple")
    selections: dict[str, PathOwnership] = {}
    for choice in ownership:
        if not isinstance(choice, PathOwnership):
            raise ValueError("Expected an explicit path ownership decision")
        path = _path(choice.path)
        if path in selections:
            raise ValueError(f"Duplicate ownership decision: {path}")
        if choice.owner not in ("baseline", "candidate", "recovery"):
            raise ValueError("Expected baseline, candidate or recovery ownership")
        if not isinstance(choice.reason, str) or not choice.reason.strip():
            raise ValueError("Each ownership decision requires a reason")
        expected = _fingerprint(choice.expected)
        source = sources[choice.owner]
        if source.get(path) != expected:
            raise ValueError(f"Selected file does not match its source artifact: {path}")
        selections[path] = PathOwnership(path, choice.owner, expected, choice.reason)
    if selections.keys() != all_paths:
        raise ValueError("Every input path requires exactly one explicit ownership decision")
    if {
        path for path, choice in selections.items() if choice.owner == "recovery"
    } != recovery_files.keys():
        raise ValueError("Every recovery document requires explicit recovery ownership")
    document_owner = "candidate" if target == "candidate" else "baseline"
    if selections["index.html"].owner != document_owner:
        raise ValueError("The document owner must match the composition target")
    for closure in closures:
        for path, expected in closure.items():
            if selections[path].expected != expected:
                raise ValueError(f"Selected bytes violate an immutable runtime closure: {path}")
    authority = None
    if capacity is not None:
        if not isinstance(capacity, CapacityAuthority):
            raise ValueError("Paid capacity requires a reviewed capacity authority")
        authority = CapacityAuthority(**asdict(capacity))
        if capacity_checked_at is None:
            raise ValueError("Paid capacity requires an explicit check time")
        authority.require_current(capacity_checked_at)
    elif capacity_checked_at is not None:
        raise ValueError("A capacity check time requires its reviewed authority")
    profile_limit = PAID_FILES if authority is not None else MAX_FILES
    max_files = profile_limit if max_files is None else max_files
    if type(max_files) is not int or not 1 <= max_files <= profile_limit:
        raise ValueError("File capacity must stay within the reviewed Pages profile")
    if type(max_file_bytes) is not int or not 1 <= max_file_bytes <= MAX_FILE_BYTES:
        raise ValueError("Asset capacity must stay within the Pages per-file limit")
    if len(selections) > max_files:
        raise ValueError("Composition exceeds file capacity")
    if any(choice.expected.bytes > max_file_bytes for choice in selections.values()):
        raise ValueError("Composition exceeds per-file capacity")
    collisions = tuple(
        Collision(path, old[path], new[path], selections[path].owner)
        for path in sorted(old.keys() & new.keys())
    )
    return CompositionPlan(
        target,
        _inventory_id(old),
        _inventory_id(new),
        baseline_runtime.observations_sha256,
        candidate_runtime.observations_sha256,
        tuple(selections[path] for path in sorted(selections)),
        collisions,
        max_files,
        max_file_bytes,
        sum(choice.expected.bytes for choice in selections.values()),
        recovery_inventory_sha256=_inventory_id(recovery_files) if recovery is not None else None,
        recovery_evidence_sha256=recovery.evidence_sha256 if recovery is not None else None,
        capacity=authority,
    )
