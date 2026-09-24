"""Verify retained replay evidence without granting reuse or publication authority."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

from .artwork_store import verify_asset
from .catalog_capture import ALLOWED, CaptureStore
from .coverage_store import RECEIPTS, verify_checkpoint
from .coverage_types import IntegrityError
from .metadata_policy import BUILTIN_CONTEXT, PolicyContext
from .snapshots import read_json


def _verify_files(run: Path, expected: dict[str, Any]) -> None:
    if set(expected) not in (set(RECEIPTS), {*RECEIPTS, "coverage-checkpoint.json"}):
        raise IntegrityError("Incomplete or unexpected replay evidence inventory")
    for name, ref in expected.items():
        raw = (run / name).read_bytes()
        if len(raw) != ref["bytes"] or hashlib.sha256(raw).hexdigest() != ref["sha256"]:
            raise IntegrityError("Replay evidence changed")


def verify_replay_evidence(run: Path, *, policy_context: PolicyContext = BUILTIN_CONTEXT) -> Path:
    """Check all bound captures/assets, even those current code would not request."""
    if (run / "attempt.json").is_file():
        policy_context.require_manifest(
            read_json(run / "attempt.json")["body"].get("source_registrations", [])
        )
    if (run / "ready.json").is_file():
        policy_context.require_manifest(
            read_json(run / "ready.json").get("source_registrations", [])
        )
    receipt = run / "source-captures.json"
    if not receipt.is_file():
        raise IntegrityError("This attempt has no complete source capture receipt to replay")
    root = run.parent.parent / "cache"
    checkpoint = run / "coverage-checkpoint.json"
    expected = None
    if checkpoint.exists():
        reference = read_json(checkpoint)
        _, manifest = verify_checkpoint(
            root / "coverage", reference["checkpoint"], policy_context=policy_context
        )
        if reference.get("policy") != manifest["policy"]:
            raise IntegrityError("Replay checkpoint policy binding changed")
        expected = {name: ref for name, ref in manifest["files"].items() if name in RECEIPTS}
        _verify_files(run, expected)
    if (run / "ready.json").exists():
        _verify_files(run, read_json(run / "ready.json").get("coverage_files", {}))
    elif expected is None:
        raise IntegrityError("Replay requires a completed candidate or coverage checkpoint")
    capture_record = read_json(receipt)
    if capture_record.get("version") != "catalog-source-captures-1":
        raise IntegrityError("Unsupported replay capture receipt")
    captures = CaptureStore(root / "waterfall/sources", offline=True, replay=receipt)
    for url, record in capture_record["captures"].items():
        if not ALLOWED.fullmatch(url) or record.get("url") != url:
            raise IntegrityError("Replay capture URL binding changed")
        captures.verify_record(record)
    for relative, asset in read_json(run / "coverage-audit.json")["assets"].items():
        verify_asset(root / "coverage", relative, asset)
    return receipt
