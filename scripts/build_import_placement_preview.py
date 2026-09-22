"""Build a local visual proposal from the checked public pilot, never a release."""

import argparse
import hashlib
import json
import shutil
from pathlib import Path


def build(source: Path, output: Path):
    source, output = source.resolve(), output.resolve()
    if not output.is_relative_to(Path("C:/DevCache").resolve()) or output.exists():
        raise ValueError("A new DevCache output directory is required")
    manifest = json.loads((source / "pilot-artifact.json").read_text("utf-8"))
    if manifest.get("schemaVersion") != "maishift-pilot-artifact-1":
        raise ValueError("Expected a checked public pilot artifact")
    prefix = "pilot/maishift/browser/"
    assets = {name: sha for name, sha in manifest["files"].items() if name.startswith(prefix)}
    for name, sha in assets.items():
        original = (source / name).resolve()
        if (
            not original.is_relative_to(source)
            or hashlib.sha256(original.read_bytes()).hexdigest() != sha
        ):
            raise ValueError("Pilot asset integrity check failed")
    destination = output / "pilot/maishift/browser"
    for name in assets:
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / name, target)
    design = Path(__file__).resolve().parents[1] / "docs/design"
    mock_assets = (
        "import-placement.css",
        "import-placement.js",
        "player-range-controls.css",
        "player-range-controls.js",
    )
    for name in mock_assets:
        shutil.copyfile(design / name, destination / name)
    # Carry the current import UI and report fixes. The design adapter removes
    # the unshipped header-button draft before mounting the proposed placement.
    shared_assets = ("player-data.css", "player-data.js", "player-sources.js")
    for name in shared_assets:
        shutil.copyfile(
            design.parents[1] / "src/maimai_intelligence/assets" / name, destination / name
        )
    index = destination / "index.html"
    html = index.read_text("utf-8")
    # Keep the original pilot's isolated local player namespace. No production
    # feature flag, hosted artifact or saved player dataset is changed here.
    html = html.replace(
        "</head>",
        '<link rel="stylesheet" href="player-data.css">'
        '<link rel="stylesheet" href="import-placement.css">'
        '<link rel="stylesheet" href="player-range-controls.css"></head>',
    )
    html = html.replace(
        "</body>",
        '<script defer src="import-placement.js"></script>'
        '<script defer src="player-range-controls.js"></script></body>',
    )
    index.write_text(html, encoding="utf-8")
    receipt = {
        "kind": "local-import-placement-mockup",
        "releaseEnabled": False,
        "sourceBrowserBuild": manifest["browserBuild"],
        "publicAssetsVerified": len(assets),
        "previewFiles": {
            name: hashlib.sha256((destination / name).read_bytes()).hexdigest()
            for name in ("index.html", *mock_assets, *shared_assets)
        },
        "note": "Visual mockup only; no upstream import service or deployment is included.",
    }
    (output / "mock-receipt.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(output), **receipt}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    build(args.source, args.output)
