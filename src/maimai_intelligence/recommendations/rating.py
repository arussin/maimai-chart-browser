"""Conditional full-pool simulation under an explicit, frozen rating policy.

No release/region or coefficient table is selected implicitly. Observed PB rates
are preserved; targets improve achievement and lamp independently. A complete
input means all eligible PBs, including uncounted ones, at one historical cutoff.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from decimal import ROUND_FLOOR, Decimal, InvalidOperation
from typing import Any

from ..calculations import rating_summary

LAMPS = ("FAILED", "CLEAR", "FC", "FC+", "AP", "AP+")
TICK = Decimal("0.0001")
MAX_ACHIEVEMENT = Decimal("101")


def _decimal(value: Any, name: str) -> Decimal:
    if isinstance(value, bool):
        raise ValueError(f"{name} must be a finite decimal")
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f"{name} must be a finite decimal") from exc
    if not result.is_finite():
        raise ValueError(f"{name} must be a finite decimal")
    return result


def _achievement(value: Any) -> Decimal:
    result = _decimal(value, "achievement")
    if not 0 <= result <= MAX_ACHIEVEMENT or result % TICK:
        raise ValueError("achievement must be 0..101 with at most four decimals")
    return result


def _lamp(value: str) -> str:
    if value not in LAMPS:
        raise ValueError("lamp must be an explicit supported lamp")
    return value


@dataclass(frozen=True)
class RatingPolicy:
    """Coefficients multiply constant * achievement / 100, then floor.

    ``coefficient_bands`` lists inclusive minimum percentages and coefficients,
    including any one-tick boundary jumps. ``verification`` describes evidence,
    never a success probability. Source locators belong in build-time notes;
    source_ids are safe local identifiers suitable for sealed reports.
    """

    policy_id: str
    release: str
    region: str
    current_versions: tuple[str, ...]
    coefficient_bands: tuple[tuple[str, str], ...]
    ap_bonus: int
    source_ids: tuple[str, ...]
    verification: str
    achievement_cap: str = "100.5"

    def __post_init__(self) -> None:
        if (
            not all(
                isinstance(value, str) and 0 < len(value) <= 256
                for value in (self.policy_id, self.release, self.region)
            )
            or not self.source_ids
        ):
            raise ValueError("rating policy requires identity, scope and source IDs")
        if not self.current_versions or not all(
            isinstance(value, str) and 0 < len(value) <= 256 for value in self.current_versions
        ):
            raise ValueError("rating policy requires explicit current-version names")
        if not all(isinstance(value, str) and 0 < len(value) <= 256 for value in self.source_ids):
            raise ValueError("rating policy requires local source IDs")
        if self.verification not in {"synthetic", "reviewed_reference"}:
            raise ValueError("rating policy must declare synthetic or reviewed_reference evidence")
        if type(self.ap_bonus) is not int or self.ap_bonus not in (0, 1):
            raise ValueError("AP bonus must be explicitly 0 or 1")
        cap = _achievement(self.achievement_cap)
        if cap <= 0:
            raise ValueError("achievement cap must be positive")
        if len(self.coefficient_bands) > 128:
            raise ValueError("too many coefficient bands")
        previous_min, previous_coefficient = Decimal(-1), Decimal(0)
        for minimum, coefficient in self.coefficient_bands:
            minimum_value = _achievement(minimum)
            coefficient_value = _decimal(coefficient, "coefficient")
            if not previous_min < minimum_value <= cap:
                raise ValueError("coefficient bands must be strictly increasing within cap")
            if not previous_coefficient <= coefficient_value <= 100:
                raise ValueError("coefficients must be nonnegative, bounded and nondecreasing")
            previous_min, previous_coefficient = minimum_value, coefficient_value
        if not self.coefficient_bands or _decimal(self.coefficient_bands[0][0], "minimum") != 0:
            raise ValueError("coefficient bands must begin at zero")

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> RatingPolicy:
        """Read an explicit policy file without inferring absent release facts."""
        try:
            for name in ("current_versions", "coefficient_bands", "source_ids"):
                if not isinstance(value[name], (list, tuple)):
                    raise ValueError(f"rating policy {name} must be a list")
            return cls(
                policy_id=value["policy_id"],
                release=value["release"],
                region=value["region"],
                current_versions=tuple(value["current_versions"]),
                coefficient_bands=tuple(tuple(item) for item in value["coefficient_bands"]),
                ap_bonus=value["ap_bonus"],
                source_ids=tuple(value["source_ids"]),
                verification=value["verification"],
                achievement_cap=value.get("achievement_cap", "100.5"),
            )
        except (KeyError, TypeError) as exc:
            raise ValueError(
                "rating policy is missing required fields or has invalid types"
            ) from exc

    def metadata(self) -> dict[str, Any]:
        return {
            "policy_id": self.policy_id,
            "release": self.release,
            "region": self.region,
            "current_versions": list(self.current_versions),
            "verification": self.verification,
            "source_ids": list(self.source_ids),
        }


@dataclass(frozen=True)
class RatingChart:
    chart_id: str
    song_id: str
    display_version: str
    constant: str | float | None
    availability: str = "available"

    def __post_init__(self) -> None:
        if not self.chart_id or not self.song_id or not self.display_version:
            raise ValueError("rating chart requires exact identity and display version")
        if self.availability not in {"available", "unavailable", "unknown"}:
            raise ValueError("invalid availability")
        if self.constant is not None and not 0 < _decimal(self.constant, "constant") <= 20:
            raise ValueError("constant must be greater than zero and at most 20")


@dataclass(frozen=True)
class PersonalBest:
    chart_id: str
    achievement: str | float
    lamp: str
    rate: int
    time_achieved: int | None = None

    def __post_init__(self) -> None:
        _achievement(self.achievement)
        _lamp(self.lamp)
        if not self.chart_id or type(self.rate) is not int or not 0 <= self.rate <= 10_000:
            raise ValueError("PB requires an exact chart ID and nonnegative integer rate")
        if self.time_achieved is not None and type(self.time_achieved) is not int:
            raise ValueError("PB time must be an integer or absent")


@dataclass(frozen=True)
class RatingTarget:
    chart_id: str
    achievement: str | float
    lamp: str = "CLEAR"

    def __post_init__(self) -> None:
        if not self.chart_id:
            raise ValueError("target requires an exact chart ID")
        _achievement(self.achievement)
        _lamp(self.lamp)


def chart_rating(
    constant: str | float, achievement: str | float, lamp: str, policy: RatingPolicy
) -> int:
    """Use decimal arithmetic so an authored decimal threshold never drifts."""
    level = _decimal(constant, "constant")
    if not 0 < level <= 20:
        raise ValueError("constant must be greater than zero and at most 20")
    percent = min(_achievement(achievement), _decimal(policy.achievement_cap, "cap"))
    _lamp(lamp)
    coefficient = Decimal(0)
    for minimum, value in policy.coefficient_bands:
        if percent < _decimal(minimum, "minimum"):
            break
        coefficient = _decimal(value, "coefficient")
    base = int((level * percent * coefficient / 100).to_integral_value(rounding=ROUND_FLOOR))
    return base + (policy.ap_bonus if LAMPS.index(lamp) >= LAMPS.index("AP") else 0)


def _index(items: Iterable[Any], name: str) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for item in items:
        if item.chart_id in result:
            raise ValueError(f"duplicate {name} chart ID: {item.chart_id}")
        result[item.chart_id] = item
        if len(result) > 100_000:
            raise ValueError(f"too many {name} entries")
    return result


def _summary(
    pbs: Mapping[str, PersonalBest], charts: Mapping[str, RatingChart], policy: RatingPolicy
) -> dict[str, Any]:
    eligible = {key: chart for key, chart in charts.items() if chart.availability == "available"}
    body = {
        "charts": [
            {"chartID": key, "data": {"displayVersion": chart.display_version}}
            for key, chart in sorted(eligible.items())
        ],
        "songs": [],
        "pbs": [
            {
                "chartID": key,
                "calculatedData": {"rate": pb.rate},
                "scoreData": {"percent": float(pb.achievement), "lamp": pb.lamp},
            }
            for key, pb in sorted(pbs.items())
            if key in eligible
        ],
    }
    return rating_summary(body, policy.current_versions)


def _updated(
    pb: PersonalBest | None, target: RatingTarget, chart: RatingChart, policy: RatingPolicy
) -> PersonalBest:
    if chart.constant is None:
        raise ValueError("target constant is unavailable")
    achievement = max(_achievement(target.achievement), _achievement(pb.achievement) if pb else 0)
    lamp = max((pb.lamp if pb else "FAILED", target.lamp), key=LAMPS.index)
    projected = chart_rating(chart.constant, str(achievement), lamp, policy)
    return PersonalBest(
        chart.chart_id,
        str(achievement),
        lamp,
        max(pb.rate if pb else 0, projected),
        pb.time_achieved if pb else None,
    )


def simulate_targets(
    all_pbs: Iterable[PersonalBest],
    charts: Iterable[RatingChart],
    targets: Iterable[RatingTarget],
    policy: RatingPolicy,
    *,
    complete: bool = True,
    as_of: int | None = None,
) -> dict[str, Any]:
    """Recompute both entire pools together, including competing replacements.

    Unknown availability/missing PB identity prevents an exact claim. Explicitly
    unavailable charts are excluded. Incomplete collections return snapshot gain
    separately and leave gain_if_achieved unavailable. Future PBs are rejected.
    """
    pb_map, chart_map = _index(all_pbs, "PB"), _index(charts, "catalog")
    target_list = list(targets)
    if len(target_list) > 10_000:
        raise ValueError("too many scenario targets")
    if as_of is not None and any(
        pb.time_achieved is not None and pb.time_achieved > as_of for pb in pb_map.values()
    ):
        raise ValueError("PB occurs after the declared historical cutoff")
    diagnostics: list[str] = []
    if not complete:
        diagnostics.append("incomplete_pb_collection")
    for key in pb_map:
        if key not in chart_map:
            diagnostics.append(f"missing_pb_chart:{key}")
        elif chart_map[key].availability == "unknown":
            diagnostics.append(f"unknown_availability:{key}")
    baseline = _summary(pb_map, chart_map, policy)
    state = dict(pb_map)
    for target in target_list:
        chart = chart_map.get(target.chart_id)
        if chart is None:
            diagnostics.append(f"missing_target_chart:{target.chart_id}")
        elif chart.availability != "available":
            diagnostics.append(f"target_{chart.availability}:{target.chart_id}")
        elif chart.constant is None:
            diagnostics.append(f"missing_target_constant:{target.chart_id}")
        else:
            state[target.chart_id] = _updated(state.get(target.chart_id), target, chart, policy)
    updated = _summary(state, chart_map, policy)
    gain = updated["reconstructedRating"] - baseline["reconstructedRating"]
    return {
        "status": "complete" if not diagnostics else "unavailable",
        "policy": policy.metadata(),
        "gain_if_achieved": gain if not diagnostics else None,
        "snapshot_gain": gain,
        "before_total": baseline["reconstructedRating"],
        "after_total": updated["reconstructedRating"],
        "old_gain": updated["old35Rating"] - baseline["old35Rating"],
        "new_gain": updated["new15Rating"] - baseline["new15Rating"],
        "reachability": {"status": "unknown", "reason": "No calibrated attainment evidence."},
        "diagnostics": sorted(set(diagnostics)),
        "updated_pbs": [
            {
                "chart_id": key,
                "achievement": float(pb.achievement),
                "lamp": pb.lamp,
                "rate": pb.rate,
            }
            for key, pb in sorted(state.items())
        ],
    }


def _minimal_percent(
    chart: RatingChart,
    pb: PersonalBest | None,
    lamp: str,
    required_rate: int,
    policy: RatingPolicy,
) -> Decimal | None:
    if chart.constant is None:
        return None
    low = int(_achievement(pb.achievement) / TICK) if pb else 0
    high = int(_decimal(policy.achievement_cap, "cap") / TICK)
    if low > high or chart_rating(chart.constant, str(high * TICK), lamp, policy) < required_rate:
        return None
    while low < high:
        middle = (low + high) // 2
        if chart_rating(chart.constant, str(middle * TICK), lamp, policy) >= required_rate:
            high = middle
        else:
            low = middle + 1
    return low * TICK


def rating_opportunities(
    all_pbs: Iterable[PersonalBest],
    charts: Iterable[RatingChart],
    policy: RatingPolicy,
    *,
    complete: bool = True,
    as_of: int | None = None,
) -> dict[str, Any]:
    """Return every useful band boundary, minimal entry/increment, and AP upgrade.

    UI shortlists should select from these options, not change gain arithmetic.
    Zero-gain options are omitted; unknowns are diagnosed rather than ranked as 0.
    """
    pb_map, chart_map = _index(all_pbs, "PB"), _index(charts, "catalog")
    baseline = simulate_targets(
        pb_map.values(), chart_map.values(), (), policy, complete=complete, as_of=as_of
    )
    if baseline["status"] != "complete":
        return {
            "status": "unavailable",
            "opportunities": [],
            "diagnostics": baseline["diagnostics"],
            "policy": policy.metadata(),
        }
    summary = _summary(pb_map, chart_map, policy)
    opportunities: list[dict[str, Any]] = []
    diagnostics: list[str] = []
    for key, chart in sorted(chart_map.items()):
        if chart.availability != "available" or chart.constant is None:
            diagnostics.append(f"candidate_unavailable:{key}")
            continue
        pb = pb_map.get(key)
        current = _achievement(pb.achievement) if pb else Decimal(0)
        lamp = pb.lamp if pb else "CLEAR"
        new = chart.display_version in policy.current_versions
        floor = summary["new15Floor" if new else "old35Floor"]
        required = max(floor, pb.rate if pb else 0) + 1
        options: dict[tuple[Decimal, str], set[str]] = {}
        for minimum, _coefficient in policy.coefficient_bands:
            percentage = _achievement(minimum)
            if percentage > current:
                options.setdefault((percentage, lamp), set()).add("score_threshold")
        minimum = _minimal_percent(chart, pb, lamp, required, policy)
        if minimum is not None and minimum > current:
            options.setdefault((minimum, lamp), set()).add("minimal_rating_increment")
        if policy.ap_bonus and LAMPS.index(lamp) < LAMPS.index("AP"):
            # AP is a lamp objective at >=100%; it is not an asserted probability.
            options.setdefault((max(current, Decimal(100)), "AP"), set()).add("ap_bonus")
        for (percentage, target_lamp), kinds in sorted(options.items()):
            target = RatingTarget(key, str(percentage), target_lamp)
            projected = _updated(pb, target, chart, policy)
            # Recompute whole pools for each option: no floor-only shortcut.
            state = dict(pb_map)
            state[key] = projected
            after = _summary(state, chart_map, policy)
            gain = after["reconstructedRating"] - summary["reconstructedRating"]
            if gain <= 0:
                continue
            opportunities.append(
                {
                    "chart_id": key,
                    "song_id": chart.song_id,
                    "category": "rating",
                    "pool": "new" if new else "old",
                    "kinds": sorted(kinds),
                    "target_achievement": float(percentage),
                    "target_lamp": target_lamp,
                    "projected_rate": projected.rate,
                    "gain_if_achieved": gain,
                    "previous_achievement": float(current) if pb else None,
                    "reachability": {
                        "status": "unknown",
                        "reason": "PB is a maximum, not consistency.",
                    },
                    "alternative_query": {"chart_id": key, "mode": "overall"},
                    "policy_id": policy.policy_id,
                }
            )
    opportunities.sort(
        key=lambda item: (
            -item["gain_if_achieved"],
            item["chart_id"],
            item["target_achievement"],
            item["target_lamp"],
        )
    )
    return {
        "status": "complete",
        "opportunities": opportunities,
        "diagnostics": diagnostics,
        "policy": policy.metadata(),
        "limitation": "Individual gains compete; use simulate_targets for combined scenarios.",
    }
