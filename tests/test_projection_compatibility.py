"""Behavior fingerprints captured before the projection rewrite at a47e885."""

import hashlib
import json
import unittest
from pathlib import Path

from maimai_analyzer.challenge import profile_chart
from maimai_analyzer.fixtures import synthetic_charts
from maimai_intelligence.catalog_loading import progressive_catalog, shared_catalog
from maimai_intelligence.overview_codec import compact_overview
from maimai_intelligence.research_overview import chart_overview, overview_package
from maimai_intelligence.snapshots import canonical


def projection_cases():
    charts = synthetic_charts()
    for compact in (False, True):
        overview = overview_package({c["chart_id"]: chart_overview(c) for c in charts})
        if compact:
            overview = compact_overview(overview)
        yield (
            ("compact" if compact else "full"),
            {
                "catalog": [profile_chart(c) for c in charts],
                "analysis": overview,
                "snippets": {charts[0]["chart_id"]: {"example": {"events": []}}},
                "package": {"status": "research_preview"},
                "provider_mapping": {
                    "charts": {
                        "provider:1": {
                            "chart_id": charts[0]["chart_id"],
                            "source_hash": "a" * 64,
                            "format": "STD",
                            "difficulty": "EXPERT",
                            "title": "Evidence only",
                        }
                    },
                    "unmatched": [{"chartID": "unmatched", "reason": "unmatched"}],
                },
            },
        )
    yield (
        "metadata-only",
        {
            "schema_version": "maimai-browser-catalog-2",
            "catalog": [
                {
                    "chart_id": "chart",
                    "song_id": "song",
                    "title": "A",
                    "artist": "B",
                    "regional": {
                        "JP": {
                            "listing": "listed",
                            "level": "12",
                            "metadata": {
                                "title": "A",
                                "artist": "B",
                                "image_url": "https://example.invalid/art",
                            },
                        }
                    },
                }
            ],
            "navigation": {"charts": {"chart": {"constant": 12.3}}},
            "maishift_mapping": {
                "charts": {
                    "maishift:jp:1": {
                        "chart_id": "chart",
                        "snapshot_id": "a" * 64,
                        "expected_source": {"title": "A", "artist": "B"},
                    }
                }
            },
        },
    )


def fingerprint(result):
    reference, assets = result
    return {
        "reference": reference,
        "closure": hashlib.sha256(
            canonical({path: hashlib.sha256(raw).hexdigest() for path, raw in assets.items()})
        ).hexdigest(),
    }


class ProjectionCompatibilityTests(unittest.TestCase):
    def test_existing_projection_and_shared_detail_bytes_are_unchanged(self):
        expected = json.loads(
            (Path(__file__).parent / "fixtures/catalog-projection-baseline.json").read_text()
        )
        for name, data in projection_cases():
            with self.subTest(name=name):
                before = canonical(data)
                sha = hashlib.sha256(before).hexdigest()
                self.assertEqual(
                    fingerprint(progressive_catalog(data, sha)), expected["cases"][name]["legacy"]
                )
                self.assertEqual(
                    fingerprint(shared_catalog(data, sha)), expected["cases"][name]["shared"]
                )
                self.assertEqual(canonical(data), before)
