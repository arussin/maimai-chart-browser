"""Authored tiny study manifests; no copied public chart text or account data."""

import hashlib
import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from maimai_analyzer.simai_subset import parse_simai_subset
from maimai_intelligence.explorer import validate_exploration_pack
from scripts.build_real_chart_study import (
    build_study,
    check_rubrics,
    main,
    structural_observations,
)

BODY = "(120){8}1,1-5[4:1],2h[4:1],3,E"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def rubric():
    return {
        "rubric_id": "authored-window",
        "label": "Four authored inputs",
        "source_scope": "same_transcription",
        "window_start_s": 0,
        "window_end_s": 1,
        "expected_onsets": [
            {"time_s": time, "onsets": [{"position": position, "role": role}]}
            for time, position, role in [
                (0, 1, "tap"),
                (0.25, 1, "star_tap"),
                (0.5, 2, "hold_onset"),
                (0.75, 3, "tap"),
            ]
        ],
        "expected_slides": [
            {
                "head_position": 1,
                "end_position": 5,
                "shape": "-",
                "head_s": 0.25,
                "movement_start_s": 0.75,
                "movement_end_s": 1.25,
            }
        ],
    }


def fixture(directory, bodies=None):
    directory = Path(directory)
    source = b"<html>Authored source snapshot for testing</html>"
    (directory / "source.html").write_bytes(source)
    charts = []
    for index, body in enumerate(bodies or [BODY]):
        data = body.encode()
        name = f"authored-{index}.simai"
        (directory / name).write_bytes(data)
        charts.append(
            {
                "slug": f"authored-{index}",
                "title": f"Authored Study {index}",
                "difficulty": "EXPERT",
                "format": "STD",
                "body_file": name,
                "body_sha256": digest(data),
                "source_raw_file": "source.html",
                "source_raw_sha256": digest(source),
                "source_url": "https://example.org/chart",
                "metadata_url": "https://example.org/description",
                "expected_note_counts": {"tap": 3, "hold": 1, "slide": 1, "break": 0},
                "description_paraphrase": "Authored passage example, not a performance claim.",
                "description_scope": "This exact authored variant",
                "predeclared_expectations": [],
                "unknowns": ["Game fidelity is unverified."],
                "parser_status": "rejected",
                "parser_counts": {"tap": 999},
                "rubrics": [rubric()] if body == BODY else [],
            }
        )
    manifest = {"source_kind": "public_transcription_evaluation", "charts": charts}
    path = directory / "manifest.json"
    path.write_text(json.dumps(manifest), encoding="utf-8")
    return path, manifest


def parsed(body=BODY):
    return parse_simai_subset(
        body,
        chart_id="synthetic:study",
        song_id="synthetic:study",
        format="STD",
        difficulty="EXPERT",
        revision="r1",
        source={
            "source_id": "authored-test",
            "revision": "r1",
            "kind": "authored_synthetic",
            "identity_status": "exact",
        },
    )


class RealChartStudyTests(unittest.TestCase):
    def test_end_to_end_reparses_hashes_counts_and_same_explore_without_network(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest, _ = fixture(directory)
            output = Path(directory) / "results"
            before = {p.name: p.read_bytes() for p in Path(directory).iterdir() if p.is_file()}
            with patch("socket.socket", side_effect=AssertionError("No network allowed")):
                result = build_study(manifest, output)
            chart = result["charts"][0]
            self.assertEqual(chart["parser_status"], "accepted")
            self.assertTrue(chart["counts_match"])
            self.assertTrue(chart["rubric_checks"][0]["pass"])
            self.assertEqual(chart["description_support_status"], "selected_structure_consistent")
            self.assertEqual(
                chart["structural_observations"]["same_position_tap_to_star_eighth_pairs"]["count"],
                1,
            )
            for name, data in before.items():
                self.assertEqual((Path(directory) / name).read_bytes(), data)
            pack = json.loads((output / "research-catalog.json").read_text())
            self.assertTrue(validate_exploration_pack(pack)["evaluation_only"])
            html = (output / "explorer.html").read_text(encoding="utf-8")
            self.assertIn("exploration-data", html)
            self.assertNotRegex(html, r"https?://")
            review = (output / "index.html").read_text(encoding="utf-8")
            self.assertIn('href="explorer.html"', review)
            self.assertIn("https://example.org/chart", review)
            self.assertNotIn(BODY, review)
            self.assertEqual(
                digest((output / chart["profile_file"]).read_bytes()), chart["profile_sha256"]
            )
            first = {p.name: p.read_bytes() for p in output.iterdir()}
            build_study(manifest, output)
            self.assertEqual(first, {p.name: p.read_bytes() for p in output.iterdir()})

    def test_three_unsupported_cases_remain_unavailable_without_repair(self):
        with tempfile.TemporaryDirectory() as directory:
            path, _ = fixture(directory, ["(120){4}1-9,E", "(120){4}Z9,E", "(120){4}1-5[4:1]*Z9,E"])
            result = build_study(path, Path(directory) / "results")
            self.assertEqual(result["coverage"]["unsupported"], 3)
            self.assertTrue(
                all(
                    c["parsed_counts"] is None and c["unavailable_reason"] for c in result["charts"]
                )
            )

            pack = json.loads((Path(directory) / "results/research-catalog.json").read_text())
            self.assertEqual(len(pack["charts"]), 3)
            self.assertTrue(
                all(
                    c["analysis_status"] == "unavailable"
                    and "Unsupported notation:" in c["coverage"]["summary"]
                    for c in pack["charts"]
                )
            )

    def test_natural_body_end_preserves_counts_without_inventing_an_end_marker(self):
        with tempfile.TemporaryDirectory() as directory:
            path, _ = fixture(directory, [BODY[:-1]])
            result = build_study(path, Path(directory) / "results")
            chart = result["charts"][0]
            self.assertEqual(result["coverage"]["accepted"], 1)
            self.assertIsNone(chart["end_marker_seconds"])
            self.assertTrue(chart["counts_match"])
            self.assertEqual(chart["parsed_counts"], {"tap": 3, "hold": 1, "slide": 1, "break": 0})

    def test_hash_failure_in_later_chart_leaves_all_inputs_and_outputs_untouched(self):
        with tempfile.TemporaryDirectory() as directory:
            path, manifest = fixture(directory, [BODY, BODY])
            manifest["charts"][1]["source_raw_sha256"] = "b" * 64
            path.write_text(json.dumps(manifest))
            output = Path(directory) / "results"
            output.mkdir()
            sentinel = output / "results.json"
            sentinel.write_bytes(b"original output")
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                build_study(path, output)
            self.assertEqual(sentinel.read_bytes(), b"original output")
            self.assertEqual(list(output.iterdir()), [sentinel])

    def test_paths_hash_omission_alias_conflicts_and_duplicate_id_fail_before_output(self):
        mutations = [
            {"body_file": "../escape.simai"},
            {"source_raw_file": "nested/source.html"},
            {"source_raw_sha256": None},
            {"file": "different.simai"},
            {"source_url": "javascript:alert(1)"},
            {"slug": "../escape"},
        ]
        for change in mutations:
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                path, manifest = fixture(directory)
                manifest["charts"][0].update(change)
                path.write_text(json.dumps(manifest))
                output = Path(directory) / "results"
                with self.assertRaises(ValueError):
                    build_study(path, output)
                self.assertFalse(output.exists())
        with tempfile.TemporaryDirectory() as directory:
            path, manifest = fixture(directory)
            manifest["charts"].append(deepcopy(manifest["charts"][0]))
            path.write_text(json.dumps(manifest))
            with self.assertRaises(ValueError):
                build_study(path, Path(directory) / "results")

    def test_output_aliases_cannot_replace_source_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            path, _ = fixture(directory)
            before = path.read_bytes()
            with self.assertRaises(ValueError):
                build_study(path, Path(directory))
            self.assertEqual(path.read_bytes(), before)
            output = Path(directory) / "results"
            output.mkdir()
            try:
                (output / "results.json").symlink_to(path)
            except OSError:
                self.skipTest("Symbolic-link creation is unavailable")
            with self.assertRaises(ValueError):
                build_study(path, output)
            self.assertEqual(path.read_bytes(), before)

    def test_complete_window_cardinality_catches_extra_and_missing_inputs(self):
        raw, audit = parsed()
        self.assertTrue(check_rubrics(raw, audit, [rubric()])[0]["pass"])
        incomplete = rubric()
        incomplete["expected_onsets"].pop()
        result = check_rubrics(raw, audit, [incomplete])[0]
        self.assertFalse(result["pass"])
        self.assertFalse(result["onset_cardinality_matches"])
        self.assertTrue(all(c["pass"] for c in result["onset_checks"]))

    def test_timing_tolerance_and_slide_mismatch_are_explicit(self):
        raw, audit = parsed()
        changed = rubric()
        changed["expected_slides"][0]["movement_end_s"] += 0.000001
        self.assertTrue(check_rubrics(raw, audit, [changed])[0]["pass"])
        changed["expected_slides"][0]["movement_end_s"] += 0.000002
        self.assertFalse(check_rubrics(raw, audit, [changed])[0]["pass"])
        changed = rubric()
        changed["expected_slides"][0]["end_position"] = 6
        self.assertFalse(check_rubrics(raw, audit, [changed])[0]["slide_checks"][0]["pass"])

    def test_pair_observation_excludes_chords_breaks_other_positions_and_wrong_gap(self):
        for body, count in [
            (BODY, 1),
            ("(120){8}1/2,1-5[4:1],E", 0),
            ("(120){8}1b,1-5[4:1],E", 0),
            ("(120){8}2,1-5[4:1],E", 0),
            ("(120){4}1,1-5[4:1],E", 0),
        ]:
            with self.subTest(body=body):
                raw, _ = parsed(body)
                self.assertEqual(
                    structural_observations(raw)["same_position_tap_to_star_eighth_pairs"]["count"],
                    count,
                )

    def test_duration_ratio_endpoint_coincidence_and_duplicate_slide_expectations(self):
        raw, audit = parsed("(120){8}1-5[16:1],2-6[4:1],,,,4,E")
        expected = {
            "rubric_id": "authored-slide-ratio",
            "label": "Two authored movements",
            "source_scope": "same_transcription",
            "window_start_s": 0,
            "window_end_s": 1.5,
            "expected_onsets": [
                {"time_s": time, "onsets": [{"position": position, "role": role}]}
                for time, position, role in [
                    (0, 1, "star_tap"),
                    (0.25, 2, "star_tap"),
                    (1.25, 4, "tap"),
                ]
            ],
            "expected_slides": [
                {
                    "head_position": 1,
                    "end_position": 5,
                    "shape": "-",
                    "head_s": 0,
                    "movement_start_s": 0.5,
                    "movement_end_s": 0.625,
                },
                {
                    "head_position": 2,
                    "end_position": 6,
                    "shape": "-",
                    "head_s": 0.25,
                    "movement_start_s": 0.75,
                    "movement_end_s": 1.25,
                },
            ],
        }
        result = check_rubrics(raw, audit, [expected])[0]
        self.assertTrue(result["pass"])
        measured = result["measured_observations"]
        self.assertEqual(measured["last_movement_duration_over_first"], 4)
        self.assertTrue(measured["last_movement_four_times_first_within_1us"])
        self.assertEqual(
            measured["final_slide_end_coincident_onsets"], [{"position": 4, "role": "tap"}]
        )
        self.assertEqual(measured["physical_path_speed"], "unknown")
        expected["expected_slides"][1] = deepcopy(expected["expected_slides"][0])
        with self.assertRaisesRegex(ValueError, "Duplicate expected slide"):
            check_rubrics(raw, audit, [expected])

    def test_mismatch_exit_and_hostile_paraphrase_remain_reviewable_not_executable(self):
        with tempfile.TemporaryDirectory() as directory:
            path, manifest = fixture(directory)
            manifest["charts"][0]["expected_note_counts"]["tap"] = 100
            manifest["charts"][0]["description_paraphrase"] = '<script>alert("test")</script>'
            path.write_text(json.dumps(manifest))
            output = Path(directory) / "results"
            self.assertEqual(main([str(path), "--output-dir", str(output)]), 1)
            review = (output / "index.html").read_text()
            self.assertIn("&lt;script&gt;", review)
            self.assertNotIn('<script>alert("test")</script>', review)
            self.assertIn("Mismatch", review)


if __name__ == "__main__":
    unittest.main()
