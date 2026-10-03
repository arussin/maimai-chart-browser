"""Pure recovery link decisions; display metadata never authorizes an identity."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal
from urllib.parse import urlencode


@dataclass(frozen=True)
class ChartRecoveryDecision:
    chart_id: str
    target: str | None
    reason: Literal["exact-baseline-chart", "chart-absent-from-baseline"]


def _identifier(value: object) -> bool:
    return (
        isinstance(value, str)
        and 0 < len(value) <= 1024
        and not any(ord(character) < 32 or ord(character) == 127 for character in value)
    )


def decide_chart_recovery(
    chart_ids: tuple[str, ...], baseline_chart_ids: frozenset[str], version: str
) -> tuple[ChartRecoveryDecision, ...]:
    """Retain only exact baseline IDs and bind every link to its retained version."""
    if not isinstance(chart_ids, tuple) or not isinstance(baseline_chart_ids, frozenset):
        raise ValueError("Recovery identities must be immutable")
    if not _identifier(version):
        raise ValueError("Invalid retained baseline version")
    if not all(_identifier(value) for value in (*chart_ids, *baseline_chart_ids)):
        raise ValueError("Invalid recovery chart identity")
    if len(set(chart_ids)) != len(chart_ids):
        raise ValueError("Duplicate recovery chart identity")
    return tuple(
        ChartRecoveryDecision(
            chart_id,
            "/?" + urlencode({"view": "catalog", "chart": chart_id, "version": version})
            if chart_id in baseline_chart_ids
            else None,
            "exact-baseline-chart"
            if chart_id in baseline_chart_ids
            else "chart-absent-from-baseline",
        )
        for chart_id in chart_ids
    )
