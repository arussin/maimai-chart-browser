import unittest

from maimai_analyzer.fixtures import synthetic_charts
from maimai_intelligence.overview_codec import compact_overview, expand_tags
from maimai_intelligence.research_overview import chart_overview, overview_package
from maimai_intelligence.snapshots import canonical


class OverviewCodecTests(unittest.TestCase):
    def test_sparse_roundtrip_keeps_unknown_absent_partial_and_evidence_distinct(self):
        original = overview_package({c["chart_id"]: chart_overview(c) for c in synthetic_charts()})
        compact = compact_overview(original)
        self.assertLess(len(canonical(compact)), len(canonical(original)))
        self.assertIs(compact_overview(compact), compact)
        for chart_id, record in compact["charts"].items():
            expected = original["charts"][chart_id]
            self.assertEqual(
                expand_tags(record, len(original["patterns"]), compact["evidence_pool"]),
                sorted(expected["tags"]),
            )
            self.assertEqual(record["segments"], expected["segments"])
            self.assertEqual(record["source_hash"], expected["source_hash"])

    def test_unknown_is_not_mistaken_for_absence_and_partial_results_remain_explicit(self):
        rows = [
            [0, "unknown", None, None, "partial", False, [], []],
            [1, "not-detected-with-supported-coverage", 0, 0, "complete", False, [], []],
            [2, "detected", 1, 0.1, "partial", False, [[0, 2]], [{"target_pattern_id": "p"}]],
            [3, "unknown", None, None, "partial", True, [], []],
        ]
        compact = compact_overview(
            {"version": "research-overview-2", "charts": {"one": {"tags": rows}}}
        )
        record = compact["charts"]["one"]
        self.assertEqual(record["absent"], [1])
        self.assertEqual(expand_tags(record, 4, compact["evidence_pool"]), rows)
