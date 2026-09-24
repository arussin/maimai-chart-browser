"""A secondary recording/cleanup failure cannot change the primary outcome."""

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from maimai_intelligence.cli import main
from maimai_intelligence.corpus_diagnostics import Diagnostics
from maimai_intelligence.corpus_update import verify_candidate
from maimai_intelligence.corpus_workbench import inspect_run
from maimai_intelligence.coverage_types import IntegrityError
from maimai_intelligence.snapshots import atomic_json, read_json
from maimai_intelligence.store_lock import writer_lock
from tests import test_corpus_pipeline as pipeline_fixture


class DiagnosticFailureTests(unittest.TestCase):
    def test_untyped_value_error_is_not_blame_assigned_to_input(self):
        events = []
        diagnostic = Diagnostics(Path("unused"), lambda: 0)
        with patch.object(diagnostic, "_write", events.append):
            with self.assertRaises(ValueError):
                with diagnostic.stage("corpus"):
                    raise ValueError("private sentinel")
        self.assertEqual(events[-1]["code"], "unclassified_error")
        self.assertEqual(events[-1]["retry"], "inspect_failure_then_prepare")
        self.assertNotIn("private sentinel", json.dumps(events))

    def test_primary_survives_terminal_sink_or_clock_failure(self):
        for primary in (
            IntegrityError("private primary"),
            ValueError("private primary"),
            KeyboardInterrupt(),
        ):
            for failure in (OSError("private secondary"), RuntimeError("private secondary")):
                with self.subTest(primary=type(primary), secondary=type(failure)):
                    diagnostic = Diagnostics(Path("unused"), lambda: 0)
                    with patch.object(diagnostic, "_write", side_effect=[None, failure]):
                        with self.assertRaises(type(primary)) as caught:
                            with diagnostic.stage("corpus"):
                                raise primary
                    self.assertIs(caught.exception, primary)
                    self.assertIn("corpus.diagnostic_record_failed", primary.__notes__)
                    self.assertNotIn("private secondary", repr(primary.__notes__))
        primary = RuntimeError("primary")
        diagnostic = Diagnostics(
            Path("unused"), clock=unittest.mock.Mock(side_effect=[0, OSError()])
        )
        with patch.object(diagnostic, "_write"):
            with self.assertRaises(RuntimeError) as caught:
                with diagnostic.stage("render"):
                    raise primary
        self.assertIs(caught.exception, primary)

    def test_start_and_successful_terminal_failures_are_not_silenced(self):
        for side_effect in ([OSError("start")], [None, OSError("finish")]):
            diagnostic = Diagnostics(Path("unused"), lambda: 0)
            entered = []
            with patch.object(diagnostic, "_write", side_effect=side_effect):
                with self.assertRaises(OSError):
                    with diagnostic.stage("render"):
                        entered.append(True)
            self.assertEqual(bool(entered), len(side_effect) == 2)

    def test_cleanup_preserves_failure_or_reports_completed_operation(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Path(directory)
            original = Path.unlink

            def fail_lock(path, *args, **kwargs):
                if path.name == "writer.lock":
                    raise OSError("private cleanup sentinel")
                return original(path, *args, **kwargs)

            primary = RuntimeError("primary")
            with patch.object(Path, "unlink", fail_lock):
                with self.assertRaises(RuntimeError) as caught:
                    with writer_lock(store):
                        raise primary
            self.assertIs(caught.exception, primary)
            self.assertIn("corpus.writer_lock_cleanup_failed", primary.__notes__)
            self.assertTrue((store / "writer.lock").exists())
            with self.assertRaisesRegex(ValueError, "inspect writer.lock"):
                with writer_lock(store):
                    self.fail("Existing lease must block")
            (store / "writer.lock").unlink()
            with patch.object(Path, "unlink", fail_lock):
                with self.assertRaisesRegex(OSError, "operation completed") as caught:
                    with writer_lock(store):
                        pass
            self.assertEqual(type(caught.exception).__name__, "LockCleanupError")
            self.assertNotIn("private cleanup", str(caught.exception))


class PreparationFailureTests(unittest.TestCase):
    setUp = pipeline_fixture.CorpusPipelineTests.setUp
    prepare = pipeline_fixture.CorpusPipelineTests.prepare

    def test_installed_cli_reports_finite_secondary_codes(self):
        error = IntegrityError("rejected retained evidence")
        error.add_note("private secondary message")
        error.add_note("corpus.diagnostic_record_failed")
        stderr = io.StringIO()
        with (
            patch("maimai_intelligence.corpus_cli.execute", side_effect=error),
            contextlib.redirect_stderr(stderr),
        ):
            result = main(["corpus", "inspect", "--run", str(self.root)])
        self.assertEqual(result, 1)
        self.assertIn("corpus.diagnostic_record_failed", stderr.getvalue())
        self.assertNotIn("private secondary", stderr.getvalue())

    def test_receipt_diagnostic_failure_cannot_leave_a_ready_candidate(self):
        original = Diagnostics._write

        def fail_terminal(diagnostic, event):
            if event.get("stage") == "receipt" and event.get("outcome") == "complete":
                raise OSError("terminal failure")
            original(diagnostic, event)

        with patch.object(Diagnostics, "_write", fail_terminal):
            with self.assertRaises(OSError):
                self.prepare()
        run = next((self.store / "runs").iterdir())
        self.assertFalse((run / "ready.json").exists())
        self.assertEqual(read_json(run / "state.json")["status"], "failed")
        with self.assertRaises(FileNotFoundError):
            verify_candidate(run)
        self.assertFalse((self.store / "latest.json").exists())

    def test_failed_state_persistence_cannot_replace_primary(self):
        primary = RuntimeError("primary")

        def fail_state(path, value):
            if Path(path).name == "state.json" and value.get("status") == "failed":
                raise OSError("private secondary")
            return atomic_json(path, value)

        with (
            patch("maimai_intelligence.corpus_update._render_artifacts", side_effect=primary),
            patch("maimai_intelligence.corpus_update.atomic_json", fail_state),
        ):
            with self.assertRaises(RuntimeError) as caught:
                self.prepare()
        self.assertIs(caught.exception, primary)
        self.assertIn("corpus.failure_state_record_failed", primary.__notes__)
        self.assertFalse(next((self.store / "runs").iterdir()).joinpath("ready.json").exists())

    def test_attempt_binding_failure_belongs_to_input_stage(self):
        with patch(
            "maimai_intelligence.corpus_update.bind_attempt",
            side_effect=IntegrityError("private mismatch"),
        ):
            with self.assertRaises(IntegrityError):
                self.prepare()
        run = next((self.store / "runs").iterdir())
        events = [json.loads(line) for line in (run / "diagnostics.jsonl").read_text().splitlines()]
        self.assertEqual((events[-1]["stage"], events[-1]["outcome"]), ("inputs", "blocked"))
        self.assertFalse((run / "ready.json").exists())

    def test_workbench_does_not_claim_ready_from_uncommitted_state(self):
        run = self.root / "incomplete"
        run.mkdir()
        atomic_json(run / "state.json", {"status": "ready"})
        view = inspect_run(run)
        self.assertEqual(view["operations"]["state"]["status"], "incomplete")

    def test_workbench_exposes_contradictory_legacy_state_without_verifying_it(self):
        run = self.root / "contradictory"
        run.mkdir()
        atomic_json(run / "state.json", {"status": "failed"})
        atomic_json(run / "ready.json", {"status": "ready"})
        state = inspect_run(run)["operations"]["state"]
        self.assertEqual(state["status"], "inconsistent")
        self.assertEqual(state["recorded_status"], "failed")
        self.assertEqual(state["candidate_receipt"], "present_unverified")

    def test_failed_final_commit_has_no_ready_marker_or_publication(self):
        def fail_commit(path, value):
            if Path(path).name == "ready.json":
                raise OSError("commit failed")
            return atomic_json(path, value)

        with patch("maimai_intelligence.corpus_update.atomic_json", fail_commit):
            with self.assertRaisesRegex(OSError, "commit failed"):
                self.prepare()
        run = next((self.store / "runs").iterdir())
        self.assertFalse((run / "ready.json").exists())
        self.assertEqual(read_json(run / "state.json")["status"], "failed")
        self.assertFalse((self.store / "published.json").exists())

    def test_post_commit_cleanup_failure_preserves_committed_candidate(self):
        original = Path.unlink

        def fail_lock(path, *args, **kwargs):
            if path == self.store.resolve() / "writer.lock":
                raise OSError("private cleanup")
            return original(path, *args, **kwargs)

        with patch.object(Path, "unlink", fail_lock):
            with self.assertRaisesRegex(OSError, "operation completed"):
                self.prepare()
        run = next((self.store / "runs").iterdir())
        self.assertEqual(read_json(run / "state.json")["status"], "ready")
        self.assertEqual(verify_candidate(run)["status"], "ready")
        self.assertTrue((self.store / "writer.lock").exists())
        self.assertFalse((self.store / "latest.json").exists())


if __name__ == "__main__":
    unittest.main()
