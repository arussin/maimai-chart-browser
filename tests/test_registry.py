import hashlib
import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from maimai_intelligence.catalog_loading import progressive_catalog
from maimai_intelligence.lab import build_lab
from maimai_intelligence.official_inventory import apply_snapshot, assertion, parse
from maimai_intelligence.provider_mapping import integration_catalog, validate_mapping
from maimai_intelligence.public_matching import ComparisonIndex
from maimai_intelligence.public_release import build_public_release
from maimai_intelligence.registry import (
    accept_mapping,
    analysis_fingerprint,
    bootstrap,
    digest,
    empty,
    read_registry,
    select_transcription,
    validate,
    write_registry,
)
from maimai_intelligence.registry_catalog import (
    build_registry_package,
    project_registry,
    validate_catalog,
)
from maimai_intelligence.snapshots import canonical
from scripts import capture_official_inventory, update_catalog
from tests.registry_fixture import admit, fixture, official_row


class RegistryTests(unittest.TestCase):
    def test_checked_in_registry_bytes_match_the_manifest_on_this_platform(self):
        read_registry(Path(__file__).resolve().parents[1] / "registry")

    def test_reusing_a_registry_package_retains_measurements_and_profile_identities(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            value, _, package = fixture(root)
            first = build_registry_package(value, package, root / "first")
            second = build_registry_package(value, root / "first", root / "second")
            self.assertEqual(first["catalog"], second["catalog"])
            self.assertEqual(first["analysis"], second["analysis"])
            self.assertEqual(first["snippets"], second["snippets"])
            self.assertEqual(
                (root / "first/package.json").read_bytes(),
                (root / "second/package.json").read_bytes(),
            )

    def test_official_song_metadata_does_not_clear_an_unobserved_legacy_variant_level(self):
        with tempfile.TemporaryDirectory() as temp:
            value, legacy, _ = fixture(Path(temp))
            old = legacy["catalog"][0]
            cid = value["legacy-ids"]["legacy-fixture"][old["chart_id"]]["chart_id"]
            row = official_row(old["title"], old["artist"])
            if old["format"] == "DX":
                row = {k: v for k, v in row.items() if not k.startswith("dx_lev_")}
                row["lev_mas"] = "14"
            value, _ = admit(
                value,
                [row],
                when="2026-10-01T00:00:00Z",
                decisions={
                    assertion(row): {
                        "action": "link",
                        "song_id": value["charts"][cid]["song_id"],
                        "evidence": "Authored opposite-format listing fixture",
                    }
                },
            )
            chart = next(
                c for c in project_registry(value, legacy)["catalog"] if c["chart_id"] == cid
            )
            self.assertEqual(chart["level"], old["level"])
            self.assertEqual(chart["regional"]["JP"]["listing"], "unknown")

    def test_importing_older_aliases_preserves_reviewed_current_transcription(self):
        with tempfile.TemporaryDirectory() as temp:
            value, legacy, package = fixture(Path(temp))
            old = legacy["catalog"][0]
            cid = value["legacy-ids"]["legacy-fixture"][old["chart_id"]]["chart_id"]
            row = json.loads((package / "source-inventory.json").read_bytes())[0]
            row.update(title=old["title"], artist=old["artist"], body_sha256="f" * 64)
            select_transcription(
                value,
                cid,
                row,
                snapshot_id=value["charts"][cid]["transcription"]["snapshot_id"],
                evidence="Reviewed corrected input",
                legacy_chart_id=old["chart_id"] + "-corrected",
            )
            imported = bootstrap(value, legacy, "older-alias-import", source_inventory=[row])
            self.assertEqual(imported["charts"][cid], value["charts"][cid])
            self.assertEqual(imported["mappings"], value["mappings"])
            self.assertEqual(
                imported["legacy-ids"]["older-alias-import"][old["chart_id"]]["chart_id"], cid
            )

    def test_failed_second_regional_capture_cannot_create_complete_marker(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "capture"
            with patch.object(
                capture_official_inventory,
                "capture",
                side_effect=[(b"[]", {}), ValueError("INTL failed")],
            ):
                with self.assertRaises(ValueError):
                    capture_official_inventory.prepare(root)
            self.assertFalse(root.exists())

    def test_source_correction_preserves_identity_and_never_reuses_stale_analysis(self):
        with tempfile.TemporaryDirectory() as temp:
            value, legacy, package = fixture(Path(temp))
            old = legacy["catalog"][0]
            cid = value["legacy-ids"]["legacy-fixture"][old["chart_id"]]["chart_id"]
            row = json.loads((package / "source-inventory.json").read_bytes())[0]
            row.update(title=old["title"], artist=old["artist"], body_sha256="f" * 64)
            selected = deepcopy(value["charts"][cid]["transcription"])
            select_transcription(
                value,
                cid,
                row,
                snapshot_id=selected["snapshot_id"],
                evidence="Authored correction fixture",
                legacy_chart_id=old["chart_id"] + "-corrected",
                analysis_state="unsupported",
            )
            result = project_registry(value, legacy)
            c = next(c for c in result["catalog"] if c["chart_id"] == cid)
            self.assertNotIn("demand", c)
            self.assertNotIn(cid, result["analysis"]["charts"])
            self.assertEqual(result["legacy_ids"][old["chart_id"]], cid)
            self.assertIn(selected, value["charts"][cid]["transcription_history"].values())

    def test_registry_only_build_and_offline_repeated_updates(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            value, legacy, package = fixture(root)
            registry = write_registry(value, root / "registry")
            build_lab(package, root / "browser", catalog_version="legacy-fixture")
            with patch("socket.socket", side_effect=AssertionError("Network forbidden")):
                first = update_catalog.prepare_update(
                    root / "updates",
                    root / "browser",
                    registry=registry,
                    package=package,
                    offline=True,
                )
                second = update_catalog.prepare_update(
                    root / "updates",
                    first / "browser",
                    registry=registry,
                    package=package,
                    offline=True,
                )
                metadata = update_catalog.prepare_update(
                    root / "metadata-updates", root / "browser", registry=registry, offline=True
                )
            self.assertEqual(
                update_catalog.verify_candidate(first)["files"],
                update_catalog.verify_candidate(second)["files"],
            )
            self.assertFalse((root / "updates/latest.json").exists())
            rows = json.loads((metadata / "package/catalog.json").read_bytes())
            self.assertEqual(len(rows), len(value["charts"]))
            self.assertTrue(all("demand" not in c for c in rows))
            self.assertEqual(
                len(json.loads((first / "package/analysis.json").read_bytes())["charts"]),
                len(legacy["catalog"]),
            )

    def test_persistence_revision_independence_and_duplicate_title(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            value, legacy, _ = fixture(root)
            write_registry(value, root / "registry")
            self.assertEqual(read_registry(root / "registry"), value)
            before = project_registry(value, legacy)
            self.assertEqual(
                len({c["song_id"] for c in before["catalog"] if c["title"] == "Link"}), 2
            )
            soteria = [c for c in before["catalog"] if c["title"] == "ソテリア"]
            self.assertEqual(len(soteria), 4)
            self.assertTrue(all("demand" not in c and "source_hash" not in c for c in soteria))
            self.assertTrue(all(c["capabilities"]["similarity"] == "not_prepared" for c in soteria))
            changed, _ = admit(
                value, [official_row(dx_lev_mas="14+")], when="2026-10-01T00:00:00Z", decisions={}
            )
            after = project_registry(changed, {})
            self.assertEqual(
                {c["chart_id"] for c in before["catalog"]},
                {c["chart_id"] for c in after["catalog"]},
            )
            self.assertTrue(all("demand" not in c for c in after["catalog"]))
            anima = next(c for c in after["catalog"] if c["title"] == "ANiMA")
            self.assertEqual(anima["regional"]["JP"]["listing"], "not_observed_in_latest_capture")
            self.assertGreater(len(changed["observations"]), len(value["observations"]))

    def test_required_capture_is_atomic_and_new_identity_needs_review(self):
        raw = canonical([official_row()])
        value, source = admit(empty(), [official_row()])
        with self.assertRaises(ValueError):
            apply_snapshot(empty(), raw, source, {})
        original = deepcopy(value)
        for bad in (
            b"{}",
            canonical([official_row(dx_lev_mas="14.8")]),
            canonical([official_row(), official_row()]),
            canonical([official_row(secret=123)]),
            canonical([official_row(dx_lev_future="14")]),
        ):
            with self.assertRaises(ValueError):
                parse(bad)
        self.assertEqual(value, original)
        with self.assertRaises(ValueError):
            apply_snapshot(value, raw + b" ", source, {})

    def test_regional_labels_do_not_overwrite_or_imply_playability(self):
        value, _ = admit(empty(), [official_row(dx_lev_adv="8")])
        sid = next(iter(value["songs"]))
        value, _ = admit(
            value,
            [official_row(dx_lev_adv="7")],
            region="INTL",
            decisions={
                assertion(official_row()): {
                    "action": "link",
                    "song_id": sid,
                    "evidence": "Reviewed same artist, title and exact variants",
                }
            },
        )
        c = next(c for c in project_registry(value, {})["catalog"] if c["difficulty"] == "ADVANCED")
        self.assertEqual((c["level"], c["regional"]["INTL"]["level"]), ("8", "7"))
        self.assertEqual(c["capabilities"]["constant"], "missing")
        self.assertNotIn("removed", canonical(value).decode())

    def test_reviewed_provider_mapping_does_not_require_transcription(self):
        value, source = admit(empty(), [official_row()])
        chart = next(c for c in value["charts"].values() if c["difficulty"] == "MASTER")
        accept_mapping(
            value,
            provider="kamaitachi",
            provider_id="synthetic-master",
            subject_id=chart["chart_id"],
            snapshot_id=source["snapshot_id"],
            evidence="Authored exact variant fixture",
        )
        data = project_registry(validate(value), {})
        validate_mapping(data["provider_mapping"], data["catalog"])
        self.assertEqual(
            data["provider_mapping"]["charts"]["synthetic-master"]["chart_id"], chart["chart_id"]
        )
        self.assertEqual(integration_catalog(data, "fixture")["catalog"], [])

    def test_profiles_only_integration_and_sparse_loading(self):
        with tempfile.TemporaryDirectory() as temp:
            value, legacy, _ = fixture(Path(temp))
            data = project_registry(value, legacy)
            exported = integration_catalog(data, "registry-fixture")
            expected = integration_catalog(legacy, "registry-fixture")
            self.assertEqual(exported["catalog"], expected["catalog"])
            self.assertEqual(exported["analysis"], expected["analysis"])
            self.assertEqual(exported["schema_version"], "maimai-public-integration-1")
            validate_mapping(exported["provider_mapping"], exported["catalog"])
            ComparisonIndex(exported["catalog"], exported["analysis"])
            self.assertEqual(len(ComparisonIndex(data["catalog"]).profiles), len(legacy["catalog"]))
            ref, assets = progressive_catalog(data, digest(data))
            index = json.loads(assets[ref["path"]])
            self.assertEqual(index["index_schema_version"], "catalog-index-2")
            for c in index["catalog"]:
                if "demand" not in c:
                    self.assertNotIn("detail_bucket", c)
            corrupted = deepcopy(data)
            next(c for c in corrupted["catalog"] if "demand" not in c)["demand"] = {}
            with self.assertRaises(ValueError):
                validate_catalog(corrupted)

    def test_new_release_retains_original_history_and_report_contract(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            value, _, package = fixture(root)
            build_lab(package, root / "browser", catalog_version="legacy-fixture")
            manifest = json.loads((root / "browser/manifest.json").read_bytes())
            old = manifest["releases"][0]
            raw = (root / "browser" / old["path"]).read_bytes()
            build_registry_package(value, package, root / "package")
            build_lab(root / "package", root / "browser", catalog_version="registry-fixture")
            build_public_release(root / "browser", root / "public")
            new = json.loads((root / "public/manifest.json").read_bytes())
            self.assertEqual(new["schema_version"], "1.3.0")
            old_parts = b"".join(
                (root / "public" / r["path"]).read_bytes() for r in new["releases"][0]["parts"]
            )
            self.assertEqual(old_parts, raw)
            integration = new["releases"][-1]["integration"]
            payload = (root / "public" / integration["path"]).read_bytes()
            self.assertEqual(hashlib.sha256(payload).hexdigest(), integration["sha256"])
            self.assertEqual(json.loads(payload)["schema_version"], "maimai-public-integration-1")

    def test_analysis_fingerprint_ignores_display_metadata_but_covers_effective_input(self):
        row = {
            "body_sha256": "a" * 64,
            "source_raw_sha256": "b" * 64,
            "body_byte_start": 1,
            "body_byte_end": 50,
            "format": "DX",
            "difficulty": "MASTER",
            "title": "one",
        }
        key = analysis_fingerprint(row, {"parser.py": "c" * 64}, parser="p", analyzer="a")
        self.assertEqual(
            key,
            analysis_fingerprint(
                row | {"title": "two", "source_level": "13+"},
                {"parser.py": "c" * 64},
                parser="p",
                analyzer="a",
            ),
        )
        for field in ("source_raw_sha256", "body_sha256"):
            self.assertNotEqual(
                key,
                analysis_fingerprint(
                    row | {field: "d" * 64}, {"parser.py": "c" * 64}, parser="p", analyzer="a"
                ),
            )


if __name__ == "__main__":
    unittest.main()
