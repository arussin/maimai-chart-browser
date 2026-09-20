"""Rebuild search aliases from accepted identities without fetching or publishing."""

import argparse
import json
from pathlib import Path

from maimai_intelligence.multilingual_search import compile_aliases
from maimai_intelligence.registry import read_registry
from maimai_intelligence.snapshots import atomic_json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--check", action="store_true", help="Fail if the committed artifact is stale"
    )
    args = parser.parse_args()
    result = compile_aliases(read_registry(args.registry))
    if args.check:
        if json.loads(args.output.read_text("utf-8")) != result:
            raise SystemExit(
                "Search aliases are stale; regenerate with these arguments without --check"
            )
        if result["coverage"]["unused_override_ids"]:
            raise SystemExit("Search overrides refer to songs outside the accepted registry")
        if result["coverage"]["missing_aliases"]:
            raise SystemExit(
                "Some songs need Chinese or Hangul search aliases; see coverage.review_queue"
            )
    else:
        atomic_json(args.output, result)
    print(
        f"Prepared {result['coverage']['songs']} songs; "
        f"{len(result['coverage']['review_queue'])} need pronunciation/alias review"
    )


if __name__ == "__main__":
    main()
