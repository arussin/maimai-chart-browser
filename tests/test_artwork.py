import copy
import json
import tempfile
import unittest
from pathlib import Path

from maimai_intelligence.artwork import match_jackets, validate_artwork
from maimai_intelligence.lab import build_lab
from tests.artwork_fixture import add_artwork
from tests.lab_fixture import write_package


class ArtworkTests(unittest.TestCase):
    def test_exact_unique_title_and_artist_only(self):
        chart = {"song_id": "one", "title": "Ｓong  Name", "artist": "Artist"}
        catalogue = [{"title": "song name", "artist": "artist", "image_url": "jacket.png"}]
        self.assertEqual(match_jackets([chart], catalogue)["one"]["filename"], "jacket.png")
        self.assertEqual(match_jackets([{**chart, "artist": ""}], catalogue), {})
        self.assertEqual(match_jackets([{**chart, "title": "song nam"}], catalogue), {})
        self.assertEqual(match_jackets([chart, {**chart, "artist": "Other"}], catalogue), {})
        self.assertEqual(
            match_jackets([chart], catalogue + [{**catalogue[0], "image_url": "other.png"}]), {}
        )
        self.assertEqual(match_jackets([chart], [{**catalogue[0], "image_url": "../evil.png"}]), {})

    def test_local_assets_are_verified_and_bound_to_song_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = write_package(root / "package")
            art = add_artwork(source)
            catalog = json.loads((source / "catalog.json").read_text("utf-8"))
            versions = ["maimai DX PRiSM PLUS"]
            validate_artwork(art, catalog, versions)
            wrong = copy.deepcopy(art)
            next(iter(wrong["songs"].values()))["artist"] = "Other"
            with self.assertRaisesRegex(ValueError, "identity"):
                validate_artwork(wrong, catalog, versions)
            wrong = copy.deepcopy(art)
            wrong["assets"]["../image.webp"] = next(iter(art["assets"].values()))
            with self.assertRaisesRegex(ValueError, "asset"):
                validate_artwork(wrong, catalog, versions)
            with self.assertRaisesRegex(ValueError, "version"):
                validate_artwork(art, catalog, [])
            page = build_lab(source, root / "site", catalog_version="artwork-v1")
            html = page.read_text("utf-8")
            self.assertTrue((root / "site/version-magical.png").read_bytes().startswith(b"\x89PNG"))
            self.assertIn("img-src 'self' data:", html)
            path = next(iter(art["assets"]))
            self.assertEqual((root / "site" / path).read_bytes(), (source / path).read_bytes())
            (source / path).write_bytes(b"interrupted")
            with self.assertRaisesRegex(ValueError, "integrity"):
                build_lab(source, root / "site", catalog_version="broken")
            manifest = json.loads((root / "site/manifest.json").read_text("utf-8"))
            self.assertEqual(manifest["default"], "artwork-v1")
            self.assertEqual(len(manifest["releases"]), 1)
