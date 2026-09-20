"""Build static website assets and immutable, allowlisted public catalogs."""

from __future__ import annotations

import hashlib
import json
from importlib.resources import files
from pathlib import Path

from maimai_analyzer.wire import encode_pack

from .bundles import catalog_reference
from .explorer import _OVERLAY, validate_exploration_pack
from .io import atomic_write_text
from .snapshots import SCHEMA_VERSION, atomic_json, canonical, read_json
from .song_search import song_search_script


def build_site(pack, output, *, catalog_version, lab_package=None):
    checked = validate_exploration_pack(pack)
    reference = catalog_reference(checked, catalog_version)
    root = Path(output)
    root.mkdir(parents=True, exist_ok=True)
    # Personal bundles and raw captures cannot pass the public catalog allowlist.
    payload = canonical(encode_pack(checked))
    sha = hashlib.sha256(payload).hexdigest()
    relative = f"catalogs/{sha}.json"
    destination = root / relative
    if destination.exists() and destination.read_bytes() != payload:
        raise ValueError("An immutable catalog asset differs")
    if not destination.exists():
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("xb") as stream:
            stream.write(payload)
    manifest_path = root / "manifest.json"
    manifest = (
        read_json(manifest_path)
        if manifest_path.exists()
        else {
            "schema_version": SCHEMA_VERSION,
            "catalogs": [],
        }
    )
    if manifest.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unsupported site manifest")
    entry = {
        **reference,
        "path": relative,
        "bytes": len(payload),
        "label": checked["catalog_id"],
        "evaluation_only": checked.get("evaluation_only", False),
    }
    matches = [
        x
        for x in manifest["catalogs"]
        if (x["id"], x["version"]) == (reference["id"], catalog_version)
    ]
    if matches and matches != [entry]:
        raise ValueError(
            "Catalog release already exists with different content; choose a new version"
        )
    if not matches:
        manifest["catalogs"].append(entry)
    manifest["default"] = {"id": reference["id"], "version": catalog_version}
    assets = files("maimai_intelligence.assets")
    asset_dir = root / "assets"
    asset_dir.mkdir(exist_ok=True)
    atomic_write_text(asset_dir / "song-search.js", song_search_script())
    theme = json.loads(assets.joinpath("chart-theme.json").read_text("utf-8"))
    for name in (
        "explore.js",
        "explore-wire.js",
        "explore-similarity.js",
        "chart-visuals.js",
        "site.js",
        "site.css",
        "site-brand.css",
        "support-footer.css",
        "support-checkout.css",
        "support-config.js",
        "support-client.js",
        "support-stripe.js",
        "stripe-wordmark.svg",
        "analytics.css",
        "analytics.js",
        "settings-menu.js",
        "index.html",
    ):
        content = assets.joinpath(name).read_text("utf-8")
        content = content.replace("__MAIMAI_CHART_THEME__", json.dumps(theme))
        if name == "index.html":
            content = content.replace(
                "__FAVICON__", assets.joinpath("favicon.html").read_text("utf-8")
            )
            for script in (
                "settings-menu.js",
                "analytics.js",
                "support-config.js",
                "support-client.js",
                "support-stripe.js",
            ):
                revision = hashlib.sha256(
                    assets.joinpath(script).read_text("utf-8").encode("utf-8")
                ).hexdigest()[:16]
                content = content.replace(f"assets/{script}", f"assets/{script}?v={revision}")
            style = assets.joinpath("support-checkout.css").read_text("utf-8")
            revision = hashlib.sha256(style.encode("utf-8")).hexdigest()[:16]
            content = content.replace(
                "assets/support-checkout.css", f"assets/support-checkout.css?v={revision}"
            )
            content = content.replace(
                "__SETTINGS_MENU__", assets.joinpath("settings-menu.html").read_text("utf-8")
            )
            content = content.replace(
                "__SITE_BRAND__", assets.joinpath("site-brand.html").read_text("utf-8")
            )
            content = content.replace(
                "__SUPPORT_FOOTER__",
                assets.joinpath("support-footer.html")
                .read_text("utf-8")
                .replace(
                    "__CREATOR_SUPPORT__",
                    assets.joinpath("creator-support.html").read_text("utf-8"),
                )
                + assets.joinpath("analytics-controls.html").read_text("utf-8"),
            )
        atomic_write_text(
            root / "index.html" if name == "index.html" else asset_dir / name, content
        )
    variables = {f"--chart-flow-{i}": color for i, color in enumerate(theme["flow_colors"])}
    variables.update({f"--chart-difficulty-{k}": v for k, v in theme["difficulty_colors"].items()})
    css = ":root{" + ";".join(f"{k}:{v}" for k, v in variables.items()) + "}\n"
    css += "\n".join(
        assets.joinpath(name).read_text("utf-8")
        for name in ("styles.css", "chart-visuals.css", "explore.css")
    )
    atomic_write_text(asset_dir / "explorer.css", css)
    atomic_json(asset_dir / "overlay-schema.json", _OVERLAY)
    if lab_package is not None:
        from .lab import build_lab
        from .snapshots import digest

        version = "research-" + digest(read_json(Path(lab_package) / "package.json"))[:12]
        build_lab(lab_package, root / "lab", catalog_version=version)
        manifest["research_lab"] = {"version": version, "path": "lab/"}
    atomic_json(manifest_path, manifest)
    return root / "index.html"
