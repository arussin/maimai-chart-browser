"""A fictional source proves extension without a provider-specific coordinator path."""

import hashlib
import inspect
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from maimai_intelligence.catalog_refresh import refresh
from maimai_intelligence.coverage_types import IntegrityError, SnapshotError
from maimai_intelligence.metadata_adapters import MetadataAdapter
from maimai_intelligence.metadata_policy import SOURCE_POLICIES, MetadataSourcePolicy
from maimai_intelligence.metadata_waterfall import propose
from maimai_intelligence.registry import empty
from tests.registry_fixture import admit, official_row


class MetadataExtensionTests(unittest.TestCase):
    def test_fictional_source_enters_preparation_without_coordinator_edits_or_identity_authority(
        self,
    ):
        value, _ = admit(empty(), [official_row("Fictional music", "Fictional artist")])
        url = "https://dp4p6x0xfi5o9.cloudfront.net/maimai/data.json"
        raw = b'{"tempo":123,"constant":13.5}'

        def normalize(body, metadata):
            data = json.loads(body)
            return [
                {
                    "title": "Fictional music",
                    "artist": "Fictional artist",
                    "format": "DX",
                    "difficulty": "MASTER",
                    "bpm": data["tempo"],
                    "chart_constant": data["constant"],
                    "region": "JP",
                }
            ]

        adapter = MetadataAdapter("fictional-source", url, normalize)
        policy = {"fictional-source": MetadataSourcePolicy("Fictional fixture only", 50)}

        def fetch(location, headers):
            return (200, raw, {}) if location == url else (404, b"missing fixture", {})

        with (
            tempfile.TemporaryDirectory() as temporary,
            patch("socket.socket", side_effect=AssertionError("Network forbidden")),
            patch.dict(SOURCE_POLICIES, policy),
        ):
            result, additions, audit = refresh(
                value,
                {},
                Path(temporary) / "cache",
                Path(temporary) / "run",
                metadata_adapters=[adapter],
                metadata_policies=policy,
                fetcher=fetch,
            )
        self.assertEqual(set(result["songs"]), set(value["songs"]))
        self.assertEqual(set(result["charts"]), set(value["charts"]))
        self.assertEqual(result["mappings"], value["mappings"])
        self.assertEqual(audit["metadata"]["observations_added"], 2)
        self.assertEqual(additions["profiles"], [])
        self.assertNotIn("fictional-source", inspect.getsource(refresh))
        claims = [
            row
            for row in result["observations"].values()
            if row.get("policy") == "metadata-waterfall-1"
        ]
        self.assertEqual({row["value"] for row in claims}, {123, 13.5})
        self.assertEqual({row["priority"] for row in claims}, {50})

    def test_explicit_policy_capture_integrity_and_adapter_failures_are_distinct(self):
        value, _ = admit(empty(), [official_row()])
        raw = b"fictional public capture"
        metadata = {
            "sha256": hashlib.sha256(raw).hexdigest(),
            "bytes": len(raw),
            "url": "https://example.invalid/public",
            "captured_at": "2026-09-23T00:00:00Z",
        }
        capture = [("fictional", raw, metadata)]
        with self.assertRaisesRegex(ValueError, "policy entry"):
            propose(value, capture)
        policy = {"fictional": MetadataSourcePolicy("Fictional", 50)}

        def rejected(*args):
            raise SnapshotError("Authored invalid fixture")

        result = propose(
            value,
            capture,
            policies=policy,
            adapters={"fictional": MetadataAdapter("fictional", metadata["url"], rejected)},
        )
        self.assertEqual(result["claims"], [])
        self.assertEqual(len(result["failures"]), 1)

        def broken(*args):
            raise TypeError("Programming error must abort")

        with self.assertRaises(TypeError):
            propose(
                value,
                capture,
                policies=policy,
                adapters={"fictional": MetadataAdapter("fictional", metadata["url"], broken)},
            )
        with self.assertRaises(IntegrityError):
            propose(value, [("fictional", b"tampered", metadata)], policies=policy)

    def test_refresh_does_not_hide_programming_errors_from_capture_adapter(self):
        value, _ = admit(empty(), [official_row()])
        for kind in (ValueError, TypeError, KeyError):

            def broken(*args, kind=kind):
                raise kind("authored programming failure")

            with tempfile.TemporaryDirectory() as temporary, self.assertRaises(kind):
                refresh(
                    value, {}, Path(temporary) / "cache", Path(temporary) / "run", fetcher=broken
                )
