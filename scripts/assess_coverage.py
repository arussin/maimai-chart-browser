"""Assess a finite public catalog backlog without building or publishing a website."""

import argparse
import json
from pathlib import Path

from maimai_intelligence.coverage_assessment import assess as assess
from maimai_intelligence.snapshots import read_json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", required=True, type=Path)
    parser.add_argument("--published", required=True, type=Path, help="Retained public data JSON")
    parser.add_argument(
        "--store", required=True, type=Path, help="Private DevCache assessment store"
    )
    parser.add_argument("--artwork-root", action="append", default=[], type=Path)
    parser.add_argument(
        "--reviews",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "config/coverage-reviews.json",
    )
    parser.add_argument("--max-batches", type=int, default=10)
    args = parser.parse_args()
    result = assess(
        args.registry,
        args.published,
        args.store,
        roots=args.artwork_root,
        reviews=read_json(args.reviews),
        max_batches=args.max_batches,
    )
    print(
        json.dumps(
            {
                "complete": result["complete"],
                "added": len(result["coverage"]["artwork"]["added"]),
                "remaining": len(result["assessment"]["artwork_gaps"]),
            }
        )
    )


if __name__ == "__main__":
    main()
