import copy
import json
import tempfile
import unittest
from importlib.resources import files
from pathlib import Path

from maimai_intelligence.artwork import match_jackets, prepare_artwork, validate_artwork
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
            validate_artwork(art, catalog, [])
            wrong = copy.deepcopy(art)
            wrong["versions"]["Unlisted release"] = next(iter(art["assets"]))
            with self.assertRaisesRegex(ValueError, "version"):
                validate_artwork(wrong, catalog, versions)
            page = build_lab(source, root / "site", catalog_version="artwork-v1")
            html = page.read_text("utf-8")
            self.assertFalse((root / "site/version-magical.png").exists())
            self.assertIn("img-src 'self' data:", html)
            path = next(iter(art["assets"]))
            self.assertEqual((root / "site" / path).read_bytes(), (source / path).read_bytes())
            (source / path).write_bytes(b"interrupted")
            with self.assertRaisesRegex(ValueError, "integrity"):
                build_lab(source, root / "site", catalog_version="broken")
            manifest = json.loads((root / "site/manifest.json").read_text("utf-8"))
            self.assertEqual(manifest["default"], "artwork-v1")
            self.assertEqual(len(manifest["releases"]), 1)

    def test_all_bundled_release_logos_are_available_without_catalog_membership(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            navigation_versions = []
            artwork = prepare_artwork(None, None, root, [], navigation_versions)
            self.assertEqual(len(artwork["versions"]), 28)
            self.assertIn("maimai", artwork["versions"])
            self.assertIn("maimai DX MAGiCAL", artwork["versions"])
            self.assertEqual(navigation_versions, [])
            self.assertEqual(artwork["songs"], {})
            for path in artwork["versions"].values():
                self.assertTrue((root / path).is_file())
                self.assertEqual((root / path).stat().st_size, artwork["assets"][path]["bytes"])
            # Lock the reviewed larger originals/crops, including the bounded BUDDiES resize.
            expected_sizes = {
                "maimai": (499, 69),
                "maimai PLUS": (500, 91),
                "maimai GreeN": (640, 150),
                "maimai GreeN PLUS": (640, 135),
                "maimai ORANGE": (747, 200),
                "maimai ORANGE PLUS": (747, 219),
                "maimai PiNK": (416, 117),
                "maimai PiNK PLUS": (500, 133),
                "maimai MURASAKi": (405, 174),
                "maimai MURASAKi PLUS": (576, 215),
                "maimai MiLK": (354, 320),
                "maimai MiLK PLUS": (400, 301),
                "maimai FiNALE": (552, 224),
                "maimai DX": (398, 147),
                "maimai DX PLUS": (450, 177),
                "maimai DX Splash": (420, 166),
                "maimai DX Splash PLUS": (621, 247),
                "maimai DX UNiVERSE": (416, 196),
                "maimai DX UNiVERSE PLUS": (512, 260),
                "maimai DX FESTiVAL": (689, 301),
                "maimai DX FESTiVAL PLUS": (973, 475),
                "maimai DX BUDDiES": (800, 458),
                "maimai DX BUDDiES PLUS": (858, 433),
                "maimai DX PRiSM": (748, 350),
                "maimai DX PRiSM PLUS": (800, 315),
                "maimai DX CiRCLE": (799, 357),
                "maimai DX CiRCLE PLUS": (801, 375),
                "maimai DX MAGiCAL": (558, 341),
            }
            self.assertEqual(set(expected_sizes), set(artwork["versions"]))
            for version, dimensions in expected_sizes.items():
                path = artwork["versions"][version]
                asset = artwork["assets"][path]
                raw = (root / path).read_bytes()
                self.assertEqual(raw[12:16], b"VP8L")
                self.assertEqual(raw[20], 0x2F)
                # The lossless WebP header stores each dimension minus one in 14 bits.
                bits = int.from_bytes(raw[21:25], "little")
                self.assertEqual((1 + (bits & 0x3FFF), 1 + ((bits >> 14) & 0x3FFF)), dimensions)
                self.assertEqual((asset["width"], asset["height"]), dimensions)
                # GreeN PLUS intentionally retains its original opaque branded backing.
                self.assertEqual((bits >> 28) & 1, int(version != "maimai GreeN PLUS"))
            validate_artwork(artwork, [], [])

    def test_all_release_logos_preserve_supplied_artwork_and_catalog_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = write_package(root / "package")
            supplied = add_artwork(source)
            catalog = json.loads((source / "catalog.json").read_text("utf-8"))
            versions = ["maimai DX PRiSM PLUS"]
            original = copy.deepcopy((supplied, catalog, versions))
            artwork = prepare_artwork(supplied, source, root / "prepared", catalog, versions)
            self.assertEqual(len(artwork["versions"]), 28)
            self.assertEqual(artwork["songs"], supplied["songs"])
            self.assertEqual(
                artwork["versions"]["maimai DX PRiSM PLUS"],
                supplied["versions"]["maimai DX PRiSM PLUS"],
            )
            bundled = json.loads(
                files("maimai_intelligence.assets")
                .joinpath("version-artwork", "manifest.json")
                .read_text("utf-8")
            )
            for path in bundled["versions"].values():
                self.assertIn(path, artwork["assets"])
                self.assertTrue((root / "prepared" / path).is_file())
            self.assertEqual((supplied, catalog, versions), original)
