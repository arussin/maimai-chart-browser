"""Authored counterfactuals test preference mechanics, never training outcomes."""

import copy
import unittest
from unittest.mock import patch

from maimai_intelligence.chart_intelligence import synthetic_catalog
from maimai_intelligence.intelligence_recommendations import prepare_recommendations
from maimai_intelligence.recommendations.scoring import (
    DAY_MS,
    PracticeGoal,
    Prerequisite,
    attempt_reachability,
    retained_attempts,
    score_practice_candidate,
)
from maimai_intelligence.recommendations.selection import select_shortlist

AS_OF = 100 * DAY_MS
PATTERN = "pattern.two_position_alternation"


def candidate(cid="synthetic-candidate", windows=4, concurrency=1):
    return {
        "chart_id": cid,
        "song_id": cid,
        "source_id": "authored-fixture",
        "tags": [
            {
                "pattern_id": PATTERN,
                "status": "detected",
                "occurrence_count": windows,
                "coverage": "complete",
                "occurrences_truncated": False,
            }
        ],
        "occurrences": [
            {
                "pattern_id": PATTERN,
                "occurrence_id": f"o:{i}",
                "start_us": i * 2000000,
                "end_us": i * 2000000 + 1000000,
                "evidence": {
                    "source_kind": "authored_synthetic",
                    "identity": "exact",
                    "timing": "supported_section",
                    "definition": "project_experimental",
                    "detector": "synthetic_tested_experimental",
                },
            }
            for i in range(windows)
        ],
        "sections": [
            {
                "start_us": 0,
                "end_us": 10000000,
                "metrics": {
                    "max_concurrency": concurrency,
                    "hold_occupancy": 0,
                    "slide_movement_occupancy": 0,
                    "slide_wait_occupancy": 0,
                },
            }
        ],
    }


def match(distance=0.2):
    return {"distance": distance, "coverage": 1.0}


def attempts(values=(96.8, 96.9, 96.9, 97.0, 97.0, 97.0), lamp="CLEAR"):
    return [
        {
            "attempt_id": f"synthetic-attempt:{i}",
            "recorded_at": AS_OF - (len(values) - i) * DAY_MS,
            "percent": value,
            "lamp": lamp,
        }
        for i, value in enumerate(values)
    ]


def score(chart=None, **kwargs):
    return score_practice_candidate(
        chart or candidate(), match(), PracticeGoal(PATTERN), as_of=AS_OF, **kwargs
    )


def term(result, name):
    return next(item for item in result["terms"] if item["name"] == name)


class PracticeScoringTests(unittest.TestCase):
    def test_terms_weights_missingness_and_bounds_are_inspectable(self):
        result = score()
        self.assertEqual(len(result["terms"]), 8)
        self.assertAlmostEqual(sum(abs(t["weight"]) for t in result["terms"]), 1)
        for name in ("prerequisite_readiness", "freshness", "retry_saturation"):
            self.assertEqual(term(result, name)["status"], "unknown")
            self.assertIsNone(term(result, name)["value"])
            self.assertIsNone(term(result, name)["contribution"])
        self.assertLess(result["bounds"][0], result["score"])
        self.assertGreater(result["bounds"][1], result["score"])
        self.assertEqual(result["ranking_score"], result["bounds"][0])
        self.assertEqual(term(result, "source_confidence")["value"], 0.6)

    def test_more_windows_better_isolation_and_relevance_change_only_supported_terms(self):
        sparse, repeated = (score(candidate(windows=1)), score(candidate(windows=4)))
        self.assertLess(
            term(sparse, "repetitions")["value"], term(repeated, "repetitions")["value"]
        )
        crowded = score(candidate(concurrency=4))
        self.assertLess(term(crowded, "isolation")["value"], term(repeated, "isolation")["value"])
        similar = score_practice_candidate(
            candidate(), match(0.0), PracticeGoal(PATTERN), as_of=AS_OF
        )
        self.assertGreater(similar["score"], repeated["score"])
        self.assertLess(crowded["score"], repeated["score"])

    def test_overlap_deduplication_and_context_gap_cannot_invent_repetitions_or_isolation(self):
        chart = candidate(windows=1)
        chart["occurrences"] *= 10
        self.assertEqual(term(score(chart), "repetitions")["evidence"]["observed_windows"], 1)
        section = chart["sections"][0]
        chart["sections"] = [dict(section, end_us=500000)] * 2
        self.assertIsNone(term(score(chart), "isolation")["value"])
        chart["sections"] = [section, copy.deepcopy(section)]
        self.assertEqual(term(score(chart), "isolation")["value"], 1.0)

    def test_missing_pattern_or_provenance_does_not_become_supported(self):
        chart = candidate()
        chart["tags"][0]["status"] = "unknown"
        self.assertIsNone(score(chart))
        chart = candidate()
        chart["occurrences"][0]["evidence"]["timing"] = "unknown"
        self.assertIsNone(term(score(chart), "source_confidence")["value"])

    def test_readiness_requires_explicit_objectives_and_repeated_actual_attempts(self):
        goal = PracticeGoal(PATTERN, prerequisites=(Prerequisite("prerequisite", 96.0),))

        def evaluate(history):
            return score_practice_candidate(
                candidate(), match(), goal, histories={"prerequisite": history}, as_of=AS_OF
            )

        self.assertIsNone(term(evaluate([]), "prerequisite_readiness")["value"])
        self.assertIsNone(term(evaluate(attempts()[:1] * 6), "prerequisite_readiness")["value"])
        self.assertEqual(term(evaluate(attempts()), "prerequisite_readiness")["value"], 1.0)
        self.assertIsNone(term(evaluate(attempts([90] * 6)), "prerequisite_readiness")["value"])

    def test_freshness_uses_observed_dates_and_retry_penalty_uses_recent_plateau(self):
        history = attempts([96] * 6)
        saturated = score(histories={"synthetic-candidate": history})
        improving = score(histories={"synthetic-candidate": attempts([94, 94, 95, 95, 96, 96])})
        self.assertGreater(term(saturated, "retry_saturation")["value"], 0)
        self.assertEqual(term(improving, "retry_saturation")["value"], 0)
        self.assertLess(saturated["ranking_score"], improving["ranking_score"])
        old = [{**a, "recorded_at": a["recorded_at"] - 20 * DAY_MS} for a in history]
        older = score(histories={"synthetic-candidate": old})
        self.assertGreater(term(older, "freshness")["value"], term(saturated, "freshness")["value"])
        self.assertIsNone(term(older, "retry_saturation")["value"])

    def test_shortlist_ranks_scores_and_recomputes_context_diversity_deterministically(self):
        cards = []
        for cid, distance, context in (
            ("a", 0, "context.one"),
            ("b", 0.01, "context.one"),
            ("c", 0.02, "context.two"),
        ):
            value = score_practice_candidate(
                candidate(cid), match(distance), PracticeGoal(PATTERN), as_of=AS_OF
            )
            cards.append(
                {
                    "chart_id": cid,
                    "song_id": cid,
                    "category": "practice",
                    "targeted_patterns": [PATTERN],
                    "context_patterns": [PATTERN, context],
                    "practice_score": value,
                }
            )
        snapshot = copy.deepcopy(cards)
        first = select_shortlist([], cards, quotas=(0, 2, 0))
        second = select_shortlist([], reversed(cards), quotas=(0, 2, 0))
        self.assertEqual(first, second)
        self.assertEqual([c["chart_id"] for c in first["cards"]], ["a", "c"])
        self.assertEqual(cards, snapshot)

    def test_same_song_shortfall_does_not_rescore_quadratically(self):
        card = {
            "chart_id": "one",
            "song_id": "same",
            "category": "practice",
            "targeted_patterns": [PATTERN],
            "practice_score": score(),
        }
        with patch(
            "maimai_intelligence.recommendations.selection.diversify_practice_card",
            side_effect=lambda item, _: item,
        ) as rescore:
            result = select_shortlist([], [card] * 1000, quotas=(0, 2, 0))
        self.assertEqual(len(result["cards"]), 1)
        self.assertEqual(rescore.call_count, 1)

    def test_isolation_budget_keeps_other_terms_and_unknown_evidence(self):
        chart = candidate(windows=1)
        chart["sections"] *= 20001
        result = score(chart)
        self.assertIsNone(term(result, "isolation")["value"])
        self.assertTrue(term(result, "isolation")["evidence"]["context_budget_exceeded"])
        self.assertIsNotNone(term(result, "relevance")["value"])

    def test_goal_allowlist_and_quota_validation(self):
        goal = PracticeGoal.from_mapping(
            {
                "pattern_id": PATTERN,
                "target_achievement": 97,
                "prerequisites": [{"chart_id": "exact", "target_achievement": 96}],
            }
        )
        self.assertEqual(goal.prerequisites[0].chart_id, "exact")
        for bad in (
            {"pattern_id": PATTERN, "trained": True},
            {"pattern_id": PATTERN, "prerequisites": {}},
            {"pattern_id": PATTERN, "target_achievement": float("nan")},
        ):
            with self.assertRaises(ValueError):
                PracticeGoal.from_mapping(bad)
        with self.assertRaises(ValueError):
            select_shortlist([], quotas=(1, -1, 1))


class ReachabilityTests(unittest.TestCase):
    def test_same_chart_labels_have_explicit_observations_without_probabilities(self):
        for target, label in ((97.1, "near-term"), (97.5, "plausible"), (99, "stretch")):
            result = attempt_reachability(attempts(), target, as_of=AS_OF)
            self.assertEqual(result["status"], "heuristic")
            self.assertEqual(result["label"], label)
            self.assertEqual(result["evidence"]["considered_attempt_count"], 6)
            self.assertNotIn("probability", result)

    def test_missing_single_duplicate_stale_variable_or_lamp_evidence_stays_unknown(self):
        histories = [
            [],
            attempts()[:1] * 10,
            attempts([95, 99, 93, 99, 95, 98]),
            [{**a, "recorded_at": a["recorded_at"] - 20 * DAY_MS} for a in attempts()],
            [{**a, "recorded_at": None} for a in attempts()],
            [{**a, "lamp": ""} for a in attempts()],
        ]
        for history in histories:
            with self.subTest(history=history):
                self.assertEqual(
                    attempt_reachability(history, 97, as_of=AS_OF)["status"], "unknown"
                )
        self.assertEqual(
            attempt_reachability(attempts(), 100, "AP", as_of=AS_OF)["status"], "unknown"
        )
        self.assertEqual(attempt_reachability(attempts(), None, as_of=AS_OF)["status"], "unknown")

    def test_future_conflicting_or_pb_snapshot_inputs_are_rejected_without_mutation(self):
        original = attempts()
        snapshot = copy.deepcopy(original)
        self.assertEqual(retained_attempts(original[::-1] + original, as_of=AS_OF), original)
        self.assertEqual(original, snapshot)
        for history in (
            [{**original[0], "recorded_at": AS_OF + 1}],
            [original[0], {**original[0], "percent": 90}],
            [{"pb_achieved_at": AS_OF, "percent": 97}],
        ):
            with self.assertRaises(ValueError):
                attempt_reachability(history, 97, as_of=AS_OF)


class ScoringIntegrationTests(unittest.TestCase):
    def test_disabled_roles_do_not_generate_candidates_and_quotas_fail_early(self):
        pack = {"charts": [{"chart_id": "synthetic"}]}
        overlay = {
            "entries": [{"chart_id": "synthetic", "attempts": []}],
            "coverage": {"cutoff_ms": AS_OF},
        }
        with patch("maimai_intelligence.intelligence_recommendations.query_profiles") as query:
            result = prepare_recommendations(
                pack, overlay, {"pbs": []}, {}, practice_pattern=PATTERN, quotas=(0, 0, 0)
            )
            self.assertEqual(result["cards"], [])
            query.assert_not_called()
            with self.assertRaises(ValueError):
                prepare_recommendations({}, {}, {}, {}, quotas=(0, -1, 0))

    def test_actual_analyzer_on_authored_charts_to_scored_shortlist_and_explicit_goal(self):
        pack, _ = synthetic_catalog()
        orbit = next(c for c in pack["charts"] if c["chart_id"] == "synthetic:orbit:STD:EXPERT:r1")
        overlay = {
            "entries": [{"chart_id": orbit["chart_id"], "attempts": []}],
            "coverage": {"cutoff_ms": AS_OF},
        }
        result = prepare_recommendations(
            pack, overlay, {"pbs": []}, {}, practice_goal={"pattern_id": PATTERN}, quotas=(0, 2, 0)
        )
        self.assertGreater(result["practice_scoring"]["unique_candidate_count"], 0)
        self.assertTrue(result["cards"])
        self.assertTrue(all(c["practice_score"]["terms"] for c in result["cards"]))
        self.assertTrue(all(c["reachability"]["status"] == "unknown" for c in result["cards"]))
        with self.assertRaises(ValueError):
            prepare_recommendations(
                pack,
                overlay,
                {"pbs": []},
                {},
                practice_pattern="different",
                practice_goal={"pattern_id": PATTERN},
            )


if __name__ == "__main__":
    unittest.main()
