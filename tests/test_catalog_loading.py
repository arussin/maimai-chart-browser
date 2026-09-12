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
            }
            before = canonical(data)
            digest = hashlib.sha256(before).hexdigest()
            startup, assets = progressive_catalog(data, digest)
            self.assertEqual(canonical(data), before)
            index = json.loads(assets[startup["path"]])
            self.assertLess(startup["bytes"], len(before))
            self.assertEqual(index["source_catalog_sha256"], digest)
            self.assertEqual(index["snippets"], {})
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
