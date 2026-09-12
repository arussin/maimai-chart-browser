"""Scoped Umiyuri recurrence, structural negatives and observation boundaries."""

import copy
import unittest

from maimai_analyzer.contracts import normalize_chart
from maimai_analyzer.core import analyze
from maimai_analyzer.pattern_compounds import DEFINITIONS
from maimai_analyzer.pattern_evidence import phased_pairs
from tests.test_pattern_sequences import chart_for, result

FORM = "{8},8-4[8:1]/1,7,1-5[8:1]/8,2,8-4[8:1]/1,7,1-5[8:1]/8,2,"


class PatternCompoundTests(unittest.TestCase):
    def test_canonical_form_retains_exact_events_and_scoped_claim(self):
        raw = chart_for(FORM)
        self.assertEqual(result(raw, "umiyuri")["occurrence_count"], 1)
        match = next(o for o in analyze(raw)["occurrences"] if o["pattern_id"] == "pattern.umiyuri")
        self.assertEqual(match["measurements"]["pair_count"], 4)
        self.assertEqual(match["measurements"]["family_coverage"], "scoped_form")
        self.assertEqual(len(match["event_ids"]), 11)
        self.assertEqual(len(match["path_ids"]), 4)
        self.assertFalse(phased_pairs(raw)["automatic_community_tagging"])

    def test_tempo_rotation_and_reflection_preserve_recurrence(self):
        for bpm in (107, 173, 240):
            for transform in (lambda p: (p + 2) % 8 + 1, lambda p: 9 - p):
                raw = chart_for(FORM, bpm)
                for event in raw["onsets"]:
                    event["position"] = transform(event["position"])
                self.assertEqual(result(raw, "umiyuri")["occurrence_count"], 1)

    def test_timing_overlap_alone_and_short_or_changed_pairs_do_not_qualify(self):
        for body in (
            FORM.replace("1-5[8:1]/8", "8-4[8:1]/1"),
            FORM.replace(",7,", ",,", 1),
            FORM.replace("8-4[8:1]/1", "8-4[8:1]/2", 1),
            "{8},8-4[8:1]/1,7,1-5[8:1]/8,2,8-4[8:1]/1,7,",
            "{8}1-5[4:4],2,3,4,5,6,7,8,",
        ):
            with self.subTest(body=body):
                self.assertEqual(result(chart_for(body), "umiyuri")["occurrence_count"], 0)

    def test_extra_intervening_input_and_fan_head_break_the_strict_form(self):
        raw = chart_for(FORM)
        extra = copy.deepcopy(raw["onsets"][2])
        extra.update(event_id="extra", time_us=375000, beat=[3, 4], group_id=None)
        raw["onsets"].append(extra)
        self.assertEqual(result(raw, "umiyuri")["occurrence_count"], 0)
        # Preserve the legacy research API while making the browser rule stricter.
        self.assertEqual(len(phased_pairs(raw)["occurrences"]), 1)
        raw = chart_for(FORM)
        extra_path = copy.deepcopy(raw["slides"][0])
        extra_path["path_id"] = "extra-path"
        raw["slides"].append(extra_path)
        self.assertEqual(result(raw, "umiyuri")["occurrence_count"], 0)

    def test_launch_rounding_tolerance_and_unknown_coverage(self):
        for offset, expected in ((2, 1), (3, 0)):
            raw = chart_for(FORM)
            raw["slides"][0]["movement_start_us"] += offset
            raw["slides"][0]["wait_end_us"] += offset
            self.assertEqual(result(raw, "umiyuri")["occurrence_count"], expected)
        for capability in DEFINITIONS["pattern.umiyuri"][0]:
            raw = chart_for(FORM)
            raw["capabilities"].remove(capability)
            self.assertEqual(result(raw, "umiyuri")["status"], "unknown")
        raw = chart_for(FORM)
        normalized = normalize_chart(raw)
        raw["known_intervals"] = [
            [normalized["span_start_us"], 500000],
            [1000000, normalized["span_end_us"]],
        ]
        self.assertEqual(result(raw, "umiyuri")["status"], "unknown")


if __name__ == "__main__":
    unittest.main()
