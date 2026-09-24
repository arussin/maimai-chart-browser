"""Local derived corpus views. Reads evidence; never changes decisions or pointers."""

from __future__ import annotations

import html
import json
from dataclasses import asdict
from importlib.resources import files
from pathlib import Path
from typing import Any

from .corpus_explain import explain_registry
from .corpus_policy import compare_records
from .io import atomic_write_text
from .metadata_policy import BUILTIN_CONTEXT, PolicyContext
from .registry import TABLES, read_registry
from .serialization import digest
from .snapshots import MAX_BYTES, read_json


def read_diagnostics(run: Path) -> list[dict[str, Any]]:
    path = run / "diagnostics.jsonl"
    if not path.exists():
        return []
    with path.open("rb") as stream:
        raw = stream.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError("Local diagnostics exceed their bounded review size")
    result = []
    for line in raw.splitlines():
        event = json.loads(line)
        if event.get("version") != "corpus-diagnostics-1":
            raise ValueError("Unknown local diagnostic schema")
        result.append(event)
    return result


def inspect_registry(
    path: Path, *, policy_context: PolicyContext = BUILTIN_CONTEXT
) -> dict[str, Any]:
    """Explain retained admissions without pretending they are a new completed attempt."""
    registry = read_registry(path, policy_context=policy_context)
    canonical = {
        "records": explain_registry(registry, compact=True),
        "sources": registry["sources"],
    }
    return {
        "version": "corpus-workbench-1",
        "canonical_sha256": digest(canonical),
        "canonical": canonical,
        "operations": {"state": {"status": "retained_registry_only"}, "stages": []},
        "integrity": "inspection_only_not_a_preparation_or_publication_receipt",
    }


def inspect_run(run: Path, *, policy_context: PolicyContext = BUILTIN_CONTEXT) -> dict[str, Any]:
    registry_path = run / "registry"
    registry = (
        read_registry(registry_path, policy_context=policy_context)
        if registry_path.exists()
        else None
    )
    canonical: dict[str, Any] = {
        "records": explain_registry(registry, compact=True) if registry else [],
        "sources": registry["sources"] if registry else {},
    }
    for name in ("coverage-audit", "coverage-conflicts", "source-audit", "changes"):
        path = run / (name + ".json")
        if path.is_file():
            canonical[name] = read_json(path)
    return {
        "version": "corpus-workbench-1",
        "canonical_sha256": digest(canonical),
        "canonical": canonical,
        "operations": {"state": inspect_run_state(run), "stages": read_diagnostics(run)},
        "integrity": "inspection_only_use_corpus_verify",
    }


def inspect_run_state(run: Path) -> dict[str, Any]:
    """Reconcile advisory state with completion presence; verification is separate."""
    state = read_json(run / "state.json")
    present = (run / "ready.json").is_file()
    recorded = state.get("status")
    if recorded == "ready" and not present:
        state = {**state, "status": "incomplete", "recorded_status": recorded}
    elif recorded != "ready" and present:
        state = {**state, "status": "inconsistent", "recorded_status": recorded}
    return {**state, "candidate_receipt": "present_unverified" if present else "absent"}


def diff_runs(
    before: Path, after: Path, *, policy_context: PolicyContext = BUILTIN_CONTEXT
) -> dict[str, Any]:
    changes: dict[str, Any] = {}
    if (before / "registry").is_dir() and (after / "registry").is_dir():
        left, right = (
            read_registry(before / "registry", policy_context=policy_context),
            read_registry(after / "registry", policy_context=policy_context),
        )
        changes["registry"] = {
            table: asdict(compare_records(left[table], right[table])) for table in TABLES
        }
    if (before / "ready.json").exists() and (after / "ready.json").exists():
        left, right = read_json(before / "ready.json"), read_json(after / "ready.json")
        changes["public_files"] = asdict(compare_records(left["files"], right["files"]))
    if not changes:
        raise ValueError("No common completed registry or artifact inventories to compare")
    return {"version": "corpus-diff-1", **changes}


def write_workbench(
    run: Path, output: Path, *, policy_context: PolicyContext = BUILTIN_CONTEXT
) -> Path:
    if output.resolve().is_relative_to(run.resolve()):
        raise ValueError("Write derived workbench outside the immutable run")
    return write_inspection(inspect_run(run, policy_context=policy_context), run.name, output)


def write_inspection(view: dict[str, Any], title: str, output: Path) -> Path:
    data = json.dumps(view, ensure_ascii=False).replace("<", "\\u003c")
    document = (
        files("maimai_intelligence").joinpath("templates/corpus-workbench.html").read_text("utf-8")
    )
    atomic_write_text(
        output, document.replace("RUN_TITLE", html.escape(title)).replace("DATA_JSON", data)
    )
    return output
