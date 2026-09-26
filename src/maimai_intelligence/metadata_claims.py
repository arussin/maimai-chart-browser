"""Pure exact matching and supplemental claims from validated immutable inputs."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Literal

from .metadata_policy import MetadataSourcePolicy
from .serialization import digest

VERSION = "metadata-waterfall-1"
IdentityKey = tuple[str, str, str, str]
# Historical supplemental adapters may encode a valid numeric value as text.
# Normalization validates its numeric meaning while preserving its bound bytes.
Metric = int | float | str
Region = Literal["JP", "INTL"] | None
Field = Literal["bpm", "chart_constant"]


@dataclass(frozen=True)
class CanonicalChartIdentity:
    chart_id: str
    identity: IdentityKey


@dataclass(frozen=True)
class NormalizedMetadataRow:
    identity: IdentityKey
    bpm: Metric | None
    chart_constant: Metric | None
    region: Region = None
    release: str | None = None
    source_url: str | None = None
    evidence: str | None = None
    source_url_present: bool = False


@dataclass(frozen=True)
class MetadataSourceEvidence:
    provider: str
    label: str
    sha256: str
    bytes: int
    url: str
    captured_at: str
    parser: str
    revision: str | None
    acquisition: str

    @property
    def snapshot_id(self) -> str:
        return self.provider + ":" + self.sha256

    def record(self) -> dict[str, object]:
        return {
            "provider": self.provider,
            "label": self.label,
            "sha256": self.sha256,
            "bytes": self.bytes,
            "url": self.url,
            "captured_at": self.captured_at,
            "parser": self.parser,
            "revision": self.revision,
            "acquisition": self.acquisition,
        }


@dataclass(frozen=True)
class NormalizedMetadataSource:
    evidence: MetadataSourceEvidence
    policy: MetadataSourcePolicy
    rows: tuple[NormalizedMetadataRow, ...]


@dataclass(frozen=True)
class MetadataClaim:
    subject_id: str
    snapshot_id: str
    field: Field
    value: Metric
    region: Region
    release: str | None
    observed_at: str
    priority: int
    source_url: str | None
    evidence: str

    def record(self) -> dict[str, object]:
        record: dict[str, object] = {
            "subject_id": self.subject_id,
            "snapshot_id": self.snapshot_id,
            "field": self.field,
            "value": self.value,
            "region": self.region,
            "release": self.release,
            "observed_at": self.observed_at,
            "priority": self.priority,
            "source_url": self.source_url,
            "evidence": self.evidence,
            "policy": VERSION,
        }
        record["observation_id"] = "metadata:" + digest(record)
        return record


@dataclass(frozen=True)
class AmbiguousMetadataMatch:
    provider: str
    chart_ids: tuple[str, ...]

    def record(self) -> dict[str, object]:
        return {"provider": self.provider, "chart_ids": list(self.chart_ids)}


@dataclass(frozen=True)
class MetadataClaimDecision:
    claims: tuple[MetadataClaim, ...]
    ambiguous: tuple[AmbiguousMetadataMatch, ...]


def decide_metadata_claims(
    charts: tuple[CanonicalChartIdentity, ...], sources: tuple[NormalizedMetadataSource, ...]
) -> MetadataClaimDecision:
    """Require a unique canonical chart and source row; emit only permitted fields."""
    own: dict[IdentityKey, list[str]] = defaultdict(list)
    for chart in charts:
        own[chart.identity].append(chart.chart_id)
    claims: list[MetadataClaim] = []
    ambiguous: list[AmbiguousMetadataMatch] = []
    for source in sources:
        captured = source.evidence
        index: dict[IdentityKey, list[NormalizedMetadataRow]] = defaultdict(list)
        for row in source.rows:
            index[row.identity].append(row)
        for identity, chart_ids in own.items():
            candidates = index.get(identity, [])
            if len(candidates) > 1 or len(chart_ids) > 1:
                if candidates:
                    ambiguous.append(AmbiguousMetadataMatch(captured.provider, tuple(chart_ids)))
                continue
            if not candidates:
                continue
            matched, chart_id = candidates[0], chart_ids[0]
            fields: tuple[tuple[Field, Metric | None], ...] = (
                ("bpm", matched.bpm),
                ("chart_constant", matched.chart_constant),
            )
            for field, value in fields:
                if value is None:
                    continue
                claims.append(
                    MetadataClaim(
                        subject_id=chart_id,
                        snapshot_id=captured.snapshot_id,
                        field=field,
                        value=value,
                        region=matched.region if field == "chart_constant" else None,
                        release=matched.release if field == "chart_constant" else None,
                        observed_at=captured.captured_at,
                        priority=source.policy.priority,
                        source_url=matched.source_url
                        if matched.source_url_present
                        else captured.url,
                        evidence=matched.evidence
                        or (
                            "Unique normalized title, artist, format and difficulty; "
                            "explicit numeric field"
                        ),
                    )
                )
    return MetadataClaimDecision(tuple(claims), tuple(ambiguous))
