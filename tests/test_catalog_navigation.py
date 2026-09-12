"""Authored source controls for browsing metadata, independent of scoring."""

import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from maimai_analyzer.catalog_navigation import build_navigation, source_bpm, source_constant


class NavigationTests(unittest.TestCase):
    def test_decimal_constants_are_retained_without_label_fallback(self):
        charts, rows = self.fixture()
        for value, expected in [("10.4", 10.4), ("10.5", 10.5), ("10.0", 10.0), ("15", 15.0)]:
            self.assertEqual(source_constant(value), expected)
            result = build_navigation(charts, [{**rows[0], "source_level": value}])
            self.assertEqual(result["charts"]["chart:1"]["chart_constant"], expected)
            self.assertNotIn("constant", charts[0])
        for value in (None, "", "10+", "NaN", "10.45", "0", "15.1", "-1", True, 10.4):
            self.assertIsNone(source_constant(value))
        result = build_navigation(charts, [{**rows[0], "level": "10+"}])
        self.assertIsNone(result["charts"]["chart:1"]["chart_constant"])

    def test_source_song_bpm_is_explicit_metadata_not_a_note_override(self):
        self.assertEqual(source_bpm("&wholebpm=128.5\n&inote_5=(180){4}1-5[240#4:1],E"), 128.5)
        for text in (
            "&inote_5=(180){4}1,E",
            "&wholebpm=NaN",
            "&wholebpm=0",
            "&wholebpm=2001",
            "&wholebpm=120\n&wholebpm=160",
        ):
            self.assertIsNone(source_bpm(text))
        charts, rows = self.fixture()
        rows[0]["source_raw_sha256"] = "c" * 64
        result = build_navigation(charts, rows, bpm_by_source={"c" * 64: 128.5})
        self.assertEqual(result["charts"]["chart:1"]["bpm"], 128.5)
        self.assertIsNone(build_navigation(charts, rows)["charts"]["chart:1"]["bpm"])

    def fixture(self):
        charts = [
            {
                "chart_id": "chart:1",
                "input_id": "input:1",
                "source_hash": "a" * 64,
                "source_container_id": "1",
                "format": "DX",
                "difficulty": "MASTER",
            }
        ]
        rows = [
            {
                "input_id": "input:1",
                "body_sha256": "a" * 64,
                "source_container_id": "1",
                "format": "DX",
                "difficulty": "MASTER",
                "identity_resolved": True,
                "source_path": "POPSアニメ/1/maidata.txt",
                "source_version": "maimai DX PRiSM PLUS",
            }
        ]
        return charts, rows

    def test_exact_metadata_join_does_not_mutate_chart(self):
        charts, rows = self.fixture()
        before = copy.deepcopy(charts)
        result = build_navigation(charts, rows)
        self.assertEqual(result["charts"]["chart:1"]["genre"], "POPSアニメ")
        self.assertEqual(result["versions"], ["maimai DX PRiSM PLUS"])
        self.assertEqual(charts, before)
        for key, value in [
            ("body_sha256", "b" * 64),
            ("difficulty", "EXPERT"),
            ("format", "STD"),
            ("source_container_id", "9"),
        ]:
            with self.subTest(field=key), self.assertRaises(ValueError):
                build_navigation(charts, [{**rows[0], key: value}])
        with self.assertRaises(ValueError):
            build_navigation(charts, rows + rows)

    def test_unknown_metadata_is_not_guessed_and_versions_are_chronological(self):
        charts, rows = self.fixture()
        for i, version in enumerate(["maimai", "maimai DX PRiSM", "Future label", ""], 2):
            charts.append({**charts[0], "chart_id": f"chart:{i}", "input_id": f"input:{i}"})
            rows.append(
                {
                    **rows[0],
                    "input_id": f"input:{i}",
                    "source_version": version,
                    "source_path": "Unrecognized/1/maidata.txt",
                }
            )
        result = build_navigation(charts, rows)
        self.assertEqual(
            result["versions"],
            ["maimai DX PRiSM PLUS", "maimai DX PRiSM", "maimai", "Future label", "unknown"],
        )
        self.assertEqual(result["coverage"]["genres"]["unknown"], 4)
        self.assertEqual(result, build_navigation(list(reversed(charts)), list(reversed(rows))))

    def test_refresh_is_offline_repeatable_and_preserves_analysis(self):
        from test_maichart_pack import REVISION, fixture

        from scripts import build_challenge_package as builder
        from scripts.prepare_maichart_pack import prepare
        from scripts.refresh_challenge_navigation import refresh

        with tempfile.TemporaryDirectory() as directory:
            root, output = Path(directory) / "source", Path(directory) / "package"
            root.mkdir()
            fixture(root)
            prepare(root)
            with patch.dict(builder.SOURCE_LOCK, {"revision": REVISION}):
                with patch("socket.socket", side_effect=AssertionError("Network forbidden")):
                    package = builder.build(root, output, review_count=0)
                    protected = {
                        x["path"]: (output / x["path"]).read_bytes()
                        for x in package["files"]
                        if x["path"] != "navigation.json"
                    }
                    coverage = refresh(root, output)
                    once = (output / "package.json").read_bytes()
                    self.assertEqual(coverage, refresh(root, output))
                    self.assertEqual(once, (output / "package.json").read_bytes())
                    self.assertEqual(coverage["charts"], 1)
                    for name, content in protected.items():
                        self.assertEqual((output / name).read_bytes(), content)
                    (output / "benchmark.json").write_text(json.dumps({"changed": True}))
                    with self.assertRaises(ValueError):
                        refresh(root, output)


if __name__ == "__main__":
    unittest.main()
