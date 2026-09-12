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
from .catalog_loading import progressive_catalog
from .snapshots import MAX_BYTES, atomic_json, read_json

PART_BYTES = 8 * 1024 * 1024
PUBLIC_FILES = (
    "index.html",
    "challenge-review.css",
    "challenge-review.js",
    "lab-loader.js",
    "analytics.js",
)


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
        raw = _read(source, entry["path"], MAX_BYTES)
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
        }:
            raise ValueError("Unexpected fields in public research catalog")
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
        b"/catalog-parts/*\n  Cache-Control: public, max-age=31536000, immutable\n"
        b"/catalog-index/*\n  Cache-Control: public, max-age=31536000, immutable\n"
        b"/chart-details/*\n  Cache-Control: public, max-age=31536000, immutable\n"
        b"/media/*\n  Cache-Control: public, max-age=31536000, immutable\n"
        b"/manifest.json\n  Cache-Control: no-cache\n"
        b"/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n"
    )
    # Do all validation before writing; the manifest is always written last.
    for name, raw in pending.items():
        destination = output / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("xb") as stream:
            stream.write(raw)
    atomic_json(
        output / "manifest.json", {**manifest, "schema_version": "1.2.0", "releases": releases}
    )
    return {
        "catalogs": len(releases),
        "files": len(pending) + 1,
        "default": manifest["default"],
        "largest_file_bytes": max(map(len, pending.values())),
    }
