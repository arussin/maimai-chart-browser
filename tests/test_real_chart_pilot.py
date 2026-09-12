"""Pilot boundaries use only independently authored tiny notation and metadata."""

from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from copy import deepcopy
from pathlib import Path


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


class RealChartPilotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(__file__).resolve().parents[1] / "scripts" / "evaluate_simai_pilot.py"
        spec = importlib.util.spec_from_file_location("authored_real_chart_pilot_test", path)
        if spec is None or spec.loader is None:
            raise AssertionError("Could not load the local evaluation script")
        cls.pilot = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.pilot)

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.source = self.root / "sources"
        self.source.mkdir()
        self.output = self.root / "evaluation"
        self.manifest_path = self.source / "manifest.json"
        self.rubric_path = self.source / "master-first-chorus-rubric.json"
        self.bodies = {
            "EXPERT": b"(120){4}1,2h[4:1],3b,E",
            "MASTER": b"(120){4}1-5[4:1]/3,2b,4,E",
        }
        self.counts = {
            "EXPERT": {"tap": 1, "hold": 1, "slide": 0, "break": 1},
            "MASTER": {"tap": 3, "hold": 0, "slide": 1, "break": 1},
        }
        captured = b"Authored capture sentinel; no public chart was copied."
        (self.source / "capture.txt").write_bytes(captured)
        self.manifest = {
            "title": "Authored pair <script>fixture-only</script>",
            "source_kind": "public_transcription_evaluation",
            "raw_file": "capture.txt",
            "raw_sha256": digest(captured),
            "charts": [],
        }
        for difficulty, body in self.bodies.items():
            filename = difficulty.lower() + ".txt"
            (self.source / filename).write_bytes(body)
            self.manifest["charts"].append(
                {
                    "difficulty": difficulty,
                    "file": filename,
                    "sha256": digest(body),
                    "url": "https://example.invalid/authored-fixture/" + filename,
                    "independent_metadata_counts": self.counts[difficulty],
                }
            )
        self.rubric = {
            "source_sha256": digest(self.bodies["MASTER"]),
            "first_chorus_onsets": [
                {
                    "time_s": 0,
                    "onsets": [
                        {"position": 1, "role": "star_tap"},
                        {"position": 3, "role": "tap"},
                    ],
                },
                {"time_s": 0.5, "onsets": [{"position": 2, "role": "tap"}]},
            ],
            "first_chorus_slides": [
                {
                    "head_position": 1,
                    "end_position": 5,
                    "shape": "-",
                    "head_s": 0.0,
                    "movement_start_s": 0.5,
                    "movement_end_s": 1.0,
                }
            ],
        }
        self.write_inputs()

    def write_inputs(self):
        self.manifest_path.write_text(json.dumps(self.manifest), encoding="utf-8")
        self.rubric_path.write_text(json.dumps(self.rubric), encoding="utf-8")

    def run_pilot(self):
        stdout = io.StringIO()
        with redirect_stdout(stdout):
            result = self.pilot.main([str(self.manifest_path), "--output-dir", str(self.output)])
        return result, json.loads(stdout.getvalue())

    def assert_rejected_without_output(self, message):
        before = {path.name: path.read_bytes() for path in self.source.iterdir()}
        with self.assertRaisesRegex(ValueError, message):
            self.run_pilot()
        self.assertFalse(self.output.exists())
        self.assertEqual(before, {path.name: path.read_bytes() for path in self.source.iterdir()})

    def test_captured_source_hash_mismatch_writes_nothing(self):
        self.manifest["raw_sha256"] = "0" * 64
        self.write_inputs()
        self.assert_rejected_without_output("Captured source hash mismatch")

    def test_natural_body_end_does_not_invent_an_end_marker_timestamp(self):
        body = self.bodies["EXPERT"][:-1]
        (self.source / "expert.txt").write_bytes(body)
        self.manifest["charts"][0]["sha256"] = digest(body)
        self.write_inputs()
        status, _ = self.run_pilot()
        self.assertEqual(status, 0)
        result = json.loads((self.output / "results.json").read_text(encoding="utf-8"))
        expert = next(chart for chart in result["charts"] if chart["difficulty"] == "EXPERT")
        self.assertIsNone(expert["end_marker_seconds"])
        self.assertTrue(expert["counts_match"])
        self.assertEqual(expert["parsed_counts"], self.counts["EXPERT"])

    def test_second_transcription_hash_mismatch_cannot_leave_first_chart_outputs(self):
        self.manifest["charts"][1]["sha256"] = "0" * 64
        self.write_inputs()
        self.assert_rejected_without_output("Transcription hash mismatch")

    def test_rubric_from_another_revision_writes_nothing(self):
        self.rubric["source_sha256"] = "0" * 64
        self.write_inputs()
        self.assert_rejected_without_output("rubric belongs to a different source revision")

    def test_source_directory_traversal_and_absolute_paths_are_rejected(self):
        outside = self.root / "outside.txt"
        outside.write_bytes(self.bodies["MASTER"])
        for escaped in ("../outside.txt", str(outside.resolve())):
            with self.subTest(path=escaped):
                self.manifest["charts"][1]["file"] = escaped
                self.write_inputs()
                self.assert_rejected_without_output("named files beside the manifest")
        self.assertEqual(outside.read_bytes(), self.bodies["MASTER"])

    def test_raw_capture_traversal_is_rejected_before_analysis(self):
        self.manifest["raw_file"] = "../capture.txt"
        self.write_inputs()
        self.assert_rejected_without_output("named files beside the manifest")

    def test_paired_authored_fixture_renders_measured_results_and_repeats_exactly(self):
        status, summary = self.run_pilot()
        self.assertEqual(status, 0)
        self.assertEqual(summary["section_checks_passed"], 2)
        result = json.loads((self.output / "results.json").read_text(encoding="utf-8"))
        self.assertEqual([chart["difficulty"] for chart in result["charts"]], ["EXPERT", "MASTER"])
        for chart in result["charts"]:
            self.assertEqual(chart["parsed_counts"], self.counts[chart["difficulty"]])
            self.assertTrue(chart["counts_match"])
            self.assertEqual(chart["coverage"]["analysis"], "partial")
            self.assertIn("redistribution permission", " ".join(chart["limitations"]))
        self.assertEqual([check["pass"] for check in result["section_checks"]], [True, True])
        self.assertEqual([check["pass"] for check in result["section_slide_checks"]], [True])
        report = (self.output / "index.html").read_text(encoding="utf-8")
        self.assertIn("&lt;script&gt;fixture-only&lt;/script&gt;", report)
        self.assertNotIn("<script>fixture-only</script>", report)
        self.assertIn("fidelity remains unverified", report)
        for body in self.bodies.values():
            self.assertNotIn(body.decode(), report)
        self.assertNotIn("Authored capture sentinel", report)
        first = {path.name: path.read_bytes() for path in self.output.iterdir()}
        self.assertEqual(len(first), 8)
        self.run_pilot()
        self.assertEqual(first, {path.name: path.read_bytes() for path in self.output.iterdir()})

    def test_note_count_disagreement_remains_an_explicit_result(self):
        self.manifest["charts"][1]["independent_metadata_counts"] = {
            "tap": 99,
            "hold": 0,
            "slide": 1,
            "break": 1,
        }
        self.write_inputs()
        status, summary = self.run_pilot()
        self.assertEqual(status, 1)
        self.assertFalse(summary["charts"][1]["counts_match"])
        result = json.loads((self.output / "results.json").read_text(encoding="utf-8"))
        master = result["charts"][1]
        self.assertEqual(master["parsed_counts"], self.counts["MASTER"])
        self.assertEqual(master["reference_counts"]["tap"], 99)
        self.assertFalse(master["counts_match"])
        self.assertIn(
            '<span class="status mismatch">Mismatch</span>',
            (self.output / "index.html").read_text(encoding="utf-8"),
        )

    def test_slide_rubric_reads_both_path_timing_and_source_shape_audit(self):
        self.run_pilot()
        raw = json.loads((self.output / "master.normalized.json").read_text(encoding="utf-8"))
        audit = json.loads((self.output / "master.parse-audit.json").read_text(encoding="utf-8"))
        check = self.pilot.check_slide_rubric
        self.assertTrue(check(raw, audit, self.rubric)[0]["pass"])
        changed_path = deepcopy(raw)
        changed_path["slides"][0]["movement_end_us"] += 250_000
        self.assertFalse(check(changed_path, audit, self.rubric)[0]["pass"])
        changed_audit = deepcopy(audit)
        next(token for token in changed_audit["tokens"] if "path_id" in token)["path_shape"] = "^"
        self.assertFalse(check(raw, changed_audit, self.rubric)[0]["pass"])

    def test_section_disagreement_fails_check_without_discarding_measurements(self):
        self.rubric["first_chorus_slides"][0]["end_position"] = 8
        self.write_inputs()
        status, summary = self.run_pilot()
        self.assertEqual(status, 1)
        self.assertTrue(all(chart["counts_match"] for chart in summary["charts"]))
        result = json.loads((self.output / "results.json").read_text(encoding="utf-8"))
        self.assertFalse(result["section_slide_checks"][0]["pass"])
        self.assertEqual(result["charts"][1]["parsed_counts"], self.counts["MASTER"])

    def test_break_holds_are_counted_once_in_the_break_bucket(self):
        body = b"(120){4}1hb[4:1],2h[4:1],3b,4-8[4:1],E"
        (self.source / "expert.txt").write_bytes(body)
        expected = {"tap": 1, "hold": 1, "slide": 1, "break": 2}
        self.manifest["charts"][0].update(
            sha256=digest(body),
            independent_metadata_counts=expected,
            reference_count_convention=self.pilot.COUNT_CONVENTION,
        )
        self.write_inputs()
        status, summary = self.run_pilot()
        self.assertEqual(status, 0)
        self.assertEqual(summary["charts"][0]["counts"], expected)
        self.assertTrue(summary["charts"][0]["counts_match"])

    def test_touch_without_reference_category_is_unknown_instead_of_false_agreement(self):
        body = b"(120){4}Cf,E"
        (self.source / "expert.txt").write_bytes(body)
        self.manifest["charts"][0].update(
            sha256=digest(body),
            independent_metadata_counts={"tap": 0, "hold": 0, "slide": 0, "break": 0},
        )
        self.write_inputs()
        status, summary = self.run_pilot()
        self.assertEqual(status, 1)
        self.assertIsNone(summary["charts"][0]["counts_match"])
        document = (self.output / "index.html").read_text(encoding="utf-8")
        self.assertIn('<span class="status unknown">Unknown</span>', document)
        self.assertIn("Reference table does not declare a separate TOUCH count", document)


if __name__ == "__main__":
    unittest.main()
