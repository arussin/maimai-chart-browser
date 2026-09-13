"""Sealed chart catalog presentation, with a separate optional private overlay.

The browser boundary is an explicit recursive allowlist. Raw input packs, source
locators, registry research records, and arbitrary report dictionaries are never
serialized here. Unknown fields fail rather than being silently made public.
"""

from __future__ import annotations

import json
import math
from collections.abc import Mapping
from importlib import resources
from pathlib import Path
from typing import Any

from .io import atomic_write_text
from .song_search import song_search_script

_METRICS = {
    key: "number?"
    for key in (
        "onset_count",
        "duration_us",
        "onset_rate",
        "peak_onset_rate",
        "sustained_onset_rate",
        "hold_occupancy",
        "slide_movement_occupancy",
        "slide_wait_occupancy",
        "max_concurrency",
        "simultaneity",
        "burstiness",
        "slide_count",
        "hold_count",
        "touch_count",
        "break_fraction",
    )
}
_COVERAGE = {
    key: "scalar?"
    for key in (
        "analysis",
        "timing",
        "positions",
        "geometry",
        "rhythm",
        "beat_anchors",
        "slide_geometry",
        "slide_movement",
        "slide_wait",
        "holds",
        "source",
        "identity",
        "parsing",
        "catalog_charts",
        "source_available",
        "identity_resolved",
        "parse_supported",
        "fully_analyzed",
        "partially_analyzed",
        "reviewed_named_patterns",
        "missing",
        "blocked",
        "unavailable",
        "complete",
        "partial",
        "unknown",
        "summary",
        "scope",
        "release",
        "region",
        "named_patterns",
        "game_identity",
    )
}
_BOUNDS = {"start_us": "number", "end_us": "number"}
_DESCRIPTOR = {
    "sequence": ["string"],
    "ngrams": "ngrams",
    "features": {
        key: "number?"
        for key in (
            "tap_fraction",
            "touch_fraction",
            "hold_fraction",
            "star_fraction",
            "simultaneous_fraction",
            "branches_per_head",
            "mean_beat_interval",
            "beat_interval_variation",
            "hold_occupancy",
            "slide_movement_occupancy",
            "slide_wait_occupancy",
        )
    },
    "coverage": "number?",
    "version": "string",
    "policy_version": "string",
}
_SECTION = {
    **_BOUNDS,
    "section_id": "string",
    "metrics": _METRICS,
    "descriptor": _DESCRIPTOR,
    "pattern_ids": ["string"],
    "coverage": _COVERAGE,
}
_TAG = {
    "pattern_id": "string",
    "status": "string",
    "occurrence_count": "number?",
    "prevalence": "number?",
    "union_duration_us": "number?",
    "longest_run_us": "number?",
    "representative_sections": [{**_BOUNDS, "section_id": "string", "occurrence_id": "string"}],
    "definition_version": "string",
    "detector_version": "string",
    "review_status": "string",
    "coverage": "string",
    "occurrences_truncated": "boolean",
}
_OCCURRENCE = {
    **_BOUNDS,
    "occurrence_id": "string",
    "pattern_id": "string",
    "section_id": "string",
    "definition_version": "string",
    "detector_version": "string",
    "status": "string",
    "explanation": "string",
    "transform": "string",
    "event_ids": ["string"],
    "path_ids": ["string"],
    "evidence_truncated": "boolean",
    "evidence": {
        key: "string" for key in ("source_kind", "identity", "timing", "definition", "detector")
    },
    "measurements": {
        **{
            key: "number"
            for key in (
                "onset_count",
                "input_count",
                "independent_onset_count",
                "branch_count",
                "segment_count",
                "peak_concurrency",
                "first_third_onset_rate",
                "last_third_onset_rate",
            )
        },
        "event_evidence_truncated": "boolean",
    },
}
_FLOW = {
    "span_start_us": "number",
    "span_end_us": "number",
    "basis": "string",
    "frame_us": "number",
    "reference_scale_id": "string",
    "unavailable_reason": "string",
    "density_summary": "string",
    "demand_summary": "string",
    "scales": {
        "density": {"id": "string", "bands": ["number"], "unit": "string"},
        "estimated_demand": {"id": "string", "bands": ["number"], "unit": "string"},
    },
    "segments": [
        {
            **_BOUNDS,
            "coverage": "number?",
            "density": {"mean": "number?", "peak": "number?", "coverage": "number?"},
            "estimated_demand": {"mean": "number?", "peak": "number?", "coverage": "number?"},
            "contributors": ["string"],
        }
    ],
}
_CHART = {
    **{
        key: "string"
        for key in (
            "chart_id",
            "song_id",
            "title",
            "artist",
            "format",
            "difficulty",
            "revision",
            "level",
            "release",
            "region",
            "availability",
            "analysis_status",
            "source_id",
            "source_revision",
            "source_status",
            "source_kind",
            "identity_status",
            "parse_status",
        )
    },
    "aliases": ["string"],
    "constant": "number?",
    "coverage": _COVERAGE,
    "metrics": _METRICS,
    "descriptor": _DESCRIPTOR,
    "flow": _FLOW,
    "tags": [_TAG],
    "occurrences": [_OCCURRENCE],
    "sections": [_SECTION],
}
_PATTERN = {
    **{
        key: "string"
        for key in (
            "pattern_id",
            "display_name",
            "kind",
            "family",
            "naming_origin",
            "definition_status",
            "detector_status",
            "description",
            "definition_version",
            "recognition_scope",
        )
    },
    "aliases": ["string"],
    "limitations": ["string"],
    "source_ids": ["string"],
}
_PACK = {
    "evaluation_only": "boolean",
    "schema_version": "string",
    "catalog_id": "string",
    "registry_version": "string",
    "analyzer_version": "string",
    "policy_version": "string",
    "coverage": _COVERAGE,
    "charts": [_CHART],
    "patterns": [_PATTERN],
}
_ATTEMPT = {
    "attempt_id": "string",
    "percent": "number?",
    "rate": "number?",
    "recorded_at": "number?",
    "lamp": "string",
    "grade": "string",
}
_OVERLAY = {
    "entries": [
        {
            "chart_id": "string",
            "percent": "number?",
            "rate": "number?",
            "grade": "string",
            "lamp": "string",
            "last_played": "number?",
            "pb_achieved_at": "number?",
            "attempt_count": "number?",
            "attempts": [_ATTEMPT],
            "counted_pool": "string",
        }
    ],
    "coverage": {
        "cutoff_ms": "number?",
        "history_complete": "boolean",
        "scope": "string",
        "recent_only": "boolean",
        "truncated": "boolean",
        "unknown_gaps": "boolean",
        "capture_ids": ["string"],
    },
}


def _check(value: object, schema: object, path: str) -> Any:
    if schema == "ngrams":
        if not isinstance(value, Mapping) or len(value) > 100_000:
            raise ValueError(f"{path} must be a bounded ngram mapping")
        result = {}
        for key, count in value.items():
            if not isinstance(key, str) or len(key) > 1000:
                raise ValueError(f"{path} has an invalid ngram key")
            try:
                tokens = json.loads(key)
            except ValueError as exc:
                raise ValueError(f"{path} ngram keys must encode token arrays") from exc
            if not isinstance(tokens, list) or not 1 <= len(tokens) <= 3:
                raise ValueError(f"{path} has an invalid token array")
            if any(not isinstance(token, str) for token in tokens):
                raise ValueError(f"{path} has an invalid ngram token")
            if not isinstance(count, int) or isinstance(count, bool) or count < 1:
                raise ValueError(f"{path} has an invalid ngram count")
            result[key] = count
        return result
    if isinstance(schema, dict):
        if not isinstance(value, Mapping):
            raise ValueError(f"{path} must be an object")
        if set(value) - set(schema):
            raise ValueError(f"{path} contains fields outside the browser allowlist")
        return {key: _check(item, schema[key], f"{path}.{key}") for key, item in value.items()}
    if isinstance(schema, list):
        if not isinstance(value, list) or len(value) > 100_000:
            raise ValueError(f"{path} must be a bounded list")
        return [_check(item, schema[0], f"{path}[]") for item in value]
    optional = isinstance(schema, str) and schema.endswith("?")
    if value is None and optional:
        return None
    kind = str(schema).removesuffix("?")
    valid = (
        kind == "string"
        and isinstance(value, str)
        or kind == "boolean"
        and isinstance(value, bool)
        or kind == "number"
        and isinstance(value, (int, float))
        and not isinstance(value, bool)
        or kind == "scalar"
        and isinstance(value, (str, int, float, bool))
    )
    if not valid or isinstance(value, float) and not math.isfinite(value):
        raise ValueError(f"{path} has an invalid {kind} value")
    if isinstance(value, str) and len(value) > 10_000:
        raise ValueError(f"{path} text is too long")
    return value


def validate_exploration_pack(pack: Mapping[str, Any]) -> dict[str, Any]:
    """Validate the public compact boundary, independent of any report data."""
    from maimai_analyzer.wire import decode_pack

    if not isinstance(pack, Mapping):
        raise ValueError("Catalog must be an object")
    checked = _check(decode_pack(dict(pack)), _PACK, "catalog")
    if checked.get("schema_version") != "1.0.0":
        raise ValueError("Unsupported exploration catalog schema_version")
    if not isinstance(checked.get("charts"), list) or not isinstance(checked.get("patterns"), list):
        raise ValueError("Catalog requires charts and patterns lists")
    evaluation_only = checked.get("evaluation_only") is True
    if "evaluation_only" in checked and not evaluation_only:
        raise ValueError("An evaluation catalog flag must be explicitly true")
    if not evaluation_only and checked.get("coverage", {}).get("game_identity") == "unverified":
        raise ValueError("Research coverage requires an explicit evaluation catalog")
    experimental_project_ids = {
        pattern.get("pattern_id")
        for pattern in checked["patterns"]
        if (
            pattern.get("naming_origin") == "project_defined"
            or (
                pattern.get("naming_origin") == "community_attested"
                and pattern.get("recognition_scope") == "scoped_community_form"
            )
        )
        and pattern.get("detector_status") == "experimental"
    }
    if evaluation_only and (
        checked.get("coverage", {}).get("game_identity") != "unverified"
        or checked.get("coverage", {}).get("fully_analyzed", 0) != 0
        or checked.get("coverage", {}).get("identity_resolved", 0) != 0
        or checked.get("coverage", {}).get("source_available", 0) != 0
        or checked.get("coverage", {}).get("reviewed_named_patterns", 0) != 0
    ):
        raise ValueError("Evaluation catalogs must retain unverified game and pattern coverage")
    ids: set[str] = set()
    shared_scales: dict[str, tuple] = {}
    for chart in checked["charts"]:
        chart_id = chart.get("chart_id")
        if not chart_id or chart_id in ids:
            raise ValueError("Catalog chart IDs must be nonempty and unique")
        ids.add(chart_id)
        source_kind = chart.get("source_kind")
        if evaluation_only:
            if (
                source_kind != "public_transcription_evaluation"
                or chart.get("coverage", {}).get("game_identity") != "unverified"
                or chart.get("analysis_status") not in {"partial", "unavailable"}
                or chart.get("coverage", {}).get("analysis") != chart.get("analysis_status")
                or chart.get("identity_status") not in {"reviewed", "ambiguous", "unresolved"}
                or chart.get("source_status") != "use_unresolved"
            ):
                raise ValueError(
                    "Every evaluation chart must retain its research identity boundary"
                )
            for evidence in chart.get("tags", []) + chart.get("occurrences", []):
                if (
                    evidence.get("pattern_id") not in experimental_project_ids
                    or evidence.get("status") == "reviewed-present"
                ):
                    raise ValueError("Evaluation charts cannot claim reviewed community patterns")
            if any(tag.get("review_status") != "experimental" for tag in chart.get("tags", [])):
                raise ValueError("Research tags must retain their experimental review status")
        elif source_kind not in {None, "authored_synthetic", "reviewed_permitted_local"} or (
            chart.get("coverage", {}).get("game_identity") == "unverified"
        ):
            raise ValueError("Research chart evidence requires an explicit evaluation catalog")
        if any(not chart.get(key) for key in ("song_id", "format", "difficulty", "revision")):
            raise ValueError("Catalog charts require exact variant identity")
        segments = chart.get("flow", {}).get("segments", [])
        for metric, scale in chart.get("flow", {}).get("scales", {}).items():
            bands = scale.get("bands", [])
            if any(value < 0 for value in bands) or bands != sorted(set(bands)):
                raise ValueError("Flow scale bands must be nonnegative and strictly increasing")
            if bands and scale.get("id"):
                identity = (scale["id"], scale.get("unit"), tuple(bands))
                if metric in shared_scales and shared_scales[metric] != identity:
                    raise ValueError(
                        "Catalog charts must use the same shared Flow scale per metric"
                    )
                shared_scales[metric] = identity
        if segments and len(segments) != 24:
            raise ValueError("Flow requires exactly 24 prepared segments")
        for segment in segments:
            if (
                type(segment.get("start_us")) is not int
                or type(segment.get("end_us")) is not int
                or segment.get("start_us", -1) < 0
                or segment.get("end_us", 0) <= segment.get("start_us", 0)
            ):
                raise ValueError("Flow segment durations must be positive")
            coverage = segment.get("coverage")
            if coverage is not None and not 0 <= coverage <= 1:
                raise ValueError("Flow coverage must be a fraction")
            for metric in ("density", "estimated_demand"):
                observed = segment.get(metric, {})
                metric_coverage = observed.get("coverage")
                if metric_coverage is not None and not 0 <= metric_coverage <= 1:
                    raise ValueError("Metric Flow coverage must be a fraction")
                if any(
                    observed.get(key) is not None and observed[key] < 0 for key in ("mean", "peak")
                ):
                    raise ValueError("Flow observations must be nonnegative")
        for section in chart.get("sections", []) + chart.get("occurrences", []):
            if any(
                type(section.get(key)) is not int or section[key] < 0
                for key in ("start_us", "end_us")
            ):
                raise ValueError("Section times must be nonnegative integer microseconds")
            if section["end_us"] <= section["start_us"]:
                raise ValueError("Section durations must be positive")
        for occurrence in chart.get("occurrences", []):
            source_kind = occurrence.get("evidence", {}).get("source_kind")
            if source_kind not in (
                {"public_transcription_evaluation"}
                if evaluation_only
                else {None, "authored_synthetic", "reviewed_permitted_local"}
            ):
                raise ValueError("Occurrence source kind conflicts with catalog research boundary")
            if any(len(occurrence.get(key, [])) > 4 for key in ("event_ids", "path_ids")):
                raise ValueError("Browser occurrence evidence is limited to four IDs per kind")
            if any(
                not isinstance(value, bool) and value < 0
                for value in occurrence.get("measurements", {}).values()
            ):
                raise ValueError("Occurrence measurements must be nonnegative")
    pattern_ids = [pattern.get("pattern_id") for pattern in checked["patterns"]]
    if any(not value for value in pattern_ids) or len(set(pattern_ids)) != len(pattern_ids):
        raise ValueError("Pattern IDs must be nonempty and unique")
    return checked


def validate_player_overlay(
    overlay: Mapping[str, Any] | None, *, report_cutoff_ms: int | None = None
) -> dict[str, Any] | None:
    """Validate retained private results without adding or changing coverage claims.

    A renderer-supplied cutoff bounds every record even when the overlay omits
    its own cutoff. An older declared overlay cutoff remains an additional bound.
    """
    if overlay is None:
        return None
    checked = _check(overlay, _OVERLAY, "private overlay")
    if report_cutoff_ms is not None and (
        type(report_cutoff_ms) is not int or not 0 <= report_cutoff_ms < 8.64e15
    ):
        raise ValueError("Report cutoff must be supported integer milliseconds")
    cutoff = checked.get("coverage", {}).get("cutoff_ms")
    if cutoff is not None and (type(cutoff) is not int or not 0 <= cutoff < 8.64e15):
        raise ValueError("Overlay cutoff must be supported integer milliseconds")
    if cutoff is not None and report_cutoff_ms is not None and cutoff > report_cutoff_ms:
        raise ValueError("Overlay cutoff lies after the retained report cutoff")
    if cutoff is None:
        cutoff = report_cutoff_ms
    ids = [entry.get("chart_id") for entry in checked.get("entries", [])]
    if any(not value for value in ids) or len(set(ids)) != len(ids):
        raise ValueError("Overlay chart IDs must be nonempty and unique")
    for entry in checked.get("entries", []):
        for key in ("last_played", "pb_achieved_at"):
            timestamp = entry.get(key)
            if timestamp is not None and (
                type(timestamp) is not int or not 0 <= timestamp < 8.64e15
            ):
                raise ValueError("Overlay timestamps must be supported integer milliseconds")
            if timestamp is not None and cutoff is not None and timestamp > cutoff:
                raise ValueError("Overlay result lies after its retained cutoff")
        for attempt in entry.get("attempts", []):
            timestamp = attempt.get("recorded_at")
            if timestamp is not None and (
                type(timestamp) is not int or not 0 <= timestamp < 8.64e15
            ):
                raise ValueError("Attempt timestamps must be supported integer milliseconds")
            if timestamp is not None and cutoff is not None and timestamp > cutoff:
                raise ValueError("Overlay attempt lies after its retained cutoff")
    return checked


def explorer_assets() -> tuple[str, str]:
    """Return local styles and scripts shared by both presentation contexts."""
    assets = resources.files("maimai_intelligence.assets")
    theme = json.loads(assets.joinpath("chart-theme.json").read_text(encoding="utf-8"))
    variables = {f"--chart-flow-{i}": color for i, color in enumerate(theme["flow_colors"])}
    variables.update(
        {f"--chart-difficulty-{name}": color for name, color in theme["difficulty_colors"].items()}
    )
    css = ":root{" + ";".join(f"{key}:{value}" for key, value in variables.items()) + "}\n"
    css += assets.joinpath("chart-visuals.css").read_text(encoding="utf-8") + "\n"
    css += assets.joinpath("explore.css").read_text(encoding="utf-8")
    similarity = assets.joinpath("explore-similarity.js")
    js = assets.joinpath("explore-wire.js").read_text(encoding="utf-8") + "\n"
    visuals = assets.joinpath("chart-visuals.js").read_text(encoding="utf-8")
    js += visuals.replace("__MAIMAI_CHART_THEME__", json.dumps(theme, ensure_ascii=False)) + "\n"
    js += similarity.read_text(encoding="utf-8") if similarity.is_file() else ""
    js += "\n" + song_search_script()
    return css, js + "\n" + assets.joinpath("explore.js").read_text(encoding="utf-8")


def build_catalog_html(pack: Mapping[str, Any]) -> str:
    """Build a standalone catalog; intentionally accepts no private overlay."""
    from maimai_analyzer.wire import encode_pack

    from .render import EXTERNAL_URL, SEALED_CONTENT_SECURITY_POLICY, json_for_html

    checked = validate_exploration_pack(pack)
    css, js = explorer_assets()
    base_css = (
        resources.files("maimai_intelligence.assets").joinpath("styles.css").read_text("utf-8")
    )
    html = (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta name="referrer" content="no-referrer">'
        '<meta name="robots" content="noindex,nofollow,noarchive">'
        f'<meta http-equiv="Content-Security-Policy" content="{SEALED_CONTENT_SECURITY_POLICY}">'
        f"<title>maimai Chart Explorer</title><style>{base_css}\n{css}</style></head>"
        '<body class="clean-checkpoint catalog-only"><main class="app-shell">'
        '<div class="report"><section id="explore-view" data-catalog-only="true"></section>'
        '</div></main><script type="application/json" id="exploration-data">'
        f"{json_for_html(encode_pack(checked))}</script><script>{js}</script></body></html>"
    )
    if EXTERNAL_URL.search(html):
        raise ValueError("Catalog contains an external HTTP or HTTPS URL")
    return html


def render_catalog(pack: Mapping[str, Any], output_path: Path) -> Path:
    """Write a nonpersonal catalog with the same Explorer used by private reports."""
    output_path = Path(output_path)
    atomic_write_text(output_path, build_catalog_html(pack))
    return output_path
