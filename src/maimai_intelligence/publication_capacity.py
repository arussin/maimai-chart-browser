"""Owner-reviewed hosting capacity; never discovers accounts or changes a plan.

A hash supplied explicitly by the owner binds the review and its read-only evidence.
This validates that review, not Cloudflare authentication. Acquisition of current
entitlement, pricing and supported upload evidence is an external release gate.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import UTC, datetime
from pathlib import Path

from .capacity_policy import MAX_REVIEW_AGE as MAX_REVIEW_AGE
from .capacity_policy import PAID_FILES as PAID_FILES
from .capacity_policy import CapacityAuthority


def _closed_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("Duplicate capacity review key")
        value[key] = item
    return value


def _digest(value):
    return isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value) is not None


class ReviewedCapacity(CapacityAuthority):
    """File-verified authority with the existing current-clock convenience API."""

    def require_current(self, now: datetime | None = None) -> None:
        super().require_current(now or datetime.now(UTC))


def read_capacity_review(path, reviewed_sha256, *, now=None) -> ReviewedCapacity:
    """Read a closed review and its three bound evidence files; no account I/O."""
    if not _digest(reviewed_sha256):
        raise ValueError("An explicitly reviewed capacity SHA256 is required")
    path = Path(path).resolve()
    with path.open("rb") as stream:
        raw = stream.read(64 * 1024 + 1)
    if len(raw) > 64 * 1024 or hashlib.sha256(raw).hexdigest() != reviewed_sha256:
        raise ValueError("Capacity review hash or size mismatch")
    value = json.loads(raw, object_pairs_hook=_closed_object)
    expected = {
        "schema_version",
        "profile",
        "account_id",
        "project",
        "plan",
        "verified_at",
        "billing",
        "upload_method",
        "evidence",
    }
    if (
        not isinstance(value, dict)
        or set(value) != expected
        or value["schema_version"] != "pages-capacity-review-1"
        or value["profile"] != "pages-paid-100000"
        or value["upload_method"] != "wrangler-direct-upload-v4"
    ):
        raise ValueError("Invalid paid capacity review")
    billing = value["billing"]
    if not isinstance(billing, dict) or set(billing) != {"amount", "currency", "interval"}:
        raise ValueError("Paid capacity requires an explicit reviewed price")
    evidence = value["evidence"]
    if not isinstance(evidence, dict) or set(evidence) != {"entitlement", "cost", "upload_method"}:
        raise ValueError("Capacity review lacks entitlement, cost or upload evidence")
    verified = []
    for purpose, record in sorted(evidence.items()):
        if (
            not isinstance(record, dict)
            or set(record) != {"path", "sha256"}
            or not isinstance(record["path"], str)
            or not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,100}\.json", record["path"])
            or not _digest(record["sha256"])
        ):
            raise ValueError("Invalid capacity evidence reference")
        source = (path.parent / record["path"]).resolve()
        if source.parent != path.parent:
            raise ValueError("Capacity evidence must stay beside the review")
        with source.open("rb") as stream:
            data = stream.read(1024 * 1024 + 1)
        if (
            not data
            or len(data) > 1024 * 1024
            or hashlib.sha256(data).hexdigest() != record["sha256"]
        ):
            raise ValueError("Capacity evidence integrity mismatch")
        verified.append((purpose, record["sha256"]))
    review = ReviewedCapacity(
        value["account_id"],
        value["project"],
        value["plan"],
        value["verified_at"],
        (billing["amount"], billing["currency"], billing["interval"]),
        reviewed_sha256,
        tuple(verified),
    )
    review.require_current(now)
    return review


def stage_capacity_review(
    source: Path | str, reviewed_sha256: str | None, destination: Path | str
) -> ReviewedCapacity:
    """Retain only the reviewed capacity evidence in a private candidate directory."""
    source, destination = Path(source).resolve(), Path(destination)
    reviewed = read_capacity_review(source, reviewed_sha256)
    raw = source.read_bytes()
    value = json.loads(raw, object_pairs_hook=_closed_object)
    destination.mkdir()
    for record in value["evidence"].values():
        (destination / record["path"]).write_bytes((source.parent / record["path"]).read_bytes())
    (destination / "review.json").write_bytes(raw)
    if read_capacity_review(destination / "review.json", reviewed_sha256) != reviewed:
        raise ValueError("Capacity review changed while staging")
    return reviewed
