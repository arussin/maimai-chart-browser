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
    LEGACY_PATTERNS,
    PATTERNS,
    chart_overview,
    overview_package,
    validate_overview,
)
from scripts.analyze_simai_corpus import SourceFailure, _relative
from scripts.build_challenge_package import write
from scripts.build_research_overview import build


class ResearchOverviewTests(unittest.TestCase):
    def test_source_root_alias_is_resolved_without_allowing_path_escape(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "parent" / ".." / "source"
            (Path(directory) / "parent").mkdir()
            root.mkdir()
            self.assertEqual(_relative(root, "catalog.json"), root.resolve() / "catalog.json")
            with self.assertRaises(SourceFailure):
                _relative(root, "../personal.json")

    def test_previous_catalog_versions_remain_readable(self):
        chart = synthetic_charts()[0]
        value = overview_package({chart["chart_id"]: chart_overview(chart)})
        record = value["charts"][chart["chart_id"]]
        record["tags"] = [
            [LEGACY_PATTERNS.index(PATTERNS[t[0]]), *t[1:7]]
            for t in record["tags"]
            if PATTERNS[t[0]] in LEGACY_PATTERNS
        ]
        value.update(version="research-overview-1", patterns=LEGACY_PATTERNS)
        self.assertIs(validate_overview(value, [profile_chart(chart)]), value)

    def test_release_retains_rule_versions_and_target_specific_evidence(self):
        chart = synthetic_charts()[0]
        value = overview_package({chart["chart_id"]: chart_overview(chart)})
        self.assertEqual(set(value["definitions"]), set(PATTERNS))
        self.assertEqual(value["detector_version"], "0.2.0")
        tag = next(
            t
            for t in value["charts"][chart["chart_id"]]["tags"]
            if PATTERNS[t[0]] == "trait.isolated_pattern_sections"
        )
        self.assertEqual(len(tag[6]), len(tag[7]))
        self.assertIn("pattern.two_position_alternation", [e["target_pattern_id"] for e in tag[7]])

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
                self.assertIn("pattern.umiyuri", PATTERNS)

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
