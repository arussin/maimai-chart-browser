from __future__ import annotations

import copy
import unittest
from dataclasses import replace

from maimai_intelligence.recommendations import (
    PersonalBest,
    RatingChart,
    RatingPolicy,
    RatingTarget,
    chart_rating,
    rating_opportunities,
    simulate_targets,
)
from maimai_intelligence.recommendations.selection import select_shortlist, structural_card


def policy() -> RatingPolicy:
    return RatingPolicy(
        "synthetic-test-v1",
        "Synthetic release",
        "synthetic",
        ("Current",),
        (("0", "20"), ("97", "21"), ("100", "22"), ("100.5", "23")),
        1,
        ("authored-fixture",),
        "synthetic",
    )


def chart(index: int, version: str = "Legacy") -> RatingChart:
    return RatingChart(f"chart-{index:03}", f"song-{index:03}", version, "10")


def pb(index: int, percent: str = "95", lamp: str = "CLEAR") -> PersonalBest:
    return PersonalBest(
        chart(index).chart_id, percent, lamp, chart_rating("10", percent, lamp, policy())
    )


class RatingRecommendationTests(unittest.TestCase):
    def test_all_thresholds_and_minimal_non_threshold_increment(self) -> None:
        result = rating_opportunities([pb(1)], [chart(1), chart(2)], policy())
        own = [item for item in result["opportunities"] if item["chart_id"] == chart(1).chart_id]
        self.assertTrue({97.0, 100.0, 100.5} <= {item["target_achievement"] for item in own})
        minimum = next(item for item in own if "minimal_rating_increment" in item["kinds"])
        self.assertEqual(minimum["target_achievement"], 95.5)
        self.assertEqual(minimum["gain_if_achieved"], 1)
        self.assertEqual(minimum["reachability"]["status"], "unknown")
        self.assertTrue(
            any(item["previous_achievement"] is None for item in result["opportunities"])
        )

    def test_complete_both_pools_include_uncounted_pbs(self) -> None:
        charts = [chart(i) for i in range(36)] + [chart(i, "Current") for i in range(100, 116)]
        pbs = [pb(i) for i in range(35)] + [pb(35, "94")]
        pbs += [pb(i) for i in range(100, 115)] + [pb(115, "94")]
        result = simulate_targets(
            pbs,
            charts,
            [RatingTarget(chart(35).chart_id, "96"), RatingTarget(chart(115).chart_id, "96")],
            policy(),
        )
        self.assertEqual(result["old_gain"], 2)
        self.assertEqual(result["new_gain"], 2)
        self.assertEqual(result["gain_if_achieved"], 4)

    def test_competing_replacements_are_recomputed_not_added(self) -> None:
        charts = [chart(i) for i in range(37)]
        pbs = [pb(0, "95"), pb(1, "95.5")] + [pb(i, "96") for i in range(2, 35)]
        targets = [RatingTarget(chart(i).chart_id, "96.5") for i in (35, 36)]
        singles = [
            simulate_targets(pbs, charts, [target], policy())["gain_if_achieved"]
            for target in targets
        ]
        combined = simulate_targets(pbs, charts, targets, policy())
        self.assertEqual(singles, [3, 3])
        self.assertEqual(combined["gain_if_achieved"], 5)

    def test_stronger_achievement_lamp_and_rate_are_never_downgraded(self) -> None:
        existing = pb(1, "100.5", "AP+")
        snapshot = copy.deepcopy(existing)
        result = simulate_targets(
            [existing], [chart(1)], [RatingTarget(chart(1).chart_id, "97")], policy()
        )
        self.assertEqual(result["gain_if_achieved"], 0)
        self.assertEqual(result["updated_pbs"][0]["lamp"], "AP+")
        self.assertEqual(result["updated_pbs"][0]["achievement"], 100.5)
        self.assertEqual(existing, snapshot)
        stronger_rate = replace(existing, rate=900)
        retained = simulate_targets(
            [stronger_rate], [chart(1)], [RatingTarget(chart(1).chart_id, "101")], policy()
        )
        self.assertEqual(retained["updated_pbs"][0]["rate"], 900)

    def test_independent_ap_upgrade_retains_higher_score(self) -> None:
        result = simulate_targets(
            [pb(1, "100.5")], [chart(1)], [RatingTarget(chart(1).chart_id, "100", "AP")], policy()
        )
        self.assertEqual(result["gain_if_achieved"], 1)
        self.assertEqual(result["updated_pbs"][0]["achievement"], 100.5)
        disabled = replace(policy(), ap_bonus=0)
        self.assertEqual(
            chart_rating("10", "100.5", "AP", disabled),
            chart_rating("10", "100.5", "CLEAR", disabled),
        )

    def test_missing_partial_and_unavailable_are_not_zero_gain_claims(self) -> None:
        partial = simulate_targets(
            [pb(1)], [chart(1)], [RatingTarget(chart(1).chart_id, "97")], policy(), complete=False
        )
        self.assertIsNone(partial["gain_if_achieved"])
        self.assertGreater(partial["snapshot_gain"], 0)
        missing = simulate_targets(
            [],
            [replace(chart(2), constant=None)],
            [RatingTarget(chart(2).chart_id, "97")],
            policy(),
        )
        self.assertIsNone(missing["gain_if_achieved"])
        unknown = simulate_targets(
            [pb(1)], [replace(chart(1), availability="unknown")], [], policy()
        )
        self.assertEqual(unknown["status"], "unavailable")
        excluded = simulate_targets(
            [pb(1)], [replace(chart(1), availability="unavailable")], [], policy()
        )
        self.assertEqual(excluded["before_total"], 0)

    def test_full_pool_tie_has_zero_net_gain_and_order_is_stable(self) -> None:
        charts, pbs = [chart(i) for i in range(36)], [pb(i) for i in range(35)]
        target = [RatingTarget(chart(35).chart_id, "95")]
        first = simulate_targets(pbs, charts, target, policy())
        second = simulate_targets(reversed(pbs), reversed(charts), target, policy())
        self.assertEqual(first, second)
        self.assertEqual(first["gain_if_achieved"], 0)

    def test_precise_one_tick_boundary_and_cap(self) -> None:
        edge = replace(policy(), coefficient_bands=(("0", "20"), ("96.9999", "21"), ("97", "22")))
        self.assertEqual(chart_rating("10", "96.9998", "CLEAR", edge), 193)
        self.assertEqual(chart_rating("10", "96.9999", "CLEAR", edge), 203)
        self.assertEqual(chart_rating("10", "97", "CLEAR", edge), 213)
        self.assertEqual(
            chart_rating("10", "101", "CLEAR", edge), chart_rating("10", "100.5", "CLEAR", edge)
        )

    def test_no_future_pb_or_duplicate_identity_and_invalid_numbers(self) -> None:
        with self.assertRaisesRegex(ValueError, "historical cutoff"):
            simulate_targets(
                [replace(pb(1), time_achieved=101)], [chart(1)], [], policy(), as_of=100
            )
        with self.assertRaisesRegex(ValueError, "duplicate PB"):
            simulate_targets([pb(1), pb(1)], [chart(1)], [], policy())
        for percent in ("NaN", "Infinity", "101.1", "95.00001"):
            with self.subTest(percent=percent), self.assertRaises(ValueError):
                chart_rating("10", percent, "CLEAR", policy())
        with self.assertRaises(ValueError):
            replace(policy(), coefficient_bands=(("0", "-1"),))


class SelectionTests(unittest.TestCase):
    def test_shortlist_respects_smallest_step_song_diversity_and_evidence_shortfall(self) -> None:
        opportunities = rating_opportunities([pb(1)], [chart(1), chart(2)], policy())[
            "opportunities"
        ]
        result = select_shortlist(opportunities)
        self.assertEqual(len(result["cards"]), 2)
        first = next(item for item in result["cards"] if item["chart_id"] == chart(1).chart_id)
        self.assertEqual(first["target_achievement"], 95.5)
        self.assertEqual(len(result["diagnostics"]), 2)
        duplicated_song = [dict(item, song_id="same-song") for item in opportunities]
        self.assertEqual(len(select_shortlist(duplicated_song)["cards"]), 1)

    def test_practice_requires_target_occurrence_and_lower_demand_evidence(self) -> None:
        match = {
            "supported": True,
            "chart_id": "synthetic",
            "song_id": "synthetic-song",
            "occurrences": [{"pattern_id": "pattern.demo", "start_us": 1, "end_us": 10}],
            "differences": [{"feature": "onset_rate", "direction": "lower"}],
            "local_demand_relation": {
                "metric": "mean_onset_cadence_within_selected_runs",
                "query": {"min": 4},
                "candidate": {"max": 2},
            },
        }
        result = structural_card(match, pattern_id="pattern.demo")
        self.assertIsNotNone(result)
        self.assertEqual(result["alternative_query"]["mode"], "easier")
        self.assertEqual(result["reachability"]["status"], "unknown")
        self.assertIsNone(structural_card(dict(match, differences=[]), pattern_id="pattern.demo"))
        self.assertIsNone(
            structural_card(dict(match, local_demand_relation=None), pattern_id="pattern.demo")
        )
        self.assertIsNone(structural_card(match, pattern_id="pattern.other"))
        self.assertIsNone(structural_card(dict(match, supported=False), role="discovery"))
        # Display rounding of 10/3 and 19/6 must preserve a valid exact 5% boundary.
        boundary = copy.deepcopy(match)
        boundary["local_demand_relation"]["query"]["min"] = 3.333333
        boundary["local_demand_relation"]["candidate"]["max"] = 3.166667
        self.assertIsNotNone(structural_card(boundary, pattern_id="pattern.demo"))
        boundary["local_demand_relation"]["candidate"]["max"] = 3.16667
        self.assertIsNone(structural_card(boundary, pattern_id="pattern.demo"))


if __name__ == "__main__":
    unittest.main()
