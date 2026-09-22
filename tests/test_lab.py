import hashlib
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
                config = (site / "player-import-config.js").read_text("utf-8")
                self.assertIn("maishift:" + str(enabled).lower(), config)
                self.assertNotIn("maimaiPlayerContext", config)
                self.assertNotIn('src="maishift-browser-pilot.js', html)
                self.assertIn('src="feature-announcements.js', html)
                self.assertIn('src="player-ranges.js', html)
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
            scripts = (root / "site/challenge-review.js").read_bytes()
            loader = (root / "site/lab-loader.js").read_bytes()
            self.assertIn(
                "challenge-review.js?v=" + hashlib.sha256(scripts).hexdigest()[:16],
                loader.decode("utf-8"),
            )
            self.assertIn("lab-loader.js?v=" + hashlib.sha256(loader).hexdigest()[:16], html)
            (source / "catalog.json").write_text("[]", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "integrity"):
                build_lab(source, root / "site", catalog_version="fixture-v2")
