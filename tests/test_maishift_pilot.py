import hashlib
import json
import re
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory, gettempdir
from unittest.mock import patch

from maimai_intelligence.localization import localization_script
from maimai_intelligence.public_release import MAX_PUBLIC_FILE_BYTES, MAX_PUBLIC_FILES
from scripts.build_maishift_pilot import build, pilot_headers, prepare_browser_catalogs


class MaishiftPilotArtifactTests(unittest.TestCase):
    def test_rich_inventory_keeps_progressive_startup_within_hosting_budget(self):
        # Scaled production shape: audit fields must not force the loader back
        # to a full catalog download when the browsing projection fits.
        catalog = {
            "schema_version": "maimai-browser-catalog-2",
            "catalog": [
                {
                    "chart_id": "fictional-chart",
                    "title": "Fictional title",
                    "format": "DX",
                    "difficulty": "MASTER",
                    "input_id": "retained-source-input",
                    "capabilities": {
                        field: "available"
                        for field in (
                            "metadata",
                            "artwork",
                            "constant",
                            "flow",
                            "patterns",
                            "aliases",
                            "similarity",
                            "transcription",
                            "provider_mapping",
                            "player_link",
                        )
                    },
                }
            ],
            "maishift_mapping": {
                "schema_version": "maishift-mapping-1",
                "charts": {
                    "maishift:intl:42": {
                        "chart_id": "fictional-chart",
                        "acceptance_basis": "reviewed",
                        "expected_source": {
                            "title": "Fictional title",
                            "artist": "Artist",
                            "format": "DX",
                            "difficulty": "MASTER",
                        },
                        "snapshot_id": "a" * 64,
                    }
                },
            },
        }
        raw = json.dumps(catalog, separators=(",", ":")).encode()
        sha = hashlib.sha256(raw).hexdigest()
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "catalogs").mkdir()
            (root / f"catalogs/{sha}.json").write_bytes(raw)
            (root / "manifest.json").write_text(
                json.dumps(
                    {
                        "releases": [
                            {
                                "path": f"catalogs/{sha}.json",
                                "sha256": sha,
                                "inventory_schema": "maimai-browser-catalog-2",
                            }
                        ],
                    }
                )
            )
            with (
                patch("scripts.build_maishift_pilot.MAX_PUBLIC_FILE_BYTES", 700),
                patch("scripts.build_maishift_pilot.PART_BYTES", 256),
            ):
                prepare_browser_catalogs(root)
            release = json.loads((root / "manifest.json").read_bytes())["releases"][0]
            self.assertIn("startup", release)
            self.assertLessEqual(release["startup"]["bytes"], 700)
            self.assertGreater(len(raw), 700)
            complete = b"".join((root / part["path"]).read_bytes() for part in release["parts"])
            self.assertEqual(complete, raw)
            index = json.loads((root / release["startup"]["path"]).read_bytes())
            self.assertEqual(index["source_catalog_sha256"], sha)
            self.assertEqual(
                index["maishift_mapping"]["charts"]["maishift:intl:42"],
                {
                    key: value
                    for key, value in catalog["maishift_mapping"]["charts"][
                        "maishift:intl:42"
                    ].items()
                    if key != "snapshot_id"
                },
            )

    def test_pilot_cache_rules_do_not_overlap_or_cover_private_endpoints(self):
        rules = []
        for line in pilot_headers().splitlines():
            if not line.startswith(" "):
                rules.append((line, {}))
            else:
                name, value = line.strip().split(": ", 1)
                rules[-1][1][name] = value

        def headers(path):
            result = {}
            for pattern, values in rules:
                expression = re.escape(pattern).replace(r"\*", ".*").replace(":asset", "[^/]+")
                if re.fullmatch(expression, path):
                    for name, value in values.items():
                        result.setdefault(name, []).append(value)
            return result

        for path in (
            "/pilot/maishift/",
            "/pilot/maishift/index.html",
            "/pilot/maishift/mapping.json",
            "/pilot/maishift/browser",
            "/pilot/maishift/browser/",
            "/pilot/maishift/browser/index.html",
            "/pilot/maishift/browser/manifest.json",
            "/pilot/maishift/browser/player-data.js",
        ):
            with self.subTest(path=path):
                actual = headers(path)
                expected_cache = "no-cache" if path.endswith("/") else "no-store"
                self.assertEqual(actual["Cache-Control"], [expected_cache])
                self.assertEqual(actual["Referrer-Policy"], ["no-referrer"])
                self.assertEqual(actual["X-Frame-Options"], ["DENY"])
        for folder in ("catalog-index", "catalog-parts", "chart-details", "media"):
            with self.subTest(folder=folder):
                actual = headers(f"/pilot/maishift/browser/{folder}/{'a' * 64}.json")
                self.assertEqual(actual["Cache-Control"], ["public, max-age=31536000, immutable"])
                self.assertEqual(actual["X-Robots-Tag"], ["noindex, nofollow"])
                self.assertEqual(actual["X-Frame-Options"], ["DENY"])
                self.assertEqual(len(actual["Content-Security-Policy"]), 1)
        for path in ("/api/player-import/maishift", "/party/latest.json", "/"):
            self.assertEqual(headers(path), {})

    def test_oversized_startup_uses_lossless_parts_without_oversized_assets(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            raw = json.dumps({"catalog": [{"chart_id": "fictional"}]}).encode()
            sha = hashlib.sha256(raw).hexdigest()
            (root / "catalogs").mkdir()
            (root / f"catalogs/{sha}.json").write_bytes(raw)
            (root / "manifest.json").write_text(
                json.dumps(
                    {
                        "releases": [{"path": f"catalogs/{sha}.json", "sha256": sha}],
                    }
                )
            )
            with (
                patch("scripts.build_maishift_pilot.MAX_PUBLIC_FILE_BYTES", 64),
                patch(
                    "scripts.build_maishift_pilot.progressive_catalog",
                    return_value=({"bytes": 65}, {"catalog-index/oversized.json": b"x" * 65}),
                ),
            ):
                prepare_browser_catalogs(root)
            release = json.loads((root / "manifest.json").read_bytes())["releases"][0]
            self.assertNotIn("startup", release)
            self.assertEqual(
                b"".join((root / p["path"]).read_bytes() for p in release["parts"]), raw
            )
            self.assertFalse((root / "catalog-index").exists())
            self.assertFalse((root / f"catalogs/{sha}.json").exists())

    @unittest.skipUnless(
        str(Path(gettempdir())).lower().startswith("c:\\devcache\\"),
        "Artifact integration runs in the approved Windows DevCache wrapper",
    )
    def test_artifact_is_isolated_exact_and_verifiable(self):
        # The development wrapper puts TemporaryDirectory under DevCache.
        with TemporaryDirectory() as directory:
            output = Path(directory) / "pilot-artifact"
            manifest = build(output)
            self.assertFalse(manifest["releaseEnabled"])
            self.assertEqual(manifest["entryPath"], "/pilot/maishift/")
            self.assertEqual(manifest["browserPath"], "/pilot/maishift/browser/")
            self.assertEqual(manifest["endpoint"], "/api/player-import/maishift")
            self.assertEqual(
                {p.relative_to(output).as_posix() for p in output.rglob("*") if p.is_file()},
                set(manifest["files"]) | {"pilot-artifact.json"},
            )
            for name, fingerprint in manifest["files"].items():
                self.assertLessEqual((output / name).stat().st_size, MAX_PUBLIC_FILE_BYTES)
                self.assertEqual(
                    hashlib.sha256((output / name).read_bytes()).hexdigest(), fingerprint
                )
                self.assertTrue(name.startswith("pilot/maishift/") or name == "_headers")
            self.assertLessEqual(len(manifest["files"]), MAX_PUBLIC_FILES)
            config = json.loads((output / "pilot/maishift/mapping.json").read_text("utf-8"))
            self.assertEqual(config["build"], manifest["build"])
            self.assertGreater(len(config["mapping"]["charts"]), 12000)
            self.assertEqual(
                {row["chart_id"] for row in config["mapping"]["charts"].values()},
                set(config["targets"]),
            )
            for target in config["targets"].values():
                self.assertEqual(set(target), {"chart_id", "format", "difficulty"})
            html = (output / "pilot/maishift/index.html").read_text("utf-8")
            self.assertNotIn("analytics", html)
            self.assertNotIn("player-data.js", html)
            translated = (output / "pilot/maishift/localization.js").read_text("utf-8")
            self.assertIn('"Maishift pilot test":', translated)
            self.assertNotIn('"Support maimai.party":', translated)
            headers = (output / "_headers").read_text("utf-8")
            self.assertTrue(headers.startswith("/pilot/maishift/*\n"))
            self.assertIn("Referrer-Policy: no-referrer", headers)
            self.assertEqual(headers, pilot_headers())
            self.assertIn("/pilot/maishift/browser/:asset\n  Cache-Control: no-store", headers)
            self.assertIn("/pilot/maishift/index.html\n  Content-Security-Policy:", headers)
            browser = output / "pilot/maishift/browser"
            browser_html = (browser / "index.html").read_text("utf-8")
            self.assertIn('src="maishift-browser-pilot.js?', browser_html)
            self.assertNotIn('src="analytics.js', browser_html)
            self.assertNotIn('src="feature-announcements.js', browser_html)
            self.assertNotIn('src="support-', browser_html)
            self.assertIn("noindex,nofollow", browser_html)
            self.assertFalse((browser / "version-magical.png").exists())
            browser_manifest = json.loads((browser / "manifest.json").read_text("utf-8"))
            self.assertEqual(browser_manifest["schema_version"], "1.3.0")
            release = browser_manifest["releases"][0]
            self.assertNotIn("integration", release)
            self.assertFalse((browser / release["path"]).exists())
            parts = []
            for ref in release["parts"]:
                raw = (browser / ref["path"]).read_bytes()
                self.assertEqual(len(raw), ref["bytes"])
                self.assertEqual(hashlib.sha256(raw).hexdigest(), ref["sha256"])
                parts.append(raw)
            complete = b"".join(parts)
            self.assertEqual(hashlib.sha256(complete).hexdigest(), release["sha256"])
            catalog = json.loads(complete)
            startup = release["startup"]
            raw = (browser / startup["path"]).read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(), startup["sha256"])
            index = json.loads(raw)
            self.assertEqual(
                index["maishift_mapping"],
                {
                    **catalog["maishift_mapping"],
                    "charts": {
                        cid: {key: value for key, value in row.items() if key != "snapshot_id"}
                        for cid, row in catalog["maishift_mapping"]["charts"].items()
                    },
                },
            )
            self.assertEqual(
                [r["chart_id"] for r in index["catalog"]],
                [r["chart_id"] for r in catalog["catalog"]],
            )
            self.assertEqual(len(catalog["artwork"]["versions"]), 28)
            for path in catalog["artwork"]["versions"].values():
                self.assertTrue(path.startswith("media/"))
                self.assertTrue((browser / path).is_file())
            self.assertTrue((browser / "maishift-favicon.ico").is_file())
            for locale in ("en", "zh-Hans", "ko", "ja"):
                help_html = (browser / f"player-import-help.{locale}.html").read_text("utf-8")
                self.assertIn(f'<html lang="{locale}">', help_html)
                self.assertIn('id="session-report"', help_html)
                self.assertIn('id="maishift"', help_html)
                self.assertNotIn("<script", help_html)
            self.assertNotIn(
                "function seen(id)", (browser / "challenge-review.js").read_text("utf-8")
            )
            with self.assertRaisesRegex(ValueError, "never overwrite"):
                build(output)

    def test_builder_rejects_canonical_source_as_output(self):
        with self.assertRaisesRegex(ValueError, "DevCache"):
            build(Path("C:/Dev/maimai/maimai-chart-browser-registry"))

    def test_localization_subset_keeps_validation_and_default_behavior(self):
        self.assertIn('"Support maimai.party":', localization_script())
        script = localization_script(sources={"Game region"})
        self.assertIn('"Game region":', script)
        self.assertNotIn('"Support maimai.party":', script)
        with self.assertRaises(KeyError):
            localization_script(sources={"Missing pilot translation"})
