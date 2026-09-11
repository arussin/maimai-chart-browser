"""Authored tests for sourced simulator aliases, not official chart fixtures."""

import unittest
from itertools import permutations

from maimai_analyzer import normalize_chart
from maimai_analyzer.simai_notation import NoteSyntaxError, parse_note
from maimai_analyzer.simai_subset import SimaiSubsetError, parse_simai_subset


def parse_body(body):
    return parse_simai_subset(
        body,
        chart_id="synthetic:compatibility:DX:MASTER",
        song_id="synthetic:compatibility",
        format="DX",
        difficulty="MASTER",
        revision="authored-r1",
        source={
            "source_id": "authored-compatibility",
            "revision": "authored-r1",
            "kind": "authored_synthetic",
            "identity_status": "exact",
        },
    )


def semantics(note):
    return {
        **{key: value for key, value in note.items() if key not in {"dialect_aliases", "branches"}},
        "branches": [
            {
                key: value
                for key, value in branch.items()
                if key not in {"dialect_aliases", "path_notation"}
            }
            for branch in note["branches"]
        ],
    }


class SimaiCompatibilityNoteTests(unittest.TestCase):
    def test_touch_ex_has_explicit_dialect_scope_in_every_zone(self):
        zones = ["C", "C1", "C2"] + [region + index for region in "ABDE" for index in "12345678"]
        for zone in zones:
            with self.subTest(zone=zone):
                note = parse_note(zone + "x")
                self.assertEqual(note["role"], "touch")
                self.assertEqual(note["position"], "C" if zone.startswith("C") else zone)
                self.assertTrue(note["ex"])
                self.assertFalse(note["break"] or note["firework"])
                self.assertEqual(note["branches"], [])
                self.assertEqual(note["dialect_aliases"], ["touch_ex"])

    def test_touch_hold_ex_modifiers_preserve_duration_and_firework(self):
        for flags in map("".join, permutations("hxf")):
            with self.subTest(flags=flags):
                note = parse_note("C1" + flags + "[8:3]")
                self.assertEqual(note["role"], "touch_hold")
                self.assertEqual(note["position"], "C")
                self.assertTrue(note["ex"] and note["firework"])
                self.assertEqual(note["hold_duration"], "[8:3]")
                self.assertFalse(note["implicit_duration"])
                self.assertEqual(note["dialect_aliases"], ["touch_hold_ex"])
        self.assertTrue(parse_note("D2xh")["implicit_duration"])
        self.assertEqual(parse_note("D2xh")["hold_duration"], "[1280:1]")

    def test_touch_hold_trailing_ex_is_separately_auditable(self):
        note = parse_note("E2hf[4:1]x")
        self.assertTrue(note["ex"] and note["firework"])
        self.assertEqual(note["dialect_aliases"], ["touch_hold_ex_after_duration", "touch_hold_ex"])
        self.assertEqual(semantics(note), semantics(parse_note("E2hfx[4:1]")))
        with_firework_suffix = parse_note("Chx[4:1]f")
        self.assertEqual(
            with_firework_suffix["dialect_aliases"],
            ["touch_firework_after_duration", "touch_hold_ex"],
        )

    def test_button_hold_trailing_break_retains_only_its_input_flag(self):
        for token, canonical in [("2h[4:1]b", "2bh[4:1]"), ("2xh[#0.5]b", "2bxh[#0.5]")]:
            with self.subTest(token=token):
                note = parse_note(token)
                self.assertEqual(semantics(note), semantics(parse_note(canonical)))
                self.assertEqual(note["dialect_aliases"], ["hold_break_after_duration"])
                self.assertEqual(note["branches"], [])

    def test_slide_ex_aliases_apply_to_head_and_preserve_literal_path(self):
        for shape in ("-", "^", "pp", "qq", "w", "V3"):
            for placement, alias in [
                ("x[4:1]", "slide_head_ex_before_duration"),
                ("[4:1]x", "slide_head_ex_after_duration"),
            ]:
                token = "1" + shape + "5" + placement
                with self.subTest(token=token):
                    note = parse_note(token)
                    self.assertEqual(
                        semantics(note), semantics(parse_note("1x" + shape + "5[4:1]"))
                    )
                    self.assertEqual(note["role"], "star_tap")
                    self.assertTrue(note["ex"])
                    self.assertFalse(note["branches"][0]["break"])
                    self.assertNotIn("ex", note["branches"][0])
                    self.assertNotIn("_head_ex", note["branches"][0])
                    self.assertEqual(note["branches"][0]["path_notation"], token[1:])
                    self.assertEqual(note["dialect_aliases"], [alias])

    def test_slide_ex_and_track_break_do_not_overwrite_each_other(self):
        forms = ["1-5x[4:1]b", "1-5[4:1]xb", "1-5b[4:1]x"]
        canonical = parse_note("1x-5[4:1]b")
        for token in forms:
            with self.subTest(token=token):
                note = parse_note(token)
                self.assertEqual(semantics(note), semantics(canonical))
                self.assertFalse(note["break"])
                self.assertTrue(note["ex"] and note["branches"][0]["break"])
        round_head = parse_note("1@-5[4:1]x")
        self.assertEqual(round_head["role"], "tap")
        self.assertTrue(round_head["ex"])

    def test_connected_and_shared_aliases_have_one_actual_head(self):
        for token, canonical in [
            ("1-3^5x[4:1]", "1x-3^5[4:1]"),
            ("1-3[8:1]^5[4:1]x", "1x-3[8:1]^5[4:1]"),
            ("1-5[4:1]x*^3[8:1]", "1x-5[4:1]*^3[8:1]"),
        ]:
            with self.subTest(token=token):
                self.assertEqual(semantics(parse_note(token)), semantics(parse_note(canonical)))

    def test_aliases_reject_duplicate_unscoped_and_unconsumed_modifiers(self):
        invalid = [
            "Cxx",
            "Cxh[4:1]x",
            "Ch[4:1]xx",
            "Cxb",
            "Ch[4:1]b",
            "Cxfh[4:1]f",
            "1bh[4:1]b",
            "1h[4:1]bb",
            "1h[4:1]bx",
            "1h[4:1]xb",
            "1h[4:1]b?",
            "1x-5[4:1]x",
            "1-5x[4:1]x",
            "1-5[4:1]xx",
            "1-5[4:1]bx",
            "1-5xb[4:1]",
            "1-5bx[4:1]",
            "1-3x[4:1]^5[4:1]",
            "1-3[4:1]x^5[4:1]",
            "1?-5[4:1]x",
            "1!-5x[4:1]",
            "1-5[4:1]*^3[4:1]x",
            "1-5[4:1]x*^3x[4:1]",
            "1-5x",
        ]
        for token in invalid:
            with self.subTest(token=token):
                with self.assertRaises(NoteSyntaxError):
                    parse_note(token)
        spelling = "1-5[4:1]*^3[4:1]x"
        with self.assertRaises(NoteSyntaxError) as caught:
            parse_note(spelling)
        self.assertEqual(caught.exception.offset, spelling.index("x"))

    def test_no_missing_hold_marker_or_invalid_structure_is_repaired(self):
        for token in ["1[4:1]", "C[4:1]", "1{8}", "1{8}2", "22x", "7x2", "1-5[4:1]*1^3[4:1]"]:
            with self.subTest(token=token):
                with self.assertRaises(NoteSyntaxError):
                    parse_note(token)
        for token in ["1h[0:1]b", "Cxh[0:1]", "1-5[1:0]x"]:
            with self.subTest(token=token):
                with self.assertRaises(SimaiSubsetError):
                    parse_body("(120){4}" + token + ",E")

    def test_normalized_events_and_source_audit_keep_alias_scope(self):
        raw, audit = parse_body("(120){4}B2x,Cxh[4:1],2h[4:1]b,3-7[4:1]x,E")
        normalized = normalize_chart(raw)
        self.assertEqual(
            [n["role"] for n in normalized["onsets"]],
            ["touch", "touch_hold", "hold_onset", "star_tap"],
        )
        self.assertEqual([n["ex"] for n in normalized["onsets"]], [True, True, False, True])
        self.assertEqual([n["break"] for n in normalized["onsets"]], [False, False, True, False])
        self.assertEqual(len(normalized["holds"]), 2)
        self.assertEqual(len(normalized["slides"]), 1)
        self.assertEqual(audit["tokens"][0]["dialect_aliases"], ["touch_ex"])
        self.assertEqual(audit["tokens"][1]["dialect_aliases"], ["touch_hold_ex"])
        self.assertEqual(audit["tokens"][2]["dialect_aliases"], ["hold_break_after_duration"])
        self.assertEqual(audit["tokens"][3]["dialect_aliases"], ["slide_head_ex_after_duration"])
        self.assertFalse(audit["tokens"][3]["paths"][0]["break"])


if __name__ == "__main__":
    unittest.main()
