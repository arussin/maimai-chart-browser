"""Release membership remains validated when song bytes are shared across releases."""

import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from maimai_intelligence.public_release import _retain_song_index
from maimai_intelligence.seo import prepare_seo
from maimai_intelligence.serialization import canonical
from maimai_intelligence.song_catalog import validate_song_binding, validate_song_membership
from tests.test_seo import catalog


class SongBindingTests(unittest.TestCase):
    def setUp(self):
        self.catalog = catalog()
        self.sha = hashlib.sha256(canonical(self.catalog)).hexdigest()
        self.prepared = prepare_seo(self.catalog, catalog_sha=self.sha)
        self.binding = self.prepared.song_bindings[0]
        self.content = json.loads(self.prepared.assets[self.binding["path"]])

    def test_prepared_bindings_and_redirects_preserve_canonical_membership(self):
        for binding in self.prepared.song_bindings:
            content = json.loads(self.prepared.assets[binding["path"]])
            validate_song_binding(binding, self.sha, content)
            validate_song_membership(content, self.catalog)
        redirected = prepare_seo(
            self.catalog, song_redirects={"song:one": "song:two"}, catalog_sha=self.sha
        )
        binding = next(row for row in redirected.song_bindings if row["song_id"] == "song:two")
        content = json.loads(redirected.assets[binding["path"]])
        self.assertEqual(content["source_song_ids"], ["song:one", "song:two"])
        validate_song_binding(binding, self.sha, content)
        validate_song_membership(content, self.catalog)
        self.assertEqual(
            {c["song_id"] for c in content["data"]["catalog"]}, {"song:one", "song:two"}
        )

    def test_stale_or_forged_binding_and_invalid_content_scope_are_rejected(self):
        cases = [
            ("schema_version", "future"),
            ("source_catalog_sha256", "0" * 64),
            ("source_song_ids", None),
            ("source_song_ids", []),
            ("source_song_ids", ["x"] * 257),
            ("source_song_ids", [True]),
            ("source_song_ids", [""]),
            ("source_song_ids", [self.content["song_id"]] * 2),
            ("song_id", "absent"),
        ]
        for key, value in cases:
            with self.subTest(key=key, value=value), self.assertRaisesRegex(ValueError, "binding"):
                validate_song_binding({**self.binding, key: value}, self.sha, self.content)
        for key, value in (
            ("schema_version", "maimai-song-catalog-1"),
            ("song_id", "other"),
            ("source_song_ids", ["foreign"]),
            ("data", None),
            ("data", {**self.content["data"], "source_catalog_sha256": self.sha}),
        ):
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "binding"):
                validate_song_binding(self.binding, self.sha, {**self.content, key: value})

    def test_hash_valid_content_cannot_add_drop_duplicate_or_change_accepted_charts(self):
        charts = self.content["data"]["catalog"]
        bad_charts = [
            None,
            [],
            [None],
            [{"chart_id": 1}],
            charts[:-1],
            charts + [charts[0]],
            [{**c, "title": "forged"} for c in charts],
            [charts[0]] * len(charts),
        ]
        for value in bad_charts:
            bad = copy.deepcopy(self.content)
            bad["data"]["catalog"] = value
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "membership"):
                validate_song_membership(bad, self.catalog)
        bad = copy.deepcopy(self.content)
        bad["source_song_ids"].append("absent")
        with self.assertRaisesRegex(ValueError, "membership"):
            validate_song_membership(bad, self.catalog)

    def test_retained_v1_bytes_and_new_bindings_are_verified_without_rewriting(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)

            def save(prefix, value):
                raw = canonical(value)
                digest = hashlib.sha256(raw).hexdigest()
                name = f"{prefix}/{digest}.json"
                (root / prefix).mkdir(exist_ok=True)
                (root / name).write_bytes(raw)
                return {"path": name, "sha256": digest, "bytes": len(raw)}

            legacy = copy.deepcopy(self.content)
            legacy["schema_version"] = "maimai-song-catalog-1"
            legacy["data"]["source_catalog_sha256"] = self.sha
            old_asset = save("song-catalog", legacy)
            old_index = save(
                "song-catalog-index",
                {
                    "schema_version": "maimai-song-catalog-index-1",
                    "source_catalog_sha256": self.sha,
                    "assets": [old_asset],
                },
            )
            pending = {}
            _retain_song_index(root, old_index, self.sha, pending, self.catalog)
            self.assertEqual(pending[old_asset["path"]], canonical(legacy))
            new_asset = save("song-catalog", self.content)
            self.assertEqual(new_asset["path"], self.binding["path"])

            def retain(bindings, expected=self.sha, data=None):
                index = save(
                    "song-catalog-index",
                    {
                        "schema_version": "maimai-song-catalog-index-2",
                        "source_catalog_sha256": expected,
                        "assets": bindings,
                    },
                )
                return _retain_song_index(root, index, expected, {}, data or self.catalog)

            retain([self.binding])
            with self.assertRaisesRegex(ValueError, "binding"):
                retain([self.binding], expected="b" * 64)
            changed = copy.deepcopy(self.catalog)
            for chart in changed["catalog"]:
                chart["title"] = "A different accepted catalog"
            with self.assertRaisesRegex(ValueError, "membership"):
                retain([{**self.binding, "source_catalog_sha256": "b" * 64}], "b" * 64, changed)
            with self.assertRaisesRegex(ValueError, "Duplicate"):
                retain([self.binding, self.binding])
            (root / new_asset["path"]).write_bytes(b"tampered")
            with self.assertRaisesRegex(ValueError, "integrity"):
                retain([self.binding])
            (root / new_asset["path"]).unlink()
            with self.assertRaises((ValueError, FileNotFoundError)):
                retain([self.binding])


if __name__ == "__main__":
    unittest.main()
