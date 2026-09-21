"""Build a local metadata-only Party preview; never read protected chart bodies."""

import argparse
from pathlib import Path

from maimai_intelligence.lab import build_lab
from maimai_intelligence.public_release import build_public_release
from maimai_intelligence.registry import read_registry
from maimai_intelligence.registry_catalog import build_registry_package


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if not str(output).lower().startswith("c:\\devcache\\"):
        raise ValueError("Preview output must be in DevCache")
    source = Path(__file__).resolve().parents[1]
    build_registry_package(read_registry(source / "registry"), None, output / "package")
    build_lab(output / "package", output / "lab", catalog_version="maishift-local-mapping-20260921")
    build_public_release(output / "lab", output / "public")
    print("Public metadata preview prepared; Maishift release capability remains disabled.")


if __name__ == "__main__":
    main()
