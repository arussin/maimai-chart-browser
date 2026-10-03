"""Hash-checked local research package copying for owner preparation tools."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from maimai_analyzer.dataset import SOURCE_LOCK

from .artwork import copy_artwork, validate_artwork
from .snapshots import MAX_BYTES, atomic_json, read_json


def read_package(directory: Path | str) -> tuple[dict[str, Any], dict[str, bytes]]:
    root = Path(directory).resolve()
    package = read_json(root / "package.json")
    if package.get("source") != SOURCE_LOCK or package.get("status") != "research_preview":
        raise ValueError("Expected the reviewed source pin and nonpersonal research package")
    retained = {}
    for entry in package["files"]:
        name = entry["path"]
        path = (root / name).resolve()
        if (
            Path(name).name != name
            or not name.endswith(".json")
            or name == "package.json"
            or path.parent != root
            or name in retained
            or type(entry["bytes"]) is not int
            or not 0 < entry["bytes"] <= MAX_BYTES
        ):
            raise ValueError("Invalid research package path or size")
        with path.open("rb") as stream:
            raw = stream.read(entry["bytes"] + 1)
        if len(raw) != entry["bytes"] or hashlib.sha256(raw).hexdigest() != entry["sha256"]:
            raise ValueError("Research package integrity mismatch")
        retained[name] = raw
    if not {"catalog.json", "navigation.json", "source-inventory.json"} <= retained.keys():
        raise ValueError("Incomplete research package")
    return package, retained


def extend_package(source: Path | str, output: Path | str, additions: dict[str, Any]) -> Path:
    source, output = Path(source).resolve(), Path(output).resolve()
    if source == output or source.is_relative_to(output) or output.is_relative_to(source):
        raise ValueError("Use a separate package destination")
    if output.exists() and any(output.iterdir()):
        raise ValueError("Use a fresh package destination")
    package, retained = read_package(source)
    charts = json.loads(retained["catalog.json"])
    if "artwork.json" in retained:
        artwork = json.loads(retained["artwork.json"])
        validate_artwork(artwork, charts, json.loads(retained["navigation.json"])["versions"])
        copy_artwork(artwork, source, output)
    from .snapshots import canonical

    retained.update({name: canonical(data) for name, data in additions.items()})
    output.mkdir(parents=True, exist_ok=True)
    entries = []
    for name, raw in retained.items():
        if Path(name).name != name or not name.endswith(".json") or name == "package.json":
            raise ValueError("Invalid package addition")
        with (output / name).open("xb") as stream:
            stream.write(raw)
        entries.append({"path": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})
    atomic_json(output / "package.json", {**package, "files": entries})
    return output
