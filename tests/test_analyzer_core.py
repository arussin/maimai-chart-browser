"""Synthetic-only analyzer contracts, grammar hard negatives and Flow boundaries."""

from __future__ import annotations

import copy
import json
import tempfile
import unittest
from fractions import Fraction
from pathlib import Path
from unittest.mock import patch

from maimai_analyzer import (
    ChartInputError,
    analyze,
    canonical_bytes,
    pattern_registry,
    synthetic_charts,
    validate_profile,
)
from maimai_analyzer.__main__ import main
from maimai_analyzer.flow import interval_grid


def tag(profile: dict, pattern_id: str) -> dict:
    return next(item for item in profile["tags"] if item["pattern_id"] == pattern_id)


class AnalyzerContractTests(unittest.TestCase):
    def setUp(self):
        self.chart = synthetic_charts()[0]

    def test_canonical_profile_ignores_unordered_input_order(self):
        expected = canonical_bytes(analyze(self.chart))
        self.chart["onsets"].reverse()
        self.chart["capabilities"].reverse()
        self.assertEqual(canonical_bytes(analyze(self.chart)), expected)

    def test_profile_does_not_mutate_input(self):
        before = copy.deepcopy(self.chart)
        analyze(self.chart)
        self.assertEqual(before, self.chart)

    def test_mutating_a_result_cannot_change_later_reference_scales(self):
        profile = analyze(self.chart)
        profile["flow"]["scales"]["density"]["bands"].append(999)
        self.assertEqual(
            analyze(self.chart)["flow"]["scales"]["density"]["bands"], [0, 2, 4, 6, 8, 12]
        )

    def test_unknown_schema_and_extra_personal_fields_are_rejected(self):
        for update in (
            {"schema_version": "2.0.0"},
            {"player": {"name": "Fictional user"}},
            {"scores": []},
            {"onsets": "not a list"},
        ):
            with self.subTest(update=update), self.assertRaises(ChartInputError):
                analyze({**self.chart, **update})

    def test_malformed_numeric_values_never_become_zero(self):
        for value in (float("nan"), float("inf"), -float("inf"), True, "0", None, 1.5):
            self.chart["onsets"][0]["time_us"] = value
            with self.subTest(value=value), self.assertRaises(ChartInputError):
                analyze(self.chart)

    def test_invalid_nested_values_use_contract_exception(self):
        for field in ("role", "event_id", "group_id", "beat", "position"):
            chart = copy.deepcopy(self.chart)
            chart["onsets"][0][field] = {"nested": [1, 2]}
            with self.subTest(field=field), self.assertRaises(ChartInputError):
                analyze(chart)

    def test_duplicate_heads_must_be_normalized_once(self):
        self.chart["onsets"].append(copy.deepcopy(self.chart["onsets"][0]))
        with self.assertRaisesRegex(ChartInputError, "Duplicate onset"):
            analyze(self.chart)

    def test_exact_variant_and_source_versions_change_cache_identity(self):
        original = analyze(self.chart)
        for key, value in (("chart_id", "synthetic:orbit:STD:MASTER:r1"), ("revision", "r2")):
            changed = analyze({**self.chart, key: value})
            self.assertNotEqual(changed["cache_key"], original["cache_key"])
        self.chart["source"]["normalizer_version"] = "2.0.0"
        self.assertNotEqual(analyze(self.chart)["cache_key"], original["cache_key"])

    def test_reviewed_source_requires_raw_hash_and_explicit_identity(self):
        self.chart["source"]["kind"] = "reviewed_permitted_local"
        with self.assertRaises(ChartInputError):
            analyze(self.chart)
        self.chart["source"]["byte_hash"] = "a" * 64
        self.assertEqual(analyze(self.chart)["source_hash"], "a" * 64)
        self.chart["source"]["identity_status"] = "ambiguous"
        result = analyze(self.chart)
        self.assertEqual(result["coverage"]["analysis"], "partial")
        self.assertTrue(all(item["status"] == "unknown" for item in result["tags"]))

    def test_public_evaluation_requires_hash_and_cannot_claim_complete_review(self):
        self.chart["source"]["kind"] = "public_transcription_evaluation"
        with self.assertRaises(ChartInputError):
            analyze(self.chart)
        self.chart["source"]["byte_hash"] = "b" * 64
        result = analyze(self.chart)
        validate_profile(result)
        self.assertEqual(result["source_hash"], "b" * 64)
        self.assertEqual(result["coverage"]["analysis"], "partial")
        self.assertEqual(result["coverage"]["reviewed_named_patterns"], 0)
        self.assertEqual(result["metrics"]["onset_count"], 32)
        self.assertIn("transcription evaluation only", " ".join(result["limitations"]))
        self.assertEqual(tag(result, "pattern.two_position_alternation")["status"], "detected")
        self.assertTrue(
            all(
                item["evidence"]["source_kind"] == "public_transcription_evaluation"
                for item in result["occurrences"]
            )
        )

    def test_negative_origin_and_source_offset_are_preserved_separately(self):
        self.chart.pop("track_duration_us")
        self.chart["source_offset_us"] = -125_000
        self.chart["bpm_segments"][0]["time_us"] = -500_000
        for event in self.chart["onsets"]:
            event["time_us"] -= 500_000
        result = analyze(self.chart)
        self.assertEqual(result["time_basis"]["origin_shift_us"], 500_000)
        self.assertEqual(result["time_basis"]["source_offset_us"], -125_000)
        self.assertEqual(result["flow"]["span_start_us"], 0)
        self.assertEqual(result["flow"]["basis"], "chart_span")

    def test_final_active_hold_and_movement_define_chart_end(self):
        chart = synthetic_charts()[3]
        chart.pop("track_duration_us")
        chart["holds"][0]["end_us"] = 10_000_000
        chart["slides"][0]["movement_end_us"] = 12_000_000
        self.assertEqual(analyze(chart)["flow"]["span_end_us"], 12_000_000)

    def test_negative_intervals_and_unlinked_holds_rejected(self):
        chart = synthetic_charts()[3]
        chart["holds"][0]["end_us"] = 0
        with self.assertRaises(ChartInputError):
            analyze(chart)
        chart = synthetic_charts()[3]
        chart["holds"][0]["onset_id"] = "missing"
        with self.assertRaises(ChartInputError):
            analyze(chart)
        chart = synthetic_charts()[3]
        chart["slides"][0]["movement_end_us"] = 0
        with self.assertRaises(ChartInputError):
            analyze(chart)

    def test_track_end_is_half_open_and_cannot_truncate_input(self):
        self.chart["track_duration_us"] = self.chart["onsets"][-1]["time_us"]
        with self.assertRaises(ChartInputError):
            analyze(self.chart)

    def test_bpm_changes_have_continuous_rational_anchors(self):
        self.chart["onsets"] = self.chart["onsets"][:4]
        self.chart["bpm_segments"].append({"time_us": 500_000, "beat": [1, 1], "bpm": [240, 1]})
        self.chart["onsets"][3]["beat"] = [2, 1]
        analyze(self.chart)
        self.chart["bpm_segments"][1]["beat"] = [3, 1]
        with self.assertRaisesRegex(ChartInputError, "continuous"):
            analyze(self.chart)

    def test_missing_beats_produce_unknown_structure_not_fake_tempo(self):
        self.chart["capabilities"].remove("beat_grid")
        for event in self.chart["onsets"]:
            event.pop("beat")
        result = analyze(self.chart)
        self.assertIsNone(result["descriptor"]["ngrams"])
        self.assertIsNone(result["descriptor"]["features"]["mean_beat_interval"])
        self.assertEqual(tag(result, "pattern.two_position_alternation")["status"], "unknown")

    def test_partial_intervals_do_not_claim_absence_or_full_counts(self):
        profile = analyze(synthetic_charts()[-1])
        self.assertIsNone(profile["metrics"]["onset_count"])
        self.assertEqual(profile["metrics"]["observed_onset_count"], 32)
        self.assertIsNone(profile["metrics"]["slide_movement_occupancy"])
        self.assertEqual(tag(profile, "pattern.moving_slide_overlap")["status"], "unknown")
        self.assertEqual(tag(profile, "trait.backloaded_density")["status"], "unknown")

    def test_known_intervals_cannot_overlap_or_escape_span(self):
        for intervals in ([[[0, 2_000_000], [1_000_000, 3_000_000]]], [[[0, 9_000_000]]]):
            self.chart["known_intervals"] = intervals[0]
            with self.assertRaises(ChartInputError):
                analyze(self.chart)

    def test_offline_core_never_constructs_network_client(self):
        with (
            patch("socket.socket", side_effect=AssertionError("network forbidden")),
            patch("urllib.request.urlopen", side_effect=AssertionError("network forbidden")),
        ):
            result = analyze(self.chart)
        self.assertEqual(result["metrics"]["onset_count"], 32)

    def test_cli_cold_warm_outputs_identical_and_corrupt_cache_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, output, cache = root / "input.json", root / "profile.json", root / "cache"
            source.write_bytes(canonical_bytes(self.chart))
            args = ["analyze", str(source), "--output", str(output), "--cache-dir", str(cache)]
            self.assertEqual(main(args), 0)
            cold = output.read_bytes()
            with patch(
                "maimai_analyzer.__main__.analyze", side_effect=AssertionError("warm reanalysis")
            ):
                self.assertEqual(main(args), 0)
            self.assertEqual(output.read_bytes(), cold)
            manifest = json.loads(output.with_suffix(".json.manifest.json").read_text("utf-8"))
            self.assertEqual(manifest["profiles"][0]["chart_id"], self.chart["chart_id"])
            next(cache.glob("*.json")).write_text("{}", encoding="utf-8")
            with patch("sys.stderr"):
                self.assertEqual(main(args), 2)
            self.assertEqual(output.read_bytes(), cold)

    def test_cli_refuses_to_overwrite_source(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.json"
            original = canonical_bytes(self.chart)
            source.write_bytes(original)
            with patch("sys.stderr"):
                self.assertEqual(main(["analyze", str(source), "--output", str(source)]), 2)
            self.assertEqual(source.read_bytes(), original)

    def test_cli_manifest_cannot_overwrite_source_or_start_cache_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, output, cache = (
                root / "profile.json.manifest.json",
                root / "profile.json",
                root / "cache",
            )
            original = canonical_bytes(self.chart)
            source.write_bytes(original)
            inner = root / "inner"
            inner.mkdir()
            for destination in (output, inner / ".." / output.name):
                with self.subTest(output=str(destination)), patch("sys.stderr") as errors:
                    self.assertEqual(
                        main(
                            [
                                "analyze",
                                str(source),
                                "--output",
                                str(destination),
                                "--cache-dir",
                                str(cache),
                            ]
                        ),
                        2,
                    )
                    self.assertTrue(any("source input" in str(call) for call in errors.mock_calls))
                self.assertEqual(source.read_bytes(), original)
                self.assertFalse(output.exists())
                self.assertFalse(cache.exists())

    def test_cli_demo_rejects_symbolic_output_manifest_aliases_when_supported(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "profile.json"
            manifest = root / "profile.json.manifest.json"
            original = b"Synthetic retained manifest sentinel\n"
            manifest.write_bytes(original)
            try:
                output.symlink_to(manifest)
            except (OSError, NotImplementedError) as exc:
                self.skipTest(f"Symbolic-link creation is unavailable: {type(exc).__name__}")
            with patch("sys.stderr"):
                self.assertEqual(main(["demo", "--output", str(output)]), 2)
            self.assertEqual(manifest.read_bytes(), original)
            self.assertTrue(output.is_symlink())

    def test_versioned_profile_validator_rejects_contamination_and_invalid_evidence(self):
        profile = analyze(self.chart)
        validate_profile(profile)
        for key, value in (("player", "fictional private sentinel"), ("schema_version", "2.0.0")):
            with self.subTest(key=key), self.assertRaises(ChartInputError):
                validate_profile({**profile, key: value})
        profile["occurrences"][0]["end_us"] = 9_000_000
        with self.assertRaises(ChartInputError):
            validate_profile(profile)

    def test_cache_envelope_integrity_and_full_source_fingerprint_are_checked(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, output, cache = root / "input.json", root / "out.json", root / "cache"
            source.write_bytes(canonical_bytes(self.chart))
            args = ["analyze", str(source), "--output", str(output), "--cache-dir", str(cache)]
            self.assertEqual(main(args), 0)
            cached_path = next(cache.glob("*.json"))
            envelope = json.loads(cached_path.read_text("utf-8"))
            envelope["profile"]["metrics"]["onset_count"] = 999
            cached_path.write_bytes(canonical_bytes(envelope))
            with patch("sys.stderr"):
                self.assertEqual(main(args), 2)

    def test_break_ex_flags_never_weight_physical_density(self):
        original = analyze(self.chart)
        for event in self.chart["onsets"]:
            event["break"] = True
            event["ex"] = True
        changed = analyze(self.chart)
        self.assertEqual(original["metrics"], changed["metrics"])
        self.assertEqual(original["flow"]["density_summary"], changed["flow"]["density_summary"])


class AnalyzerPatternTests(unittest.TestCase):
    def test_registry_requires_explicit_rules_and_preserves_experimental_qualification(self):
        entries = pattern_registry()["entries"]
        self.assertEqual(len(entries), 36)
        enabled = [entry for entry in entries if entry["automatic_tagging_enabled"]]
        from maimai_analyzer.patterns import IMPLEMENTED

        self.assertEqual({entry["pattern_id"] for entry in enabled}, set(IMPLEMENTED))
        self.assertTrue(
            all(entry["grammar"] and entry["required_capabilities"] for entry in enabled)
        )
        self.assertTrue(all(entry["detector_status"] == "experimental" for entry in enabled))
        self.assertTrue(all(not entry["verified_chart_examples"] for entry in entries))
        umiyuri = next(entry for entry in entries if entry["pattern_id"] == "pattern.umiyuri")
        self.assertTrue(umiyuri["automatic_tagging_enabled"])
        self.assertEqual(umiyuri["name_origin"], "community_attested")
        self.assertIn("outside this version", umiyuri["grammar"])

    def test_one_long_alternation_is_one_evidenced_occurrence(self):
        profile = analyze(synthetic_charts()[0])
        found = tag(profile, "pattern.two_position_alternation")
        self.assertEqual(found["occurrence_count"], 1)
        occurrence = next(
            item
            for item in profile["occurrences"]
            if item["pattern_id"] == "pattern.two_position_alternation"
        )
        self.assertEqual(len(occurrence["event_ids"]), 32)
        self.assertEqual(found["speed_range"], [4, 4])
        self.assertGreater(found["prevalence"], 0.9)

    def test_alternation_hard_negatives_and_exact_threshold(self):
        for number, expected in ((5, False), (6, True)):
            chart = synthetic_charts()[0]
            chart["onsets"] = chart["onsets"][:number]
            self.assertEqual(
                tag(analyze(chart), "pattern.two_position_alternation")["status"] == "detected",
                expected,
            )
        chart = synthetic_charts()[2]
        self.assertEqual(
            tag(analyze(chart), "pattern.two_position_alternation")["status"],
            "not-detected-with-supported-coverage",
        )

    def test_repeated_buttons_require_separate_monophonic_inputs(self):
        chart = synthetic_charts()[0]
        chart["onsets"] = chart["onsets"][:3]
        for event in chart["onsets"]:
            event["position"] = 4
        self.assertEqual(
            tag(analyze(chart), "pattern.same_position_repetition")["occurrence_count"], 1
        )
        chart["onsets"][1]["time_us"] = chart["onsets"][0]["time_us"]
        chart["onsets"][1]["beat"] = chart["onsets"][0]["beat"]
        self.assertEqual(
            tag(analyze(chart), "pattern.same_position_repetition")["occurrence_count"], 0
        )

    def test_simultaneous_group_requires_authored_identity_not_close_times(self):
        chart = synthetic_charts()[0]
        chart["onsets"] = chart["onsets"][:2]
        chart["onsets"][1]["time_us"] = 0
        chart["onsets"][1]["beat"] = [0, 1]
        self.assertEqual(tag(analyze(chart), "pattern.simultaneous_group")["occurrence_count"], 0)
        for event in chart["onsets"]:
            event["group_id"] = "chord-1"
        self.assertEqual(tag(analyze(chart), "pattern.simultaneous_group")["occurrence_count"], 1)
        chart["onsets"][1]["time_us"] = 1
        with self.assertRaisesRegex(ChartInputError, "different onset times"):
            analyze(chart)

    def test_shared_slide_heads_and_chain_segments_do_not_inflate_input_count(self):
        chart = synthetic_charts()[3]
        profile = analyze(chart)
        self.assertEqual(profile["metrics"]["onset_count"], 32)
        self.assertEqual(tag(profile, "pattern.same_head_slide_fan")["occurrence_count"], 1)
        self.assertEqual(tag(profile, "pattern.connected_slide_chain")["occurrence_count"], 1)
        self.assertEqual(
            tag(profile, "pattern.umiyuri")["status"], "not-detected-with-supported-coverage"
        )

    def test_wait_movement_boundary_and_own_head_exclusion(self):
        chart = synthetic_charts()[3]
        chart["onsets"] = [chart["onsets"][0], chart["onsets"][4]]
        chart["holds"] = []
        chart["slides"] = chart["slides"][:1]
        profile = analyze(chart)
        self.assertEqual(tag(profile, "pattern.delayed_slide_interleave")["occurrence_count"], 0)
        self.assertEqual(tag(profile, "pattern.slide_tap_interleave")["occurrence_count"], 1)

    def test_interaction_count_excludes_head_independent_of_id_sort_order(self):
        chart = synthetic_charts()[3]
        chart["onsets"] = chart["onsets"][:2]
        chart["onsets"][1].update(event_id="a-earlier-id", time_us=0, beat=[0, 1])
        chart["holds"] = []
        chart["slides"] = chart["slides"][:1]
        profile = analyze(chart)
        occurrence = next(
            item
            for item in profile["occurrences"]
            if item["pattern_id"] == "pattern.delayed_slide_interleave"
        )
        self.assertEqual(occurrence["measurements"]["independent_onset_count"], 1)

    def test_touching_slide_intervals_do_not_overlap(self):
        chart = synthetic_charts()[3]
        chart["slides"][0]["movement_end_us"] = 2_000_000
        profile = analyze(chart)
        self.assertEqual(tag(profile, "pattern.moving_slide_overlap")["occurrence_count"], 0)
        chart["slides"][0]["movement_end_us"] += 1
        self.assertEqual(tag(analyze(chart), "pattern.moving_slide_overlap")["occurrence_count"], 1)

    def test_occurrence_ids_include_exact_variant_identity(self):
        chart = synthetic_charts()[0]
        first = analyze(chart)
        chart["chart_id"] = "synthetic:orbit:STD:MASTER:r1"
        chart["difficulty"] = "MASTER"
        second = analyze(chart)
        self.assertNotEqual(
            first["occurrences"][0]["occurrence_id"], second["occurrences"][0]["occurrence_id"]
        )

    def test_flow_traits_have_positive_and_hard_negative_examples(self):
        steady, _, _, slides, burst, _ = [analyze(chart) for chart in synthetic_charts()]
        self.assertEqual(tag(steady, "trait.steady_density")["occurrence_count"], 1)
        self.assertEqual(tag(steady, "trait.bursty_density")["occurrence_count"], 0)
        self.assertEqual(tag(burst, "trait.bursty_density")["occurrence_count"], 1)
        self.assertEqual(tag(burst, "trait.steady_density")["occurrence_count"], 0)
        self.assertEqual(tag(slides, "trait.slide_occupancy")["occurrence_count"], 1)
        self.assertEqual(tag(steady, "trait.slide_occupancy")["occurrence_count"], 0)
        for front in (True, False):
            chart = synthetic_charts()[0]
            offset = 0 if front else 6_000_000
            for index, event in enumerate(chart["onsets"]):
                event["time_us"] = offset + index * 50_000
                beat = Fraction(event["time_us"], 500_000)
                event["beat"] = [beat.numerator, beat.denominator]
            profile = analyze(chart)
            positive = "trait.frontloaded_density" if front else "trait.backloaded_density"
            negative = "trait.backloaded_density" if front else "trait.frontloaded_density"
            self.assertEqual(tag(profile, positive)["occurrence_count"], 1)
            self.assertEqual(tag(profile, negative)["occurrence_count"], 0)

    def test_hold_tap_interleave_is_not_rest_or_a_hand_assignment(self):
        chart = synthetic_charts()[3]
        profile = analyze(chart)
        self.assertEqual(tag(profile, "pattern.hold_tap_interleave")["occurrence_count"], 1)
        chart["onsets"] = [event for event in chart["onsets"] if event["role"] != "tap"]
        profile = analyze(chart)
        self.assertEqual(tag(profile, "pattern.hold_tap_interleave")["occurrence_count"], 0)
        frame = next(item for item in profile["flow"]["frames"] if item["start_us"] == 3_000_000)
        self.assertEqual(frame["density"], 0)
        self.assertEqual(frame["channels"]["hold_occupancy"], 1)
        self.assertGreater(frame["estimated_demand"], 0)


class AnalyzerFlowAndSequenceTests(unittest.TestCase):
    def test_grid_boundaries_count_every_onset_once(self):
        profile = analyze(synthetic_charts()[0])
        frames = profile["flow"]["frames"]
        self.assertEqual(sum(frame["onset_count"] for frame in frames), 32)
        self.assertTrue(all(frame["onset_count"] == 1 for frame in frames))
        self.assertEqual(frames[0]["rate_1s"], 4)
        self.assertEqual(frames[0]["rate_4s"], 4)

    def test_interval_sweep_has_half_open_exact_occupancy(self):
        values = interval_grid([(0, 500), (250, 750)], [0, 250, 500, 750], [250, 500, 750, 1000])
        self.assertEqual([item["peak_concurrency"] for item in values], [1, 2, 1, 0])
        self.assertEqual([item["occupancy"] for item in values], [1, 1, 1, 0])

    def test_shared_scale_retains_absolute_difference_and_relative_shape(self):
        normal, slow = [analyze(chart) for chart in synthetic_charts()[:2]]
        self.assertEqual(normal["flow"]["scales"], slow["flow"]["scales"])
        self.assertEqual(normal["metrics"]["onset_rate"], 2 * slow["metrics"]["onset_rate"])
        self.assertEqual(normal["flow"]["density_summary"]["mean"], 4)
        self.assertEqual(slow["flow"]["density_summary"]["mean"], 2)

    def test_24_segments_preserve_a_short_peak(self):
        chart = synthetic_charts()[0]
        chart["track_duration_us"] = 60_000_000
        chart["onsets"] = chart["onsets"][:8]
        for index, event in enumerate(chart["onsets"]):
            event["time_us"] = 30_000_000 + index * 10_000
            beat = Fraction(event["time_us"], 500_000)
            event["beat"] = [beat.numerator, beat.denominator]
        segments = analyze(chart)["flow"]["segments"]
        self.assertEqual(len(segments), 24)
        burst = segments[12]
        self.assertEqual(burst["density"]["peak"], 32)
        self.assertEqual(burst["density"]["mean"], 3.2)

    def test_unknown_frames_and_demand_never_display_as_zero(self):
        profile = analyze(synthetic_charts()[-1])
        frames = profile["flow"]["frames"]
        gap = next(frame for frame in frames if frame["start_us"] == 3_000_000)
        self.assertIsNone(gap["density"])
        self.assertEqual(gap["coverage"], 0)
        self.assertTrue(all(frame["estimated_demand"] is None for frame in frames))

    def test_supported_demand_is_separate_and_weights_are_explicit(self):
        chart = synthetic_charts()[3]
        original = analyze(chart)
        config = {
            "demand_weights": {
                "density": 1,
                "coordination": 0,
                "sustained_activity": 0,
                "rhythm_variation": 0,
            }
        }
        changed = analyze(chart, config)
        self.assertNotEqual(original["config_hash"], changed["config_hash"])
        self.assertEqual(original["flow"]["density_summary"], changed["flow"]["density_summary"])
        self.assertNotEqual(original["flow"]["demand_summary"], changed["flow"]["demand_summary"])
        for frame in changed["flow"]["frames"]:
            self.assertEqual(frame["density"], frame["estimated_demand"])

    def test_invalid_composite_weights_rejected(self):
        for config in (
            {"frame_us": 1},
            {"demand_weights": {}},
            {
                "demand_weights": {
                    "density": float("nan"),
                    "coordination": 0,
                    "sustained_activity": 0,
                    "rhythm_variation": 0,
                }
            },
        ):
            with self.subTest(config=config), self.assertRaises(ChartInputError):
                analyze(synthetic_charts()[0], config)

    def test_empty_chart_is_finite_and_does_not_match_patterns(self):
        chart = synthetic_charts()[0]
        chart["onsets"] = []
        chart.pop("track_duration_us")
        profile = analyze(chart)
        self.assertEqual(profile["metrics"]["onset_count"], 0)
        self.assertIsNone(profile["descriptor"]["ngrams"])
        self.assertEqual(profile["flow"]["segments"], [])
        self.assertFalse(profile["occurrences"])
        canonical_bytes(profile)

    def test_partial_metric_summary_uses_measured_duration(self):
        chart = synthetic_charts()[0]
        chart["known_intervals"] = [
            [start, start + 250_000] for start in range(0, 8_000_000, 500_000)
        ]
        flow = analyze(chart)["flow"]
        self.assertTrue(all(segment["density"]["mean"] is not None for segment in flow["segments"]))
        self.assertAlmostEqual(flow["density_summary"]["coverage"], 0.5, places=5)
        self.assertAlmostEqual(flow["density_summary"]["mean"], 4, places=5)

    def test_chart_span_final_onset_does_not_create_artificial_density_spike(self):
        chart = synthetic_charts()[0]
        chart.pop("track_duration_us")
        profile = analyze(chart)
        self.assertEqual(profile["flow"]["frames"][-1]["density"], 4)
        self.assertEqual(profile["flow"]["density_summary"]["peak"], 4)
        self.assertEqual(tag(profile, "trait.bursty_density")["occurrence_count"], 0)

    def test_point_only_chart_has_unavailable_flow_and_no_fake_rate(self):
        chart = synthetic_charts()[0]
        chart.pop("track_duration_us")
        chart["onsets"] = chart["onsets"][:1]
        profile = analyze(chart)
        self.assertIsNone(profile["metrics"]["onset_rate"])
        self.assertIsNone(profile["flow"]["frames"][0]["density"])
        self.assertEqual(profile["flow"]["segments"], [])

    def test_tempo_normalized_sequence_distinguishes_order_not_counts(self):
        normal, slow, different = [analyze(chart) for chart in synthetic_charts()[:3]]
        self.assertEqual(normal["descriptor"]["ngrams"], slow["descriptor"]["ngrams"])
        self.assertEqual(normal["metrics"]["onset_count"], different["metrics"]["onset_count"])
        self.assertNotEqual(normal["descriptor"]["ngrams"], different["descriptor"]["ngrams"])

    def test_rotation_supported_but_reflection_preserves_direction(self):
        chart = synthetic_charts()[2]
        original = analyze(chart)["descriptor"]["ngrams"]
        for event in chart["onsets"]:
            event["position"] = event["position"] % 8 + 1
        self.assertEqual(analyze(chart)["descriptor"]["ngrams"], original)
        for event in chart["onsets"]:
            event["position"] = 9 - event["position"]
        self.assertNotEqual(analyze(chart)["descriptor"]["ngrams"], original)

    def test_simultaneous_semantics_ignore_ids_and_preserve_rotation(self):
        chart = synthetic_charts()[0]
        for index, event in enumerate(chart["onsets"]):
            event["time_us"] = (index // 2) * 500_000
            event["beat"] = [index // 2, 1]
            event["group_id"] = f"group-{index // 2}"
            event["role"] = "tap" if index % 2 == 0 else "star_tap"
        original = analyze(chart)["descriptor"]["ngrams"]
        for index, event in enumerate(chart["onsets"]):
            event["event_id"] = f"renamed-{31 - index:03}"
            event["group_id"] = f"also-renamed-{index // 2}"
        self.assertEqual(analyze(chart)["descriptor"]["ngrams"], original)
        for event in chart["onsets"]:
            event["position"] = (event["position"] + 5) % 8 + 1
        self.assertEqual(analyze(chart)["descriptor"]["ngrams"], original)

    def test_authored_group_membership_is_structural_evidence(self):
        chart = synthetic_charts()[0]
        for index, event in enumerate(chart["onsets"]):
            event["time_us"] = (index // 4) * 500_000
            event["beat"] = [index // 4, 1]
            event["group_id"] = f"group-{index // 2}"
            event["position"] = index % 8 + 1
        original = analyze(chart)["descriptor"]["ngrams"]
        for index, event in enumerate(chart["onsets"]):
            event["group_id"] = f"group-{index // 4}-{index % 2}"
        self.assertNotEqual(analyze(chart)["descriptor"]["ngrams"], original)

    def test_ngrams_cover_full_sequence_beyond_preview(self):
        chart = synthetic_charts()[0]
        chart["track_duration_us"] = 40_000_000
        template = chart["onsets"][0]
        chart["onsets"] = []
        for index in range(160):
            beat = Fraction(index, 2)
            chart["onsets"].append(
                {
                    **template,
                    "event_id": f"n-{index}",
                    "time_us": index * 250_000,
                    "beat": [beat.numerator, beat.denominator],
                    "position": index % 8 + 1,
                }
            )
        descriptor = analyze(chart)["descriptor"]
        self.assertTrue(descriptor["sequence_truncated"])
        self.assertEqual(len(descriptor["sequence"]), 128)
        self.assertEqual(sum(descriptor["ngrams"].values()), 158)


if __name__ == "__main__":
    unittest.main()
