"""Assemble the main-site import release without publishing or changing old catalogs."""

import argparse
import hashlib
import json
import shutil
from pathlib import Path

from maimai_intelligence.lab import build_lab
from maimai_intelligence.public_release import (
    MAX_PUBLIC_FILE_BYTES,
    MAX_PUBLIC_FILES,
    PUBLIC_FILES,
    build_public_release,
)
from maimai_intelligence.registry import read_registry
from maimai_intelligence.registry_catalog import build_registry_package
from maimai_intelligence.snapshots import atomic_json
from scripts.build_report_url_pilot_patch import inventory

BASE_MANIFEST = "9cb000b90b381f32a531651f6a321a22f418d0427185e45b97fdd25f227e7c73"
PACKAGE = "fb1660a216ad0550a6e69d9853dd02ba0014087b3b06a5556341dcaedd6f2322"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build(baseline, retained_package, output):
    baseline, retained_package, output = map(
        lambda p: Path(p).resolve(), (baseline, retained_package, output)
    )
    if not str(output).lower().startswith("c:\\devcache\\"):
        raise ValueError("Production artifacts belong in DevCache")
    if output.exists() and any(output.iterdir()):
        raise ValueError("Use a fresh immutable release directory")
    previous = baseline / "public"
    expected = json.loads((baseline / "public-inventory.json").read_text("utf-8"))
    if inventory(previous) != expected or digest(previous / "manifest.json") != BASE_MANIFEST:
        raise ValueError("Baseline inventory changed; reconcile before building")
    if digest(retained_package / "package.json") != PACKAGE:
        raise ValueError("Unexpected retained public package")
    source = Path(__file__).resolve().parents[1]
    output.mkdir(parents=True, exist_ok=True)
    package, browser, generated, public = (
        output / name for name in ("package", "browser", "generated", "public")
    )
    build_registry_package(read_registry(source / "registry"), retained_package, package)
    version = "research-" + digest(package / "package.json")[:12]
    build_lab(package, browser, catalog_version=version, player_maishift=True)
    build_public_release(browser, generated)
    old_manifest = json.loads((previous / "manifest.json").read_text("utf-8"))
    new_manifest = json.loads((generated / "manifest.json").read_text("utf-8"))
    old_entries = {r["version"]: r for r in old_manifest["releases"]}
    for entry in new_manifest["releases"]:
        if entry["version"] in old_entries and entry != old_entries[entry["version"]]:
            raise ValueError("An immutable catalog version changed")
        old_entries[entry["version"]] = entry
    # The baseline is already an allowlisted, verified public artifact. Do not
    # carry the retired pilot, private inputs, or arbitrary source into this tree.
    for name in expected:
        if name.startswith("pilot/maishift/"):
            continue
        target = public / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(previous / name, target)
    for name in inventory(generated):
        if name in {"manifest.json", "_headers"}:
            continue
        target = public / name
        if (
            target.exists()
            and name not in PUBLIC_FILES
            and digest(target) != digest(generated / name)
        ):
            raise ValueError(f"Unreviewed baseline file change: {name}")
        if (
            name.startswith(("support", "stripe-"))
            and target.exists()
            and digest(target) != digest(generated / name)
        ):
            raise ValueError(f"Unrelated payment asset changed: {name}")
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(generated / name, target)
    # Preserve existing site/payment policies. Remove only obsolete pilot blocks.
    headers, keep = [], True
    for line in (previous / "_headers").read_text("utf-8").splitlines():
        if line.startswith("/"):
            keep = not line.startswith("/pilot/maishift")
        if keep:
            headers.append(line)
    for name in [
        "/",
        "/index.html",
        "/manifest.json",
        *("/" + p for p in PUBLIC_FILES if p.endswith((".js", ".css"))),
    ]:
        headers.extend([name, "  Cache-Control: no-store"])
    (public / "_headers").write_text("\n".join(headers) + "\n", "utf-8")
    redirects = public / "_redirects"
    prior_redirects = redirects.read_text("utf-8") if redirects.exists() else ""
    if "/pilot/maishift" in prior_redirects:
        raise ValueError("Existing pilot redirects need explicit reconciliation")
    redirects.write_text(
        prior_redirects + "\n/pilot/maishift /?view=catalog 302\n"
        "/pilot/maishift/ /?view=catalog 302\n"
        "/pilot/maishift/* /?view=catalog 302\n",
        "utf-8",
    )
    atomic_json(public / "manifest.json", {**new_manifest, "releases": list(old_entries.values())})
    current = inventory(public)
    if len(current) > MAX_PUBLIC_FILES or any(
        (public / name).stat().st_size > MAX_PUBLIC_FILE_BYTES for name in current
    ):
        raise ValueError("Pages artifact limits exceeded")
    receipt = {
        "baselineManifest": BASE_MANIFEST,
        "manifestSha256": digest(public / "manifest.json"),
        "retainedPackageSha256": PACKAGE,
        "defaultVersion": version,
        "preservedCatalogVersions": len(old_manifest["releases"]),
        "files": len(current),
        "changed": [
            name for name in current if name in expected and current[name] != expected[name]
        ],
        "added": [name for name in current if name not in expected],
        "removedPilotFiles": sum(name.startswith("pilot/maishift/") for name in expected),
        "maishiftEnabled": True,
        "pilotStorageMigrated": False,
        "workerChanged": False,
    }
    atomic_json(output / "public-inventory.json", current)
    atomic_json(output / "preparation.json", receipt)
    return receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("baseline", "retained-package", "output"):
        parser.add_argument("--" + name, required=True)
    args = parser.parse_args()
    result = build(args.baseline, args.retained_package, args.output)
    print(json.dumps({k: v for k, v in result.items() if k not in {"added", "changed"}}, indent=2))
