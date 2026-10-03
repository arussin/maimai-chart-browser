"""Optional public display artwork. No artwork match qualifies a personal chart mapping.

Exact title/artist matching follows maimai_report.artwork (Codex / arussin).
Downloads and image conversion happen only during explicit package preparation.
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from copy import deepcopy
from importlib.resources import files
from pathlib import Path

VERSION = "public-artwork-1"
IMAGE_NAME = re.compile(r"[A-Za-z0-9_-]+\.(?:png|jpg|jpeg)", re.IGNORECASE)
MEDIA_PATH = re.compile(r"media/[a-f0-9]{64}\.webp")
CATALOGUE_URL = "https://maimai.sega.jp/data/maimai_songs.json"
JACKET_BASE = "https://maimaidx-eng.com/maimai-mobile/img/Music/"


def normalize(value):
    return " ".join(unicodedata.normalize("NFKC", str(value or "")).casefold().split())


def match_jackets(charts, catalogue):
    index, identities = {}, {}
    for row in catalogue:
        title, artist, name = (
            normalize(row.get("title")),
            normalize(row.get("artist")),
            row.get("image_url"),
        )
        if title and artist and isinstance(name, str) and IMAGE_NAME.fullmatch(name):
            index.setdefault((title, artist), set()).add(name)
    for chart in charts:
        identities.setdefault(chart["song_id"], set()).add((chart["title"], chart["artist"]))
    matches = {}
    for song_id, candidates in identities.items():
        if len(candidates) != 1:
            continue
        title, artist = next(iter(candidates))
        names = index.get((normalize(title), normalize(artist)), set())
        if len(names) == 1:
            matches[song_id] = {"title": title, "artist": artist, "filename": next(iter(names))}
    return matches


def validate_artwork(value, catalog, versions):
    if value.get("version") != VERSION:
        raise ValueError("Unsupported public artwork version")
    identities = {}
    for chart in catalog:
        identities.setdefault(chart["song_id"], set()).add((chart["title"], chart["artist"]))
    assets = value["assets"]
    for path, record in assets.items():
        if (
            not MEDIA_PATH.fullmatch(path)
            or path != f"media/{record['sha256']}.webp"
            or not 0 < record["bytes"] <= 256 * 1024
        ):
            raise ValueError("Invalid public artwork asset")
    for song_id, record in value["songs"].items():
        if identities.get(song_id) != {(record["title"], record["artist"])}:
            raise ValueError("Artwork identity differs from catalog")
        if record["path"] not in assets:
            raise ValueError("Missing public artwork asset")
        for region, selection in record.get("regions", {}).items():
            if region not in {"JP", "INTL"} or selection.get("path") not in assets:
                raise ValueError("Invalid regional public artwork selection")
            regional = {
                (
                    c.get("regional", {})
                    .get(region, {})
                    .get("metadata", {})
                    .get("title", c["title"]),
                    c.get("regional", {})
                    .get(region, {})
                    .get("metadata", {})
                    .get("artist", c["artist"]),
                )
                for c in catalog
                if c["song_id"] == song_id
            }
            if regional != {(selection.get("title"), selection.get("artist"))}:
                raise ValueError("Regional artwork identity differs from catalog")
    for version, path in value["versions"].items():
        if version not in versions or path not in assets:
            raise ValueError("Invalid version artwork mapping")
    return value


def copy_artwork(value, source, output):
    """Verify every file before publishing; images are served from this site only."""
    pending = []
    for relative, record in value["assets"].items():
        roots = source if isinstance(source, (tuple, list)) else (source,)
        path = next(
            (
                Path(root) / relative
                for root in roots
                if root is not None and (Path(root) / relative).is_file()
            ),
            None,
        )
        if path is None:
            raise ValueError("Public artwork asset unavailable")
        with path.open("rb") as stream:
            raw = stream.read(256 * 1024 + 1)
        if (
            len(raw) != record["bytes"]
            or hashlib.sha256(raw).hexdigest() != record["sha256"]
            or raw[:4] != b"RIFF"
            or raw[8:12] != b"WEBP"
        ):
            raise ValueError("Public artwork integrity mismatch")
        destination = Path(output) / relative
        if destination.exists() and destination.read_bytes() != raw:
            raise ValueError("Immutable public artwork differs")
        pending.append((destination, raw))
    for destination, raw in pending:
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists():
            with destination.open("xb") as stream:
                stream.write(raw)


def prepare_artwork(value, source, output, catalog, versions):
    """Every version uses the same verified manifest and same-site media path."""
    value = (
        deepcopy(value)
        if value
        else {"version": VERSION, "assets": {}, "songs": {}, "versions": {}}
    )
    validate_artwork(value, catalog, versions)
    copy_artwork(value, source, output)
    bundled = files("maimai_intelligence.assets").joinpath("version-artwork")
    logos = json.loads(bundled.joinpath("manifest.json").read_text("utf-8"))
    # A retained package can supply newer artwork. The bundled collection fills
    # missing versions, including inventory-only builds, without UI exceptions.
    logos["versions"] = {
        name: path
        for name, path in logos["versions"].items()
        if name in versions and name not in value["versions"]
    }
    used = set(logos["versions"].values())
    logos["assets"] = {path: record for path, record in logos["assets"].items() if path in used}
    validate_artwork(logos, catalog, versions)
    copy_artwork(logos, bundled, output)
    value["assets"].update(logos["assets"])
    value["versions"].update(logos["versions"])
    return validate_artwork(value, catalog, versions)
