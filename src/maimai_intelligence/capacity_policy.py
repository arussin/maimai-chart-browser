"""Immutable hosting authority and explicit-time policy, without account or clock I/O.

This records an externally reviewed approval, not proof of an account entitlement.
The publication adapter verifies its owner-supplied digest and evidence files.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

DEFAULT_FILES = 20_000
PAID_FILES = 100_000
MAX_REVIEW_AGE = timedelta(hours=24)


def _digest(value: object) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value) is not None


@dataclass(frozen=True)
class CapacityAuthority:
    account_id: str
    project: str
    plan: str
    verified_at: str
    billing: tuple[float, str, str]
    review_sha256: str
    evidence: tuple[tuple[str, str], ...]

    def __post_init__(self) -> None:
        if (
            not isinstance(self.account_id, str)
            or re.fullmatch(r"[a-f0-9]{32}", self.account_id) is None
            or not isinstance(self.project, str)
            or re.fullmatch(r"[a-z0-9][a-z0-9-]{0,57}", self.project) is None
            or self.plan not in ("pro", "business", "enterprise")
            or not isinstance(self.verified_at, str)
            or not _digest(self.review_sha256)
        ):
            raise ValueError("Invalid paid capacity review")
        if (
            not isinstance(self.billing, tuple)
            or len(self.billing) != 3
            or type(self.billing[0]) not in (int, float)
            or not math.isfinite(self.billing[0])
            or self.billing[0] < 0
            or not isinstance(self.billing[1], str)
            or re.fullmatch(r"[A-Z]{3}", self.billing[1]) is None
            or self.billing[2] not in ("month", "year")
        ):
            raise ValueError("Paid capacity requires an explicit reviewed price")
        if (
            not isinstance(self.evidence, tuple)
            or len(self.evidence) != 3
            or any(
                not isinstance(pair, tuple)
                or len(pair) != 2
                or pair[0] != purpose
                or not _digest(pair[1])
                for pair, purpose in zip(
                    self.evidence, ("cost", "entitlement", "upload_method"), strict=True
                )
            )
        ):
            raise ValueError("Invalid paid capacity evidence binding")

    def require_current(self, now: datetime) -> None:
        """Require an explicit aware instant; the adapter owns reading the clock."""
        if not isinstance(now, datetime) or now.tzinfo is None:
            raise ValueError("Paid capacity requires an explicit timezone-aware check time")
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
