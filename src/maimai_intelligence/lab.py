"""Build the versioned, nonpersonal research chart browser."""

from __future__ import annotations

import hashlib
import json
import re
from importlib.resources import files
from pathlib import Path

from maimai_analyzer.dataset import SOURCE_LOCK

from .artwork import copy_artwork, validate_artwork
from .challenge_review import render_review, review_scripts
from .io import atomic_write_text
from .mai_notes import validate_links
from .research_overview import validate_overview
from .snapshots import MAX_BYTES, atomic_json, canonical, read_json


def build_lab(package_directory, output, *, catalog_version):
    source, root = Path(package_directory), Path(output)
    package = read_json(source / "package.json")
    if package.get("status") != "research_preview" or package.get("source") != SOURCE_LOCK:
        raise ValueError("Challenge Lab requires the existing pinned nonpersonal research package")
    records = {entry["path"]: entry for entry in package["files"]}
    loaded = {}
    for name in (
        "catalog.json",
        "review.json",
        "snippets.json",
        "benchmark.json",
        "navigation.json",
    ) + tuple(
        name for name in ("analysis.json", "artwork.json", "mai-notes.json") if name in records
    ):
        record = records[name]
        with (source / name).open("rb") as stream:
            raw = stream.read(MAX_BYTES + 1)
        if (
            len(raw) > MAX_BYTES
            or len(raw) != record["bytes"]
            or hashlib.sha256(raw).hexdigest() != record["sha256"]
        ):
            raise ValueError("Challenge package integrity mismatch")
        loaded[name] = json.loads(raw)
    overview = loaded.get("analysis.json")
    if overview is not None:
        validate_overview(overview, loaded["catalog.json"])
    artwork = loaded.get("artwork.json")
    if artwork is not None:
        validate_artwork(artwork, loaded["catalog.json"], loaded["navigation.json"]["versions"])
        copy_artwork(artwork, source, root)
    mai_notes = loaded.get("mai-notes.json")
    if mai_notes is not None:
        validate_links(mai_notes, loaded["catalog.json"])
    html = render_review(
        package,
        loaded["catalog.json"],
        loaded["review.json"],
        loaded["snippets.json"],
        loaded["benchmark.json"],
        loaded["navigation.json"],
        overview,
        artwork,
        mai_notes,
    )
    data_match = re.search(
        r'<script id="challenge-data" type="application/json">(.*?)</script>', html, re.S
    )
    data = canonical(json.loads(data_match[1]))
    if len(data) > MAX_BYTES:
        raise ValueError("Research catalog exceeds 32 MiB")
    sha = hashlib.sha256(data).hexdigest()
    root.mkdir(parents=True, exist_ok=True)
    (root / "catalogs").mkdir(exist_ok=True)
    destination = root / "catalogs" / f"{sha}.json"
    if destination.exists() and destination.read_bytes() != data:
        raise ValueError("Immutable research catalog differs")
    if not destination.exists():
        with destination.open("xb") as stream:
            stream.write(data)
    manifest_path = root / "manifest.json"
    manifest = (
        read_json(manifest_path)
        if manifest_path.exists()
        else {"schema_version": "1.0.0", "releases": []}
    )
    entry = {"version": catalog_version, "sha256": sha, "path": f"catalogs/{sha}.json"}
    prior = [r for r in manifest["releases"] if r["version"] == catalog_version]
    if prior and prior != [entry]:
        raise ValueError("Research release version already names different content")
    if not prior:
        manifest["releases"].append(entry)
    manifest["default"] = catalog_version
    assets = files("maimai_intelligence.assets")
    early_scripts = []
    for name in ("settings-menu.js", "analytics.js", "support-checkout.js"):
        content = assets.joinpath(name).read_text("utf-8")
        atomic_write_text(root / name, content)
        revision = hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]
        early_scripts.append(f'<script defer src="{name}?v={revision}"></script>')
    view_script = assets.joinpath("view-navigation.js").read_text("utf-8")
    view_revision = hashlib.sha256(view_script.encode("utf-8")).hexdigest()[:16]
    atomic_write_text(root / "view-navigation.js", view_script)
    scripts = review_scripts()
    script_revision = hashlib.sha256(scripts.encode("utf-8")).hexdigest()[:16]
    loader = (
        assets.joinpath("lab-loader.js")
        .read_text("utf-8")
        .replace("challenge-review.js", f"challenge-review.js?v={script_revision}")
    )
    loader_revision = hashlib.sha256(loader.encode("utf-8")).hexdigest()[:16]
    atomic_write_text(root / "challenge-review.js", scripts)
    atomic_write_text(root / "lab-loader.js", loader)
    styles = (
        assets.joinpath("challenge-review.css").read_text("utf-8")
        + "\n"
        + assets.joinpath("chart-visuals.css").read_text("utf-8")
        + "\n"
        + assets.joinpath("pattern-lessons.css").read_text("utf-8")
        + "\n"
        + assets.joinpath("chart-overview.css").read_text("utf-8")
        + "\n"
        + assets.joinpath("chart-filters.css").read_text("utf-8")
        + "\n"
        + assets.joinpath("support-footer.css").read_text("utf-8")
        + "\n"
        + assets.joinpath("support-checkout.css").read_text("utf-8")
        + "\n"
        + assets.joinpath("site-brand.css").read_text("utf-8")
        + "\n"
        + assets.joinpath("analytics.css").read_text("utf-8")
    )
    style_revision = hashlib.sha256(styles.encode("utf-8")).hexdigest()[:16]
    atomic_write_text(root / "challenge-review.css", styles)
    html = re.sub(
        r"<style>.*?</style>",
        f'<link rel="stylesheet" href="challenge-review.css?v={style_revision}">',
        html,
        flags=re.S,
    )
    html = (
        html[: html.index('<script id="challenge-data"')]
        + f'<script defer src="lab-loader.js?v={loader_revision}"></script></body></html>'
    )
    html = html.replace(
        "<body>", '<body><p id="lab-status" role="status">Loading research catalog…</p>'
    )
    html = html.replace(
        "<title>",
        '<meta name="referrer" content="no-referrer">'
        '<meta http-equiv="Content-Security-Policy" content="'
        "default-src 'none'; script-src 'self' https://www.googletagmanager.com/gtag/js "
        "https://static.cloudflareinsights.com/beacon.min.js "
        "https://static.cloudflareinsights.com/beacon.min.js/; "
        "style-src 'self' 'unsafe-inline'; "
        "connect-src 'self' https://www.google-analytics.com https://region1.google-analytics.com "
        "https://cloudflareinsights.com; "
        "img-src 'self' data: https://www.google-analytics.com "
        "https://region1.google-analytics.com; "
        "object-src 'none'; base-uri 'none'; frame-src https://buymeacoffee.com; "
        "form-action 'none'"
        '">\n<title>',
    )
    html = html.replace(
        "</head>",
        f'<link rel="preload" as="script" href="challenge-review.js?v={script_revision}">'
        f'<script defer src="view-navigation.js?v={view_revision}"></script>'
        + "".join(early_scripts)
        + "</head>",
    )
    atomic_write_text(root / "index.html", html)
    atomic_json(manifest_path, manifest)
    return root / "index.html"
