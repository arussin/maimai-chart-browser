"""Prepare an allowlisted static release; no acquisition or network publication.

Catalog fragments retain the exact bytes and checksum of each accepted release.
Only public browser files, manifest-listed catalogs and validated artwork enter
the destination. Personal exports, fixtures and raw inputs cannot be swept in.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from .artwork import MEDIA_PATH
from .catalog_loading import MAX_CATALOG_BYTES, progressive_catalog
from .mai_notes import validate_links
from .provider_mapping import validate_mapping
from .snapshots import MAX_BYTES, atomic_json, canonical, read_json

PART_BYTES = 8 * 1024 * 1024
# Cloudflare Pages Direct Upload limits, including retained releases.
MAX_PUBLIC_FILE_BYTES = 25 * 1024 * 1024
MAX_PUBLIC_FILES = 20_000
SEARCH_TITLE = "maimai Chart Database & Patterns | maimai.party"
SEARCH_DESCRIPTION = (
    "Explore maimai and maimai DX song data, chart constants, BPM, and chart patterns. "
    "Compare charts and view your imported personal results."
)
CANONICAL_URL = "https://maimai.party/"
PUBLIC_FILES = (
    "index.html",
    "localization.js",
    "localization.css",
    "challenge-review.css",
    "challenge-review.js",
    "lab-loader.js",
    "analytics.js",
    "settings-menu.js",
    "support-config.js",
    "support-client.js",
    "support-stripe.js",
    "support-checkout.css",
    "support.html",
    "support-page.js",
    "support-page.css",
    "site-brand.css",
    "support-footer.css",
    "support-return.html",
    "support-return.js",
    "stripe-wordmark.svg",
    "view-navigation.js",
    "player-data-core.js",
    "player-maishift.js",
    "player-sources.js",
    "player-storage.js",
    "player-data.js",
    "feature-announcements.js",
)


def _search_metadata(raw):
    """Describe the public app without adding or changing any page-body content."""
    from html import escape

    html = raw.decode("utf-8")
    if html.count("</head>") != 1 or len(re.findall(r"<title>.*?</title>", html, re.S)) != 1:
        raise ValueError("Expected a single public page head and title")
    title, description = escape(SEARCH_TITLE, quote=True), escape(SEARCH_DESCRIPTION, quote=True)
    html = re.sub(r"<title>.*?</title>", f"<title>{title}</title>", html, count=1, flags=re.S)
    metadata = (
        f'<meta name="description" content="{description}">\n'
        f'<link rel="canonical" href="{CANONICAL_URL}">\n'
        '<meta property="og:type" content="website">\n'
        '<meta property="og:site_name" content="maimai.party">\n'
        f'<meta property="og:title" content="{title}">\n'
        f'<meta property="og:description" content="{description}">\n'
        f'<meta property="og:url" content="{CANONICAL_URL}">\n'
        '<meta name="twitter:card" content="summary">\n'
        f'<meta name="twitter:title" content="{title}">\n'
        f'<meta name="twitter:description" content="{description}">\n'
    )
    return html.replace("</head>", metadata + "</head>").encode("utf-8")


def _read(source, name, limit):
    path = (source / name).resolve()
    if not path.is_relative_to(source):
        raise ValueError("Public asset leaves the accepted browser directory")
    with path.open("rb") as stream:
        raw = stream.read(limit + 1)
    if len(raw) > limit:
        raise ValueError("Public asset exceeds its size limit")
    return raw


def build_public_release(source, output):
    source, output = Path(source).resolve(), Path(output).resolve()
    if source == output or output.is_relative_to(source) or source.is_relative_to(output):
        raise ValueError("Public release must be separate from retained preview")
    if output.exists() and any(output.iterdir()):
        raise ValueError("Use a fresh release directory; completed releases are immutable")
    manifest = read_json(source / "manifest.json")
    if manifest.get("schema_version") != "1.0.0" or not manifest.get("releases"):
        raise ValueError("Expected an accepted research browser manifest")
    pending, releases, versions = {}, [], set()
    for name in PUBLIC_FILES:
        pending[name] = _read(source, name, 2 * 1024 * 1024)
    pending["index.html"] = _search_metadata(pending["index.html"])
    # The current public app has one canonical document. Do not submit every
    # filter, comparison pair, personal state, or retained catalog version.
    pending["robots.txt"] = (
        f"User-agent: *\nAllow: /\n\nSitemap: {CANONICAL_URL}sitemap.xml\n".encode()
    )
    pending["sitemap.xml"] = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"  <url><loc>{CANONICAL_URL}</loc></url>\n"
        "</urlset>\n"
    ).encode()
    if b"maimaiCatalogDetails" not in pending["lab-loader.js"]:
        raise ValueError("Rebuild the browser with progressive loading before publishing")
    for entry in manifest["releases"]:
        sha, version = entry.get("sha256"), entry.get("version")
        if (
            not isinstance(sha, str)
            or not re.fullmatch(r"[a-f0-9]{64}", sha)
            or entry.get("path") != f"catalogs/{sha}.json"
            or not isinstance(version, str)
            or not version
            or version in versions
        ):
            raise ValueError("Invalid or duplicate research release identity")
        versions.add(version)
        raw = _read(source, entry["path"], MAX_CATALOG_BYTES)
        if hashlib.sha256(raw).hexdigest() != sha:
            raise ValueError("Accepted catalog integrity mismatch")
        data = json.loads(raw)
        if data.get("package", {}).get("status") != "research_preview":
            raise ValueError("Only nonpersonal research catalogs belong in this release")
        if set(data) - {
            "package",
            "catalog",
            "review",
            "snippets",
            "benchmark_hash",
            "navigation",
            "analysis",
            "artwork",
            "mai_notes",
            "provider_mapping",
            "maishift_mapping",
            "schema_version",
            "registry",
            "legacy_ids",
            "sources",
        }:
            raise ValueError("Unexpected fields in public research catalog")
        if "schema_version" in data:
            from .registry_catalog import validate_catalog

            validate_catalog(data)
        elif "navigation" in data:
            from .registry_catalog import validate_genres

            validate_genres(data)
        if "mai_notes" in data:
            validate_links(data["mai_notes"], data["catalog"])
        if "provider_mapping" in data:
            validate_mapping(data["provider_mapping"], data["catalog"])
        if "maishift_mapping" in data:
            from .maishift_mapping import validate_mapping as validate_maishift

            validate_maishift(data["maishift_mapping"], data["catalog"])
        if "integration" in entry:
            ref = entry["integration"]
            if ref.get("path") != f"integration/{ref.get('sha256')}.json" or not re.fullmatch(
                r"[a-f0-9]{64}", ref.get("sha256", "")
            ):
                raise ValueError("Invalid integration catalog reference")
            integration = _read(source, ref["path"], MAX_BYTES)
            if (
                len(integration) != ref.get("bytes")
                or hashlib.sha256(integration).hexdigest() != ref["sha256"]
            ):
                raise ValueError("Integration catalog integrity mismatch")
            from .provider_mapping import integration_catalog

            if integration != canonical(integration_catalog(data, version)):
                raise ValueError("Integration data differs from public chart catalog")
            pending[ref["path"]] = integration
        parts = []
        for start in range(0, len(raw), PART_BYTES):
            part = raw[start : start + PART_BYTES]
            digest = hashlib.sha256(part).hexdigest()
            path = f"catalog-parts/{digest}.json"
            pending[path] = part
            parts.append({"path": path, "sha256": digest, "bytes": len(part)})
        startup, derived = progressive_catalog(data, sha)
        pending.update(derived)
        releases.append({**entry, "parts": parts, **({"startup": startup} if startup else {})})
        for path, record in data.get("artwork", {}).get("assets", {}).items():
            if not MEDIA_PATH.fullmatch(path) or path != f"media/{record['sha256']}.webp":
                raise ValueError("Invalid public artwork path")
            art = _read(source, path, 256 * 1024)
            if len(art) != record["bytes"] or hashlib.sha256(art).hexdigest() != record["sha256"]:
                raise ValueError("Public artwork integrity mismatch")
            pending[path] = art
    if manifest.get("default") not in versions:
        raise ValueError("Missing default catalog version")
    # A fixed local redirect preserves every query/fragment in plain static hosts.
    pending["lab/index.html"] = (
        b'<!doctype html><html lang="en"><meta charset="utf-8">'
        b'<meta name="referrer" content="no-referrer">'
        b'<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; '
        b"script-src 'self'; base-uri 'none'\">"
        b'<title>maimai.party</title><a href="/">Open the chart browser</a>'
        b'<script src="/lab-redirect.js"></script></html>'
    )
    pending["lab-redirect.js"] = b"location.replace('/'+location.search+location.hash);\n"
    pending["_headers"] = (
        b"/integration/*\n  Cache-Control: public, max-age=31536000, immutable\n"
        b"/catalog-parts/*\n  Cache-Control: public, max-age=31536000, immutable\n"
        b"/catalog-index/*\n  Cache-Control: public, max-age=31536000, immutable\n"
        b"/chart-details/*\n  Cache-Control: public, max-age=31536000, immutable\n"
        b"/media/*\n  Cache-Control: public, max-age=31536000, immutable\n"
        b"/manifest.json\n  Cache-Control: no-cache\n"
        b"/robots.txt\n  Content-Type: text/plain; charset=utf-8\n  Cache-Control: no-cache\n"
        b"/sitemap.xml\n  Content-Type: application/xml; charset=utf-8\n  Cache-Control: no-cache\n"
        b"/support-*\n  Cache-Control: no-store\n"
        b"/support\n  Cache-Control: no-store\n  X-Robots-Tag: noindex, nofollow\n"
        b"  Content-Security-Policy: frame-ancestors 'none'\n"
        b"/support.html\n  Cache-Control: no-store\n  X-Robots-Tag: noindex, nofollow\n"
        b"  Content-Security-Policy: frame-ancestors 'none'\n"
        b"/support-return\n  Cache-Control: no-store\n  X-Robots-Tag: noindex, nofollow\n"
        b"  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; "
        b"img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; "
        b"frame-ancestors 'none'\n"
        b"/support-return.html\n  X-Robots-Tag: noindex, nofollow\n"
        b"  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; "
        b"img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; "
        b"frame-ancestors 'none'\n"
        b"/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n"
        b"  Permissions-Policy: payment=(self "
        b'"https://checkout.stripe.com" "https://js.stripe.com" "https://hooks.stripe.com")\n'
    )
    public_manifest = {
        **manifest,
        "schema_version": "1.3.0" if any(r.get("inventory_schema") for r in releases) else "1.2.0",
        "releases": releases,
    }
    sizes = {name: len(raw) for name, raw in pending.items()}
    sizes["manifest.json"] = len(canonical(public_manifest)) + 1
    if len(sizes) > MAX_PUBLIC_FILES:
        raise ValueError("Public release exceeds the Cloudflare Pages file count limit")
    for name, size in sizes.items():
        if size > MAX_PUBLIC_FILE_BYTES:
            raise ValueError(f"Public asset exceeds the Cloudflare Pages file size limit: {name}")
    # Do all validation before writing; the manifest is always written last.
    for name, raw in pending.items():
        destination = output / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("xb") as stream:
            stream.write(raw)
    atomic_json(output / "manifest.json", public_manifest)
    return {
        "catalogs": len(releases),
        "files": len(pending) + 1,
        "default": manifest["default"],
        "largest_file_bytes": max(sizes.values()),
    }
