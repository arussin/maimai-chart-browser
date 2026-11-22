"""Public branding, metadata replacement, cache boundaries and deterministic dating."""

import base64
import fnmatch
import json
import re
import struct
import tempfile
import unittest
from html.parser import HTMLParser
from importlib.resources import files
from pathlib import Path
from unittest.mock import patch

from maimai_intelligence.browser_bundle import read_browser_assets
from maimai_intelligence.public_release import _prepare_browser_shell, _search_metadata
from maimai_intelligence.seo import _document
from maimai_intelligence.sitemap_dates import date_sitemaps, validate_release_date
from tests.test_browser_resources import source_assets


class Tags(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.tags = []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, dict(attrs)))


class StaticMetadataTests(unittest.TestCase):
    def test_metadata_replacement_is_idempotent_and_preserves_body_and_unmanaged_head(self):
        body = '<body><meta name="description" content="body fixture"><p>Unchanged</p></body>'
        raw = (
            '<html><meta name="description" content="outside head">'
            "<head><title>old</title><meta charset='utf-8'>"
            "<META content='old' NAME='description'><link href='/old' REL='canonical'>"
            "<meta content='old' property='og:title'><meta NAME='twitter:card' content='summary'>"
            '<meta name="maimai-song-pages" content="1"></head>' + body + "</html>"
        ).encode()
        once = _search_metadata(raw)
        self.assertEqual(_search_metadata(once), once)
        self.assertEqual(once.split(b"</head>")[1], raw.split(b"</head>")[1])
        self.assertEqual(once.split(b"<head>")[0], raw.split(b"<head>")[0])
        tags = Tags(once.decode().split("<head>")[1].split("</head>")[0]).tags
        keys = [a.get("name") or a.get("property") or a.get("rel") for _, a in tags]
        for key in (
            "description",
            "canonical",
            "maimai-song-pages",
            "og:title",
            "og:image",
            "twitter:card",
            "twitter:image",
        ):
            self.assertEqual(keys.count(key), 1, key)
        self.assertIn(b"<meta charset='utf-8'>", once)

    def test_localized_social_metadata_is_escaped_for_every_locale(self):
        for locale in ("en", "ja", "ko", "zh-hans", "id"):
            for kind in ("songs", "versions"):
                raw = _document(
                    locale,
                    kind,
                    "fixture",
                    'Title " & <',
                    'Detail " & <',
                    "<p>body</p>",
                    {"language": "Language", "details": "Details"},
                )
                tags = Tags(raw.decode()).tags
                values = {a.get("property") or a.get("name"): a.get("content") for _, a in tags}
                self.assertEqual(values["og:title"], 'Title " & < | maimai.party')
                self.assertEqual(values["og:description"], 'Detail " & <')
                self.assertEqual(values["og:image"], "https://maimai.party/og-image.png")
                self.assertEqual(values["twitter:card"], "summary_large_image")
                self.assertEqual(values["twitter:image"], values["og:image"])
                self.assertTrue(any(a.get("href") == "/favicon.ico" for _, a in tags))

    def test_brand_binary_assets_use_existing_party_icons(self):
        assets = files("maimai_intelligence.assets")
        ico = assets.joinpath("favicon.ico").read_bytes()
        self.assertEqual(struct.unpack("<HHH", ico[:6]), (0, 1, 3))
        originals = re.findall(
            r'data:image/png;base64,([^" ]+)', assets.joinpath("favicon.html").read_text()
        )
        for index, encoded in enumerate(originals):
            width, height, _, _, _, _, size, offset = struct.unpack(
                "<BBBBHHII", ico[6 + 16 * index : 22 + 16 * index]
            )
            self.assertEqual((width, height), ((16, 16), (32, 32), (48, 48))[index])
            self.assertEqual(ico[offset : offset + size], base64.b64decode(encoded))
        self.assertNotEqual(ico, assets.joinpath("maishift-favicon.ico").read_bytes())
        png = assets.joinpath("og-image.png").read_bytes()
        self.assertEqual(png[:8], b"\x89PNG\r\n\x1a\n")
        self.assertEqual(struct.unpack(">II", png[16:24]), (1200, 630))
        self.assertLess(len(png), 300_000)

    def test_header_rules_have_one_cache_value_and_frame_protection(self):
        with patch(
            "maimai_intelligence.public_release._browser_assets",
            return_value={
                "index.html": b"<html><head><title>fixture</title></head><body></body></html>"
            },
        ):
            headers = _prepare_browser_shell(Path("."))["_headers"].decode()
        blocks = {}
        for line in headers.splitlines():
            if not line.startswith(" "):
                current = blocks.setdefault(line, [])
            else:
                current.append(line.strip())
        self.assertIn("Content-Security-Policy: frame-ancestors 'none'", blocks["/*"])
        for path in (
            "/browser/entry-ABCDEFGH.js",
            "/browser-resources/abc.txt",
            "/browser-resources.json",
            "/browser-assets.json",
            "/browser-config.json",
            "/browser-shell.html",
            "/manifest.json",
        ):
            values = [
                h
                for pattern, rows in blocks.items()
                if fnmatch.fnmatchcase(path, pattern)
                for h in rows
                if h.startswith("Cache-Control:")
            ]
            self.assertEqual(len(values), 1, path)
            self.assertIn(
                "immutable"
                if path.startswith(("/browser/", "/browser-resources/"))
                else "no-cache",
                values[0],
            )
        for path in ("/support-return", "/support-return.html"):
            self.assertTrue(any("default-src 'none'" in h for h in blocks[path]))
            self.assertIn("X-Robots-Tag: noindex, nofollow", blocks[path])

    def test_unhashed_browser_graph_entry_is_rejected(self):
        assets = source_assets()
        graph = json.loads(assets["browser-assets.json"])
        old = graph["entries"]["hosted"]
        graph["entries"]["hosted"] = "browser/unhashed.js"
        graph["assets"]["browser/unhashed.js"] = graph["assets"].pop(old)
        assets["browser/unhashed.js"] = assets.pop(old)
        assets["browser-assets.json"] = json.dumps(graph).encode()
        with self.assertRaisesRegex(ValueError, "asset reference"):
            read_browser_assets(lambda name, limit: assets[name])


class SitemapDatesTests(unittest.TestCase):
    def assets(self):
        return {
            "index.html": b"home",
            "en/songs/fixture/index.html": b"song",
            "sitemap-pages.xml": b'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://maimai.party/</loc></url></urlset>',
            "sitemap-en.xml": b'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://maimai.party/en/songs/fixture/</loc></url></urlset>',
            "sitemap.xml": b'<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://maimai.party/sitemap-pages.xml</loc></sitemap><sitemap><loc>https://maimai.party/sitemap-en.xml</loc></sitemap></sitemapindex>',
        }

    def test_optional_date_and_strict_format(self):
        assets = self.assets()
        original = dict(assets)
        date_sitemaps(assets, None, None)
        self.assertEqual(assets, original)
        for value in ("2026-2-01", "2026-02-30", "today", "2026-11-22T00:00:00Z", 123):
            with self.assertRaises(ValueError):
                validate_release_date(value)

    def test_repeatable_dates_preserve_unchanged_pages_and_advance_only_changed_pages(self):
        first = self.assets()
        date_sitemaps(first, None, "2026-11-22")
        repeated = self.assets()
        date_sitemaps(repeated, None, "2026-11-22")
        self.assertEqual(first, repeated)
        date_sitemaps(repeated, None, "2026-11-22")
        self.assertEqual(first, repeated)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, raw in first.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(raw)
            second = self.assets()
            date_sitemaps(second, root, "2026-11-23")
            self.assertEqual(first, second)
            third = self.assets()
            third["en/songs/fixture/index.html"] = b"changed song"
            date_sitemaps(third, root, "2026-11-23")
            self.assertEqual(third["sitemap-pages.xml"], first["sitemap-pages.xml"])
            self.assertIn(b"<lastmod>2026-11-23</lastmod>", third["sitemap-en.xml"])
            self.assertIn(b"<lastmod>2026-11-22</lastmod>", third["sitemap.xml"])
            self.assertIn(b"<lastmod>2026-11-23</lastmod>", third["sitemap.xml"])
            changed_catalog = self.assets()
            date_sitemaps(changed_catalog, root, "2026-11-23", home_catalog_unchanged=False)
            self.assertIn(b"<lastmod>2026-11-23</lastmod>", changed_catalog["sitemap-pages.xml"])
