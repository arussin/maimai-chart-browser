import tempfile
import unittest
from pathlib import Path

from maimai_intelligence.lab import build_lab
from tests.lab_fixture import write_package


class LabTests(unittest.TestCase):
    def test_preserves_interface_but_externalizes_versioned_research_data(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = write_package(root / "package")
            result = build_lab(source, root / "site", catalog_version="fixture-v1")
            html = result.read_text("utf-8")
            self.assertIn('id="browse-genre"', html)
            self.assertIn('id="browse-version"', html)
            self.assertIn('id="sort-level"', html)
            self.assertNotIn('id="challenge-data"', html)
            self.assertTrue((root / "site/manifest.json").exists())
            (source / "catalog.json").write_text("[]", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "integrity"):
                build_lab(source, root / "site", catalog_version="fixture-v2")
