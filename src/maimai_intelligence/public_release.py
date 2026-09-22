"""Prepare an allowlisted static release; no acquisition or network publication.

Catalog fragments retain the exact bytes and checksum of each accepted release.
Only public browser files, manifest-listed catalogs and validated artwork enter
the destination. Personal exports, fixtures and raw inputs cannot be swept in.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType

from .artwork import MEDIA_PATH
from .catalog_loading import MAX_CATALOG_BYTES, progressive_catalog, shared_catalog
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
    "player-import-config.js",
    "player-ranges.js",
    "player-data-core.js",
    "player-maishift.js",
    "player-sources.js",
    "player-storage.js",
    "player-data.js",
    "player-session.js",
    "catalog-query.js",
    "usage.js",
    "seo-navigation.js",
    "feature-announcements.js",
    "maishift-favicon.ico",
    "player-import-help.css",
    *(f"player-import-help.{locale}.html" for locale in ("en", "zh-Hans", "ko", "ja")),
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
        '<meta name="maimai-song-pages" content="1">\n'
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


def _browser_csp(raw):
    from html.parser import HTMLParser

    class PolicyParser(HTMLParser):
        policy = None

        def handle_starttag(self, tag, attrs):
            attrs = dict(attrs)
            if tag == "meta" and attrs.get("http-equiv", "").lower() == "content-security-policy":
                if self.policy is not None:
                    raise ValueError("Expected one browser content security policy")
                self.policy = attrs.get("content")

    parser = PolicyParser()
    parser.feed(raw.decode("utf-8"))
    return parser.policy


def _read(source, name, limit):
    path = (source / name).resolve()
    if not path.is_relative_to(source):
        raise ValueError("Public asset leaves the accepted browser directory")
    with path.open("rb") as stream:
        raw = stream.read(limit + 1)
    if len(raw) > limit:
        raise ValueError("Public asset exceeds its size limit")
    return raw


def _freeze(value):
    if isinstance(value, dict):
        return MappingProxyType({key: _freeze(item) for key, item in value.items()})
    if isinstance(value, list):
        return tuple(_freeze(item) for item in value)
    return value


def _plain(value):
    if isinstance(value, Mapping):
        return {key: _plain(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return [_plain(item) for item in value]
    return value


@dataclass(frozen=True)
class ReleasePlan:
    """Validated immutable public bytes, with publication capacity checked at write."""

    assets: Mapping
    manifest: Mapping
    summary: Mapping
    source: Path
    previous_public: Path | None = None

    def _destination(self, output):
        output = Path(output).resolve()
        for source in (self.source, self.previous_public):
            if source and (
                source == output or output.is_relative_to(source) or source.is_relative_to(output)
            ):
                raise ValueError("Public release must be separate from retained preview")
        if output.exists() and any(output.iterdir()):
            raise ValueError("Use a fresh release directory; completed releases are immutable")
        return output

    def write_to(self, output):
        output = self._destination(output)
        if not self.summary["deployable"]:
            raise ValueError(self.summary["capacity_error"])
        for name, raw in self.assets.items():
            destination = output / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            with destination.open("xb") as stream:
                stream.write(raw)
        # Never expose a final manifest before its complete verified asset closure.
        atomic_json(output / "manifest.json", _plain(self.manifest))
        return _plain(self.summary)

    def write_review_to(self, output):
        """Write a deliberately nondeployable review bundle, even over capacity."""
        output = self._destination(output)
        for name, raw in self.assets.items():
            destination = output / "planned-assets" / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            with destination.open("xb") as stream:
                stream.write(raw)
        atomic_json(output / "planned-manifest.json", _plain(self.manifest))
        atomic_json(output / "release-plan.json", _plain(self.summary))
        return _plain(self.summary)


def _retained_reference(source, reference, prefix, limit, pending):
    digest = reference.get("sha256", "") if isinstance(reference, dict) else ""
    if (
        not re.fullmatch(r"[a-f0-9]{64}", digest)
        or reference.get("path") != f"{prefix}/{digest}.json"
    ):
        raise ValueError("Invalid retained public reference")
    raw = _read(source, reference["path"], limit)
    if len(raw) != reference.get("bytes") or hashlib.sha256(raw).hexdigest() != digest:
        raise ValueError("Retained public asset integrity mismatch")
    pending[reference["path"]] = raw
    return raw


def _retain_startup(source, reference, catalog_sha, pending):
    raw = _retained_reference(source, reference, "catalog-index", MAX_BYTES, pending)
    index = json.loads(raw)
    if index.get("source_catalog_sha256") != catalog_sha or not isinstance(
        index.get("detail_buckets"), dict
    ):
        raise ValueError("Retained startup belongs to another catalog")
    shared = index.get("index_schema_version") == "catalog-index-shared-1"
    for detail in index["detail_buckets"].values():
        value = json.loads(
            _retained_reference(source, detail, "chart-details", 8 * 1024 * 1024, pending)
        )
        if shared:
            if value.get("schema_version") != "chart-details-shared-1":
                raise ValueError("Invalid retained shared chart detail")
        elif value.get("source_catalog_sha256") != catalog_sha:
            raise ValueError("Retained chart detail belongs to another catalog")


def plan_public_release(source, *, permalinks=None, song_redirects=None, previous_public=None):
    """Validate and plan without writing; an over-capacity plan is reviewable only."""
    source = Path(source).resolve()
    previous_public = Path(previous_public).resolve() if previous_public is not None else None
    previous_entries = {}
    if previous_public is not None:
        preceding = read_json(previous_public / "manifest.json")
        if preceding.get("schema_version") not in {"1.2.0", "1.3.0"} or not preceding.get(
            "releases"
        ):
            raise ValueError("Expected a preceding immutable public release")
        for entry in preceding["releases"]:
            if entry.get("version") in previous_entries:
                raise ValueError("Duplicate preceding public catalog")
            previous_entries[entry.get("version")] = entry
    manifest = read_json(source / "manifest.json")
    if manifest.get("schema_version") != "1.0.0" or not manifest.get("releases"):
        raise ValueError("Expected an accepted research browser manifest")
    pending, releases, versions = {}, [], set()
    default_catalog = None
    legacy_assets = set()
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
        if version == manifest["default"]:
            default_catalog = data
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
            "coverage",
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
        generated_startup, derived = progressive_catalog(data, sha)
        startup = generated_startup
        old = previous_entries.get(version)
        if old is not None:
            if old.get("sha256") != sha or old.get("path") != entry["path"]:
                raise ValueError("Previously published catalog identity changed")
            old_parts = old.get("parts", [])
            retained_raw = b"".join(
                _retained_reference(previous_public, ref, "catalog-parts", PART_BYTES, pending)
                for ref in old_parts
            )
            if retained_raw != raw:
                raise ValueError("Previously published catalog bytes changed")
            parts = old_parts
            startup = old.get("startup")
            before = set(pending)
            for key in ("startup", "startup_shared"):
                if old.get(key):
                    _retain_startup(previous_public, old[key], sha, pending)
            legacy_assets.update(set(pending) - before)
        else:
            pending.update(derived)
            legacy_assets.update(derived)
        shared, shared_assets = shared_catalog(data, sha, legacy=(generated_startup, derived))
        pending.update(shared_assets)
        releases.append(
            {
                **entry,
                "parts": parts,
                **({"startup": startup} if startup else {}),
                **({"startup_shared": shared} if shared else {}),
            }
        )
        for path, record in data.get("artwork", {}).get("assets", {}).items():
            if not MEDIA_PATH.fullmatch(path) or path != f"media/{record['sha256']}.webp":
                raise ValueError("Invalid public artwork path")
            art = _read(source, path, 256 * 1024)
            if len(art) != record["bytes"] or hashlib.sha256(art).hexdigest() != record["sha256"]:
                raise ValueError("Public artwork integrity mismatch")
            pending[path] = art
    if set(previous_entries) - versions:
        raise ValueError("Previously published catalogs cannot be omitted")
    if manifest.get("default") not in versions:
        raise ValueError("Missing default catalog version")
    seo_summary = {"songs": 0, "versions": 0, "localized_documents": 0}
    if default_catalog and any(
        isinstance(c, dict) and c.get("song_id") for c in default_catalog.get("catalog", [])
    ):
        from importlib.resources import files

        from .seo import build_seo

        seed = (
            Path(permalinks)
            if permalinks is not None
            else (previous_public or source) / "permalinks.json"
        )
        previous = read_json(seed) if seed.is_file() else None
        if permalinks is not None and previous is None:
            raise ValueError("The preceding permalink ledger is missing")
        redirects = (
            read_json(song_redirects) if isinstance(song_redirects, (str, Path)) else song_redirects
        )
        seo_assets, _, seo_summary = build_seo(
            default_catalog,
            previous=previous,
            song_redirects=redirects,
            browser_csp=_browser_csp(pending["index.html"]),
        )
        pending.update(seo_assets)
        for name in ("seo-pages.css", "seo-navigation.js"):
            pending[name] = files("maimai_intelligence.assets").joinpath(name).read_bytes()
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
    capacity_error = None
    if len(sizes) > MAX_PUBLIC_FILES:
        capacity_error = (
            f"Public release exceeds the Cloudflare Pages file count limit: {len(sizes)} > "
            f"{MAX_PUBLIC_FILES}; "
            f"{len(legacy_assets)} legacy index/detail assets retained, "
            f"{seo_summary['localized_documents']} localized documents. "
            "Combined launch blocked; legacy URLs were not retired."
        )
    for name, size in sizes.items():
        if size > MAX_PUBLIC_FILE_BYTES:
            raise ValueError(f"Public asset exceeds the Cloudflare Pages file size limit: {name}")
    summary = {
        "catalogs": len(releases),
        "files": len(pending) + 1,
        "default": manifest["default"],
        "largest_file_bytes": max(sizes.values()),
        "remaining_file_capacity": MAX_PUBLIC_FILES - len(sizes),
        "legacy_detail_assets": len(legacy_assets),
        "seo": seo_summary,
        "deployable": capacity_error is None,
        "capacity_error": capacity_error,
    }
    return ReleasePlan(
        _freeze(pending), _freeze(public_manifest), _freeze(summary), source, previous_public
    )


def build_public_release(
    source, output, *, permalinks=None, song_redirects=None, previous_public=None
):
    # Keep destination rejection cheap and preserve the established public API.
    source, output = Path(source).resolve(), Path(output).resolve()
    if source == output or output.is_relative_to(source) or source.is_relative_to(output):
        raise ValueError("Public release must be separate from retained preview")
    if output.exists() and any(output.iterdir()):
        raise ValueError("Use a fresh release directory; completed releases are immutable")
    return plan_public_release(
        source,
        permalinks=permalinks,
        song_redirects=song_redirects,
        previous_public=previous_public,
    ).write_to(output)
