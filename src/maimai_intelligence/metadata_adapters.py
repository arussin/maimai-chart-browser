"""Metadata source adapters normalize retained bytes before policy makes decisions."""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from .coverage_types import SnapshotError
from .metadata_policy import FIELDS, PRIORITY, number

MAX_BYTES = 16 * 1024 * 1024


@dataclass(frozen=True)
class MetadataAdapter:
    provider: str
    url: str
    normalize: Callable[[bytes, dict[str, Any]], list[dict[str, Any]]]


def parse_metadata(raw, provider):
    if len(raw) > MAX_BYTES or provider not in PRIORITY:
        raise ValueError("Unsupported metadata source or size")
    data = json.loads(raw)
    rows = []
    if provider == "mai-notes":
        from .catalog_sources import mai_catalog

        rows = list(mai_catalog(raw)[0].values())
    elif provider == "gamerch-wiki":
        raise ValueError("Wiki HTML requires its exact page URL; use propose with a captured page")
    elif provider == "reviewed-page":
        if data.get("schema_version") != "reviewed-public-metadata-1":
            raise ValueError("Expected reviewed public metadata extraction")
        for row in data["charts"]:
            if not row.get("evidence") or not row.get("source_url", "").startswith("https://"):
                raise ValueError("Public page extraction requires evidence and its exact URL")
            rows.append(
                {
                    k: row.get(k)
                    for k in (
                        "title",
                        "artist",
                        "format",
                        "difficulty",
                        "bpm",
                        "chart_constant",
                        "region",
                        "release",
                        "source_url",
                        "evidence",
                    )
                }
            )
    elif provider == "arcade-songs":
        for song in data["songs"]:
            for sheet in song["sheets"]:
                if sheet["type"] not in {"std", "dx"} or sheet.get("isSpecial"):
                    continue
                rows.append(
                    {
                        "title": song["title"],
                        "artist": song["artist"],
                        "format": sheet["type"].upper(),
                        "difficulty": sheet["difficulty"].upper().replace("REMASTER", "RE:MASTER"),
                        "bpm": song.get("bpm"),
                        # internalLevelValue is a computed printed-level fallback. Never admit it.
                        "chart_constant": sheet.get("internalLevel"),
                        "region": "JP",
                        "release": None,
                    }
                )
    else:
        for song in data:
            if song.get("lev_utage"):
                continue
            for fmt, prefix in (("STD", "lev_"), ("DX", "dx_lev_")):
                for suffix, difficulty in (
                    ("bas", "BASIC"),
                    ("adv", "ADVANCED"),
                    ("exp", "EXPERT"),
                    ("mas", "MASTER"),
                    ("remas", "RE:MASTER"),
                ):
                    if not song.get(prefix + suffix):
                        continue
                    rows.append(
                        {
                            "title": song["title"],
                            "artist": song["artist"],
                            "format": fmt,
                            "difficulty": difficulty,
                            "bpm": song.get("bpm"),
                            "chart_constant": song.get(prefix + suffix + "_i"),
                            "region": "JP",
                            "release": None,
                        }
                    )
    if not rows or len(rows) > 20000:
        raise ValueError("Invalid metadata source row count")
    for row in rows:
        if (
            not all(
                isinstance(row.get(k), str) and len(row[k]) <= 2000 for k in ("title", "artist")
            )
            or row["format"] not in {"STD", "DX"}
            or row["difficulty"] not in {"BASIC", "ADVANCED", "EXPERT", "MASTER", "RE:MASTER"}
            or row.get("region") not in {None, "JP", "INTL"}
        ):
            raise ValueError("Malformed metadata identity")
        for field in FIELDS:
            row[field] = number(row.get(field), field)
    return rows


def normalize_builtin(provider: str, raw: bytes, metadata: dict[str, Any]) -> list[dict[str, Any]]:
    # This compatibility reader confines historical provider schema failures.
    # Additional adapters must raise SnapshotError explicitly for rejected input;
    # their programming errors are never converted into provider outages.
    try:
        if provider == "gamerch-wiki":
            from .catalog_sources import wiki_catalog

            return wiki_catalog(raw, metadata["url"])[0]
        return parse_metadata(raw, provider)
    except (ValueError, TypeError, KeyError, AttributeError) as error:
        raise SnapshotError("Malformed " + provider + " metadata") from error


def builtin_adapter(provider: str, url: str) -> MetadataAdapter:
    return MetadataAdapter(
        provider, url, lambda raw, metadata: normalize_builtin(provider, raw, metadata)
    )
