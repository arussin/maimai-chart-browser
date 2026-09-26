import hashlib
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from maimai_analyzer.challenge import profile_chart
from maimai_analyzer.fixtures import synthetic_charts
from maimai_intelligence.catalog_loading import progressive_catalog
from maimai_intelligence.lab import build_lab
from maimai_intelligence.overview_codec import compact_overview, expand_tags
from maimai_intelligence.public_release import build_public_release
from maimai_intelligence.research_overview import chart_overview, overview_package
from maimai_intelligence.snapshots import canonical
from tests.lab_fixture import write_package


class ProgressiveCatalogTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "Node.js is optional outside browser CI")
    def test_loader_defers_verifies_deduplicates_and_retries_detail_reads(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            build_lab(write_package(root / "package"), root / "lab", catalog_version="v1")
            build_public_release(root / "lab", root / "public")
            result = subprocess.run(  # noqa: S603
                [
                    shutil.which("node"),
                    str(Path(__file__).with_name("progressive_loader.cjs")),
                    str(root / "public"),
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)

    @unittest.skipUnless(shutil.which("node"), "Node.js is optional outside browser CI")
    def test_shared_loader_uses_the_same_identity_integrity_and_retry_contract(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            build_lab(write_package(root / "package"), root / "lab", catalog_version="v1")
            build_public_release(root / "lab", root / "public")
            result = subprocess.run(  # noqa: S603
                [
                    shutil.which("node"),
                    str(Path(__file__).with_name("progressive_loader.cjs")),
                    str(root / "public"),
                    "--shared",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_inventory_startup_keeps_regional_choices_without_duplicate_audit_fields(self):
        data = {
            "schema_version": "maimai-browser-catalog-2",
            "catalog": [
                {
                    "chart_id": "official-chart",
                    "title": "Japan title",
                    "aliases": ["romaji"],
                    "input_id": "retained-offline-input",
                    "capabilities": {"metadata": "available", "similarity": "missing"},
                    "regional": {
                        region: {
                            "listing": "listed",
                            "level": level,
                            "genre": "pop",
                            "version": "latest",
                            "observed_at": "2026-09-17",
                            "snapshot_id": "a" * 64,
                            "metadata": {
                                "title": title,
                                "artist": "Artist",
                                "catcode": "POPS",
                                "version": "12345",
                                "title_kana": "reading",
                                "image_url": "https://example.org/jacket.png",
                            },
                        }
                        for region, level, title in (
                            ("JP", "8", "Japan title"),
                            ("INTL", "7", "International title"),
                        )
                    },
                }
            ],
            "navigation": {
                "charts": {
                    "official-chart": {
                        "regional_metrics": {"constant": {"JP": 8.2, "INTL": 7.4}},
                        "regional_metric_sources": {
                            "constant": {"JP": "reviewed-jp", "INTL": "reviewed-intl"}
                        },
                    }
                }
            },
            "maishift_mapping": {
                "schema_version": "maishift-mapping-1",
                "provider": "maishift",
                "game": "maimai",
                "charts": {
                    f"maishift:{region}:42": {
                        "chart_id": "official-chart",
                        "acceptance_basis": "reviewed",
                        "expected_source": {
                            "title": f"{region} title",
                            "artist": "Artist",
                            "format": "DX",
                            "difficulty": "EXPERT",
                        },
                        "snapshot_id": "a" * 64,
                    }
                    for region in ("jp", "intl")
                },
            },
        }
        before = canonical(data)
        startup, assets = progressive_catalog(data, hashlib.sha256(before).hexdigest())
        index = json.loads(assets[startup["path"]])
        self.assertEqual(canonical(data), before)
        self.assertEqual(index["navigation"], data["navigation"])
        chart = index["catalog"][0]
        self.assertEqual(chart["aliases"], ["romaji"])
        self.assertNotIn("input_id", chart)
        self.assertNotIn("capabilities", chart)
        mapping = index["maishift_mapping"]
        self.assertEqual(set(mapping["charts"]), set(data["maishift_mapping"]["charts"]))
        for provider_id, original in data["maishift_mapping"]["charts"].items():
            self.assertEqual(
                mapping["charts"][provider_id],
                {key: value for key, value in original.items() if key != "snapshot_id"},
            )
        for region, original in data["catalog"][0]["regional"].items():
            projected = chart["regional"][region]
            for field in ("listing", "level", "genre", "version"):
                self.assertEqual(projected[field], original[field])
            for field in ("title", "artist", "catcode", "version"):
                self.assertEqual(projected["metadata"][field], original["metadata"][field])
            self.assertNotIn("snapshot_id", projected)
            self.assertNotIn("observed_at", projected)
            self.assertNotIn("image_url", projected["metadata"])
        self.assertLess(startup["bytes"], len(before))

    def test_index_preserves_rankings_coverage_and_all_details_losslessly(self):
        charts = synthetic_charts()
        for sparse in (False, True):
            overview = overview_package({c["chart_id"]: chart_overview(c) for c in charts})
            if sparse:
                overview = compact_overview(overview)
            data = {
                "catalog": [profile_chart(c) for c in charts],
                "analysis": overview,
                "snippets": {charts[0]["chart_id"]: {"example": {"events": []}}},
                "provider_mapping": {
                    "charts": {
                        "synthetic-provider": {
                            "chart_id": charts[0]["chart_id"],
                            "source_hash": "a" * 64,
                            "format": "STD",
                            "difficulty": "EXPERT",
                            "title": "Provider title used by report generation",
                        }
                    },
                    "unmatched": [{"chartID": "unmatched-provider", "reason": "unmatched"}],
                },
            }
            before = canonical(data)
            digest = hashlib.sha256(before).hexdigest()
            startup, assets = progressive_catalog(data, digest)
            self.assertEqual(canonical(data), before)
            index = json.loads(assets[startup["path"]])
            self.assertLess(startup["bytes"], len(before))
            self.assertEqual(index["source_catalog_sha256"], digest)
            self.assertEqual(index["snippets"], {})
            self.assertNotIn("unmatched", index["provider_mapping"])
            self.assertEqual(
                index["provider_mapping"]["charts"]["synthetic-provider"]["chart_id"],
                charts[0]["chart_id"],
            )
            for original, summary in zip(data["catalog"], index["catalog"], strict=True):
                for key in ("demand", "song_family", "source_hash", "chart_id", "version"):
                    self.assertEqual(summary.get(key), original.get(key))
                cid = original["chart_id"]
                reference = index["detail_buckets"][summary["detail_bucket"]]
                raw = assets[reference["path"]]
                self.assertEqual(len(raw), reference["bytes"])
                self.assertEqual(hashlib.sha256(raw).hexdigest(), reference["sha256"])
                detail = json.loads(raw)
                record = overview["charts"][cid]
                self.assertEqual(detail["charts"][cid], record)
                self.assertEqual(detail["identities"][cid], original["source_hash"])
                self.assertEqual(detail["source_catalog_sha256"], digest)
                self.assertEqual(detail["snippets"].get(cid), data["snippets"].get(cid))
                projected = index["analysis"]["charts"][cid]
                rows = expand_tags(record, len(overview["patterns"]), overview.get("evidence_pool"))
                summaries = expand_tags(
                    projected, len(overview["patterns"]), overview.get("evidence_pool")
                )
                self.assertEqual([t[:6] for t in rows], [t[:6] for t in summaries])
                self.assertEqual(projected["span"], record["span"])
                self.assertEqual(projected["segments"], [])
                peaks = [s[3] for s in record["segments"] if s[3] is not None and s[4] > 0]
                self.assertEqual(projected["flow_peak"], max(peaks) if peaks else None)
            self.assertEqual(progressive_catalog(data, digest), (startup, assets))
