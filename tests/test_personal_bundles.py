import copy
import json
import tempfile
import unittest
from pathlib import Path

from maimai_intelligence.bundles import export_report_bundle, prepare_player_bundle
from maimai_intelligence.site import build_site
from maimai_intelligence.snapshots import digest
from tests.personal_fixture import fixture


class PersonalBundleTests(unittest.TestCase):
    def test_repeatable_bundle_has_provenance_without_account_or_raw_data(self):
        pack, snapshot, mapping, settings, bundle = fixture()
        self.assertEqual(
            bundle,
            prepare_player_bundle(
                pack, snapshot, mapping, catalog_version="synthetic-v1", settings=settings
            ),
        )
        self.assertEqual(bundle["snapshot_id"], snapshot["snapshot_id"])
        self.assertTrue(bundle["recommendations"]["cards"])
        self.assertNotIn("fictional-private-player", json.dumps(bundle))
        self.assertNotIn("raw_hashes", bundle)
        entry = bundle["overlay"]["entries"][0]
        self.assertNotEqual(entry["last_played"], entry["pb_achieved_at"])
        self.assertFalse(bundle["overlay"]["coverage"]["history_complete"])

    def test_mapping_must_be_reviewed_exact_and_release_pinned(self):
        pack, snapshot, mapping, settings, _ = fixture()
        for mutate in (
            lambda m: m.update(verification="inferred-title"),
            lambda m: m["catalog"].update(version="wrong"),
            lambda m: m["charts"].update(unknown="absent"),
            lambda m: m.update(source_ids=[]),
        ):
            bad = copy.deepcopy(mapping)
            mutate(bad)
            with self.assertRaises(ValueError):
                prepare_player_bundle(
                    pack, snapshot, bad, catalog_version="synthetic-v1", settings=settings
                )

    def test_tampered_snapshot_is_rejected(self):
        pack, snapshot, mapping, settings, _ = fixture()
        snapshot["cutoff_ms"] += 1
        with self.assertRaises(ValueError):
            prepare_player_bundle(
                pack, snapshot, mapping, catalog_version="synthetic-v1", settings=settings
            )

    def test_public_build_rejects_personal_contamination_and_preserves_versions(self):
        pack, _, _, _, bundle = fixture()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            build_site(pack, root, catalog_version="one")
            before = {p.name: p.read_bytes() for p in (root / "catalogs").iterdir()}
            build_site(pack, root, catalog_version="two")
            manifest = json.loads((root / "manifest.json").read_text())
            self.assertEqual(len(manifest["catalogs"]), 2)
            self.assertEqual(
                before, {p.name: p.read_bytes() for p in (root / "catalogs").iterdir()}
            )
            for bad in ({**pack, "player": bundle}, bundle):
                with self.assertRaises(ValueError):
                    build_site(bad, root, catalog_version="bad")
            changed = copy.deepcopy(pack)
            changed["charts"][0]["title"] = "Changed title"
            with self.assertRaises(ValueError):
                build_site(changed, root, catalog_version="one")

    def test_retained_report_export_is_offline_and_uses_report_cutoff(self):
        pack, snapshot, mapping, settings, _ = fixture()
        report = {"generatedAt": "2026-05-28T22:30:00Z"}
        # Use the fixture's precise cutoff rather than the wall clock.
        import datetime as dt

        report["generatedAt"] = dt.datetime.fromtimestamp(
            snapshot["cutoff_ms"] / 1000, dt.UTC
        ).isoformat()
        result = export_report_bundle(
            report,
            snapshot["pbs"],
            mapping,
            pack,
            catalog_version="synthetic-v1",
            attempts=snapshot["attempts"],
            settings=settings,
        )
        self.assertEqual(result["cutoff_ms"], snapshot["cutoff_ms"])
        self.assertEqual(result["mapping_sha256"], digest(mapping))
