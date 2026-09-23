"""Failure/recovery checks use fictional retained inputs and prohibit network access."""

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from maimai_intelligence.cli import main
from maimai_intelligence.corpus_attempts import resume_options, verify_attempt
from maimai_intelligence.corpus_diagnostics import Diagnostics
from maimai_intelligence.corpus_update import implementation_hash, prepare_update, verify_candidate
from maimai_intelligence.corpus_workbench import diff_runs, inspect_run, write_workbench
from maimai_intelligence.lab import build_lab
from maimai_intelligence.snapshots import atomic_json, read_json
from tests.lab_fixture import write_package
from tests.mai_notes_fixture import encoded


class CorpusPipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.package = write_package(self.root / "package", grouped=True, constants=True)
        charts = json.loads((self.package / "catalog.json").read_bytes())
        self.snapshot = self.root / "links.json"
        self.snapshot.write_bytes(encoded(charts))
        self.browser = self.root / "browser"
        build_lab(self.package, self.browser, catalog_version="fictional-baseline")
        self.store = self.root / "store"

    def prepare(self):
        with patch("socket.socket", side_effect=AssertionError("Network forbidden")):
            return prepare_update(
                self.store,
                self.browser,
                package=self.package,
                mai_notes_snapshot=self.snapshot,
                offline=True,
            )

    def test_resume_creates_new_attempt_and_does_not_advance_publication(self):
        first = self.prepare()
        options = resume_options(first, implementation_hash())
        with patch("socket.socket", side_effect=AssertionError("Network forbidden")):
            second = prepare_update(self.store, **options)
        self.assertNotEqual(first, second)
        self.assertEqual(verify_candidate(first)["files"], verify_candidate(second)["files"])
        self.assertEqual(
            read_json(second / "attempt.json")["body"]["predecessor"]["run"], first.name
        )
        self.assertEqual(
            diff_runs(first, second)["public_files"], {"added": (), "removed": (), "changed": ()}
        )
        self.assertFalse((self.store / "latest.json").exists())

    def test_interrupted_render_retains_inputs_and_actionable_sanitized_diagnostics(self):
        with patch(
            "maimai_intelligence.corpus_update.build_public_release",
            side_effect=OSError("private-body-and-credential-sentinel"),
        ):
            with self.assertRaises(OSError):
                self.prepare()
        run = next((self.store / "runs").iterdir())
        self.assertFalse((run / "ready.json").exists())
        record = verify_attempt(run, implementation_hash())
        self.assertEqual(record["body"]["values"]["offline"], True)
        view = inspect_run(run)
        failure = view["operations"]["stages"][-1]
        self.assertEqual(
            (failure["stage"], failure["code"], failure["retry"]),
            ("render", "local_io", "repair_storage_then_resume"),
        )
        self.assertNotIn(
            "private-body-and-credential-sentinel", (run / "diagnostics.jsonl").read_text()
        )
        resumed = prepare_update(self.store, **resume_options(run, implementation_hash()))
        self.assertTrue((resumed / "ready.json").exists())
        self.assertEqual(read_json(run / "state.json")["status"], "failed")

    def test_changed_inputs_policy_and_receipts_block_reuse(self):
        run = self.prepare()
        with self.assertRaisesRegex(ValueError, "policy changed"):
            verify_attempt(run, "different policy")
        raw = self.snapshot.read_bytes()
        self.snapshot.write_bytes(b"tampered")
        with self.assertRaisesRegex(ValueError, "inputs changed"):
            resume_options(run, implementation_hash())
        self.snapshot.write_bytes(raw)
        receipt = read_json(run / "attempt.json")
        receipt["body"]["values"]["offline"] = False
        atomic_json(run / "attempt.json", receipt)
        with self.assertRaisesRegex(ValueError, "integrity mismatch"):
            verify_attempt(run, implementation_hash())

    def test_workbench_is_derived_nonmutating_and_blocks_active_content(self):
        run = self.prepare()
        before = read_json(run / "ready.json")
        changes = read_json(run / "changes.json")
        changes["fictional"] = '</script><script>fetch("https://example.invalid/private")</script>'
        atomic_json(run / "changes.json", changes)
        output = write_workbench(run, self.root / "workbench.html")
        text = output.read_text("utf-8")
        self.assertNotIn(changes["fictional"], text)
        self.assertIn("connect-src 'none'", text)
        self.assertIn("form-action 'none'", text)
        self.assertEqual(before, read_json(run / "ready.json"))
        self.assertFalse((self.store / "latest.json").exists())
        with self.assertRaisesRegex(ValueError, "outside"):
            write_workbench(run, run / "workbench.html")
        with self.assertRaisesRegex(ValueError, "capture receipt"):
            resume_options(run, implementation_hash(), replay=True)

    def test_installed_cli_defaults_offline_and_never_publishes(self):
        output = io.StringIO()
        with (
            contextlib.redirect_stdout(output),
            patch("socket.socket", side_effect=AssertionError("Network forbidden")),
        ):
            self.assertEqual(
                main(
                    [
                        "corpus",
                        "prepare",
                        "--store",
                        str(self.store),
                        "--previous-browser",
                        str(self.browser),
                        "--package",
                        str(self.package),
                        "--mai-notes-snapshot",
                        str(self.snapshot),
                    ]
                ),
                0,
            )
        record = json.loads(output.getvalue())
        self.assertIs(record["published"], False)
        run = Path(record["run"])
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(main(["corpus", "verify", "--run", str(run)]), 0)
            self.assertEqual(
                main(
                    [
                        "corpus",
                        "inspect",
                        "--run",
                        str(run),
                        "--workbench",
                        str(self.root / "view.html"),
                    ]
                ),
                0,
            )

    def test_owner_attempt_uses_same_explicit_source_identity_in_installed_cli(self):
        from scripts.update_catalog import prepare_update as owner_prepare

        run = owner_prepare(
            self.store,
            self.browser,
            package=self.package,
            mai_notes_snapshot=self.snapshot,
            offline=True,
        )
        root = Path(__file__).resolve().parents[1]
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(
                main(["corpus", "verify", "--run", str(run), "--source-root", str(root)]), 0
            )
            self.assertEqual(
                main(["corpus", "resume", "--from", str(run), "--source-root", str(root)]), 0
            )
        with self.assertRaisesRegex(ValueError, "policy changed"):
            verify_attempt(run, implementation_hash())

    def test_failure_categories_abort_and_never_log_exception_messages(self):
        cases = [
            (ValueError("secret"), "blocked"),
            (OSError("secret"), "failed"),
            (TypeError("secret"), "failed"),
            (KeyboardInterrupt("secret"), "interrupted"),
        ]
        for i, (error, outcome) in enumerate(cases):
            run = self.root / str(i)
            run.mkdir()
            with self.assertRaises(type(error)):
                with Diagnostics(run, lambda: 0).stage("corpus"):
                    raise error
            text = (run / "diagnostics.jsonl").read_text()
            self.assertNotIn("secret", text)
            self.assertEqual(json.loads(text.splitlines()[-1])["outcome"], outcome)
