"""Verified attempt inputs and predecessor links; coverage checkpoints remain authoritative."""

from __future__ import annotations

import hashlib
import re
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, TypedDict

from .corpus_failures import CorpusInputError
from .corpus_policy import ReuseIdentity, ReuseOperation, reuse_operation
from .metadata_policy import BUILTIN_CONTEXT, PolicyContext
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
    "export_artwork_source",
)
VALUE_OPTIONS = (
    "revision",
    "offline",
    "coverage_reviews",
    "reassess_captured_policy",
    "capacity_sha256",
    "player_maishift",
    "preserve_web_analytics",
    "release_date",
)


class InputBinding(TypedDict):
    path: str
    files: dict[str, dict[str, str | int]]


def bound_input_inventory(name: str, path: Path) -> dict[str, dict[str, str | int]]:
    if name == "export_artwork_source":
        from .export_artwork import (
            _assets,
            read_export_artwork_assets,
            read_export_artwork_manifest,
        )

        # Bind only the reviewed read closure, never provenance or unrelated files.
        if not path.is_dir():
            raise CorpusInputError(
                "Required export artwork is missing; "
                "supply a complete --export-artwork-source directory"
            )
        try:
            manifest = read_export_artwork_manifest()
            # Windows may report opening a directory as PermissionError instead of
            # IsADirectoryError. Reject this input shape before attempting to open it.
            if any((path / name).is_dir() for name in _assets(manifest)):
                raise CorpusInputError("Required export artwork must be files, not directories")
            # The post-render check refuses aliased files; refuse them here too, so an
            # unchanged input is never reported later as changed during preparation.
            if any(
                (path / name).is_symlink() or (path / name).parent.is_symlink()
                for name in _assets(manifest)
            ):
                raise CorpusInputError("Required export artwork must not be symbolic links")
            assets = read_export_artwork_assets(path, manifest=manifest)
        except (FileNotFoundError, IsADirectoryError, NotADirectoryError) as exc:
            raise CorpusInputError(
                "Required export artwork is missing; supply a complete --export-artwork-source"
            ) from exc
        except ValueError as exc:
            raise CorpusInputError(str(exc)) from exc
        return {
            name: {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
            for name, raw in assets.items()
        }
    return input_inventory(path)


def verify_recorded_artwork(path: Path, files: dict[str, Any]) -> dict[str, Any]:
    """Verify the retained read closure, independently of today's packaged index."""
    root = path.resolve()
    if not root.is_dir():
        raise CorpusInputError("Export artwork integrity mismatch: missing input directory")
    for name, expected in files.items():
        if re.fullmatch(r"media/[a-f0-9]{64}\.webp", name) is None:
            raise CorpusInputError("Export artwork integrity mismatch: invalid recorded path")
        target = root / name
        if (
            target.is_symlink()
            or target.parent.is_symlink()
            or not target.resolve().is_relative_to(root)
            or not target.is_file()
        ):
            raise CorpusInputError("Export artwork integrity mismatch: missing or aliased file")
        raw = target.read_bytes()
        if {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()} != expected:
            raise CorpusInputError("Export artwork integrity mismatch: recorded bytes changed")
    return files


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
    *,
    policy_context: PolicyContext = BUILTIN_CONTEXT,
) -> dict[str, Any]:
    values = {name: options.get(name) for name in VALUE_OPTIONS}
    values["preserve_web_analytics"] = options.get("preserve_web_analytics", False)
    bindings: dict[str, InputBinding] = {}
    for name in PATH_OPTIONS:
        path = options.get(name)
        if path is not None:
            path = Path(path).resolve()
            bindings[name] = {"path": str(path), "files": bound_input_inventory(name, path)}
    observations: dict[str, Any] = {}
    if predecessor is not None:
        name = predecessor.get("run", "")
        if not re.fullmatch(r"[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}", name):
            raise ValueError("Invalid predecessor attempt identity")
        operation = reuse_operation(predecessor.get("operation", "resume"))
        verified = verify_retained_inputs(
            run.parent / name,
            input_locations={key: row["path"] for key, row in bindings.items()},
            policy_context=policy_context,
        )
        if verified["sha256"] != predecessor.get("attempt_sha256"):
            raise ValueError("Predecessor attempt changed")
        previous = verified["body"]
        export_binding = bindings.get("export_artwork_source")
        if previous["bindings"].get("export_artwork_source", {}).get("files") != (
            export_binding["files"] if export_binding is not None else None
        ):
            raise CorpusInputError("Export artwork index changed; prepare a new candidate")
        if (
            previous["values"].get("preserve_web_analytics", False)
            != values["preserve_web_analytics"]
            or previous["values"].get("release_date") != values["release_date"]
        ):
            raise ValueError("Continuation public release policy differs")
        observations = previous.get("observations", {})
        if "mai_notes_snapshot" in bindings and "mai_notes_snapshot" not in observations:
            raise ValueError("Legacy attempt lacks bound capture metadata; prepare a new attempt")
        original = ReuseIdentity(
            digest({key: row["files"] for key, row in previous["bindings"].items()}),
            previous["implementation"],
            digest(previous["values"].get("coverage_reviews")),
        )
        current = ReuseIdentity(
            digest({key: row["files"] for key, row in bindings.items()}),
            implementation,
            digest(values.get("coverage_reviews")),
        )
        if operation == "reassess":
            original.require_evidence(current)
            if not values.get("offline"):
                raise ValueError("Reassessment is always offline")
        else:
            original.require_equal(current)
        captured_continuation = (
            operation == "replay"
            or (operation == "reassess" and "registry" in bindings)
            or previous["values"].get("reassess_captured_policy")
        )
        if captured_continuation:
            from .corpus_evidence import verify_replay_evidence

            receipt = verify_replay_evidence(run.parent / name, policy_context=policy_context)
            if (
                not values.get("offline")
                or bool(values.get("reassess_captured_policy")) != (operation == "reassess")
                or Path(options.get("replay_sources") or "").resolve() != receipt.resolve()
            ):
                raise ValueError("Captured continuation must use its verified predecessor offline")
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
        "source_registrations": policy_context.manifest(),
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


def verify_retained_inputs(
    run: Path,
    *,
    input_locations: Mapping[str, Path | str] | None = None,
    policy_context: PolicyContext = BUILTIN_CONTEXT,
) -> dict[str, Any]:
    record = read_json(run / "attempt.json")
    body = record["body"]
    policy_context.require_manifest(body.get("source_registrations", []))
    if body.get("version") != "corpus-attempt-1" or digest(body) != record.get("sha256"):
        raise ValueError("Attempt receipt integrity mismatch")
    previous = {name: row["files"] for name, row in body["bindings"].items()}
    current = {
        name: verify_recorded_artwork(path, previous[name])
        if name == "export_artwork_source"
        else bound_input_inventory(name, path)
        for name, path in _input_paths(body, input_locations).items()
    }
    reviews = digest(body["values"].get("coverage_reviews"))
    ReuseIdentity(digest(previous), body["implementation"], reviews).require_evidence(
        ReuseIdentity(digest(current), body["implementation"], reviews)
    )
    ready = run / "ready.json"
    if ready.exists() and read_json(ready).get("attempt_sha256") != record["sha256"]:
        raise ValueError("Completed candidate does not bind this attempt")
    return record


def verify_attempt(
    run: Path,
    implementation: str,
    *,
    input_locations: Mapping[str, Path | str] | None = None,
    policy_context: PolicyContext = BUILTIN_CONTEXT,
) -> dict[str, Any]:
    record = verify_retained_inputs(
        run, input_locations=input_locations, policy_context=policy_context
    )
    body = record["body"]
    inputs = digest({name: row["files"] for name, row in body["bindings"].items()})
    reviews = digest(body["values"].get("coverage_reviews"))
    ReuseIdentity(inputs, body["implementation"], reviews).require_equal(
        ReuseIdentity(inputs, implementation, reviews)
    )
    return record


def reassess_options(
    run: Path,
    *,
    input_locations: Mapping[str, Path | str] | None = None,
    policy_context: PolicyContext = BUILTIN_CONTEXT,
) -> dict[str, Any]:
    record = verify_retained_inputs(
        run, input_locations=input_locations, policy_context=policy_context
    )
    return _continuation_options(
        run, record, "reassess", False, input_locations, policy_context=policy_context
    )


def resume_options(
    run: Path,
    implementation: str,
    *,
    replay: bool = False,
    online: bool = False,
    input_locations: Mapping[str, Path | str] | None = None,
    policy_context: PolicyContext = BUILTIN_CONTEXT,
) -> dict[str, Any]:
    if replay and online:
        raise ValueError("Replay is always offline")
    record = verify_attempt(
        run, implementation, input_locations=input_locations, policy_context=policy_context
    )
    return _continuation_options(
        run,
        record,
        "replay" if replay else "resume",
        online,
        input_locations,
        policy_context=policy_context,
    )


def _continuation_options(
    run: Path,
    record: dict[str, Any],
    operation: ReuseOperation,
    online: bool,
    input_locations: Mapping[str, Path | str] | None,
    *,
    policy_context: PolicyContext = BUILTIN_CONTEXT,
) -> dict[str, Any]:
    body = record["body"]
    options = {**body["values"], **_input_paths(body, input_locations)}
    options["artwork_cache"] = body["artwork_cache"]
    options["offline"] = not online
    options["predecessor"] = {
        "run": run.name,
        "attempt_sha256": record["sha256"],
        "operation": operation,
    }
    captured_reassessment = bool(body["values"].get("reassess_captured_policy"))
    if captured_reassessment and online:
        raise ValueError(
            "Continue a captured reassessment offline; prepare separately for acquisition"
        )
    if (
        operation == "replay"
        or operation == "reassess"
        and "registry" in body["bindings"]
        or captured_reassessment
    ):
        from .corpus_evidence import verify_replay_evidence

        options["replay_sources"] = verify_replay_evidence(run, policy_context=policy_context)
    options["reassess_captured_policy"] = operation == "reassess" and "registry" in body["bindings"]
    return options
