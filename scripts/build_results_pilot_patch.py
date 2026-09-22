"""Assemble the reviewed results UI on the exact retained formatted pilot.

Only five pilot browser assets can change. This never publishes anything.
"""

import argparse
import json
import re
import shutil
from pathlib import Path

from maimai_intelligence.song_search import song_search_script
from scripts.build_report_url_pilot_patch import digest, inventory


def build(baseline, original_source, source, output):
    baseline, original_source, source, output = map(
        Path, (baseline, original_source, source, output)
    )
    if not output.resolve().is_relative_to(Path("C:/DevCache").resolve()) or output.exists():
        raise ValueError("Use a fresh DevCache output directory")
    expected = json.loads((baseline / "public-inventory.json").read_text("utf-8"))
    prepared = json.loads((baseline / "preparation.json").read_text("utf-8"))
    if (
        prepared["browserBuild"]
        != "c49a966269629655a81f69f427c75da5e1d2bfdc96292d4af592f56a38557f51"
    ):
        raise ValueError("Unexpected formatted pilot baseline")
    if inventory(baseline / "public") != expected:
        raise ValueError("Retained pilot differs from its inventory")
    assets = source / "src/maimai_intelligence/assets"
    old_assets = original_source / "src/maimai_intelligence/assets"
    prefix = "pilot/maishift/browser/"
    root = baseline / "public" / prefix
    js = (root / "challenge-review.js").read_text("utf-8")
    css = (root / "challenge-review.css").read_text("utf-8")
    for name, sha in [
        ("challenge-review.js", "2f5bb1aa7b53ecffaa4291c24adc309b0dc4d02490987c411f184900dd8be71f"),
        ("chart-overview.css", "7febf6f47f06d564943269b9cb3e11498ffe8241e5ca5c28a86a2bdcc7fb0e98"),
    ]:
        raw = (old_assets / name).read_bytes()
        if digest(raw) != sha:
            raise ValueError("Original component changed")
        old, new = raw.decode("utf-8").replace("\r\n", "\n"), (assets / name).read_text("utf-8")
        bundle = js if name.endswith(".js") else css
        if bundle.count(old) != 1:
            raise ValueError("Ambiguous component boundary")
        if name.endswith(".js"):
            js = js.replace(old, new)
        else:
            css = css.replace(old, new)
    start = js.index("/* Public title aliases only.")
    end_marker = "  window.maimaiSongSearch = {query};\n})();\n"
    end = js.index(end_marker, start) + len(end_marker)
    if (
        digest(js[start:end].encode())
        != "ae14a5bcbe0024086d013fdbb30388033bd8ddfa8ff6aeac7ae938f3dad21e08"
    ):
        raise ValueError("Original search component changed")
    js = js[:start] + song_search_script() + js[end:]
    content = {
        "challenge-review.js": js.encode(),
        "challenge-review.css": css.encode(),
        "player-data.js": (assets / "player-data.js").read_text("utf-8").encode(),
        "player-data.css": (assets / "player-data.css").read_text("utf-8").encode(),
    }
    html = (root / "index.html").read_text("utf-8")
    for name, raw in content.items():
        if name == "player-data.css":
            html, count = re.subn(r'player-data\.css(?=["])', name + "?v=" + digest(raw)[:16], html)
            if count != 1:
                raise ValueError("Expected one player style reference")
            continue
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
        raise ValueError("Unexpected changes outside the five reviewed pilot assets")
    artifact = json.loads((baseline / "pilot-artifact.json").read_text("utf-8"))
    for key in changed:
        artifact["files"][key] = actual[key]
    artifact["browserBuild"] = digest(json.dumps(artifact["files"], sort_keys=True).encode())
    result = {
        "schemaVersion": "results-pilot-update-1",
        "baselineDeployment": "a41b4e99-1dd0-48cd-bdb8-1833b96a96b5",
        "changedFiles": changed,
        "preservedFiles": len(actual) - len(changed),
        "browserBuild": artifact["browserBuild"],
        "mainManifestSha256": actual["manifest.json"],
        "workerChanged": False,
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
    for flag in ("baseline", "original-source", "source", "output"):
        parser.add_argument("--" + flag, required=True)
    args = parser.parse_args()
    print(
        json.dumps(build(args.baseline, args.original_source, args.source, args.output), indent=2)
    )
