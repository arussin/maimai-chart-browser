"""Owner-reviewed hosting capacity; never discovers accounts or changes a plan.

A hash supplied explicitly by the owner binds the review and its read-only evidence.
This validates that review, not Cloudflare authentication. Acquisition of current
entitlement, pricing and supported upload evidence is an external release gate.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

PAID_FILES = 100_000
MAX_REVIEW_AGE = timedelta(hours=24)


def _closed_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("Duplicate capacity review key")
        value[key] = item
    return value


def _digest(value):
    return isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value) is not None


@dataclass(frozen=True)
class ReviewedCapacity:
    account_id: str
    project: str
    plan: str
    verified_at: str
    billing: tuple[float, str, str]
    review_sha256: str
    evidence: tuple[tuple[str, str], ...]

    def require_current(self, now=None):
        now = now or datetime.now(UTC)
        checked = datetime.fromisoformat(self.verified_at)
        if checked.tzinfo is None or not timedelta(0) <= now - checked <= MAX_REVIEW_AGE:
            raise ValueError("Paid capacity review is stale or has a future verification time")

    def receipt(self) -> dict[str, Any]:
        return {
            "profile": "pages-paid-100000",
            "max_files": PAID_FILES,
            "account_id": self.account_id,
            "project": self.project,
            "plan": self.plan,
            "verified_at": self.verified_at,
            "billing": {
                "amount": self.billing[0],
                "currency": self.billing[1],
                "interval": self.billing[2],
            },
            "upload_method": "wrangler-direct-upload-v4",
            "review_sha256": self.review_sha256,
            "evidence": dict(self.evidence),
        }


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
        or not isinstance(value["account_id"], str)
        or not re.fullmatch(r"[a-f0-9]{32}", value["account_id"])
        or not isinstance(value["project"], str)
        or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,57}", value["project"])
        or not isinstance(value["plan"], str)
        or value["plan"] not in {"pro", "business", "enterprise"}
        or value["upload_method"] != "wrangler-direct-upload-v4"
        or not isinstance(value["verified_at"], str)
    ):
        raise ValueError("Invalid paid capacity review")
    billing = value["billing"]
    if (
        not isinstance(billing, dict)
        or set(billing) != {"amount", "currency", "interval"}
        or type(billing["amount"]) not in {int, float}
        or not math.isfinite(billing["amount"])
        or billing["amount"] < 0
        or not isinstance(billing["currency"], str)
        or not re.fullmatch(r"[A-Z]{3}", billing["currency"])
        or not isinstance(billing["interval"], str)
        or billing["interval"] not in {"month", "year"}
    ):
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
