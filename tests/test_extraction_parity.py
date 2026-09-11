"""Expected outputs captured from source commit 1503c87 before extraction."""

import json
import unittest
from pathlib import Path

from maimai_intelligence.calculations import rating_summary
from maimai_intelligence.intelligence_recommendations import prepare_recommendations


class ExtractionParityTests(unittest.TestCase):
    def test_original_rating_and_full_recommendation_outputs_are_unchanged(self):
        path = Path(__file__).with_name("golden") / "source-recommendations.json"
        data = json.loads(path.read_text("utf-8"))
        self.assertEqual(
            rating_summary(data["pbs"], ("Synthetic release",)), data["rating_summary"]
        )
        actual = prepare_recommendations(
            data["pack"],
            data["overlay"],
            data["pbs"],
            data["mapping"],
            policy=data["policy"],
            complete=True,
            practice_goal=data["goal"],
        )
        self.assertEqual(actual, data["recommendations"])
