"""Public SEO identity, localization, integrity and compatibility contracts."""

import hashlib
import json
import unittest
from urllib.parse import unquote
from xml.etree import ElementTree

from maimai_intelligence.catalog_loading import progressive_catalog, shared_catalog
from maimai_intelligence.seo import LOCALES, build_seo, empty_permalinks, route
from maimai_intelligence.snapshots import canonical


def catalog():
    charts = []
    navigation = {}
    for sid, title in (
        ("song:one", "日本語 & <song>"),
        ("song:two", "Same?!"),
        ("song:three", "Same?!"),
        ("song:four", "ASCII song"),
        ("song:five", "空 白 / #"),
    ):
        for fmt in ("STD", "DX"):
            for difficulty in ("BASIC", "MASTER"):
                cid = f"{sid}:{fmt}:{difficulty}"
                charts.append(
                    {
                        "song_id": sid,
                        "chart_id": cid,
                        "title": title,
                        "artist": "Public artist",
                        "format": fmt,
                        "difficulty": difficulty,
                        "level": "12",
                        "source_hash": "a" * 64,
                        "regional": {
                            "INTL": {
                                "listing": "listed",
                                "level": "11",
                                "genre": "intl-genre",
                                "version": "International release",
                                "metadata": {
                                    "title": title + " Intl",
                                    "artist": "Intl artist",
                                    "catcode": "intl-genre",
                                    "version": "123",
                                },
                            }
                        },
                    }
                )
                navigation[cid] = {
                    "version": "Japan release",
                    "genre": "maimai",
                    "bpm": 180,
                    "chart_constant": 12.5,
                    "regional_metrics": {"chart_constant": {"JP": 12.5, "INTL": 11.7}},
                }
    return {"catalog": charts, "navigation": {"charts": navigation}, "snippets": {}}


class SEOTests(unittest.TestCase):
    def test_one_song_per_language_contains_every_format_and_difficulty(self):
        assets, ledger, summary = build_seo(catalog())
        self.assertEqual(summary["songs"], 5)
        self.assertEqual(summary["versions"], 2)
        self.assertEqual(summary["localized_documents"], 28)
        for locale in LOCALES:
            name = unquote(route(locale, "songs", ledger["songs"]["song:one"])[1:]) + "index.html"
            html = assets[name].decode()
            self.assertEqual(html.count('<tr id="chart-'), 4)
            self.assertIn("STD", html)
            self.assertIn("DX", html)
            self.assertIn("data-seo-international", html)
            self.assertIn('data-seo-jp="12" data-seo-intl="11"', html)
            self.assertIn('data-seo-jp="12.5" data-seo-intl="11.7"', html)
            self.assertNotIn("<song>", html)
            self.assertIn("&lt;song&gt;", html)
            self.assertIn('hreflang="x-default"', html)
            self.assertEqual(html.count('rel="canonical"'), 1)
            self.assertEqual(html.count('rel="alternate"'), 5)
            self.assertNotIn("lab-loader.js", html)
            self.assertNotIn("challenge-review.js", html)

    def test_duplicate_titles_unicode_and_punctuation_have_stable_distinct_routes(self):
        data = catalog()
        _, ledger, _ = build_seo(data)
        self.assertNotEqual(ledger["songs"]["song:two"], ledger["songs"]["song:three"])
        self.assertIn("日本語", ledger["songs"]["song:one"])
        self.assertNotIn("/", ledger["songs"]["song:five"])
        for chart in data["catalog"]:
            chart["title"] = "Corrected title"
        _, after, _ = build_seo(data, previous=ledger)
        self.assertEqual(after, ledger)

    def test_identity_merge_preserves_published_redirect_and_has_one_target_page(self):
        data = catalog()
        _, ledger, _ = build_seo(data)
        assets, updated, summary = build_seo(
            data, previous=ledger, song_redirects={"song:two": "song:one"}
        )
        self.assertEqual(summary["songs"], 4)
        self.assertEqual(updated["redirects"], {"song:two": "song:one"})
        for locale in LOCALES:
            old = route(locale, "songs", ledger["songs"]["song:two"])
            new = route(locale, "songs", ledger["songs"]["song:one"])
            self.assertNotIn(unquote(old[1:]) + "index.html", assets)
            self.assertIn(f"{old} {new} 301", assets["_redirects"].decode())

    def test_bad_ledger_is_rejected_without_reassigning_routes(self):
        for change in (
            lambda d: d.update(extra="PRIVATE"),
            lambda d: d["songs"].update({"song:one": "../escape"}),
            lambda d: d["songs"].update({"song:one": "duplicate", "song:two": "duplicate"}),
            lambda d: d["redirects"].update({"song:one": "song:two", "song:two": "song:one"}),
        ):
            ledger = empty_permalinks()
            change(ledger)
            with self.assertRaises(ValueError):
                build_seo(catalog(), previous=ledger)

    def test_static_version_links_and_sitemaps_are_complete_and_public_only(self):
        assets, ledger, _ = build_seo(catalog())
        expected = []
        for locale in LOCALES:
            xml = ElementTree.fromstring(assets[f"sitemap-{locale}.xml"])  # noqa: S314 - generated fixture XML
            urls = [n.text for n in xml.findall(".//{*}loc")]
            self.assertEqual(len(urls), 7)
            self.assertEqual(len(urls), len(set(urls)))
            expected.extend(urls)
            for slug in ledger["versions"].values():
                html = assets[unquote(route(locale, "versions", slug)[1:]) + "index.html"].decode()
                self.assertEqual(html.count("data-song-page href="), 5)
                self.assertIn("data-seo-version=", html)
                self.assertIn("data-seo-international", html)
        self.assertFalse(
            any("?" in url or "/support" in url or "/report" in url for url in expected)
        )
        self.assertIn("sitemapindex", assets["sitemap.xml"].decode())
        self.assertIn("noindex", assets["404.html"].decode())

    def test_shared_route_model_rejects_region_paths_and_preserves_escaping(self):
        self.assertEqual(route("en", "songs", "name!'()*"), "/en/songs/name%21%27%28%29%2A/")
        for locale, kind, slug in (
            ("jp", "songs", "name"),
            ("en", "unknown", "name"),
            ("en", "songs", ""),
            ("ja", "songs", "a/b"),
        ):
            with self.assertRaises(ValueError):
                route(locale, kind, slug)

    def test_all_interactive_routes_reuse_the_supplied_browser_policy(self):
        policy = (
            "default-src 'none'; script-src 'self'; connect-src 'self' "
            "https://approved.example; base-uri 'none'"
        )
        assets, ledger, _ = build_seo(catalog(), browser_csp=policy)
        version = assets[
            unquote(route("en", "versions", next(iter(ledger["versions"].values())))[1:])
            + "index.html"
        ].decode()
        song = assets[
            unquote(route("en", "songs", next(iter(ledger["songs"].values())))[1:]) + "index.html"
        ].decode()
        self.assertIn("https://approved.example", version)
        self.assertIn("https://approved.example", song)

    def test_explicit_title_states_and_regional_version_membership_remain_distinct(self):
        data = catalog()
        for chart in data["catalog"]:
            if chart["song_id"] == "song:one":
                chart["title"] = ""
                chart["title_state"] = "intentional_blank"
        assets, ledger, _ = build_seo(data)
        song = assets[
            unquote(route("en", "songs", ledger["songs"]["song:one"])[1:]) + "index.html"
        ].decode()
        self.assertIn("Untitled (intentional)", song)
        version = assets[
            unquote(route("en", "versions", ledger["versions"]["International release"])[1:])
            + "index.html"
        ].decode()
        self.assertEqual(
            version.count('data-seo-jp-visible="false" data-seo-intl-visible="true" hidden'), 5
        )

    def test_real_international_title_overrides_canonical_blank_state_in_every_locale(self):
        data = catalog()
        for chart in data["catalog"]:
            chart["title"] = " "
            chart["title_state"] = "intentional_blank"
            chart["regional"]["INTL"]["metadata"]["title"] = "Verified international title"
        assets, ledger, _ = build_seo(data)
        for locale in LOCALES:
            name = unquote(route(locale, "songs", ledger["songs"]["song:one"])[1:])
            html = assets[name + "index.html"].decode()
            self.assertIn('data-seo-intl="Verified international title"', html)

    def test_generation_is_pure_and_deterministic(self):
        data = catalog()
        before = canonical(data)
        self.assertEqual(build_seo(data), build_seo(data))
        self.assertEqual(canonical(data), before)


class SharedDetailTests(unittest.TestCase):
    def test_catalog_binding_moves_to_new_index_without_mutating_legacy_assets(self):
        data = catalog()
        first_hash = "1" * 64
        second_hash = "2" * 64
        old_ref, old_assets = progressive_catalog(data, first_hash)
        old_before = dict(old_assets)
        shared_ref, shared_assets = shared_catalog(data, first_hash, legacy=(old_ref, old_assets))
        second_ref, second_assets = shared_catalog(data, second_hash)
        self.assertEqual(old_assets, old_before)
        index = json.loads(shared_assets[shared_ref["path"]])
        self.assertEqual(index["source_catalog_sha256"], first_hash)
        self.assertEqual(index["index_schema_version"], "catalog-index-shared-1")
        self.assertNotEqual(shared_ref["path"], second_ref["path"])
        first = {k: v for k, v in shared_assets.items() if k.startswith("chart-details/")}
        second = {k: v for k, v in second_assets.items() if k.startswith("chart-details/")}
        self.assertTrue(first)
        self.assertEqual(first, second)
        for ref in index["detail_buckets"].values():
            raw = shared_assets[ref["path"]]
            self.assertEqual(hashlib.sha256(raw).hexdigest(), ref["sha256"])
            self.assertEqual(len(raw), ref["bytes"])
            shard = json.loads(raw)
            self.assertNotIn("source_catalog_sha256", shard)
            self.assertEqual(shard["schema_version"], "chart-details-shared-1")
            self.assertTrue(shard["identities"])
        legacy = json.loads(old_assets[old_ref["path"]])
        for ref in legacy["detail_buckets"].values():
            self.assertEqual(
                json.loads(old_assets[ref["path"]])["source_catalog_sha256"], first_hash
            )

    def test_changed_chart_identity_cannot_share_the_prior_shard(self):
        data = catalog()
        _, before = shared_catalog(data, "1" * 64)
        data["catalog"][0]["source_hash"] = "f" * 64
        _, after = shared_catalog(data, "2" * 64)
        self.assertNotEqual(
            {k for k in before if k.startswith("chart-details/")},
            {k for k in after if k.startswith("chart-details/")},
        )
