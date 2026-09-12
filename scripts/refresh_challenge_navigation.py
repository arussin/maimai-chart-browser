"""Refresh verified offline navigation without reanalyzing charts or reranking matches."""

from __future__ import annotations

import argparse
import json
from importlib.resources import files
from pathlib import Path

from maimai_analyzer.catalog_navigation import build_navigation
from maimai_analyzer.dataset import SOURCE_LOCK
from maimai_intelligence.challenge_review import render_review
from maimai_intelligence.io import atomic_write_text
from scripts.acquire_maichart_pack import sha256
from scripts.analyze_simai_corpus import _load, _relative
from scripts.build_challenge_package import PACKAGE_VERSION, source_bpms, verify_capture, write


def refresh(source, output):
    output = Path(output).resolve()
    root, manifest, rows, digest = _load(Path(source) / "manifest.json", output)
    if output.is_relative_to(root):
        raise ValueError("Navigation output must stay outside the captured source")
    package = json.loads((output / "package.json").read_bytes())
    if (
        package["version"] != PACKAGE_VERSION
        or package["source"] != SOURCE_LOCK
        or package["manifest_hash"] != digest
    ):
        raise ValueError("Navigation source does not match the prepared package")
    verify_capture(root, manifest)
    loaded = {}
    for item in package["files"]:
        path = _relative(output, item["path"])
        if path.stat().st_size != item["bytes"] or item["bytes"] > 128 * 1024 * 1024:
            raise ValueError("Prepared package file size changed")
        raw = path.read_bytes()
        if sha256(raw) != item["sha256"] or item["path"] in loaded:
            raise ValueError("Prepared package file hash changed or duplicated")
        loaded[item["path"]] = json.loads(raw)
    if loaded["source-inventory.json"] != rows:
        raise ValueError("Prepared source inventory differs from captured source")
    navigation = build_navigation(
        loaded["catalog.json"], rows, bpm_by_source=source_bpms(root, rows)
    )
    package["files"] = [x for x in package["files"] if x["path"] != "navigation.json"]
    package["files"].append(write(output, "navigation.json", navigation))
    package["navigation_builder_hash"] = sha256(
        files("maimai_analyzer").joinpath("catalog_navigation.py").read_bytes()
    )
    html = render_review(
        package,
        loaded["catalog.json"],
        loaded["review.json"],
        loaded["snippets.json"],
        loaded["benchmark.json"],
        navigation,
    )
    write(output, "package.json", package)
    atomic_write_text(output / "index.html", html)
    return navigation["coverage"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("package", type=Path)
    args = parser.parse_args()
    print(json.dumps(refresh(args.source, args.package), ensure_ascii=False))


if __name__ == "__main__":
    main()
