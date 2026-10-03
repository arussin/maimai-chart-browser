import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from maimai_intelligence.snapshots import read_json
from scripts.build_challenge_package import write
from scripts.prepare_chart_constants import prepare
from tests.lab_fixture import write_package


class ConstantPreparationTests(unittest.TestCase):
    def test_offline_preparation_preserves_inputs_and_only_enriches_navigation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = write_package(root / "source", constants=True)
            legacy = read_json(source / "navigation.json")
            for record in legacy["charts"].values():
                record.pop("chart_constant")
            legacy.pop("constant_basis")
            entry = write(source, "navigation.json", legacy)
            package = read_json(source / "package.json")
            package["files"] = [
                entry if r["path"] == entry["path"] else r for r in package["files"]
            ]
            write(source, "package.json", package)
            original = {p.name: p.read_bytes() for p in source.iterdir()}
            with patch("socket.socket", side_effect=AssertionError("Network forbidden")):
                result = prepare(source, root / "prepared")
            self.assertEqual(result, {"charts": 6, "constants": 5})
            for name, raw in original.items():
                self.assertEqual((source / name).read_bytes(), raw)
                if name not in {"navigation.json", "package.json"}:
                    self.assertEqual((root / "prepared" / name).read_bytes(), raw)
            nav = read_json(root / "prepared/navigation.json")
            expected = [10.5, 10.4, 9.9, 11.0, None, 11.6]
            charts = json.loads(original["catalog.json"])
            for chart, constant in zip(charts, expected, strict=True):
                cid = chart["chart_id"]
                self.assertEqual(nav["charts"][cid].pop("chart_constant"), constant)
                self.assertEqual(nav["charts"][cid], legacy["charts"][cid])
            with self.assertRaisesRegex(ValueError, "fresh"):
                prepare(source, root / "prepared")
            with self.assertRaisesRegex(ValueError, "separate"):
                prepare(source, source)

    def test_corrupt_and_cross_chart_inputs_fail_before_package_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = write_package(root / "source", constants=True)
            inventory = source / "source-inventory.json"
            rows = json.loads(inventory.read_bytes())
            rows[0]["body_sha256"] = "f" * 64
            inventory.write_text(json.dumps(rows), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "integrity"):
                prepare(source, root / "corrupt")
            self.assertFalse((root / "corrupt").exists())
            package = read_json(source / "package.json")
            entry = write(source, "source-inventory.json", rows)
            package["files"] = [
                entry if r["path"] == entry["path"] else r for r in package["files"]
            ]
            write(source, "package.json", package)
            with self.assertRaisesRegex(ValueError, "exact"):
                prepare(source, root / "wrong-chart")
            self.assertFalse((root / "wrong-chart/package.json").exists())

    def test_interrupted_write_does_not_publish_a_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = write_package(root / "source")
            with patch(
                "maimai_intelligence.source_preparation.prepare_chart_constants.write",
                side_effect=OSError("Interrupted"),
            ):
                with self.assertRaises(OSError):
                    prepare(source, root / "interrupted")
            self.assertFalse((root / "interrupted/package.json").exists())
