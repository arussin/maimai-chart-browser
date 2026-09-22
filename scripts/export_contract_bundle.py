"""Export a reviewed exact-revision public contract bundle to an external artifact path."""

import argparse
import hashlib
from pathlib import Path

from maimai_intelligence.contract_bundle import canonical, export_bundle


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--revision", required=True, help="Full reviewed commit SHA")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    raw = canonical(export_bundle(args.source, args.revision))
    # Never overwrite a previously selected immutable release artifact.
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("xb") as stream:
        stream.write(raw)
    print(f"sha256={hashlib.sha256(raw).hexdigest()} bytes={len(raw)} revision={args.revision}")


if __name__ == "__main__":
    main()
