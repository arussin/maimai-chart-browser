"""Authored metadata-count comparisons for expanded notation and missing evidence."""

import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path

from maimai_analyzer.simai_subset import parse_simai_subset
from scripts.build_real_chart_study import build_study, check_rubrics
from scripts.evaluate_simai_pilot import COUNT_CONVENTION, count_comparison, note_counts
from tests.test_real_chart_study import fixture


def parse(body):
    return parse_simai_subset(
        body,
        chart_id="synthetic:counts",
        song_id="synthetic:counts",
        format="DX",
        difficulty="MASTER",
        revision="authored",
        source={
            "source_id": "authored-counts",
            "revision": "authored",
            "kind": "authored_synthetic",
            "identity_status": "exact",
        },
    )


class SimaiCountingTests(unittest.TestCase):
    def test_legacy_four_categories_remain_identical_with_fresh_audit(self):
        raw, audit = parse("(120){4}1,2h[4:1],3-7[4:1],4b,E")
        expected = {"tap": 2, "hold": 1, "slide": 1, "break": 1}
        self.assertEqual(note_counts(raw, audit), expected)
        self.assertTrue(count_comparison(raw, expected, expected)["matches"])

    def test_ex_does_not_duplicate_categories_and_touchhold_counts_as_hold(self):
        raw, audit = parse("(120){4}1x/Cf/E1fh[4:1]/2xh[8:1],E")
        counts = note_counts(raw, audit)
        self.assertEqual(counts, {"tap": 1, "hold": 2, "slide": 0, "break": 0, "touch": 1})
        self.assertTrue(count_comparison(raw, counts, counts)["matches"])
        incomplete = {key: value for key, value in counts.items() if key != "touch"}
        comparison = count_comparison(raw, counts, incomplete)
        self.assertIsNone(comparison["matches"])
        self.assertIn("TOUCH", comparison["reason"])

    def test_break_hold_and_track_require_explicit_reference_count_convention(self):
        raw, audit = parse("(120){4}1bh[4:1]/2b-6[4:1]b/3-7b[4:1],E")
        counts = note_counts(raw, audit)
        self.assertEqual(counts, {"tap": 1, "hold": 0, "slide": 0, "break": 4})
        self.assertIsNone(count_comparison(raw, counts, counts)["matches"])
        self.assertTrue(count_comparison(raw, counts, counts, COUNT_CONVENTION)["matches"])
        wrong = counts | {"slide": 2, "break": 2}
        self.assertFalse(count_comparison(raw, counts, wrong, COUNT_CONVENTION)["matches"])

    def test_shared_connected_and_headless_paths_count_without_extra_inputs(self):
        raw, audit = parse("(120){4}1-5[4:1]*^3[8:1],2-4^6[4:1],3?-7[4:1],4@-8[4:1],5$$,E")
        self.assertEqual(note_counts(raw, audit), {"tap": 4, "hold": 0, "slide": 5, "break": 0})
        self.assertEqual(len(raw["onsets"]), 4)
        self.assertEqual(len(audit["tokens"][0]["paths"]), 2)

    def test_missing_duplicate_mismatched_or_flagless_path_audits_cannot_false_match(self):
        raw, audit = parse("(120){4}1-5[4:1]b,E")
        altered = []
        missing = deepcopy(audit)
        missing["tokens"][0]["paths"] = []
        duplicate = deepcopy(audit)
        duplicate["tokens"][0]["paths"] *= 2
        flagless = deepcopy(audit)
        flagless["tokens"][0]["paths"][0].pop("break")
        wrong_version = deepcopy(audit)
        wrong_version["parser_version"] = "other"
        altered.extend([None, missing, duplicate, flagless, wrong_version])
        for evidence in altered:
            with self.subTest(evidence=evidence is None):
                counts = note_counts(raw, evidence)
                self.assertIsNone(counts["slide"])
                self.assertIsNone(counts["break"])
                self.assertIsNone(
                    count_comparison(raw, counts, {"tap": 1, "hold": 0, "slide": 1, "break": 0})[
                        "matches"
                    ]
                )
        linked = deepcopy(raw)
        linked["source"]["byte_hash"] = "0" * 64
        self.assertIsNone(note_counts(linked, audit)["slide"])

    def test_absent_touch_can_compare_with_explicit_zero_touch_reference(self):
        raw, audit = parse("(120){4}1,E")
        counts = note_counts(raw, audit)
        self.assertTrue(count_comparison(raw, counts, counts | {"touch": 0})["matches"])
        self.assertFalse(count_comparison(raw, counts, counts | {"touch": 1})["matches"])

    def test_shared_path_rubric_cannot_pass_by_omitting_multibranch_audit(self):
        raw, audit = parse("(120){4}1-5[4:1]*^3[8:1],E")
        checks = check_rubrics(
            raw,
            audit,
            [
                {
                    "rubric_id": "authored-shared",
                    "label": "Complete authored window",
                    "source_scope": "same_transcription",
                    "window_start_s": 0,
                    "window_end_s": 0.5,
                    "expected_onsets": [
                        {"time_s": 0, "onsets": [{"position": 1, "role": "star_tap"}]}
                    ],
                    "expected_slides": [],
                }
            ],
        )
        self.assertTrue(checks[0]["onset_cardinality_matches"])
        self.assertFalse(checks[0]["slide_cardinality_matches"])
        self.assertFalse(checks[0]["pass"])

    def test_mixed_touch_and_button_rubric_mismatch_is_reported_without_sort_error(self):
        raw, audit = parse("(120){4}1/C,E")
        checks = check_rubrics(
            raw,
            audit,
            [
                {
                    "rubric_id": "authored-extra-touch",
                    "label": "Unexpected touch",
                    "source_scope": "same_transcription",
                    "window_start_s": 0,
                    "window_end_s": 0.5,
                    "expected_onsets": [{"time_s": 0, "onsets": [{"position": 1, "role": "tap"}]}],
                }
            ],
        )
        self.assertFalse(checks[0]["pass"])
        self.assertEqual(len(checks[0]["onset_checks"][0]["actual"]), 2)

    def test_study_output_withholds_incomplete_touch_metadata_and_explains_why(self):
        with tempfile.TemporaryDirectory() as directory:
            path, manifest = fixture(directory, ["(120){4}Cf,E"])
            chart = manifest["charts"][0]
            chart["expected_note_counts"] = {"tap": 0, "hold": 0, "slide": 0, "break": 0}
            chart["rubrics"] = []
            path.write_text(json.dumps(manifest), encoding="utf-8")
            output = Path(directory) / "results"
            result = build_study(path, output)
            self.assertIsNone(result["charts"][0]["counts_match"])
            self.assertEqual(result["charts"][0]["parsed_counts"]["touch"], 1)
            self.assertIn("separate TOUCH", (output / "index.html").read_text(encoding="utf-8"))
            chart["expected_note_counts"]["touch"] = 1
            path.write_text(json.dumps(manifest), encoding="utf-8")
            self.assertTrue(build_study(path, output)["charts"][0]["counts_match"])

    def test_reference_count_schema_rejects_invalid_or_unknown_conventions(self):
        raw, audit = parse("(120){4}1,E")
        counts = note_counts(raw, audit)
        for reference in [counts | {"touch": True}, counts | {"touch": -1}, counts | {"other": 0}]:
            with self.assertRaises(ValueError):
                count_comparison(raw, counts, reference)
        with self.assertRaises(ValueError):
            count_comparison(raw, counts, counts, {"unknown": "convention"})


if __name__ == "__main__":
    unittest.main()
