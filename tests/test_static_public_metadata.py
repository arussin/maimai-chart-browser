"""Public branding, metadata replacement, cache boundaries and deterministic dating."""

import base64
import fnmatch
import hashlib
import json
import re
import struct
import tempfile
import unittest
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from importlib.resources import files
from pathlib import Path
from unittest.mock import patch

from maimai_intelligence.browser_bundle import read_browser_assets
from maimai_intelligence.public_release import _prepare_browser_shell, _search_metadata
from maimai_intelligence.seo import _document
from maimai_intelligence.sitemap_dates import (
    date_sitemaps,
    page_content,
    song_content,
    song_content_reader,
    validate_release_date,
)
from tests.test_browser_resources import source_assets


class Tags(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.tags = []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, dict(attrs)))


class StaticMetadataTests(unittest.TestCase):
    def test_metadata_offsets_follow_lf_and_consume_crlf(self):
        for separator in ("\r", "\v", "\f", "\x1c", "\x85", "\u2028", "\u2029", ""):
            with self.subTest(separator=repr(separator)):
                raw = (
                    "<html><head><title>old</title><style>/*a"
                    + separator
                    + 'b*/</style>\n<meta name="description" content="old">\r\n'
                    '<link rel="canonical" href="/old">\r\n</head><body>same</body></html>'
                ).encode()
                result = _search_metadata(raw)
                self.assertIn(("<style>/*a" + separator + "b*/</style>\n").encode(), result)
                self.assertNotIn(b'content="old"', result)
                self.assertNotIn(b"\r\n", result)
                self.assertEqual(_search_metadata(result), result)

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
            "/support",
            "/support.html",
            "/support-return",
            "/support-return.html",
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
                else "no-store"
                if path.startswith("/support")
                else "no-cache",
                values[0],
            )
        for path in ("/support-return", "/support-return.html"):
            self.assertTrue(any("default-src 'none'" in h for h in blocks[path]))
            self.assertTrue(any("frame-ancestors 'none'" in h for h in blocks[path]))
            self.assertIn("X-Robots-Tag: noindex, nofollow", blocks[path])
        for path in ("/support", "/support.html"):
            self.assertFalse(any(h.startswith("Content-Security-Policy:") for h in blocks[path]))
        for path in ("/favicon.ico", "/og-image.png", "/", "/en/songs/fixture/"):
            matched = [
                h
                for pattern, rows in blocks.items()
                if fnmatch.fnmatchcase(path, pattern)
                for h in rows
            ]
            self.assertFalse(any("immutable" in h for h in matched), path)

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
    def test_index_keeps_a_prior_removal_date_on_the_next_unchanged_release(self):
        first = self.assets()
        date_sitemaps(first, None, "2026-11-22")
        # A prior deletion changed the child sitemap after its remaining page.
        first["sitemap.xml"] = first["sitemap.xml"].replace(
            b"sitemap-en.xml</loc><lastmod>2026-11-22",
            b"sitemap-en.xml</loc><lastmod>2026-11-23",
        )
        with tempfile.TemporaryDirectory() as directory:
            previous = Path(directory)
            for name, raw in first.items():
                target = previous / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(raw)
            for release_date in (None, "2026-11-24"):
                current = self.assets()
                date_sitemaps(current, previous, release_date)
                self.assertEqual(current["sitemap.xml"], first["sitemap.xml"])

    def test_song_content_ignores_only_artwork_provenance_and_equivalent_fallbacks(self):
        original = {
            "data": {
                "catalog": [{"level": "12"}],
                "artwork": {
                    "assets": {"media/a.webp": {"bytes": 20, "sha256": "a", "source": "old"}},
                    "songs": {
                        "song": {"path": "media/a.webp", "title": "Title", "artist": "Artist"}
                    },
                },
            }
        }
        raw = json.dumps(original).encode()
        revised = json.loads(raw)
        art = revised["data"]["artwork"]
        art["assets"]["media/a.webp"].update(
            source="new", source_sha256="capture", width=190, height=190
        )
        art["songs"]["song"]["regions"] = {
            "JP": {"path": "media/a.webp", "title": "Title", "artist": "Artist"},
            "INTL": {"path": "media/a.webp"},
        }
        same = json.dumps(revised).encode()
        self.assertEqual(song_content(raw), song_content(same))
        for mutate in (
            lambda data: data["data"]["catalog"][0].update(level="13"),
            lambda data: data["data"]["artwork"]["songs"]["song"]["regions"]["JP"].update(
                path="media/b.webp"
            ),
            lambda data: data["data"]["artwork"]["songs"]["song"]["regions"]["JP"].update(
                title="New title"
            ),
            lambda data: data["data"]["artwork"]["assets"]["media/a.webp"].update(sha256="b"),
        ):
            changed = json.loads(same)
            mutate(changed)
            self.assertNotEqual(song_content(raw), song_content(json.dumps(changed).encode()))
        sha = hashlib.sha256(raw).hexdigest()
        reader = song_content_reader(lambda path: raw)
        self.assertEqual(reader(f"song-catalog/{sha}.json", sha, len(raw)), song_content(raw))
        for path, checksum, size in (
            ("../private.json", sha, len(raw)),
            (f"song-catalog/{sha}.json", sha, len(raw) + 1),
            (f"song-catalog/{'0' * 64}.json", "0" * 64, len(raw)),
        ):
            with self.assertRaises(ValueError):
                reader(path, checksum, size)

    def test_content_comparison_retains_visible_metadata_artwork_and_own_data(self):
        path = "en/songs/fixture/index.html"
        raw = (
            b'<html><head><title>Title</title><meta name="description" content="Detail">'
            b'</head><body><h1>Song</h1><img src="/media/old.png"><section data-song-binding="'
            b"{&quot;path&quot;:&quot;song-catalog/old.json&quot;,&quot;sha256&quot;:&quot;old&quot;,"
            b'&quot;source_catalog_sha256&quot;:&quot;global&quot;}" '
            b'data-catalog-sha256="global"></section></body></html>'
        )
        for before, after in (
            (b"Title", b"New title"),
            (b"Detail", b"New detail"),
            (b"Song", b"New song"),
            (b"old.png", b"new.png"),
            (b"old.json", b"new.json"),
            (b";old&quot", b";new&quot"),
        ):
            with self.subTest(before=before):
                self.assertNotEqual(
                    page_content(path, raw), page_content(path, raw.replace(before, after))
                )
        self.assertEqual(
            page_content(path, raw), page_content(path, raw.replace(b"global", b"next"))
        )

    @staticmethod
    def dates(raw):
        ns = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
        root = ET.fromstring(raw)  # noqa: S314 - locally authored/generated sitemap
        return {n.findtext(ns + "loc"): n.findtext(ns + "lastmod") for n in root}

    def test_mixed_unicode_dates_and_index_mapping_without_release_date(self):
        first = self.assets()
        url = "https://maimai.party/en/songs/%E6%97%A5%E6%9C%AC/"
        path = "en/songs/日本/index.html"
        first[path] = b"Japanese song"
        first["sitemap-en.xml"] = first["sitemap-en.xml"].replace(
            b"</urlset>", f"<url><loc>{url}</loc></url></urlset>".encode()
        )
        with tempfile.TemporaryDirectory() as directory:
            previous = Path(directory)

            def save(assets):
                for name, raw in assets.items():
                    target = previous / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(raw)

            save(first)  # An undated predecessor must seed all dates explicitly.
            date_sitemaps(first, previous, "2026-11-22")
            self.assertEqual(set(self.dates(first["sitemap-en.xml"]).values()), {"2026-11-22"})
            save(first)
            for kind in ("changed", "added", "removed"):
                for release_date in (None, "2026-11-23"):
                    with self.subTest(kind=kind, release_date=release_date):
                        current = dict(first)
                        if kind == "changed":
                            current[path] = b"Changed Japanese song"
                        elif kind == "added":
                            current["en/songs/new/index.html"] = b"new"
                            current["sitemap-en.xml"] = current["sitemap-en.xml"].replace(
                                b"</urlset>",
                                b"<url><loc>https://maimai.party/en/songs/new/</loc></url></urlset>",
                            )
                        else:
                            current["sitemap-en.xml"] = re.sub(
                                rb"<url><loc>" + re.escape(url.encode()) + rb"</loc>.*?</url>",
                                b"",
                                current["sitemap-en.xml"],
                            )
                        date_sitemaps(current, previous, release_date)
                        expected = {"https://maimai.party/en/songs/fixture/": "2026-11-22"}
                        if kind != "removed":
                            expected[url] = release_date if kind == "changed" else "2026-11-22"
                        if kind == "added":
                            expected["https://maimai.party/en/songs/new/"] = release_date
                        self.assertEqual(self.dates(current["sitemap-en.xml"]), expected)
                        self.assertEqual(
                            self.dates(current["sitemap.xml"]),
                            {
                                "https://maimai.party/sitemap-pages.xml": "2026-11-22",
                                "https://maimai.party/sitemap-en.xml": release_date,
                            },
                        )
            unchanged = dict(first)
            date_sitemaps(unchanged, previous, None)
            self.assertEqual(unchanged, first)

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
