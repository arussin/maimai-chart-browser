"""Explicit local-only analyzer CLI; no report, account or acquisition imports."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .contracts import (
    MAX_INPUT_BYTES,
    ChartInputError,
    canonical_bytes,
    content_hash,
    validate_profile,
)
from .core import analysis_fingerprint, analyze
from .fixtures import synthetic_profiles


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Hermetic maimai normalized-chart analyzer")
    commands = parser.add_subparsers(dest="command", required=True)
    single = commands.add_parser("analyze", help="Analyze one explicit local normalized JSON chart")
    single.add_argument("input", type=Path)
    single.add_argument("--output", type=Path, required=True)
    single.add_argument("--cache-dir", type=Path)
    demo = commands.add_parser("demo", help="Analyze only the bundled authored synthetic corpus")
    demo.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        manifest_path = args.output.with_suffix(args.output.suffix + ".manifest.json")
        try:
            destinations = {args.output.resolve(), manifest_path.resolve()}
            source = args.input.resolve() if args.command == "analyze" else None
        except (OSError, RuntimeError) as error:
            raise ChartInputError("Cannot resolve local analyzer input/output paths") from error
        if source in destinations:
            raise ChartInputError("Analysis output or manifest must not overwrite the source input")
        if len(destinations) != 2:
            raise ChartInputError("Analysis output and manifest must be separate destinations")
        if args.command == "demo":
            result = {
                "schema_version": "1.0.0",
                "source_kind": "authored_synthetic",
                "profiles": synthetic_profiles(),
            }
        else:
            with args.input.open("rb") as stream:
                data = stream.read(MAX_INPUT_BYTES + 1)
            if len(data) > MAX_INPUT_BYTES:
                raise ChartInputError("Chart input exceeds byte limit")
            chart = json.loads(data)
            fingerprint = analysis_fingerprint(chart)
            result = None
            if args.cache_dir:
                # Hash all normalization/policy inputs; a warm hit skips feature extraction.
                cache_path = args.cache_dir / f"{fingerprint['cache_key']}.json"
                if cache_path.exists():
                    with cache_path.open("rb") as stream:
                        cached = stream.read(MAX_INPUT_BYTES * 4 + 1)
                    envelope = json.loads(cached)
                    if not isinstance(envelope, dict) or set(envelope) != {
                        "schema_version",
                        "output_hash",
                        "profile",
                    }:
                        raise ChartInputError("Invalid cache envelope")
                    if envelope["schema_version"] != "1.0.0" or envelope[
                        "output_hash"
                    ] != content_hash(envelope["profile"]):
                        raise ChartInputError("Cached artifact content hash is invalid")
                    validate_profile(envelope["profile"], fingerprint)
                    result = envelope["profile"]
            if result is None:
                result = analyze(chart)
                validate_profile(result, fingerprint)
                if args.cache_dir:
                    args.cache_dir.mkdir(parents=True, exist_ok=True)
                    cache_path.write_bytes(
                        canonical_bytes(
                            {
                                "schema_version": "1.0.0",
                                "output_hash": content_hash(result),
                                "profile": result,
                            }
                        )
                    )
        args.output.parent.mkdir(parents=True, exist_ok=True)
        output = canonical_bytes(result)
        args.output.write_bytes(output)
        manifest = {
            "schema_version": "1.0.0",
            "preparation_reference": "explicit-local-build",
            "output_hash": content_hash(result),
            "python_version": sys.version.split()[0],
            "profiles": [
                {
                    key: item[key]
                    for key in (
                        "chart_id",
                        "cache_key",
                        "source_hash",
                        "normalized_hash",
                        "analyzer_version",
                        "registry_version",
                        "config_hash",
                    )
                }
                for item in result.get("profiles", [result])
            ],
            "coverage": [item["coverage"] for item in result.get("profiles", [result])],
        }
        manifest_path.write_bytes(canonical_bytes(manifest))
    except (OSError, ValueError, TypeError, RecursionError) as error:
        # Never echo arbitrary source content, private paths or service payloads.
        print(
            f"Analysis failed: {error}"
            if isinstance(error, ChartInputError)
            else "Analysis failed: invalid or unreadable local input",
            file=sys.stderr,
        )
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
