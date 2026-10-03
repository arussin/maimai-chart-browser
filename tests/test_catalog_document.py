"""Publication boundary rejects private, oversized and inconsistent inputs."""

import hashlib
import unittest
from copy import deepcopy
from unittest.mock import patch

from maimai_intelligence.catalog_document import decode_catalog_document, prepare_catalog_document
from maimai_intelligence.registry import empty
from maimai_intelligence.registry_catalog import project_registry
from maimai_intelligence.serialization import canonical
from tests.registry_fixture import admit, official_row


class CatalogDocumentTests(unittest.TestCase):
    def data(self):
        return {"package": {"status": "research_preview"}, "catalog": []}

    def reference(self, raw):
        sha = hashlib.sha256(raw).hexdigest()
        return {"version": "fixture", "sha256": sha, "path": f"catalogs/{sha}.json"}

    def test_only_public_catalog_fields_and_status_are_accepted(self):
        for data in (
            {**self.data(), "player": {}},
            {**self.data(), "package": {"status": "personal"}},
        ):
            with self.subTest(data=data), self.assertRaises(ValueError):
                prepare_catalog_document(data, "fixture")
        raw = b"[]"
        with self.assertRaisesRegex(ValueError, "catalog object"):
            decode_catalog_document(self.reference(raw), raw, None)

    def test_size_bounds_apply_to_current_and_historical_documents(self):
        document = prepare_catalog_document(self.data(), "fixture")
        with patch("maimai_intelligence.catalog_document.MAX_CATALOG_BYTES", len(document.raw) - 1):
            with self.assertRaisesRegex(ValueError, "64 MiB"):
                prepare_catalog_document(self.data(), "fixture")
            with self.assertRaisesRegex(ValueError, "integrity"):
                decode_catalog_document(document.entry, document.raw, document.integration)
        with patch("maimai_intelligence.catalog_document.MAX_BYTES", len(document.integration) - 1):
            with self.assertRaisesRegex(ValueError, "byte budget"):
                prepare_catalog_document(self.data(), "fixture")
            with self.assertRaisesRegex(ValueError, "integrity"):
                decode_catalog_document(document.entry, document.raw, document.integration)

    def test_valid_hash_cannot_authorize_an_integration_for_a_different_catalog(self):
        document = prepare_catalog_document(self.data(), "fixture")
        wrong = canonical({"catalog_version": "different"})
        entry = deepcopy(document.entry)
        sha = hashlib.sha256(wrong).hexdigest()
        entry["integration"] = {
            "path": f"integration/{sha}.json",
            "sha256": sha,
            "bytes": len(wrong),
        }
        with self.assertRaisesRegex(ValueError, "differs from public chart catalog"):
            decode_catalog_document(entry, document.raw, wrong)

    def test_historical_document_without_integration_stays_supported(self):
        raw = canonical(self.data())
        entry = self.reference(raw)
        restored = decode_catalog_document(entry, raw, None)
        self.assertEqual(restored.data, self.data())
        self.assertIsNone(restored.integration)
        with self.assertRaisesRegex(ValueError, "Unexpected integration"):
            decode_catalog_document(entry, raw, b"{}")
        entry["version"] = "caller-mutated"
        self.assertEqual(restored.entry["version"], "fixture")

    def test_registry_schema_and_maishift_validation_are_preserved(self):
        value, _ = admit(empty(), [official_row("Fictional title", "Fictional artist")])
        data = project_registry(value, {})
        data["package"] = {"status": "research_preview"}
        data["maishift_mapping"] = {
            "schema_version": "maishift-mapping-1",
            "provider": "maishift",
            "game": "maimaidx",
            "charts": {},
        }
        document = prepare_catalog_document(data, "fixture")
        self.assertEqual(document.entry["inventory_schema"], "maimai-browser-catalog-2")
        self.assertEqual(
            decode_catalog_document(document.entry, document.raw, document.integration).data, data
        )
        data["maishift_mapping"]["provider"] = "different"
        with self.assertRaisesRegex(ValueError, "Maishift mapping"):
            prepare_catalog_document(data, "fixture")
