"""Pure decisions over normalized identities; no acquisition or registry mutation."""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Literal

Identity = tuple[str, str, str, str]
LinkStatus = Literal[
    "provider_entry_missing",
    "changed_identity_review",
    "ambiguous",
    "availability_changed",
    "added",
]


@dataclass(frozen=True)
class AcceptedLink:
    mapping_id: str
    provider_id: str
    available: bool
    provider_artist: str | None = None
    official_artist: str | None = None


@dataclass(frozen=True)
class LinkChart:
    chart_id: str
    identity: Identity
    artist: str
    format: str
    difficulty: str
    prior: AcceptedLink | None


@dataclass(frozen=True)
class LinkTarget:
    provider_id: str
    identity: Identity
    artist: str
    format: str
    difficulty: str
    available: bool


@dataclass(frozen=True)
class LinkChange:
    chart_id: str
    provider_id: str
    mapping_id: str | None
    available: bool
    bind_capture: bool


@dataclass(frozen=True)
class LinkOutcome:
    chart_id: str
    status: LinkStatus


@dataclass(frozen=True)
class LinkDecisions:
    matches: tuple[tuple[str, str], ...]
    changes: tuple[LinkChange, ...]
    outcomes: tuple[LinkOutcome, ...]


def decide_links(
    charts: tuple[LinkChart, ...], targets: tuple[LinkTarget, ...], *, captured: bool
) -> LinkDecisions:
    """A contradiction suspends an accepted link; it never authorizes rematching."""
    by_id = {row.provider_id: row for row in targets}
    by_identity: dict[Identity, list[LinkTarget]] = defaultdict(list)
    for row in targets:
        by_identity[row.identity].append(row)
    counts = Counter(chart.identity for chart in charts)
    matches, changes, outcomes = [], [], []
    for chart in charts:
        prior = chart.prior
        candidate = by_id.get(prior.provider_id) if prior else None
        if prior and captured and candidate is None:
            changes.append(
                LinkChange(chart.chart_id, prior.provider_id, prior.mapping_id, False, False)
            )
            outcomes.append(LinkOutcome(chart.chart_id, "provider_entry_missing"))
            continue
        if candidate is not None:
            assert prior is not None
            credited = (
                prior.provider_artist == candidate.artist and prior.official_artist == chart.artist
            )
            artist_matches = candidate.identity[1] == chart.identity[1] or credited
            variant_matches = (candidate.format, candidate.difficulty, candidate.identity[0]) == (
                chart.format,
                chart.difficulty,
                chart.identity[0],
            )
            if not variant_matches or not artist_matches:
                changes.append(
                    LinkChange(chart.chart_id, prior.provider_id, prior.mapping_id, False, False)
                )
                outcomes.append(LinkOutcome(chart.chart_id, "changed_identity_review"))
                continue
        if candidate is None:
            rows = by_identity[chart.identity]
            if len(rows) == 1 and counts[chart.identity] == 1:
                candidate = rows[0]
            elif rows:
                outcomes.append(LinkOutcome(chart.chart_id, "ambiguous"))
        if candidate is None:
            continue
        matches.append((chart.chart_id, candidate.provider_id))
        if prior is not None and prior.available != candidate.available:
            changes.append(
                LinkChange(
                    chart.chart_id,
                    candidate.provider_id,
                    prior.mapping_id,
                    candidate.available,
                    True,
                )
            )
            outcomes.append(LinkOutcome(chart.chart_id, "availability_changed"))
        if prior is None and candidate.available:
            changes.append(LinkChange(chart.chart_id, candidate.provider_id, None, True, True))
            outcomes.append(LinkOutcome(chart.chart_id, "added"))
    return LinkDecisions(tuple(matches), tuple(changes), tuple(outcomes))
