"""Review and apply two complete retained official captures; no deployment or body acquisition."""

import argparse
import json
from pathlib import Path

from maimai_intelligence.official_inventory import (
    MAX_CAPTURE,
    apply_snapshot,
    coverage,
    propose,
    snapshot,
)
from maimai_intelligence.registry import merge_songs, read_registry, write_registry
from maimai_intelligence.snapshots import atomic_json, read_json


def prepare(registry, captures, output, *, decisions=None):
    if set(captures) != {"JP", "INTL"}:
        raise ValueError("Both regional official captures are required")
    value = read_registry(registry)
    sources, proposals = {}, {}
    # Validate both complete inputs before preparing any candidate identity changes.
    for region, pair in captures.items():
        raw_path, metadata_path = map(Path, pair)
        with raw_path.open("rb") as stream:
            raw = stream.read(MAX_CAPTURE + 1)
        metadata = read_json(metadata_path)
        source = snapshot(raw, region, metadata)
        sources[region] = raw, source
        proposals[region] = propose(value, raw, region)
    if decisions is None:
        atomic_json(Path(output) / "proposals.json", proposals)
        return proposals
    review = read_json(decisions)
    if review.get("schema_version") != "official-reconciliation-1":
        raise ValueError("Unsupported official reconciliation review")
    for merge in review.get("song_merges", []):
        merge_songs(value, merge["source"], merge["target"], evidence=merge["evidence"])
    for region, (raw, source) in sources.items():
        entry = review["regions"][region]
        if entry["source_sha256"] != source["sha256"]:
            raise ValueError("Review belongs to a different official capture")
        value = apply_snapshot(
            value, raw, source, entry["decisions"], count_review=entry.get("count_review")
        )
    write_registry(value, output)
    atomic_json(Path(output).with_name(Path(output).name + "-coverage.json"), coverage(value))
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--decisions", type=Path)
    for region in ("jp", "intl"):
        parser.add_argument("--" + region + "-capture", type=Path, required=True)
        parser.add_argument("--" + region + "-metadata", type=Path, required=True)
    args = vars(parser.parse_args())
    captures = {
        region.upper(): (args.pop(region + "_capture"), args.pop(region + "_metadata"))
        for region in ("jp", "intl")
    }
    result = prepare(captures=captures, **args)
    print(
        json.dumps(
            coverage(result) if "schema_version" in result else {"status": "review_required"}
        )
    )


if __name__ == "__main__":
    main()
