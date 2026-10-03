"""Verified image decoding, conversion storage and legacy artwork migration."""

import hashlib
import io
import warnings
from copy import deepcopy
from pathlib import Path
from typing import Any

from .coverage_types import CaptureError, Failure, FailureKind
from .enrichment import select_artwork
from .snapshots import atomic_json, digest, read_json


def verify_asset(root: Path | str, path: str, asset: dict[str, Any]) -> bytes:
    if path != "media/" + asset.get("sha256", "") + ".webp":
        raise ValueError("Invalid persistent asset path")
    with (Path(root) / path).open("rb") as stream:
        raw = stream.read(256 * 1024 + 1)
    if (
        len(raw) != asset.get("bytes")
        or hashlib.sha256(raw).hexdigest() != asset.get("sha256")
        or raw[:4] != b"RIFF"
        or raw[8:12] != b"WEBP"
    ):
        raise ValueError("Persistent artwork integrity mismatch")
    return raw


def migrate_artwork(value, published, roots, destination):
    """Idempotent, verified migration through accepted IDs and retained aliases."""
    from .registry import resolve

    destination = Path(destination)
    # Saved accepted state remains reusable in a fresh cache when its package holds the assets.
    for song in value["songs"].values():
        for selection in song.get("enrichment", {}).get("artwork", {}).get("selected", {}).values():
            path, asset = selection["path"], selection["asset"]
            output = destination / path
            if output.exists():
                verify_asset(destination, path, asset)
                continue
            origin = next(
                (root for root in roots if root is not None and (Path(root) / path).is_file()), None
            )
            if origin is None:
                raise ValueError("Accepted artwork bytes unavailable; supply its retained package")
            raw = verify_asset(origin, path, asset)
            output.parent.mkdir(parents=True, exist_ok=True)
            with output.open("xb") as stream:
                stream.write(raw)
    artwork = published.get("artwork", {})
    songs = {}
    for c in published.get("catalog", []):
        cid = c["chart_id"]
        if cid not in value["charts"]:
            candidates = {
                r["chart_id"]
                for entries in value["legacy-ids"].values()
                for old, r in entries.items()
                if old == cid
            }
            if len(candidates) != 1:
                continue
            cid = next(iter(candidates))
        target = value["charts"][resolve(value, cid)]["song_id"]
        songs.setdefault(c["song_id"], set()).add(resolve(value, target))
    report = []
    for old, record in artwork.get("songs", {}).items():
        targets = songs.get(old, set())
        if len(targets) != 1:
            report.append({"song_id": old, "status": "ambiguous_legacy_identity"})
            continue
        sid = next(iter(targets))
        selections = {"default": record, **record.get("regions", {})}
        for scope, record in selections.items():
            if scope not in {"default", "JP", "INTL"}:
                raise ValueError("Unsupported retained regional artwork")
            path, asset = record["path"], artwork["assets"][record["path"]]
            raw = None
            for root in roots:
                if root is not None and (Path(root) / path).is_file():
                    raw = verify_asset(root, path, asset)
                    break
            if raw is None:
                report.append(
                    {"song_id": sid, "scope": scope, "status": "historical_asset_unavailable"}
                )
                continue
            output = destination / path
            output.parent.mkdir(parents=True, exist_ok=True)
            if output.exists():
                verify_asset(destination, path, asset)
            else:
                with output.open("xb") as stream:
                    stream.write(raw)
            song = value["songs"][sid]
            if not song.get("enrichment", {}).get("artwork", {}).get("selected", {}).get(scope):
                select_artwork(
                    song,
                    scope,
                    {
                        "path": path,
                        "asset": deepcopy(asset),
                        "policy": "retained-artwork-migration-1",
                        "evidence": {
                            "legacy_song_id": old,
                            "scope": scope,
                            "title": record["title"],
                            "artist": record["artist"],
                        },
                        "provenance_status": "retained"
                        if asset.get("source")
                        else "historical_source_unavailable",
                    },
                )
            report.append({"song_id": sid, "scope": scope, "status": "retained"})
    return report


def thumbnail(raw, config):
    from PIL import Image

    if not raw or len(raw) > config["image_bytes"]:
        raise ValueError("Artwork download exceeds limit")
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(raw)) as image:
            if (
                image.format not in {"PNG", "JPEG", "WEBP"}
                or not 0 < image.width * image.height <= config["image_pixels"]
            ):
                raise ValueError("Unsupported artwork dimensions or format")
            dimensions = {"width": image.width, "height": image.height}
            image.load()
            image.thumbnail(
                (config["thumbnail_pixels"], config["thumbnail_pixels"]), Image.Resampling.LANCZOS
            )
            output = io.BytesIO()
            image.convert("RGB").save(output, "WEBP", quality=config["webp_quality"], method=4)
            converted = output.getvalue()
    if len(converted) > 256 * 1024:
        raise ValueError("Artwork thumbnail exceeds limit")
    return converted, dimensions


def put_asset(raw, metadata, root, evidence, *, policy, config, codec, producer=None):
    if metadata["sha256"] in config["placeholder_sha256"]:
        raise CaptureError(
            Failure(FailureKind.UNSUPPORTED, "Recognized generic artwork placeholder")
        )
    key = digest(
        {
            "source": metadata["sha256"],
            "policy": policy,
            "conversion": config,
            **({"producer": producer} if producer is not None else {}),
        }
    )
    conversion = Path(root) / "conversions" / (key + ".json")
    if conversion.exists():
        selection = read_json(conversion)
        verify_asset(root, selection["path"], selection["asset"])
        return {
            **selection,
            "evidence": evidence,
            "asset": {
                **selection["asset"],
                "source": metadata["url"],
                "source_sha256": metadata["sha256"],
            },
        }
    try:
        converted, dimensions = codec(raw)
    except (OSError, ValueError, Warning) as error:
        raise CaptureError(Failure(FailureKind.UNSUPPORTED, str(error))) from error
    sha = hashlib.sha256(converted).hexdigest()
    path = "media/" + sha + ".webp"
    asset = {
        "sha256": sha,
        "bytes": len(converted),
        "source": metadata["url"],
        "source_sha256": metadata["sha256"],
        **dimensions,
    }
    output = Path(root) / path
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        verify_asset(root, path, asset)
    else:
        with output.open("xb") as stream:
            stream.write(converted)
    selection = {"path": path, "asset": asset, "policy": policy, "evidence": evidence}
    atomic_json(conversion, selection)
    return selection
