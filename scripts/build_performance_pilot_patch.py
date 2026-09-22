"""Add verified progressive delivery to the retained pilot, without publishing."""

import argparse
import json
import re
import shutil
from pathlib import Path

from maimai_intelligence.catalog_loading import MAX_CATALOG_BYTES, progressive_catalog
from maimai_intelligence.public_release import MAX_PUBLIC_FILE_BYTES, MAX_PUBLIC_FILES
from maimai_intelligence.snapshots import canonical
from scripts.build_maishift_pilot import pilot_headers
from scripts.build_report_url_pilot_patch import digest, inventory


def build(baseline, source, output):
    baseline, source, output = map(Path, (baseline, source, output))
    if not output.resolve().is_relative_to(Path("C:/DevCache").resolve()) or output.exists():
        raise ValueError("Use a fresh DevCache output directory")
    expected = json.loads((baseline / "public-inventory.json").read_text("utf-8"))
    prepared = json.loads((baseline / "preparation.json").read_text("utf-8"))
    if (
        prepared["browserBuild"]
        != "d6c198ef3a0a30dc51882a31b2d02a0da4bcd9d7f2665c373f97a214ebb86c30"
    ):
        raise ValueError("Unexpected results pilot baseline")
    if inventory(baseline / "public") != expected:
        raise ValueError("Retained pilot differs from its inventory")
    prefix = "pilot/maishift/browser/"
    root = baseline / "public" / prefix
    manifest = json.loads((root / "manifest.json").read_text("utf-8"))
    content, projections = {}, []
    for entry in manifest["releases"]:
        parts = entry.get("parts", [])
        if not 1 <= len(parts) <= 8:
            raise ValueError("Unexpected retained catalog parts")
        raw_parts = []
        for part in parts:
            sha = part["sha256"]
            if (
                not re.fullmatch(r"[a-f0-9]{64}", sha)
                or part["path"] != f"catalog-parts/{sha}.json"
            ):
                raise ValueError("Invalid retained catalog part")
            raw = (root / part["path"]).read_bytes()
            if len(raw) != part["bytes"] or digest(raw) != sha:
                raise ValueError("Retained catalog part mismatch")
            raw_parts.append(raw)
        raw = b"".join(raw_parts)
        if len(raw) > MAX_CATALOG_BYTES or digest(raw) != entry["sha256"]:
            raise ValueError("Retained catalog integrity mismatch")
        startup, derived = progressive_catalog(json.loads(raw), entry["sha256"])
        if not startup or startup["bytes"] > MAX_PUBLIC_FILE_BYTES:
            raise ValueError("Pilot must have a progressive index within the hosting limit")
        if any(len(value) > MAX_PUBLIC_FILE_BYTES for value in derived.values()):
            raise ValueError("Derived file exceeds hosting limit")
        content.update({prefix + key: value for key, value in derived.items()})
        entry["startup"] = startup
        projections.append(
            {
                "sourceSha256": entry["sha256"],
                "fullBytes": len(raw),
                "startup": startup,
                "detailFiles": len(derived) - 1,
            }
        )
    content[prefix + "manifest.json"] = canonical(manifest)
    script_revision = digest((root / "challenge-review.js").read_bytes())[:16]
    loader = (
        (source / "src/maimai_intelligence/assets/lab-loader.js")
        .read_text("utf-8")
        .replace("challenge-review.js", f"challenge-review.js?v={script_revision}")
        .encode()
    )
    if (
        digest((root / "lab-loader.js").read_bytes())
        != "e7a1b5dad14e72e8b7708eccb1822dd46774d43a80eb62fca7ed244418a9ec57"
    ):
        raise ValueError("Unexpected previous loader")
    content[prefix + "lab-loader.js"] = loader
    html, count = re.subn(
        r"lab-loader\.js\?v=[a-f0-9]{16}",
        "lab-loader.js?v=" + digest(loader)[:16],
        (root / "index.html").read_text("utf-8"),
    )
    if count != 1:
        raise ValueError("Expected one versioned loader reference")
    content[prefix + "index.html"] = html.encode()
    headers = (baseline / "public/_headers").read_text("utf-8")
    marker = "/pilot/maishift/*\n"
    if headers.count(marker) != 1:
        raise ValueError("Unexpected pilot header boundary")
    before, previous = headers.split(marker)
    revised = pilot_headers()
    for line in ("  Referrer-Policy: no-referrer\n", "  X-Content-Type-Options: nosniff\n"):
        if line in before and line not in previous:
            revised = revised.replace(line, "")

    # Cache policy changes only; retain every security header and main-site rule.
    def security(value):
        return sorted(
            line
            for line in value.splitlines()
            if line.startswith("  ") and not line.startswith("  Cache-Control:")
        )

    if security(previous) != security(revised):
        raise ValueError("Pilot security headers changed")
    content["_headers"] = (before + revised).encode()
    if len(expected.keys() | content.keys()) > MAX_PUBLIC_FILES:
        raise ValueError("Deployment file count exceeds hosting limit")
    shutil.copytree(baseline / "public", output / "public")
    for name, raw in content.items():
        path = output / "public" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
    actual = inventory(output / "public")
    changed = sorted(key for key in actual if actual[key] != expected.get(key))
    if set(expected) - set(actual) or set(changed) != set(content):
        raise ValueError("Unexpected changes outside reviewed delivery assets")
    artifact = json.loads((baseline / "pilot-artifact.json").read_text("utf-8"))
    for key in changed:
        artifact["files"][key] = actual[key]
    artifact["browserBuild"] = digest(json.dumps(artifact["files"], sort_keys=True).encode())
    result = {
        "schemaVersion": "performance-pilot-update-1",
        "baselineDeployment": "d557be41-d79c-4d29-8a98-8e4c159f0ca7",
        "changedFiles": changed,
        "preservedFiles": len(actual) - len(changed),
        "browserBuild": artifact["browserBuild"],
        "mainManifestSha256": actual["manifest.json"],
        "projections": projections,
        "workerChanged": False,
        "generalReleaseEnabled": False,
    }
    for name, value in [
        ("public-inventory.json", actual),
        ("pilot-artifact.json", artifact),
        ("preparation.json", result),
    ]:
        (output / name).write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    return {**result, "changedFiles": len(changed)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ("baseline", "source", "output"):
        parser.add_argument("--" + flag, required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.baseline, args.source, args.output), indent=2))
