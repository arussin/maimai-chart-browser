"""Song projections preserve accepted evidence and exclude unrelated public records."""

import copy
import hashlib
import json
import re
import unittest

from maimai_intelligence.overview_codec import expand_tags
from maimai_intelligence.seo import build_seo
from maimai_intelligence.serialization import canonical
from maimai_intelligence.song_catalog import prepare_song_catalog
from tests.test_seo import catalog


class SongCatalogTests(unittest.TestCase):
    def fixture(self):
        data = catalog()
        data["schema_version"] = "maimai-browser-catalog-2"
        chosen, other = data["catalog"][0], data["catalog"][-1]
        cid, oid = chosen["chart_id"], other["chart_id"]
        data["provider_mapping"] = {
            "schema_version": "provider-mapping-2",
            "charts": {
                "a": {"chart_id": cid, "source_hash": chosen["source_hash"]},
                "b": {"chart_id": oid},
            },
            "unmatched": ["private-acquisition-diagnostic"],
        }
        data["maishift_mapping"] = {
            "schema_version": "maishift-mapping-1",
            "charts": {"a": {"chart_id": cid, "snapshot_id": "capture"}, "b": {"chart_id": oid}},
        }
        data["mai_notes"] = {
            "version": "mai-notes-links-2",
            "charts": {cid: {"id": "one"}, oid: {"id": "two"}},
        }
        data["snippets"] = {cid: {"fixture": 1}, oid: {"fixture": 2}}
        data["analysis"] = {
            "version": "research-overview-2",
            "representation": "sparse-tags-3",
            "patterns": ["p"],
            "evidence_pool": [{"unused": 0}, {"used": 1}],
            "charts": {
                cid: {
                    "source_hash": chosen["source_hash"],
                    "tags": [[0, 5, 2, 0.5, [[0, 1]], [1, 1]]],
                    "segments": [[0, 1, 1, 1, 1]],
                },
                oid: {"tags": []},
            },
        }
        data["artwork"] = {
            "version": "public-artwork-1",
            "songs": {
                chosen["song_id"]: {"path": "jacket", "regions": {"INTL": {"path": "intl"}}},
                other["song_id"]: {"path": "unrelated"},
            },
            "versions": {"v": "version"},
            "assets": {k: {} for k in ("jacket", "intl", "version", "unrelated")},
        }
        return data, chosen

    def test_scoped_records_are_detached_and_analysis_is_lossless(self):
        data, chart = self.fixture()
        before = canonical(data)
        envelope = prepare_song_catalog(data, chart["song_id"], [chart], "a" * 64)
        value = envelope["data"]
        self.assertEqual(canonical(data), before)
        self.assertEqual(len(value["catalog"]), 1)
        for name in ("navigation", "analysis", "mai_notes"):
            self.assertEqual(set(value[name]["charts"]), {chart["chart_id"]})
        for name in ("provider_mapping", "maishift_mapping"):
            self.assertEqual(set(value[name]["charts"]), {"a"})
        self.assertNotIn("unmatched", value["provider_mapping"])
        self.assertNotIn("snapshot_id", value["maishift_mapping"]["charts"]["a"])
        self.assertEqual(set(value["artwork"]["assets"]), {"jacket", "intl", "version"})
        self.assertEqual(value["analysis"]["evidence_pool"], [{"used": 1}])
        original, selected = data["analysis"], value["analysis"]
        self.assertEqual(
            expand_tags(original["charts"][chart["chart_id"]], 1, original["evidence_pool"]),
            expand_tags(selected["charts"][chart["chart_id"]], 1, selected["evidence_pool"]),
        )
        value["catalog"][0]["title"] = "changed"
        self.assertEqual(canonical(data), before)

    def test_historical_dense_evidence_is_preserved_without_a_pool(self):
        data, chart = self.fixture()
        data["schema_version"] = "maimai-browser-catalog-1"
        data["analysis"] = {
            "version": "research-overview-1",
            "patterns": ["p"],
            "charts": {
                chart["chart_id"]: {
                    "source_hash": chart["source_hash"],
                    "tags": [
                        [0, "detected", 1, 0.5, "partial", False, [[0, 1]], [{"dense": True}]]
                    ],
                }
            },
        }
        before = canonical(data)
        result = prepare_song_catalog(data, chart["song_id"], [chart], "a" * 64)
        self.assertEqual(result["data"]["analysis"], data["analysis"])
        self.assertEqual(canonical(data), before)

    def test_duplicate_empty_and_invalid_evidence_are_rejected(self):
        data, chart = self.fixture()
        for charts in ([], [chart, chart]):
            with self.assertRaisesRegex(ValueError, "unique accepted"):
                prepare_song_catalog(data, chart["song_id"], charts, "a" * 64)
        for invalid in (-1, 2, True, "1"):
            changed = copy.deepcopy(data)
            changed["analysis"]["charts"][chart["chart_id"]]["tags"][0][5] = [invalid]
            with self.assertRaisesRegex(ValueError, "evidence index"):
                prepare_song_catalog(changed, chart["song_id"], [chart], "a" * 64)

    def test_locales_share_one_content_addressed_song_asset(self):
        data = catalog()
        assets, _, summary = build_seo(data, catalog_sha="b" * 64)
        song_assets = {
            name: raw for name, raw in assets.items() if name.startswith("song-catalog/")
        }
        self.assertEqual(len(song_assets), summary["songs"])
        for name, raw in song_assets.items():
            self.assertEqual(name, "song-catalog/" + hashlib.sha256(raw).hexdigest() + ".json")
            value = json.loads(raw)
            self.assertEqual(value["data"]["source_catalog_sha256"], "b" * 64)
            pages = [
                raw.decode()
                for path, raw in assets.items()
                if path.endswith("index.html") and f'data-song-catalog="{name}"' in raw.decode()
            ]
            self.assertEqual(len(pages), 4)
            self.assertTrue(all(re.search(f'data-song-bytes="{len(raw)}"', page) for page in pages))
