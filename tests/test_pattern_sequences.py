"""Authored rhythm/layout positives, confusing negatives and coverage boundaries."""

import copy
import unittest

from maimai_analyzer.core import analyze_overview
from maimai_analyzer.pattern_sequences import DEFINITIONS
from maimai_analyzer.patterns import pattern_registry
from tests.test_simai_subset import parse

CASES = {
    "gallop_pairs": ("{16}1,2,,1,2,,1,2,,", "{16}1,2,1,2,1,2,"),
    "three_note_burst": ("{16}8,,,,1,2,3,,,,8,", "{16}8,1,2,3,8,"),
    "triplet_grid": ("{12}1,2,3,4,5,6,7,8,", "{16}1,2,3,4,5,6,7,8,"),
    "offbeat_onsets": ("{8},1,,2,,3,,4,,", "{8}1,,2,,3,,4,,"),
    "chord_stream": ("{8}1/5,2/6,3/7,4/8,", "{8}1/5,2,3/7,4/8,"),
    "tap_staircase": ("{8}7,8,1,2,", "{8}7,1,3,5,"),
    "perimeter_run": ("{8}5,6,7,8,1,2,3,4,5,", "{8}5,6,7,8,1,2,3,"),
    "direction_reversal": ("{8}1,2,3,2,1,", "{8}1,2,1,2,1,2,1,"),
}


def result(chart, name):
    return next(
        tag for tag in analyze_overview(chart)["tags"] if tag["pattern_id"] == "pattern." + name
    )


def chart_for(body, bpm=120):
    return parse(f"({bpm}){body}E")[0]


class PatternSequenceTests(unittest.TestCase):
    def test_every_sequence_rule_has_a_positive_and_confusing_negative(self):
        self.assertEqual(set(DEFINITIONS), {"pattern." + name for name in CASES})
        for name, (positive, negative) in CASES.items():
            with self.subTest(pattern=name):
                self.assertEqual(result(chart_for(positive), name)["status"], "detected")
                self.assertEqual(
                    result(chart_for(negative), name)["status"],
                    "not-detected-with-supported-coverage",
                )

    def test_rules_survive_tempo_rounding_rotation_and_reflection(self):
        for name, (body, _) in CASES.items():
            for bpm in (107, 173, 240):
                raw = chart_for(body, bpm)
                for transform in (lambda p: (p + 2) % 8 + 1, lambda p: 9 - p):
                    changed = copy.deepcopy(raw)
                    for event in changed["onsets"]:
                        event["position"] = transform(event["position"])
                    with self.subTest(pattern=name, bpm=bpm):
                        self.assertEqual(result(changed, name)["occurrence_count"], 1)

    def test_missing_capability_never_claims_supported_absence(self):
        registry = {p["pattern_id"]: p for p in pattern_registry()["entries"]}
        for name, (body, _) in CASES.items():
            for capability in registry["pattern." + name]["required_capabilities"]:
                raw = chart_for(body)
                raw["capabilities"].remove(capability)
                with self.subTest(pattern=name, capability=capability):
                    observed = result(raw, name)
                    self.assertEqual(observed["status"], "unknown")
                    self.assertIsNone(observed["occurrence_count"])

    def test_chords_split_single_input_rhythms(self):
        for name, body in [
            ("gallop_pairs", "{16}1,2,,1/5,2,,1,2,,"),
            ("triplet_grid", "{12}1,2,3/7,4,5,6,7,8,"),
            ("offbeat_onsets", "{8},1,,2/6,,3,,4,,"),
            ("tap_staircase", "{8}7,8/4,1,2,"),
        ]:
            with self.subTest(pattern=name):
                self.assertEqual(result(chart_for(body), name)["occurrence_count"], 0)

    def test_triplet_count_and_long_gap_do_not_create_a_sequence(self):
        for body in ("{12}1,2,3,", "{12}1,2,3,,,,,,,,,4,5,6,"):
            self.assertEqual(result(chart_for(body), "triplet_grid")["occurrence_count"], 0)
        self.assertEqual(
            result(chart_for("{8}1,2,3,,,,,4,"), "tap_staircase")["occurrence_count"], 0
        )

    def test_burst_requires_known_surrounding_silence_and_complete_neighbors(self):
        raw = chart_for(CASES["three_note_burst"][0])
        raw["known_intervals"] = [[500000, 750001]]
        self.assertEqual(result(raw, "three_note_burst")["status"], "unknown")
        self.assertEqual(
            result(chart_for("{16}1,2,3,,,,8,"), "three_note_burst")["occurrence_count"], 0
        )

    def test_equal_time_chords_need_authored_simultaneous_groups(self):
        raw = chart_for(CASES["chord_stream"][0])
        for event in raw["onsets"]:
            event["group_id"] = None
        self.assertEqual(result(raw, "chord_stream")["occurrence_count"], 0)

    def test_maximal_runs_do_not_explode_into_overlapping_windows(self):
        self.assertEqual(
            result(chart_for("{12}" + "1,2," * 100), "triplet_grid")["occurrence_count"], 1
        )
        self.assertEqual(
            result(chart_for("{8}" + "1,2,3,4,5,6,7,8," * 10), "perimeter_run")["occurrence_count"],
            1,
        )

    def test_known_runs_survive_an_unknown_gap_without_claiming_full_coverage(self):
        raw = chart_for("{12}" + "1,2,3,4,5,6," * 4)
        raw["known_intervals"] = [[0, 1500000], [2000000, 3500000]]
        tag = result(raw, "triplet_grid")
        self.assertEqual(tag["status"], "detected")
        self.assertEqual(tag["occurrence_count"], 2)
        self.assertEqual(tag["coverage"], "partial")


if __name__ == "__main__":
    unittest.main()
