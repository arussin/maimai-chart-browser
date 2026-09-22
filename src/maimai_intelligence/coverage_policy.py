"""Pure song evidence policies; no I/O, provider requests or registry admission."""

from dataclasses import dataclass

from .coverage_types import ReviewError
from .identity_policy import label
from .serialization import digest


@dataclass(frozen=True)
class ArtworkCandidate:
    provider: str
    source_id: str
    url: str
    assertion: str
    metadata: dict
    capture: dict

    def evidence(self, sid, canonical):
        return {
            "song_id": sid,
            "canonical_assertion": digest(canonical),
            "provider": self.provider,
            "source_id": self.source_id,
            "source_assertion": self.assertion,
            "source_metadata": self.metadata,
            "capture": self.capture,
            "image": self.url,
        }


def artwork_identity(metadata):
    values = tuple(label(metadata.get(k)) for k in ("title", "artist"))
    return values if all(values) else None


def choose_candidate(sid, metadata, canonical_counts, candidates, reviews=()):
    """Pure exact complete identity policy with explicit per-song exceptions."""
    reviews = [r for r in reviews if r.get("song_id") == sid]
    if reviews:
        if len(reviews) != 1:
            raise ReviewError("Duplicate artwork review")
        review = reviews[0]
        if (
            review.get("purpose") != "artwork"
            or review.get("canonical_assertion") != digest(metadata)
            or not review.get("evidence")
        ):
            raise ReviewError("Stale or invalid artwork review")
        matches = [
            c
            for c in candidates
            if c.provider == review.get("provider")
            and c.source_id == review.get("source_id")
            and c.assertion == review.get("source_assertion")
        ]
        if len(matches) != 1:
            raise ReviewError("Reviewed artwork source assertion changed or is unavailable")
        return matches[0]
    identity = artwork_identity(metadata)
    if identity is None or canonical_counts.get(identity) != 1:
        return None
    matches = [c for c in candidates if artwork_identity(c.metadata) == identity]
    urls = {c.url for c in matches}
    return matches[0] if len(urls) == 1 else None
