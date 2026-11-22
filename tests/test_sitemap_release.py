"""Publication dates must follow page content through real browser sealing."""

import hashlib
import json
import tempfile
import unittest
from importlib.resources import files
from pathlib import Path
from unittest.mock import patch

from maimai_intelligence.browser_bundle import seal_browser_resources, validate_browser_resources
from maimai_intelligence.lab import build_browser
from maimai_intelligence.public_release import plan_public_release
from maimai_intelligence.snapshots import canonical
from tests import test_static_public_metadata as metadata
from tests.lab_fixture import write_package


class SitemapReleaseTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.package = write_package(self.root / "package", constants=True)

    def build(self, name):
        return build_browser(self.package, self.root / name, catalog_version=name).index.parent

    def test_one_song_change_and_interface_release_preserve_unaffected_dates(self):
        source = self.build("first")
        first = plan_public_release(source, release_date="2026-11-22")
        previous = self.root / "previous"
        first.write_to(previous)
        # Change one synthetic song's own catalog data, keeping all identities stable.
        catalog_path = self.package / "catalog.json"
        rows = json.loads(catalog_path.read_bytes())
        rows[0]["level"] = "15"
        raw = canonical(rows)
        catalog_path.write_bytes(raw)
        manifest_path = self.package / "package.json"
        manifest = json.loads(manifest_path.read_bytes())
        next(row for row in manifest["files"] if row["path"] == "catalog.json").update(
            bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest()
        )
        manifest_path.write_bytes(canonical(manifest))
        changed_source = self.build("second")
        first_manifest = json.loads((source / "manifest.json").read_bytes())
        second_manifest_path = changed_source / "manifest.json"
        second_manifest = json.loads(second_manifest_path.read_bytes())
        second_manifest["releases"].extend(first_manifest["releases"])
        second_manifest_path.write_bytes(canonical(second_manifest))
        for entry in first_manifest["releases"]:
            for reference in (entry, entry["integration"]):
                target = changed_source / reference["path"]
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes((source / reference["path"]).read_bytes())
        changed = plan_public_release(
            changed_source, previous_public=previous, release_date="2026-11-23"
        )
        ledger = json.loads(first.assets["permalinks.json"])
        changed_sid = next(
            binding["song_id"]
            for binding in first.prepared_seo.song_bindings
            if rows[0]["chart_id"]
            in {
                row["chart_id"]
                for row in json.loads(first.assets[binding["path"]])["data"]["catalog"]
            }
        )
        from maimai_intelligence.seo import LOCALES, route

        undated = plan_public_release(changed_source, previous_public=previous)
        for locale in LOCALES:
            expected = {}
            for sid, slug in ledger["songs"].items():
                expected["https://maimai.party" + route(locale, "songs", slug)] = (
                    "2026-11-23" if sid == changed_sid else "2026-11-22"
                )
            for slug in ledger["versions"].values():
                expected["https://maimai.party" + route(locale, "versions", slug)] = "2026-11-22"
            self.assertGreaterEqual(len(ledger["songs"]), 2)
            self.assertEqual(
                metadata.SitemapDatesTests.dates(changed.assets[f"sitemap-{locale}.xml"]), expected
            )
            self.assertEqual(
                metadata.SitemapDatesTests.dates(undated.assets[f"sitemap-{locale}.xml"]),
                {loc: None if day == "2026-11-23" else day for loc, day in expected.items()},
            )
        # A genuine new immutable module path, preload and changed CSS alter sealed HTML.
        graph_path = source / "browser-assets.json"
        graph = json.loads(graph_path.read_bytes())
        old = graph["entries"]["hosted"]
        new = "browser/browser-entry-UPDATED0.js"
        script = (source / old).read_bytes() + b"\n// interface revision\n"
        (source / new).write_bytes(script)
        graph["entries"]["hosted"] = new
        graph["assets"][new] = {"bytes": len(script), "sha256": hashlib.sha256(script).hexdigest()}
        graph["preloads"] = [*graph.get("preloads", []), old]
        graph_path.write_bytes(canonical(graph))
        with (source / "seo-pages.css").open("ab") as stream:
            stream.write(b"\n/* interface revision */\n")
        for retired in ("old-chunk-OLD12345.js", "old.js"):
            (previous / "browser" / retired).write_bytes(b"retired")
        interface = plan_public_release(source, previous_public=previous, release_date="2026-11-24")
        self.assertTrue(interface.summary["deployable"])
        self.assertIn(new, interface.assets)
        self.assertIn(old, interface.assets)
        self.assertNotIn("browser/old.js", interface.assets)
        self.assertNotIn("browser/old-chunk-OLD12345.js", interface.assets)
        for locale in LOCALES:
            self.assertEqual(
                interface.assets[f"sitemap-{locale}.xml"], first.assets[f"sitemap-{locale}.xml"]
            )
        localized = next(
            n for n in first.assets if n.startswith("en/songs/") and n.endswith(".html")
        )
        self.assertNotEqual(first.assets[localized], interface.assets[localized])

    def test_brand_assets_and_social_tags_survive_browser_and_public_planning(self):
        source = self.build("brand")
        plan = plan_public_release(source)
        for name in ("favicon.ico", "og-image.png"):
            expected = files("maimai_intelligence.assets").joinpath(name).read_bytes()
            self.assertEqual((source / name).read_bytes(), expected)
            self.assertEqual(plan.assets[name], expected)
            self.assertFalse(
                any(
                    path.startswith("browser-resources/") and raw == expected
                    for path, raw in plan.assets.items()
                )
            )
        for name in ("index.html", "browser-shell.html"):
            tags = metadata.Tags(plan.assets[name].decode()).tags
            values = {a.get("property") or a.get("name"): a.get("content") for _, a in tags}
            self.assertEqual(values["og:image"], "https://maimai.party/og-image.png")
            self.assertEqual(values["twitter:image"], values["og:image"])
            self.assertEqual(values["twitter:card"], "summary_large_image")

    def test_resource_entry_and_unlisted_browser_guards_and_retired_chunks(self):
        source = self.build("guard")
        first = plan_public_release(source)
        resources = json.loads(first.assets["browser-resources.json"])
        resources["entry"]["path"] = "browser/unhashed.js"
        with self.assertRaisesRegex(ValueError, "immutable browser resource path"):
            validate_browser_resources(resources)

        def extra(assets, manifest):
            result = seal_browser_resources(assets, manifest)
            result["browser/extra-ABCDEFGH.js"] = b"export {};"
            return result

        with patch("maimai_intelligence.browser_bundle.seal_browser_resources", side_effect=extra):
            with self.assertRaisesRegex(ValueError, "Unlisted immutable browser asset"):
                plan_public_release(source)
        previous = self.root / "previous"
        first.write_to(previous)
        for name in ("old-chunk-OLD12345.js", "old.js"):
            (previous / "browser" / name).write_bytes(b"retired")
        current = plan_public_release(source, previous_public=previous)
        self.assertTrue(current.summary["deployable"])
        self.assertEqual(dict(first.assets), dict(current.assets))
