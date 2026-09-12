"""Authored source-boundary compatibility cases with no inferred track span."""

import hashlib
import unittest

from maimai_analyzer import analyze
from maimai_analyzer.simai_subset import SimaiSubsetError
from tests.test_simai_expanded import parse


class SimaiFramingTests(unittest.TestCase):
    def test_missing_E_consumes_complete_slots_without_inventing_a_marker(self):
        body = "(120){4}1,2h[1:1],"
        raw, audit = parse(body)
        canonical, _ = parse(body + "E")
        for key in ("onsets", "holds", "slides", "bpm_segments"):
            self.assertEqual(raw[key], canonical[key])
        self.assertIsNone(audit["end_marker"])
        self.assertEqual(
            audit["framing"],
            {
                "termination": "eof_after_comma",
                "final_slot_comma": True,
                "source_completeness": "unknown",
            },
        )
        self.assertIn("terminal_E_omitted", audit["dialect_aliases"])
        self.assertIsNone(raw["track_duration_us"])
        self.assertNotIn("span", raw["capabilities"])
        self.assertEqual(audit["body_sha256"], hashlib.sha256(body.encode()).hexdigest())
        self.assertEqual(analyze(raw)["metrics"], analyze(canonical)["metrics"])

    def test_E_closes_last_note_at_current_clock_without_synthetic_comma(self):
        raw, audit = parse("(120){4}1,2h[1:1]E")
        self.assertEqual([n["time_us"] for n in raw["onsets"]], [0, 500000])
        self.assertEqual(raw["holds"][0]["end_us"], 2500000)
        self.assertEqual(audit["end_marker"]["time_us"], 500000)
        self.assertEqual(audit["end_marker"]["source_text"], "E")
        self.assertEqual(audit["counts"]["comma_slots"], 1)
        self.assertFalse(audit["framing"]["final_slot_comma"])
        self.assertIn("terminal_E_without_comma", audit["dialect_aliases"])
        self.assertIsNone(raw["track_duration_us"])

    def test_single_trailing_comma_is_audited_without_advancing_clock(self):
        raw, audit = parse("(120){4}1,E,")
        self.assertEqual(len(raw["onsets"]), 1)
        self.assertEqual(audit["end_marker"]["time_us"], 500000)
        self.assertEqual(audit["framing"]["trailing_delimiter"]["source_text"], ",")
        self.assertIn("comma_after_terminal_E", audit["dialect_aliases"])

    def test_attached_E_and_trailing_delimiter_compose_without_dropping_last_note(self):
        raw, audit = parse("(120){4}1,2E,")
        self.assertEqual([n["position"] for n in raw["onsets"]], [1, 2])
        self.assertEqual(audit["end_marker"]["time_us"], 500000)
        self.assertEqual(audit["counts"]["comma_slots"], 1)
        self.assertEqual(
            audit["dialect_aliases"],
            [
                "terminal_E_without_comma",
                "comma_after_terminal_E",
            ],
        )
        self.assertFalse(audit["framing"]["final_slot_comma"])

    def test_no_note_slots_have_no_final_slot_comma_status(self):
        raw, audit = parse("(120){4}E")
        self.assertEqual(raw["onsets"], [])
        self.assertIsNone(audit["framing"]["final_slot_comma"])

    def test_terminal_marker_is_distinct_from_E_touch_inputs(self):
        for body in ("(120){4}E1,E8,", "(120){4}E1,E8E"):
            with self.subTest(body=body):
                raw, _ = parse(body)
                self.assertEqual([n["position"] for n in raw["onsets"]], ["E1", "E8"])

    def test_ideographic_space_retains_exact_source_offsets_and_body_hash(self):
        body = "(120)\u3000{4}\u30001\u3000/2,\u3000E"
        raw, audit = parse(body)
        self.assertEqual([n["position"] for n in raw["onsets"]], [1, 2])
        self.assertEqual(audit["body_sha256"], hashlib.sha256(body.encode()).hexdigest())
        self.assertIn("ideographic_space", audit["dialect_aliases"])
        for item in audit["commands"] + audit["tokens"] + [audit["end_marker"]]:
            self.assertEqual(body[item["source_start"] : item["source_end"]], item["source_text"])
        _, commented = parse("(120){4}1,|| \u3000 is just comment text\nE")
        self.assertNotIn("ideographic_space", commented["dialect_aliases"])

    def test_E_without_comma_preserves_pseudo_each_and_shared_slide_heads(self):
        raw, audit = parse("(120){4}1-5[4:1]*^3[8:1]`2E")
        self.assertEqual([n["time_us"] for n in raw["onsets"]], [0, 1000])
        self.assertEqual(len(raw["slides"]), 2)
        self.assertEqual(raw["slides"][0]["head_id"], raw["slides"][1]["head_id"])
        self.assertEqual(audit["end_marker"]["time_us"], 0)
        self.assertIsNone(raw["track_duration_us"])

    def test_boundary_aliases_never_repair_bad_notes_or_discard_trailing_text(self):
        for body in (
            "",
            "(120){4}1",
            "(120){4}1,(180)",
            "(120){4}1oops,",
            "(120){4}1//2E",
            "(120){4}1-5[E",
            "(120){4}1h[4:1]garbageE",
            "(120){4}1,E,2,",
            "(120){4}1,E,,",
            "(120){4}1,EE",
            "(120){4}1,E]",
            "(120){4}1,E author note",
            "(120){4}1\u200b,",
            "(120){4}1,|| unterminated comment",
            "(120){4}1,E9",
        ):
            with self.subTest(body=body), self.assertRaises(SimaiSubsetError):
                parse(body)


if __name__ == "__main__":
    unittest.main()
