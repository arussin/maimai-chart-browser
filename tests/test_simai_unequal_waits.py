"""Authored independent branch timing controls for the 0.3.3 extension."""

import unittest

from tests.test_simai_subset import parse

from maimai_analyzer.contracts import normalize_chart


class UnequalWaitTests(unittest.TestCase):
    def test_each_branch_can_use_its_own_explicit_tempo(self):
        raw, _ = parse("(120){4}1-5[120#4:1]*^3[240#4:1],E")
        self.assertEqual(
            sorted((s["movement_start_us"], s["movement_end_us"]) for s in raw["slides"]),
            [(250000, 500000), (500000, 1000000)],
        )

    def test_shared_head_preserves_independent_starts_and_ends(self):
        raw, audit = parse("(120){4}2-5[0.25##0.5]*-7[0.75##1],E")
        self.assertEqual(len(raw["onsets"]), 1)
        self.assertEqual(
            [(s["movement_start_us"], s["movement_end_us"]) for s in raw["slides"]],
            [(250000, 750000), (750000, 1750000)],
        )
        self.assertEqual(len({s["head_id"] for s in raw["slides"]}), 1)
        self.assertEqual(len(audit["tokens"][0]["paths"]), 2)
        normalize_chart(raw)

    def test_headless_branches_and_bpm_change_do_not_stretch_movement(self):
        raw, _ = parse("(120){4}3?-6[0##0.75]*-8[1##0.5],(240)1,E")
        self.assertEqual(len(raw["onsets"]), 1)
        self.assertTrue(all(s["head_id"] is None for s in raw["slides"]))
        self.assertEqual(
            [(s["movement_start_us"], s["movement_end_us"]) for s in raw["slides"]],
            [(0, 750000), (1000000, 1500000)],
        )

    def test_equal_waits_still_share_one_head(self):
        raw, _ = parse("(120){4}4-1[4:1]*-7[8:1],E")
        self.assertEqual(len(raw["onsets"]), 1)
        self.assertEqual([s["movement_start_us"] for s in raw["slides"]], [500000, 500000])


if __name__ == "__main__":
    unittest.main()
