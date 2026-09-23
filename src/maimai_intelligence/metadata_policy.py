"""Pure supplemental metadata limits and source priority; no acquisition."""

import math
from dataclasses import dataclass
from typing import Any

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
        if not self.label or len(self.label) > 100 or not 0 <= self.priority <= 1000:
            raise ValueError("Metadata policy requires a bounded label and priority")


SOURCE_POLICIES = {
    "reviewed-page": MetadataSourcePolicy("Reviewed public page", 10),
    "gamerch-wiki": MetadataSourcePolicy("maimai Wiki (Gamerch)", 15),
    "arcade-songs": MetadataSourcePolicy("Arcade Songs", 20),
    "otoge-db": MetadataSourcePolicy("OTOGE DB", 30),
    "mai-notes": MetadataSourcePolicy("mai-notes", 40),
}
# Historical Python callers can read the same maintained policy priorities.
PRIORITY = {name: policy.priority for name, policy in SOURCE_POLICIES.items()}
