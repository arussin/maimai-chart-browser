"""Independently authored note-token grammar tests; no copied chart bodies."""

import unittest
from itertools import permutations

from maimai_analyzer.simai_notation import NoteSyntaxError, parse_note


class SimaiNotationTests(unittest.TestCase):
    def test_tap_break_ex_combinations_and_free_modifier_order(self):
        for flags in ("", "b", "x", "bx", "xb"):
            with self.subTest(flags=flags):
                note = parse_note("3" + flags)
                self.assertEqual(note["position"], 3)
                self.assertEqual(note["role"], "tap")
                self.assertEqual(note["break"], "b" in flags)
                self.assertEqual(note["ex"], "x" in flags)
                self.assertEqual(note["branches"], [])
                self.assertIsNone(note["hold_duration"])

    def test_hold_modifier_permutations_and_implicit_duration(self):
        for flags in map("".join, permutations("hbx")):
            with self.subTest(flags=flags):
                note = parse_note("2" + flags + "[8:3]")
                self.assertEqual(note["role"], "hold_onset")
                self.assertTrue(note["break"] and note["ex"])
                self.assertEqual(note["hold_duration"], "[8:3]")
                self.assertFalse(note["implicit_duration"])
        bare = parse_note("2xh")
        explicit = parse_note("2xh[1280:1]")
        self.assertTrue(bare["implicit_duration"])
        self.assertFalse(explicit["implicit_duration"])
        self.assertEqual(bare["hold_duration"], explicit["hold_duration"])

    def test_touch_zones_center_aliases_and_noncenter_touch_holds(self):
        for zone in ["C", "C1", "C2"]:
            self.assertEqual(parse_note(zone)["position"], "C")
        for region in "ABDE":
            for digit in "12345678":
                note = parse_note(region + digit)
                self.assertEqual(note["position"], region + digit)
                self.assertEqual(note["role"], "touch")
        for spelling in ["E1hf[4:3]", "E1fh[4:3]"]:
            note = parse_note(spelling)
            self.assertEqual(note["role"], "touch_hold")
            self.assertTrue(note["firework"])
            self.assertEqual(note["hold_duration"], "[4:3]")
        self.assertTrue(parse_note("Cf")["firework"])
        self.assertTrue(parse_note("C2fh")["implicit_duration"])

    def test_documented_shapes_preserve_endpoints_without_geometry(self):
        for shape in ("-", "^", "<", ">", "v", "p", "q", "s", "z", "pp", "qq", "w"):
            with self.subTest(shape=shape):
                note = parse_note("1" + shape + "5[4:1]")
                self.assertEqual(note["role"], "star_tap")
                branch = note["branches"][0]
                self.assertEqual(branch["duration_mode"], "per_segment")
                self.assertEqual(
                    branch["segments"],
                    [
                        {
                            "start": 1,
                            "shape": shape,
                            "end": 5,
                            "turn": None,
                            "duration": "[4:1]",
                        }
                    ],
                )
                self.assertNotIn("geometry", branch)
        self.assertEqual(
            parse_note("1V35[4:1]")["branches"][0]["segments"][0],
            {
                "start": 1,
                "shape": "V",
                "end": 5,
                "turn": 3,
                "duration": "[4:1]",
            },
        )

    def test_shared_branches_have_one_head_and_independent_paths(self):
        note = parse_note("2bx-6[4:1]*^4[8:3]b")
        self.assertEqual(note["position"], 2)
        self.assertEqual(note["role"], "star_tap")
        self.assertTrue(note["break"] and note["ex"])
        self.assertEqual(len(note["branches"]), 2)
        self.assertEqual([b["segments"][0]["start"] for b in note["branches"]], [2, 2])
        self.assertEqual([b["break"] for b in note["branches"]], [False, True])
        self.assertEqual(note["branches"][1]["path_notation"], "^4[8:3]b")

    def test_connected_total_duration_preserves_untimed_internal_segments(self):
        branch = parse_note("1-3^5p7[2:1]")["branches"][0]
        self.assertEqual(branch["duration_mode"], "global")
        self.assertEqual([s["start"] for s in branch["segments"]], [1, 3, 5])
        self.assertEqual([s["end"] for s in branch["segments"]], [3, 5, 7])
        self.assertEqual([s["duration"] for s in branch["segments"]], [None, None, "[2:1]"])
        self.assertFalse(any("start_us" in s or "end_us" in s for s in branch["segments"]))

    def test_every_connected_segment_can_have_explicit_duration(self):
        branch = parse_note("1-3[8:1]V57[4:1]b")["branches"][0]
        self.assertEqual(branch["duration_mode"], "per_segment")
        self.assertTrue(branch["break"])
        self.assertEqual([s["duration"] for s in branch["segments"]], ["[8:1]", "[4:1]"])
        self.assertEqual(branch["segments"][1]["turn"], 5)

    def test_head_and_track_break_are_independent(self):
        head = parse_note("1b-5[4:1]")
        track = parse_note("1-5[4:1]b")
        self.assertTrue(head["break"])
        self.assertFalse(head["branches"][0]["break"])
        self.assertFalse(track["break"])
        self.assertTrue(track["branches"][0]["break"])

    def test_presentation_changes_roles_without_inventing_heads(self):
        for spelling, presentation in [("1$", ["$"]), ("1$$", ["$", "$"]), ("1$b$x", ["$", "$"])]:
            note = parse_note(spelling)
            self.assertEqual(note["role"], "star_tap")
            self.assertEqual(note["presentation"], presentation)
            self.assertEqual(note["branches"], [])
        round_head = parse_note("1x@b-5[4:1]")
        self.assertEqual(round_head["role"], "tap")
        self.assertEqual(round_head["presentation"], ["@"])
        self.assertTrue(round_head["ex"] and round_head["break"])
        for flag in "?!":
            note = parse_note("1" + flag + "-5[4:1]")
            self.assertIsNone(note["role"])
            self.assertEqual(note["presentation"], [flag])
            self.assertEqual(len(note["branches"]), 1)

    def test_duration_spellings_remain_exact_for_separate_timing_converter(self):
        for duration in [
            "[4:1]",
            "[160#8:3]",
            "[120#0.75]",
            "[#0.75]",
            "[0.5##1]",
            "[0.5##8:3]",
            "[0.5##160#8:3]",
        ]:
            with self.subTest(duration=duration):
                note = parse_note("1-5" + duration)
                self.assertEqual(note["branches"][0]["segments"][0]["duration"], duration)

    def test_malformed_or_unverified_syntax_rejects_whole_token(self):
        bad = [
            "",
            None,
            "0",
            "9",
            "A",
            "A0",
            "B9",
            "C3",
            "F1",
            "1 2",
            "1/2",
            "12",
            "1xx",
            "1xxh",
            "1bbb",
            "1$$$",
            "1H[4:1]",
            "Cff",
            "Cxxh[4:1]",
            "1f",
            "1h-5[4:1]",
            "1h$[4:1]",
            "1@",
            "1?",
            "1?-5[4:1]b?",
            "1?b-5[4:1]",
            "1$-5[4:1]",
            "1-5xx[4:1]",
            "1-5[4:1]xx",
            "1-5[4:1]bb",
            "1-5[4:1]*1^3[4:1]",
            "1-5[4:1]*",
            "1*",
            "1-5",
            "1V5[4:1]",
            "1V95[4:1]",
            "1-5[]",
            "1-5[4:1",
            "1-5[4:z]",
            "1-3[4:1]^5p7[4:1]",
            "1-3[4:1]^5",
            "1-3^5[4:1]p7[4:1]",
        ]
        for token in bad:
            with self.subTest(token=token):
                with self.assertRaises(NoteSyntaxError):
                    parse_note(token)

    def test_resource_bounds_and_error_offset_are_local_to_whole_token(self):
        with self.assertRaises(NoteSyntaxError):
            parse_note("1" + "-3" * 129 + "[4:1]")
        with self.assertRaises(NoteSyntaxError):
            parse_note("1-3[4:1]" + "*^5[4:1]" * 128)
        with self.assertRaises(NoteSyntaxError):
            parse_note("1-3[" + "1" * 129 + "]")
        note_text = "1-3[4:1]*^9[4:1]"
        with self.assertRaises(NoteSyntaxError) as caught:
            parse_note(note_text)
        self.assertEqual(caught.exception.offset, note_text.index("9"))

    def test_attested_dialect_aliases_preserve_scope_and_literal_placement(self):
        note = parse_note("1b-3^5b[4:1]")
        self.assertTrue(note["break"])
        self.assertTrue(note["branches"][0]["break"])
        self.assertEqual(note["branches"][0]["path_notation"], "-3^5b[4:1]")
        self.assertEqual(note["dialect_aliases"], ["track_break_before_duration"])
        self.assertTrue(parse_note("1h[4:1]x")["ex"])
        self.assertEqual(parse_note("1h[4:1]x")["dialect_aliases"], ["hold_ex_after_duration"])
        self.assertTrue(parse_note("E1h[4:1]f")["firework"])
        self.assertEqual(
            parse_note("Ch[4:1]f")["dialect_aliases"], ["touch_firework_after_duration"]
        )
        for spelling in ["1-3b[4:1]^5[4:1]", "1-5b[4:1]b", "1xh[4:1]x", "Chf[4:1]f"]:
            with self.subTest(spelling=spelling):
                with self.assertRaises(NoteSyntaxError):
                    parse_note(spelling)


if __name__ == "__main__":
    unittest.main()
