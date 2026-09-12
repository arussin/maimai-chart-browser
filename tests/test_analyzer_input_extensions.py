"""Authored normalized identities and linked inputs for extended notation support."""

import copy
import json
import shutil
import subprocess  # noqa: S404 - explicit local Node command; no shell/network
import unittest
from fractions import Fraction
from unittest.mock import patch

from maimai_analyzer import (
    ChartInputError,
    analyze,
    contracts,
    normalize_chart,
    pattern_registry,
    synthetic_charts,
)
from maimai_analyzer.catalog import build_catalog
from maimai_analyzer.simai_subset import parse_simai_subset
from maimai_analyzer.wire import decode_pack, encode_pack
from maimai_intelligence.explorer import validate_exploration_pack


def linked_head_chart(role):
    chart = synthetic_charts()[0]
    chart["onsets"] = chart["onsets"][:1]
    event = chart["onsets"][0]
    event["role"] = role
    event["position"] = "C" if role in {"touch", "touch_hold"} else 1
    chart["holds"] = (
        [{"hold_id": "authored-hold", "onset_id": event["event_id"], "end_us": 1_500_000}]
        if role in {"hold_onset", "touch_hold"}
        else []
    )
    chart["slides"] = [
        {
            "path_id": "authored-slide",
            "head_id": event["event_id"],
            "wait_start_us": 0,
            "wait_end_us": 500_000,
            "movement_start_us": 500_000,
            "movement_end_us": 1_500_000,
            "path": "1-5",
        }
    ]
    return chart


class AnalyzerInputExtensionsTests(unittest.TestCase):
    def test_rational_integer_boundaries_reduce_exactly(self):
        limit = 2**53 - 1
        for pair in ([limit, 1], [limit - 1, limit], [-limit, limit], [limit, limit]):
            with self.subTest(pair=pair):
                chart = synthetic_charts()[0]
                chart["onsets"] = chart["onsets"][:1]
                chart["onsets"][0]["beat"] = pair
                chart["bpm_segments"] = []
                rational = Fraction(*pair)
                normalized = normalize_chart(chart)
                self.assertEqual(
                    normalized["onsets"][0]["beat"], [rational.numerator, rational.denominator]
                )

    def test_unsafe_or_malformed_rational_components_reject_before_fraction_work(self):
        limit = 2**53 - 1
        for pair in (
            [limit + 1, 1],
            [-limit - 1, 1],
            [1, limit + 1],
            [limit + 1, limit + 1],
            [10**1000, 1],
            [1, 0],
            [1, -1],
            [True, 1],
            [1, True],
            [1.0, 1],
        ):
            with (
                self.subTest(pair=pair),
                patch.object(
                    contracts, "Fraction", side_effect=AssertionError("Unsafe fraction work")
                ),
                self.assertRaisesRegex(ChartInputError, "bounded rational"),
            ):
                contracts._beat(pair)

    @unittest.skipUnless(shutil.which("node"), "Node is needed for browser JSON number parity")
    def test_safe_rational_components_survive_browser_json_without_precision_loss(self):
        limit = 2**53 - 1
        pairs = [[limit, 1], [limit - 1, limit], [-limit, limit]]
        encoded = json.dumps(pairs, separators=(",", ":"))
        result = subprocess.run(  # noqa: S603 - fixed local executable and script
            [
                shutil.which("node"),
                "-e",
                """
const pairs=JSON.parse(process.argv[1]);
if(!pairs.every(pair=>pair.every(Number.isSafeInteger))) throw Error('unsafe integer');
process.stdout.write(JSON.stringify(pairs));
""",
                encoded,
            ],
            text=True,
            capture_output=True,
            check=True,
            timeout=30,
        )
        self.assertEqual(result.stdout, encoded)

    def test_large_exact_grid_fractions_analyze_and_survive_compact_browser_wire(self):
        raw, _ = parse_simai_subset(
            "(120){999983}1,{999979}1,1,E",
            chart_id="authored:exact-grid:STD:EXPERT:r1",
            song_id="authored:exact-grid",
            format="STD",
            difficulty="EXPERT",
            revision="r1",
            source=synthetic_charts()[0]["source"],
        )
        self.assertGreater(raw["onsets"][2]["beat"][1], 1000000)
        expected = Fraction(4, 999983) + Fraction(4, 999979)
        self.assertEqual(Fraction(*raw["onsets"][2]["beat"]), expected)
        profile = analyze(raw)
        metadata = {
            key: raw[key] for key in ("chart_id", "song_id", "format", "difficulty", "revision")
        }
        metadata.update(
            title="Authored exact grid", source_status="available", identity_status="exact"
        )
        pack, _ = build_catalog([metadata], [profile], pattern_registry())
        chart = pack["charts"][0]
        self.assertEqual(chart["analysis_status"], "complete")
        self.assertNotIn("onsets", chart)
        self.assertNotIn("bpm_segments", chart)
        self.assertTrue(chart["occurrences"])
        self.assertTrue(
            all(
                "start_beat" not in occurrence and "end_beat" not in occurrence
                for occurrence in chart["occurrences"]
            )
        )
        self.assertIn("4/999983", " ".join(chart["descriptor"]["ngrams"]))
        self.assertEqual(decode_pack(encode_pack(pack)), pack)
        self.assertEqual(validate_exploration_pack(pack)["charts"][0]["chart_id"], raw["chart_id"])

    def test_fractional_anchor_clock_rounds_once_without_accumulating_drift(self):
        chart = synthetic_charts()[0]
        chart["onsets"] = chart["onsets"][:1]
        chart["bpm_segments"] = [
            {"time_us": 0, "beat": [0, 1], "bpm": [120, 1]},
            {"time_us": 166667, "beat": [1, 3], "bpm": [120, 1]},
            {"time_us": 333333, "beat": [2, 3], "bpm": [120, 1]},
            {"time_us": 500000, "beat": [1, 1], "bpm": [120, 1]},
        ]
        self.assertEqual(normalize_chart(chart)["bpm_segments"], chart["bpm_segments"])
        # Each local interval can round to 166667us, but the third absolute
        # anchor must still round to 333333us on the continuous exact clock.
        chart["bpm_segments"][2]["time_us"] = 333334
        with self.assertRaisesRegex(ChartInputError, "continuous"):
            normalize_chart(chart)

    def test_anchor_rounding_uses_nearest_ties_even_before_origin_shift(self):
        for origin, beat, correct, incorrect in (
            (0, [3, 1000000], 2, 1),
            (0, [5, 1000000], 2, 3),
            (-1, [3, 1000000], 0, 1),
        ):
            with self.subTest(origin=origin, beat=beat):
                chart = synthetic_charts()[0]
                chart["onsets"] = chart["onsets"][:1]
                chart["onsets"][0]["time_us"] = origin
                chart["bpm_segments"] = [
                    {"time_us": origin, "beat": [0, 1], "bpm": [120, 1]},
                    {"time_us": correct, "beat": beat, "bpm": [150, 1]},
                ]
                normalized = normalize_chart(chart)
                self.assertEqual(Fraction(*normalized["bpm_segments"][1]["beat"]), Fraction(*beat))
                self.assertEqual(normalized["bpm_segments"][1]["time_us"], correct - origin)
                chart["bpm_segments"][1]["time_us"] = incorrect
                with self.assertRaisesRegex(ChartInputError, "continuous"):
                    normalize_chart(chart)

    def test_anchor_rounding_still_rejects_discontinuity_and_nonincreasing_beats(self):
        for timestamp, beat in ((500001, [1, 1]), (500000, [3, 1]), (1, [0, 1]), (0, [1, 1])):
            chart = synthetic_charts()[0]
            chart["onsets"] = chart["onsets"][:1]
            chart["bpm_segments"] = [
                {"time_us": 0, "beat": [0, 1], "bpm": [120, 1]},
                {"time_us": timestamp, "beat": beat, "bpm": [150, 1]},
            ]
            with (
                self.subTest(time=timestamp, beat=beat),
                self.assertRaisesRegex(ChartInputError, "continuous and strictly ordered"),
            ):
                normalize_chart(chart)

    def test_parser_fractional_tempo_anchors_keep_exact_beats_and_declared_timestamps(self):
        source = synthetic_charts()[0]["source"]
        raw, audit = parse_simai_subset(
            "(173.5){7}1,(120)2,(137.25)3,E",
            chart_id="authored:tempo:STD:EXPERT:r1",
            song_id="authored:tempo",
            format="STD",
            difficulty="EXPERT",
            revision="r1",
            source=source,
        )
        first_delta = Fraction(480, 2429)
        second_delta = Fraction(2, 7)
        expected_times = [
            0,
            round(first_delta * 1000000),
            round((first_delta + second_delta) * 1000000),
        ]
        self.assertEqual([event["time_us"] for event in raw["onsets"]], expected_times)
        self.assertEqual([event["beat"] for event in raw["onsets"]], [[0, 1], [4, 7], [8, 7]])
        normalized = normalize_chart(raw)
        self.assertEqual(normalized["bpm_segments"], raw["bpm_segments"])
        self.assertEqual(analyze(raw)["metrics"]["onset_count"], 3)
        self.assertEqual(audit["tokens"][1]["seconds"], [480, 2429])

    def test_existing_onset_tolerance_remains_bounded_separately_from_anchor_rounding(self):
        chart = synthetic_charts()[0]
        chart["onsets"] = chart["onsets"][:2]
        event = chart["onsets"][1]
        expected = event["time_us"]
        for offset in (-2, 2):
            event["time_us"] = expected + offset
            self.assertEqual(normalize_chart(chart)["onsets"][1]["time_us"], expected + offset)
        event["time_us"] = expected + 3
        with self.assertRaisesRegex(ChartInputError, "Onset beat disagrees"):
            normalize_chart(chart)

    def test_easy_identity_is_preserved_without_remapping(self):
        chart = synthetic_charts()[0]
        chart.update(chart_id="authored:easy:STD:EASY:r1", difficulty="EASY")
        self.assertEqual(normalize_chart(chart)["difficulty"], "EASY")
        profile = analyze(chart)
        self.assertEqual(profile["difficulty"], "EASY")
        self.assertEqual(profile["chart_id"], "authored:easy:STD:EASY:r1")
        basic = analyze({**chart, "difficulty": "BASIC"})
        self.assertNotEqual(profile["cache_key"], basic["cache_key"])
        for unsupported in ("easy", "BEGINNER", "UNKNOWN"):
            with self.subTest(difficulty=unsupported), self.assertRaises(ChartInputError):
                normalize_chart({**chart, "difficulty": unsupported})

    def test_slide_head_can_link_tap_or_star_without_adding_an_onset(self):
        for role in ("tap", "star_tap"):
            with self.subTest(role=role):
                chart = linked_head_chart(role)
                normalized = normalize_chart(chart)
                self.assertEqual(len(normalized["onsets"]), 1)
                self.assertEqual(normalized["onsets"][0]["role"], role)
                self.assertEqual(normalized["slides"][0]["head_id"], chart["onsets"][0]["event_id"])
                self.assertEqual(analyze(chart)["metrics"]["onset_count"], 1)

    def test_slide_head_still_rejects_hold_and_touch_inputs(self):
        for role in ("hold_onset", "touch", "touch_hold"):
            with self.subTest(role=role), self.assertRaisesRegex(ChartInputError, "Slide head"):
                normalize_chart(linked_head_chart(role))
        chart = linked_head_chart("tap")
        chart["slides"][0]["head_id"] = "absent-input"
        with self.assertRaisesRegex(ChartInputError, "existing tap"):
            normalize_chart(chart)
        chart["slides"][0]["head_id"] = chart["onsets"][0]["event_id"]
        chart["onsets"][0]["time_us"] = 1
        with self.assertRaisesRegex(ChartInputError, "cannot precede its head"):
            normalize_chart(chart)

    def test_touch_zone_strings_and_button_positions_analyze_together(self):
        chart = synthetic_charts()[0]
        chart["onsets"] = chart["onsets"][:4]
        for index, (role, position) in enumerate(
            (("tap", 1), ("touch", "C"), ("touch", "E1"), ("touch_hold", "B8"))
        ):
            chart["onsets"][index].update(role=role, position=position)
        chart["onsets"][1].update(time_us=0, beat=[0, 1])
        for event in chart["onsets"][:2]:
            event["group_id"] = "authored-mixed-group"
        chart["holds"] = [
            {
                "hold_id": "authored-touch-hold",
                "onset_id": chart["onsets"][3]["event_id"],
                "end_us": 1_500_000,
            }
        ]
        original = copy.deepcopy(chart)
        profile = analyze(chart)
        self.assertEqual(chart, original)
        self.assertEqual(profile["metrics"]["onset_count"], 4)
        self.assertEqual(profile["descriptor"]["features"]["touch_fraction"], 0.75)
        self.assertTrue(profile["descriptor"]["sequence"])
        for pattern_id in ("pattern.two_position_alternation", "pattern.same_position_repetition"):
            found = next(tag for tag in profile["tags"] if tag["pattern_id"] == pattern_id)
            self.assertEqual(found["occurrence_count"], 0)


if __name__ == "__main__":
    unittest.main()
