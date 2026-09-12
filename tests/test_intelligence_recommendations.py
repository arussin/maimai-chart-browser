"""Synthetic release/region gates and useful shortlist presentation."""

import unittest

from maimai_intelligence.intelligence_recommendations import prepare_recommendations
from maimai_intelligence.recommendations import (
    RatingChart,
    RatingPolicy,
    rating_opportunities,
)
from maimai_intelligence.recommendations.selection import select_shortlist


def policy():
    return {
        "policy_id": "synthetic-scope",
        "release": "Synthetic current",
        "region": "Synthetic-A",
        "current_versions": ["Synthetic current"],
        "coefficient_bands": [["0", "20"], ["97", "21"], ["100", "22"], ["100.5", "23"]],
        "ap_bonus": 0,
        "source_ids": ["synthetic-policy"],
        "verification": "synthetic",
    }


def chart(cid="synthetic-chart", **changes):
    return {
        "chart_id": cid,
        "song_id": cid,
        "region": "Synthetic-A",
        "release": "Synthetic current",
        "availability": "available",
        "constant": 10,
        **changes,
    }


def prepare(charts, pbs=(), retained_charts=()):
    return prepare_recommendations(
        {"charts": charts},
        {"entries": [], "coverage": {"cutoff_ms": 100}},
        {"pbs": list(pbs), "charts": list(retained_charts)},
        {"synthetic-provider": "synthetic-chart"},
        policy=policy(),
        complete=True,
    )


class IntelligenceRecommendationTests(unittest.TestCase):
    def test_unknown_release_or_wrong_region_cannot_receive_exact_rating_card(self):
        for changes in (
            {"region": "Synthetic-B"},
            {"region": "unknown"},
            {"release": "unknown"},
            {"release": ""},
        ):
            with self.subTest(changes=changes):
                result = prepare([chart(**changes), chart("synthetic-eligible")])
                self.assertEqual([c["chart_id"] for c in result["cards"]], ["synthetic-eligible"])
                self.assertTrue(
                    any(message.startswith("rating_") for message in result["diagnostics"])
                )

    def test_affected_existing_pb_blocks_full_pool_claim(self):
        pb = {
            "chartID": "synthetic-provider",
            "timeAchieved": 90,
            "scoreData": {"percent": 95, "lamp": "CLEAR"},
            "calculatedData": {"rate": 190},
        }
        result = prepare([chart(region="Synthetic-B"), chart("synthetic-eligible")], [pb])
        self.assertFalse(result["cards"])
        self.assertIn("incomplete_pb_collection", result["diagnostics"])
        self.assertIn("rating_pb_scope_unresolved:synthetic-chart", result["diagnostics"])

    def test_retained_display_version_must_match_catalog_for_pb(self):
        pb = {
            "chartID": "synthetic-provider",
            "timeAchieved": 90,
            "scoreData": {"percent": 95, "lamp": "CLEAR"},
            "calculatedData": {"rate": 190},
        }
        retained = {"chartID": "synthetic-provider", "data": {"displayVersion": "Synthetic old"}}
        result = prepare([chart()], [pb], [retained])
        self.assertFalse(result["cards"])
        self.assertIn("rating_retained_release_mismatch:synthetic-chart", result["diagnostics"])
        retained["data"]["displayVersion"] = "Synthetic current"
        valid = prepare([chart()], [pb], [retained])
        self.assertEqual(len(valid["cards"]), 1)
        self.assertEqual(valid["cards"][0]["pool"], "new")

    def test_unrecorded_shortlist_prefers_threshold_without_erasing_small_entry_option(self):
        rules = RatingPolicy.from_mapping(policy())
        opportunities = rating_opportunities(
            [], [RatingChart("synthetic", "synthetic", "Synthetic current", 10)], rules
        )["opportunities"]
        self.assertTrue(any(card["target_achievement"] == 0.5 for card in opportunities))
        shortlist = select_shortlist(opportunities)["cards"]
        self.assertEqual(shortlist[0]["target_achievement"], 97)
        self.assertIn("score_threshold", shortlist[0]["kinds"])


if __name__ == "__main__":
    unittest.main()
