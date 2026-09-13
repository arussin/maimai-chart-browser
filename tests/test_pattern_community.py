"""Community forms, confusing near matches, source independence and unknown data."""

import copy
import unittest

from maimai_analyzer.contracts import ChartInputError, normalize_chart, validate_profile
from maimai_analyzer.core import analyze
from maimai_analyzer.pattern_community import (
    CATALOG,
    DEFINITIONS,
    SHAPE_RULES,
    arc_direction,
    path_shape,
)
from maimai_analyzer.patterns import pattern_registry
from tests.test_pattern_sequences import chart_for, result

CASES = {
    "anchored_trill": ("{8}1,3,1,4,1,5,1,6,", "{8}1,5,1,5,1,5,1,5,"),
    "scattered_taps": ("{8}1,4,7,2,6,3,8,5,", "{8}1,2,3,4,5,6,7,8,"),
    "touch_stream": ("{8}B1,B3,B6,B2,B5,B8,", "{8}B1,1,B3,3,B6,6,"),
    "touch_sweep": ("{8}B7,B8,B1,B2,", "{8}B7,B1,B3,B5,"),
    "touch_rotation": ("{8}B5,B6,B7,B8,B1,B2,B3,B4,", "{8}B5,B6,B7,B8,B1,B2,B3,"),
    "repeated_slide_heads": ("{8}1-5[8:1],1-4[8:1],1-6[8:1],", "{8}1-5[8:1]*-4[8:1]*-6[8:1],"),
    "alternating_slide_heads": (
        "{8}1-5[8:1],5-1[8:1],1-5[8:1],5-1[8:1],",
        "{8}1-5[8:1],2-6[8:1],3-7[8:1],4-8[8:1],",
    ),
    "different_slide_speeds": ("{4}1-5[4:1]/5-1[4:2],", "{4}1-5[4:1]/5-1[4:1],"),
    "extended_slide_wait": ("{4}1-5[1##0.5],", "{4}1-5[4:1],"),
    "return_slides": ("{8}1-5[4:2],5-1[4:2],", "{8}1-5[4:2],5-2[4:2],"),
    "cycles": (
        "{4}1>4[8:1]/5<8[8:1],1p5[8:1]/5p1[8:1],1>4[8:1]/5<8[8:1],",
        "{4}1>4[8:1]/5p1[8:1],1>4[8:1]/5p1[8:1],1>4[8:1]/5p1[8:1],",
    ),
    "slip_flip": (
        "{4}1>4[8:1]/5p1[8:1],1<6[8:1]/5q1[8:1],1>4[8:1]/5p1[8:1],",
        "{4}1>4[8:1]/5<8[8:1],1p5[8:1]/5p1[8:1],1>4[8:1]/5<8[8:1],",
    ),
    "death_scythe": (
        "{8}7<4[4:1],8,1,2<7[4:1],3,4,5>2[4:1],6,7,8,",
        "{8}7>4[4:1],8,1,2>7[4:1],3,4,5<2[4:1],6,7,8,",
    ),
    "sugarbitter": (
        "{4}1-3[8:1]*-5[8:1],1-4[8:1]*-6[8:1],1-5[8:1]*-7[8:1],",
        "{4}1-3[8:1],1-4[8:1],1-5[8:1],",
    ),
    "future": ("{4}7<4[8:1]/8,8>3[8:1]/7,4-7[8:1]/8,", "{4}7<4[8:1]/1,8>3[8:1]/1,4-7[8:1]/1,"),
    "gekishou": ("{16}3/8,7,1/6,2,3/8,", "{16}3/8,7,6,1,2,3,8,"),
    "hoshizora": ("{12}3h[12:1],5,7h[12:1],3,1h[12:1],7,", "{12}3,5,7,1,3,5,"),
    "outlaw": ("{16}2/4,3,4,3/5,4,5,4/6,", "{16}2/4,3,4,2/5,3,4,2/5,"),
    "amazing_mightyyy": ("{16}1/5,,,2,,,3/7,,,4,,,5/1,,,", "{8}1,2,3,4,5,"),
    "magic_circle": (
        "{8}1-5[8:1],2-6[8:1],3-7[8:1],4-8[8:1],",
        "{8}1-4[8:1],2-5[8:1],3-6[8:1],4-7[8:1],",
    ),
}


class CommunityPatternTests(unittest.TestCase):
    def test_saved_profiles_retain_exact_versioned_registry_membership(self):
        profile = analyze(chart_for(CASES["cycles"][0]))
        validate_profile(profile)
        wrong = copy.deepcopy(profile)
        wrong["tags"][0]["pattern_id"] = "pattern.not-in-registry"
        with self.assertRaises(ChartInputError):
            validate_profile(wrong)
        legacy = copy.deepcopy(profile)
        legacy.update(
            analyzer_version="0.2.0-experimental",
            registry_version="0.2.0-synthetic-experimental",
        )
        for key in ("tags", "occurrences"):
            legacy[key] = [r for r in legacy[key] if r["pattern_id"] not in DEFINITIONS]
        validate_profile(legacy)
        legacy["registry_version"] = profile["registry_version"]
        with self.assertRaises(ChartInputError):
            validate_profile(legacy)

    def test_repeated_buttons_are_not_non_neighbor_jumps(self):
        raw = chart_for("{8}1,1,1,1,2,3,4,4,")
        self.assertEqual(result(raw, "scattered_taps")["occurrence_count"], 0)

    def test_slide_forms_survive_rotation_reflection_and_tempo_rounding(self):
        for name in (
            "cycles",
            "slip_flip",
            "death_scythe",
            "sugarbitter",
            "magic_circle",
            "different_slide_speeds",
            "return_slides",
        ):
            for bpm in (107, 173, 240):
                for sign, offset in ((1, 3), (-1, 2)):
                    raw = chart_for(CASES[name][0], bpm)

                    def position(p, sign=sign, offset=offset):
                        return (sign * (p - 1) + offset) % 8 + 1

                    for e in raw["onsets"]:
                        e["position"] = position(e["position"])
                    for slide in raw["slides"]:
                        shape = path_shape(slide["path"])
                        start, kind, end = shape
                        start, end = position(start), position(end)
                        direction = arc_direction(shape)
                        if direction:
                            kind = next(
                                k
                                for k in ("<", ">")
                                if arc_direction((start, k, end)) == sign * direction
                            )
                        elif kind in ("p", "q") and sign == -1:
                            kind = "q" if kind == "p" else "p"
                        slide["path"] = f"simai:{start}{kind}{end}"
                    with self.subTest(name=name, bpm=bpm, sign=sign):
                        self.assertEqual(result(raw, name)["status"], "detected")

    def test_shape_and_head_disagreement_is_unknown(self):
        raw = chart_for(CASES["magic_circle"][0])
        raw["slides"][0]["path"] = "simai:2-6"
        self.assertEqual(result(raw, "magic_circle")["status"], "unknown")

    def test_speed_ratio_threshold_and_minimum_repetition(self):
        for duration, expected in (("0.499", 0), ("0.5", 1)):
            raw = chart_for(f"{{4}}1-5[0##0.4]/5-1[0##{duration}],")
            self.assertEqual(result(raw, "different_slide_speeds")["occurrence_count"], expected)
        for name in (
            "cycles",
            "slip_flip",
            "sugarbitter",
            "future",
            "magic_circle",
            "anchored_trill",
            "hoshizora",
            "touch_stream",
            "touch_rotation",
        ):
            body = CASES[name][0].rstrip(",").rsplit(",", 1)[0] + ","
            self.assertEqual(result(chart_for(body), name)["occurrence_count"], 0)

    def test_every_new_category_has_a_positive_and_confusing_negative(self):
        self.assertEqual(set(CASES), set(CATALOG))
        for name, (positive, negative) in CASES.items():
            with self.subTest(name=name):
                self.assertEqual(result(chart_for(positive), name)["status"], "detected")
                self.assertEqual(
                    result(chart_for(negative), name)["status"],
                    "not-detected-with-supported-coverage",
                )

    def test_names_and_aliases_are_english_and_ids_remain_distinct(self):
        entries = pattern_registry()["entries"]
        self.assertEqual(len(entries), len({p["pattern_id"] for p in entries}))
        self.assertEqual(len(entries), 56)
        for p in entries:
            self.assertTrue(p["display_name"].isascii())
            self.assertTrue(
                all(a["language"] == "en" and a["text"].isascii() for a in p["aliases"])
            )
        aliases = {p["pattern_id"]: {a["text"].lower() for a in p["aliases"]} for p in entries}
        for key, alias in [
            ("same_position_repetition", "jacks"),
            ("tap_staircase", "sweeps"),
            ("perimeter_run", "spins"),
            ("direction_reversal", "foldback"),
        ]:
            self.assertIn(alias, aliases["pattern." + key])
        self.assertNotIn("swing", aliases["pattern.gallop_pairs"])
        self.assertNotIn("slide stop", aliases["pattern.variable_slide_wait"])

    def test_missing_capabilities_and_unreadable_shapes_are_unknown(self):
        for name, (body, _) in CASES.items():
            for capability in DEFINITIONS["pattern." + name][0]:
                raw = chart_for(body)
                raw["capabilities"].remove(capability)
                with self.subTest(name=name, capability=capability):
                    self.assertEqual(result(raw, name)["status"], "unknown")
            if "pattern." + name in SHAPE_RULES:
                for path in (None, "opaque:path", "simai:1invalid5"):
                    raw = chart_for(body)
                    raw["slides"][0]["path"] = path
                    self.assertEqual(result(raw, name)["status"], "unknown")

    def test_source_identity_and_gaps_never_create_confident_matches(self):
        for name, (body, _) in CASES.items():
            raw = chart_for(body)
            raw["source"]["identity_status"] = "unresolved"
            self.assertEqual(result(raw, name)["status"], "unknown")
            raw = chart_for(body)
            chart = normalize_chart(raw)
            midpoint = (chart["span_start_us"] + chart["span_end_us"]) // 2
            raw["known_intervals"] = [
                [chart["span_start_us"], midpoint - 1],
                [midpoint + 1, chart["span_end_us"]],
            ]
            self.assertEqual(result(raw, name)["coverage"], "partial")

    def test_chart_identity_is_not_a_song_title_shortcut(self):
        for name, (body, negative) in CASES.items():
            raw = chart_for(body)
            raw.update(chart_id="unrelated-chart", song_id="unrelated-song")
            self.assertEqual(result(raw, name)["status"], "detected")
            raw = chart_for(negative)
            raw.update(chart_id=name, song_id=name)
            self.assertNotEqual(result(raw, name)["status"], "detected")

    def test_touch_geometry_cannot_jump_rings_or_use_simultaneous_inputs(self):
        for body in ("{8}B1,B2,A3,B4,", "{8}B1,B2/C,B3,B4,", "{8}B1,B2,C,B4,"):
            self.assertEqual(result(chart_for(body), "touch_sweep")["occurrence_count"], 0)

    def test_each_motifs_require_authored_simultaneity(self):
        for name in (
            "cycles",
            "slip_flip",
            "future",
            "gekishou",
            "outlaw",
            "different_slide_speeds",
        ):
            raw = chart_for(CASES[name][0])
            for event in raw["onsets"]:
                event["group_id"] = None
            self.assertEqual(result(raw, name)["occurrence_count"], 0)

    def test_slide_waits_use_beats_and_movement_speeds_use_equal_shapes(self):
        self.assertEqual(
            result(chart_for("{4}1-5[4:1],", 30), "extended_slide_wait")["occurrence_count"], 0
        )
        self.assertEqual(
            result(chart_for("{4}1-5[0##0.5],"), "extended_slide_wait")["occurrence_count"], 0
        )
        raw = chart_for(CASES["extended_slide_wait"][0])
        raw["bpm_segments"] = []
        self.assertEqual(result(raw, "extended_slide_wait")["status"], "unknown")
        self.assertEqual(
            result(chart_for("{4}1-5[4:1]/5-7[4:2],"), "different_slide_speeds")[
                "occurrence_count"
            ],
            0,
        )

    def test_arc_notation_has_screen_relative_direction(self):
        for text, direction in [
            ("simai:7<4", -1),
            ("simai:2<7", -1),
            ("simai:5>2", -1),
            ("simai:1>4", 1),
        ]:
            self.assertEqual(arc_direction(path_shape(text)), direction)
        self.assertEqual(path_shape("simai:1-5-1")[1], "connected")

    def test_evidence_retains_slide_paths_and_half_open_spans(self):
        raw = chart_for(CASES["cycles"][0])
        profile = analyze(raw)
        matches = [m for m in profile["occurrences"] if m["pattern_id"] == "pattern.cycles"]
        self.assertEqual(len(matches), 1)
        self.assertEqual(len(matches[0]["path_ids"]), 6)
        self.assertEqual(len(matches[0]["event_ids"]), 6)
        self.assertEqual(matches[0]["end_us"], max(s["movement_end_us"] for s in raw["slides"]))

    def test_button_forms_survive_rotation_reflection_and_tempo_rounding(self):
        for name in (
            "anchored_trill",
            "scattered_taps",
            "hoshizora",
            "gekishou",
            "outlaw",
            "amazing_mightyyy",
        ):
            for bpm in (107, 173, 240):
                original = chart_for(CASES[name][0], bpm)
                for sign, offset in ((1, 3), (-1, 0)):
                    raw = copy.deepcopy(original)
                    for e in raw["onsets"]:
                        e["position"] = (sign * (e["position"] - 1) + offset) % 8 + 1
                    self.assertEqual(result(raw, name)["status"], "detected")
