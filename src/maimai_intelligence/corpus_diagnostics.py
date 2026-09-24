"""Bounded local operational events, deliberately separate from usage collection."""

from __future__ import annotations

import json
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from .corpus_failures import diagnose_failure
from .corpus_policy import Stage
from .snapshots import MAX_BYTES

Mode = Literal["retained", "online", "replay", "reassess"]
Source = Literal["registry", "legacy_package"]
Count = int | None | Literal["not_applicable"]
COUNT_NAMES = ("records", "accepted", "unresolved")
MODES = ("retained", "online", "replay", "reassess")
SOURCES = ("registry", "legacy_package")
EVIDENCE = frozenset(
    {
        "source-captures.json",
        "source-audit.json",
        "coverage-audit.json",
        "coverage-state.json",
        "registry-provenance.json",
        "mai-notes-audit.json",
        "changes.json",
        "report.md",
    }
)


def _count(value: Count) -> tuple[int | None, str]:
    if value is None:
        return None, "unknown"
    if value == "not_applicable":
        return None, "not_applicable"
    if type(value) is not int or value < 0:
        raise ValueError("Diagnostic counts must be measured nonnegative integers")
    return value, "measured"


@dataclass
class StageCounts:
    records: Count = None
    accepted: Count = None
    unresolved: Count = None
    evidence: list[str] = field(default_factory=list)

    def record(self) -> dict[str, object]:
        values = {name: _count(getattr(self, name)) for name in COUNT_NAMES}
        if any(name not in EVIDENCE for name in self.evidence):
            raise ValueError("Unknown diagnostic evidence reference")
        return {
            "counts": {name: value for name, (value, _) in values.items()},
            "count_states": {name: state for name, (_, state) in values.items()},
            "evidence": list(dict.fromkeys(self.evidence)),
        }


class Diagnostics:
    def __init__(
        self,
        run: Path,
        clock: Callable[[], float] = time.monotonic,
        *,
        mode: Mode = "retained",
        source: Source = "registry",
    ) -> None:
        if mode not in MODES or source not in SOURCES:
            raise ValueError("Unknown diagnostic source or mode")
        self.path = run / "diagnostics.jsonl"
        self.clock = clock
        self.mode = mode
        self.source = source

    def _write(self, event: dict[str, object]) -> None:
        # Raw provider messages, URLs, private inputs and credentials are not fields.
        record = {
            **event,
            "version": "corpus-diagnostics-2",
            "source": self.source,
            "mode": self.mode,
        }
        with self.path.open("a", encoding="utf-8", newline="\n") as stream:
            stream.write(json.dumps(record, sort_keys=True) + "\n")
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
                "outcome": outcome,
                "code": code,
                "duration_ms": round(max(0, self.clock() - start) * 1000, 3),
                **counts.record(),
                "retry": recovery,
            }
        )


def _decode(event: Any) -> dict[str, Any]:
    if not isinstance(event, dict):
        raise ValueError("Local diagnostic must be an object")
    version = event.get("version")
    if version not in ("corpus-diagnostics-1", "corpus-diagnostics-2"):
        raise ValueError("Unknown local diagnostic schema")
    result = dict(event)
    if version == "corpus-diagnostics-1":
        # v1 source was a constant and zeros were also defaults, not measurements.
        result.update(source="unknown", mode="unknown")
        if "counts" in result:
            counts = result["counts"]
            if not isinstance(counts, dict) or set(counts) != set(COUNT_NAMES):
                raise ValueError("Invalid historical diagnostic counts")
            for value in counts.values():
                if type(value) is not int or value < 0:
                    raise ValueError("Invalid historical diagnostic count")
            result["counts"] = {name: value if value else None for name, value in counts.items()}
            result["count_states"] = {
                name: "measured" if value else "unknown" for name, value in counts.items()
            }
        return result
    if result.get("mode") not in MODES or result.get("source") not in SOURCES:
        raise ValueError("Unknown diagnostic source or mode")
    if "counts" in result or "count_states" in result:
        counts, states = result.get("counts"), result.get("count_states")
        if not isinstance(counts, dict) or not isinstance(states, dict):
            raise ValueError("Invalid diagnostic measurements")
        if set(counts) != set(COUNT_NAMES) or set(states) != set(COUNT_NAMES):
            raise ValueError("Incomplete diagnostic measurements")
        for name in COUNT_NAMES:
            value, state = counts[name], states[name]
            if state == "measured":
                if type(value) is not int or value < 0:
                    raise ValueError("Invalid measured diagnostic count")
            elif state not in ("unknown", "not_applicable") or value is not None:
                raise ValueError("Invalid unmeasured diagnostic count")
    return result


def read_diagnostics(run: Path) -> list[dict[str, Any]]:
    """Read both schemas without turning legacy defaults or torn tails into success."""
    path = run / "diagnostics.jsonl"
    if not path.exists():
        return []
    with path.open("rb") as stream:
        raw = stream.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError("Local diagnostics exceed their bounded review size")
    result = []
    lines = raw.splitlines(keepends=True)
    for index, line in enumerate(lines):
        try:
            event = json.loads(line)
        except (json.JSONDecodeError, UnicodeDecodeError):
            if index != len(lines) - 1 or line.endswith((b"\n", b"\r")):
                raise ValueError("Malformed complete local diagnostic record") from None
            result.append(
                {
                    "version": "corpus-diagnostics-2",
                    "stage": "diagnostics",
                    "source": "unknown",
                    "mode": "unknown",
                    "outcome": "interrupted",
                    "code": "incomplete_diagnostic_record",
                    "retry": "inspect_attempt",
                }
            )
            break
        result.append(_decode(event))
    return result
