"""The public-ID projection is deterministic, bounded and never guesses identity."""

import copy
import hashlib
import json
import unittest

from scripts.build_dxrating_metadata import build


class DXRatingMetadataTests(unittest.TestCase):
    def setUp(self):
        self.data = {
            "schemaVersion": 1,
            "updatedAt": "2026-11-24T00:00:00Z",
            "songs": [
                {
                    "id": "dsng_23456789ab",
                    "title": "Synthetic title",
                    "artist": "Synthetic artist",
                    "sheets": [{"id": "dsht_23456789ab", "type": "dx", "difficulty": "master"}],
                }
            ],
        }

    def project(self, data=None):
        return build(json.dumps(self.data if data is None else data).encode(), "2026-11-24")

    def test_provenance_and_projection(self):
        raw = json.dumps(self.data).encode()
        result = self.project()
        self.assertEqual(result["sources"][0]["sha256"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(result["sheets"], {"dsht_23456789ab": [0, "dx", "master"]})
        self.assertEqual(
            result["songs"], [["dsng_23456789ab", "Synthetic title", "Synthetic artist"]]
        )
        self.assertEqual(result["capturedOn"], "2026-11-24")
        self.assertEqual(result, self.project())

    def test_does_not_drop_removed_utage_or_empty_artist(self):
        song = self.data["songs"][0]
        song["artist"] = ""
        song["sheets"][0].update(type="utage", difficulty="【宴】", serverIds=[])
        self.assertEqual(self.project()["sheets"]["dsht_23456789ab"], [0, "utage", "【宴】"])

    def test_rejects_duplicate_invalid_and_legacy_identities(self):
        for mutation in (
            "duplicate-song",
            "duplicate-sheet",
            "bad-song",
            "bad-sheet",
            "legacy",
            "empty",
        ):
            with self.subTest(mutation=mutation):
                data = copy.deepcopy(self.data)
                song = data["songs"][0]
                if mutation == "duplicate-song":
                    data["songs"].append(copy.deepcopy(song))
                elif mutation == "duplicate-sheet":
                    song["sheets"].append(copy.deepcopy(song["sheets"][0]))
                elif mutation == "bad-song":
                    song["id"] = "dsng_0000000000"
                elif mutation == "bad-sheet":
                    song["sheets"][0]["id"] = "dsht_0000000000"
                elif mutation == "legacy":
                    del data["schemaVersion"]
                else:
                    data["songs"] = []
                with self.assertRaises(ValueError):
                    self.project(data)
