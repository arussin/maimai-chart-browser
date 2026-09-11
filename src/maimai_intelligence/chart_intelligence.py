from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

from maimai_analyzer.catalog import build_catalog
from maimai_analyzer.contracts import MAX_INPUT_BYTES


def ensure_separate_preparation_paths(inputs: tuple[Path, ...], outputs: tuple[Path, ...]) -> None:
    """Refuse derived writes that alias an explicit preparation input.

    Resolve dot segments and existing symbolic links before any output is written.
    Callers include every derived destination, including adjacent manifests.
    """
    try:
        sources = {path.resolve() for path in inputs}
        destinations = {path.resolve() for path in outputs}
    except (OSError, RuntimeError) as exc:
        raise ValueError("Could not resolve local preparation input/output paths") from exc
    if sources & destinations:
        raise ValueError("Derived output or manifest must not overwrite a preparation input")
    if len(destinations) != len(outputs):
        raise ValueError("Derived output and manifest must be separate destinations")


def read_local_json(path: Path) -> dict:
    """Bound reads before JSON expansion; never follows source-provided paths."""
    with path.open("rb") as stream:
        raw = stream.read(MAX_INPUT_BYTES + 1)
    if len(raw) > MAX_INPUT_BYTES:
        raise ValueError("Local analysis input exceeds 32 MiB")
    try:
        result = json.loads(
            raw,
            parse_constant=lambda _: (_ for _ in ()).throw(
                ValueError("Nonfinite JSON is forbidden")
            ),
        )
    except (RecursionError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("Invalid local analysis JSON") from exc
    if not isinstance(result, dict):
        raise ValueError("Expected a local JSON object")
    return result


def read_catalog_pack(path: Path) -> dict:
    """Read an explicit catalog and enforce its nonpersonal presentation boundary."""
    from .explorer import validate_exploration_pack

    return validate_exploration_pack(read_local_json(path))


def player_overlay(
    after_payload: dict,
    mapping: dict[str, str],
    *,
    cutoff_ms: int,
    attempts: list[dict] | None = None,
    capture_ids: tuple[str, ...] = (),
) -> dict:
    """Join exact provider IDs only; PB snapshots never become fabricated attempts."""
    if type(cutoff_ms) is not int or cutoff_ms < 0:
        raise ValueError("A valid retained snapshot cutoff is required")
    if not isinstance(mapping, dict) or any(
        not isinstance(key, str) or not key or not isinstance(value, str) or not value
        for key, value in mapping.items()
    ):
        raise ValueError("Chart mapping must contain explicit nonempty string IDs")
    if len(set(mapping.values())) != len(mapping):
        raise ValueError("Ambiguous provider-to-catalog chart mapping")
    if not isinstance(after_payload, dict):
        raise ValueError("Explicit PB snapshot must be an object")
    body = after_payload.get("body", after_payload)
    if not isinstance(body, dict):
        raise ValueError("Explicit PB snapshot body must be an object")
    pbs = body.get("pbs")
    if not isinstance(pbs, list) or any(not isinstance(pb, dict) for pb in pbs):
        raise ValueError("Explicit PB snapshot requires a pbs list")
    entries = {}
    for pb in pbs:
        provider_id = pb.get("chartID")
        cid = mapping.get(provider_id)
        if cid is None:
            continue
        if cid in entries:
            raise ValueError("Duplicate mapped PB chart")
        when = pb.get("timeAchieved")
        if when is not None and (type(when) is not int or not 0 <= when <= cutoff_ms):
            raise ValueError("PB lies after report cutoff or has invalid time")
        score, calculated = pb.get("scoreData", {}), pb.get("calculatedData", {})
        entry = {
            "chart_id": cid,
            "percent": score.get("percent"),
            "rate": calculated.get("rate"),
            "lamp": score.get("lamp") or "",
            "grade": score.get("grade") or "",
            "pb_achieved_at": when,
            "last_played": None,
            "attempt_count": None,
            "attempts": [],
        }
        entries[cid] = entry
    seen = {}
    if attempts is not None and (
        not isinstance(attempts, list) or any(not isinstance(item, dict) for item in attempts)
    ):
        raise ValueError("Attempts must be an explicit list of records")
    for attempt in attempts or []:
        aid, when = attempt.get("scoreID"), attempt.get("timeAchieved")
        if not isinstance(aid, str) or not aid or type(when) is not int or when < 0:
            raise ValueError("Attempts require explicit stable IDs and timestamps")
        if aid in seen:
            if seen[aid] != attempt:
                raise ValueError("Conflicting records for one attempt ID")
            continue
        seen[aid] = attempt
        if when > cutoff_ms:
            continue
        cid = mapping.get(attempt.get("chartID"))
        if cid is None:
            continue
        # Retained attempts establish play evidence, never an inferred PB.
        if cid not in entries:
            entries[cid] = {
                "chart_id": cid,
                "percent": None,
                "rate": None,
                "lamp": "",
                "grade": "",
                "pb_achieved_at": None,
                "last_played": None,
                "attempt_count": None,
                "attempts": [],
            }
        score, calc = attempt.get("scoreData", {}), attempt.get("calculatedData", {})
        entries[cid]["attempts"].append(
            {
                "attempt_id": aid,
                "recorded_at": when,
                "percent": score.get("percent"),
                "rate": calc.get("rate"),
                "lamp": score.get("lamp") or "",
                "grade": score.get("grade") or "",
            }
        )
    for entry in entries.values():
        entry["attempts"].sort(key=lambda a: (a["recorded_at"], a["attempt_id"]))
        if entry["attempts"]:
            entry["last_played"] = entry["attempts"][-1]["recorded_at"]
        if attempts is not None:
            entry["attempt_count"] = len(entry["attempts"])
    return {
        "entries": [entries[cid] for cid in sorted(entries)],
        "coverage": {
            "cutoff_ms": cutoff_ms,
            "scope": "Supplied PB snapshot and available attempts",
            "history_complete": False,
            "recent_only": True,
            "truncated": False,
            "unknown_gaps": True,
            "capture_ids": list(capture_ids),
        },
    }


def synthetic_catalog() -> tuple[dict, dict]:
    from maimai_analyzer import analyze, pattern_registry, synthetic_charts

    charts = synthetic_charts()
    profiles = [analyze(c) for c in charts]
    metadata = [
        {
            **{key: c[key] for key in ("chart_id", "song_id", "format", "difficulty", "revision")},
            "title": "Synthetic " + c["chart_id"].split(":")[1].replace("-", " "),
            "artist": "Fictional fixture",
            "level": "9",
            "constant": 9.0 + i / 10,
            "release": "Synthetic release",
            "region": "Synthetic",
            "availability": "available",
            "source_status": "available",
            "identity_status": "exact",
            "source_id": c["source"]["source_id"],
            "source_revision": c["source"]["revision"],
        }
        for i, c in enumerate(charts)
    ]
    metadata.append(
        {
            "chart_id": "synthetic:missing:DX:EXPERT:r1",
            "song_id": "synthetic:missing",
            "format": "DX",
            "difficulty": "EXPERT",
            "revision": "r1",
            "title": "Synthetic unknown chart",
            "source_status": "missing",
        }
    )
    return build_catalog(
        metadata, profiles, pattern_registry(), catalog_id="authored-synthetic-demo"
    )


def cutoff_from_report(report: dict) -> int:
    value = report.get("generatedAt")
    if not isinstance(value, str):
        raise ValueError("Explore overlay requires retained generatedAt cutoff")
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Snapshot cutoff needs an explicit timezone")
    return int(parsed.timestamp() * 1000)
