import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path
from unittest.mock import patch

from maimai_intelligence.public_release import (
    PUBLIC_FILES,
    _read,
    build_public_release,
    plan_public_release,
    read_public_catalog_inputs,
)
from maimai_intelligence.registry import empty
from maimai_intelligence.registry_catalog import project_registry
from maimai_intelligence.snapshots import atomic_json, canonical, read_json
from tests.registry_fixture import admit, official_row


class PublicAssetReadTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="public-asset-path-test-")
        self.addCleanup(self.temporary.cleanup)
        self.source = Path(self.temporary.name) / "accepted public assets"
        self.source.mkdir()
        (self.source / "asset.js").write_bytes(b"accepted bytes")

    def test_unresolved_root_reads_the_same_accepted_asset(self):
        alias = self.source / ".." / self.source.name
        self.assertNotEqual(alias, self.source.resolve())
        self.assertEqual(alias.resolve(), self.source.resolve())
        self.assertEqual(_read(alias, "asset.js", 100), b"accepted bytes")

    @unittest.skipUnless(os.name == "nt", "Windows short path aliases")
    def test_windows_short_root_reads_the_same_accepted_asset(self):
        import ctypes

        buffer = ctypes.create_unicode_buffer(32768)
        size = ctypes.windll.kernel32.GetShortPathNameW(str(self.source), buffer, len(buffer))
        self.assertGreater(size, 0)
        self.assertLess(size, len(buffer))
        alias = Path(buffer.value)
        if alias == alias.resolve():
            self.skipTest("Filesystem did not expose a distinct short path alias")
        self.assertEqual(alias.resolve(), self.source.resolve())
        self.assertEqual(_read(alias, "asset.js", 100), b"accepted bytes")

    def test_normalized_root_still_rejects_assets_outside_it(self):
        outside = self.source.parent / "private.json"
        outside.write_bytes(b"private bytes")
        alias = self.source / ".." / self.source.name
        for name in ("../private.json", str(outside.resolve())):
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "leaves"):
                _read(alias, name, 100)

    def test_normalized_root_retains_the_byte_limit(self):
        alias = self.source / ".." / self.source.name
        with self.assertRaisesRegex(ValueError, "size limit"):
            _read(alias, "asset.js", 4)


class PublicReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source, self.output = self.root / "accepted", self.root / "public"
        self.source.mkdir()
        for name in PUBLIC_FILES:
            (self.source / name).write_text("catalog-parts/ maimaiCatalogDetails", encoding="utf-8")
        (self.source / "index.html").write_text(
            "<!doctype html><html><head><title>maimai.party</title></head>"
            '<body><h1>Find a chart</h1><div id="songs"></div></body></html>',
            encoding="utf-8",
        )
        self.raw = canonical({"package": {"status": "research_preview"}, "catalog": ["日本語"]})
        self.sha = hashlib.sha256(self.raw).hexdigest()
        self.path = f"catalogs/{self.sha}.json"
        (self.source / "catalogs").mkdir()
        (self.source / self.path).write_bytes(self.raw)
        self.manifest = {
            "schema_version": "1.0.0",
            "default": "accepted-v1",
            "releases": [{"version": "accepted-v1", "path": self.path, "sha256": self.sha}],
        }
        atomic_json(self.source / "manifest.json", self.manifest)

    def test_plan_is_immutable_and_does_not_write_until_requested(self):
        plan = plan_public_release(self.source)
        self.assertFalse(self.output.exists())
        with self.assertRaises(TypeError):
            plan.assets["unexpected"] = b"private"
        with self.assertRaises(TypeError):
            plan.manifest["releases"][0]["sha256"] = "0" * 64
        self.assertTrue(plan.summary["deployable"])
        self.assertIsNone(plan.prepared_seo)
        self.assertEqual(plan.write_to(self.output)["files"], len(plan.assets) + 1)

    def test_prepared_catalog_and_seo_are_reused_without_a_second_preparation(self):
        from maimai_intelligence.catalog_document import prepare_catalog_document
        from maimai_intelligence.lab import build_browser
        from maimai_intelligence.seo import prepare_seo
        from tests.lab_fixture import write_package

        prepared = []

        def observe_seo(*args, **kwargs):
            result = prepare_seo(*args, **kwargs)
            prepared.append(result)
            return result

        with (
            patch(
                "maimai_intelligence.lab.prepare_catalog_document", wraps=prepare_catalog_document
            ) as catalog,
            patch(
                "maimai_intelligence.public_release.decode_catalog_document",
                side_effect=AssertionError("Prepared catalog must not be decoded again"),
            ),
            patch("maimai_intelligence.seo.prepare_seo", side_effect=observe_seo) as seo,
        ):
            browser = build_browser(
                write_package(self.root / "package", grouped=True),
                self.root / "browser",
                catalog_version="prepared-once",
            )
            plan = plan_public_release(
                browser.index.parent, prepared_catalogs={"prepared-once": browser.catalog}
            )
            self.assertIs(plan.prepared_seo, prepared[0])
            self.assertEqual(len(prepared), 1)
            self.assertNotIn("prepared_seo", plan.summary)
            self.assertNotIn("prepared_seo", plan.manifest)
            self.assertNotIn("prepared_seo", repr(plan))
            summary = plan.write_to(self.output)
            self.assertNotIn("prepared_seo", summary)
            self.assertNotIn("prepared_seo", read_json(self.output / "manifest.json"))
            catalog.assert_called_once()
            seo.assert_called_once()
        self.assertEqual(plan.prepared_seo.summary["songs"], plan.summary["seo"]["songs"])

    def test_capacity_failure_is_reviewable_but_cannot_write_deployable_manifest(self):
        with patch("maimai_intelligence.public_release.MAX_PUBLIC_FILES", 1):
            plan = plan_public_release(self.source)
        self.assertFalse(plan.summary["deployable"])
        with self.assertRaisesRegex(ValueError, "Combined launch blocked"):
            plan.write_to(self.output)
        self.assertFalse(self.output.exists())
        review = self.root / "review"
        plan.write_review_to(review)
        self.assertTrue((review / "planned-manifest.json").is_file())
        self.assertFalse((review / "manifest.json").exists())
        self.assertFalse((review / "planned-assets/manifest.json").exists())

    def test_only_reviewed_capacity_can_raise_the_default_limit(self):
        from maimai_intelligence.publication_capacity import read_capacity_review
        from tests.test_publication_capacity import capacity_fixture

        path, digest = capacity_fixture(self.root / "capacity")
        reviewed = read_capacity_review(path, digest)
        default = plan_public_release(self.source)
        with patch("maimai_intelligence.public_release.MAX_PUBLIC_FILES", 1):
            self.assertFalse(plan_public_release(self.source).summary["deployable"])
            plan = plan_public_release(self.source, capacity=reviewed)
            self.assertTrue(plan.summary["deployable"])
            self.assertEqual(plan.summary["capacity"]["review_sha256"], digest)
            self.assertEqual(plan.summary["capacity"]["max_files"], 100000)
            with self.assertRaisesRegex(ValueError, "reviewed capacity"):
                plan_public_release(self.source, capacity={"max_files": 100000})
        self.assertEqual(plan.assets, default.assets)
        self.assertEqual(plan.manifest, default.manifest)
        plan.write_to(self.output)
        self.assertFalse((self.output / "capacity").exists())
        for asset in self.output.rglob("*"):
            if asset.is_file():
                raw = asset.read_bytes()
                for private in (reviewed.account_id, reviewed.project, reviewed.review_sha256):
                    self.assertNotIn(private.encode(), raw)

    def test_previous_release_is_bound_to_exact_catalog_bytes_and_allowlisted_closure(self):
        build_public_release(self.source, self.output)
        (self.output / "personal.json").write_text("PRIVATE")
        plan = plan_public_release(self.source, previous_public=self.output)
        self.assertNotIn("personal.json", plan.assets)
        self.assertEqual(
            plan.manifest["releases"][0]["parts"][0]["sha256"],
            self.manifest["releases"][0]["sha256"],
        )
        ref = read_json(self.output / "manifest.json")["releases"][0]["parts"][0]
        (self.output / ref["path"]).write_bytes(b"tampered")
        with self.assertRaisesRegex(ValueError, "Retained public asset integrity mismatch"):
            plan_public_release(self.source, previous_public=self.output)

    def test_song_assets_survive_projection_revisions_and_tampering_blocks_reuse(self):
        from maimai_intelligence.song_catalog import prepare_song_catalog

        data = {
            "package": {"status": "research_preview"},
            "catalog": [
                {
                    "chart_id": "chart",
                    "song_id": "song",
                    "title": "Public",
                    "artist": "Artist",
                    "format": "DX",
                    "difficulty": "MASTER",
                    "source_hash": "a" * 64,
                }
            ],
            "snippets": {},
        }
        raw = canonical(data)
        digest = hashlib.sha256(raw).hexdigest()
        path = f"catalogs/{digest}.json"
        (self.source / path).write_bytes(raw)
        self.manifest["releases"][0].update(path=path, sha256=digest)
        atomic_json(self.source / "manifest.json", self.manifest)
        first = build_public_release(self.source, self.output)
        first_inventory = read_json(self.output / "manifest.json")["releases"][0][
            "song_catalog_indexes"
        ]
        self.assertEqual(len(first_inventory), 1)
        first_assets = read_json(self.output / first_inventory[0]["path"])["assets"]

        def revised(*args):
            value = prepare_song_catalog(*args)
            value["projection_revision"] = 2
            return value

        second = self.root / "second"
        with patch("maimai_intelligence.song_catalog.prepare_song_catalog", side_effect=revised):
            build_public_release(self.source, second, previous_public=self.output)
        second_inventory = read_json(second / "manifest.json")["releases"][0][
            "song_catalog_indexes"
        ]
        self.assertEqual(len(second_inventory), 2)
        for ref in [*first_inventory, *first_assets]:
            self.assertEqual(
                (self.output / ref["path"]).read_bytes(), (second / ref["path"]).read_bytes()
            )
        third = plan_public_release(self.source, previous_public=second)
        self.assertEqual(len(third.manifest["releases"][0]["song_catalog_indexes"]), 2)
        self.assertGreater(first["files"], 0)
        (second / first_assets[0]["path"]).write_bytes(b"tampered")
        with self.assertRaisesRegex(ValueError, "integrity mismatch"):
            plan_public_release(self.source, previous_public=second)

    def test_previous_historical_startup_bytes_are_preserved_when_projection_changes(self):
        data = {
            "package": {"status": "research_preview"},
            "catalog": [
                {"chart_id": "chart", "song_id": "song", "title": "Public", "source_hash": "a" * 64}
            ],
            "snippets": {"chart": []},
        }
        raw = canonical(data)
        sha = hashlib.sha256(raw).hexdigest()
        path = f"catalogs/{sha}.json"
        (self.source / path).write_bytes(raw)
        self.manifest["releases"][0].update(path=path, sha256=sha)
        atomic_json(self.source / "manifest.json", self.manifest)
        build_public_release(self.source, self.output)
        old_manifest = read_json(self.output / "manifest.json")
        ref = old_manifest["releases"][0]["startup"]
        index = read_json(self.output / ref["path"])
        index["historical_projection_note"] = "retained exact bytes"
        historical = canonical(index)
        historical_sha = hashlib.sha256(historical).hexdigest()
        historical_ref = {
            "path": f"catalog-index/{historical_sha}.json",
            "sha256": historical_sha,
            "bytes": len(historical),
        }
        (self.output / historical_ref["path"]).write_bytes(historical)
        old_manifest["releases"][0]["startup"] = historical_ref
        atomic_json(self.output / "manifest.json", old_manifest)
        plan = plan_public_release(self.source, previous_public=self.output)
        self.assertEqual(dict(plan.manifest["releases"][0]["startup"]), historical_ref)
        self.assertEqual(plan.assets[historical_ref["path"]], historical)
        self.assertNotIn(ref["path"], plan.assets)

    def test_missing_or_changed_published_permalink_ledger_blocks_new_routes(self):
        data = {
            "package": {"status": "research_preview"},
            "catalog": [
                {
                    "chart_id": "chart",
                    "song_id": "song",
                    "title": "Original title",
                    "artist": "Fictional artist",
                    "source_hash": "a" * 64,
                }
            ],
            "snippets": {},
        }
        raw = canonical(data)
        sha = hashlib.sha256(raw).hexdigest()
        path = f"catalogs/{sha}.json"
        (self.source / path).write_bytes(raw)
        self.manifest["releases"][0].update(path=path, sha256=sha)
        atomic_json(self.source / "manifest.json", self.manifest)
        build_public_release(self.source, self.output)
        ledger = self.output / "permalinks.json"
        original = ledger.read_bytes()
        previous_manifest = read_json(self.output / "manifest.json")
        changed = json.loads(original)
        changed["songs"]["song"] = "replacement-slug"
        atomic_json(ledger, changed)
        with self.assertRaisesRegex(ValueError, "permalink ledger integrity"):
            plan_public_release(self.source, previous_public=self.output)
        ledger.unlink()
        with self.assertRaisesRegex(ValueError, "permalink ledger"):
            plan_public_release(self.source, previous_public=self.output)
        # Initial SEO releases predate the additive ledger hash; their marker and
        # canonical identities still establish that URLs have already been issued.
        previous_manifest.pop("permalinks", None)
        atomic_json(self.output / "manifest.json", previous_manifest)
        with self.assertRaisesRegex(ValueError, "permalink ledger"):
            plan_public_release(self.source, previous_public=self.output)
        ledger.write_bytes(original)
        self.assertEqual(
            plan_public_release(self.source, previous_public=self.output).assets["permalinks.json"],
            original,
        )

    def test_generated_application_manifest_is_the_only_runtime_asset_list(self):
        (self.source / "browser").mkdir()
        body = b"export const fictional = true;"
        refs = {}
        for name in (
            "browser/browser-entry.js",
            "browser/browser-offline.js",
            "browser/chunk-ABC.js",
        ):
            (self.source / name).write_bytes(body)
            refs[name] = {"sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body)}
        manifest = {
            "version": 1,
            "tool": "test",
            "entries": {
                "hosted": "browser/browser-entry.js",
                "offline": "browser/browser-offline.js",
            },
            "assets": refs,
            "replaces": ["lab-loader.js"],
        }
        atomic_json(self.source / "browser-assets.json", manifest)
        atomic_json(self.source / "browser-config.json", {"fictional": True})
        (self.source / "browser-shell.html").write_bytes((self.source / "index.html").read_bytes())
        (self.source / "browser/private.json").write_text("UNRELATED_PRIVATE")
        (self.source / "lab-loader.js").unlink()
        plan = plan_public_release(self.source)
        self.assertTrue(set(refs) <= set(plan.assets))
        self.assertNotIn("lab-loader.js", plan.assets)
        self.assertNotIn("browser/private.json", plan.assets)
        (self.source / "browser/chunk-ABC.js").write_bytes(b"tampered")
        with self.assertRaisesRegex(ValueError, "asset integrity"):
            plan_public_release(self.source)
        (self.source / "browser/chunk-ABC.js").write_bytes(body)
        for invalid in ("../private.js", "browser/../../private.js", "browser/private.json"):
            manifest["assets"] = {**refs, invalid: refs["browser/browser-entry.js"]}
            atomic_json(self.source / "browser-assets.json", manifest)
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                plan_public_release(self.source)

    def test_exact_catalog_bytes_and_only_allowlisted_assets_survive(self):
        (self.source / "personal.json").write_text("PRIVATE", encoding="utf-8")
        (self.source / "raw-response.json").write_text("PRIVATE", encoding="utf-8")
        with patch("maimai_intelligence.public_release.PART_BYTES", 31):
            result = build_public_release(self.source, self.output)
        manifest = read_json(self.output / "manifest.json")
        entry = manifest["releases"][0]
        self.assertEqual(manifest["schema_version"], "1.2.0")
        self.assertEqual(entry["sha256"], self.sha)
        self.assertGreater(len(entry["parts"]), 1)
        self.assertEqual(
            b"".join((self.output / p["path"]).read_bytes() for p in entry["parts"]), self.raw
        )
        self.assertEqual(result["catalogs"], 1)
        self.assertFalse((self.output / "personal.json").exists())
        self.assertFalse((self.output / "raw-response.json").exists())
        self.assertFalse((self.output / "catalogs").exists())
        self.assertIn(
            "Permissions-Policy: payment=(self "
            '"https://checkout.stripe.com" "https://js.stripe.com" "https://hooks.stripe.com")',
            (self.output / "_headers").read_text("utf-8"),
        )
        self.assertIn(
            "location.search+location.hash", (self.output / "lab-redirect.js").read_text("utf-8")
        )

    def test_published_catalog_reader_reuses_verified_multipart_and_legacy_inputs(self):
        from maimai_intelligence import public_release

        with patch("maimai_intelligence.public_release.PART_BYTES", 31):
            build_public_release(self.source, self.output)
        reference = read_json(self.output / "manifest.json")["releases"][0]
        self.assertFalse((self.output / reference["path"]).exists())
        with patch.object(
            public_release, "_retained_reference", wraps=public_release._retained_reference
        ) as verified:
            self.assertEqual(read_public_catalog_inputs(self.output, reference), (self.raw, None))
            self.assertEqual(verified.call_count, len(reference["parts"]))
        self.assertEqual(
            read_public_catalog_inputs(self.source, self.manifest["releases"][0]), (self.raw, None)
        )
        for parts in (None, [], reference["parts"] * 9, list(reversed(reference["parts"]))):
            with self.subTest(parts=parts), self.assertRaises(ValueError):
                read_public_catalog_inputs(self.output, {**reference, "parts": parts})
        path = self.output / reference["parts"][0]["path"]
        original = path.read_bytes()
        path.write_bytes(b"tampered")
        with self.assertRaisesRegex(ValueError, "integrity mismatch"):
            read_public_catalog_inputs(self.output, reference)
        path.unlink()
        with self.assertRaises(FileNotFoundError):
            read_public_catalog_inputs(self.output, reference)
        path.write_bytes(original)

    def test_published_catalog_reader_verifies_integration_bytes_without_repreparation(self):
        from maimai_intelligence.lab import build_browser
        from tests.lab_fixture import write_package

        browser = build_browser(
            write_package(self.root / "package", grouped=True),
            self.root / "browser",
            catalog_version="reader",
        )
        plan = plan_public_release(
            browser.index.parent, prepared_catalogs={"reader": browser.catalog}
        )
        plan.write_to(self.output)
        reference = read_json(self.output / "manifest.json")["releases"][0]
        self.assertEqual(
            read_public_catalog_inputs(self.output, reference),
            (browser.catalog.raw, browser.catalog.integration),
        )
        (self.output / reference["integration"]["path"]).write_bytes(b"wrong integration")
        with self.assertRaisesRegex(ValueError, "integrity mismatch"):
            read_public_catalog_inputs(self.output, reference)

    def test_large_startup_uses_verified_parts_and_retains_old_reader_fallback(self):
        data = {
            "package": {"status": "research_preview"},
            "catalog": [{"chart_id": "chart", "title": "Public", "source_hash": "a" * 64}],
            "review": ["x" * 2000],
        }
        raw = canonical(data)
        sha = hashlib.sha256(raw).hexdigest()
        path = f"catalogs/{sha}.json"
        (self.source / path).write_bytes(raw)
        self.manifest["releases"][0].update(path=path, sha256=sha)
        atomic_json(self.source / "manifest.json", self.manifest)
        with (
            patch("maimai_intelligence.public_release.STARTUP_PART_THRESHOLD", 512),
            patch("maimai_intelligence.public_release.INDEX_PART_BYTES", 1024),
        ):
            plan = plan_public_release(self.source)
            plan.write_to(self.output)
            manifest = read_json(self.output / "manifest.json")
            entry = manifest["releases"][0]
            self.assertNotIn("startup", entry)
            self.assertNotIn("startup_shared", entry)
            self.assertEqual(b"".join(plan.assets[p["path"]] for p in entry["parts"]), raw)
            reference = entry["startup_parts"]
            encoded = b"".join(plan.assets[p["path"]] for p in reference["parts"])
            self.assertEqual(len(encoded), reference["bytes"])
            self.assertEqual(hashlib.sha256(encoded).hexdigest(), reference["sha256"])
            self.assertEqual(json.loads(encoded)["source_catalog_sha256"], sha)
            self.assertLessEqual(max(p["bytes"] for p in reference["parts"]), 1024)
            retained = plan_public_release(self.source, previous_public=self.output)
            self.assertEqual(
                dict(retained.manifest["releases"][0]["startup_parts"])["sha256"],
                reference["sha256"],
            )
            (self.output / reference["parts"][0]["path"]).write_bytes(b"tampered")
            with self.assertRaisesRegex(ValueError, "integrity mismatch"):
                plan_public_release(self.source, previous_public=self.output)

    def test_startup_splits_only_above_the_actual_hosting_asset_limit(self):
        from maimai_intelligence.catalog_loading import (
            encode_catalog_projection,
            prepare_catalog_projection,
        )
        from maimai_intelligence.public_release import INDEX_PART_BYTES, MAX_PUBLIC_FILE_BYTES

        data = {
            "package": {"status": "research_preview"},
            "catalog": [{"chart_id": "chart", "title": "Public", "source_hash": "a" * 64}],
            "review": [""],
        }
        minimal, _ = encode_catalog_projection(
            prepare_catalog_projection(data, "0" * 64), shared=True
        )
        for target_size in (
            MAX_PUBLIC_FILE_BYTES - 1,
            MAX_PUBLIC_FILE_BYTES,
            MAX_PUBLIC_FILE_BYTES + 1,
        ):
            with self.subTest(bytes=target_size):
                data["review"] = ["x" * (target_size - minimal["bytes"])]
                raw = canonical(data)
                digest = hashlib.sha256(raw).hexdigest()
                path = f"catalogs/{digest}.json"
                (self.source / path).write_bytes(raw)
                self.manifest["releases"][0].update(path=path, sha256=digest)
                atomic_json(self.source / "manifest.json", self.manifest)
                plan = plan_public_release(self.source)
                entry = plan.manifest["releases"][0]
                if target_size <= MAX_PUBLIC_FILE_BYTES:
                    self.assertNotIn("startup_parts", entry)
                    reference = entry["startup_shared"]
                    encoded = plan.assets[reference["path"]]
                else:
                    self.assertNotIn("startup_shared", entry)
                    self.assertNotIn("startup", entry)
                    reference = entry["startup_parts"]
                    encoded = b"".join(plan.assets[part["path"]] for part in reference["parts"])
                    self.assertTrue(
                        all(part["bytes"] <= INDEX_PART_BYTES for part in reference["parts"])
                    )
                self.assertEqual(len(encoded), target_size)
                self.assertEqual(hashlib.sha256(encoded).hexdigest(), reference["sha256"])
                self.assertTrue(
                    all(len(body) <= MAX_PUBLIC_FILE_BYTES for body in plan.assets.values())
                )
                self.assertEqual(
                    b"".join(plan.assets[part["path"]] for part in entry["parts"]), raw
                )

    def test_old_versions_and_default_are_preserved(self):
        self.manifest["releases"].append({**self.manifest["releases"][0], "version": "older"})
        atomic_json(self.source / "manifest.json", self.manifest)
        build_public_release(self.source, self.output)
        manifest = read_json(self.output / "manifest.json")
        self.assertEqual(manifest["default"], "accepted-v1")
        self.assertEqual([r["version"] for r in manifest["releases"]], ["accepted-v1", "older"])

    def test_search_metadata_and_crawler_files_leave_visible_content_unchanged(self):
        original = (self.source / "index.html").read_text("utf-8")
        build_public_release(self.source, self.output)
        published = (self.output / "index.html").read_text("utf-8")
        self.assertEqual(original.split("</head>", 1)[1], published.split("</head>", 1)[1])

        class HeadParser(HTMLParser):
            def __init__(self):
                super().__init__()
                self.tags = []

            def handle_starttag(self, tag, attrs):
                self.tags.append((tag, dict(attrs)))

        head = HeadParser()
        head.feed(published.split("</head>", 1)[0])
        self.assertNotIn("maimai-song-pages", original)
        self.assertEqual(
            [a["content"] for t, a in head.tags if a.get("name") == "maimai-song-pages"], ["1"]
        )
        descriptions = [a["content"] for t, a in head.tags if a.get("name") == "description"]
        self.assertEqual(len(descriptions), 1)
        self.assertIn("chart constants", descriptions[0])
        self.assertEqual(
            [a["href"] for t, a in head.tags if a.get("rel") == "canonical"],
            ["https://maimai.party/"],
        )
        self.assertIn("maimai Chart Database &amp; Patterns", published)
        # Parse only the fixed sitemap generated locally by the release builder.
        sitemap = ET.parse(self.output / "sitemap.xml")  # noqa: S314
        self.assertEqual(
            [node.text for node in sitemap.findall(".//{*}loc")], ["https://maimai.party/"]
        )
        robots = (self.output / "robots.txt").read_text("utf-8")
        self.assertIn("User-agent: *\nAllow: /", robots)
        self.assertIn("Sitemap: https://maimai.party/sitemap.xml", robots)
        self.assertNotIn("Disallow:", robots)

    def test_integrity_failure_does_not_write_any_output(self):
        (self.source / self.path).write_bytes(self.raw + b" ")
        with self.assertRaisesRegex(ValueError, "integrity"):
            build_public_release(self.source, self.output)
        self.assertFalse(self.output.exists())

    def test_unreviewed_genres_block_all_release_versions_before_any_output(self):
        value, _ = admit(empty(), [official_row("Genre fixture", "Artist")])
        original = project_registry(value, {})
        original["package"] = {"status": "research_preview"}
        for schema in ("maimai-browser-catalog-2", None):
            with self.subTest(schema=schema):
                data = json.loads(json.dumps(original))
                if schema is None:
                    del data["schema_version"]
                # Also reject an unused declared category, not just chart references.
                data["navigation"]["genres"].append(
                    {"id": "sega:Future category", "label": "Future"}
                )
                raw = canonical(data)
                sha = hashlib.sha256(raw).hexdigest()
                path = f"catalogs/{sha}.json"
                (self.source / path).write_bytes(raw)
                self.manifest["releases"] = [
                    {"version": "accepted-v1", "path": self.path, "sha256": self.sha},
                    {"version": "older-unreviewed", "path": path, "sha256": sha},
                ]
                atomic_json(self.source / "manifest.json", self.manifest)
                with self.assertRaisesRegex(ValueError, "Future category.*requires genre review"):
                    build_public_release(self.source, self.output)
                self.assertFalse(self.output.exists())

    def test_hosting_file_size_limit_is_checked_before_any_write(self):
        (self.source / "challenge-review.js").write_bytes(b" " * 4096)
        with patch("maimai_intelligence.public_release.MAX_PUBLIC_FILE_BYTES", 4095):
            with self.assertRaisesRegex(ValueError, "file size limit: challenge-review.js"):
                build_public_release(self.source, self.output)
        self.assertFalse(self.output.exists())
        with patch("maimai_intelligence.public_release.MAX_PUBLIC_FILE_BYTES", 4096):
            result = build_public_release(self.source, self.output)
        self.assertEqual(result["largest_file_bytes"], 4096)

    def test_hosting_file_count_includes_manifest_and_prevents_partial_output(self):
        result = build_public_release(self.source, self.root / "baseline")
        with patch("maimai_intelligence.public_release.MAX_PUBLIC_FILES", result["files"] - 1):
            with self.assertRaisesRegex(ValueError, "file count limit"):
                build_public_release(self.source, self.output)
        self.assertFalse(self.output.exists())

    def test_completed_and_partial_outputs_cannot_be_overwritten(self):
        build_public_release(self.source, self.output)
        with self.assertRaisesRegex(ValueError, "fresh release"):
            build_public_release(self.source, self.output)
        with self.assertRaisesRegex(ValueError, "separate"):
            build_public_release(self.source, self.source / "public")

    def test_interrupted_write_never_publishes_manifest(self):
        with patch("maimai_intelligence.public_release.atomic_json", side_effect=OSError("disk")):
            with self.assertRaises(OSError):
                build_public_release(self.source, self.output)
        self.assertFalse((self.output / "manifest.json").exists())
        with self.assertRaisesRegex(ValueError, "fresh release"):
            build_public_release(self.source, self.output)

    def test_traversal_cannot_select_unlisted_files(self):
        self.manifest["releases"][0]["path"] = "../personal.json"
        atomic_json(self.source / "manifest.json", self.manifest)
        with self.assertRaisesRegex(ValueError, "identity"):
            build_public_release(self.source, self.output)
        self.assertFalse(self.output.exists())

    @unittest.skipUnless(shutil.which("node"), "Node.js is optional outside browser CI")
    def test_loader_reconstructs_bytes_and_rejects_unsafe_or_damaged_parts(self):
        # DOM-free unit harness: no browser is launched and no network is contacted.
        script = r"""
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {webcrypto,createHash}=require('node:crypto');
const loader=fs.readFileSync(process.argv[1],'utf8');
const hash=b=>createHash('sha256').update(b).digest('hex');
const bytes=Buffer.from(JSON.stringify({catalog:['日本語'],package:{status:'research_preview'}}));
const cut=bytes.indexOf(Buffer.from('日'))+1; // deliberately split a UTF-8 character
const fragments=[bytes.subarray(0,cut),bytes.subarray(cut)];
const parts=fragments.map(b=>(
  {path:`catalog-parts/${hash(b)}.json`,sha256:hash(b),bytes:b.length}));
const entry={version:'v1',sha256:hash(bytes),path:`catalogs/${hash(bytes)}.json`,parts};
async function run(change=()=>{},alter=()=>{}){
  const manifest=JSON.parse(JSON.stringify({schema_version:'1.1.0',default:'v1',releases:[entry]}));
  change(manifest);
  const requests=[],appended=[],status={textContent:''};
  const assets=Object.fromEntries(parts.map((p,i)=>[p.path,fragments[i]]));
  assets[entry.path]=bytes;alter(assets);
  const scope={window:{},crypto:webcrypto,Uint8Array,TextDecoder,URL,URLSearchParams,
    location:{href:'http://localhost/?left=chart-id',search:'?left=chart-id'},
    history:{replaceState(...args){scope.pinned=args[2].href;}},
    document:{getElementById(){return status;},createElement(){return {};},
      body:{append(e){appended.push(e);}}},
    fetch:async(path,options)=>{
      assert.deepEqual(JSON.parse(JSON.stringify(options)),{credentials:'omit',redirect:'error'});
      requests.push(path);
      const body=path==='manifest.json'?Buffer.from(JSON.stringify(manifest)):assets[path];
      return new Response(body||'missing',{status:body?200:404});
    }};
  await vm.runInNewContext(loader,scope);
  return {status:status.textContent,requests,appended,pinned:scope.pinned,
    catalog:scope.window.maimaiResearchCatalog};
}
(async()=>{
  let r=await run();assert.equal(r.appended.length,1);
  assert.equal(r.appended[0].src,'challenge-review.js');
  assert.equal(JSON.stringify(r.catalog),bytes.toString('utf8'));
  assert.equal(r.pinned,undefined); // Clean/latest URLs must not acquire a version pin.
  assert(!r.requests.some(p=>p.includes('chart-id')));
  r=await run(m=>{m.schema_version='1.0.0';delete m.releases[0].parts;});
  assert.equal(r.appended.length,1);assert(r.requests.includes(entry.path));
  for(const change of [m=>m.schema_version='9.0.0',m=>m.releases[0].parts=[],
    m=>m.releases[0].parts[0].path='https://example.org/private',
    m=>m.releases[0].parts[0].bytes=8*1024*1024+1,
    m=>m.releases[0].sha256='0'.repeat(64),
    m=>m.releases[0].parts[0].bytes+=1]){
    r=await run(change);assert.equal(r.appended.length,0);assert(r.status);
  }
  for(const alter of [a=>delete a[parts[0].path],
    a=>a[parts[0].path]=Buffer.alloc(fragments[0].length)]){
    r=await run(()=>{},alter);assert.equal(r.appended.length,0);assert(r.status);
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
"""
        loader = self.root / "loader.js"
        loader.write_text(
            (Path(__file__).parent / "fixtures" / "legacy-lab-loader.js").read_text("utf-8"),
            encoding="utf-8",
        )
        result = subprocess.run(  # noqa: S603
            [shutil.which("node"), "-e", script, str(loader)],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
