"""Bootstrap persistent IDs from hash-verified, retained nonpersonal browser releases."""

import argparse
import hashlib
import json
from pathlib import Path

from maimai_intelligence.catalog_loading import MAX_CATALOG_BYTES
from maimai_intelligence.public_release import _read
from maimai_intelligence.registry import bootstrap, empty, read_registry, write_registry
from maimai_intelligence.research_package import read_package
from maimai_intelligence.snapshots import read_json


def prepare(browser, package, output, *, registry=None):
    root = Path(browser).resolve()
    manifest = read_json(root / "manifest.json")
    if manifest.get("schema_version") != "1.0.0":
        raise ValueError("Bootstrap needs a retained browser with original immutable catalog bytes")
    _, files = read_package(package)
    rows = json.loads(files["source-inventory.json"])
    value = read_registry(registry) if registry else empty()
    releases = manifest["releases"]
    if len({r["version"] for r in releases}) != len(releases) or manifest["default"] not in {
        r["version"] for r in releases
    }:
        raise ValueError("Invalid retained release history")
    releases = sorted(releases, key=lambda r: r["version"] == manifest["default"])
    for release in releases:
        if release.get("path") != f"catalogs/{release['sha256']}.json":
            raise ValueError("Unexpected retained catalog path")
        raw = _read(root, release["path"], MAX_CATALOG_BYTES)
        if hashlib.sha256(raw).hexdigest() != release["sha256"]:
            raise ValueError("Retained catalog integrity mismatch")
        data = json.loads(raw)
        if data.get("package", {}).get("status") != "research_preview":
            raise ValueError("Only accepted nonpersonal research releases may bootstrap inventory")
        if data.get("schema_version"):
            continue
        value = bootstrap(
            value, data, release["version"], source_inventory=rows, select_current=registry is None
        )
    write_registry(value, output)
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", type=Path, required=True)
    parser.add_argument("--package", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--registry", type=Path)
    args = parser.parse_args()
    value = prepare(**vars(args))
    print(json.dumps({"songs": len(value["songs"]), "charts": len(value["charts"])}))


if __name__ == "__main__":
    main()
