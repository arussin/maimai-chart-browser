"""Prepare exact chart pattern/Flow mappings from retained, verified inputs only."""

import argparse
import hashlib
import json
from collections import Counter
from importlib.resources import files
from pathlib import Path

from maimai_analyzer.contracts import content_hash
from maimai_analyzer.dataset import SOURCE_LOCK
from maimai_intelligence.research_overview import (
    chart_overview,
    overview_package,
    validate_overview,
)
from maimai_intelligence.snapshots import atomic_json, read_json
from scripts.build_challenge_package import parse_row, write


def build(source, package_path, output):
    source, package_path, output = map(lambda p: Path(p).resolve(), (source, package_path, output))
    if output == package_path or output.is_relative_to(source) or source.is_relative_to(output):
        raise ValueError("Overview output must be separate from retained inputs")
    package = read_json(package_path / "package.json")
    if package["source"] != SOURCE_LOCK or package["status"] != "research_preview":
        raise ValueError("Expected pinned research source")
    loaded = {}
    for entry in package["files"]:
        path = (package_path / entry["path"]).resolve()
        if path.parent != package_path:
            raise ValueError("Expected public package file")
        raw = path.read_bytes()
        if len(raw) != entry["bytes"] or hashlib.sha256(raw).hexdigest() != entry["sha256"]:
            raise ValueError("Research input integrity mismatch")
        loaded[entry["path"]] = json.loads(raw)
    rows = {r["input_id"]: r for r in loaded["source-inventory.json"]}
    implementation = {
        name: hashlib.sha256(files("maimai_analyzer").joinpath(name).read_bytes()).hexdigest()
        for name in (
            "core.py",
            "flow.py",
            "patterns.py",
            "contracts.py",
            "simai_subset.py",
            "simai_notation.py",
            "simai_timing.py",
            "rational.py",
            "pattern_registry.seed.json",
        )
    }
    implementation["overview"] = hashlib.sha256(
        files("maimai_intelligence").joinpath("research_overview.py").read_bytes()
    ).hexdigest()
    records, memo, work = {}, {}, Counter()
    for index, item in enumerate(loaded["catalog.json"], 1):
        row = rows[item["input_id"]]
        key = content_hash({"row": row, "implementation": implementation})
        cache = output / "overview-cache" / (key + ".json")
        if cache.exists():
            envelope = read_json(cache)
            record = envelope["record"]
            if content_hash(record) != envelope["hash"]:
                raise ValueError("Overview cache integrity mismatch")
        else:
            chart, _ = parse_row(source, row, memo, work)
            if any(chart[k] != item[k] for k in ("chart_id", "format", "difficulty", "revision")):
                raise ValueError("Parsed chart identity differs from catalog")
            record = chart_overview(chart)
            atomic_json(cache, {"record": record, "hash": content_hash(record)})
        records[item["chart_id"]] = record
        if index % 100 == 0:
            print(json.dumps({"prepared": index, "total": len(loaded["catalog.json"])}), flush=True)
    overview = validate_overview(overview_package(records), loaded["catalog.json"])
    overview["implementation"] = implementation
    # A failed run writes caches only. Publish the new package after all charts finish.
    output.mkdir(parents=True, exist_ok=True)
    entries = [
        write(output, name, value) for name, value in loaded.items() if name != "analysis.json"
    ]
    entries.append(write(output, "analysis.json", overview))
    write(
        output,
        "package.json",
        {**package, "files": entries, "overview_version": overview["version"]},
    )
    return {"charts": len(records), "bytes": entries[-1]["bytes"]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("package")
    parser.add_argument("output")
    args = parser.parse_args()
    print(json.dumps(build(args.source, args.package, args.output)))
