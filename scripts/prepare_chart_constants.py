"""Restore retained decimal chart metadata in a fresh package, entirely offline."""

import argparse
import hashlib
import json
from pathlib import Path

from maimai_analyzer.catalog_navigation import build_navigation
from maimai_analyzer.dataset import SOURCE_LOCK
from maimai_intelligence.artwork import copy_artwork, validate_artwork
from maimai_intelligence.snapshots import atomic_json, read_json
from scripts.build_challenge_package import write


def prepare(package_directory, output):
    source, output = Path(package_directory).resolve(), Path(output).resolve()
    if source == output or output.is_relative_to(source) or source.is_relative_to(output):
        raise ValueError("Constant output must be separate from the retained package")
    if output.exists() and any(output.iterdir()):
        raise ValueError("Use a fresh package directory")
    package = read_json(source / "package.json")
    if package.get("source") != SOURCE_LOCK or package.get("status") != "research_preview":
        raise ValueError("Expected the pinned nonpersonal research package")
    retained = {}
    for entry in package["files"]:
        name = entry["path"]
        path = (source / name).resolve()
        if (
            Path(name).name != name
            or name == "package.json"
            or path.parent != source
            or name in retained
            or not 0 < entry["bytes"] <= 128 * 1024 * 1024
        ):
            raise ValueError("Invalid or duplicate package input")
        with path.open("rb") as stream:
            raw = stream.read(entry["bytes"] + 1)
        if len(raw) != entry["bytes"] or hashlib.sha256(raw).hexdigest() != entry["sha256"]:
            raise ValueError("Research input integrity mismatch")
        retained[name] = raw
    if not {"catalog.json", "navigation.json", "source-inventory.json"} <= retained.keys():
        raise ValueError("Retained source inventory is required for decimal constants")
    charts, rows, navigation = (
        json.loads(retained[name])
        for name in ("catalog.json", "source-inventory.json", "navigation.json")
    )
    # Reuse the exact source/body join. Preserve every existing navigation value.
    derived = build_navigation(charts, rows)
    for chart in charts:
        record = navigation["charts"].get(chart["chart_id"])
        if record is None or record.get("source_hash") != chart["source_hash"]:
            raise ValueError("Navigation identity differs from retained chart")
        record["chart_constant"] = derived["charts"][chart["chart_id"]]["chart_constant"]
    navigation["constant_basis"] = derived["constant_basis"]
    artwork = json.loads(retained["artwork.json"]) if "artwork.json" in retained else None
    if artwork is not None:
        validate_artwork(artwork, charts, navigation["versions"])
        copy_artwork(artwork, source, output)
    output.mkdir(parents=True, exist_ok=True)
    for name, raw in retained.items():
        if name != "navigation.json":
            with (output / name).open("xb") as stream:
                stream.write(raw)
    entry = write(output, "navigation.json", navigation)
    package["files"] = [entry if r["path"] == "navigation.json" else r for r in package["files"]]
    package["chart_constants"] = "retained-source-decimals-1"
    # A partial or interrupted output never advertises a completed package.
    atomic_json(output / "package.json", package)
    return {
        "charts": len(charts),
        "constants": sum(
            navigation["charts"][c["chart_id"]]["chart_constant"] is not None for c in charts
        ),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    print(json.dumps(prepare(args.package, args.output)))
