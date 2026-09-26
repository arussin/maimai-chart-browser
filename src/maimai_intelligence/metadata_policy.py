"""Pure supplemental metadata limits and source priority; no acquisition."""

import math
import re
from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any

from .corpus_failures import CorpusInputError

FIELDS = ("bpm", "chart_constant")


def number(value: Any, field: str) -> float | None:
    if isinstance(value, bool) or value in (None, ""):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    ceiling = 15 if field == "chart_constant" else 2000
    return result if math.isfinite(result) and 0 < result <= ceiling else None


@dataclass(frozen=True)
class MetadataSourcePolicy:
    label: str
    priority: int

    def __post_init__(self) -> None:
        if (
            not isinstance(self.label, str)
            or not self.label
            or len(self.label) > 100
            or type(self.priority) is not int
            or not 0 <= self.priority <= 1000
        ):
            raise CorpusInputError("Metadata policy requires a bounded label and priority")


SOURCE_POLICIES = MappingProxyType(
    {
        "reviewed-page": MetadataSourcePolicy("Reviewed public page", 10),
        "gamerch-wiki": MetadataSourcePolicy("maimai Wiki (Gamerch)", 15),
        "arcade-songs": MetadataSourcePolicy("Arcade Songs", 20),
        "otoge-db": MetadataSourcePolicy("OTOGE DB", 30),
        "mai-notes": MetadataSourcePolicy("mai-notes", 40),
    }
)
# Historical Python callers can read the same maintained policy priorities.
PRIORITY = MappingProxyType({name: policy.priority for name, policy in SOURCE_POLICIES.items()})


@dataclass(frozen=True)
class SourcePolicyBinding:
    provider: str
    url: str
    parser_revision: str
    policy: MetadataSourcePolicy
    allowed_claims: tuple[str, ...] = FIELDS

    def __post_init__(self) -> None:
        if (
            not isinstance(self.provider, str)
            or not re.fullmatch(r"[a-z][a-z0-9-]{0,63}", self.provider)
            or self.provider in {"sega-jp", "sega-intl", "sega-notice"}
            or not isinstance(self.url, str)
            or len(self.url) > 2048
            or not re.fullmatch(r"https://[^/@?#\s]+(?:/[^?#\s]*)?", self.url)
            or not isinstance(self.parser_revision, str)
            or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", self.parser_revision)
            or not isinstance(self.policy, MetadataSourcePolicy)
            or self.allowed_claims != FIELDS
        ):
            raise CorpusInputError("Invalid supplemental policy binding")

    def record(self) -> dict[str, object]:
        return {
            "provider": self.provider,
            "url": self.url,
            "parser_revision": self.parser_revision,
            "policy": {"label": self.policy.label, "priority": self.policy.priority},
            "allowed_claims": list(self.allowed_claims),
        }


@dataclass(frozen=True)
class PolicyContext:
    supplemental: tuple[SourcePolicyBinding, ...] = ()

    def __post_init__(self) -> None:
        if not isinstance(self.supplemental, tuple) or any(
            not isinstance(entry, SourcePolicyBinding) for entry in self.supplemental
        ):
            raise CorpusInputError("Policy bindings must be immutable")
        names = [entry.provider for entry in self.supplemental]
        if len(names) != len(set(names)) or set(names) & SOURCE_POLICIES.keys():
            raise CorpusInputError("Duplicate or overridden source policy")

    @property
    def policies(self) -> Mapping[str, MetadataSourcePolicy]:
        return MappingProxyType(
            {**SOURCE_POLICIES, **{entry.provider: entry.policy for entry in self.supplemental}}
        )

    def binding(self, provider: str) -> SourcePolicyBinding | None:
        return next((entry for entry in self.supplemental if entry.provider == provider), None)

    def manifest(self) -> list[dict[str, object]]:
        return [
            entry.record() for entry in sorted(self.supplemental, key=lambda entry: entry.provider)
        ]

    def require_manifest(self, manifest: object) -> None:
        if manifest != self.manifest():
            raise CorpusInputError(
                "Source registration or policy context differs; "
                "reuse requires the original context. "
                "For a revised supplemental policy, prepare a fresh attempt from retained original "
                "inputs and the new context, preserving the earlier receipts."
            )


BUILTIN_CONTEXT = PolicyContext()
