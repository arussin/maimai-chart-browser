import copy
import hashlib
import io
import tempfile
import unittest
from importlib.resources import files
from pathlib import Path

from PIL import Image

from maimai_intelligence.artwork import validate_artwork
from maimai_intelligence.export_artwork import (
    _assets,
    copy_export_artwork,
    read_export_artwork_assets,
    read_export_artwork_manifest,
)


def export_fixture(root):
    image = Image.new("RGB", (400, 400), (25, 70, 120))
    stream = io.BytesIO()
    image.save(stream, "WEBP", lossless=True)
    raw = stream.getvalue()
    digest = hashlib.sha256(raw).hexdigest()
    path = f"media/{digest}.webp"
    root = Path(root)
    (root / "media").mkdir(parents=True, exist_ok=True)
    (root / path).write_bytes(raw)
    manifest = {
        "version": "score-export-jackets-2",
        "jackets": {
            "song:11111111-1111-1111-1111-111111111111/JP": {
                "title": "Fixture",
                "artist": "Artist",
                "thumbnail": None,
                "path": path,
            },
        },
        "assets": {path: {"sha256": digest, "bytes": len(raw), "width": 400, "height": 400}},
    }
    return manifest, path, raw


class ExportArtworkTests(unittest.TestCase):
    def test_packaged_manifest_has_larger_art_but_no_whole_corpus_binary_dependency(self):
        bundle = files("maimai_intelligence.assets").joinpath("export-artwork")
        for entry in bundle.iterdir():
            if entry.name != "manifest.json":
                self.assertTrue(entry.is_dir())
                self.assertEqual(list(entry.iterdir()), [])
        manifest = read_export_artwork_manifest()
        assets = _assets(manifest)
        self.assertGreaterEqual(len(assets), 47)
        self.assertTrue(all(a["width"] > 128 and a["height"] > 128 for a in assets.values()))
        path, asset = next(iter(assets.items()))
        with self.assertRaisesRegex(ValueError, "Invalid public artwork asset"):
            validate_artwork(
                {
                    "version": "public-artwork-1",
                    "songs": {},
                    "versions": {},
                    "assets": {path: {**asset, "bytes": 256 * 1024 + 1}},
                },
                [],
                [],
            )

    def test_export_verification_rejects_tampering_and_invalid_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest, path, raw = export_fixture(root)
            self.assertEqual(read_export_artwork_assets(root, manifest=manifest), {path: raw})
            for key, value in (("bytes", 512 * 1024 + 1), ("width", 513), ("width", 399)):
                altered = copy.deepcopy(manifest)
                altered["assets"][path][key] = value
                with self.assertRaisesRegex(ValueError, "Export artwork|Invalid export artwork"):
                    read_export_artwork_assets(root, manifest=altered)
            for mutate in (
                lambda m: m["jackets"].update(
                    {
                        "song:11111111-1111-1111-1111-111111111111/CN": next(
                            iter(m["jackets"].values())
                        )
                    }
                ),
                lambda m: next(iter(m["jackets"].values())).update(path="../unreviewed.webp"),
                lambda m: next(iter(m["jackets"].values())).update(
                    thumbnail="https://example.com/art.webp"
                ),
            ):
                altered = copy.deepcopy(manifest)
                mutate(altered)
                with self.assertRaisesRegex(ValueError, "selection"):
                    read_export_artwork_assets(root, manifest=altered)
            (root / path).write_bytes(b"tampered")
            with self.assertRaisesRegex(ValueError, "integrity"):
                read_export_artwork_assets(root, manifest=manifest)

    def test_demo_copy_requires_explicit_subset_and_preserves_existing_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest, path, raw = export_fixture(root / "input")
            output = root / "demo"
            (root / "input/private.json").write_text("private retained data")
            copy_export_artwork(root / "input", output, paths={path}, manifest=manifest)
            self.assertEqual((output / path).read_bytes(), raw)
            self.assertFalse((output / "private.json").exists())
            self.assertEqual(
                read_export_artwork_assets(root / "input", paths=set(), manifest=manifest), {}
            )
            with self.assertRaisesRegex(ValueError, "Unreviewed"):
                copy_export_artwork(
                    root / "input", output, paths={"private.json"}, manifest=manifest
                )
            (output / path).write_bytes(b"existing")
            with self.assertRaisesRegex(ValueError, "Immutable"):
                copy_export_artwork(root / "input", output, paths={path}, manifest=manifest)
            self.assertEqual((output / path).read_bytes(), b"existing")
            (output / path).write_bytes(raw + b"x" * (512 * 1024))
            with self.assertRaisesRegex(ValueError, "Immutable"):
                copy_export_artwork(root / "input", output, paths={path}, manifest=manifest)
