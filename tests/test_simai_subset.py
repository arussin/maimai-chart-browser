"""Independently authored tiny syntax cases, never copied public chart notation."""

import hashlib
import unittest
from copy import deepcopy
from fractions import Fraction

from maimai_analyzer.contracts import normalize_chart
from maimai_analyzer.core import analyze
from maimai_analyzer.simai_subset import PARSER_VERSION, SimaiSubsetError, parse_simai_subset


def parse(text, **overrides):
    arguments = {
        "chart_id": "synthetic:subset:STD:EXPERT:r1",
        "song_id": "synthetic:subset",
        "format": "STD",
        "difficulty": "EXPERT",
        "revision": "r1",
        "source": {
            "source_id": "authored-subset-test",
            "revision": "r1",
            "kind": "authored_synthetic",
            "identity_status": "exact",
        },
    }
    arguments.update(overrides)
    return parse_simai_subset(text, **arguments)


class SimaiSubsetTests(unittest.TestCase):
    def test_exact_timing_division_changes_and_source_offsets(self):
        body = " (174) {8}\n 1, 2, {3} 3, E \n"
        raw, audit = parse(body)
        self.assertEqual([n["beat"] for n in raw["onsets"]], [[0, 1], [1, 2], [1, 1]])
        self.assertEqual([n["time_us"] for n in raw["onsets"]], [0, 172414, 344828])
        self.assertEqual(audit["end_marker"]["beat"], [7, 3])
        self.assertEqual(audit["end_marker"]["seconds"], [70, 87])
        self.assertEqual(audit["body_sha256"], hashlib.sha256(body.encode()).hexdigest())
        for item in audit["tokens"] + audit["commands"] + [audit["end_marker"]]:
            self.assertEqual(body[item["source_start"] : item["source_end"]], item["source_text"])
        self.assertIsNone(raw["track_duration_us"])
        self.assertIsNone(raw["audio_offset_us"])
        self.assertNotIn("span", raw["capabilities"])

    def test_whitespace_and_chords_keep_authored_groups_and_break_flags(self):
        raw, _ = parse("(120){4}1 3,2b/4,5/6/7,E")
        self.assertEqual([n["position"] for n in raw["onsets"]], [1, 3, 2, 4, 5, 6, 7])
        self.assertEqual(raw["onsets"][0]["group_id"], raw["onsets"][1]["group_id"])
        self.assertNotEqual(raw["onsets"][1]["group_id"], raw["onsets"][2]["group_id"])
        self.assertEqual(
            [n["break"] for n in raw["onsets"]], [False, False, True, False, False, False, False]
        )

    def test_holds_and_slide_wait_are_separate_from_movement(self):
        raw, audit = parse("(120){4}1h[2:1]/3-7[8:3],4hb[4:1],5bh[4:2],E")
        self.assertEqual(len(raw["onsets"]), 4)
        self.assertEqual([h["end_us"] for h in raw["holds"]], [1000000, 1000000, 2000000])
        slide = raw["slides"][0]
        self.assertEqual(slide["head_id"], raw["onsets"][1]["event_id"])
        self.assertEqual(slide["wait_start_us"], 0)
        self.assertEqual(slide["wait_end_us"], 500000)
        self.assertEqual(slide["movement_start_us"], 500000)
        self.assertEqual(slide["movement_end_us"], 1250000)
        self.assertEqual(slide["path"], "simai:3-7")
        self.assertEqual(slide["segment_ids"], [])
        self.assertFalse(audit["path_geometry_validated"])
        profile = analyze(raw)
        self.assertEqual(profile["metrics"]["onset_count"], 4)

    def test_supported_shape_notation_preserved_without_geometry_claim(self):
        for notation, shape, end, turn in [
            ("1-4", "-", 4, None),
            ("1^3", "^", 3, None),
            ("1<5", "<", 5, None),
            ("1>5", ">", 5, None),
            ("1p6", "p", 6, None),
            ("1q4", "q", 4, None),
            ("1z5", "z", 5, None),
            ("1s5", "s", 5, None),
            ("1V35", "V", 5, 3),
        ]:
            with self.subTest(notation=notation):
                raw, audit = parse(f"(150){{4}}{notation}[4:1],E")
                self.assertEqual(raw["slides"][0]["path"], "simai:" + notation)
                token = audit["tokens"][0]
                self.assertEqual(
                    (token["path_shape"], token["end_position"], token["turning_position"]),
                    (shape, end, turn),
                )
                self.assertIsNone(raw["geometry_version"])

    def test_fraction_clock_does_not_accumulate_rounding_error(self):
        raw, audit = parse("(173.5){7}" + "1," * 1000 + "E")
        expected = Fraction(999 * 4, 7) * 60 / Fraction("173.5")
        self.assertEqual(raw["onsets"][-1]["time_us"], round(expected * 1000000))
        self.assertEqual(audit["end_marker"]["beat"], [4000, 7])
        normalize_chart(raw)

    def test_end_marker_does_not_invent_track_duration_or_cut_off_active_path(self):
        raw, audit = parse("(120){4},1-5[1:2],E")
        self.assertEqual(raw["onsets"][0]["time_us"], 500000)
        self.assertEqual(audit["end_marker"]["time_us"], 1000000)
        self.assertEqual(raw["slides"][0]["movement_end_us"], 5000000)
        self.assertIsNone(raw["track_duration_us"])
        self.assertEqual(normalize_chart(raw)["span_end_us"], 5000000)

    def test_unsupported_and_malformed_syntax_fails_closed(self):
        bad = [
            "1h[0:1]",
            "1h[4:-1]",
            "1xx",
            "C3",
            "Z9",
            "1-5[4:1]*[4:1]",
            "1-4[4:1]q7p2[4:1]",
            "1h[1##2]",
            "1-5[##2]",
            "1garbage",
            "9",
            "11",
            "1/1",
            "1-5[4:1]/1-7[4:1]",
            "1/",
            "/1",
            "12b",
            "1||comment",
        ]
        for token in bad:
            with (
                self.subTest(token=token),
                self.assertRaisesRegex(SimaiSubsetError, "source character"),
            ):
                parse(f"(120){{4}}{token},E")
        for body in [
            "",
            "1,E",
            "{4}(120)1,E",
            "(0){4}1,E",
            "(120){0}1,E",
            "(120){4}1",
            "(120){4}1E2",
            "(120){4}1,E,2,",
            "(120){#0}1,E",
            "(120){4}1,||comment E",
        ]:
            with self.subTest(body=body), self.assertRaises(SimaiSubsetError):
                parse(body)

    def test_source_is_explicit_preserved_and_not_mutated(self):
        source = {
            "source_id": "reviewed-public-document",
            "revision": "retrieval-r1",
            "kind": "public_transcription_evaluation",
            "identity_status": "reviewed",
            "byte_hash": "a" * 64,
        }
        before = deepcopy(source)
        raw, _ = parse("(120){4}1,E", source=source)
        self.assertEqual(source, before)
        self.assertEqual(raw["source"]["byte_hash"], "a" * 64)
        self.assertEqual(raw["source"]["kind"], "public_transcription_evaluation")
        self.assertEqual(raw["source"]["parser_version"], PARSER_VERSION)
        with self.assertRaises(ValueError):
            parse("(120){4}1,E", source={**source, "byte_hash": "invalid"})

    def test_resource_and_time_resolution_limits_reject_instead_of_losing_events(self):
        for body in [
            "(1000){999999}1,E",
            "(1000){4}1h[999999:1],E",
            "(0.000001){4}1,E",
            "(2001){4}1,E",
        ]:
            with self.subTest(body=body), self.assertRaises(SimaiSubsetError):
                parse(body)
        with self.assertRaisesRegex(SimaiSubsetError, "one-MiB"):
            parse(" " * (1024 * 1024 + 1))


if __name__ == "__main__":
    unittest.main()
