import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from maimai_intelligence.lab import build_lab
from tests.lab_fixture import write_package


class LabTests(unittest.TestCase):
    def test_maishift_capability_does_not_enable_pilot_storage(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = write_package(root / "package")
            for enabled in (False, True):
                site = root / str(enabled)
                html = build_lab(
                    source, site, catalog_version="fixture-v1", player_maishift=enabled
                ).read_text("utf-8")
                config = json.loads((site / "browser-config.json").read_text("utf-8"))
                self.assertEqual(config["features"]["maishift"], enabled)
                self.assertFalse(config["pilot"])
                self.assertNotIn('src="maishift-browser-pilot.js', html)
                graph = json.loads((site / "browser-assets.json").read_text("utf-8"))
                self.assertIn(
                    'type="module" data-maimai-browser src="' + graph["entries"]["hosted"], html
                )
                self.assertNotIn('id="loaded-count"', html)
                self.assertIn('class="catalog-heading-actions"', html)

    def test_chart_filters_dictionary_and_versioned_research_data(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = write_package(root / "package")
            result = build_lab(source, root / "site", catalog_version="fixture-v1")
            html = result.read_text("utf-8")
            self.assertIn('id="filter-genre"', html)
            self.assertIn('id="version-options"', html)
            self.assertIn('id="sort-rules"', html)
            self.assertIn('id="pattern-data"', html)
            self.assertIn("pattern.umiyuri", html)
            self.assertNotIn("Recommendation samples", html)
            self.assertNotIn('id="challenge-data"', html)
            self.assertTrue((root / "site/manifest.json").exists())
            config = json.loads((root / "site/browser-config.json").read_text("utf-8"))
            self.assertFalse(config["features"]["maishift"])
            self.assertFalse(config["pilot"])
            graph = json.loads((root / "site/browser-assets.json").read_text("utf-8"))
            self.assertIn(
                'type="module" data-maimai-browser src="' + graph["entries"]["hosted"], html
            )
            for path, reference in graph["assets"].items():
                body = (root / "site" / path).read_bytes()
                self.assertEqual(hashlib.sha256(body).hexdigest(), reference["sha256"])
                self.assertEqual(len(body), reference["bytes"])
            shell = (root / "site/browser-shell.html").read_text("utf-8")
            self.assertIn("<template data-browser-shell>", shell)
            self.assertNotIn("<script src=", shell)
            (source / "catalog.json").write_text("[]", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "integrity"):
                build_lab(source, root / "site", catalog_version="fixture-v2")
