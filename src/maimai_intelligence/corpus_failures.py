"""Finite failure decisions; no inference about untyped exception ownership."""

from dataclasses import dataclass
from typing import Literal

from .coverage_types import IntegrityError, ReviewError, SnapshotError


class CorpusInputError(ValueError):
    """An explicitly rejected corpus request or reuse policy, not an inferred bug."""


@dataclass(frozen=True)
class FailureDiagnosis:
    outcome: Literal["blocked", "failed", "interrupted"]
    code: Literal["input_or_integrity", "local_io", "interrupted", "unclassified_error"]
    recovery: Literal[
        "inspect_evidence_then_prepare",
        "repair_storage_then_resume",
        "inspect_lock_then_resume",
        "inspect_failure_then_prepare",
    ]


def diagnose_failure(error: BaseException) -> FailureDiagnosis:
    if isinstance(error, (CorpusInputError, IntegrityError, ReviewError, SnapshotError)):
        return FailureDiagnosis("blocked", "input_or_integrity", "inspect_evidence_then_prepare")
    if isinstance(error, OSError):
        return FailureDiagnosis("failed", "local_io", "repair_storage_then_resume")
    if isinstance(error, (KeyboardInterrupt, SystemExit, GeneratorExit)):
        return FailureDiagnosis("interrupted", "interrupted", "inspect_lock_then_resume")
    return FailureDiagnosis("failed", "unclassified_error", "inspect_failure_then_prepare")


def secondary_failure_codes(error: BaseException) -> tuple[str, ...]:
    """Expose only known finite notes to CLI consumers, never arbitrary error text."""
    notes = getattr(error, "__notes__", None)
    if not isinstance(notes, list):
        return ()
    return tuple(
        code
        for code in (
            "corpus.diagnostic_record_failed",
            "corpus.failure_state_record_failed",
            "corpus.writer_lock_cleanup_failed",
        )
        if code in notes
    )
