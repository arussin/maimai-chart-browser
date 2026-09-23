"""Bounded local operational events, deliberately separate from usage collection."""

from __future__ import annotations

import json
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path

from .corpus_policy import Stage
from .coverage_types import IntegrityError, ReviewError


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
        outcome, code, recovery = "complete", "ok", "none"
        try:
            yield counts
        except (IntegrityError, ReviewError, ValueError):
            outcome, code, recovery = (
                "blocked",
                "input_or_integrity",
                "inspect_evidence_then_prepare",
            )
            raise
        except OSError:
            outcome, code, recovery = "failed", "local_io", "repair_storage_then_resume"
            raise
        except (KeyboardInterrupt, SystemExit):
            outcome, code, recovery = "interrupted", "interrupted", "inspect_lock_then_resume"
            raise
        except Exception:
            outcome, code, recovery = (
                "failed",
                "programming_error",
                "repair_implementation_then_prepare",
            )
            raise
        finally:
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
