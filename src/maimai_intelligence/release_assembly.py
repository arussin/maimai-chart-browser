"""Verified local assembly of an explicit two-artifact composition plan.

No publishing, acquisition, or implicit fallback occurs here. A failed fresh
output remains incomplete for inspection; accepted inputs are never modified.
The completion receipt is private, atomic, and installed only after verification.
"""

from __future__ import annotations

import hashlib
import os
import stat
import tempfile
from collections.abc import Mapping
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

from .capacity_policy import DEFAULT_FILES, CapacityAuthority
from .public_routes import ROUTE_MODEL
from .publication_capacity import ReviewedCapacity
from .release_composition import (
    MAX_FILE_BYTES,
    ArtifactInventory,
    CompositionPlan,
    InventoryFile,
    RecoveryOverlay,
    RuntimeClosure,
    inventory_from_records,
    plan_release_composition,
)
from .release_transition import Fingerprint
from .serialization import digest
from .snapshots import atomic_json


@dataclass(frozen=True)
class AssemblyReceipt:
    plan_sha256: str
    output_inventory_sha256: str
    files: tuple[InventoryFile, ...]
    completion_path: str


def _reject_link(path: Path) -> os.stat_result:
    info = path.lstat()
    # Name-surrogate reparse points include Windows symlinks and junctions.
    # Ordinary cloud-file metadata is not a directory redirection.
    tag = getattr(info, "st_reparse_tag", 0)
    attributes = getattr(info, "st_file_attributes", 0)
    if stat.S_ISLNK(info.st_mode) or tag & 0x20000000 or (attributes & 0x400 and not tag):
        raise ValueError(f"Release paths must not contain filesystem redirects: {path}")
    return info


def _checked_path(value: Path) -> Path:
    path = Path(os.path.abspath(value))
    # Local assembly never needs device/UNC namespaces. Windows otherwise treats
    # several distinct spellings as the same directory before opening a file.
    if os.name == "nt" and (
        str(path).startswith("\\\\") or any(part.endswith((" ", ".")) for part in path.parts)
    ):
        raise ValueError("Use ordinary local paths without Windows namespace aliases")
    for part in (path, *path.parents):
        try:
            _reject_link(part)
        except FileNotFoundError:
            continue
    # Resolve existing ancestors (including Windows 8.3 names) before any overlap
    # decision. Reject redirects above first; resolving is not permission to use one.
    resolved = str(path.resolve())
    if os.name == "nt" and resolved.startswith("\\\\?\\"):
        resolved = resolved[4:]
    path = Path(resolved)
    for part in (path, *path.parents):
        try:
            _reject_link(part)
        except FileNotFoundError:
            continue
    return path


def _read_file(path: Path) -> bytes:
    _checked_path(path)
    if not stat.S_ISREG(_reject_link(path).st_mode):
        raise ValueError("Release assets must be ordinary files")
    with path.open("rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError("Release assets must be ordinary files")
        raw = stream.read(MAX_FILE_BYTES + 1)
    if len(raw) > MAX_FILE_BYTES:
        raise ValueError("Release asset exceeds the Pages per-file limit")
    _checked_path(path)
    return raw


def _fingerprint(raw: bytes) -> Fingerprint:
    return Fingerprint(len(raw), hashlib.sha256(raw).hexdigest())


def _inventory(root: Path) -> ArtifactInventory:
    root = _checked_path(root)
    if not root.is_dir():
        raise ValueError("Expected a complete artifact directory")
    pending = [root]
    records: dict[str, dict[str, object]] = {}
    while pending:
        directory = pending.pop()
        _checked_path(directory)
        for path in sorted(directory.iterdir()):
            info = _reject_link(path)
            if stat.S_ISDIR(info.st_mode):
                pending.append(path)
            else:
                fingerprint = _fingerprint(_read_file(path))
                records[path.relative_to(root).as_posix()] = {
                    "bytes": fingerprint.bytes,
                    "sha256": fingerprint.sha256,
                }
    return inventory_from_records(records)


def _records(files: tuple[InventoryFile, ...]) -> dict[str, dict[str, object]]:
    return {
        item.path: {"bytes": item.fingerprint.bytes, "sha256": item.fingerprint.sha256}
        for item in files
    }


def _overlap(first: Path, second: Path) -> bool:
    return first.is_relative_to(second) or second.is_relative_to(first)


def _write_file(raw: bytes, destination: Path, expected: Fingerprint) -> None:
    if len(raw) > MAX_FILE_BYTES:
        raise ValueError("Release asset exceeds the Pages per-file limit")
    if _fingerprint(raw) != expected:
        raise ValueError("Selected source bytes changed during assembly")
    _checked_path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    _checked_path(destination)
    with destination.open("xb") as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    _checked_path(destination)


def _copy_file(source: Path, destination: Path, expected: Fingerprint) -> None:
    _write_file(_read_file(source), destination, expected)


def _recovery_input(
    documents: Mapping[str, bytes] | None,
    evidence_sha256: str | None,
    candidate_inventory_sha256: str | None,
    baseline_inventory_sha256: str | None,
) -> tuple[dict[str, bytes], RecoveryOverlay | None]:
    if (
        documents is None
        and evidence_sha256 is None
        and candidate_inventory_sha256 is None
        and baseline_inventory_sha256 is None
    ):
        return {}, None
    if (
        not isinstance(documents, Mapping)
        or evidence_sha256 is None
        or candidate_inventory_sha256 is None
        or baseline_inventory_sha256 is None
    ):
        raise ValueError(
            "Recovery documents, evidence and both inventory bindings must be supplied together"
        )
    # Detach once before any writes; caller mapping changes cannot substitute
    # bytes between validation and writing. Values themselves must be immutable.
    detached = dict(documents)
    if any(type(raw) is not bytes for raw in detached.values()):
        raise ValueError("Recovery documents must contain immutable bytes")
    inventory = inventory_from_records(
        {
            path: {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
            for path, raw in detached.items()
        }
    )
    return detached, RecoveryOverlay(
        evidence_sha256,
        inventory,
        candidate_inventory_sha256,
        baseline_inventory_sha256,
        ROUTE_MODEL,
    )


def _complete(path: Path, payload: dict[str, object]) -> None:
    """Atomically install a new receipt, never overwrite a competing receipt."""
    _checked_path(path)
    descriptor, name = tempfile.mkstemp(prefix=".release-completion-", dir=path.parent)
    os.close(descriptor)
    staging = Path(name)
    try:
        atomic_json(staging, payload)
        _checked_path(path)
        # Both files share a directory/filesystem. Link creation is atomic and
        # fails if the destination appeared; replacing a receipt is forbidden.
        os.link(staging, path)
    finally:
        try:
            staging.unlink()
        except OSError:
            # A private temporary remnant does not invalidate a committed receipt
            # or replace the primary write failure. It is never a public asset.
            pass


def assemble_release(
    baseline: Path,
    candidate: Path,
    output: Path,
    *,
    plan: CompositionPlan,
    baseline_runtime: RuntimeClosure,
    candidate_runtime: RuntimeClosure,
    receipt_path: Path,
    recovery_documents: Mapping[str, bytes] | None = None,
    recovery_evidence_sha256: str | None = None,
    recovery_candidate_inventory_sha256: str | None = None,
    recovery_baseline_inventory_sha256: str | None = None,
    capacity: ReviewedCapacity | None = None,
) -> AssemblyReceipt:
    """Verify the complete plan and inputs, copy bounded files, then complete.

    Output must be a new directory. Existing output, including a failed attempt,
    is never removed or reused. This detects filesystem redirects and mutations
    at each boundary; callers must use ordinary exclusively controlled workspace
    directories, not paths being concurrently rearranged by another process.
    Optional recovery documents are detached before writing and must match their
    explicit candidate inventory and evidence bindings; no input is rewritten.
    """
    if not isinstance(plan, CompositionPlan):
        raise ValueError("Expected a validated composition plan")
    if capacity is not None and not isinstance(capacity, ReviewedCapacity):
        raise ValueError("Assembly requires a file-verified capacity review")
    authority = CapacityAuthority(**asdict(capacity)) if capacity is not None else None
    if plan.capacity != authority:
        raise ValueError("Capacity authority differs from the reviewed composition plan")
    documents, recovery = _recovery_input(
        recovery_documents,
        recovery_evidence_sha256,
        recovery_candidate_inventory_sha256,
        recovery_baseline_inventory_sha256,
    )
    baseline, candidate, output, receipt_path = (
        _checked_path(path) for path in (baseline, candidate, output, receipt_path)
    )
    roots = (baseline, candidate, output)
    if any(
        _overlap(first, second)
        for index, first in enumerate(roots)
        for second in roots[index + 1 :]
    ):
        raise ValueError("Artifact inputs and output must be separate and non-overlapping")
    if any(_overlap(receipt_path, root) for root in roots):
        raise ValueError("The completion receipt must stay outside public artifacts")
    if output.exists() or receipt_path.exists():
        raise ValueError("Use a fresh output directory and private receipt path")
    old, new = _inventory(baseline), _inventory(candidate)
    validated = plan_release_composition(
        old,
        new,
        target=plan.target,
        ownership=plan.files,
        baseline_runtime=baseline_runtime,
        candidate_runtime=candidate_runtime,
        recovery=recovery,
        max_files=plan.max_files,
        max_file_bytes=plan.max_file_bytes,
        capacity=authority,
        capacity_checked_at=datetime.now(UTC) if authority is not None else None,
    )
    if validated != plan:
        raise ValueError("Composition plan does not match verified inputs and runtime evidence")
    expected = ArtifactInventory(
        tuple(InventoryFile(item.path, item.expected) for item in plan.files)
    )
    if capacity is not None:
        capacity.require_current()
    output.parent.mkdir(parents=True, exist_ok=True)
    receipt_path.parent.mkdir(parents=True, exist_ok=True)
    _checked_path(output)
    _checked_path(receipt_path)
    output.mkdir()
    sources = {"baseline": baseline, "candidate": candidate}
    for item in plan.files:
        if item.owner == "recovery":
            _write_file(documents[item.path], output / item.path, item.expected)
        else:
            _copy_file(sources[item.owner] / item.path, output / item.path, item.expected)
    if _inventory(output) != expected:
        raise ValueError("Assembled output differs from its exact planned inventory")
    # Include files that were not selected from their source: a complete input
    # changed during preparation must not receive a successful-looking receipt.
    if _inventory(baseline) != old or _inventory(candidate) != new:
        raise ValueError("An input artifact changed during assembly")
    result = AssemblyReceipt(
        digest(asdict(plan)), digest(_records(expected.files)), expected.files, str(receipt_path)
    )
    if capacity is not None:
        capacity.require_current()
    _complete(
        receipt_path,
        {
            "schema_version": "maimai-release-assembly-1",
            "status": "complete",
            "scope": "local_file_assembly_only",
            "capacity": authority.receipt()
            if authority is not None
            else {"profile": "pages-default", "max_files": DEFAULT_FILES},
            "plan": asdict(plan),
            "plan_sha256": result.plan_sha256,
            "output_inventory_sha256": result.output_inventory_sha256,
            "files": _records(result.files),
        },
    )
    return result
