"""Pure inventory comparison for explicitly declared observed browser requests.

Inputs use the existing FileRecord shape: {"bytes": int, "sha256": str}. This
module deliberately does not import inventory readers, infer runtime closure,
verify observations, or decide that a deployment or rollback is safe.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal

Direction = Literal["old_to_new", "new_to_fallback"]
Inventory = Mapping[str, Mapping[str, object]]


@dataclass(frozen=True)
class Fingerprint:
    bytes: int
    sha256: str


@dataclass(frozen=True)
class FileConflict:
    path: str
    expected: Fingerprint
    actual: Fingerprint


@dataclass(frozen=True)
class InventoryComparison:
    direction: Direction
    observations_sha256: str
    matched: tuple[str, ...]
    missing: tuple[str, ...]
    conflicts: tuple[FileConflict, ...]
    scope: Literal["declared_request_inventory_only"] = "declared_request_inventory_only"

    @property
    def status(self) -> Literal["inventory_match", "inventory_conflicts"]:
        return "inventory_conflicts" if self.missing or self.conflicts else "inventory_match"


def _digest(value: object) -> str:
    if not isinstance(value, str) or re.fullmatch(r"[a-f0-9]{64}", value) is None:
        raise ValueError("Expected a lowercase SHA-256 digest")
    return value


def _relative_path(value: object) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError("Expected a relative inventory path")
    # Callers must map observed URLs to exact decoded inventory names explicitly.
    # Do not normalize a URL, encoded separator, traversal or filesystem alias.
    if any(ord(character) < 32 or ord(character) == 127 for character in value) or any(
        character in value for character in '\\:%?#*"<>|'
    ):
        raise ValueError("Expected a decoded relative inventory path")
    if any(part in ("", ".", "..") or part.endswith((" ", ".")) for part in value.split("/")):
        raise ValueError("Expected a canonical relative inventory path")
    return value


def _records(values: Inventory) -> dict[str, Fingerprint]:
    if not isinstance(values, Mapping):
        raise ValueError("Expected an inventory mapping")
    result = {}
    for path, record in values.items():
        path = _relative_path(path)
        if not isinstance(record, Mapping) or set(record) != {"bytes", "sha256"}:
            raise ValueError("Expected FileRecord bytes and sha256 fields")
        size = record["bytes"]
        if type(size) is not int or size < 0:
            raise ValueError("Expected a nonnegative byte count")
        result[path] = Fingerprint(size, _digest(record["sha256"]))
    return result


def compare_request_inventory(
    requests: Inventory,
    target: Inventory,
    *,
    observations_sha256: str,
    direction: Direction,
) -> InventoryComparison:
    """Compare declared observations with a supplied complete target inventory.

    The caller must retain and verify the observation evidence and target
    inventory. A match covers only the supplied paths and byte expectations;
    it cannot establish closure, redirects, cache behavior, storage compatibility,
    live responses, account configuration or seamless switching.
    """
    if direction not in ("old_to_new", "new_to_fallback"):
        raise ValueError("Expected an old-to-new or new-to-fallback direction")
    evidence = _digest(observations_sha256)
    expected, actual = _records(requests), _records(target)
    if not expected:
        raise ValueError("A nonempty declared observed request set is required")
    matched, missing, conflicts = [], [], []
    for path, wanted in sorted(expected.items()):
        found = actual.get(path)
        if found is None:
            missing.append(path)
        elif found != wanted:
            conflicts.append(FileConflict(path, wanted, found))
        else:
            matched.append(path)
    return InventoryComparison(
        direction, evidence, tuple(matched), tuple(missing), tuple(conflicts)
    )
