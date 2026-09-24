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
from dataclasses import dataclass
from typing import Literal

from .release_transition import Fingerprint

Owner = Literal["baseline", "candidate"]
Target = Literal["candidate", "recovery"]
MAX_FILES = 20_000
MAX_FILE_BYTES = 25 * 1024 * 1024


@dataclass(frozen=True)
class InventoryFile:
    path: str
    fingerprint: Fingerprint


@dataclass(frozen=True)
class ArtifactInventory:
    files: tuple[InventoryFile, ...]


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


def plan_release_composition(
    baseline: ArtifactInventory,
    candidate: ArtifactInventory,
    *,
    target: Target,
    ownership: tuple[PathOwnership, ...],
    baseline_runtime: RuntimeClosure,
    candidate_runtime: RuntimeClosure,
    max_files: int = MAX_FILES,
    max_file_bytes: int = MAX_FILE_BYTES,
) -> CompositionPlan:
    """Require a reviewed owner for every path; never infer a conflict winner.

    Both inputs' path sets are retained. Byte changes, generated manifest merges
    and new resource names belong to preparation before this selection step.
    Every declared runtime file must survive with exact bytes in either target.
    Capacity can be tightened for testing, never raised without a separate paid
    profile implementation and entitlement gate.
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
    if not isinstance(ownership, tuple):
        raise ValueError("Ownership decisions must be an immutable tuple")
    selections: dict[str, PathOwnership] = {}
    for choice in ownership:
        if not isinstance(choice, PathOwnership):
            raise ValueError("Expected an explicit path ownership decision")
        path = _path(choice.path)
        if path in selections:
            raise ValueError(f"Duplicate ownership decision: {path}")
        if choice.owner not in ("baseline", "candidate"):
            raise ValueError("Expected baseline or candidate ownership")
        if not isinstance(choice.reason, str) or not choice.reason.strip():
            raise ValueError("Each ownership decision requires a reason")
        expected = _fingerprint(choice.expected)
        source = old if choice.owner == "baseline" else new
        if source.get(path) != expected:
            raise ValueError(f"Selected file does not match its source artifact: {path}")
        selections[path] = PathOwnership(path, choice.owner, expected, choice.reason)
    if selections.keys() != all_paths:
        raise ValueError("Every input path requires exactly one explicit ownership decision")
    document_owner = "candidate" if target == "candidate" else "baseline"
    if selections["index.html"].owner != document_owner:
        raise ValueError("The document owner must match the composition target")
    for closure in closures:
        for path, expected in closure.items():
            if selections[path].expected != expected:
                raise ValueError(f"Selected bytes violate an immutable runtime closure: {path}")
    if type(max_files) is not int or not 1 <= max_files <= MAX_FILES:
        raise ValueError("File capacity must stay within the default Pages profile")
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
    )
