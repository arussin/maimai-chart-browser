"""Select accepted transcription revisions without changing registry membership."""

import argparse
import hashlib
import json
from pathlib import Path

from maimai_intelligence.registry import (
    read_registry,
    select_transcription,
    source_mapping,
    write_registry,
)
from maimai_intelligence.research_package import read_package
from maimai_intelligence.snapshots import atomic_json, read_json
from scripts.analyze_simai_corpus import _identity


def prepare(registry, package, review, output):
    value = read_registry(registry)
    descriptor, files = read_package(package)
    decisions = read_json(review)
    raw = (Path(package) / "package.json").read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if (
        decisions.get("schema_version") != "transcription-selection-1"
        or decisions.get("package_sha256") != digest
    ):
        raise ValueError("Transcription selection review belongs to another package")
    source_id = "neskol-package:" + digest
    value["sources"][source_id] = {
        "provider": "neskol",
        **descriptor["source"],
        "sha256": digest,
        "acquisition": "verified_retained_package",
        "bytes": len(raw),
    }
    rows = {r["input_id"]: r for r in json.loads(files["source-inventory.json"])}
    outcomes = {r["input_id"]: r for r in json.loads(files.get("outcomes.json", b"[]"))}
    for input_id, decision in decisions["selections"].items():
        row = rows[input_id]
        if row.get("body_sha256") != decision.get("body_sha256") or row.get(
            "source_raw_sha256"
        ) != decision.get("container_sha256"):
            raise ValueError("Transcription review does not match exact input hashes")
        cid = decision.get("chart_id") or source_mapping(value, "neskol-input", input_id)
        if not cid:
            raise ValueError("New transcription needs an explicit accepted registry chart mapping")
        outcome = outcomes.get(input_id, {}).get("status")
        state = (
            "available"
            if outcome == "analyzed"
            else "unsupported"
            if outcome == "unsupported"
            else "not_prepared"
        )
        select_transcription(
            value,
            cid,
            row,
            snapshot_id=source_id,
            evidence=decision.get("evidence"),
            legacy_chart_id=_identity(row)["chart_id"],
            analysis_state=state,
        )
    write_registry(value, output)
    atomic_json(Path(output).with_name(Path(output).name + "-selection.json"), decisions)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("registry", "package", "review", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    print(prepare(**vars(parser.parse_args())))


if __name__ == "__main__":
    main()
