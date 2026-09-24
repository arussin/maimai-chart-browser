"""Pure preparation and reuse rules. No clocks, storage, rendering or network."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal

from .corpus_failures import CorpusInputError


@dataclass(frozen=True)
class SourceSelection:
    package: bool
    revision: bool
    registry: bool
    offline: bool
    replay: bool
    artwork_cache: bool
    retained_links: bool

    def validate(self) -> None:
        if (self.package and self.revision) or not (self.package or self.revision or self.registry):
            raise CorpusInputError(
                "Choose an accepted package or an explicit reviewed source revision"
            )
        if self.replay and (not self.offline or not self.registry):
            raise CorpusInputError("Source replay requires --offline and a registry")
        if self.revision and not self.artwork_cache:
            raise CorpusInputError("Source updates require an artwork cache")
        if self.offline and not self.retained_links and not self.registry:
            raise CorpusInputError(
                "Offline preparation needs an explicit retained mai-notes snapshot"
            )


@dataclass(frozen=True)
class ReuseIdentity:
    inputs: str
    implementation: str
    reviews: str

    def require_equal(self, current: ReuseIdentity) -> None:
        if self.inputs != current.inputs:
            raise CorpusInputError(
                "Retained inputs changed; prepare a new base instead of reusing this attempt"
            )
        if self.implementation != current.implementation:
            raise CorpusInputError(
                "Preparation policy changed; explicitly prepare or reassess retained captures"
            )
        if self.reviews != current.reviews:
            raise CorpusInputError("Review assertions changed; prepare with freshly bound reviews")


@dataclass(frozen=True)
class Changes:
    added: tuple[str, ...]
    removed: tuple[str, ...]
    changed: tuple[str, ...]


def compare_records(before: Mapping[str, object], after: Mapping[str, object]) -> Changes:
    return Changes(
        tuple(sorted(after.keys() - before.keys())),
        tuple(sorted(before.keys() - after.keys())),
        tuple(sorted(key for key in before.keys() & after.keys() if before[key] != after[key])),
    )


Stage = Literal["inputs", "source_capture", "corpus", "render", "review", "receipt"]
Outcome = Literal["started", "complete", "blocked", "failed", "interrupted"]
