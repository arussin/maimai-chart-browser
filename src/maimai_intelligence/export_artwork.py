"""Bounded export jackets supplied explicitly, independent of ordinary thumbnails."""

from __future__ import annotations

import hashlib
import json
import re
from importlib.resources import files
from pathlib import Path
from typing import Any

from .artwork import MEDIA_PATH

VERSION = "score-export-jackets-2"
MAX_ASSET_BYTES = 512 * 1024
MAX_ASSETS = 2048
MAX_TOTAL_BYTES = 512 * 1024 * 1024
MAX_MANIFEST_BYTES = 4 * 1024 * 1024
BINDING = re.compile(r"song:[a-f0-9-]{36}/(?:JP|INTL)")


def read_export_artwork_manifest() -> dict[str, Any]:
    """Read the small reviewed index; image bytes are not part of the Python package."""
    resource = files("maimai_intelligence.assets").joinpath("export-artwork/manifest.json")
    with resource.open("rb") as stream:
        raw = stream.read(MAX_MANIFEST_BYTES + 1)
    if len(raw) > MAX_MANIFEST_BYTES:
        raise ValueError("Export artwork manifest exceeds limit")
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("Invalid export artwork manifest")
    return value


def _assets(manifest: dict[str, Any]) -> dict[str, Any]:
    if manifest.get("version") != VERSION:
        raise ValueError("Unsupported export artwork manifest")
    assets, jackets = manifest.get("assets"), manifest.get("jackets")
    if (
        not isinstance(assets, dict)
        or not isinstance(jackets, dict)
        or not 0 < len(assets) <= MAX_ASSETS
        or not 0 < len(jackets) <= MAX_ASSETS * 2
    ):
        raise ValueError("Invalid export artwork inventory")
    selected = set()
    for binding, entry in jackets.items():
        if (
            not BINDING.fullmatch(binding)
            or not isinstance(entry, dict)
            or not all(isinstance(entry.get(k), str) and entry[k] for k in ("title", "artist"))
            or entry.get("path") not in assets
            or "thumbnail" not in entry
            or (
                entry["thumbnail"] is not None
                and (
                    not isinstance(entry["thumbnail"], str)
                    or not MEDIA_PATH.fullmatch(entry["thumbnail"])
                )
            )
        ):
            raise ValueError("Invalid export artwork selection")
        selected.add(entry["path"])
    if selected != set(assets):
        raise ValueError("Unreferenced export artwork asset")
    for path, asset in assets.items():
        if (
            not MEDIA_PATH.fullmatch(path)
            or not isinstance(asset, dict)
            or path != f"media/{asset.get('sha256')}.webp"
            or type(asset.get("bytes")) is not int
            or not 0 < asset["bytes"] <= MAX_ASSET_BYTES
            or any(
                type(asset.get(k)) is not int or not 128 < asset[k] <= 512
                for k in ("width", "height")
            )
        ):
            raise ValueError("Invalid export artwork asset")
    if sum(asset["bytes"] for asset in assets.values()) > MAX_TOTAL_BYTES:
        raise ValueError("Export artwork total exceeds limit")
    return assets


def read_export_artwork_assets(
    root: Path | str,
    *,
    manifest: dict[str, Any] | None = None,
    paths: set[str] | None = None,
) -> dict[str, bytes]:
    """Verify selected bytes; production verifies the entire reviewed inventory.

    Local demonstrations must explicitly select a bounded subset. No external
    URLs, provider response data or unlisted files enter the publication.
    """
    assets = _assets(manifest if manifest is not None else read_export_artwork_manifest())
    selected = set(assets) if paths is None else paths
    if not selected <= set(assets):
        raise ValueError("Unreviewed export artwork path")
    source = Path(root).resolve()
    pending: dict[str, bytes] = {}
    for path in sorted(selected):
        asset = assets[path]
        target = (source / path).resolve()
        if not target.is_relative_to(source):
            raise ValueError("Export artwork leaves its input store")
        with target.open("rb") as stream:
            raw = stream.read(MAX_ASSET_BYTES + 1)
        if (
            len(raw) != asset["bytes"]
            or hashlib.sha256(raw).hexdigest() != asset["sha256"]
            or len(raw) < 25
            or raw[:4] != b"RIFF"
            or int.from_bytes(raw[4:8], "little") != len(raw) - 8
            or raw[8:16] != b"WEBPVP8L"
            or raw[20] != 0x2F
        ):
            raise ValueError("Export artwork integrity mismatch")
        bits = int.from_bytes(raw[21:25], "little")
        if (1 + (bits & 0x3FFF), 1 + ((bits >> 14) & 0x3FFF)) != (
            asset["width"],
            asset["height"],
        ):
            raise ValueError("Export artwork dimensions differ")
        pending[path] = raw
    return pending


def copy_export_artwork(
    source: Path | str,
    output: Path | str,
    *,
    paths: set[str],
    manifest: dict[str, Any] | None = None,
) -> None:
    """Copy an explicitly selected demo subset without changing accepted catalogs."""
    pending = read_export_artwork_assets(source, manifest=manifest, paths=paths)
    root = Path(output).resolve()
    for relative, raw in pending.items():
        target = (root / relative).resolve()
        if not target.is_relative_to(root):
            raise ValueError("Export artwork leaves its output directory")
        if target.exists():
            with target.open("rb") as stream:
                if stream.read(len(raw) + 1) != raw:
                    raise ValueError("Immutable export artwork differs")
    for relative, raw in pending.items():
        target = root / relative
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("xb") as stream:
                stream.write(raw)
