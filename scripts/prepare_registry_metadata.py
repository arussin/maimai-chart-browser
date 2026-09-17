"""Prepare and review retained metadata captures, without network requests or new chart IDs."""

import argparse
import json
from pathlib import Path

from maimai_intelligence.metadata_waterfall import MAX_BYTES, accept, propose
from maimai_intelligence.registry import read_registry, write_registry
from maimai_intelligence.snapshots import atomic_json, read_json


def prepare(registry, captures, output, review=None):
    root = Path(captures).resolve()
    config = read_json(root / "captures.json")
    inputs, failed = [], list(config.get("failures", []))
    for entry in config["sources"]:
        raw_path, meta_path = [(root / entry[k]).resolve() for k in ("raw", "metadata")]
        if raw_path.parent != root or meta_path.parent != root:
            raise ValueError("Capture file leaves its directory")
        try:
            with raw_path.open("rb") as stream:
                raw = stream.read(MAX_BYTES + 1)
            inputs.append((entry["provider"], raw, read_json(meta_path)))
        except (OSError, ValueError) as error:
            failed.append({"provider": entry["provider"], "reason": str(error)})
    value = read_registry(registry)
    proposal = propose(value, inputs)
    proposal["failures"].extend(failed)
    if review is None:
        atomic_json(Path(output) / "proposals.json", proposal)
        return {"claims": len(proposal["claims"]), "failures": proposal["failures"]}
    accepted = accept(value, proposal, read_json(review))
    write_registry(accepted, output)
    return {"accepted_observations": len(accepted["observations"]) - len(value["observations"])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("registry", "captures", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--review", type=Path)
    print(json.dumps(prepare(**vars(parser.parse_args()))))


if __name__ == "__main__":
    main()
