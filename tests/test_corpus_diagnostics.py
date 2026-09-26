"""Operational measurements never turn missing evidence into a measured zero."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from maimai_intelligence.corpus_diagnostics import Diagnostics, StageCounts, read_diagnostics


class CorpusDiagnosticsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.run = Path(self.temp.name)
        self.path = self.run / "diagnostics.jsonl"

    def test_unmeasured_zero_and_not_applicable_are_distinct(self):
        with Diagnostics(self.run, lambda: 1).stage("claims") as counts:
            counts.records = 0
            counts.accepted = "not_applicable"
        event = read_diagnostics(self.run)[-1]
        self.assertEqual(event["counts"], {"records": 0, "accepted": None, "unresolved": None})
        self.assertEqual(
            event["count_states"],
            {
                "records": "measured",
                "accepted": "not_applicable",
                "unresolved": "unknown",
            },
        )
        self.assertEqual(event["version"], "corpus-diagnostics-2")

    def test_unsupplied_stage_counts_remain_unknown(self):
        with Diagnostics(self.run).stage("inputs"):
            pass
        event = read_diagnostics(self.run)[-1]
        self.assertEqual(set(event["counts"].values()), {None})
        self.assertEqual(set(event["count_states"].values()), {"unknown"})

    def test_all_operations_and_source_kinds_are_explicit(self):
        for mode in ("retained", "online", "replay", "reassess"):
            for source in ("registry", "legacy_package"):
                with self.subTest(mode=mode, source=source):
                    with Diagnostics(self.run, mode=mode, source=source).stage("inputs"):
                        pass
                    start, finish = read_diagnostics(self.run)[-2:]
                    for event in (start, finish):
                        self.assertEqual((event["mode"], event["source"]), (mode, source))

    def test_unknown_operation_identity_rejected_before_writing(self):
        for options in ({"mode": "private-url"}, {"source": "credential"}):
            with self.assertRaises(ValueError):
                Diagnostics(self.run, **options)
        self.assertFalse(self.path.exists())

    def test_early_failure_retains_unknown_counts_and_no_exception_text(self):
        primary = OSError("private-credential-body")
        with self.assertRaises(OSError) as caught:
            with Diagnostics(self.run, mode="replay").stage("inputs"):
                raise primary
        self.assertIs(caught.exception, primary)
        event = read_diagnostics(self.run)[-1]
        self.assertEqual((event["outcome"], event["code"]), ("failed", "local_io"))
        self.assertEqual(event["mode"], "replay")
        self.assertEqual(set(event["counts"].values()), {None})
        self.assertNotIn("private-credential-body", self.path.read_text())

    def test_owned_publication_capacity_refusal_is_actionable_and_preserves_inputs(self):
        from maimai_intelligence.public_release import ReleasePlan

        source = self.run / "accepted-browser"
        source.mkdir()
        accepted = source / "index.html"
        accepted.write_bytes(b"retained browser")
        output = self.run / "public"
        plan = ReleasePlan(
            {"index.html": b"candidate"},
            {"default": "candidate"},
            {"deployable": False, "capacity_error": "private-capacity-detail"},
            source,
        )
        with self.assertRaises(ValueError):
            with Diagnostics(self.run).stage("render"):
                plan.write_to(output)
        event = read_diagnostics(self.run)[-1]
        self.assertEqual(event["outcome"], "blocked")
        self.assertEqual(event["code"], "publication_capacity")
        self.assertEqual(event["retry"], "review_capacity_then_prepare")
        self.assertNotIn("private-capacity-detail", self.path.read_text())
        self.assertFalse(output.exists())
        self.assertEqual(accepted.read_bytes(), b"retained browser")

    def test_capacity_shaped_programming_error_is_not_reclassified(self):
        with self.assertRaises(ValueError):
            with Diagnostics(self.run).stage("render"):
                raise ValueError("Public release exceeds the Cloudflare Pages file count limit")
        event = read_diagnostics(self.run)[-1]
        self.assertEqual((event["outcome"], event["code"]), ("failed", "unclassified_error"))

    def test_secondary_recording_failure_does_not_replace_primary(self):
        primary = KeyboardInterrupt()
        diagnostics = Diagnostics(self.run)
        with patch.object(diagnostics, "_write", side_effect=[None, OSError("disk")]):
            with self.assertRaises(KeyboardInterrupt) as caught:
                with diagnostics.stage("render"):
                    raise primary
        self.assertIs(caught.exception, primary)
        self.assertEqual(primary.__notes__, ["corpus.diagnostic_record_failed"])

    def test_failure_to_record_completion_prevents_success(self):
        with patch.object(Diagnostics, "_finish", side_effect=OSError("disk")):
            with self.assertRaises(OSError):
                with Diagnostics(self.run).stage("receipt"):
                    pass
        self.assertEqual(read_diagnostics(self.run)[-1]["outcome"], "started")

    def test_counts_reject_boolean_negative_and_unbounded_text(self):
        for value in (True, -1, 0.5, "private-credential-body"):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    StageCounts(records=value).record()
        counts = StageCounts(records=2, evidence=["source-audit.json", "source-audit.json"])
        self.assertEqual(counts.record()["evidence"], ["source-audit.json"])
        with self.assertRaises(ValueError):
            StageCounts(evidence=["https://private.invalid"]).record()

    def test_historical_zero_and_source_are_not_reinterpreted_as_measurements(self):
        event = {
            "version": "corpus-diagnostics-1",
            "stage": "claims",
            "source": "retained_corpus",
            "counts": {"records": 7, "accepted": 0, "unresolved": 0},
        }
        raw = json.dumps(event) + "\n"
        self.path.write_text(raw)
        interpreted = read_diagnostics(self.run)[0]
        self.assertEqual(
            interpreted["counts"], {"records": 7, "accepted": None, "unresolved": None}
        )
        self.assertEqual(interpreted["count_states"]["accepted"], "unknown")
        self.assertEqual((interpreted["source"], interpreted["mode"]), ("unknown", "unknown"))
        self.assertEqual(self.path.read_text(), raw)

    def test_historical_start_and_missing_log_are_supported(self):
        self.assertEqual(read_diagnostics(self.run), [])
        self.path.write_text(json.dumps({"version": "corpus-diagnostics-1", "outcome": "started"}))
        self.assertEqual(read_diagnostics(self.run)[0]["mode"], "unknown")

    def test_torn_last_line_preserves_prior_events_and_marks_interruption(self):
        with Diagnostics(self.run).stage("inputs"):
            pass
        original = self.path.read_bytes()
        for tail in (b'{"stage":', b'{"name":"\xff'):
            self.path.write_bytes(original + tail)
            events = read_diagnostics(self.run)
            self.assertEqual(len(events), 3)
            self.assertEqual(events[-1]["code"], "incomplete_diagnostic_record")
            self.assertEqual(events[-1]["outcome"], "interrupted")

    def test_malformed_complete_or_middle_record_is_not_a_torn_tail(self):
        for raw in (b"{bad}\n", b"{bad}\n{}"):
            self.path.write_bytes(raw)
            with self.assertRaisesRegex(ValueError, "Malformed complete"):
                read_diagnostics(self.run)

    def test_unsupported_or_invalid_complete_schema_rejected_even_without_newline(self):
        bad = [
            [],
            {"version": "unknown"},
            {"version": "corpus-diagnostics-2"},
            {"version": "corpus-diagnostics-1", "counts": {}},
            {
                "version": "corpus-diagnostics-1",
                "counts": {"records": True, "accepted": 0, "unresolved": 0},
            },
        ]
        with Diagnostics(self.run).stage("inputs"):
            pass
        valid = read_diagnostics(self.run)[-1]
        bad.extend(
            [
                {**valid, "counts": {}},
                {**valid, "count_states": None},
                {**valid, "counts": {"records": 1, "accepted": None, "unresolved": None}},
                {
                    **valid,
                    "count_states": {
                        "records": "measured",
                        "accepted": "unknown",
                        "unresolved": "unknown",
                    },
                },
            ]
        )
        for event in bad:
            with self.subTest(event=event):
                self.path.write_text(json.dumps(event))
                with self.assertRaises(ValueError):
                    read_diagnostics(self.run)

    def test_review_size_bound_and_backward_clock(self):
        self.path.write_bytes(b"{}" * 5)
        with patch("maimai_intelligence.corpus_diagnostics.MAX_BYTES", 4):
            with self.assertRaisesRegex(ValueError, "bounded"):
                read_diagnostics(self.run)
        self.path.unlink()
        clock = iter((2.0, 1.0))
        with Diagnostics(self.run, lambda: next(clock)).stage("inputs"):
            pass
        self.assertEqual(read_diagnostics(self.run)[-1]["duration_ms"], 0)
