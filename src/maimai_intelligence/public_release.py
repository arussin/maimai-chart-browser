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
from dataclasses import dataclass, field
from pathlib import Path
from types import MappingProxyType
from typing import TYPE_CHECKING, Any, cast

from .artwork import MEDIA_PATH
from .catalog_document import CatalogDocument, decode_catalog_document, validate_catalog_reference
from .catalog_loading import (
    MAX_CATALOG_BYTES,
    encode_catalog_projection,
    prepare_catalog_projection,
)
from .corpus_failures import PublicationCapacityError
from .publication_capacity import PAID_FILES, ReviewedCapacity
from .release_assembly import assemble_release as assemble_release
from .release_composition import plan_release_composition as plan_release_composition
from .snapshots import MAX_BYTES, atomic_json, canonical, read_json
from .song_catalog import validate_song_binding, validate_song_membership

if TYPE_CHECKING:
    from .seo import PreparedSEO

PART_BYTES = 8 * 1024 * 1024
INDEX_PART_BYTES = 8 * 1024 * 1024
# Cloudflare Pages Direct Upload limits, including retained releases.
MAX_PUBLIC_FILE_BYTES = 25 * 1024 * 1024
STARTUP_PART_THRESHOLD = MAX_PUBLIC_FILE_BYTES
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


def _browser_assets(source: Path) -> dict[str, bytes]:
    """Copy only the generated application graph and reviewed static entry points."""
    if not (source / "browser-assets.json").is_file():
        assets = {name: _read(source, name, 2 * 1024 * 1024) for name in PUBLIC_FILES}
        if b"maimaiCatalogDetails" not in assets["lab-loader.js"]:
            raise ValueError("Rebuild the browser with progressive loading before publishing")
        return assets
    from .browser_bundle import read_browser_assets

    manifest, assets = read_browser_assets(lambda name, limit: _read(source, name, limit))
    if (
        set(manifest["replaces"])
        - {name for name in PUBLIC_FILES if name.endswith(".js")}
        - {"maishift-browser-pilot.js"}
    ):
        raise ValueError("Unknown superseded browser entry point")
    assets.update(
        {
            name: _read(source, name, 2 * 1024 * 1024)
            for name in PUBLIC_FILES
            if name not in manifest["replaces"]
        }
    )
    for name in ("browser-config.json", "browser-shell.html"):
        assets[name] = _read(source, name, 2 * 1024 * 1024)
    if (source / "browser-resources.json").is_file():
        assets["browser-resources.json"] = _read(source, "browser-resources.json", 16 * 1024)
    return assets


def _search_metadata(raw: bytes) -> bytes:
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


def _browser_csp(raw: bytes) -> str | None:
    from html.parser import HTMLParser

    class PolicyParser(HTMLParser):
        policy: str | None = None

        def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
            values = dict(attrs)
            if (
                tag == "meta"
                and (values.get("http-equiv") or "").lower() == "content-security-policy"
            ):
                if self.policy is not None:
                    raise ValueError("Expected one browser content security policy")
                self.policy = values.get("content")

    parser = PolicyParser()
    parser.feed(raw.decode("utf-8"))
    return parser.policy


def _read(source: Path, name: str, limit: int) -> bytes:
    path = (source / name).resolve()
    if not path.is_relative_to(source):
        raise ValueError("Public asset leaves the accepted browser directory")
    with path.open("rb") as stream:
        raw = stream.read(limit + 1)
    if len(raw) > limit:
        raise ValueError("Public asset exceeds its size limit")
    return raw


def _freeze(value: Any) -> Any:
    if isinstance(value, dict):
        return MappingProxyType({key: _freeze(item) for key, item in value.items()})
    if isinstance(value, list):
        return tuple(_freeze(item) for item in value)
    return value


def _plain(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {key: _plain(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return [_plain(item) for item in value]
    return value


@dataclass(frozen=True)
class ReleasePlan:
    """Validated immutable public bytes, with publication capacity checked at write."""

    assets: Mapping[str, bytes]
    manifest: Mapping[str, Any]
    summary: Mapping[str, Any]
    source: Path
    previous_public: Path | None = None
    capacity: ReviewedCapacity | None = None
    # Private preparation result for derived recovery artifacts. It never enters
    # public assets/summary and does not require another SEO preparation pass.
    prepared_seo: PreparedSEO | None = field(default=None, repr=False, compare=False)

    def _destination(self, output: Path | str) -> Path:
        output = Path(output).resolve()
        for source in (self.source, self.previous_public):
            if source and (
                source == output or output.is_relative_to(source) or source.is_relative_to(output)
            ):
                raise ValueError("Public release must be separate from retained preview")
        if output.exists() and any(output.iterdir()):
            raise ValueError("Use a fresh release directory; completed releases are immutable")
        return output

    def write_to(self, output: Path | str) -> dict[str, Any]:
        output = self._destination(output)
        if not self.summary["deployable"]:
            raise PublicationCapacityError(self.summary["capacity_error"])
        if self.capacity is not None:
            self.capacity.require_current()
        for name, raw in self.assets.items():
            destination = output / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            with destination.open("xb") as stream:
                stream.write(raw)
        # Never expose a final manifest before its complete verified asset closure.
        atomic_json(output / "manifest.json", _plain(self.manifest))
        return cast(dict[str, Any], _plain(self.summary))

    def write_review_to(self, output: Path | str) -> dict[str, Any]:
        """Write a deliberately nondeployable review bundle, even over capacity."""
        output = self._destination(output)
        for name, raw in self.assets.items():
            destination = output / "planned-assets" / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            with destination.open("xb") as stream:
                stream.write(raw)
        atomic_json(output / "planned-manifest.json", _plain(self.manifest))
        atomic_json(output / "release-plan.json", _plain(self.summary))
        return cast(dict[str, Any], _plain(self.summary))


def _retained_reference(
    source: Path, reference: dict[str, Any], prefix: str, limit: int, pending: dict[str, bytes]
) -> bytes:
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


def _read_retained_catalog(source: Path, entry: dict[str, Any], pending: dict[str, bytes]) -> bytes:
    """Read exact published bytes through the maintained reference verifier."""
    validate_catalog_reference(entry)
    if "parts" in entry:
        parts = entry["parts"]
        if not isinstance(parts, list) or not 1 <= len(parts) <= 8:
            raise ValueError("Invalid retained catalog parts")
        raw = b"".join(
            _retained_reference(source, ref, "catalog-parts", PART_BYTES, pending) for ref in parts
        )
    else:
        raw = _read(source, entry["path"], MAX_CATALOG_BYTES)
        pending[entry["path"]] = raw
    if len(raw) > MAX_CATALOG_BYTES or hashlib.sha256(raw).hexdigest() != entry["sha256"]:
        raise ValueError("Retained catalog integrity mismatch")
    return raw


def read_public_catalog_inputs(
    source: Path | str, entry: dict[str, Any]
) -> tuple[bytes, bytes | None]:
    """Verify published multipart/full catalog and integration bytes without preparing again."""
    source = Path(source).resolve()
    pending: dict[str, bytes] = {}
    raw = _read_retained_catalog(source, entry, pending)
    integration = (
        _retained_reference(source, entry["integration"], "integration", MAX_BYTES, pending)
        if "integration" in entry
        else None
    )
    return raw, integration


def _retain_song_index(
    source: Path,
    reference: dict[str, Any],
    catalog_sha: str,
    pending: dict[str, bytes],
    catalog: dict[str, Any],
) -> None:
    index = json.loads(
        _retained_reference(source, reference, "song-catalog-index", MAX_PUBLIC_FILE_BYTES, pending)
    )
    if (
        index.get("schema_version")
        not in {"maimai-song-catalog-index-1", "maimai-song-catalog-index-2"}
        or index.get("source_catalog_sha256") != catalog_sha
        or not isinstance(index.get("assets"), list)
    ):
        raise ValueError("Retained song index belongs to another catalog")
    seen = set()
    for asset in index["assets"]:
        raw = _retained_reference(source, asset, "song-catalog", PART_BYTES, pending)
        if asset["path"] in seen:
            raise ValueError("Duplicate retained song asset")
        seen.add(asset["path"])
        envelope = json.loads(raw)
        if index["schema_version"] == "maimai-song-catalog-index-2":
            validate_song_binding(asset, catalog_sha, envelope)
            validate_song_membership(envelope, catalog)
        elif (
            envelope.get("schema_version") != "maimai-song-catalog-1"
            or envelope.get("data", {}).get("source_catalog_sha256") != catalog_sha
        ):
            raise ValueError("Retained song asset belongs to another catalog")


def _retain_index_details(
    source: Path, index: dict[str, Any], catalog_sha: str, pending: dict[str, bytes]
) -> None:
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


def _retain_startup(
    source: Path, reference: dict[str, Any], catalog_sha: str, pending: dict[str, bytes]
) -> None:
    raw = _retained_reference(source, reference, "catalog-index", MAX_BYTES, pending)
    _retain_index_details(source, json.loads(raw), catalog_sha, pending)


def _multipart_startup(raw: bytes, catalog_sha: str, pending: dict[str, bytes]) -> dict[str, Any]:
    parts = []
    for start in range(0, len(raw), INDEX_PART_BYTES):
        part = raw[start : start + INDEX_PART_BYTES]
        digest = hashlib.sha256(part).hexdigest()
        path = f"catalog-index-parts/{digest}.json"
        pending[path] = part
        parts.append({"path": path, "sha256": digest, "bytes": len(part)})
    return {
        "schema_version": "catalog-index-shared-1",
        "source_catalog_sha256": catalog_sha,
        "sha256": hashlib.sha256(raw).hexdigest(),
        "bytes": len(raw),
        "parts": parts,
    }


def _retain_startup_parts(
    source: Path, reference: dict[str, Any], catalog_sha: str, pending: dict[str, bytes]
) -> None:
    if (
        not isinstance(reference, dict)
        or set(reference) != {"schema_version", "source_catalog_sha256", "sha256", "bytes", "parts"}
        or reference.get("schema_version") != "catalog-index-shared-1"
        or reference.get("source_catalog_sha256") != catalog_sha
        or not re.fullmatch(r"[a-f0-9]{64}", str(reference.get("sha256", "")))
        or type(reference.get("bytes")) is not int
        or not 0 < reference["bytes"] <= MAX_BYTES
        or not isinstance(reference.get("parts"), list)
        or not 1 <= len(reference["parts"]) <= 4
    ):
        raise ValueError("Invalid retained multipart startup")
    raw = b"".join(
        _retained_reference(source, part, "catalog-index-parts", INDEX_PART_BYTES, pending)
        for part in reference["parts"]
    )
    if len(raw) != reference["bytes"] or hashlib.sha256(raw).hexdigest() != reference["sha256"]:
        raise ValueError("Retained multipart startup integrity mismatch")
    index = json.loads(raw)
    if index.get("index_schema_version") != reference["schema_version"]:
        raise ValueError("Retained multipart startup schema mismatch")
    _retain_index_details(source, index, catalog_sha, pending)


@dataclass(frozen=True)
class RetainedPublication:
    source: Path | None
    entries: Mapping[str, dict[str, Any]]
    default: str | None
    ledger: dict[str, Any] | None
    advertised_seo: bool


@dataclass(frozen=True)
class PreparedPublicCatalog:
    version: str
    data: dict[str, Any]
    release: dict[str, Any]
    assets: Mapping[str, bytes]
    legacy_assets: frozenset[str]
    had_song_pages: bool


@dataclass(frozen=True)
class PreparedPublicPages:
    assets: Mapping[str, bytes]
    summary: dict[str, int]
    song_index: dict[str, Any] | None = None
    seo: PreparedSEO | None = None


def _load_retained_publication(previous_public: Path | None) -> RetainedPublication:
    previous_entries = {}
    previous_ledger_ref = None
    previous_advertised_seo = False
    preceding = {}
    if previous_public is not None:
        preceding = read_json(previous_public / "manifest.json")
        if preceding.get("schema_version") not in {"1.2.0", "1.3.0"} or not preceding.get(
            "releases"
        ):
            raise ValueError("Expected a preceding immutable public release")
        previous_ledger_ref = preceding.get("permalinks")
        previous_advertised_seo = b"maimai-song-pages" in _read(
            previous_public, "index.html", 2 * 1024 * 1024
        )
        for entry in preceding["releases"]:
            if entry.get("version") in previous_entries:
                raise ValueError("Duplicate preceding public catalog")
            previous_entries[entry.get("version")] = entry
    return RetainedPublication(
        previous_public,
        previous_entries,
        preceding.get("default"),
        previous_ledger_ref,
        previous_advertised_seo,
    )


def _prepare_browser_shell(source: Path) -> dict[str, bytes]:
    pending = _browser_assets(source)
    pending["index.html"] = _search_metadata(pending["index.html"])
    if "browser-shell.html" in pending:
        pending["browser-shell.html"] = _search_metadata(pending["browser-shell.html"])
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
        b"/catalog-index-parts/*\n  Cache-Control: public, max-age=31536000, immutable\n"
        b"/catalog-index/*\n  Cache-Control: public, max-age=31536000, immutable\n"
        b"/chart-details/*\n  Cache-Control: public, max-age=31536000, immutable\n"
        b"/song-catalog/*\n  Cache-Control: public, max-age=31536000, immutable\n"
        b"/song-catalog-index/*\n  Cache-Control: public, max-age=31536000, immutable\n"
        b"/media/*\n  Cache-Control: public, max-age=31536000, immutable\n"
        b"/browser-resources/*\n  Cache-Control: public, max-age=31536000, immutable\n"
        b"/browser/*\n  Cache-Control: no-cache\n"
        b"/browser-assets.json\n  Cache-Control: no-cache\n"
        b"/browser-config.json\n  Cache-Control: no-cache\n"
        b"/browser-shell.html\n  Cache-Control: no-cache\n"
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
    return pending


def _prepare_public_catalog(
    source: Path,
    entry: dict[str, Any],
    retained: RetainedPublication,
    document: CatalogDocument | None = None,
) -> PreparedPublicCatalog:
    pending: dict[str, bytes] = {}
    legacy_assets: set[str] = set()
    previous_had_song_pages = False
    previous_public = retained.source
    if document is None:
        validate_catalog_reference(entry)
        raw = _read(source, entry["path"], MAX_CATALOG_BYTES)
        integration = (
            _read(source, entry["integration"]["path"], MAX_BYTES)
            if "integration" in entry
            else None
        )
        document = decode_catalog_document(entry, raw, integration)
    else:
        document.require_binding(entry)
    raw, data = document.raw, document.data
    sha, version = entry["sha256"], entry["version"]
    if document.integration is not None:
        pending[entry["integration"]["path"]] = document.integration
    parts = []
    for start in range(0, len(raw), PART_BYTES):
        part = raw[start : start + PART_BYTES]
        digest = hashlib.sha256(part).hexdigest()
        path = f"catalog-parts/{digest}.json"
        pending[path] = part
        parts.append({"path": path, "sha256": digest, "bytes": len(part)})
    projection = prepare_catalog_projection(data, sha)
    generated_startup, derived = encode_catalog_projection(projection)
    shared, shared_assets = encode_catalog_projection(projection, shared=True)
    # A historical reader can always fall back to the full catalog parts.
    # Do not emit an oversized legacy index even when the shared index fits.
    if generated_startup and generated_startup["bytes"] > MAX_PUBLIC_FILE_BYTES:
        derived.pop(generated_startup["path"])
        generated_startup = None
    startup_parts = None
    startup_part_assets: dict[str, bytes] = {}
    if shared and shared["bytes"] > STARTUP_PART_THRESHOLD:
        startup_parts = _multipart_startup(
            shared_assets.pop(shared["path"]), sha, startup_part_assets
        )
        # Old readers ignore the additive reference and use the full catalog parts.
        if generated_startup:
            derived.pop(generated_startup["path"])
        generated_startup = shared = None
    startup = generated_startup
    old = retained.entries.get(version)
    song_indexes: list[dict[str, Any]] = []
    if old is not None:
        if previous_public is None:
            raise ValueError("Retained publication requires its verified source")
        if version == retained.default and retained.advertised_seo:
            previous_had_song_pages = any(
                isinstance(chart, dict) and chart.get("song_id")
                for chart in data.get("catalog", [])
            )
        if old.get("sha256") != sha or old.get("path") != entry["path"]:
            raise ValueError("Previously published catalog identity changed")
        old_parts = old.get("parts", parts)
        retained_raw = _read_retained_catalog(previous_public, old, pending)
        if retained_raw != raw:
            raise ValueError("Previously published catalog bytes changed")
        parts = old_parts
        startup = old.get("startup")
        before = set(pending)
        for key in ("startup", "startup_shared"):
            if old.get(key):
                _retain_startup(previous_public, old[key], sha, pending)
        if old.get("startup_parts"):
            _retain_startup_parts(previous_public, old["startup_parts"], sha, pending)
            startup_parts = old["startup_parts"]
            startup_part_assets.clear()
        if shared is None and old.get("startup_shared"):
            shared = old["startup_shared"]
        song_indexes = old.get("song_catalog_indexes", [])
        if not isinstance(song_indexes, list):
            raise ValueError("Invalid retained song catalog indexes")
        for reference in song_indexes:
            _retain_song_index(previous_public, reference, sha, pending, data)
        legacy_assets.update(set(pending) - before)
    else:
        pending.update(derived)
        legacy_assets.update(derived)
    pending.update(shared_assets)
    pending.update(startup_part_assets)
    release = {
        **entry,
        "parts": parts,
        **({"startup": startup} if startup else {}),
        **({"startup_shared": shared} if shared else {}),
        **({"startup_parts": startup_parts} if startup_parts else {}),
        **({"song_catalog_indexes": song_indexes} if song_indexes else {}),
    }
    for path, record in data.get("artwork", {}).get("assets", {}).items():
        if not MEDIA_PATH.fullmatch(path) or path != f"media/{record['sha256']}.webp":
            raise ValueError("Invalid public artwork path")
        art = _read(source, path, 256 * 1024)
        if len(art) != record["bytes"] or hashlib.sha256(art).hexdigest() != record["sha256"]:
            raise ValueError("Public artwork integrity mismatch")
        pending[path] = art
    return PreparedPublicCatalog(
        version, data, release, pending, frozenset(legacy_assets), previous_had_song_pages
    )


def _prepare_public_pages(
    source: Path,
    default_catalog: dict[str, Any] | None,
    retained: RetainedPublication,
    previous_had_song_pages: bool,
    permalinks: Path | str | None,
    song_redirects: Path | str | dict[str, str] | None,
    browser_csp: str | None,
    catalog_sha: str,
) -> PreparedPublicPages:
    pending: dict[str, bytes] = {}
    previous_public, previous_ledger_ref = retained.source, retained.ledger
    seo_summary = {"songs": 0, "versions": 0, "localized_documents": 0}
    song_assets: list[dict[str, Any]] = []
    seo = None
    if default_catalog and any(
        isinstance(c, dict) and c.get("song_id") for c in default_catalog.get("catalog", [])
    ):
        from importlib.resources import files

        from .seo import prepare_seo

        seed = (
            Path(permalinks)
            if permalinks is not None
            else (previous_public or source) / "permalinks.json"
        )
        previous = read_json(seed) if seed.is_file() else None
        if (
            permalinks is not None or previous_had_song_pages or previous_ledger_ref
        ) and previous is None:
            raise ValueError("The preceding permalink ledger is missing")
        if previous_ledger_ref is not None:
            raw_ledger = _read(seed.parent, seed.name, 2 * 1024 * 1024)
            if (
                not isinstance(previous_ledger_ref, dict)
                or set(previous_ledger_ref) != {"path", "sha256", "bytes"}
                or previous_ledger_ref["path"] != "permalinks.json"
                or previous_ledger_ref["sha256"] != hashlib.sha256(raw_ledger).hexdigest()
                or previous_ledger_ref["bytes"] != len(raw_ledger)
            ):
                raise ValueError("The preceding permalink ledger integrity differs")
        redirects = (
            read_json(song_redirects) if isinstance(song_redirects, (str, Path)) else song_redirects
        )
        seo = prepare_seo(
            default_catalog,
            previous=previous,
            song_redirects=redirects,
            browser_csp=browser_csp,
            catalog_sha=catalog_sha,
        )
        pending.update(seo.assets)
        seo_summary, song_assets = seo.summary, seo.song_bindings
        for name in ("seo-pages.css",):
            pending[name] = files("maimai_intelligence.assets").joinpath(name).read_bytes()
    song_index = None
    if song_assets:
        raw = canonical(
            {
                "schema_version": "maimai-song-catalog-index-2",
                "source_catalog_sha256": catalog_sha,
                "assets": song_assets,
            }
        )
        digest = hashlib.sha256(raw).hexdigest()
        path = f"song-catalog-index/{digest}.json"
        pending[path] = raw
        song_index = {"path": path, "sha256": digest, "bytes": len(raw)}
    return PreparedPublicPages(pending, seo_summary, song_index, seo)


def _finalize_release_plan(
    source: Path,
    previous_public: Path | None,
    manifest: dict[str, Any],
    pending: dict[str, bytes],
    releases: list[dict[str, Any]],
    legacy_assets: set[str],
    seo_summary: dict[str, int],
    capacity: ReviewedCapacity | None,
    file_limit: int,
    prepared_seo: PreparedSEO | None = None,
) -> ReleasePlan:
    public_manifest = {
        **manifest,
        "schema_version": "1.3.0" if any(r.get("inventory_schema") for r in releases) else "1.2.0",
        "releases": releases,
    }
    if "permalinks.json" in pending:
        ledger = pending["permalinks.json"]
        public_manifest["permalinks"] = {
            "path": "permalinks.json",
            "sha256": hashlib.sha256(ledger).hexdigest(),
            "bytes": len(ledger),
        }
    from .browser_bundle import seal_browser_resources

    pending = seal_browser_resources(pending, public_manifest)
    sizes = {name: len(raw) for name, raw in pending.items()}
    sizes["manifest.json"] = len(canonical(public_manifest)) + 1
    capacity_error = None
    if len(sizes) > file_limit:
        capacity_error = (
            f"Public release exceeds the Cloudflare Pages file count limit: {len(sizes)} > "
            f"{file_limit}; "
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
        "remaining_file_capacity": file_limit - len(sizes),
        "capacity": capacity.receipt()
        if capacity
        else {"profile": "pages-default", "max_files": MAX_PUBLIC_FILES},
        "legacy_detail_assets": len(legacy_assets),
        "seo": seo_summary,
        "deployable": capacity_error is None,
        "capacity_error": capacity_error,
    }
    return ReleasePlan(
        _freeze(pending),
        _freeze(public_manifest),
        _freeze(summary),
        source,
        previous_public,
        capacity,
        prepared_seo,
    )


def plan_public_release(
    source: Path | str,
    *,
    permalinks: Path | str | None = None,
    song_redirects: Path | str | dict[str, str] | None = None,
    previous_public: Path | str | None = None,
    capacity: ReviewedCapacity | None = None,
    prepared_catalogs: Mapping[str, CatalogDocument] | None = None,
) -> ReleasePlan:
    """Prepare shell, verified catalogs, public routes, then the complete release inventory."""
    source = Path(source).resolve()
    if capacity is not None:
        if not isinstance(capacity, ReviewedCapacity):
            raise ValueError("Paid capacity requires a reviewed capacity object")
        capacity.require_current()
    file_limit = PAID_FILES if capacity is not None else MAX_PUBLIC_FILES
    previous = Path(previous_public).resolve() if previous_public is not None else None
    retained = _load_retained_publication(previous)
    manifest = read_json(source / "manifest.json")
    if manifest.get("schema_version") != "1.0.0" or not manifest.get("releases"):
        raise ValueError("Expected an accepted research browser manifest")
    documents = dict(prepared_catalogs or {})
    pending = _prepare_browser_shell(source)
    releases: list[dict[str, Any]] = []
    versions: set[str] = set()
    legacy_assets: set[str] = set()
    default_catalog = None
    previous_had_song_pages = False
    for entry in manifest["releases"]:
        if entry.get("version") in versions:
            raise ValueError("Invalid or duplicate research release identity")
        catalog = _prepare_public_catalog(
            source, entry, retained, documents.pop(entry.get("version"), None)
        )
        versions.add(catalog.version)
        pending.update(catalog.assets)
        releases.append(catalog.release)
        legacy_assets.update(catalog.legacy_assets)
        previous_had_song_pages |= catalog.had_song_pages
        if catalog.version == manifest["default"]:
            default_catalog = catalog.data
    if documents:
        raise ValueError("Unused prepared catalog documents")
    if set(retained.entries) - versions:
        raise ValueError("Previously published catalogs cannot be omitted")
    if manifest.get("default") not in versions:
        raise ValueError("Missing default catalog version")
    pages = _prepare_public_pages(
        source,
        default_catalog,
        retained,
        previous_had_song_pages,
        permalinks,
        song_redirects,
        _browser_csp(pending["index.html"]),
        next(entry["sha256"] for entry in releases if entry["version"] == manifest["default"]),
    )
    pending.update(pages.assets)
    if pages.song_index:
        current = next(entry for entry in releases if entry["version"] == manifest["default"])
        indexes = current.setdefault("song_catalog_indexes", [])
        if pages.song_index not in indexes:
            current["song_catalog_indexes"] = [*indexes, pages.song_index]
    return _finalize_release_plan(
        source,
        previous,
        manifest,
        pending,
        releases,
        legacy_assets,
        pages.summary,
        capacity,
        file_limit,
        pages.seo,
    )


def build_public_release(
    source: Path | str,
    output: Path | str,
    *,
    permalinks: Path | str | None = None,
    song_redirects: Path | str | None = None,
    previous_public: Path | str | None = None,
    capacity: ReviewedCapacity | None = None,
    prepared_catalogs: Mapping[str, CatalogDocument] | None = None,
) -> dict[str, Any]:
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
        capacity=capacity,
        prepared_catalogs=prepared_catalogs,
    ).write_to(output)
