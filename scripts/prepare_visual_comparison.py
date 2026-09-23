"""Compare browser presentation using retained identical synthetic catalog bytes.

The existing fixture builder deliberately assigns fresh canonical IDs. Those IDs
must not be regenerated when comparing screenshots because they break sort ties.
This utility combines a retained synthetic public fixture with newly built runtime
assets, then regenerates song pages from that same retained catalog. No input is
edited, no network is used, and the result is a local test fixture, not a release.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

from maimai_intelligence.public_release import _browser_csp
from maimai_intelligence.seo import build_seo

IMMUTABLE = {
    "catalogs",
    "catalog-parts",
    "catalog-index",
    "catalog-index-parts",
    "chart-details",
    "media",
    "integration",
}


def inventory(root: Path) -> dict[str, str]:
    result = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
            raise ValueError("Visual fixture inputs must not contain aliases")
        if path.is_file():
            result[path.relative_to(root).as_posix()] = hashlib.sha256(
                path.read_bytes()
            ).hexdigest()
    return result


def prepare(baseline: Path, runtime: Path, output: Path, expected_manifest: str) -> dict:
    baseline, runtime, output = baseline.resolve(), runtime.resolve(), output.resolve()
    for source in (baseline, runtime):
        if source == output or source.is_relative_to(output) or output.is_relative_to(source):
            raise ValueError("Use a fresh visual fixture outside retained inputs")
    before = inventory(baseline)
    if before.get("manifest.json") != expected_manifest:
        raise ValueError("Retained visual manifest differs from the reviewed reference")
    current = inventory(runtime)
    shutil.copytree(baseline, output)
    # Keep the corpus, its historical readers, and its identity ledger fixed.
    overlay = {
        name
        for name in current
        if name.startswith("browser/")
        or "/" not in name
        and (
            Path(name).suffix in {".js", ".css", ".html"}
            or name in {"browser-assets.json", "browser-config.json"}
        )
    }
    for name in sorted(overlay):
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes((runtime / name).read_bytes())
    manifest = json.loads((baseline / "manifest.json").read_bytes())
    release = next(row for row in manifest["releases"] if row["version"] == manifest["default"])
    raw = b"".join((baseline / row["path"]).read_bytes() for row in release.get("parts", [release]))
    if hashlib.sha256(raw).hexdigest() != release["sha256"]:
        raise ValueError("Retained synthetic catalog integrity mismatch")
    previous = json.loads((baseline / "permalinks.json").read_bytes())
    seo, _, _ = build_seo(
        json.loads(raw),
        previous=previous,
        browser_csp=_browser_csp((runtime / "index.html").read_bytes()),
    )
    for name, content in seo.items():
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    after = inventory(output)
    fixed = {
        name: value
        for name, value in before.items()
        if name.split("/")[0] in IMMUTABLE or name == "manifest.json"
    }
    if any(after.get(name) != value for name, value in fixed.items()):
        raise ValueError("Visual comparison changed retained corpus bytes")
    if before != inventory(baseline) or current != inventory(runtime):
        raise ValueError("Visual comparison modified its inputs")
    return {
        "schema_version": "maimai-visual-inputs-1",
        "scope": "local synthetic presentation comparison only",
        "baseline": str(baseline),
        "runtime": str(runtime),
        "output": str(output),
        "manifest_sha256": expected_manifest,
        "catalog_sha256": release["sha256"],
        "fixed_data_files": fixed,
        "runtime_files": {name: after[name] for name in sorted(overlay)},
        "inputs_unchanged": True,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("baseline", "runtime", "output", "receipt"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--manifest-sha256", required=True)
    args = parser.parse_args()
    receipt = prepare(args.baseline, args.runtime, args.output, args.manifest_sha256)
    args.receipt.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "catalog_sha256": receipt["catalog_sha256"],
                "fixed_files": len(receipt["fixed_data_files"]),
            }
        )
    )


if __name__ == "__main__":
    main()
