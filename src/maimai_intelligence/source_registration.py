"""Explicit supplemental adapters; receipts bind declarations, never load code."""

from __future__ import annotations

from dataclasses import dataclass

from .catalog_capture import ALLOWED
from .corpus_failures import CorpusInputError
from .metadata_adapters import MetadataAdapter
from .metadata_policy import MetadataSourcePolicy, PolicyContext, SourcePolicyBinding


@dataclass(frozen=True)
class SourceRegistration:
    adapter: MetadataAdapter
    policy: MetadataSourcePolicy
    parser_revision: str

    def __post_init__(self) -> None:
        if not isinstance(self.adapter, MetadataAdapter) or not callable(self.adapter.normalize):
            raise CorpusInputError("Invalid supplemental source registration")
        self.binding()
        if not ALLOWED.fullmatch(self.adapter.url):
            raise CorpusInputError(
                "Supplemental source URL is outside the existing capture boundary"
            )

    def binding(self) -> SourcePolicyBinding:
        return SourcePolicyBinding(
            self.adapter.provider, self.adapter.url, self.parser_revision, self.policy
        )


def source_context(sources: tuple[SourceRegistration, ...] = ()) -> PolicyContext:
    if not isinstance(sources, tuple) or any(
        not isinstance(source, SourceRegistration) for source in sources
    ):
        raise CorpusInputError("Source registrations must be an immutable tuple")
    return PolicyContext(tuple(source.binding() for source in sources))
