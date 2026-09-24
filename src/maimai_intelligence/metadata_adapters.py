"""Metadata source adapters normalize retained bytes before policy makes decisions."""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, cast

from .catalog_identity import key
from .coverage_types import SnapshotError
from .metadata_claims import (
    MetadataSourceEvidence,
    Metric,
    NormalizedMetadataRow,
    NormalizedMetadataSource,
    Region,
)
from .metadata_policy import FIELDS, PRIORITY, MetadataSourcePolicy, number

MAX_BYTES = 16 * 1024 * 1024


@dataclass(frozen=True)
class MetadataAdapter:
    provider: str
    url: str
    normalize: Callable[[bytes, dict[str, Any]], list[dict[str, Any]]]


def _optional_text(row: dict[str, Any], field: str) -> str | None:
    value = row.get(field)
    if value is not None and not isinstance(value, str):
        raise SnapshotError("Malformed metadata " + field)
    return value


def _metric(value: object, field: str) -> Metric | None:
    numeric = number(value, field)
    # Public observation IDs bind to the historic JSON representation. Validate
    # the value without re-encoding valid custom integers or numeric strings.
    return (
        cast(Metric, value) if numeric is not None and type(value) in (int, float, str) else numeric
    )


def _validate_identity(row: dict[str, Any]) -> None:
    if (
        not all(isinstance(row.get(k), str) and len(row[k]) <= 2000 for k in ("title", "artist"))
        or row.get("format") not in ("STD", "DX")
        or row.get("difficulty") not in ("BASIC", "ADVANCED", "EXPERT", "MASTER", "RE:MASTER")
        or row.get("region") not in (None, "JP", "INTL")
    ):
        raise SnapshotError("Malformed metadata identity")


def normalize_rows(rows: object) -> tuple[NormalizedMetadataRow, ...]:
    """Validate adapter outputs before a pure policy sees identities or metrics.

    Empty supplemental captures are valid no-op inputs. Historical built-in
    readers retain their stricter minimum row count. Unknown fields never gain
    identity, regional-membership, analysis or mapping authority.
    """
    if not isinstance(rows, list) or len(rows) > 20000:
        raise SnapshotError("Invalid metadata source row count")
    normalized = []
    for row in rows:
        if not isinstance(row, dict):
            raise SnapshotError("Malformed metadata row")
        _validate_identity(row)
        source_url = _optional_text(row, "source_url")
        _optional_text(row, "wiki_url")
        normalized.append(
            NormalizedMetadataRow(
                identity=key(row),
                bpm=_metric(row.get("bpm"), "bpm"),
                chart_constant=_metric(row.get("chart_constant"), "chart_constant"),
                region=cast(Region, row.get("region")),
                release=_optional_text(row, "release"),
                source_url=source_url,
                evidence=_optional_text(row, "evidence"),
                source_url_present="source_url" in row,
            )
        )
    return tuple(normalized)


def normalize_source(
    captured: dict[str, Any], policy: MetadataSourcePolicy, rows: object
) -> NormalizedMetadataSource:
    """Freeze verified capture provenance with validated supplemental claims."""
    revision = _optional_text(captured, "revision")
    return NormalizedMetadataSource(
        evidence=MetadataSourceEvidence(
            provider=captured["provider"],
            label=captured["label"],
            sha256=captured["sha256"],
            bytes=captured["bytes"],
            url=captured["url"],
            captured_at=captured["captured_at"],
            parser=captured["parser"],
            revision=revision,
            acquisition=captured["acquisition"],
        ),
        policy=policy,
        rows=normalize_rows(rows),
    )


def parse_metadata(raw: bytes, provider: str) -> list[dict[str, Any]]:
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
        _validate_identity(row)
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
