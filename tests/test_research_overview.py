import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from maimai_analyzer.challenge import profile_chart
from maimai_analyzer.core import analyze, analyze_overview
from maimai_analyzer.dataset import SOURCE_LOCK
from maimai_analyzer.fixtures import synthetic_charts
from maimai_intelligence.research_overview import (
    PATTERNS,
    chart_overview,
    overview_package,
    validate_overview,
)
from scripts.build_challenge_package import write
from scripts.build_research_overview import build


class ResearchOverviewTests(unittest.TestCase):
    def test_interrupted_preparation_resumes_and_rejects_corrupt_cache(self):
        charts = synthetic_charts()[:2]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, package, output = (root / name for name in ("source", "package", "output"))
            source.mkdir()
            catalog = [{**profile_chart(c), "input_id": str(i)} for i, c in enumerate(charts)]
            entries = [
                write(package, "catalog.json", catalog),
                write(package, "source-inventory.json", [{"input_id": "0"}, {"input_id": "1"}]),
            ]
            write(
                package,
                "package.json",
                {"source": SOURCE_LOCK, "status": "research_preview", "files": entries},
            )
            retained = (package / "package.json").read_bytes()
            with patch(
                "scripts.build_research_overview.parse_row",
                side_effect=[(charts[0], {}), RuntimeError("Interrupted")],
            ):
                with self.assertRaisesRegex(RuntimeError, "Interrupted"):
                    build(source, package, output)
            self.assertFalse((output / "package.json").exists())
            with patch(
                "scripts.build_research_overview.parse_row", return_value=(charts[1], {})
            ) as parse:
                self.assertEqual(build(source, package, output)["charts"], 2)
                self.assertEqual(parse.call_count, 1)
            self.assertEqual((package / "package.json").read_bytes(), retained)
            published = (output / "package.json").read_bytes()
            cache = next((output / "overview-cache").glob("*.json"))
            envelope = json.loads(cache.read_text())
            envelope["hash"] = "wrong"
            cache.write_text(json.dumps(envelope))
            with self.assertRaisesRegex(ValueError, "cache integrity"):
                build(source, package, output)
            self.assertEqual((output / "package.json").read_bytes(), published)

    def test_lightweight_overview_preserves_engine_flow_and_tags(self):
        for chart in synthetic_charts():
            with self.subTest(chart=chart["chart_id"]):
                full, overview = analyze(chart), analyze_overview(chart)
                self.assertEqual(full["flow"], overview["flow"])
                self.assertEqual(full["tags"], overview["tags"])
                packed = chart_overview(chart)
                self.assertEqual(packed["source_hash"], profile_chart(chart)["source_hash"])
                self.assertEqual(len(packed["segments"]), len(full["flow"]["segments"]))
                for tag in packed["tags"]:
                    original = next(t for t in full["tags"] if t["pattern_id"] == PATTERNS[tag[0]])
                    self.assertEqual(
                        tag[1:6],
                        [
                            original[k]
                            for k in (
                                "status",
                                "occurrence_count",
                                "prevalence",
                                "coverage",
                                "occurrences_truncated",
                            )
                        ],
                    )
                self.assertNotIn("pattern.umiyuri", PATTERNS)

    def test_exact_chart_and_source_join_rejects_mismatches(self):
        chart = synthetic_charts()[0]
        catalog = [profile_chart(chart)]
        value = overview_package({chart["chart_id"]: chart_overview(chart)})
        self.assertIs(validate_overview(value, catalog), value)
        for key, replacement in [("version", "future"), ("patterns", ["pattern.umiyuri"])]:
            bad = copy.deepcopy(value)
            bad[key] = replacement
            with self.assertRaises(ValueError):
                validate_overview(bad, catalog)
        bad = copy.deepcopy(value)
        bad["charts"][chart["chart_id"]]["source_hash"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "identity"):
            validate_overview(bad, catalog)
        with self.assertRaisesRegex(ValueError, "identity"):
            validate_overview(value, [])
