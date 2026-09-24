"""Typed requests must own both execution choices and their retained receipt fields."""

import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

from maimai_intelligence.corpus_policy import CaptureRequest
from maimai_intelligence.corpus_requests import (
    LegacySource,
    RegistrySource,
    RetainedPackage,
    ReviewedRevision,
    preparation_request,
)


class CorpusRequestTests(unittest.TestCase):
    def test_registry_modes_and_receipts_derive_from_the_executable_request(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request = preparation_request(
                root / "store", root / "browser", registry=root / "registry", offline=True
            )
            self.assertIsInstance(request.source, RegistrySource)
            for mode in ("retained", "online", "replay", "reassess"):
                receipt = root / "receipt.json" if mode in ("replay", "reassess") else None
                source = replace(
                    request.source,
                    captures=CaptureRequest(mode, str(receipt) if receipt is not None else None),
                )
                changed = replace(request, source=source)
                fields = changed.attempt_fields()
                self.assertEqual(fields["offline"], mode != "online")
                self.assertEqual(fields["registry"], source.path)
                self.assertEqual(fields["replay_sources"], receipt)
                self.assertEqual(fields["reassess_captured_policy"], mode == "reassess")
            self.assertIsNone(request.package)

    def test_legacy_and_revision_requests_preserve_historical_input_bindings(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request = preparation_request(
                root / "store",
                root / "browser",
                package=root / "package",
                mai_notes_snapshot=root / "links",
                offline=True,
                coverage_reviews={"titles": []},
            )
            self.assertIsInstance(request.source, LegacySource)
            self.assertIsInstance(request.package, RetainedPackage)
            fields = request.attempt_fields()
            self.assertEqual(fields["package"], root / "package")
            self.assertEqual(fields["mai_notes_snapshot"], root / "links")
            self.assertEqual(fields["coverage_reviews"], {"titles": []})
            with self.assertRaisesRegex(ValueError, "Legacy preparation requires"):
                replace(request, package=None)
            revised = preparation_request(
                root / "store",
                root / "browser",
                revision="reviewed",
                artwork_cache=root / "media",
                registry=root / "registry",
                offline=True,
                capacity_review=root / "capacity",
                capacity_sha256="a" * 64,
            )
            self.assertIsInstance(revised.package, ReviewedRevision)
            self.assertEqual(revised.attempt_fields()["revision"], "reviewed")
            self.assertEqual(revised.attempt_fields()["artwork_cache"], root / "media")
            self.assertEqual(revised.attempt_fields()["capacity_review"], root / "capacity")

    def test_invalid_requests_are_rejected_before_creating_a_store(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            base = {"registry": root / "registry", "offline": True}
            for extra in (
                {"player_maishift": "yes"},
                {"capacity_review": root / "capacity"},
                {"capacity_sha256": "a" * 64},
                {"reassess_captured_policy": True},
                {"registry": root},
                {"replay_sources": root / "capture", "offline": False},
            ):
                with self.subTest(extra=extra), self.assertRaises(ValueError):
                    preparation_request(root / "store", root / "browser", **(base | extra))
                self.assertFalse((root / "store").exists())
            with self.assertRaisesRegex(ValueError, "explicit accepted registry"):
                preparation_request(
                    root / "store", root / "browser", package=root / "package", offline=False
                )

    def test_online_owner_legacy_input_is_an_explicit_seeded_registry(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request = preparation_request(
                root / "store",
                root / "browser",
                package=root / "package",
                offline=False,
                registry_seed=root / "accepted",
                mai_notes_snapshot=root / "ignored-legacy-links",
                overrides=root / "legacy-overrides",
                artwork_cache=root / "media",
            )
            self.assertIsInstance(request.source, RegistrySource)
            self.assertTrue(request.source.verify_legacy_identity)
            self.assertEqual(request.source.captures.mode, "online")
            self.assertEqual(request.attempt_fields()["registry"], root / "accepted")
            self.assertEqual(request.attempt_fields()["overrides"], root / "legacy-overrides")
            self.assertEqual(
                request.attempt_fields()["mai_notes_snapshot"], root / "ignored-legacy-links"
            )
