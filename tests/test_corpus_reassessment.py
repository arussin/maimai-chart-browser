"""Real preparation after producer changes; fictional retained inputs, no network."""

import contextlib
import io
import json
import shutil
import unittest
from pathlib import Path
from unittest.mock import patch

from maimai_intelligence.cli import main
from maimai_intelligence.corpus_attempts import (
    bind_attempt,
    reassess_options,
    resume_options,
    verify_attempt,
    verify_retained_inputs,
)
from maimai_intelligence.corpus_diagnostics import read_diagnostics
from maimai_intelligence.corpus_update import implementation_hash, prepare_update, verify_candidate
from maimai_intelligence.snapshots import read_json
from tests import test_corpus_pipeline as fixtures


class ReassessmentTests(unittest.TestCase):
    setUp = fixtures.CorpusPipelineTests.setUp

    def old_attempt(self):
        with patch("socket.socket", side_effect=AssertionError("Network forbidden")):
            return prepare_update(
                self.store,
                self.browser,
                package=self.package,
                mai_notes_snapshot=self.snapshot,
                offline=True,
                implementation=lambda: "retained-old-producer",
            )

    def test_installed_reassessment_after_code_change_preserves_old_identity_and_outputs(self):
        first = self.old_attempt()
        receipt = (first / "attempt.json").read_bytes()
        with self.assertRaisesRegex(ValueError, "policy changed"):
            resume_options(first, implementation_hash())
        verified = verify_retained_inputs(first)
        self.assertEqual(verified["body"]["implementation"], "retained-old-producer")
        output = io.StringIO()
        with (
            contextlib.redirect_stdout(output),
            patch("socket.socket", side_effect=AssertionError("Network forbidden")),
        ):
            self.assertEqual(main(["corpus", "reassess", "--from", str(first)]), 0)
        second = Path(json.loads(output.getvalue())["run"])
        self.assertNotEqual(first, second)
        for run, mode in ((first, "retained"), (second, "reassess")):
            events = read_diagnostics(run)
            self.assertTrue(events)
            self.assertTrue(all(event["mode"] == mode for event in events))
            self.assertTrue(all(event["source"] == "legacy_package" for event in events))
        current = verify_attempt(second, implementation_hash())
        self.assertEqual(
            current["body"]["predecessor"],
            {"run": first.name, "attempt_sha256": verified["sha256"], "operation": "reassess"},
        )
        self.assertEqual(
            read_json(first / "ready.json")["files"], verify_candidate(second)["files"]
        )
        self.assertEqual(receipt, (first / "attempt.json").read_bytes())
        self.assertFalse((self.store / "latest.json").exists())
        self.assertFalse((self.store / "published.json").exists())

    def test_reassessment_rechecks_input_and_review_binding_before_decisions(self):
        first = self.old_attempt()
        options = reassess_options(first)
        options["coverage_reviews"] = {"titles": [{"assertion": "different"}]}
        with self.assertRaisesRegex(ValueError, "Review assertions changed"):
            prepare_update(self.store, **options)
        self.snapshot.write_bytes(b"changed after verification")
        with self.assertRaisesRegex(ValueError, "inputs changed"):
            prepare_update(self.store, **reassess_options(first))
        self.assertEqual(read_json(first / "state.json")["status"], "ready")

    def test_reassessment_rejects_online_and_unknown_operation(self):
        first = self.old_attempt()
        for field, value, message in (
            ("offline", False, "always offline"),
            ("operation", "bypass", "Unknown attempt"),
        ):
            options = reassess_options(first)
            if field == "operation":
                options["predecessor"][field] = value
            else:
                options[field] = value
            with self.assertRaisesRegex(ValueError, message):
                bind_attempt(
                    first.parent / "20260924T000000Z-ffffffff",
                    options,
                    "new-code",
                    options["predecessor"],
                )

    def test_reassessment_can_use_relocated_inputs_without_rewriting_timestamps(self):
        first = self.old_attempt()
        relocated = self.root / "restored"
        shutil.copytree(self.package, relocated / "package")
        shutil.copytree(self.browser, relocated / "browser")
        shutil.copyfile(self.snapshot, relocated / "links.json")
        shutil.rmtree(self.package)
        shutil.rmtree(self.browser)
        self.snapshot.unlink()
        locations = {
            "package": relocated / "package",
            "previous_browser": relocated / "browser",
            "mai_notes_snapshot": relocated / "links.json",
        }
        with patch("socket.socket", side_effect=AssertionError("Network forbidden")):
            second = prepare_update(
                self.store, **reassess_options(first, input_locations=locations)
            )
        self.assertEqual(
            read_json(first / "ready.json")["files"], verify_candidate(second)["files"]
        )
