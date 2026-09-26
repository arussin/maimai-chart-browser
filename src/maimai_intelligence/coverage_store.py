"""Immutable private coverage checkpoints, independent of publication readiness."""

from __future__ import annotations

import hashlib
import json
import os
import re
from copy import deepcopy
from pathlib import Path
from typing import Any

from .artwork_store import verify_asset
from .coverage_runtime import producer_identity
from .metadata_policy import BUILTIN_CONTEXT, PolicyContext
from .registry import TABLES, validate
from .snapshots import MAX_BYTES, atomic_json, canonical, digest, read_json

VERSION = "coverage-checkpoint-1"
RECEIPTS = (
    "coverage-inputs.json",
    "coverage-start.json",
    "coverage-state.json",
    "coverage-audit.json",
    "source-captures.json",
)


def read_registry_document(path, *, policy_context: PolicyContext = BUILTIN_CONTEXT):
    # Registry storage already bounds each table separately. A private checkpoint
    # contains all those tables, unlike ordinary 32 MiB provider documents.
    limit = MAX_BYTES * len(TABLES) + 65536
    with Path(path).open("rb") as stream:
        raw = stream.read(limit + 1)
    if len(raw) > limit:
        raise ValueError("Aggregate registry checkpoint exceeds table bounds")
    value = json.loads(
        raw, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Nonfinite registry JSON"))
    )
    validate(value, policy_context=policy_context)
    if any(len(canonical(value[table])) + 1 > MAX_BYTES for table in TABLES):
        raise ValueError("Registry checkpoint table exceeds its byte budget")
    return value


def policy_identity(
    config: dict[str, Any],
    reviews: dict[str, Any],
    *,
    policy_context: PolicyContext = BUILTIN_CONTEXT,
) -> str:
    return digest(
        {
            "config": config,
            "reviews": reviews,
            "producer": producer_identity()["policy_sha256"],
            **(
                {"source_registrations": policy_context.manifest()}
                if policy_context.supplemental
                else {}
            ),
        }
    )


def _read_checkpoint(
    root: Path | str, identifier: str, *, policy_context: PolicyContext = BUILTIN_CONTEXT
) -> tuple[Path, dict[str, Any]]:
    if not re.fullmatch(r"[a-f0-9]{64}", identifier):
        raise ValueError("Invalid coverage checkpoint identity")
    path = Path(root) / "checkpoints" / identifier
    manifest = read_json(path / "complete.json")
    if manifest.get("version") != VERSION or digest(manifest) != identifier:
        raise ValueError("Coverage checkpoint manifest integrity mismatch")
    _validate_staged(root, path, manifest, policy_context=policy_context)
    return path, manifest


def _validate_staged(root, path, manifest, *, policy_context: PolicyContext = BUILTIN_CONTEXT):
    policy_context.require_manifest(manifest.get("source_registrations", []))
    for name, entry in manifest["files"].items():
        if name not in {*RECEIPTS, "base.json", "result.json"}:
            raise ValueError("Unexpected coverage checkpoint file")
        raw = (path / name).read_bytes()
        if len(raw) != entry["bytes"] or hashlib.sha256(raw).hexdigest() != entry["sha256"]:
            raise ValueError("Coverage checkpoint file integrity mismatch")
    if set(manifest["files"]) != {*RECEIPTS, "base.json", "result.json"}:
        raise ValueError("Incomplete coverage checkpoint")
    for relative, asset in manifest["assets"].items():
        verify_asset(root, relative, asset)
    for name, field in (("base.json", "base_sha256"), ("result.json", "result_sha256")):
        if (
            digest(read_registry_document(path / name, policy_context=policy_context))
            != manifest[field]
        ):
            raise ValueError("Coverage checkpoint semantic registry identity mismatch")
    inputs = read_json(path / "coverage-inputs.json")
    if (
        digest(read_registry_document(path / "coverage-start.json", policy_context=policy_context))
        != inputs["starting_registry_sha256"]
    ):
        raise ValueError("Coverage checkpoint starting registry identity mismatch")


def _recover_completion(
    root, base, policy, current, *, policy_context: PolicyContext = BUILTIN_CONTEXT
):
    """An interrupted pointer write never erases a uniquely completed next batch."""
    expected = digest(base)
    while True:
        children = []
        for complete in (Path(root) / "checkpoints").glob("*/complete.json"):
            manifest = read_json(complete)
            if (
                manifest.get("predecessor") == current
                and manifest.get("policy") == policy
                and manifest.get("base_sha256") == expected
            ):
                children.append(complete.parent.name)
        if not children:
            return current
        if len(children) != 1:
            raise ValueError("Ambiguous completed coverage branches require review")
        current = children[0]
        _read_checkpoint(root, current, policy_context=policy_context)
        atomic_json(Path(root) / "checkpoint.json", {"checkpoint": current})


def restore_checkpoint(
    root: Path | str,
    base: dict[str, Any],
    policy: str,
    *,
    policy_context: PolicyContext = BUILTIN_CONTEXT,
) -> tuple[dict[str, Any], str | None]:
    """Resume matching work; on changed inputs only carry revalidated song artwork."""
    pointer = Path(root) / "checkpoint.json"
    identifier = read_json(pointer)["checkpoint"] if pointer.exists() else None
    identifier = _recover_completion(root, base, policy, identifier, policy_context=policy_context)
    if identifier is None:
        return deepcopy(base), None
    path, manifest = _read_checkpoint(root, identifier, policy_context=policy_context)
    previous = read_registry_document(path / "result.json", policy_context=policy_context)
    if manifest["base_sha256"] == digest(base) and manifest["policy"] == policy:
        return previous, identifier
    # Accepted identity or metadata changes invalidate unpublished mappings. Artwork
    # can survive only for exactly the same nonredirected canonical song assertion.
    result = deepcopy(base)
    for sid, song in result["songs"].items():
        old = previous["songs"].get(sid)
        if (
            old
            and not song.get("redirect")
            and not old.get("redirect")
            and old["metadata"] == song["metadata"]
        ):
            from .enrichment import select_artwork

            current = song.get("enrichment", {}).get("artwork", {}).get("selected", {})
            for scope, selection in (
                old.get("enrichment", {}).get("artwork", {}).get("selected", {}).items()
            ):
                if scope not in current:
                    select_artwork(song, scope, selection)
    return result, identifier


def checkpoint_work(
    root: Path | str, identifier: str, *, policy_context: PolicyContext = BUILTIN_CONTEXT
) -> dict[str, Any]:
    path, _ = _read_checkpoint(root, identifier, policy_context=policy_context)
    return read_json(path / "coverage-state.json")


def replay_checkpoint_start(
    root: Path | str,
    base: dict[str, Any],
    source_receipt: Path | str,
    *,
    policy_context: PolicyContext = BUILTIN_CONTEXT,
) -> dict[str, Any]:
    """Verify a resumed batch's exact starting state against its accepted base."""
    source_receipt = Path(source_receipt)
    receipt_path = source_receipt.parent / "coverage-checkpoint.json"
    if not receipt_path.exists():
        return base
    receipt = read_json(receipt_path)
    path, manifest = _read_checkpoint(root, receipt["checkpoint"], policy_context=policy_context)
    if manifest["base_sha256"] != digest(base) or receipt["policy"] != manifest["policy"]:
        raise ValueError("Coverage replay accepted base or policy differs")
    expected = manifest["files"]["source-captures.json"]
    if hashlib.sha256(source_receipt.read_bytes()).hexdigest() != expected["sha256"]:
        raise ValueError("Coverage replay capture receipt differs")
    return read_registry_document(path / "coverage-start.json", policy_context=policy_context)


def commit_checkpoint(
    root: Path | str,
    base: dict[str, Any],
    result: dict[str, Any],
    run: Path | str,
    policy: str,
    *,
    predecessor: str | None = None,
    policy_context: PolicyContext = BUILTIN_CONTEXT,
) -> dict[str, Any]:
    """Completion is immutable and written before the atomic advisory pointer."""
    validate(result, policy_context=policy_context)
    root, run = Path(root), Path(run)
    payloads = {name: (run / name).read_bytes() for name in RECEIPTS}
    payloads.update({"base.json": canonical(base), "result.json": canonical(result)})
    assets = {}
    for song in result["songs"].values():
        for selected in song.get("enrichment", {}).get("artwork", {}).get("selected", {}).values():
            verify_asset(root, selected["path"], selected["asset"])
            assets[selected["path"]] = selected["asset"]
    manifest = {
        "version": VERSION,
        **(
            {"source_registrations": policy_context.manifest()}
            if policy_context.supplemental
            else {}
        ),
        "policy": policy,
        "base_sha256": digest(base),
        "result_sha256": digest(result),
        "predecessor": predecessor,
        "files": {
            name: {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
            for name, raw in sorted(payloads.items())
        },
        "assets": assets,
    }
    identifier = digest(manifest)
    destination = root / "checkpoints" / identifier
    destination.mkdir(parents=True, exist_ok=True)
    for name, raw in payloads.items():
        path = destination / name
        if path.exists():
            if path.read_bytes() != raw:
                raise ValueError("Immutable coverage checkpoint differs")
        else:
            with path.open("xb") as stream:
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
    _validate_staged(root, destination, manifest, policy_context=policy_context)
    complete = destination / "complete.json"
    if complete.exists():
        if read_json(complete) != manifest:
            raise ValueError("Immutable coverage checkpoint manifest differs")
    else:
        atomic_json(complete, manifest)
    _read_checkpoint(root, identifier, policy_context=policy_context)
    # The caller holds its update-store writer lock. A stale caller cannot replace
    # another batch's completed progress. Crashes leave the old pointer intact.
    pointer = root / "checkpoint.json"
    current = read_json(pointer)["checkpoint"] if pointer.exists() else None
    if current not in {predecessor, identifier}:
        raise ValueError("Coverage checkpoint predecessor changed")
    atomic_json(pointer, {"checkpoint": identifier})
    return {"checkpoint": identifier, "policy": policy}


def prepare_checkpoint_batch(
    value,
    published,
    store,
    output,
    *,
    roots=(),
    reviews=None,
    fetcher=None,
    now=None,
    policy_context: PolicyContext = BUILTIN_CONTEXT,
):
    """One bounded assessment transaction; caller holds the store writer lock."""
    from .catalog_capture import CaptureStore
    from .coverage import CONFIG, prepare_coverage
    from .registry import write_registry

    reviews = reviews or {}
    store, output = Path(store), Path(output)
    root = store / "cache" / "coverage"
    policy = policy_identity(CONFIG, reviews, policy_context=policy_context)
    starting, parent = restore_checkpoint(root, value, policy, policy_context=policy_context)
    work = checkpoint_work(root, parent, policy_context=policy_context) if parent else None
    capture = CaptureStore(store / "cache" / "sources", **({"fetcher": fetcher} if fetcher else {}))
    result, audit = prepare_coverage(
        starting,
        published,
        capture,
        root,
        output,
        roots=roots,
        work=work,
        now=now,
        title_reviews=reviews.get("titles", ()),
        provider_reviews=reviews.get("providers", ()),
        artwork_reviews=reviews.get("artwork", ()),
        policy_context=policy_context,
    )
    atomic_json(output / "source-captures.json", capture.receipt())
    write_registry(result, output / "registry", policy_context=policy_context)
    receipt = commit_checkpoint(
        root, value, result, output, policy, predecessor=parent, policy_context=policy_context
    )
    atomic_json(output / "coverage-checkpoint.json", receipt)
    return result, audit, receipt


def verify_checkpoint(
    root: Path | str, identifier: str, *, policy_context: PolicyContext = BUILTIN_CONTEXT
) -> tuple[Path, dict[str, Any]]:
    """Read-only public verification of a completed private checkpoint."""
    return _read_checkpoint(root, identifier, policy_context=policy_context)
