"""Authored explicit zero-hold dialect; no rounding or tap conversion."""

import unittest

from maimai_analyzer import analyze
from maimai_analyzer.simai_subset import SimaiSubsetError
from tests.test_simai_expanded import parse


class SimaiZeroHoldTests(unittest.TestCase):
    def test_zero_hold_keeps_input_role_and_contributes_no_occupied_time(self):
        raw, audit = parse("(120){4}1h[4:0]/2,3,E")
        self.assertEqual(raw["onsets"][0]["role"], "hold_onset")
        self.assertEqual(raw["holds"][0]["end_us"], raw["onsets"][0]["time_us"])
        self.assertEqual(audit["tokens"][0]["duration_seconds"], [0, 1])
        self.assertIn("zero_duration_hold", audit["tokens"][0]["dialect_aliases"])
        profile = analyze(raw)
        self.assertEqual(profile["metrics"]["onset_count"], 3)
        self.assertEqual(profile["metrics"]["hold_occupancy"], 0)
        tag = next(t for t in profile["tags"] if t["pattern_id"] == "pattern.hold_tap_interleave")
        self.assertEqual(tag["occurrence_count"], 0)

    def test_touch_zero_hold_preserves_ex_firework_and_source_spelling(self):
        body = "(120){4}C1xhf[8:0],2,E"
        raw, audit = parse(body)
        self.assertEqual(raw["onsets"][0]["role"], "touch_hold")
        self.assertEqual(raw["onsets"][0]["position"], "C")
        self.assertTrue(raw["onsets"][0]["ex"])
        self.assertTrue(audit["tokens"][0]["firework"])
        self.assertEqual(audit["tokens"][0]["source_text"], "C1xhf[8:0]")
        self.assertEqual(raw["holds"][0]["end_us"], 0)
        self.assertEqual(analyze(raw)["metrics"]["hold_occupancy"], 0)

    def test_explicit_zero_seconds_and_override_hold_preserve_zero(self):
        for note in ("1h[#0]", "1h[90#0]", "1h[90#8:0]"):
            with self.subTest(note=note):
                raw, audit = parse("(120){4}" + note + ",2,E")
                self.assertEqual(raw["holds"][0]["end_us"], 0)
                self.assertFalse(audit["tokens"][0]["implicit_duration"])
                self.assertIn("zero_duration_hold", audit["tokens"][0]["dialect_aliases"])

    def test_bare_holds_keep_the_existing_positive_documented_duration(self):
        raw, audit = parse("(120){4}1h,2,E")
        self.assertEqual(raw["holds"][0]["end_us"], 1562)
        self.assertTrue(audit["tokens"][0]["implicit_duration"])
        self.assertNotIn("zero_duration_hold", audit["tokens"][0]["dialect_aliases"])

    def test_zero_dialect_does_not_allow_bad_divisors_tempo_or_slides(self):
        for note in (
            "1h[0:0]",
            "1h[0:1]",
            "1h[0#8:0]",
            "1h[4:-1]",
            "1-5[4:0]",
            "1-5[#0]",
            "1-3[4:0]^5[4:1]",
            "1h[#0.00000001]",
        ):
            with self.subTest(note=note), self.assertRaises(SimaiSubsetError):
                parse("(120){4}" + note + ",E")


if __name__ == "__main__":
    unittest.main()
