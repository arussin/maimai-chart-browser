"""Metadata source adapters normalize retained bytes before policy makes decisions."""

from __future__ import annotations

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
from .source_json import decode_source_json

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


def _object(value: object) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise SnapshotError("Expected metadata object")
    return value


def _rows(value: object) -> list[Any]:
    if not isinstance(value, list):
        raise SnapshotError("Expected metadata rows")
    return value


def _text_field(row: dict[str, Any], field: str) -> str:
    value = _optional_text(row, field)
    if value is None:
        raise SnapshotError("Missing metadata " + field)
    return value


def _reviewed_rows(data: object) -> list[dict[str, Any]]:
    document = _object(data)
    if document.get("schema_version") != "reviewed-public-metadata-1":
        raise SnapshotError("Expected reviewed public metadata extraction")
    rows = []
    for value in _rows(document.get("charts")):
        row = _object(value)
        if not _optional_text(row, "evidence") or not _text_field(row, "source_url").startswith(
            "https://"
        ):
            raise SnapshotError("Public page extraction requires evidence and its exact URL")
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
    return rows


def _arcade_rows(data: object) -> list[dict[str, Any]]:
    rows = []
    for value in _rows(_object(data).get("songs")):
        song = _object(value)
        for value in _rows(song.get("sheets")):
            sheet = _object(value)
            kind = _text_field(sheet, "type")
            if kind not in ("std", "dx") or sheet.get("isSpecial"):
                continue
            rows.append(
                {
                    "title": song.get("title"),
                    "artist": song.get("artist"),
                    "format": kind.upper(),
                    "difficulty": _text_field(sheet, "difficulty")
                    .upper()
                    .replace("REMASTER", "RE:MASTER"),
                    "bpm": song.get("bpm"),
                    # internalLevelValue is a computed printed-level fallback. Never admit it.
                    "chart_constant": sheet.get("internalLevel"),
                    "region": "JP",
                    "release": None,
                }
            )
    return rows


def _otoge_rows(data: object) -> list[dict[str, Any]]:
    rows = []
    for value in _rows(data):
        song = _object(value)
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
                        "title": song.get("title"),
                        "artist": song.get("artist"),
                        "format": fmt,
                        "difficulty": difficulty,
                        "bpm": song.get("bpm"),
                        "chart_constant": song.get(prefix + suffix + "_i"),
                        "region": "JP",
                        "release": None,
                    }
                )
    return rows


def parse_metadata(raw: bytes, provider: str) -> list[dict[str, Any]]:
    if len(raw) > MAX_BYTES or provider not in PRIORITY:
        raise SnapshotError("Unsupported metadata source or size")
    if provider == "mai-notes":
        from .catalog_sources import mai_catalog

        rows = list(mai_catalog(raw)[0].values())
    elif provider == "gamerch-wiki":
        raise SnapshotError(
            "Wiki HTML requires its exact page URL; use propose with a captured page"
        )
    else:
        data = decode_source_json(raw)
        if provider == "reviewed-page":
            rows = _reviewed_rows(data)
        elif provider == "arcade-songs":
            rows = _arcade_rows(data)
        else:
            rows = _otoge_rows(data)
    if not rows or len(rows) > 20000:
        raise SnapshotError("Invalid metadata source row count")
    for row in rows:
        _validate_identity(row)
        for field in FIELDS:
            row[field] = number(row.get(field), field)
    return rows


def normalize_builtin(provider: str, raw: bytes, metadata: dict[str, Any]) -> list[dict[str, Any]]:
    # Readers reject external data explicitly at its decoding/shape boundary.
    # Authored parser defects must abort, just as supplemental adapter defects do.
    if provider == "gamerch-wiki":
        from .catalog_sources import wiki_catalog

        return wiki_catalog(raw, metadata["url"])[0]
    return parse_metadata(raw, provider)


def builtin_adapter(provider: str, url: str) -> MetadataAdapter:
    return MetadataAdapter(
        provider, url, lambda raw, metadata: normalize_builtin(provider, raw, metadata)
    )
