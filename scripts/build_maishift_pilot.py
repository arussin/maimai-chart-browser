"""Build the unlisted, opt-in pilot as a separate DevCache deployment artifact."""

import argparse
import hashlib
import json
import os
from importlib.resources import files
from pathlib import Path

from maimai_intelligence.localization import localization_script
from maimai_intelligence.registry import read_registry
from maimai_intelligence.registry_catalog import project_registry

PREFIX = "pilot/maishift"


def build(output, source=None):
    output = Path(output).resolve()
    runner_temp = (
        os.environ.get("RUNNER_TEMP") if os.environ.get("GITHUB_ACTIONS") == "true" else None
    )
    in_ci_temp = (
        runner_temp
        and output.is_relative_to(Path(runner_temp).resolve())
        and output != Path(runner_temp).resolve()
    )
    if not str(output).lower().startswith("c:\\devcache\\") and not in_ci_temp:
        raise ValueError("Pilot artifacts must be built in DevCache")
    source = Path(source or Path(__file__).resolve().parents[1])
    destination = output / PREFIX
    if output.exists() and any(output.iterdir()):
        raise ValueError("Use a new empty output directory; never overwrite a release")
    projected = project_registry(read_registry(source / "registry"), {})
    mapping = projected["maishift_mapping"]
    wanted = {row["chart_id"] for row in mapping["charts"].values()}
    targets = {
        row["chart_id"]: {key: row[key] for key in ("chart_id", "format", "difficulty")}
        for row in projected["catalog"]
        if row["chart_id"] in wanted
    }
    assets = files("maimai_intelligence.assets")
    content = {
        target: assets.joinpath(name).read_bytes()
        for target, name in {
            "index.html": "maishift-pilot.html",
            "pilot.css": "maishift-pilot.css",
            "pilot.js": "maishift-pilot.js",
            "pilot-core.js": "maishift-pilot-core.js",
            "player-data-core.js": "player-data-core.js",
            "player-maishift.js": "player-maishift.js",
            "localization.css": "localization.css",
        }.items()
    }
    pilot_messages = json.loads(assets.joinpath("locales/maishift-pilot.json").read_text("utf-8"))
    sources = set(pilot_messages["messages"]) | {
        "Game region",
        "International",
        "Japan",
        "Language",
    }
    content["localization.js"] = localization_script(sources=sources).encode("utf-8")
    config = {"schemaVersion": "maishift-pilot-build-1", "mapping": mapping, "targets": targets}
    encoded = json.dumps(config, ensure_ascii=False, sort_keys=True).encode("utf-8")
    fingerprint = hashlib.sha256(encoded)
    for name, value in sorted(content.items()):
        fingerprint.update(name.encode("utf-8"))
        fingerprint.update(value)
    config["build"] = fingerprint.hexdigest()
    content["mapping.json"] = json.dumps(config, ensure_ascii=False, separators=(",", ":")).encode(
        "utf-8"
    )
    if len(content["mapping.json"]) > 12 * 1024 * 1024:
        raise ValueError("Pilot mapping exceeds its browser limit")
    destination.mkdir(parents=True)
    for name, value in content.items():
        (destination / name).write_bytes(value)
    # Merge these path-scoped headers during deployment; never replace the live
    # site's existing header file. No live release files are modified here.
    (output / "_headers").write_text(
        "/pilot/maishift/*\n"
        "  X-Robots-Tag: noindex, nofollow\n"
        "  Referrer-Policy: no-referrer\n"
        "  Cache-Control: no-store\n"
        "  X-Content-Type-Options: nosniff\n"
        "  X-Frame-Options: DENY\n"
        "  Content-Security-Policy: default-src 'none'; script-src 'self'; "
        "style-src 'self'; img-src 'self' data:; connect-src 'self'; "
        "base-uri 'none'; frame-ancestors 'none'; form-action 'none'\n",
        encoding="utf-8",
    )
    manifest = {
        "schemaVersion": "maishift-pilot-artifact-1",
        "build": config["build"],
        "proposedOrigin": "https://maimai.party",
        "entryPath": "/pilot/maishift/",
        "endpoint": "/api/player-import/maishift",
        "files": {
            f"{PREFIX}/{name}": hashlib.sha256(value).hexdigest()
            for name, value in sorted(content.items())
        },
        "releaseEnabled": False,
    }
    manifest["files"]["_headers"] = hashlib.sha256((output / "_headers").read_bytes()).hexdigest()
    (output / "pilot-artifact.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    print(json.dumps(build(parser.parse_args().output)))
