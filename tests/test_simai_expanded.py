"""Authored golden input/timing cases for expanded Simai notation.

Expected timestamps follow the documented arithmetic; no public chart text,
account records, third-party parser execution or learned labels are involved.
"""

import hashlib
import unittest
from fractions import Fraction

from maimai_analyzer import analyze, normalize_chart
from maimai_analyzer.rational import decode_rational
from maimai_analyzer.simai_subset import SimaiSubsetError, parse_simai_subset


def parse(body):
    return parse_simai_subset(
        body,
        chart_id="synthetic:expanded:DX:MASTER",
        song_id="synthetic:expanded",
        format="DX",
        difficulty="MASTER",
        revision="authored-r1",
        source={
            "source_id": "authored-expanded",
            "revision": "authored-r1",
            "kind": "authored_synthetic",
            "identity_status": "exact",
        },
    )


class SimaiExpandedTests(unittest.TestCase):
    def test_explicit_seconds_keep_sixteen_decimal_places_without_float_conversion(self):
        body = "(120){4}1-5[0.1234567890123456##0.2345678901234567],E"
        raw, audit = parse(body)
        waiting = Fraction("0.1234567890123456")
        moving = Fraction("0.2345678901234567")
        self.assertEqual(raw["slides"][0]["movement_start_us"], round(waiting * 1000000))
        self.assertEqual(raw["slides"][0]["movement_end_us"], round((waiting + moving) * 1000000))
        self.assertEqual(decode_rational(audit["tokens"][0]["duration_seconds"]), moving)
        self.assertIn(
            "slide_seconds_without_bpm",
            parse("(120){4}1-5[#0.5],E")[1]["tokens"][0]["dialect_aliases"],
        )
        with self.assertRaises(SimaiSubsetError):
            parse("(120){4}1-5[0.123456789012345678901234567890123##1],E")

    def test_extended_decimal_seconds_remain_exact_and_bounded(self):
        moving = Fraction("0.12345678901234567890123456789012")
        raw, audit = parse("(120){4}1-5[0##0.12345678901234567890123456789012],E")
        self.assertEqual(raw["slides"][0]["movement_end_us"], round(moving * 1000000))
        pair = audit["tokens"][0]["duration_seconds"]
        self.assertEqual(decode_rational(pair), moving)
        self.assertTrue(all(isinstance(component, str) for component in pair))
        for command in ("{}", "{.}", "{1e2}", "{1.2.3}"):
            with self.subTest(command=command):
                with self.assertRaisesRegex(
                    SimaiSubsetError, "Timing parameter requires a decimal number"
                ):
                    parse("(120)" + command + "1,E")

    def test_touch_aliases_firework_noncentral_hold_and_ex_are_distinct_inputs(self):
        raw, audit = parse("(120){4}C1f/E2fh[4:1]/3bx,C2,E")
        self.assertEqual([n["position"] for n in raw["onsets"]], ["C", "E2", 3, "C"])
        self.assertEqual(
            [n["role"] for n in raw["onsets"]], ["touch", "touch_hold", "tap", "touch"]
        )
        self.assertEqual([n["time_us"] for n in raw["onsets"]], [0, 0, 0, 500000])
        self.assertTrue(raw["onsets"][2]["break"] and raw["onsets"][2]["ex"])
        self.assertEqual(raw["holds"][0]["end_us"], 500000)
        self.assertTrue(audit["tokens"][0]["firework"] and audit["tokens"][1]["firework"])
        self.assertEqual(analyze(raw)["metrics"]["onset_count"], 4)
        with self.assertRaises(SimaiSubsetError):
            parse("(120){4}C1/C2,E")

    def test_head_break_ex_and_track_break_keep_separate_scope(self):
        raw, audit = parse("(120){4}1bx-5[4:1]b,2-6b[4:1],E")
        self.assertTrue(raw["onsets"][0]["break"] and raw["onsets"][0]["ex"])
        self.assertFalse(raw["onsets"][1]["break"] or raw["onsets"][1]["ex"])
        self.assertTrue(audit["tokens"][0]["paths"][0]["break"])
        self.assertTrue(audit["tokens"][1]["paths"][0]["break"])
        self.assertIn("track_break_before_duration", audit["tokens"][1]["dialect_aliases"])
        self.assertEqual([s["path"] for s in raw["slides"]], ["simai:1-5", "simai:2-6"])

    def test_shared_star_counts_one_input_and_two_independent_movement_intervals(self):
        raw, audit = parse("(120){4}1-5[4:1]*^3[8:1],E")
        self.assertEqual(len(raw["onsets"]), 1)
        self.assertEqual(len(raw["slides"]), 2)
        self.assertEqual({s["head_id"] for s in raw["slides"]}, {raw["onsets"][0]["event_id"]})
        self.assertEqual([s["movement_start_us"] for s in raw["slides"]], [500000, 500000])
        self.assertEqual([s["movement_end_us"] for s in raw["slides"]], [1000000, 750000])
        self.assertEqual(len(audit["tokens"][0]["paths"]), 2)
        self.assertEqual(analyze(raw)["metrics"]["onset_count"], 1)

    def test_total_duration_chain_is_one_path_without_fabricated_segment_times(self):
        raw, audit = parse("(120){4}1-3^5[4:1],E")
        self.assertEqual(len(raw["onsets"]), 1)
        self.assertEqual(len(raw["slides"]), 1)
        path = raw["slides"][0]
        self.assertEqual((path["movement_start_us"], path["movement_end_us"]), (500000, 1000000))
        self.assertEqual(len(path["segment_ids"]), 2)
        self.assertEqual(path["path"], "simai:1-3^5")
        detail = audit["tokens"][0]["paths"][0]
        self.assertEqual(detail["duration_mode"], "global")
        self.assertEqual(detail["segment_timing"], "total_only_no_geometry")
        self.assertNotIn("segment_movement_seconds", detail)
        self.assertIsNone(raw["geometry_version"])

    def test_per_segment_chain_uses_one_wait_and_sums_actual_segment_durations(self):
        raw, audit = parse("(120){4}1-3[4:1]^5[8:1],E")
        self.assertEqual(len(raw["slides"]), 1)
        self.assertEqual(raw["slides"][0]["movement_end_us"], 1250000)
        detail = audit["tokens"][0]["paths"][0]
        self.assertEqual(
            detail["segment_movement_seconds"],
            [
                [[1, 2], [1, 1]],
                [[1, 1], [5, 4]],
            ],
        )
        self.assertEqual(detail["duration_seconds"], [3, 4])

    def test_round_head_headless_slides_and_standalone_star_preserve_roles(self):
        raw, audit = parse("(120){4}1@-5[4:1],2?-6[4:1],3!^7[4:1],4$$,E")
        self.assertEqual([n["role"] for n in raw["onsets"]], ["tap", "star_tap"])
        self.assertEqual([n["position"] for n in raw["onsets"]], [1, 4])
        self.assertEqual([n["time_us"] for n in raw["onsets"]], [0, 1500000])
        self.assertEqual(
            [s["head_id"] for s in raw["slides"]], [raw["onsets"][0]["event_id"], None, None]
        )
        self.assertIsNone(audit["tokens"][1]["onset_id"])
        self.assertEqual(audit["tokens"][3]["presentation"], ["$", "$"])
        self.assertEqual(analyze(raw)["metrics"]["onset_count"], 2)

    def test_tempo_change_does_not_stretch_existing_hold_or_slide(self):
        raw, audit = parse("(120){4}1h[1:1]/3-7[2:1],(240)2,E")
        self.assertEqual(raw["holds"][0]["end_us"], 2000000)
        self.assertEqual(raw["slides"][0]["movement_start_us"], 500000)
        self.assertEqual(raw["slides"][0]["movement_end_us"], 1500000)
        self.assertEqual(raw["onsets"][-1]["time_us"], 500000)
        self.assertEqual(
            raw["bpm_segments"],
            [
                {"time_us": 0, "beat": [0, 1], "bpm": [120, 1]},
                {"time_us": 500000, "beat": [1, 1], "bpm": [240, 1]},
            ],
        )
        self.assertEqual(audit["end_marker"]["time_us"], 750000)

    def test_decimal_division_and_fixed_second_intervals_are_exact(self):
        raw, audit = parse("(120){2.5}1,2,{#0.125}3,4,E")
        self.assertEqual([n["time_us"] for n in raw["onsets"]], [0, 800000, 1600000, 1725000])
        self.assertEqual([n["beat"] for n in raw["onsets"]], [[0, 1], [8, 5], [16, 5], [69, 20]])
        self.assertEqual(audit["end_marker"]["time_us"], 1850000)
        fixed, _ = parse("(120){#0.25}1,(240)2,3,E")
        self.assertEqual([n["time_us"] for n in fixed["onsets"]], [0, 250000, 500000])
        self.assertEqual([n["beat"] for n in fixed["onsets"]], [[0, 1], [1, 2], [3, 2]])

    def test_bare_hold_is_one_1280th_measure_with_one_final_rounding(self):
        raw, audit = parse("(120){4}1h/Cfh,E")
        self.assertEqual([h["end_us"] for h in raw["holds"]], [1562, 1562])
        self.assertTrue(all(t["implicit_duration"] for t in audit["tokens"]))
        self.assertEqual(audit["tokens"][0]["duration_seconds"], [1, 640])
        self.assertEqual(audit["tokens"][0]["duration_beats"], [1, 320])

    def test_backtick_is_cumulative_milliseconds_with_slash_groups_preserved(self):
        raw, _ = parse("(120){4}1/2`3/4`5,6,E")
        self.assertEqual([n["time_us"] for n in raw["onsets"]], [0, 0, 1000, 1000, 2000, 500000])
        groups = [n["group_id"] for n in raw["onsets"]]
        self.assertEqual(groups[0], groups[1])
        self.assertEqual(groups[2], groups[3])
        self.assertNotEqual(groups[0], groups[2])
        self.assertIsNone(groups[4])
        self.assertIsNone(groups[5])

    def test_backtick_crossing_a_tempo_anchor_gets_actual_timeline_beat(self):
        raw, _ = parse("(120){#0.0005}1`2`3,(240)4,E")
        by_position = {note["position"]: note for note in raw["onsets"]}
        self.assertEqual([by_position[p]["time_us"] for p in [1, 2, 3, 4]], [0, 1000, 2000, 500])
        self.assertEqual(
            [by_position[p]["beat"] for p in [1, 2, 3, 4]],
            [[0, 1], [3, 1000], [7, 1000], [1, 1000]],
        )
        normalize_chart(raw)

    def test_comments_consume_exact_source_ranges_without_counting_commented_notation(self):
        body = " (120){8}1, || ignored 7, (999) E\n 2,E\n"
        raw, audit = parse(body)
        self.assertEqual([n["position"] for n in raw["onsets"]], [1, 2])
        self.assertEqual([n["time_us"] for n in raw["onsets"]], [0, 250000])
        self.assertEqual(len(audit["comments"]), 1)
        self.assertEqual(audit["body_sha256"], hashlib.sha256(body.encode()).hexdigest())
        for item in audit["comments"] + audit["commands"] + audit["tokens"] + [audit["end_marker"]]:
            self.assertEqual(body[item["source_start"] : item["source_end"]], item["source_text"])
        with self.assertRaises(SimaiSubsetError):
            parse("(120){4}1,E|| no newline")

    def test_documented_slide_duration_forms_have_exact_wait_and_movement(self):
        expected = [
            ("[180#4:1]", Fraction(1, 3), Fraction(1, 3)),
            ("[180#0.75]", Fraction(1, 3), Fraction(3, 4)),
            ("[0.25##0.75]", Fraction(1, 4), Fraction(3, 4)),
            ("[0.25##4:3]", Fraction(1, 4), Fraction(3, 2)),
            ("[0.25##180#4:3]", Fraction(1, 4), Fraction(1)),
            ("[#0.75]", Fraction(1, 2), Fraction(3, 4)),
        ]
        for spelling, waiting, moving in expected:
            with self.subTest(spelling=spelling):
                raw, audit = parse("(120){4}1-5" + spelling + ",E")
                path = raw["slides"][0]
                self.assertEqual(path["movement_start_us"], round(waiting * 1000000))
                self.assertEqual(path["movement_end_us"], round((waiting + moving) * 1000000))
                self.assertEqual(
                    audit["tokens"][0]["duration_seconds"], [moving.numerator, moving.denominator]
                )

    def test_hold_seconds_and_bpm_overrides_freeze_at_the_note(self):
        for spelling, expected in [
            ("[#0.75]", 750000),
            ("[180#4:3]", 1000000),
            ("[180#0.75]", 750000),
        ]:
            with self.subTest(spelling=spelling):
                raw, _ = parse("(120){4}1h" + spelling + ",(240)2,E")
                self.assertEqual(raw["holds"][0]["end_us"], expected)

    def test_unsupported_ambiguous_timing_combinations_reject_entire_body(self):
        for notation in [
            "1-3[4:1]^5[0.25##0.5]",
            "1-3[4:1]^5p7[4:1]",
            "1h[0:1]",
            "1h[4:-1]",
            "1h[0.25##0.5]",
            "1-5[0##0]",
        ]:
            with self.subTest(notation=notation):
                with self.assertRaises(SimaiSubsetError):
                    parse("(120){4}" + notation + ",E")

    def test_legacy_simple_syntax_keeps_fraction_times_and_nonbracket_paths(self):
        raw, _ = parse("(173.5){7}1,2,3h[8:3],4V26[4:1],5,E")
        step = Fraction(240, 1) / (Fraction("173.5") * 7)
        self.assertEqual(
            [n["time_us"] for n in raw["onsets"]], [round(i * step * 1000000) for i in range(5)]
        )
        self.assertEqual(
            raw["holds"][0]["end_us"],
            round((2 * step + Fraction(90, 1) / Fraction("173.5")) * 1000000),
        )
        self.assertEqual(raw["slides"][0]["path"], "simai:4V26")
        self.assertEqual(
            raw["slides"][0]["movement_start_us"],
            round((3 * step + Fraction(60, 1) / Fraction("173.5")) * 1000000),
        )
        self.assertEqual(
            raw["slides"][0]["movement_end_us"],
            round((3 * step + Fraction(120, 1) / Fraction("173.5")) * 1000000),
        )
        self.assertIsNone(raw["track_duration_us"])
        self.assertIsNone(raw["audio_offset_us"])


if __name__ == "__main__":
    unittest.main()
