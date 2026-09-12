"""Mixed-input rules distinguish movement, waiting, touching and simultaneous inputs."""

import copy
import unittest

from maimai_analyzer.fixtures import synthetic_charts
from tests.test_pattern_sequences import chart_for, result


def variable_waits():
    chart = synthetic_charts()[0]
    for i, wait in zip((0, 4, 8), (500000, 250000, 625000), strict=True):
        event = chart["onsets"][i]
        event["role"] = "star_tap"
        start = event["time_us"]
        chart["slides"].append(
            {
                "path_id": f"path-{i}",
                "head_id": event["event_id"],
                "wait_start_us": start,
                "wait_end_us": start + wait,
                "movement_start_us": start + wait,
                "movement_end_us": start + wait + 250000,
            }
        )
    return chart


class PatternIntervalTests(unittest.TestCase):
    def test_staggered_starts_require_real_overlap_and_distinct_movement_starts(self):
        raw = synthetic_charts()[3]
        self.assertEqual(result(raw, "staggered_slide_starts")["occurrence_count"], 1)
        same = copy.deepcopy(raw)
        same["slides"][0].update(wait_end_us=2000000, movement_start_us=2000000)
        self.assertEqual(result(same, "staggered_slide_starts")["occurrence_count"], 0)
        touching = copy.deepcopy(raw)
        touching["slides"][1].update(wait_end_us=6000000, movement_start_us=6000000)
        self.assertEqual(result(touching, "staggered_slide_starts")["occurrence_count"], 0)

    def test_hold_slide_overlap_excludes_waits_and_touching_endpoints(self):
        raw = synthetic_charts()[3]
        self.assertEqual(result(raw, "hold_slide_overlap")["occurrence_count"], 1)
        for slide in raw["slides"]:
            slide.update(wait_end_us=5000000, movement_start_us=5000000)
        self.assertEqual(result(raw, "hold_slide_overlap")["occurrence_count"], 0)

    def test_variable_waits_require_three_heads_and_changed_beat_duration(self):
        raw = variable_waits()
        self.assertEqual(result(raw, "variable_slide_wait")["occurrence_count"], 1)
        constant = copy.deepcopy(raw)
        for slide in constant["slides"]:
            launch = slide["wait_start_us"] + 500000
            slide.update(
                wait_end_us=launch, movement_start_us=launch, movement_end_us=launch + 250000
            )
        self.assertEqual(result(constant, "variable_slide_wait")["occurrence_count"], 0)
        raw["slides"].pop()
        self.assertEqual(result(raw, "variable_slide_wait")["occurrence_count"], 0)

    def test_tempo_changes_do_not_turn_equal_beat_waits_into_variable_waits(self):
        raw = chart_for("{4}1-5[4:1],(240)2-6[4:1],(120)3-7[4:1],")
        self.assertGreater(len({s["wait_end_us"] - s["wait_start_us"] for s in raw["slides"]}), 1)
        self.assertEqual(result(raw, "variable_slide_wait")["occurrence_count"], 0)

    def test_waits_without_a_tempo_map_are_unknown(self):
        raw = variable_waits()
        raw["bpm_segments"] = []
        self.assertEqual(result(raw, "variable_slide_wait")["status"], "unknown")

    def test_touch_alternation_needs_recurrence_and_excludes_chords(self):
        positive = chart_for("{8}C,1,B1,2,C,3,")
        self.assertEqual(result(positive, "touch_tap_interleave")["occurrence_count"], 1)
        for body in ("{8}C/1,B1/2,C/3,", "{8}C,1,", "{8}C,B1,1,2,"):
            with self.subTest(body=body):
                self.assertEqual(
                    result(chart_for(body), "touch_tap_interleave")["occurrence_count"], 0
                )

    def test_capabilities_and_source_identity_gate_mixed_input_tags(self):
        cases = [
            ("staggered_slide_starts", synthetic_charts()[3], "slide_movement"),
            ("hold_slide_overlap", synthetic_charts()[3], "hold_intervals"),
            ("variable_slide_wait", variable_waits(), "slide_wait"),
            ("touch_tap_interleave", chart_for("{8}C,1,B1,2,"), "touch_zones"),
        ]
        for name, raw, capability in cases:
            raw["capabilities"].remove(capability)
            with self.subTest(pattern=name):
                self.assertEqual(result(raw, name)["status"], "unknown")
                raw["capabilities"].append(capability)
                raw["source"]["identity_status"] = "ambiguous"
                self.assertEqual(result(raw, name)["status"], "unknown")


if __name__ == "__main__":
    unittest.main()
