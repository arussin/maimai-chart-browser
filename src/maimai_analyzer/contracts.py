"""Stable chart/profile API; input normalization is independent of detector metadata."""

from .chart_input import ANALYZER_VERSION as ANALYZER_VERSION
from .chart_input import CAPABILITIES as CAPABILITIES
from .chart_input import EXACT_RATIONAL_SCHEMA_VERSION as EXACT_RATIONAL_SCHEMA_VERSION
from .chart_input import MAX_DURATION_US as MAX_DURATION_US
from .chart_input import MAX_EVENTS as MAX_EVENTS
from .chart_input import MAX_INPUT_BYTES as MAX_INPUT_BYTES
from .chart_input import MAX_RATIONAL_INTEGER as MAX_RATIONAL_INTEGER
from .chart_input import SCHEMA_VERSION as SCHEMA_VERSION
from .chart_input import SUPPORTED_SCHEMA_VERSIONS as SUPPORTED_SCHEMA_VERSIONS
from .chart_input import ChartInputError as ChartInputError
from .chart_input import RationalEncodingError as RationalEncodingError
from .chart_input import RationalPair as RationalPair
from .chart_input import _beat as _beat
from .chart_input import _integer as _integer
from .chart_input import _keys as _keys
from .chart_input import _normalize_chart as _normalize_chart
from .chart_input import _text as _text
from .chart_input import canonical_bytes as canonical_bytes
from .chart_input import content_hash as content_hash
from .chart_input import decode_rational as decode_rational
from .chart_input import encode_rational as encode_rational
from .chart_input import normalize_chart as normalize_chart


def validate_profile(profile: dict, expected_identity: dict | None = None) -> None:
    """Versioned production profile boundary for local artifacts and exact-key cache hits.

    Numeric observations may be null for unknown; unknown is never coerced to zero.
    This is a structural validator, not an assertion of source accuracy or review.
    """
    required = {
        "schema_version",
        "analyzer_version",
        "registry_version",
        "registry_hash",
        "source_hash",
        "normalized_hash",
        "config_hash",
        "cache_key",
        "profile_id",
        "reference_scale_id",
        "chart_id",
        "song_id",
        "format",
        "difficulty",
        "revision",
        "source",
        "coverage",
        "metrics",
        "time_basis",
        "diagnostics",
        "occurrences",
        "tags",
        "flow",
        "sections",
        "descriptor",
        "limitations",
    }
    try:
        _keys(profile, required, required, "profile")
        if (
            not isinstance(profile["schema_version"], str)
            or profile["schema_version"] not in SUPPORTED_SCHEMA_VERSIONS
        ):
            raise ChartInputError("Unsupported profile schema")
        if profile["analyzer_version"] not in {ANALYZER_VERSION, "0.2.0-experimental"}:
            raise ChartInputError("Unsupported analyzer artifact version")
        if profile["format"] not in {"STD", "DX"}:
            raise ChartInputError("Invalid profile format identity")
        if len(canonical_bytes(profile)) > MAX_INPUT_BYTES * 4:
            raise ChartInputError("Profile exceeds artifact size limit")
        if expected_identity and any(
            profile.get(key) != value for key, value in expected_identity.items()
        ):
            raise ChartInputError("Cached profile identity or policy differs from requested input")
        for key in ("registry_hash", "source_hash", "normalized_hash", "config_hash", "cache_key"):
            digest = profile[key]
            if (
                not isinstance(digest, str)
                or len(digest) != 64
                or any(c not in "0123456789abcdef" for c in digest)
            ):
                raise ChartInputError("Profile content hash is invalid")
        if profile["coverage"]["analysis"] not in {"complete", "partial", "unavailable"}:
            raise ChartInputError("Invalid profile coverage")
        for value in profile["metrics"].values():
            if value is not None and (type(value) not in {int, float} or value < 0):
                raise ChartInputError("Metrics must be nonnegative numbers or explicit unknown")
        flow = profile["flow"]
        start, end = flow["span_start_us"], flow["span_end_us"]
        _integer(start, "profile span start")
        _integer(end, "profile span end")
        if end < start or len(flow["frames"]) > MAX_DURATION_US // 250_000 + 1:
            raise ChartInputError("Invalid profile duration or frame count")
        if len(flow["segments"]) != (24 if end - start >= 24 else 0):
            raise ChartInputError(
                "Profile must retain 24 segments or an explicitly unavailable tiny span"
            )
        previous_end = start
        for segment in flow["segments"]:
            if (
                segment["start_us"] != previous_end
                or not segment["start_us"] < segment["end_us"] <= end
            ):
                raise ChartInputError(
                    "Flow segments must be contiguous positive half-open intervals"
                )
            previous_end = segment["end_us"]
            for metric in ("density", "estimated_demand"):
                channel = segment[metric]
                if not 0 <= channel["coverage"] <= 1:
                    raise ChartInputError("Invalid metric coverage")
                for key in ("mean", "peak"):
                    value = channel[key]
                    if value is not None and (type(value) not in {int, float} or value < 0):
                        raise ChartInputError("Invalid Flow metric value")
                if channel["mean"] is None and channel["peak"] is not None:
                    raise ChartInputError("Unknown Flow mean cannot claim a known peak")
        if flow["segments"] and previous_end != end:
            raise ChartInputError("Flow segments must cover their stated span")
        # Input contracts are a leaf; profile validation consumes detector metadata.
        # Keep the earlier registry readable without arbitrary tag identities.
        from .pattern_community import DEFINITIONS as community_definitions
        from .patterns import REGISTRY_VERSION, pattern_registry

        expected_patterns = {p["pattern_id"] for p in pattern_registry()["entries"]}
        if profile["registry_version"] == "0.2.0-synthetic-experimental":
            expected_patterns -= community_definitions.keys()
        elif profile["registry_version"] != REGISTRY_VERSION:
            raise ChartInputError("Unsupported pattern registry version")
        if not isinstance(profile["tags"], list) or len(profile["tags"]) != len(expected_patterns):
            raise ChartInputError("Profile must retain each registry truth state")
        pattern_ids = set()
        for tag in profile["tags"]:
            if tag["pattern_id"] in pattern_ids:
                raise ChartInputError("Duplicate chart tag")
            pattern_ids.add(tag["pattern_id"])
            if tag["status"] not in {
                "detected",
                "reviewed-present",
                "not-detected-with-supported-coverage",
                "unknown",
            }:
                raise ChartInputError("Invalid chart tag truth state")
            if tag["status"] == "unknown" and tag["occurrence_count"] is not None:
                raise ChartInputError("Unknown tag cannot claim zero occurrences")
        if pattern_ids != expected_patterns:
            raise ChartInputError("Profile pattern identities differ from its registry")
        occurrence_ids = set()
        for occurrence in profile["occurrences"]:
            if (
                occurrence["chart_id"] != profile["chart_id"]
                or occurrence["profile_id"] != profile["profile_id"]
                or occurrence["pattern_id"] not in pattern_ids
            ):
                raise ChartInputError("Occurrence identity differs from its exact chart")
            if occurrence["occurrence_id"] in occurrence_ids:
                raise ChartInputError("Duplicate occurrence identity")
            occurrence_ids.add(occurrence["occurrence_id"])
            if not start <= occurrence["start_us"] <= occurrence["end_us"] <= end:
                raise ChartInputError("Occurrence lies outside profile span")
            for key in ("start_beat", "end_beat"):
                if key in occurrence:
                    value = occurrence[key]
                    if _beat(value, schema_version=profile["schema_version"]) != value:
                        raise ChartInputError("Profile occurrence beats must be canonical pairs")
    except ChartInputError:
        raise
    except (KeyError, TypeError, ValueError, RecursionError, OverflowError) as error:
        raise ChartInputError("Malformed versioned profile") from error
