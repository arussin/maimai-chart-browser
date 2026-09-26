"""Built-in provider schema failures must not hide authored parser defects."""

import hashlib
import json
import unittest
from unittest.mock import patch

from maimai_intelligence.catalog_sources import mai_catalog
from maimai_intelligence.coverage_types import SnapshotError
from maimai_intelligence.metadata_adapters import normalize_builtin
from maimai_intelligence.metadata_waterfall import propose
from maimai_intelligence.registry import empty
from tests.registry_fixture import admit, official_row
from tests.test_catalog_waterfall import wiki


class MetadataFailureBoundaryTests(unittest.TestCase):
    def test_builtin_parser_programming_errors_abort(self):
        for provider, target in (
            ("arcade-songs", "maimai_intelligence.metadata_adapters.parse_metadata"),
            ("otoge-db", "maimai_intelligence.metadata_adapters.parse_metadata"),
            ("reviewed-page", "maimai_intelligence.metadata_adapters.parse_metadata"),
            ("gamerch-wiki", "maimai_intelligence.catalog_sources.wiki_catalog"),
        ):
            for kind in (ValueError, TypeError, KeyError, AttributeError):
                error = kind("authored parser defect")
                with self.subTest(provider=provider, kind=kind), patch(target, side_effect=error):
                    with self.assertRaises(kind) as caught:
                        normalize_builtin(
                            provider, b"{}", {"url": "https://gamerch.com/maimai/123"}
                        )
                    self.assertIs(caught.exception, error)

    def test_mai_notes_parser_programming_errors_abort(self):
        for kind in (ValueError, TypeError, KeyError, AttributeError):
            error = kind("authored index defect")
            with (
                self.subTest(kind=kind),
                patch("maimai_intelligence.catalog_sources.parse_index", side_effect=error),
            ):
                with self.assertRaises(kind) as caught:
                    mai_catalog(b"{}")
                self.assertIs(caught.exception, error)

    def test_malformed_json_provider_structures_are_explicit_rejections(self):
        cases = {
            "arcade-songs": [
                None,
                [],
                {},
                {"songs": None},
                {"songs": [None]},
                {"songs": [{"sheets": [None]}]},
                {"songs": [{"sheets": [{"type": []}]}]},
                {"songs": [{"sheets": [{"type": "dx", "difficulty": 1}]}]},
            ],
            "reviewed-page": [
                None,
                [],
                {},
                {"schema_version": "reviewed-public-metadata-1"},
                {"schema_version": "reviewed-public-metadata-1", "charts": [None]},
                {
                    "schema_version": "reviewed-public-metadata-1",
                    "charts": [{"evidence": "source", "source_url": 123}],
                },
            ],
            "otoge-db": [None, {}, [None], [{"dx_lev_mas": "14"}]],
            "mai-notes": [
                None,
                [],
                {},
                {
                    "songs": {},
                    "charts": [None],
                    "songs_count": 0,
                    "charts_count": 1,
                    "generated_at": "2026-09-24T00:00:00Z",
                },
            ],
        }
        for provider, documents in cases.items():
            for document in documents:
                with self.subTest(provider=provider, document=document):
                    with self.assertRaises(SnapshotError):
                        normalize_builtin(provider, json.dumps(document).encode(), {})
            for raw in (b"not json", b"\xff"):
                with self.subTest(provider=provider, raw=raw), self.assertRaises(SnapshotError):
                    normalize_builtin(provider, raw, {})

    def test_invalid_wiki_encoding_is_a_schema_failure(self):
        with self.assertRaises(SnapshotError):
            normalize_builtin("gamerch-wiki", b"\xff", {"url": "https://gamerch.com/maimai/123"})

    def test_provider_resource_limits_are_input_rejections(self):
        for raw in (b"[" * 2000 + b"0" + b"]" * 2000, b"9" * 10000):
            for provider in ("arcade-songs", "otoge-db", "reviewed-page", "mai-notes"):
                with (
                    self.subTest(provider=provider, size=len(raw)),
                    self.assertRaises(SnapshotError),
                ):
                    normalize_builtin(provider, raw, {})
        with self.assertRaises(SnapshotError):
            normalize_builtin(
                "gamerch-wiki",
                b"<div>" * 110 + b"x" + b"</div>" * 110,
                {"url": "https://gamerch.com/maimai/123"},
            )

    def test_malformed_optional_wiki_url_is_a_schema_failure(self):
        for href in ("https://[broken", "https://example.invalid／evil"):
            raw = wiki() + ('<a href="' + href + '">simai</a>').encode()
            with self.subTest(href=href), self.assertRaises(SnapshotError):
                normalize_builtin("gamerch-wiki", raw, {"url": "https://gamerch.com/maimai/123"})

    def test_known_rejection_preserves_accepted_state_and_defect_aborts_proposal(self):
        value, _ = admit(empty(), [official_row()])
        before = json.dumps(value, sort_keys=True)
        raw = b'{"songs": [null]}'
        metadata = {
            "sha256": hashlib.sha256(raw).hexdigest(),
            "bytes": len(raw),
            "url": "https://example.invalid/public",
            "captured_at": "2026-09-24T00:00:00Z",
        }
        result = propose(value, [("arcade-songs", raw, metadata)])
        self.assertEqual(result["claims"], [])
        self.assertEqual(len(result["failures"]), 1)
        self.assertEqual(json.dumps(value, sort_keys=True), before)
        with patch(
            "maimai_intelligence.metadata_adapters.parse_metadata", side_effect=TypeError("bug")
        ):
            with self.assertRaises(TypeError):
                propose(value, [("arcade-songs", raw, metadata)])
        self.assertEqual(json.dumps(value, sort_keys=True), before)
