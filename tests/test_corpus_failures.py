"""Finite failure policy never diagnoses untyped exceptions by their message."""

import unittest

from maimai_intelligence.corpus_failures import (
    CorpusInputError,
    diagnose_failure,
    secondary_failure_codes,
)
from maimai_intelligence.corpus_policy import ReuseIdentity, SourceSelection
from maimai_intelligence.coverage_types import IntegrityError, ReviewError, SnapshotError


class FailurePolicyTests(unittest.TestCase):
    def test_declared_input_storage_interruption_and_unknown_categories(self):
        cases = [
            *[
                (error("private"), "blocked", "input_or_integrity")
                for error in (CorpusInputError, IntegrityError, ReviewError, SnapshotError)
            ],
            (OSError("private"), "failed", "local_io"),
            *[
                (error(), "interrupted", "interrupted")
                for error in (KeyboardInterrupt, SystemExit, GeneratorExit)
            ],
            *[
                (error("private"), "failed", "unclassified_error")
                for error in (ValueError, TypeError, RuntimeError, AssertionError, BaseException)
            ],
        ]
        for error, outcome, code in cases:
            with self.subTest(error=type(error)):
                diagnosis = diagnose_failure(error)
                self.assertEqual((diagnosis.outcome, diagnosis.code), (outcome, code))
                self.assertNotIn("private", repr(diagnosis))

    def test_known_request_and_reuse_rejections_have_explicit_ownership(self):
        with self.assertRaises(CorpusInputError):
            SourceSelection(False, False, False, True, False, False, False).validate()
        with self.assertRaises(CorpusInputError):
            ReuseIdentity("base", "implementation", "reviews").require_equal(
                ReuseIdentity("different", "implementation", "reviews")
            )

    def test_diagnosis_never_reads_or_interprets_exception_text(self):
        class Unprintable(ValueError):
            def __str__(self):
                raise AssertionError("Do not inspect raw error messages")

        self.assertEqual(diagnose_failure(Unprintable()).code, "unclassified_error")

    def test_secondary_codes_are_finite_deduplicated_and_ignore_private_notes(self):
        error = ValueError()
        self.assertEqual(secondary_failure_codes(error), ())
        error.add_note("private source message")
        error.add_note("corpus.writer_lock_cleanup_failed")
        error.add_note("corpus.diagnostic_record_failed")
        error.add_note("corpus.diagnostic_record_failed")
        error.add_note("corpus.failure_state_record_failed")
        self.assertEqual(
            secondary_failure_codes(error),
            (
                "corpus.diagnostic_record_failed",
                "corpus.failure_state_record_failed",
                "corpus.writer_lock_cleanup_failed",
            ),
        )
        self.assertEqual(secondary_failure_codes(ValueError()), ())
