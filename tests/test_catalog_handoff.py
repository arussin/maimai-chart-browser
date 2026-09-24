"""Current preparation flows directly to publication; old bytes stay readable."""

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from maimai_intelligence import lab, public_release
from maimai_intelligence.corpus_update import prepare_update
from maimai_intelligence.serialization import canonical
from tests.lab_fixture import write_package
from tests.mai_notes_fixture import encoded


class CatalogHandoffTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.package = write_package(self.root / "package", grouped=True, constants=True)
        self.browser = self.root / "browser"

    def test_owner_pipeline_does_not_reread_its_current_catalog_or_integration(self):
        lab.build_lab(self.package, self.browser, catalog_version="old")
        charts = json.loads((self.package / "catalog.json").read_bytes())
        snapshot = self.root / "links.json"
        snapshot.write_bytes(encoded(charts))
        original = public_release._read

        def external_read(source, name, limit):
            if name.startswith(("catalogs/", "integration/")):
                manifest = json.loads((Path(source) / "manifest.json").read_bytes())
                current = next(
                    r for r in manifest["releases"] if r["version"] == manifest["default"]
                )
                if name in (current["path"], current["integration"]["path"]):
                    raise AssertionError("Current catalog must come from preparation")
            return original(source, name, limit)

        with (
            patch("maimai_intelligence.public_release._read", external_read),
            patch("socket.socket", side_effect=AssertionError("Offline fixture")),
        ):
            run = prepare_update(
                self.root / "store",
                self.browser,
                package=self.package,
                mai_notes_snapshot=snapshot,
                offline=True,
            )
        self.assertTrue((run / "ready.json").is_file())
        self.assertFalse((self.root / "store/latest.json").exists())

    def test_prepared_and_historical_paths_have_identical_complete_bytes(self):
        built = lab.build_browser(self.package, self.browser, catalog_version="fixture")
        document = built.catalog
        before = canonical(document.data)
        historical = public_release.plan_public_release(self.browser)
        original = public_release._read

        def forbid_round_trip(source, name, limit):
            if name.startswith(("catalogs/", "integration/")):
                raise AssertionError("Prepared publication cannot reread encoded catalog inputs")
            return original(source, name, limit)

        with (
            patch("maimai_intelligence.public_release._read", forbid_round_trip),
            patch(
                "maimai_intelligence.catalog_document.integration_catalog",
                side_effect=AssertionError("Integration preparation must not repeat"),
            ),
        ):
            prepared = public_release.plan_public_release(
                self.browser,
                prepared_catalogs={"fixture": document},
            )
        self.assertEqual(prepared.manifest, historical.manifest)
        self.assertEqual(prepared.assets, historical.assets)
        self.assertEqual(prepared.summary, historical.summary)
        self.assertEqual(canonical(document.data), before)
        self.assertEqual(hashlib.sha256(document.raw).hexdigest(), document.entry["sha256"])

    def test_integration_is_prepared_once_in_the_current_path(self):
        from maimai_intelligence.catalog_document import integration_catalog

        with patch(
            "maimai_intelligence.catalog_document.integration_catalog", wraps=integration_catalog
        ) as prepare:
            built = lab.build_browser(self.package, self.browser, catalog_version="fixture")
            public_release.plan_public_release(
                self.browser, prepared_catalogs={"fixture": built.catalog}
            )
        self.assertEqual(prepare.call_count, 1)

    def test_mismatched_or_unused_prepared_document_is_rejected(self):
        built = lab.build_browser(self.package, self.browser, catalog_version="fixture")
        for field, value in (("sha256", "0" * 64), ("version", "different")):
            manifest = json.loads((self.browser / "manifest.json").read_bytes())
            manifest["releases"][0][field] = value
            (self.browser / "manifest.json").write_bytes(canonical(manifest))
            with self.subTest(field=field), self.assertRaises(ValueError):
                public_release.plan_public_release(
                    self.browser, prepared_catalogs={"fixture": built.catalog}
                )
            manifest["releases"][0] = built.catalog.entry
            (self.browser / "manifest.json").write_bytes(canonical(manifest))
        with self.assertRaisesRegex(ValueError, "Unused prepared"):
            public_release.plan_public_release(
                self.browser, prepared_catalogs={"absent": built.catalog}
            )

    def test_historical_reader_still_rejects_damaged_catalog_and_integration(self):
        lab.build_lab(self.package, self.browser, catalog_version="fixture")
        manifest = json.loads((self.browser / "manifest.json").read_bytes())
        entry = manifest["releases"][0]
        for name in (entry["path"], entry["integration"]["path"]):
            path = self.browser / name
            original = path.read_bytes()
            path.write_bytes(original + b" ")
            with self.subTest(path=name), self.assertRaisesRegex(ValueError, "integrity"):
                public_release.plan_public_release(self.browser)
            path.write_bytes(original)

    def test_invalid_historical_references_are_rejected_before_catalog_io(self):
        from maimai_intelligence.catalog_document import validate_catalog_reference

        for entry in (
            {},
            {"version": "v", "sha256": "a" * 64, "path": "private.json"},
            {
                "version": "v",
                "sha256": "a" * 64,
                "path": "catalogs/" + "a" * 64 + ".json",
                "integration": None,
            },
            {
                "version": "v",
                "sha256": "a" * 64,
                "path": "catalogs/" + "a" * 64 + ".json",
                "integration": {"sha256": "b" * 64, "path": "private.json"},
            },
        ):
            with self.subTest(entry=entry), self.assertRaises(ValueError):
                validate_catalog_reference(entry)
