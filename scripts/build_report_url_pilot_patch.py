"""Prepare the bounded report-URL fix on a verified retained pilot deployment.

Build output belongs in a fresh DevCache directory. This does not deploy or
change the retained package, Git index, main site, report or import Worker.
"""

import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path


def digest(data):
    return hashlib.sha256(data).hexdigest()


def inventory(root):
    paths = sorted(root.rglob("*"))
    if any(path.is_symlink() for path in paths):
        raise ValueError("Linked release content is not supported")
    return {
        path.relative_to(root).as_posix(): digest(path.read_bytes())
        for path in paths
        if path.is_file()
    }


def build(baseline, source, output):
    baseline, source, output = map(lambda p: Path(p).resolve(), (baseline, source, output))
    if not output.is_relative_to(Path("C:/DevCache").resolve()):
        raise ValueError("Build output must stay in DevCache")
    if output.exists():
        raise ValueError("Use a new output directory")
    receipt = json.loads((baseline / "release-receipt.json").read_text("utf-8"))
    if receipt["pagesDeployment"] != "90412f50-feaa-4910-b8b7-ea3e8bfa797f":
        raise ValueError("Unexpected retained deployment")
    expected = json.loads((baseline / "public-inventory.json").read_text("utf-8"))
    if inventory(baseline / "public") != expected:
        raise ValueError("Retained deployment does not match its inventory")

    script = "pilot/maishift/browser/player-sources.js"
    entry = "pilot/maishift/browser/index.html"
    old = (baseline / "public" / script).read_text("utf-8")
    new = (source / "src/maimai_intelligence/assets/player-sources.js").read_text("utf-8")
    old_rule = (
        r"const match=/^\/([A-Za-z0-9_-]+)\/(?:party\/latest\.json|index\.html)?$/"
        r".exec(url.pathname);"
    )
    new_rule = (
        r"const match=/^\/([A-Za-z0-9_-]+)(?:\/(?:party\/latest\.json|index\.html)?)?$/"
        r".exec(url.pathname);"
    )
    if old.count(old_rule) != 1 or old.replace(old_rule, new_rule) != new:
        raise ValueError("Source differs beyond the reviewed URL normalization fix")
    new_bytes = new.encode("utf-8")
    html = (baseline / "public" / entry).read_text("utf-8")
    html, count = re.subn(
        r"player-sources\.js\?v=[a-f0-9]{16}", "player-sources.js?v=" + digest(new_bytes)[:16], html
    )
    if count != 1:
        raise ValueError("Expected one versioned source adapter reference")

    shutil.copytree(baseline / "public", output / "public")
    (output / "public" / script).write_bytes(new_bytes)
    (output / "public" / entry).write_bytes(html.encode("utf-8"))
    actual = inventory(output / "public")
    changed = sorted(key for key in actual if actual[key] != expected.get(key))
    if actual.keys() != expected.keys() or changed != sorted([script, entry]):
        raise ValueError("Unexpected release changes")
    artifact = json.loads((baseline / "pilot-artifact/pilot-artifact.json").read_text("utf-8"))
    for key in changed:
        artifact["files"][key] = actual[key]
    artifact["browserBuild"] = digest(json.dumps(artifact["files"], sort_keys=True).encode())
    result = {
        "schemaVersion": "report-url-pilot-patch-1",
        "baselineDeployment": receipt["pagesDeployment"],
        "changedFiles": changed,
        "preservedFiles": len(actual) - len(changed),
        "sourceSha256": digest(new_bytes),
        "browserBuild": artifact["browserBuild"],
        "mainManifestSha256": actual["manifest.json"],
        "workerChanged": False,
    }
    for name, data in [
        ("public-inventory.json", actual),
        ("pilot-artifact.json", artifact),
        ("preparation.json", result),
    ]:
        (output / name).write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return result


def add_formatting(baseline, source, output, formatting):
    """Promote the reviewed local layout only into the isolated hosted pilot."""
    baseline, source, output, formatting = map(Path, (baseline, source, output, formatting))
    if not output.resolve().is_relative_to(Path("C:/DevCache").resolve()):
        raise ValueError("Build output must stay in DevCache")
    prepared = json.loads((output / "preparation.json").read_text("utf-8"))
    if prepared["schemaVersion"] != "report-url-pilot-patch-1":
        raise ValueError("Expected a prepared, unpublished URL patch")
    if inventory(output / "public") != json.loads(
        (output / "public-inventory.json").read_text("utf-8")
    ):
        raise ValueError("Prepared files changed")
    mock = json.loads((formatting / "mock-receipt.json").read_text("utf-8"))
    if (
        mock["sourceBrowserBuild"]
        != "249edf0427840ecb3d16461ab66411df5255508573909c93a14d7da5dd9e1423"
    ):
        raise ValueError("Unexpected formatting baseline")
    design = {
        "import-placement.css",
        "import-placement.js",
        "player-range-controls.css",
        "player-range-controls.js",
    }
    shared = {"player-data.css", "player-data.js", "player-sources.js"}
    if set(mock["previewFiles"]) != design | shared | {"index.html"}:
        raise ValueError("Unexpected formatting assets")
    prefix = "pilot/maishift/browser/"
    content = {}
    for name, sha in mock["previewFiles"].items():
        raw = (formatting / prefix / name).read_bytes()
        if digest(raw) != sha:
            raise ValueError("Formatting artifact changed")
        if name != "index.html":
            location = "docs/design" if name in design else "src/maimai_intelligence/assets"
            if raw != (source / location / name).read_bytes():
                raise ValueError("Formatting differs from current reviewed source")
        content[name] = raw
    html = content["index.html"].decode("utf-8")
    for name in ("player-sources.js", "player-data.js"):
        html, count = re.subn(
            re.escape(name) + r"\?v=[a-f0-9]{16}", name + "?v=" + digest(content[name])[:16], html
        )
        if count != 1:
            raise ValueError("Expected one versioned import module")
    content["index.html"] = html.encode("utf-8")
    for name, raw in content.items():
        (output / "public" / prefix / name).write_bytes(raw)
    expected = json.loads((baseline / "public-inventory.json").read_text("utf-8"))
    actual = inventory(output / "public")
    changed = sorted(key for key in actual if actual[key] != expected.get(key))
    if changed != sorted(prefix + name for name in content) or not expected.keys() <= actual.keys():
        raise ValueError("Unexpected changes outside the reviewed formatting")
    artifact = json.loads((output / "pilot-artifact.json").read_text("utf-8"))
    for key in changed:
        artifact["files"][key] = actual[key]
    artifact["browserBuild"] = digest(json.dumps(artifact["files"], sort_keys=True).encode())
    result = {
        **prepared,
        "schemaVersion": "formatted-pilot-update-1",
        "changedFiles": changed,
        "preservedFiles": len(expected) - sum(key in expected for key in changed),
        "addedFiles": sum(key not in expected for key in changed),
        "sourceSha256": digest(content["player-sources.js"]),
        "browserBuild": artifact["browserBuild"],
        "generalReleaseEnabled": False,
        "formattedPreview": True,
    }
    for name, data in [
        ("public-inventory.json", actual),
        ("pilot-artifact.json", artifact),
        ("preparation.json", result),
    ]:
        (output / name).write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--formatting", help="Reviewed local layout to add to an unpublished patch")
    args = parser.parse_args()
    result = (
        add_formatting(args.baseline, args.source, args.output, args.formatting)
        if args.formatting
        else build(args.baseline, args.source, args.output)
    )
    print(json.dumps(result, indent=2))
