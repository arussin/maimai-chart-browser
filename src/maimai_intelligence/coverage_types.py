"""Finite outcomes shared by pure coverage policies and acquisition adapters."""

from dataclasses import asdict, dataclass
from enum import StrEnum


class FailureKind(StrEnum):
    TRANSPORT = "transport"
    TLS = "tls_verification"
    RATE_LIMIT = "rate_limited"
    ABSENT = "not_found"
    SCHEMA = "schema_invalid"
    INTEGRITY = "integrity"
    AMBIGUOUS = "ambiguous"
    UNSUPPORTED = "unsupported"
    DEFERRED = "deferred"
    SOURCE_COOLDOWN = "source_cooldown"


@dataclass(frozen=True)
class Failure:
    kind: FailureKind
    message: str
    status: int | None = None
    retry_after: str | None = None
    verify_code: int | None = None
    verify_message: str | None = None

    def record(self):
        return asdict(self)


class CaptureError(ValueError):
    def __init__(self, failure: Failure) -> None:
        self.failure = failure
        super().__init__(failure.message)


class ReviewError(ValueError):
    """Invalid identity policy is a blocker, never a recoverable source failure."""


class SnapshotError(ValueError):
    """Rejected source structure cannot contribute new identity claims."""


@dataclass(frozen=True)
class ReconciliationDecision:
    registry: dict
    report: dict
    blockers: tuple[str, ...] = ()

    def require_valid(self):
        if self.blockers:
            raise ReviewError("; ".join(self.blockers))
        return self.registry, self.report


class IntegrityError(ValueError):
    """Corrupt retained evidence blocks the candidate; it is not a source outage."""
