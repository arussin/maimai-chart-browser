"""Prepared analysis inspection reads accepted artifacts, never reruns analyzers."""

import contextlib
import hashlib
import io
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from maimai_intelligence.catalog_document import prepare_catalog_document
from maimai_intelligence.cli import main
from maimai_intelligence.corpus_attempts import input_inventory
from maimai_intelligence.corpus_workbench import inspect_registry, inspect_run, write_workbench
from maimai_intelligence.registry import write_registry
from maimai_intelligence.registry_catalog import build_registry_package, project_registry
from maimai_intelligence.snapshots import atomic_json, read_json
from tests.registry_fixture import fixture


class CorpusWorkbenchAnalysisTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.run = self.root / "run"
        self.public = self.run / "public"
        self.public.mkdir(parents=True)
        self.registry, legacy, self.source_package = fixture(self.root)
        self.data = project_registry(self.registry, legacy)
        self.data["package"] = {"status": "research_preview"}
        self.write_candidate()

    def write_registry(self):
        path = self.run / "registry"
        if path.exists():
            shutil.rmtree(path)
        write_registry(self.registry, path)

    def write_candidate(self):
        document = prepare_catalog_document(self.data, "fictional-current")
        for reference, raw in (
            (document.entry, document.raw),
            (document.entry["integration"], document.integration),
        ):
            target = self.public / reference["path"]
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
        atomic_json(
            self.public / "manifest.json",
            {"default": "fictional-current", "releases": [document.entry]},
        )
        self.write_registry()
        atomic_json(self.run / "state.json", {"status": "ready"})
        atomic_json(
            self.run / "ready.json",
            {
                "version": "catalog-update-1",
                "status": "ready",
                "catalog_version": "fictional-current",
                "files": input_inventory(self.public),
                "registry_files": input_inventory(self.run / "registry"),
            },
        )

    def test_completed_run_exposes_the_exact_prepared_analysis_and_source_binding(self):
        with patch(
            "maimai_analyzer.core.analyze_overview", side_effect=AssertionError("No analysis")
        ):
            view = inspect_run(self.run)
        prepared = view["canonical"]["analysis"]
        self.assertEqual(prepared["status"], "available")
        self.assertEqual(prepared["verification"], "receipt_bound_catalog_and_registry")
        for chart_id, overview in self.data["analysis"]["charts"].items():
            record = prepared["charts"][chart_id]
            self.assertEqual(record["overview"], overview)
            self.assertEqual(
                record["origin"]["transcription"],
                self.registry["charts"][chart_id]["transcription"],
            )
            self.assertEqual(record["origin"]["capture_bytes"], "not_checked")
        self.assertEqual(prepared["metadata"]["patterns"], self.data["analysis"]["patterns"])
        self.assertEqual(prepared["preparation"]["kind"], "legacy_prepared_artifact")
        self.assertEqual(prepared["preparation"]["recipe"], "not_recorded")
        self.assertEqual(view["integrity"], "inspection_only_use_corpus_verify")

    def test_unfinished_and_legacy_receipts_do_not_promote_partial_analysis(self):
        (self.run / "ready.json").unlink()
        (self.public / "manifest.json").write_bytes(b"interrupted output")
        self.assertEqual(
            inspect_run(self.run)["canonical"]["analysis"]["reason"], "candidate_not_complete"
        )
        atomic_json(self.run / "ready.json", {"status": "ready"})
        self.assertEqual(
            inspect_run(self.run)["canonical"]["analysis"]["reason"],
            "legacy_receipt_without_analysis_binding",
        )
        retained = inspect_registry(self.run / "registry")
        self.assertEqual(retained["canonical"]["analysis"]["reason"], "retained_registry_only")

    def test_manifest_and_catalog_tampering_are_rejected_before_display(self):
        manifest_path = self.public / "manifest.json"
        raw = manifest_path.read_bytes()
        manifest_path.write_bytes(raw + b" ")
        with self.assertRaisesRegex(ValueError, "manifest differs"):
            inspect_run(self.run)
        manifest_path.write_bytes(raw)
        entry = json.loads(raw)["releases"][0]
        target = self.public / entry["path"]
        target.write_bytes(target.read_bytes() + b" ")
        with self.assertRaisesRegex(ValueError, "catalog integrity"):
            inspect_run(self.run)

    def test_changed_registry_is_not_joined_to_prepared_analysis(self):
        song = next(iter(self.registry["songs"].values()))
        song["metadata"]["title"] += " changed"
        self.write_registry()
        with self.assertRaisesRegex(ValueError, "registry differs"):
            inspect_run(self.run)

    def test_analysis_must_match_the_exact_chart_source(self):
        chart_id = next(iter(self.data["analysis"]["charts"]))
        self.data["analysis"]["charts"][chart_id]["source_hash"] = "a" * 64
        self.write_candidate()
        with self.assertRaisesRegex(ValueError, "overview chart identity"):
            inspect_run(self.run)

    def test_selected_transcription_contradiction_is_rejected(self):
        chart_id = next(iter(self.data["analysis"]["charts"]))
        self.registry["charts"][chart_id]["transcription"]["source_hash"] = "a" * 64
        self.write_candidate()
        with self.assertRaisesRegex(ValueError, "selected transcription"):
            inspect_run(self.run)

    def test_metadata_only_chart_has_no_fabricated_profile_or_overview(self):
        expected = next(chart for chart in self.data["catalog"] if not chart.get("source_hash"))
        record = inspect_run(self.run)["canonical"]["analysis"]["charts"][expected["chart_id"]]
        self.assertEqual(record["status"], "unavailable")
        self.assertEqual(record["profile"], {})
        self.assertIsNone(record["overview"])
        self.assertEqual(record["capabilities"], expected["capabilities"])

    def test_recorded_recipe_is_reused_and_legacy_catalog_still_inspects(self):
        self.data["package"].update(
            implementation="fictional-producer", overview_version="recorded-version"
        )
        self.write_candidate()
        prepared = inspect_run(self.run)["canonical"]["analysis"]
        self.assertEqual(prepared["preparation"]["kind"], "recorded_preparation")
        self.assertEqual(prepared["preparation"]["recipe"]["implementation"], "fictional-producer")
        # Historical runs without a registry still expose their prepared catalog;
        # they do not invent a canonical registry or selected-transcription proof.
        shutil.rmtree(self.run / "registry")
        with self.assertRaisesRegex(ValueError, "registry is missing"):
            inspect_run(self.run)
        receipt = read_json(self.run / "ready.json")
        del receipt["registry_files"]
        atomic_json(self.run / "ready.json", receipt)
        prepared = inspect_run(self.run)["canonical"]["analysis"]
        self.assertEqual(prepared["verification"], "receipt_bound_catalog")
        self.assertTrue(
            all(
                row["origin"]["kind"] == "legacy_prepared_artifact"
                for row in prepared["charts"].values()
            )
        )

    def test_multipart_catalog_uses_the_maintained_verified_reader(self):
        manifest = read_json(self.public / "manifest.json")
        entry = manifest["releases"][0]
        raw = (self.public / entry["path"]).read_bytes()
        cut = len(raw) // 2
        entry["parts"] = []
        for part in (raw[:cut], raw[cut:]):
            sha = hashlib.sha256(part).hexdigest()
            path = "catalog-parts/" + sha + ".json"
            target = self.public / path
            target.parent.mkdir(exist_ok=True)
            target.write_bytes(part)
            entry["parts"].append({"path": path, "bytes": len(part), "sha256": sha})
        (self.public / entry["path"]).unlink()
        atomic_json(self.public / "manifest.json", manifest)
        receipt = read_json(self.run / "ready.json")
        receipt["files"] = input_inventory(self.public)
        atomic_json(self.run / "ready.json", receipt)
        self.assertEqual(
            inspect_run(self.run)["canonical"]["analysis"]["catalog"]["sha256"], entry["sha256"]
        )
        part = self.public / entry["parts"][0]["path"]
        part.write_bytes(part.read_bytes() + b" ")
        with self.assertRaisesRegex(ValueError, "asset integrity"):
            inspect_run(self.run)

    def test_identity_cli_and_workbench_show_prepared_analysis_without_mutation(self):
        before = input_inventory(self.run)
        identity = next(iter(self.data["analysis"]["charts"]))
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(
                main(["corpus", "inspect", "--run", str(self.run), "--identity", identity]), 0
            )
        inspected = json.loads(output.getvalue())
        self.assertEqual(list(inspected["analysis"]["charts"]), [identity])
        self.assertEqual(
            inspected["analysis"]["charts"][identity]["overview"],
            self.data["analysis"]["charts"][identity],
        )
        target = write_workbench(self.run, self.root / "workbench.html")
        self.assertIn("Prepared analysis and provenance", target.read_text())
        self.assertIn("prepared_analysis:preparedAnalysis?.charts[record.id]", target.read_text())
        self.assertEqual(before, input_inventory(self.run))

    def prepared_package(self, path):
        build_registry_package(self.registry, self.source_package, path)
        sha = hashlib.sha256((path / "package.json").read_bytes()).hexdigest()
        return path, sha

    def test_retained_package_analysis_is_reviewable_before_publication_readiness(self):
        package, sha = self.prepared_package(self.root / "retained-preparation")
        before = input_inventory(package)
        with patch(
            "maimai_analyzer.core.analyze_overview", side_effect=AssertionError("No analysis")
        ):
            view = inspect_registry(self.run / "registry", package=package, package_sha256=sha)
        analysis = view["canonical"]["analysis"]
        self.assertEqual(analysis["verification"], "retained_package_and_registry")
        self.assertEqual(
            analysis["package"], {"descriptor_sha256": sha, "publication_readiness": "not_verified"}
        )
        expected = read_json(package / "analysis.json")["charts"]
        self.assertEqual(
            {
                key: row["overview"]
                for key, row in analysis["charts"].items()
                if row["overview"] is not None
            },
            expected,
        )
        self.assertEqual(before, input_inventory(package))

    def test_external_package_needs_correct_retained_descriptor_hash(self):
        package, sha = self.prepared_package(self.root / "retained-preparation")
        for supplied in (None, "", "not-a-digest", "a" * 64):
            with self.subTest(digest=supplied), self.assertRaisesRegex(ValueError, "descriptor"):
                inspect_registry(self.run / "registry", package=package, package_sha256=supplied)
        with self.assertRaisesRegex(ValueError, "requires an explicit package"):
            inspect_registry(self.run / "registry", package_sha256=sha)
        with self.assertRaisesRegex(ValueError, "requires an explicit package"):
            inspect_run(self.run, package_sha256=sha)

    def test_retained_package_rejects_tampered_analysis_and_changed_registry(self):
        package, sha = self.prepared_package(self.root / "retained-preparation")
        analysis_path = package / "analysis.json"
        original = analysis_path.read_bytes()
        analysis_path.write_bytes(original + b" ")
        with self.assertRaisesRegex(ValueError, "package integrity"):
            inspect_registry(self.run / "registry", package=package, package_sha256=sha)
        analysis_path.write_bytes(original)
        song = next(iter(self.registry["songs"].values()))
        song["metadata"]["title"] += " changed"
        self.write_registry()
        with self.assertRaisesRegex(ValueError, "differs from accepted registry"):
            inspect_registry(self.run / "registry", package=package, package_sha256=sha)

    def test_failed_run_keeps_its_complete_prepared_analysis_inspectable(self):
        package, sha = self.prepared_package(self.run / "package")
        (self.run / "ready.json").unlink()
        atomic_json(self.run / "state.json", {"status": "failed"})
        with patch(
            "maimai_analyzer.core.analyze_overview", side_effect=AssertionError("No analysis")
        ):
            view = inspect_run(self.run)
        analysis = view["canonical"]["analysis"]
        self.assertEqual(view["operations"]["state"]["status"], "failed")
        self.assertEqual(analysis["verification"], "run_preparation_package_and_registry")
        self.assertEqual(analysis["package"]["descriptor_sha256"], sha)
        self.assertEqual(analysis["package"]["publication_readiness"], "not_verified")
        (package / "analysis.json").write_bytes(b"interrupted or tampered")
        with self.assertRaisesRegex(ValueError, "package integrity"):
            inspect_run(self.run)

    def test_retained_package_cli_and_destination_guards(self):
        package, sha = self.prepared_package(self.root / "retained-preparation")
        identity = next(iter(self.data["analysis"]["charts"]))
        options = [
            "corpus",
            "inspect",
            "--registry",
            str(self.run / "registry"),
            "--package",
            str(package),
            "--package-sha256",
            sha,
        ]
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(main(options + ["--identity", identity]), 0)
        self.assertEqual(
            json.loads(output.getvalue())["analysis"]["package"]["descriptor_sha256"], sha
        )
        before = input_inventory(package)
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(main(options + ["--workbench", str(package / "view.html")]), 1)
        with self.assertRaisesRegex(ValueError, "outside the retained package"):
            write_workbench(self.run, package / "view.html", package=package, package_sha256=sha)
        self.assertEqual(before, input_inventory(package))

    def test_identity_inspection_preserves_unavailable_reason(self):
        (self.run / "ready.json").unlink()
        identity = next(iter(self.registry["charts"]))
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(
                main(["corpus", "inspect", "--run", str(self.run), "--identity", identity]), 0
            )
        analysis = json.loads(output.getvalue())["analysis"]
        self.assertEqual(
            (analysis["status"], analysis["reason"]), ("unavailable", "candidate_not_complete")
        )


if __name__ == "__main__":
    unittest.main()
