"""Build the unlisted, opt-in pilot as a separate DevCache deployment artifact."""

import argparse
import hashlib
import json
import os
import re
import shutil
from importlib.resources import files
from pathlib import Path
from tempfile import TemporaryDirectory

from maimai_intelligence.catalog_loading import MAX_CATALOG_BYTES, progressive_catalog
from maimai_intelligence.lab import build_lab
from maimai_intelligence.localization import localization_script
from maimai_intelligence.public_release import MAX_PUBLIC_FILE_BYTES, MAX_PUBLIC_FILES, PART_BYTES
from maimai_intelligence.registry import read_registry
from maimai_intelligence.registry_catalog import build_registry_package, project_registry
from maimai_intelligence.snapshots import atomic_json

PREFIX = "pilot/maishift"
UPLOAD_POLICY = (
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
    "connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
)
BROWSER_POLICY = (
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data:; connect-src 'self' https:; base-uri 'none'; "
    "frame-ancestors 'none'; form-action 'none'"
)
PILOT_HEADERS = (
    "/pilot/maishift/*\n"
    "  X-Robots-Tag: noindex, nofollow\n"
    "  Referrer-Policy: no-referrer\n"
    "  X-Content-Type-Options: nosniff\n"
    "  X-Frame-Options: DENY\n"
    "/pilot/maishift/\n"
    f"  Content-Security-Policy: {UPLOAD_POLICY}\n"
    "  Cache-Control: no-cache\n"
    "/pilot/maishift/index.html\n"
    f"  Content-Security-Policy: {UPLOAD_POLICY}\n"
    "/pilot/maishift/:asset\n"
    "  Cache-Control: no-store\n"
    "/pilot/maishift/browser/\n"
    "  Cache-Control: no-cache\n"
    "/pilot/maishift/browser/:asset\n"
    "  Cache-Control: no-store\n"
    "/pilot/maishift/browser/*\n"
    f"  Content-Security-Policy: {BROWSER_POLICY}\n"
    + "".join(
        f"/pilot/maishift/browser/{folder}/*\n"
        "  Cache-Control: public, max-age=31536000, immutable\n"
        for folder in ("catalog-index", "catalog-parts", "chart-details", "media")
    )
)


def pilot_headers():
    """Cache hashed public data; keep mutable assets fresh despite zone TTL floors."""
    return PILOT_HEADERS


def prepare_browser_catalogs(destination):
    """Use the production loader's immutable parts and on-demand chart details."""
    manifest = json.loads((destination / "manifest.json").read_text("utf-8"))
    releases, pending, originals = [], {}, []
    for entry in manifest["releases"]:
        sha = entry.get("sha256", "")
        if not re.fullmatch(r"[a-f0-9]{64}", sha) or entry.get("path") != f"catalogs/{sha}.json":
            raise ValueError("Invalid pilot catalog identity")
        original = destination / entry["path"]
        if original.stat().st_size > MAX_CATALOG_BYTES:
            raise ValueError("Pilot catalog exceeds its browser limit")
        raw = original.read_bytes()
        if hashlib.sha256(raw).hexdigest() != sha:
            raise ValueError("Pilot catalog integrity mismatch")
        parts = []
        for start in range(0, len(raw), PART_BYTES):
            part = raw[start : start + PART_BYTES]
            digest = hashlib.sha256(part).hexdigest()
            path = f"catalog-parts/{digest}.json"
            pending[path] = part
            parts.append({"path": path, "sha256": digest, "bytes": len(part)})
        startup, derived = progressive_catalog(json.loads(raw), sha)
        # The rich pilot's index can itself exceed Pages' 25 MiB limit. The
        # existing loader also accepts the complete catalog as bounded parts;
        # use that lossless path instead of trimming mappings or chart evidence.
        if startup and startup["bytes"] > MAX_PUBLIC_FILE_BYTES:
            startup = None
        else:
            pending.update(derived)
        # The isolated pilot does not publish downstream integration exports.
        public_entry = {key: value for key, value in entry.items() if key != "integration"}
        releases.append(
            {**public_entry, "parts": parts, **({"startup": startup} if startup else {})}
        )
        originals.append(original)
    if any(len(raw) > MAX_PUBLIC_FILE_BYTES for raw in pending.values()):
        raise ValueError("Pilot catalog asset exceeds the hosting file size limit")
    for name, raw in pending.items():
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
    atomic_json(
        destination / "manifest.json",
        {
            **manifest,
            "schema_version": "1.3.0"
            if any(r.get("inventory_schema") for r in releases)
            else "1.2.0",
            "releases": releases,
        },
    )
    # Only generated, hash-validated originals are removed after all parts exist.
    for original in originals:
        original.unlink()


def build_browser(output, registry, retained_package=None):
    """Compose the real browser with opt-in isolated storage, without telemetry."""
    assets = files("maimai_intelligence.assets")
    destination = output / PREFIX / "browser"
    with TemporaryDirectory(prefix="browser-package-", dir=output) as temporary:
        package = Path(temporary) / "package"
        build_registry_package(registry, retained_package, package)
        build_lab(package, destination, catalog_version="maishift-pilot-v1", player_pilot=True)
    html_path = destination / "index.html"
    html = html_path.read_text("utf-8")
    html, count = re.subn(
        r'<meta http-equiv="Content-Security-Policy" content="[^"]*">',
        f'<meta http-equiv="Content-Security-Policy" content="{BROWSER_POLICY}">',
        html,
    )
    if count != 1:
        raise ValueError("Browser policy marker changed")
    html = html.replace(
        "</head>",
        '<meta name="robots" content="noindex,nofollow">'
        '<link rel="stylesheet" href="maishift-browser-pilot.css"></head>',
    )
    # The pilot shares catalog/player code, but no payment or announcement flow.
    html = html.replace('href="support.html"', 'href="https://maimai.party/support.html"')
    html_path.write_text(html, encoding="utf-8")
    (destination / "maishift-browser-pilot.css").write_bytes(
        assets.joinpath("maishift-browser-pilot.css").read_text("utf-8").encode("utf-8")
    )
    # Only files referenced by this standalone browser are part of its artifact.
    allowed = {
        "index.html",
        "manifest.json",
        "localization.js",
        "settings-menu.js",
        "maishift-browser-pilot.js",
        "maishift-browser-pilot.css",
        "player-import-config.js",
        "player-ranges.js",
        "player-data-core.js",
        "player-maishift.js",
        "player-sources.js",
        "player-storage.js",
        "player-session.js",
        "player-data.js",
        "view-navigation.js",
        "challenge-review.js",
        "challenge-review.css",
        "lab-loader.js",
        "maishift-favicon.ico",
        "player-import-help.css",
        *(f"player-import-help.{locale}.html" for locale in ("en", "zh-Hans", "ko", "ja")),
    }
    for path in destination.iterdir():
        if path.is_file() and path.name not in allowed:
            path.unlink()
    # The browser uses its catalog manifest; downstream integration exports are
    # not part of this private-by-convention test surface.
    integration = destination / "integration"
    if integration.exists():
        assert integration.resolve().is_relative_to(output)
        shutil.rmtree(integration)
    prepare_browser_catalogs(destination)


def build(output, source=None, *, retained_package=None):
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
    registry = read_registry(source / "registry")
    projected = project_registry(registry, {})
    mapping = projected["maishift_mapping"]
    wanted = {row["chart_id"] for row in mapping["charts"].values()}
    targets = {
        row["chart_id"]: {key: row[key] for key in ("chart_id", "format", "difficulty")}
        for row in projected["catalog"]
        if row["chart_id"] in wanted
    }
    assets = files("maimai_intelligence.assets")
    content = {
        # Git may check text out as LF or CRLF. Artifact identities must not
        # depend on the platform or whether a file was just staged.
        target: assets.joinpath(name).read_text("utf-8").encode("utf-8")
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
    build_browser(output, registry, retained_package)
    # Merge these path-scoped headers during deployment; never replace the live
    # site's existing header file. No live release files are modified here.
    (output / "_headers").write_text(pilot_headers(), encoding="utf-8")
    public_files = [path for path in destination.rglob("*") if path.is_file()] + [
        output / "_headers"
    ]
    if len(public_files) > MAX_PUBLIC_FILES:
        raise ValueError("Pilot exceeds the hosting file count limit")
    if any(path.stat().st_size > MAX_PUBLIC_FILE_BYTES for path in public_files):
        raise ValueError("Pilot asset exceeds the hosting file size limit")
    manifest = {
        "schemaVersion": "maishift-pilot-artifact-1",
        "build": config["build"],
        "proposedOrigin": "https://maimai.party",
        "entryPath": "/pilot/maishift/",
        "browserPath": "/pilot/maishift/browser/",
        "endpoint": "/api/player-import/maishift",
        "files": {
            path.relative_to(output).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(destination.rglob("*"))
            if path.is_file()
        },
        "releaseEnabled": False,
    }
    manifest["files"]["_headers"] = hashlib.sha256((output / "_headers").read_bytes()).hexdigest()
    manifest["browserBuild"] = hashlib.sha256(
        json.dumps(manifest["files"], sort_keys=True).encode("utf-8")
    ).hexdigest()
    (output / "pilot-artifact.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--retained-package",
        type=Path,
        help="Verified retained package for jackets and prepared charts",
    )
    args = parser.parse_args()
    print(json.dumps(build(args.output, retained_package=args.retained_package)))
