"""Verified attempt inputs and predecessor links; coverage checkpoints remain authoritative."""

from __future__ import annotations

import hashlib
import re
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, TypedDict

from .corpus_policy import ReuseIdentity
from .serialization import digest
from .snapshots import atomic_json, read_json

PATH_OPTIONS = (
    "previous_browser",
    "previous_public",
    "package",
    "registry",
    "mai_notes_snapshot",
    "overrides",
    "capacity_review",
)
VALUE_OPTIONS = (
    "revision",
    "offline",
    "coverage_reviews",
    "reassess_captured_policy",
    "capacity_sha256",
    "player_maishift",
)


class InputBinding(TypedDict):
    path: str
    files: dict[str, dict[str, str | int]]


def input_inventory(path: Path) -> dict[str, dict[str, str | int]]:
    root = path.resolve()
    paths = sorted(root.rglob("*")) if root.is_dir() else [root]
    result: dict[str, dict[str, str | int]] = {}
    for item in paths:
        if item.is_symlink() or not item.resolve().is_relative_to(
            root if root.is_dir() else root.parent
        ):
            raise ValueError("Attempt inputs must not contain external aliases")
        if item.is_file():
            name = item.relative_to(root).as_posix() if root.is_dir() else item.name
            sha = hashlib.sha256()
            with item.open("rb") as stream:
                while raw := stream.read(1024 * 1024):
                    sha.update(raw)
            result[name] = {"bytes": item.stat().st_size, "sha256": sha.hexdigest()}
    if not result:
        raise ValueError("Attempt input is missing or empty")
    return result


def bind_attempt(
    run: Path,
    options: dict[str, Any],
    implementation: str,
    predecessor: dict[str, str] | None = None,
) -> dict[str, Any]:
    values = {name: options.get(name) for name in VALUE_OPTIONS}
    bindings: dict[str, InputBinding] = {}
    for name in PATH_OPTIONS:
        path = options.get(name)
        if path is not None:
            path = Path(path).resolve()
            bindings[name] = {"path": str(path), "files": input_inventory(path)}
    observations: dict[str, Any] = {}
    if predecessor is not None:
        name = predecessor.get("run", "")
        if not re.fullmatch(r"[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}", name):
            raise ValueError("Invalid predecessor attempt identity")
        verified = verify_attempt(
            run.parent / name,
            implementation,
            input_locations={key: row["path"] for key, row in bindings.items()},
        )
        if verified["sha256"] != predecessor.get("attempt_sha256"):
            raise ValueError("Predecessor attempt changed")
        previous = verified["body"]
        observations = previous.get("observations", {})
        if "mai_notes_snapshot" in bindings and "mai_notes_snapshot" not in observations:
            raise ValueError("Legacy attempt lacks bound capture metadata; prepare a new attempt")
        ReuseIdentity(
            digest({key: row["files"] for key, row in previous["bindings"].items()}),
            previous["implementation"],
            digest(previous["values"].get("coverage_reviews")),
        ).require_equal(
            ReuseIdentity(
                digest({key: row["files"] for key, row in bindings.items()}),
                implementation,
                digest(values.get("coverage_reviews")),
            )
        )
    elif "mai_notes_snapshot" in bindings:
        # Keep the historical public timestamp, but identify its weaker origin honestly.
        # A restored file's new mtime must never change a predecessor's canonical output.
        snapshot = Path(bindings["mai_notes_snapshot"]["path"])
        observations["mai_notes_snapshot"] = {
            "captured_at": datetime.fromtimestamp(snapshot.stat().st_mtime, UTC).isoformat(),
            "basis": "legacy_file_mtime",
        }
    body = {
        "version": "corpus-attempt-1",
        "observations": observations,
        "values": values,
        "bindings": bindings,
        "implementation": implementation,
        "predecessor": predecessor,
        "artwork_cache": str(Path(options["artwork_cache"]).resolve())
        if options.get("artwork_cache")
        else None,
    }
    record = {"body": body, "sha256": digest(body)}
    atomic_json(run / "attempt.json", record)
    return record


def _input_paths(
    body: dict[str, Any], input_locations: Mapping[str, Path | str] | None
) -> dict[str, Path]:
    replacements = input_locations or {}
    if set(replacements) - set(body["bindings"]):
        raise ValueError("Unknown or unbound attempt input location")
    return {
        name: Path(replacements.get(name, row["path"])).resolve()
        for name, row in body["bindings"].items()
    }


def verify_attempt(
    run: Path,
    implementation: str,
    *,
    input_locations: Mapping[str, Path | str] | None = None,
) -> dict[str, Any]:
    record = read_json(run / "attempt.json")
    body = record["body"]
    if body.get("version") != "corpus-attempt-1" or digest(body) != record.get("sha256"):
        raise ValueError("Attempt receipt integrity mismatch")
    previous = {name: row["files"] for name, row in body["bindings"].items()}
    current = {
        name: input_inventory(path) for name, path in _input_paths(body, input_locations).items()
    }
    reviews = digest(body["values"].get("coverage_reviews"))
    ReuseIdentity(digest(previous), body["implementation"], reviews).require_equal(
        ReuseIdentity(digest(current), implementation, reviews)
    )
    ready = run / "ready.json"
    if ready.exists() and read_json(ready).get("attempt_sha256") != record["sha256"]:
        raise ValueError("Completed candidate does not bind this attempt")
    return record


def resume_options(
    run: Path,
    implementation: str,
    *,
    replay: bool = False,
    online: bool = False,
    input_locations: Mapping[str, Path | str] | None = None,
) -> dict[str, Any]:
    if replay and online:
        raise ValueError("Replay is always offline")
    record = verify_attempt(run, implementation, input_locations=input_locations)
    body = record["body"]
    options = {
        **body["values"],
        **_input_paths(body, input_locations),
    }
    options["artwork_cache"] = body["artwork_cache"]
    options["offline"] = not online
    options["predecessor"] = {"run": run.name, "attempt_sha256": record["sha256"]}
    if replay:
        captures = run / "source-captures.json"
        if not captures.is_file():
            raise ValueError("This attempt has no complete source capture receipt to replay")
        # Bind every replay input to the candidate or its completed independent checkpoint.
        if (run / "ready.json").exists():
            expected = read_json(run / "ready.json")["coverage_files"]
            for name, ref in expected.items():
                if input_inventory(run / name)[name] != ref:
                    raise ValueError("Replay evidence changed")
        else:
            from .coverage_store import verify_checkpoint

            receipt = read_json(run / "coverage-checkpoint.json")
            _, manifest = verify_checkpoint(
                run.parent.parent / "cache/coverage", receipt["checkpoint"]
            )
            for name, ref in manifest["files"].items():
                if (
                    name not in {"base.json", "result.json"}
                    and input_inventory(run / name)[name] != ref
                ):
                    raise ValueError("Replay checkpoint evidence changed")
        options["replay_sources"] = captures
    return options
