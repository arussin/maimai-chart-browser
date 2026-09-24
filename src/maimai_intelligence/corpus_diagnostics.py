"""Bounded local operational events, deliberately separate from usage collection."""

from __future__ import annotations

import json
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path

from .corpus_failures import diagnose_failure
from .corpus_policy import Stage


@dataclass
class StageCounts:
    records: int = 0
    accepted: int = 0
    unresolved: int = 0
    evidence: list[str] = field(default_factory=list)


class Diagnostics:
    def __init__(self, run: Path, clock: Callable[[], float] = time.monotonic) -> None:
        self.path = run / "diagnostics.jsonl"
        self.clock = clock

    def _write(self, event: dict[str, object]) -> None:
        # Callers cannot supply raw provider messages, URLs, private inputs or credentials.
        with self.path.open("a", encoding="utf-8", newline="\n") as stream:
            stream.write(
                json.dumps({"version": "corpus-diagnostics-1", **event}, sort_keys=True) + "\n"
            )
            stream.flush()

    @contextmanager
    def stage(self, name: Stage) -> Iterator[StageCounts]:
        start = self.clock()
        counts = StageCounts()
        self._write({"stage": name, "outcome": "started"})
        try:
            yield counts
        except BaseException as primary:
            diagnosis = diagnose_failure(primary)
            try:
                self._finish(
                    name, counts, start, diagnosis.outcome, diagnosis.code, diagnosis.recovery
                )
            except BaseException:
                BaseException.add_note(primary, "corpus.diagnostic_record_failed")
            raise
        else:
            self._finish(name, counts, start, "complete", "ok", "none")

    def _finish(
        self,
        name: Stage,
        counts: StageCounts,
        start: float,
        outcome: str,
        code: str,
        recovery: str,
    ) -> None:
        self._write(
            {
                "stage": name,
                "source": "retained_corpus",
                "outcome": outcome,
                "code": code,
                "duration_ms": round(max(0, self.clock() - start) * 1000, 3),
                "counts": {
                    "records": counts.records,
                    "accepted": counts.accepted,
                    "unresolved": counts.unresolved,
                },
                "evidence": counts.evidence,
                "retry": recovery,
            }
        )
