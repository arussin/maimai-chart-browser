"""Authored exact-rational storage, schema boundaries and downstream measurements."""

import copy
import json
import shutil
import subprocess  # noqa: S404 - fixed local Node JSON roundtrip, no shell/network
import unittest
from fractions import Fraction
from unittest.mock import patch

from maimai_analyzer import analyze, normalize_chart, pattern_registry, synthetic_charts
from maimai_analyzer.catalog import build_catalog
from maimai_analyzer.contracts import (
    EXACT_RATIONAL_SCHEMA_VERSION,
    ChartInputError,
    canonical_bytes,
    validate_profile,
)
from maimai_analyzer.core import analysis_fingerprint
from maimai_analyzer.rational import (
    MAX_RATIONAL_BITS,
    MAX_RATIONAL_INTEGER,
    RationalEncodingError,
    decode_rational,
    encode_rational,
)
from maimai_analyzer.wire import decode_pack, encode_pack
from maimai_intelligence.explorer import validate_exploration_pack
from scripts.build_real_chart_study import structural_observations


def large_grid_chart():
    """Translate an ordinary synthetic beat grid by an exact 81-bit fraction."""
    chart = synthetic_charts()[0]
    chart["schema_version"] = EXACT_RATIONAL_SCHEMA_VERSION
    offset = Fraction(2**80 + 1, 2**81)
    for event in chart["onsets"]:
        event["beat"] = encode_rational(offset + decode_rational(event["beat"]))
    chart["bpm_segments"][0]["beat"] = encode_rational(offset)
    return chart


class AnalyzerRationalTests(unittest.TestCase):
    def test_small_pairs_retain_exact_historical_representation(self):
        for pair in ([0, 1], [1, 2], [-3, 4], [MAX_RATIONAL_INTEGER, 1]):
            self.assertEqual(encode_rational(decode_rational(pair)), pair)

    def test_large_pairs_roundtrip_and_reduce_without_float_conversion(self):
        for value in (
            Fraction(2**100 + 1, 2**101),
            Fraction(-(2**100 + 1), 2**101),
            Fraction(2**MAX_RATIONAL_BITS - 1, 1),
        ):
            with self.subTest(bits=value.numerator.bit_length()):
                encoded = encode_rational(value)
                self.assertTrue(all(type(item) is str for item in encoded))
                self.assertEqual(decode_rational(json.loads(json.dumps(encoded))), value)
        self.assertEqual(encode_rational(decode_rational(["2", "4"])), [1, 2])
        factor = 2**200
        self.assertEqual(encode_rational(decode_rational([str(factor), str(2 * factor)])), [1, 2])

    def test_malformed_or_oversized_pairs_reject_before_fraction_arithmetic(self):
        oversized = str(2**MAX_RATIONAL_BITS)
        for pair in (
            ["1", 2],
            [1, "2"],
            [True, 1],
            [1.0, 2],
            [MAX_RATIONAL_INTEGER + 1, 1],
            ["+1", "2"],
            ["01", "2"],
            ["-0", "2"],
            ["1e2", "3"],
            ["1.5", "3"],
            [" 1", "3"],
            ["١", "2"],
            ["1", "0"],
            ["1", "-2"],
            ["1", "02"],
            [oversized, "1"],
            [oversized, oversized],
            ["9" * 100000, "1"],
            [[1], [2]],
            {"numerator": "1", "denominator": "2"},
        ):
            with (
                self.subTest(kind=str(pair)[:45]),
                patch("maimai_analyzer.rational.Fraction") as fraction,
                self.assertRaises(RationalEncodingError),
            ):
                decode_rational(pair)
            fraction.assert_not_called()

    def test_encoder_rejects_nonfractions_and_excessive_exact_values(self):
        for value in (0.5, 1, True, Fraction(2**MAX_RATIONAL_BITS, 1)):
            with self.subTest(kind=type(value)), self.assertRaises(RationalEncodingError):
                encode_rational(value)

    def test_schema_extension_is_explicit_and_aliases_normalize_identically(self):
        chart = large_grid_chart()
        normalized = normalize_chart(chart)
        self.assertEqual(normalized["schema_version"], EXACT_RATIONAL_SCHEMA_VERSION)
        equivalent = copy.deepcopy(chart)
        for event in equivalent["onsets"]:
            value = decode_rational(event["beat"])
            event["beat"] = [str(value.numerator * 2), str(value.denominator * 2)]
        self.assertEqual(canonical_bytes(normalize_chart(equivalent)), canonical_bytes(normalized))
        chart["schema_version"] = "1.0.0"
        with self.assertRaisesRegex(ChartInputError, "bounded rational"):
            normalize_chart(chart)
        chart = synthetic_charts()[0]
        chart["onsets"][0]["beat"] = ["0", "1"]
        with self.assertRaisesRegex(ChartInputError, "bounded rational"):
            normalize_chart(chart)

    def test_translated_large_grid_preserves_measured_flow_patterns_and_structure(self):
        original = analyze(synthetic_charts()[0])
        profile = analyze(large_grid_chart())
        validate_profile(profile)
        self.assertEqual(profile["schema_version"], EXACT_RATIONAL_SCHEMA_VERSION)
        for key in ("metrics", "flow", "descriptor"):
            self.assertEqual(profile[key], original[key], key)
        self.assertEqual(
            [
                (tag["pattern_id"], tag["status"], tag["occurrence_count"])
                for tag in profile["tags"]
            ],
            [
                (tag["pattern_id"], tag["status"], tag["occurrence_count"])
                for tag in original["tags"]
            ],
        )
        self.assertTrue(profile["occurrences"])
        self.assertTrue(any(type(item) is str for item in profile["occurrences"][0]["start_beat"]))

    def test_large_bpm_components_preserve_exact_anchor_and_onset_validation(self):
        chart = large_grid_chart()
        tempo = Fraction(120 * 2**80 + 1, 2**80)
        chart["bpm_segments"][0]["bpm"] = encode_rational(tempo)
        offset = decode_rational(chart["bpm_segments"][0]["beat"])
        for event in chart["onsets"]:
            event["time_us"] = round((decode_rational(event["beat"]) - offset) * 60_000_000 / tempo)
        normalized = normalize_chart(chart)
        self.assertEqual(decode_rational(normalized["bpm_segments"][0]["bpm"]), tempo)
        chart["onsets"][-1]["time_us"] += 3
        with self.assertRaisesRegex(ChartInputError, "disagrees"):
            normalize_chart(chart)

    def test_legacy_safe_input_promotes_only_output_when_derived_pairs_need_strings(self):
        chart = synthetic_charts()[0]
        chart["onsets"] = chart["onsets"][:3]
        offset = Fraction(1, 2**50 - 1)
        chart["bpm_segments"][0]["beat"] = encode_rational(offset)
        for index, event in enumerate(chart["onsets"]):
            event.update(time_us=index * 500000, beat=encode_rational(offset + index), position=1)
        self.assertEqual(normalize_chart(chart)["schema_version"], "1.0.0")
        profile = analyze(chart)
        validate_profile(profile, analysis_fingerprint(chart))
        self.assertEqual(profile["schema_version"], EXACT_RATIONAL_SCHEMA_VERSION)
        self.assertTrue(any(type(item) is str for item in profile["occurrences"][0]["end_beat"]))
        # Recorded before string-capable profile schema entered the key. The
        # exact same input must not share its old integer-only artifact address.
        legacy_key = "512befd9b16f4654b95511c1d50928b39867a24d389c55d2f2dd0390653b39a9"
        self.assertNotEqual(profile["cache_key"], legacy_key)
        chart["schema_version"] = EXACT_RATIONAL_SCHEMA_VERSION
        explicit_key = analysis_fingerprint(chart)["cache_key"]
        self.assertEqual(len({legacy_key, profile["cache_key"], explicit_key}), 3)

    def test_unhashable_schema_values_reject_and_catalog_isolates_profile(self):
        chart = large_grid_chart()
        for value in ([], {}):
            chart["schema_version"] = value
            with self.subTest(value=value), self.assertRaises(ChartInputError):
                normalize_chart(chart)
        chart = large_grid_chart()
        metadata = {
            key: chart[key] for key in ("chart_id", "song_id", "format", "difficulty", "revision")
        }
        metadata.update(
            title="Authored bad schema", source_status="available", identity_status="exact"
        )
        profile = analyze(chart)
        profile["schema_version"] = []
        with self.assertRaises(ChartInputError):
            validate_profile(profile)
        pack, _ = build_catalog([metadata], [profile], pattern_registry())
        self.assertNotEqual(pack["charts"][0]["analysis_status"], "complete")

    def test_profile_validator_requires_canonical_version_appropriate_pairs(self):
        original = analyze(large_grid_chart())
        for replacement in (["01", "2"], ["2", "4"], ["1", 2], [2**54, 1]):
            profile = copy.deepcopy(original)
            profile["occurrences"][0]["start_beat"] = replacement
            with self.subTest(pair=replacement), self.assertRaises(ChartInputError):
                validate_profile(profile)
        original["schema_version"] = "1.0.0"
        with self.assertRaisesRegex(ChartInputError, "bounded rational"):
            validate_profile(original)

    def test_large_profile_publishes_in_unchanged_compact_browser_contract(self):
        raw = large_grid_chart()
        profile = analyze(raw)
        metadata = {
            key: raw[key] for key in ("chart_id", "song_id", "format", "difficulty", "revision")
        }
        metadata.update(
            title="Authored rational grid", source_status="available", identity_status="exact"
        )
        pack, manifest = build_catalog([metadata], [profile], pattern_registry())
        self.assertEqual(pack["schema_version"], "1.0.0")
        self.assertEqual(pack["charts"][0]["analysis_status"], "complete")
        self.assertEqual(manifest["coverage"]["fully_analyzed"], 1)
        self.assertEqual(decode_pack(encode_pack(pack)), pack)
        validate_exploration_pack(pack)
        self.assertTrue(all("start_beat" not in item for item in pack["charts"][0]["occurrences"]))

    def test_study_observations_use_exact_large_pair_decoder(self):
        raw = large_grid_chart()
        raw["onsets"][1]["position"] = raw["onsets"][0]["position"]
        raw["onsets"][1]["role"] = "star_tap"
        observations = structural_observations(raw)
        self.assertEqual(observations["same_position_tap_to_star_eighth_pairs"]["count"], 1)

    @unittest.skipUnless(shutil.which("node"), "Node is needed for exact JSON transport check")
    def test_large_components_survive_javascript_json_unchanged(self):
        pairs = [encode_rational(Fraction(2**150 + 1, 2**151)), [1, 2]]
        encoded = json.dumps(pairs, separators=(",", ":"))
        result = subprocess.run(  # noqa: S603 - fixed local executable, no shell
            [
                shutil.which("node"),
                "-e",
                "process.stdout.write(JSON.stringify(JSON.parse(process.argv[1])))",
                encoded,
            ],
            text=True,
            capture_output=True,
            timeout=30,
            check=True,
        )
        self.assertEqual(result.stdout, encoded)
