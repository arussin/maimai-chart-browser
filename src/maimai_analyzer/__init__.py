"""Hermetic, player-independent chart analysis with synthetic experimental detectors."""

from .contracts import ChartInputError, canonical_bytes, normalize_chart, validate_profile
from .core import analysis_fingerprint, analyze
from .fixtures import synthetic_charts, synthetic_profiles
from .patterns import pattern_registry

__all__ = [
    "ChartInputError",
    "analyze",
    "analysis_fingerprint",
    "canonical_bytes",
    "normalize_chart",
    "pattern_registry",
    "synthetic_charts",
    "synthetic_profiles",
    "validate_profile",
]
