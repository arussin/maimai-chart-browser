"""Teaching examples are bounded, reproducible and retain meaningful contrasts."""

import json
import math
import unittest
from importlib.resources import files

from maimai_analyzer.pattern_evidence import phased_pairs
from maimai_analyzer.patterns import pattern_registry
from scripts.build_pattern_lessons import build_lessons
from tests.test_simai_subset import parse


class PatternLessonTests(unittest.TestCase):
    def setUp(self):
        self.book = json.loads(
            files("maimai_intelligence.assets").joinpath("pattern-lessons.json").read_text("utf-8")
        )
        self.lessons = self.book["lessons"]

    def test_complete_reproducible_authored_reference(self):
        self.assertEqual(self.book, build_lessons())
        self.assertEqual(
            set(self.lessons), {p["pattern_id"] for p in pattern_registry()["entries"]}
        )
        for lesson in self.lessons.values():
            for field in ("summary", "watch", "contrast", "variants", "scope"):
                self.assertTrue(lesson[field].strip())
            self.assertNotEqual(lesson["example"], lesson["counterexample"])
            self.assertEqual(lesson["example"]["duration"], lesson["counterexample"]["duration"])
            for model in (lesson["example"], lesson["counterexample"]):
                self.assertTrue(0 < model["duration"] <= 16)
                for start, end, label in model["bands"]:
                    self.assertTrue(0 <= start < end <= model["duration"])
                    self.assertTrue(label)
                if model["kind"] == "bars":
                    for series in model["series"]:
                        self.assertEqual(len(series["values"]), model["duration"])
                        self.assertTrue(all(math.isfinite(v) and v >= 0 for v in series["values"]))
                else:
                    self.assertEqual(len(model["notes"]), len({tuple(n) for n in model["notes"]}))
                    for time, position, role in model["notes"]:
                        self.assertTrue(0 <= time <= model["duration"])
                        self.assertIn(role, ("tap", "star", "hold", "touch"))
                        self.assertTrue(
                            type(position) is int
                            and 1 <= position <= 8
                            or position == "C"
                            or isinstance(position, str)
                            and len(position) == 2
                            and position[0] in "ABDE"
                            and position[1] in "12345678"
                        )
                    for head, start, end, path in model["slides"]:
                        self.assertTrue(0 <= head <= start < end <= model["duration"])
                        self.assertIn([head, path[0], "star"], model["notes"])
                        self.assertTrue(all(type(p) is int and 1 <= p <= 8 for p in path))
                    for start, end, position in model["holds"]:
                        self.assertTrue(0 <= start < end <= model["duration"])
                        self.assertIn([start, position, "hold"], model["notes"])
                    for path in model.get("slide_points", []):
                        self.assertGreaterEqual(len(path), 2)
                        self.assertTrue(
                            all(
                                len(p) == 2 and all(math.isfinite(x) and abs(x) <= 1 for x in p)
                                for p in path
                            )
                        )

    def test_community_illustrations_match_the_stated_forms(self):
        from maimai_analyzer.core import analyze_overview
        from scripts.community_pattern_lessons import LESSONS

        for key, values in LESSONS.items():
            for body, expected in [
                (values[-2], "detected"),
                (values[-1], "not-detected-with-supported-coverage"),
            ]:
                chart, _ = parse("(120)" + body + "E")
                actual = next(
                    t
                    for t in analyze_overview(chart)["tags"]
                    if t["pattern_id"] == "pattern." + key
                )
                with self.subTest(pattern=key, expected=expected):
                    self.assertEqual(actual["status"], expected)

    def test_timing_contrasts_keep_the_claimed_phase_distinctions(self):
        lessons = self.lessons
        fan = lessons["pattern.same_head_slide_fan"]["example"]
        self.assertEqual(sum(n[2] == "star" for n in fan["notes"]), 1)
        self.assertEqual(len(fan["slides"]), 2)
        for key, waiting in [("delayed_slide_interleave", True), ("slide_tap_interleave", False)]:
            for kind in ("example", "counterexample"):
                model = lessons["pattern." + key][kind]
                head, start, end, _ = model["slides"][0]
                tap_times = [n[0] for n in model["notes"] if n[2] == "tap"]
                expected_wait = waiting if kind == "example" else not waiting
                self.assertTrue(
                    all(head < t < start if expected_wait else start < t < end for t in tap_times)
                )
        burst = lessons["pattern.three_note_burst"]["example"]["notes"]
        self.assertGreater(burst[3][0] - burst[2][0], burst[1][0] - burst[0][0])
        triplet = lessons["pattern.triplet_grid"]["example"]["notes"]
        self.assertTrue(
            all(abs(b[0] - a[0] - 1 / 3) < 1e-9 for a, b in zip(triplet, triplet[1:], strict=False))
        )
        for kind in ("example", "counterexample"):
            series = lessons["trait.break_concentration"][kind]["series"]
            self.assertEqual(sum(series[1]["values"]), 12)
            self.assertTrue(
                all(b <= a for a, b in zip(series[0]["values"], series[1]["values"], strict=True))
            )

    def test_umiyuri_illustration_matches_the_narrow_research_grammar(self):
        body = "(120){8},8-4[8:1]/1,7,1-5[8:1]/8,2,8-4[8:1]/1,7,1-5[8:1]/8,2,E"
        chart, _ = parse(body)
        result = phased_pairs(chart)
        self.assertEqual(len(result["occurrences"]), 1)
        self.assertFalse(result["automatic_community_tagging"])
        model = self.lessons["pattern.umiyuri"]["example"]
        actual = sorted(
            (e["time_us"] / 500000, e["position"], "star" if e["role"] == "star_tap" else "tap")
            for e in chart["onsets"]
        )
        self.assertEqual(actual, sorted(tuple(n) for n in model["notes"]))
        self.assertEqual(
            [
                (
                    s["wait_start_us"] / 500000,
                    s["movement_start_us"] / 500000,
                    s["movement_end_us"] / 500000,
                )
                for s in chart["slides"]
            ],
            [tuple(s[:3]) for s in model["slides"]],
        )
        entry = next(
            p for p in pattern_registry()["entries"] if p["pattern_id"] == "pattern.umiyuri"
        )
        self.assertTrue(entry["automatic_tagging_enabled"])
        self.assertEqual(entry["detector_status"], "experimental")
        self.assertIsNone(entry["reviewer"])
