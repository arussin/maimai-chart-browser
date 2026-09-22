"""Add reviewed title readings to the retained performance pilot, without publishing."""

import argparse
import json
import re
import shutil
from pathlib import Path

from maimai_intelligence.song_search import song_search_script
from scripts.build_report_url_pilot_patch import digest, inventory


def build(baseline, source, output):
    baseline, source, output = map(Path, (baseline, source, output))
    if not output.resolve().is_relative_to(Path("C:/DevCache").resolve()) or output.exists():
        raise ValueError("Use a fresh DevCache output directory")
    expected = json.loads((baseline / "public-inventory.json").read_text("utf-8"))
    prepared = json.loads((baseline / "preparation.json").read_text("utf-8"))
    if (
        prepared["browserBuild"]
        != "f31e336b3c2c673c8bd91cfe411c2bacc03498f1d17ecd4d3d11f4401cb351f4"
    ):
        raise ValueError("Unexpected performance pilot baseline")
    if inventory(baseline / "public") != expected:
        raise ValueError("Retained pilot differs from its inventory")
    prefix = "pilot/maishift/browser/"
    root = baseline / "public" / prefix
    js = (root / "challenge-review.js").read_text("utf-8")
    start = js.index("/* Public title aliases only.")
    end_marker = "  window.maimaiSongSearch = {query,romaji};\n})();\n"
    end = js.index(end_marker, start) + len(end_marker)
    if (
        digest(js[start:end].encode())
        != "7d0b334273c130829dcc6dc9dbd60d35e16a4ab774ab543568c6ff2cad388cc0"
    ):
        raise ValueError("Unexpected existing title-search component")
    js = js[:start] + song_search_script() + js[end:]
    loader = (source / "src/maimai_intelligence/assets/lab-loader.js").read_text("utf-8")
    if loader != (root / "lab-loader.js").read_text("utf-8"):
        raise ValueError("Loader changed beyond the reviewed script revision")
    loader = loader.replace(
        "challenge-review.js", "challenge-review.js?v=" + digest(js.encode())[:16]
    )
    content = {"challenge-review.js": js.encode(), "lab-loader.js": loader.encode()}
    html = (root / "index.html").read_text("utf-8")
    for name, raw in content.items():
        html, count = re.subn(
            re.escape(name) + r"\?v=[a-f0-9]{16}", name + "?v=" + digest(raw)[:16], html
        )
        if count != 1:
            raise ValueError("Expected one versioned asset reference")
    content["index.html"] = html.encode()
    shutil.copytree(baseline / "public", output / "public")
    for name, raw in content.items():
        (output / "public" / prefix / name).write_bytes(raw)
    actual = inventory(output / "public")
    changed = sorted(k for k in actual if actual[k] != expected.get(k))
    if actual.keys() != expected.keys() or changed != sorted(prefix + name for name in content):
        raise ValueError("Unexpected changes outside reviewed reading assets")
    artifact = json.loads((baseline / "pilot-artifact.json").read_text("utf-8"))
    for key in changed:
        artifact["files"][key] = actual[key]
    artifact["browserBuild"] = digest(json.dumps(artifact["files"], sort_keys=True).encode())
    result = {
        "schemaVersion": "readings-pilot-update-1",
        "baselineDeployment": "629dbd0d-23bb-4069-9650-15275de6c31c",
        "changedFiles": changed,
        "preservedFiles": len(actual) - len(changed),
        "browserBuild": artifact["browserBuild"],
        "mainManifestSha256": actual["manifest.json"],
        "additionalReadings": 321,
        "workerChanged": False,
        "generalReleaseEnabled": False,
    }
    for name, value in [
        ("public-inventory.json", actual),
        ("pilot-artifact.json", artifact),
        ("preparation.json", result),
    ]:
        (output / name).write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ("baseline", "source", "output"):
        parser.add_argument("--" + flag, required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.baseline, args.source, args.output), indent=2))
