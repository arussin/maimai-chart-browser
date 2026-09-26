"""One pure authority for public encoding, emitted paths and recovery filenames."""

import hashlib
import unittest
from dataclasses import FrozenInstanceError
from unittest.mock import patch

from maimai_intelligence import public_routes, seo
from maimai_intelligence.route_model import PublicRouteModel, valid_permalink_slug
from maimai_intelligence.route_recovery import _verify_routes


class RouteModelTests(unittest.TestCase):
    def test_current_model_round_trips_emitted_paths_and_unicode_filenames(self):
        model = public_routes.ROUTE_MODEL
        self.assertEqual(model.locales, tuple(public_routes.MODEL["locales"]))
        self.assertEqual(model.kinds, tuple(public_routes.MODEL["kinds"]))
        for locale in model.locales:
            for kind in model.kinds:
                for slug in ("fixture", "日本語-123", "한국어", "a" * 100, "-"):
                    path = model.path(locale, kind, slug)
                    parsed = model.parse_path(path)
                    self.assertIsNotNone(parsed)
                    self.assertEqual(parsed.path, path)
                    self.assertEqual(parsed.filename, f"{locale}/{kind}/{slug}/index.html")
                    self.assertEqual(model.parse_filename(parsed.filename), parsed)
                    self.assertTrue(valid_permalink_slug(slug))
        self.assertEqual(model.path("en", "songs", "name!'()*"), "/en/songs/name%21%27%28%29%2A/")
        with self.assertRaises(FrozenInstanceError):
            model.locales = ("changed",)

    def test_mutable_or_ambiguous_model_tokens_reject(self):
        for tokens in ([], (), ("en", "en"), ("",), ("EN",), ("../en",), (1,), ([],)):
            for locales, kinds in ((tokens, ("songs",)), (("en",), tokens)):
                with self.subTest(locales=locales, kinds=kinds), self.assertRaises(ValueError):
                    PublicRouteModel(locales, kinds)

    def test_invalid_slug_and_route_aliases_reject(self):
        model = public_routes.ROUTE_MODEL
        for slug in (None, 1, "", "a" * 101, "a_b", "a b", "a.b", "a%20b", "a/", "e\u0301"):
            self.assertFalse(valid_permalink_slug(slug), slug)
        for locale, kind, slug in (
            ("fr", "songs", "fixture"),
            ("en", "albums", "fixture"),
            ("en", "songs", None),
            ("en", "songs", ""),
            *(("en", "songs", value) for value in ("a/b", "a\\b", "a?b", "a#b")),
        ):
            with self.subTest(locale=locale, kind=kind, slug=slug), self.assertRaises(ValueError):
                model.path(locale, kind, slug)
        for path in (
            None,
            3,
            "/",
            "en/songs/fixture/",
            "/en/songs/fixture",
            "/en/songs/a/b/",
            "/en/songs/%e6%97%a5/",
            "/en/songs/%66ixture/",
            "/en/songs/%FF/",
            "/en/songs/%/",
            "/en/songs/%2F/",
            "/en/songs/../",
            "/en/songs/a_b/",
            "/fr/songs/fixture/",
            "/en/albums/fixture/",
            "/en/songs/日本語/",
            "/en/songs/fixture/?x=1",
            "/en/songs/fixture/#chart-a",
            "https://maimai.party/en/songs/fixture/",
        ):
            self.assertIsNone(model.parse_path(path), path)
        for filename in (
            None,
            3,
            "index.html",
            "/en/songs/fixture/index.html",
            "en/songs/a/b/index.html",
            "en/songs/fixture/index.htm",
            "fr/songs/fixture/index.html",
            "en/albums/a/index.html",
            "en/songs/a_b/index.html",
            "en/songs/%E6%97%A5/index.html",
        ):
            self.assertIsNone(model.parse_filename(filename), filename)

    def test_one_model_extension_reaches_seo_and_emitted_recovery_validation(self):
        model = PublicRouteModel(
            (*public_routes.ROUTE_MODEL.locales, "fr"),
            (*public_routes.ROUTE_MODEL.kinds, "collections"),
        )
        with patch.object(public_routes, "ROUTE_MODEL", model):
            for kind in model.kinds:
                path = seo.route("fr", kind, "fictional")
                filename = model.parse_path(path).filename
                raw = b"prepared source document"
                record = seo.EmittedPublicRoute(
                    path,
                    filename,
                    "fr",
                    kind[:-1],
                    ("exact-chart",) if kind == "songs" else (),
                    hashlib.sha256(raw).hexdigest(),
                )
                prepared = seo.PreparedSEO(
                    {filename: raw},
                    {},
                    {"localized_documents": 1},
                    [],
                    (record,),
                )
                self.assertEqual(_verify_routes(prepared), (record,))
        self.assertIsNone(public_routes.parse_route("/fr/songs/fictional/"))


if __name__ == "__main__":
    unittest.main()
