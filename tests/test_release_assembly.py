"""Real local assembly, with no publishing and no link-creation privileges."""

import hashlib
import json
import os
import stat
import tempfile
import unittest
from dataclasses import asdict, replace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from maimai_intelligence import release_assembly as assembly
from maimai_intelligence import release_composition as composition
from maimai_intelligence.public_routes import ROUTE_MODEL
from maimai_intelligence.release_composition import (
    MAX_FILE_BYTES,
    PathOwnership,
    RuntimeClosure,
    inventory_from_records,
    plan_release_composition,
)
from maimai_intelligence.release_transition import Fingerprint
from maimai_intelligence.serialization import digest


def records(root):
    return {
        path.relative_to(root).as_posix(): {
            "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
        }
        for path in sorted(root.rglob("*"))
        if path.is_file()
        for raw in (path.read_bytes(),)
    }


class ReleaseAssemblyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="release-assembly-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.old = self.root / "baseline"
        self.new = self.root / "candidate"
        self.output = self.root / "assembled"
        self.receipt = self.root / "private" / "completion.json"
        for root, files in (
            (
                self.old,
                {
                    "index.html": b"old document",
                    "legacy.js": b"legacy runtime",
                    "shared.css": b"same style",
                    "manifest.json": b"old manifest",
                },
            ),
            (
                self.new,
                {
                    "index.html": b"new document",
                    "browser/app.js": b"new runtime",
                    "shared.css": b"same style",
                    "manifest.json": b"new manifest",
                },
            ),
        ):
            for name, raw in files.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(raw)
        self.old_records, self.new_records = records(self.old), records(self.new)
        self.old_inventory = inventory_from_records(self.old_records)
        self.new_inventory = inventory_from_records(self.new_records)
        self.old_runtime = RuntimeClosure(
            "a" * 64,
            tuple(file for file in self.old_inventory.files if file.path.endswith((".js", ".css"))),
        )
        self.new_runtime = RuntimeClosure(
            "b" * 64,
            tuple(file for file in self.new_inventory.files if file.path.endswith((".js", ".css"))),
        )
        new = {file.path: file.fingerprint for file in self.new_inventory.files}
        old = {file.path: file.fingerprint for file in self.old_inventory.files}
        ownership = tuple(
            PathOwnership(
                path,
                "candidate" if path in new else "baseline",
                new[path] if path in new else old[path],
                "Reviewed ownership",
            )
            for path in sorted(old.keys() | new.keys())
        )
        self.plan = plan_release_composition(
            self.old_inventory,
            self.new_inventory,
            target="candidate",
            ownership=ownership,
            baseline_runtime=self.old_runtime,
            candidate_runtime=self.new_runtime,
        )

    def run_assembly(self, **options):
        return assembly.assemble_release(
            options.pop("baseline", self.old),
            options.pop("candidate", self.new),
            options.pop("output", self.output),
            plan=options.pop("plan", self.plan),
            baseline_runtime=options.pop("baseline_runtime", self.old_runtime),
            candidate_runtime=options.pop("candidate_runtime", self.new_runtime),
            receipt_path=options.pop("receipt_path", self.receipt),
            **options,
        )

    def assert_inputs_unchanged(self):
        self.assertEqual(records(self.old), self.old_records)
        self.assertEqual(records(self.new), self.new_records)

    def test_complete_output_and_private_receipt_match_plan_and_inputs(self):
        result = self.run_assembly()
        output = records(self.output)
        self.assertEqual(set(output), self.old_records.keys() | self.new_records.keys())
        self.assertEqual((self.output / "index.html").read_bytes(), b"new document")
        self.assertEqual((self.output / "legacy.js").read_bytes(), b"legacy runtime")
        self.assertEqual((self.output / "browser/app.js").read_bytes(), b"new runtime")
        receipt = json.loads(self.receipt.read_text())
        self.assertEqual(receipt["status"], "complete")
        self.assertEqual(receipt["scope"], "local_file_assembly_only")
        self.assertEqual(receipt["files"], output)
        self.assertEqual(receipt["output_inventory_sha256"], digest(output))
        self.assertEqual(result.plan_sha256, digest(asdict(self.plan)))
        self.assertEqual(result.completion_path, str(self.receipt))
        self.assertEqual(tuple(self.receipt.parent.iterdir()), (self.receipt,))
        self.assertNotIn("completion.json", output)
        self.assert_inputs_unchanged()

    @unittest.skipUnless(os.name == "nt", "Windows path aliases")
    def test_windows_extended_namespace_cannot_put_output_inside_input(self):
        alias = Path("\\\\?\\" + str(self.old)) / "hidden-output"
        with self.assertRaises(ValueError):
            self.run_assembly(output=alias)
        self.assert_inputs_unchanged()
        self.assertFalse((self.old / "hidden-output").exists())

    @unittest.skipUnless(os.name == "nt", "Windows path aliases")
    def test_windows_trailing_space_cannot_put_receipt_inside_input(self):
        alias = Path(str(self.old) + " ") / "completion.json"
        with self.assertRaises(ValueError):
            self.run_assembly(receipt_path=alias)
        self.assert_inputs_unchanged()
        self.assertFalse((self.old / "completion.json").exists())

    @unittest.skipUnless(os.name == "nt", "Windows path aliases")
    def test_windows_short_name_resolves_before_overlap_check(self):
        import ctypes

        buffer = ctypes.create_unicode_buffer(32768)
        size = ctypes.windll.kernel32.GetShortPathNameW(str(self.old), buffer, len(buffer))
        self.assertGreater(size, 0)
        alias = Path(buffer.value) / "hidden-output"
        with self.assertRaises(ValueError):
            self.run_assembly(output=alias)
        self.assert_inputs_unchanged()
        self.assertFalse((self.old / "hidden-output").exists())

    def test_recovery_target_selects_exact_old_document_without_changing_inputs(self):
        ownership = tuple(
            replace(
                file,
                owner="baseline",
                expected=next(
                    item.fingerprint
                    for item in self.old_inventory.files
                    if item.path == "index.html"
                ),
            )
            if file.path == "index.html"
            else file
            for file in self.plan.files
        )
        plan = plan_release_composition(
            self.old_inventory,
            self.new_inventory,
            target="recovery",
            ownership=ownership,
            baseline_runtime=self.old_runtime,
            candidate_runtime=self.new_runtime,
        )
        self.run_assembly(plan=plan)
        self.assertEqual(
            (self.output / "index.html").read_bytes(), (self.old / "index.html").read_bytes()
        )
        self.assert_inputs_unchanged()

    def test_all_input_files_are_checked_even_unselected_collision_bytes(self):
        (self.old / "manifest.json").write_bytes(b"tampered unselected bytes")
        with self.assertRaisesRegex(ValueError, "plan does not match"):
            self.run_assembly()
        self.assertFalse(self.output.exists())
        self.assertFalse(self.receipt.exists())
        self.assertEqual((self.old / "manifest.json").read_bytes(), b"tampered unselected bytes")
        self.assertEqual(records(self.new), self.new_records)

    def test_missing_and_added_input_files_fail_before_writing(self):
        for operation in ("remove", "add"):
            with self.subTest(operation=operation):
                path = self.new / ("browser/app.js" if operation == "remove" else "extra.js")
                if operation == "remove":
                    path.unlink()
                else:
                    path.write_bytes(b"extra")
                try:
                    with self.assertRaises(ValueError):
                        self.run_assembly()
                    self.assertFalse(self.output.exists())
                    self.assertFalse(self.receipt.exists())
                finally:
                    if operation == "remove":
                        path.write_bytes(b"new runtime")
                    else:
                        path.unlink()
        self.assert_inputs_unchanged()

    def test_fabricated_plan_fields_and_changed_closure_binding_are_rejected(self):
        for plan in (
            None,
            replace(self.plan, total_bytes=0),
            replace(self.plan, baseline_inventory_sha256="0" * 64),
            replace(self.plan, candidate_inventory_sha256="0" * 64),
            replace(self.plan, collisions=()),
            replace(self.plan, scope="rollout_safe"),
            replace(self.plan, target="recovery"),
            replace(self.plan, files=tuple(reversed(self.plan.files))),
            replace(self.plan, baseline_observations_sha256="0" * 64),
        ):
            with self.subTest(plan=plan), self.assertRaises(ValueError):
                self.run_assembly(plan=plan)
            self.assertFalse(self.output.exists())
        with self.assertRaisesRegex(ValueError, "plan does not match"):
            self.run_assembly(
                candidate_runtime=replace(self.new_runtime, observations_sha256="0" * 64)
            )
        self.assert_inputs_unchanged()

    def test_fabricated_selected_byte_hash_is_not_copied(self):
        changed = replace(self.plan.files[0], expected=Fingerprint(0, "0" * 64))
        with self.assertRaisesRegex(ValueError, "source artifact"):
            self.run_assembly(plan=replace(self.plan, files=(changed, *self.plan.files[1:])))
        self.assertFalse(self.output.exists())
        self.assert_inputs_unchanged()

    def test_overlapping_roots_and_receipt_paths_reject_without_writes(self):
        options = (
            {"output": self.old},
            {"output": self.old / "child"},
            {"output": self.root},
            {"baseline": self.new},
            {"candidate": self.old / "child"},
            {"receipt_path": self.output / "completion.json"},
            {"receipt_path": self.old / "completion.json"},
            {"receipt_path": self.new / "completion.json"},
            {"receipt_path": self.root},
        )
        for value in options:
            with (
                self.subTest(value=value),
                self.assertRaisesRegex(ValueError, "overlapping|outside"),
            ):
                self.run_assembly(**value)
        self.assert_inputs_unchanged()

    def test_existing_output_or_receipt_are_never_reused_or_overwritten(self):
        self.output.mkdir()
        with self.assertRaisesRegex(ValueError, "fresh output"):
            self.run_assembly()
        self.assertEqual(list(self.output.iterdir()), [])
        self.output.rmdir()
        self.receipt.parent.mkdir()
        self.receipt.write_text("retained receipt")
        with self.assertRaisesRegex(ValueError, "fresh output"):
            self.run_assembly()
        self.assertEqual(self.receipt.read_text(), "retained receipt")
        self.assertFalse(self.output.exists())
        self.assert_inputs_unchanged()

    def test_second_attempt_cannot_overwrite_completed_assembly(self):
        first = self.run_assembly()
        before = records(self.output)
        with self.assertRaisesRegex(ValueError, "fresh output"):
            self.run_assembly()
        self.assertEqual(records(self.output), before)
        self.assertEqual(json.loads(self.receipt.read_text())["plan_sha256"], first.plan_sha256)
        self.assert_inputs_unchanged()

    def test_interrupted_write_leaves_incomplete_output_and_no_completion_receipt(self):
        real = assembly._copy_file
        count = 0

        def interrupt(source, destination, expected):
            nonlocal count
            count += 1
            if count == 2:
                raise OSError("simulated interruption")
            real(source, destination, expected)

        with (
            patch.object(assembly, "_copy_file", side_effect=interrupt),
            self.assertRaisesRegex(OSError, "interruption"),
        ):
            self.run_assembly()
        self.assertEqual(len(records(self.output)), 1)
        self.assertFalse(self.receipt.exists())
        with self.assertRaisesRegex(ValueError, "fresh output"):
            self.run_assembly()
        self.assert_inputs_unchanged()

    def test_selected_bytes_are_rechecked_after_plan_validation(self):
        real = assembly._copy_file

        def tamper(source, destination, expected):
            source.write_bytes(b"concurrent tamper")
            return real(source, destination, expected)

        with (
            patch.object(assembly, "_copy_file", side_effect=tamper),
            self.assertRaisesRegex(ValueError, "changed during"),
        ):
            self.run_assembly()
        self.assertEqual(records(self.output), {})
        self.assertFalse(self.receipt.exists())
        self.assertEqual(records(self.old), self.old_records)

    def test_unselected_input_mutation_during_copy_cannot_receive_receipt(self):
        real = assembly._copy_file

        def tamper(source, destination, expected):
            real(source, destination, expected)
            (self.old / "manifest.json").write_bytes(b"concurrent unselected tamper")

        with (
            patch.object(assembly, "_copy_file", side_effect=tamper),
            self.assertRaisesRegex(ValueError, "input artifact changed"),
        ):
            self.run_assembly()
        self.assertFalse(self.receipt.exists())
        self.assertEqual(len(records(self.output)), 5)
        self.assertEqual(records(self.new), self.new_records)

    def test_output_corruption_or_extra_file_blocks_completion(self):
        real = assembly._copy_file
        for corrupt in (True, False):
            output = self.root / ("corrupt-output" if corrupt else "extra-output")

            def tamper(source, destination, expected, *, corrupt=corrupt, output=output):
                real(source, destination, expected)
                if corrupt:
                    destination.write_bytes(b"bad output")
                else:
                    (output / "extra.txt").write_bytes(b"unplanned")

            with (
                self.subTest(corrupt=corrupt),
                patch.object(assembly, "_copy_file", side_effect=tamper),
                self.assertRaisesRegex(ValueError, "output differs"),
            ):
                self.run_assembly(output=output)
            self.assertFalse(self.receipt.exists())
        self.assert_inputs_unchanged()

    def test_reviewed_lower_capacity_is_revalidated_and_bound_in_receipt(self):
        plan = plan_release_composition(
            self.old_inventory,
            self.new_inventory,
            target="candidate",
            ownership=self.plan.files,
            baseline_runtime=self.old_runtime,
            candidate_runtime=self.new_runtime,
            max_files=5,
            max_file_bytes=20,
        )
        self.run_assembly(plan=plan)
        receipt = json.loads(self.receipt.read_text())
        self.assertEqual(receipt["plan"]["max_files"], 5)
        self.assertEqual(receipt["plan"]["max_file_bytes"], 20)
        self.assertEqual(receipt["plan_sha256"], digest(asdict(plan)))
        for invalid in (
            replace(plan, max_files=4),
            replace(plan, max_file_bytes=1),
            replace(plan, max_files=100_000),
            replace(plan, max_file_bytes=True),
        ):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                self.run_assembly(
                    plan=invalid,
                    output=self.root / "invalid-capacity",
                    receipt_path=self.root / "private/invalid-capacity.json",
                )
        self.assertFalse((self.root / "invalid-capacity").exists())
        self.assert_inputs_unchanged()

    def test_new_source_file_appearing_during_copy_blocks_completion(self):
        real = assembly._copy_file

        def add_file(source, destination, expected):
            real(source, destination, expected)
            (self.new / "new-unreviewed.js").write_bytes(b"unexpected input")

        with (
            patch.object(assembly, "_copy_file", side_effect=add_file),
            self.assertRaisesRegex(ValueError, "input artifact changed"),
        ):
            self.run_assembly()
        self.assertFalse(self.receipt.exists())
        self.assertEqual(records(self.old), self.old_records)
        self.assertEqual(set(records(self.new)) - self.new_records.keys(), {"new-unreviewed.js"})

    def test_receipt_is_written_only_after_exact_output_and_input_verification(self):
        real = assembly._complete

        def observe(path, payload):
            self.assertEqual(records(self.output), payload["files"])
            self.assert_inputs_unchanged()
            self.assertFalse(path.exists())
            real(path, payload)

        with patch.object(assembly, "_complete", side_effect=observe):
            self.run_assembly()

    def test_receipt_write_interruption_never_installs_completion(self):
        with (
            patch.object(assembly, "atomic_json", side_effect=OSError("receipt interruption")),
            self.assertRaisesRegex(OSError, "receipt interruption"),
        ):
            self.run_assembly()
        self.assertFalse(self.receipt.exists())
        self.assertEqual(list(self.receipt.parent.iterdir()), [])
        self.assertEqual(len(records(self.output)), 5)
        self.assert_inputs_unchanged()

    def test_competing_receipt_is_preserved_by_atomic_no_overwrite_install(self):
        real = assembly.atomic_json

        def compete(path, payload):
            real(path, payload)
            self.receipt.write_text("competing receipt")

        with (
            patch.object(assembly, "atomic_json", side_effect=compete),
            self.assertRaises(FileExistsError),
        ):
            self.run_assembly()
        self.assertEqual(self.receipt.read_text(), "competing receipt")
        self.assert_inputs_unchanged()

    def test_temporary_receipt_cleanup_cannot_mask_primary_failure(self):
        self.receipt.parent.mkdir()
        real_unlink = Path.unlink

        def fail_own_staging(path, *args, **kwargs):
            if path.name.startswith(".release-completion-"):
                raise OSError("cleanup failure")
            return real_unlink(path, *args, **kwargs)

        with (
            patch.object(assembly, "atomic_json", side_effect=OSError("primary failure")),
            patch.object(Path, "unlink", new=fail_own_staging),
            self.assertRaisesRegex(OSError, "primary failure"),
        ):
            assembly._complete(self.receipt, {})
        self.assertFalse(self.receipt.exists())

    def test_redirect_detection_uses_lstat_without_link_creation_privileges(self):
        for info in (
            SimpleNamespace(st_mode=stat.S_IFLNK),
            SimpleNamespace(
                st_mode=stat.S_IFDIR, st_reparse_tag=0xA0000003, st_file_attributes=0x400
            ),
            SimpleNamespace(
                st_mode=stat.S_IFDIR, st_reparse_tag=0xA000000C, st_file_attributes=0x400
            ),
            SimpleNamespace(st_mode=stat.S_IFDIR, st_reparse_tag=0, st_file_attributes=0x400),
        ):
            with (
                self.subTest(info=info),
                patch.object(Path, "lstat", return_value=info),
                self.assertRaisesRegex(ValueError, "redirects"),
            ):
                assembly._checked_path(self.old)
        cloud = SimpleNamespace(
            st_mode=stat.S_IFDIR, st_reparse_tag=0x9000001A, st_file_attributes=0x400
        )
        with patch.object(Path, "lstat", return_value=cloud):
            self.assertEqual(assembly._reject_link(self.old), cloud)
        self.assert_inputs_unchanged()

    def test_missing_artifact_and_nonregular_file_reject(self):
        with self.assertRaisesRegex(ValueError, "artifact directory"):
            self.run_assembly(baseline=self.root / "missing")
        with (
            patch.object(
                assembly, "_reject_link", return_value=SimpleNamespace(st_mode=stat.S_IFIFO)
            ),
            self.assertRaisesRegex(ValueError, "ordinary files"),
        ):
            assembly._read_file(self.old / "legacy.js")
        with (
            patch.object(os, "fstat", return_value=SimpleNamespace(st_mode=stat.S_IFIFO)),
            self.assertRaisesRegex(ValueError, "ordinary files"),
        ):
            assembly._read_file(self.old / "legacy.js")
        self.assert_inputs_unchanged()

    def test_read_bound_is_enforced_without_allocating_a_large_fixture(self):
        with (
            patch.object(assembly, "MAX_FILE_BYTES", 2),
            self.assertRaisesRegex(ValueError, "per-file limit"),
        ):
            assembly._read_file(self.old / "legacy.js")
        self.assertEqual(MAX_FILE_BYTES, 25 * 1024 * 1024)
        self.assert_inputs_unchanged()

    def test_destination_file_appearing_during_copy_is_never_overwritten(self):
        destination = self.root / "existing.txt"
        destination.write_bytes(b"retain this")
        source = self.old / "legacy.js"
        expected = next(
            file.fingerprint for file in self.old_inventory.files if file.path == "legacy.js"
        )
        with self.assertRaises(FileExistsError):
            assembly._copy_file(source, destination, expected)
        self.assertEqual(destination.read_bytes(), b"retain this")
        self.assert_inputs_unchanged()

    def recovery_fixture(self):
        documents = {
            f"{locale}/{kind}/fictional/index.html": b"verified recovery document"
            for locale in ("en", "ja", "ko", "zh-hans")
            for kind in ("songs", "versions")
        }
        for path in documents:
            target = self.new / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b"candidate document")
        self.new_records = records(self.new)
        self.new_inventory = inventory_from_records(self.new_records)
        overlay = composition.RecoveryOverlay(
            "c" * 64,
            inventory_from_records(
                {
                    path: {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
                    for path, raw in documents.items()
                }
            ),
            composition.artifact_inventory_sha256(self.new_inventory),
            composition.artifact_inventory_sha256(self.old_inventory),
            ROUTE_MODEL,
        )
        ownership = tuple(
            replace(file, owner="baseline", expected=self.old_inventory.files[0].fingerprint)
            if file.path == "index.html"
            else file
            for file in self.plan.files
        ) + tuple(
            PathOwnership(file.path, "recovery", file.fingerprint, "Verified route fallback")
            for file in overlay.inventory.files
        )
        plan = plan_release_composition(
            self.old_inventory,
            self.new_inventory,
            target="recovery",
            ownership=ownership,
            baseline_runtime=self.old_runtime,
            candidate_runtime=self.new_runtime,
            recovery=overlay,
        )
        return documents, overlay, plan

    def test_recovery_documents_are_assembled_verified_and_receipted_without_input_edits(self):
        documents, overlay, plan = self.recovery_fixture()
        result = self.run_assembly(
            plan=plan,
            recovery_documents=documents,
            recovery_evidence_sha256=overlay.evidence_sha256,
            recovery_candidate_inventory_sha256=overlay.candidate_inventory_sha256,
            recovery_baseline_inventory_sha256=overlay.baseline_inventory_sha256,
        )
        for path, raw in documents.items():
            self.assertEqual((self.output / path).read_bytes(), raw)
        self.assertEqual((self.output / "index.html").read_bytes(), b"old document")
        receipt = json.loads(self.receipt.read_text())
        self.assertEqual(receipt["plan"]["recovery_evidence_sha256"], overlay.evidence_sha256)
        self.assertEqual(
            receipt["plan"]["recovery_inventory_sha256"], plan.recovery_inventory_sha256
        )
        self.assertEqual(result.plan_sha256, digest(asdict(plan)))
        self.assertEqual(receipt["files"], records(self.output))
        self.assert_inputs_unchanged()

    def test_recovery_document_inputs_and_binding_must_match_before_writes(self):
        documents, overlay, plan = self.recovery_fixture()
        path = next(iter(documents))
        bad_values = (
            {},
            {path: documents[path]},
            {**documents, path: b"changed"},
            {**documents, "extra.html": b"extra"},
            {**documents, path: bytearray(b"mutable")},
            {**documents, path: "not bytes"},
            [],
            None,
        )
        for value in bad_values:
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.run_assembly(
                    plan=plan,
                    recovery_documents=value,
                    recovery_evidence_sha256=overlay.evidence_sha256,
                    recovery_candidate_inventory_sha256=overlay.candidate_inventory_sha256,
                    recovery_baseline_inventory_sha256=overlay.baseline_inventory_sha256,
                )
            self.assertFalse(self.output.exists())
            self.assertFalse(self.receipt.exists())
        for evidence in (None, "bad", "d" * 64):
            with self.subTest(evidence=evidence), self.assertRaises(ValueError):
                self.run_assembly(
                    plan=plan,
                    recovery_documents=documents,
                    recovery_evidence_sha256=evidence,
                    recovery_candidate_inventory_sha256=overlay.candidate_inventory_sha256,
                    recovery_baseline_inventory_sha256=overlay.baseline_inventory_sha256,
                )
            self.assertFalse(self.output.exists())
        for changed in (
            replace(plan, recovery_inventory_sha256="0" * 64),
            replace(plan, recovery_evidence_sha256=None),
        ):
            with (
                self.subTest(plan=changed),
                self.assertRaisesRegex(ValueError, "plan does not match"),
            ):
                self.run_assembly(
                    plan=changed,
                    recovery_documents=documents,
                    recovery_evidence_sha256=overlay.evidence_sha256,
                    recovery_candidate_inventory_sha256=overlay.candidate_inventory_sha256,
                    recovery_baseline_inventory_sha256=overlay.baseline_inventory_sha256,
                )
            self.assertFalse(self.output.exists())
        self.assert_inputs_unchanged()

    def test_recovery_base_binding_is_required_and_never_inferred_from_plan(self):
        documents, overlay, plan = self.recovery_fixture()
        for candidate_id in (None, "bad", "0" * 64):
            with self.subTest(candidate_id=candidate_id), self.assertRaises(ValueError):
                self.run_assembly(
                    plan=plan,
                    recovery_documents=documents,
                    recovery_evidence_sha256=overlay.evidence_sha256,
                    recovery_candidate_inventory_sha256=candidate_id,
                    recovery_baseline_inventory_sha256=overlay.baseline_inventory_sha256,
                )
            self.assertFalse(self.output.exists())
            self.assertFalse(self.receipt.exists())
        for baseline_id in (None, "bad", "0" * 64):
            with self.subTest(baseline_id=baseline_id), self.assertRaises(ValueError):
                self.run_assembly(
                    plan=plan,
                    recovery_documents=documents,
                    recovery_evidence_sha256=overlay.evidence_sha256,
                    recovery_candidate_inventory_sha256=overlay.candidate_inventory_sha256,
                    recovery_baseline_inventory_sha256=baseline_id,
                )
            self.assertFalse(self.output.exists())
            self.assertFalse(self.receipt.exists())
        self.assert_inputs_unchanged()

    def test_stale_baseline_overlay_is_rejected_after_receiving_new_composition_plan(self):
        documents, overlay, plan = self.recovery_fixture()
        (self.old / "manifest.json").write_bytes(b"new baseline catalog default")
        current = inventory_from_records(records(self.old))
        current_overlay = replace(
            overlay, baseline_inventory_sha256=composition.artifact_inventory_sha256(current)
        )
        current_plan = plan_release_composition(
            current,
            self.new_inventory,
            target="recovery",
            ownership=plan.files,
            baseline_runtime=self.old_runtime,
            candidate_runtime=self.new_runtime,
            recovery=current_overlay,
        )
        with self.assertRaisesRegex(ValueError, "baseline inventory"):
            self.run_assembly(
                plan=current_plan,
                recovery_documents=documents,
                recovery_evidence_sha256=overlay.evidence_sha256,
                recovery_candidate_inventory_sha256=overlay.candidate_inventory_sha256,
                recovery_baseline_inventory_sha256=overlay.baseline_inventory_sha256,
            )
        self.assertFalse(self.output.exists())
        self.assertFalse(self.receipt.exists())

    def test_overlay_bytes_are_detached_from_a_mutated_caller_mapping(self):
        documents, overlay, plan = self.recovery_fixture()
        original = dict(documents)
        real = assembly._copy_file

        def mutate(source, destination, expected):
            documents.clear()
            documents["unexpected.html"] = b"later caller mutation"
            real(source, destination, expected)

        with patch.object(assembly, "_copy_file", side_effect=mutate):
            self.run_assembly(
                plan=plan,
                recovery_documents=documents,
                recovery_evidence_sha256=overlay.evidence_sha256,
                recovery_candidate_inventory_sha256=overlay.candidate_inventory_sha256,
                recovery_baseline_inventory_sha256=overlay.baseline_inventory_sha256,
            )
        for path, raw in original.items():
            self.assertEqual((self.output / path).read_bytes(), raw)
        self.assertFalse((self.output / "unexpected.html").exists())
        self.assert_inputs_unchanged()

    def test_recovery_write_interruption_and_corruption_never_complete(self):
        documents, overlay, plan = self.recovery_fixture()
        real = assembly._write_file
        for mode in ("interrupt", "corrupt"):
            output = self.root / mode

            def fail(raw, destination, expected, *, output=output, mode=mode):
                if destination.relative_to(output).as_posix() in documents:
                    if mode == "interrupt":
                        raise OSError("recovery write interrupted")
                    real(raw, destination, expected)
                    destination.write_bytes(b"corrupted recovery document")
                    return
                real(raw, destination, expected)

            with self.subTest(mode=mode), patch.object(assembly, "_write_file", side_effect=fail):
                with self.assertRaises(OSError if mode == "interrupt" else ValueError):
                    self.run_assembly(
                        plan=plan,
                        output=output,
                        recovery_documents=documents,
                        recovery_evidence_sha256=overlay.evidence_sha256,
                        recovery_candidate_inventory_sha256=overlay.candidate_inventory_sha256,
                        recovery_baseline_inventory_sha256=overlay.baseline_inventory_sha256,
                    )
            self.assertFalse(self.receipt.exists())
        self.assert_inputs_unchanged()

    def test_recovery_writer_checks_bound_and_expected_bytes(self):
        target = self.root / "new.txt"
        raw = b"recovery bytes"
        expected = Fingerprint(len(raw), hashlib.sha256(raw).hexdigest())
        with (
            patch.object(assembly, "MAX_FILE_BYTES", 2),
            self.assertRaisesRegex(ValueError, "limit"),
        ):
            assembly._write_file(raw, target, expected)
        with self.assertRaisesRegex(ValueError, "changed during"):
            assembly._write_file(b"changed", target, expected)
        self.assertFalse(target.exists())


if __name__ == "__main__":
    unittest.main()
