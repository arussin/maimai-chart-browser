"""The retained exception review cannot silently redirect provider identities."""

import json
import unittest
from copy import deepcopy
from pathlib import Path

from maimai_intelligence.registry import digest, read_registry
from scripts.check_maishift_review import source_identity, validate_review

ROOT = Path(__file__).resolve().parents[1]


class MaishiftReviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.registry = read_registry(ROOT / "registry")
        cls.review = json.loads(
            (ROOT / "registry/maishift-review-20260921.json").read_text("utf-8")
        )

    def reseal(self, group):
        for chart in group["charts"]:
            chart["source_identity_sha256"] = digest(source_identity(group, chart))
        group["decision_sha256"] = digest(
            {k: v for k, v in group.items() if k != "decision_sha256"}
        )

    def test_all_reviewed_exceptions_have_distinct_region_and_chart_keys(self):
        rows = validate_review(self.review, self.registry)
        self.assertEqual(len(rows), 56)
        self.assertEqual(sum(k.startswith("maishift:intl:") for k in rows), 48)
        self.assertEqual(sum(k.startswith("maishift:jp:") for k in rows), 8)
        self.assertEqual(
            rows["maishift:intl:170"]["chart_id"], rows["maishift:jp:12570"]["chart_id"]
        )

    def test_changed_source_text_cannot_reuse_a_decision(self):
        review = deepcopy(self.review)
        review["groups"][0]["source"]["artist"] = "Different artist"
        with self.assertRaisesRegex(ValueError, "decision changed"):
            validate_review(review, self.registry)

    def test_chart_variant_redirect_rejected_even_after_rehash(self):
        review = deepcopy(self.review)
        group = review["groups"][0]
        group["charts"][0]["chart_id"] = group["charts"][1]["chart_id"]
        self.reseal(group)
        with self.assertRaisesRegex(ValueError, "chart slot"):
            validate_review(review, self.registry)

    def test_wrong_jacket_or_region_rejected_even_after_rehash(self):
        for field, value in [("jacket_filename", "different.png"), ("region", "jp")]:
            review = deepcopy(self.review)
            group = review["groups"][0]
            (group if field == "region" else group["source"])[field] = value
            self.reseal(group)
            with self.assertRaises(ValueError):
                validate_review(review, self.registry)

    def test_duplicate_decision_rejected(self):
        review = deepcopy(self.review)
        review["groups"].append(deepcopy(review["groups"][0]))
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            validate_review(review, self.registry)

    def test_missing_official_chart_slot_rejected(self):
        review = deepcopy(self.review)
        group = review["groups"][0]
        del group["official"]["observed_record"]["dx_lev_bas"]
        self.reseal(group)
        with self.assertRaisesRegex(ValueError, "slot absent"):
            validate_review(review, self.registry)

    def test_levels_are_not_chart_identity(self):
        review = deepcopy(self.review)
        group = review["groups"][0]
        group["official"]["observed_record"]["dx_lev_bas"] = "4"
        self.reseal(group)
        before, after = (
            validate_review(self.review, self.registry),
            validate_review(review, self.registry),
        )
        self.assertEqual(
            {k: v["chart_id"] for k, v in before.items()},
            {k: v["chart_id"] for k, v in after.items()},
        )
        self.assertEqual(
            {k: v["expected_source"] for k, v in before.items()},
            {k: v["expected_source"] for k, v in after.items()},
        )


if __name__ == "__main__":
    unittest.main()
