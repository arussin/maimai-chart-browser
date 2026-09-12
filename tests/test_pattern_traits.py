"""Authored chart shapes and structural counterexamples for every new trait."""

import copy
import unittest
from fractions import Fraction

from maimai_analyzer.core import analyze, analyze_overview
from maimai_analyzer.fixtures import synthetic_charts
from maimai_analyzer.pattern_traits import DEFINITIONS
from tests.test_pattern_sequences import chart_for


def observed(raw, name):
    return next(t for t in analyze_overview(raw)["tags"] if t["pattern_id"] == "trait." + name)


def density(counts, *, breaks=()):
    raw = synthetic_charts()[0]
    raw["onsets"] = []
    raw["track_duration_us"] = len(counts) * 1000000
    for second, number in enumerate(counts):
        for offset in range(number):
            time = second * 1000000 + round(Fraction(offset * 1000000, number))
            beat = Fraction(time, 500000)
            i = len(raw["onsets"])
            raw["onsets"].append(
                {
                    "event_id": f"n-{i}",
                    "time_us": time,
                    "beat": [beat.numerator, beat.denominator],
                    "role": "tap",
                    "position": i % 8 + 1,
                    "break": second in breaks,
                }
            )
    return raw


class PatternTraitTests(unittest.TestCase):
    def test_density_shapes_have_positive_and_negative_examples(self):
        shapes = {
            "high_onset_density": ([2, 14, 14, 2], [2, 6, 6, 2]),
            "sustained_density": ([1, 10, 10, 10, 10, 1], [1, 10, 10, 1, 10, 1]),
            "isolated_density_spike": ([2, 2, 12, 2, 2], [2, 12, 2, 12, 2]),
            "multi_peak_density": ([2, 12, 2, 12, 2], [2, 2, 12, 2, 2]),
            "low_onset_gaps": ([4, 0, 0, 4], [4, 0, 4, 4]),
        }
        for name, (positive, negative) in shapes.items():
            with self.subTest(trait=name):
                self.assertEqual(observed(density(positive), name)["status"], "detected")
                self.assertEqual(observed(density(negative), name)["occurrence_count"], 0)
        self.assertEqual(
            set(DEFINITIONS),
            {
                "trait." + name
                for name in [
                    *shapes,
                    "break_concentration",
                    "rhythm_variability",
                    "repeated_motif",
                    "isolated_pattern_sections",
                ]
            },
        )

    def test_dense_single_chord_is_not_sustained_or_high_input_rate(self):
        raw = density([0, 16, 0, 0, 0])
        for event in raw["onsets"]:
            event.update(time_us=1000000, beat=[2, 1], group_id="one-chord")
        self.assertEqual(observed(raw, "high_onset_density")["occurrence_count"], 0)
        self.assertEqual(observed(raw, "sustained_density")["occurrence_count"], 0)

    def test_break_concentration_requires_local_enrichment(self):
        positive = density([4] * 12, breaks=(4, 5))
        self.assertEqual(observed(positive, "break_concentration")["status"], "detected")
        uniform = density([4] * 12, breaks=range(12))
        self.assertEqual(observed(uniform, "break_concentration")["occurrence_count"], 0)
        positive["capabilities"].remove("note_flags")
        self.assertEqual(observed(positive, "break_concentration")["status"], "unknown")

    def test_rhythm_variation_uses_beats_and_requires_a_recurrent_run(self):
        positive = chart_for("{16}" + "1,2,,," * 8)
        self.assertEqual(observed(positive, "rhythm_variability")["status"], "detected")
        constant = chart_for("{8}1,2,3,4,5,6,(240)1,2,3,4,5,6,7,8,")
        self.assertEqual(observed(constant, "rhythm_variability")["occurrence_count"], 0)
        short = chart_for("{16}1,2,,,1,2,,,")
        self.assertEqual(observed(short, "rhythm_variability")["occurrence_count"], 0)

    def test_repeated_motifs_require_two_disjoint_matching_phrases(self):
        phrase = "1,2,3,4,5,6,7,8,"
        positive = chart_for("{8}" + phrase * 2)
        self.assertEqual(observed(positive, "repeated_motif")["occurrence_count"], 2)
        self.assertEqual(
            observed(chart_for("{8}" + phrase), "repeated_motif")["occurrence_count"], 0
        )
        # One shared style or a uniform repeated-button stream is not a phrase match.
        self.assertEqual(
            observed(chart_for("{8}" + "1," * 20), "repeated_motif")["occurrence_count"], 0
        )
        different = chart_for("{8}" + phrase + "1,2,3,4,5,6,8,7,")
        self.assertEqual(observed(different, "repeated_motif")["occurrence_count"], 0)

    def test_repeated_phrase_signature_preserves_holds_and_flags(self):
        phrase = "1,2,3,4,5,6,7,8,"
        raw = chart_for("{8}" + phrase * 2)
        raw["onsets"][8]["break"] = True
        self.assertEqual(observed(raw, "repeated_motif")["occurrence_count"], 0)
        raw["onsets"][8]["break"] = False
        for i, length in ((0, 250000), (8, 500000)):
            e = raw["onsets"][i]
            e["role"] = "hold_onset"
            raw["holds"].append(
                {"hold_id": f"h-{i}", "onset_id": e["event_id"], "end_us": e["time_us"] + length}
            )
        self.assertEqual(observed(raw, "repeated_motif")["occurrence_count"], 0)

    def test_isolation_retains_its_target_and_rejects_unrelated_slide_motion(self):
        raw = chart_for("{8}1,2,1,2,1,2,1,2,")
        profile = analyze(raw)
        isolated = [
            o
            for o in profile["occurrences"]
            if o["pattern_id"] == "trait.isolated_pattern_sections"
        ]
        self.assertTrue(isolated)
        self.assertIn(
            "pattern.two_position_alternation",
            {o["measurements"]["target_pattern_id"] for o in isolated},
        )
        busy = copy.deepcopy(raw)
        busy["slides"].append(
            {
                "path_id": "unrelated",
                "head_id": None,
                "wait_start_us": 0,
                "wait_end_us": 0,
                "movement_start_us": 0,
                "movement_end_us": 2000000,
            }
        )
        targets = {
            o["measurements"]["target_pattern_id"]
            for o in analyze(busy)["occurrences"]
            if o["pattern_id"] == "trait.isolated_pattern_sections"
        }
        # The slide/tap interaction may itself be isolated; the trill is not.
        self.assertNotIn("pattern.two_position_alternation", targets)

    def test_repeated_phrases_need_known_paths_flags_and_interval_clock(self):
        raw = chart_for("{8}" + "1-5[8:1],2,3,4,5,6,7,8," * 2)
        self.assertEqual(observed(raw, "repeated_motif")["occurrence_count"], 2)
        for field in ("path", "clock", "flags"):
            changed = copy.deepcopy(raw)
            if field == "path":
                changed["slides"][0]["path"] = None
            elif field == "clock":
                changed["bpm_segments"] = []
            else:
                changed["capabilities"].remove("note_flags")
            self.assertEqual(observed(changed, "repeated_motif")["status"], "unknown")

    def test_unknown_gaps_block_background_comparisons(self):
        raw = density([2, 2, 12, 2, 2])
        raw["known_intervals"] = [[1000000, 5000000]]
        self.assertEqual(observed(raw, "isolated_density_spike")["status"], "unknown")
        raw = density([1, 10, 10, 10, 10, 1])
        raw["known_intervals"] = [[0, 2000000], [3000000, 6000000]]
        self.assertEqual(observed(raw, "sustained_density")["status"], "unknown")

    def test_observed_span_traits_do_not_require_fabricated_audio_duration(self):
        raw = density([4] * 8)
        raw["track_duration_us"] = None
        raw["capabilities"].remove("span")
        self.assertEqual(observed(raw, "steady_density")["status"], "detected")
        profile = analyze(raw)
        self.assertEqual(profile["flow"]["basis"], "chart_span")
        self.assertTrue(
            all(
                o["measurements"].get("span_basis") == "chart_span"
                for o in profile["occurrences"]
                if o["pattern_id"] == "trait.steady_density"
            )
        )


if __name__ == "__main__":
    unittest.main()
