"""Small authored images exercise both artwork decoders without network access."""

import io
import struct
import unittest
from unittest.mock import patch

from PIL import Image, UnidentifiedImageError

from maimai_intelligence.artwork_store import thumbnail
from maimai_intelligence.coverage import CONFIG
from scripts.prepare_public_artwork import thumbnail as public_thumbnail


def encoded_image(format, mode="RGB", size=(256, 192)):
    stream = io.BytesIO()
    color = (25, 70, 120, 96) if mode == "RGBA" else (25, 70, 120)
    with Image.new(mode, size, color) as image:
        image.save(stream, format)
    return stream.getvalue()


def lossless_jpeg():
    """Author a 256x192 SOF3 grayscale JPEG, predictor 1, constant value 128.

    The single Huffman code is zero (category 0, no difference bits). Each
    sample therefore reproduces its predictor; no external fixture is needed.
    """

    def segment(marker, data):
        return b"\xff" + bytes([marker]) + struct.pack(">H", len(data) + 2) + data

    table = b"\x00\x01" + b"\x00" * 15 + b"\x00"
    frame = struct.pack(">BHHB", 8, 192, 256, 1) + b"\x01\x11\x00"
    scan = b"\x01\x01\x00\x01\x00\x00"
    return (
        b"\xff\xd8"
        + segment(0xC4, table)
        + segment(0xC3, frame)
        + segment(0xDA, scan)
        + b"\x00" * (256 * 192 // 8)
        + b"\xff\xd9"
    )


class ArtworkConversionTests(unittest.TestCase):
    def converters(self):
        return (
            ("catalog", lambda raw: thumbnail(raw, CONFIG)[0], (128, 96)),
            ("public-jacket", public_thumbnail, (128, 96)),
            ("public-logo", lambda raw: public_thumbnail(raw, logo=True), (117, 88)),
        )

    def assert_webp(self, raw, size, alpha=False):
        self.assertLessEqual(len(raw), 256 * 1024)
        with Image.open(io.BytesIO(raw)) as image:
            self.assertEqual(image.format, "WEBP")
            image.load()
            self.assertEqual(image.size, size)
            self.assertEqual(image.mode, "RGBA" if alpha else "RGB")
            if alpha:
                self.assertEqual(image.getextrema()[3], (96, 96))

    def test_supported_formats_dimensions_and_transparency(self):
        for format, mode in (
            ("PNG", "RGB"),
            ("PNG", "RGBA"),
            ("JPEG", "RGB"),
            ("WEBP", "RGB"),
            ("WEBP", "RGBA"),
        ):
            raw = encoded_image(format, mode)
            self.assertEqual(thumbnail(raw, CONFIG)[1], {"width": 256, "height": 192})
            for name, convert, size in self.converters():
                with self.subTest(format=format, mode=mode, converter=name):
                    self.assert_webp(convert(raw), size, name == "public-logo" and mode == "RGBA")

    def test_lossless_jpeg_decodes_before_downsampling(self):
        raw = lossless_jpeg()
        with Image.open(io.BytesIO(raw)) as image:
            self.assertEqual(image.format, "JPEG")
            image.load()
            self.assertEqual(image.size, (256, 192))
            self.assertEqual(image.getextrema(), (128, 128))
        original = Image.Image.thumbnail
        for name, convert, size in self.converters():
            with self.subTest(converter=name):

                def loaded_thumbnail(image, *args, **kwargs):
                    # Empty decoder tiles prove load() finished before thumbnail;
                    # draft() may still be called, but is then a harmless no-op.
                    self.assertEqual(image.tile, [])
                    return original(image, *args, **kwargs)

                with patch.object(Image.Image, "thumbnail", loaded_thumbnail):
                    self.assert_webp(convert(raw), size)

    def test_opening_errors_and_unapproved_formats(self):
        for name, convert, _ in self.converters():
            with self.subTest(converter=name):
                with self.assertRaises((UnidentifiedImageError, OSError, ValueError)):
                    convert(b"not an image")
                with patch("PIL.Image.open", side_effect=OSError("opening-stage failure")):
                    with self.assertRaisesRegex(OSError, "opening-stage failure"):
                        convert(b"bounded input")
                for format in ("GIF", "TIFF", "BMP"):
                    with self.subTest(format=format):
                        with self.assertRaisesRegex(ValueError, "Unsupported"):
                            convert(encoded_image(format, size=(4, 4)))

    def test_opening_bomb_warning_is_an_error(self):
        raw = encoded_image("PNG", size=(4, 4))
        for name, convert, _ in self.converters():
            with self.subTest(converter=name), patch.object(Image, "MAX_IMAGE_PIXELS", 10):
                with self.assertRaises(Image.DecompressionBombWarning):
                    convert(raw)

    def test_catalog_byte_pixel_and_output_limits(self):
        raw = encoded_image("PNG", size=(4, 4))
        for invalid in (b"", raw):
            with patch("PIL.Image.open") as opened:
                with self.assertRaisesRegex(ValueError, "download exceeds"):
                    thumbnail(invalid, {**CONFIG, "image_bytes": len(raw) - 1})
                opened.assert_not_called()
        with self.assertRaisesRegex(ValueError, "dimensions"):
            thumbnail(raw, {**CONFIG, "image_pixels": 15})
        self.assertEqual(
            thumbnail(raw, {**CONFIG, "image_bytes": len(raw), "image_pixels": 16})[1],
            {"width": 4, "height": 4},
        )
        with patch.object(
            Image.Image,
            "save",
            side_effect=lambda stream, *a, **kw: stream.write(b"x" * (256 * 1024 + 1)),
        ):
            with self.assertRaisesRegex(ValueError, "thumbnail exceeds"):
                thumbnail(raw, CONFIG)

    def test_public_pixel_limit_precedes_loading(self):
        # Mock dimensions rather than allocating a 16-million-pixel fixture.
        for logo in (False, True):
            with self.subTest(logo=logo), patch("PIL.Image.open") as opened:
                image = opened.return_value.__enter__.return_value
                image.format, image.width, image.height = "PNG", 4001, 4000
                with self.assertRaisesRegex(ValueError, "Unsupported public artwork"):
                    public_thumbnail(b"bounded input", logo=logo)
                image.load.assert_not_called()
                image.thumbnail.assert_not_called()
