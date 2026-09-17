"""Capture both regional SEGA inventories into a fresh private source directory."""

import argparse
from pathlib import Path

from maimai_intelligence.official_inventory import capture
from maimai_intelligence.snapshots import atomic_json


def prepare(output):
    root = Path(output).resolve()
    if root.exists() and any(root.iterdir()):
        raise ValueError("Use a fresh capture directory; retain previous observations")
    # A failed required input never leaves a complete capture marker.
    captures = {region: capture(region) for region in ("JP", "INTL")}
    root.mkdir(parents=True, exist_ok=True)
    for region, (raw, source) in captures.items():
        name = "sega-" + region.lower()
        (root / (name + ".json")).write_bytes(raw)
        atomic_json(root / (name + "-metadata.json"), source)
    atomic_json(
        root / "complete.json",
        {
            "schema_version": "official-capture-1",
            "sources": {r: s for r, (_, s) in captures.items()},
        },
    )
    return root


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    print(prepare(**vars(parser.parse_args())))
