"""Relocation changes locations, never the accepted input or policy identity."""

import tempfile
import unittest
from pathlib import Path

from maimai_intelligence.corpus_attempts import bind_attempt, resume_options, verify_attempt
from maimai_intelligence.corpus_cli import input_locations
from maimai_intelligence.serialization import digest
from maimai_intelligence.snapshots import atomic_json


class AttemptLocationTests(unittest.TestCase):
    def test_argument_names_are_explicit_unique_and_preserve_path_separators(self):
        self.assertEqual(
            input_locations(["previous-browser=C:/Restored/browser"]),
            {"previous_browser": Path("C:/Restored/browser")},
        )
        for values in (
            ["unknown=x"],
            ["package"],
            ["package= "],
            ["previous-browser=a", "previous_browser=b"],
        ):
            with self.assertRaises(ValueError):
                input_locations(values)

    def test_legacy_attempt_without_capture_observation_is_retained_but_not_reinterpreted(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            snapshot = root / "capture.json"
            snapshot.write_bytes(b"fictional retained input")
            first = root / "runs" / "20260923T000000Z-00000001"
            first.mkdir(parents=True)
            receipt = bind_attempt(first, {"mai_notes_snapshot": snapshot}, "policy")
            del receipt["body"]["observations"]
            receipt["sha256"] = digest(receipt["body"])
            atomic_json(first / "attempt.json", receipt)
            before = (first / "attempt.json").read_bytes()
            verify_attempt(first, "policy")
            second = first.parent / "20260923T000001Z-00000002"
            second.mkdir()
            options = resume_options(first, "policy")
            with self.assertRaisesRegex(ValueError, "Legacy attempt lacks bound capture metadata"):
                bind_attempt(second, options, "policy", options["predecessor"])
            self.assertEqual((first / "attempt.json").read_bytes(), before)
            self.assertFalse((second / "attempt.json").exists())

    def test_relocated_extra_files_are_rejected_before_an_attempt_is_bound(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            original, restored = root / "original", root / "restored"
            original.mkdir()
            restored.mkdir()
            (original / "data.json").write_bytes(b"retained")
            (restored / "data.json").write_bytes(b"retained")
            first = root / "runs" / "20260923T000000Z-00000001"
            first.mkdir(parents=True)
            bind_attempt(first, {"package": original}, "policy")
            verify_attempt(first, "policy", input_locations={"package": restored})
            (restored / "unexpected.json").write_bytes(b"unreviewed")
            with self.assertRaisesRegex(ValueError, "inputs changed"):
                resume_options(first, "policy", input_locations={"package": restored})
