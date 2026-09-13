"""Build a nonpersonal catalog from explicit metadata and compatible local profiles."""

from __future__ import annotations

import copy
import math
from collections.abc import Mapping

from .contracts import (
    ANALYZER_VERSION,
    SCHEMA_VERSION,
    SUPPORTED_SCHEMA_VERSIONS,
    canonical_bytes,
    content_hash,
    validate_profile,
)
from .similarity import POLICY_VERSION, compact_descriptor

IDENTITY = ("chart_id", "song_id", "format", "difficulty", "revision")
EVALUATION_SOURCE = "public_transcription_evaluation"
META_FIELDS = {
    *IDENTITY,
    "title",
    "artist",
    "aliases",
    "level",
    "constant",
    "release",
    "region",
    "availability",
    "source_id",
    "source_revision",
    "source_status",
    "identity_status",
    "source_hash",
}
METRICS = (
    "onset_count",
    "duration_us",
    "onset_rate",
    "peak_onset_rate",
    "sustained_onset_rate",
    "hold_occupancy",
    "slide_movement_occupancy",
    "slide_wait_occupancy",
    "max_concurrency",
)
TAG_FIELDS = (
    "pattern_id",
    "status",
    "occurrence_count",
    "prevalence",
    "union_duration_us",
    "longest_run_us",
    "definition_version",
    "detector_version",
    "review_status",
    "coverage",
    "occurrences_truncated",
)
OCCURRENCE_FIELDS = (
    "start_us",
    "end_us",
    "occurrence_id",
    "pattern_id",
    "section_id",
    "definition_version",
    "detector_version",
    "status",
    "explanation",
    "transform",
)
OCCURRENCE_MEASUREMENTS = (
    "onset_count",
    "input_count",
    "independent_onset_count",
    "branch_count",
    "segment_count",
    "peak_concurrency",
    "first_third_onset_rate",
    "last_third_onset_rate",
)
EVIDENCE_VALUES = {
    "source_kind": {"authored_synthetic", "reviewed_permitted_local"},
    "identity": {"exact", "reviewed", "ambiguous", "unresolved"},
    "timing": {"supported_section"},
    "definition": {"project_experimental"},
    "detector": {"synthetic_tested_experimental"},
}


def _take(value, names):
    return {k: copy.deepcopy(value[k]) for k in names if k in value}


def _metadata(value: Mapping) -> dict:
    if not isinstance(value, Mapping) or set(value) - META_FIELDS:
        raise ValueError("Catalog metadata contains unsupported fields; personal data is forbidden")
    if any(not isinstance(value.get(k), str) or not value[k] for k in (*IDENTITY, "title")):
        raise ValueError("Catalog requires complete exact chart identity and title")
    for key, item in value.items():
        if key == "constant":
            if item is not None and (
                type(item) not in (float, int) or not math.isfinite(item) or not 0 < item < 20
            ):
                raise ValueError("Invalid chart constant")
        elif key == "aliases":
            if (
                not isinstance(item, list)
                or len(item) > 64
                or any(not isinstance(alias, str) or len(alias) > 512 for alias in item)
            ):
                raise ValueError("Invalid catalog aliases")
        elif not isinstance(item, str) or len(item) > 4096:
            raise ValueError("Invalid catalog text")
    if value["format"] not in {"STD", "DX"}:
        raise ValueError("Catalog format must be STD or DX")
    result = {
        "artist": "",
        "aliases": [],
        "level": "",
        "constant": None,
        "release": "unknown",
        "region": "unknown",
        "availability": "unknown",
        "source_status": "missing",
        "identity_status": "unresolved",
        **copy.deepcopy(value),
    }
    if result["availability"] not in {"available", "unavailable", "unknown"}:
        raise ValueError("Invalid release/region availability")
    if result["source_status"] not in {"available", "missing", "inaccessible", "use_unresolved"}:
        raise ValueError("Invalid source coverage")
    if result["identity_status"] not in {"exact", "reviewed", "ambiguous", "unresolved"}:
        raise ValueError("Invalid identity coverage")
    return result


def _pattern(entry: Mapping) -> dict:
    aliases = [a["text"] if isinstance(a, dict) else a for a in entry.get("aliases", [])]
    return {
        "pattern_id": entry.get("pattern_id", entry.get("id")),
        "display_name": entry["display_name"],
        "aliases": aliases,
        "kind": entry["kind"],
        "family": entry.get("family", ""),
        "naming_origin": entry.get("naming_origin", entry.get("name_origin", "project_defined")),
        "definition_status": entry["definition_status"],
        "detector_status": entry["detector_status"],
        "description": entry.get("description", entry.get("definition", "")),
        "definition_version": entry.get("definition_version", "proposed"),
        **(
            {"recognition_scope": entry["recognition_scope"]}
            if "recognition_scope" in entry
            else {}
        ),
        "limitations": entry.get("counterexamples_and_limits", entry.get("limitations", [])),
        "source_ids": entry.get("source_ids", []),
    }


def _compact_occurrence(occurrence: Mapping, *, evaluation_only: bool = False) -> dict:
    result = _take(occurrence, OCCURRENCE_FIELDS)
    truncated = False
    for key in ("event_ids", "path_ids"):
        ids = occurrence.get(key, [])
        if not isinstance(ids, list) or any(
            not isinstance(value, str) or len(value) > 240 for value in ids
        ):
            raise ValueError("Invalid supporting occurrence IDs")
        result[key] = ids[:4]
        truncated |= len(ids) > 4
    measured = occurrence.get("measurements", {})
    evidence = occurrence.get("evidence", {})
    if not isinstance(measured, Mapping) or not isinstance(evidence, Mapping):
        raise ValueError("Occurrence measurements and evidence must be explicit mappings")
    if evaluation_only and evidence.get("source_kind") != EVALUATION_SOURCE:
        raise ValueError("Research occurrence evidence must retain its explicit source kind")
    result["measurements"] = {}
    for key in OCCURRENCE_MEASUREMENTS:
        if key in measured:
            value = measured[key]
            if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
                raise ValueError("Invalid supported occurrence measurement")
            result["measurements"][key] = value
    if "event_evidence_truncated" in measured:
        if type(measured["event_evidence_truncated"]) is not bool:
            raise ValueError("Invalid occurrence evidence truncation state")
        result["measurements"]["event_evidence_truncated"] = measured["event_evidence_truncated"]
        truncated |= measured["event_evidence_truncated"]
    result["evidence"] = {}
    for key, allowed in EVIDENCE_VALUES.items():
        if evaluation_only and key == "source_kind":
            allowed = {EVALUATION_SOURCE}
        if key in evidence:
            if not isinstance(evidence[key], str) or evidence[key] not in allowed:
                raise ValueError("Unsupported occurrence evidence status")
            result["evidence"][key] = evidence[key]
    result["evidence_truncated"] = truncated
    return result


def _compact_profile(profile: Mapping, *, evaluation_only: bool = False) -> dict:
    tags = []
    for tag in profile.get("tags", []):
        # Omitted tags mean unknown, never supported absence. Registry glossary
        # retains every proposed definition without repeating its unknown state.
        if tag.get("status") == "unknown":
            continue
        compact = _take(tag, TAG_FIELDS)
        compact["representative_sections"] = [
            _take(section, ("start_us", "end_us", "section_id", "occurrence_id"))
            for section in tag.get("representative_sections", [])
        ]
        tags.append(compact)
    raw_flow = profile.get("flow", {})
    flow = _take(raw_flow, ("span_start_us", "span_end_us", "basis", "frame_us"))
    flow["scales"] = {
        metric: {
            **_take(raw_flow.get("scales", {}).get(metric, {}), ("unit", "bands")),
            "id": raw_flow.get("scales", {}).get("reference_scale_id", "unknown"),
        }
        for metric in ("density", "estimated_demand")
    }
    flow["segments"] = [
        {
            **_take(s, ("start_us", "end_us", "coverage", "contributors")),
            **{
                m: _take(s.get(m, {}), ("mean", "peak", "coverage"))
                for m in ("density", "estimated_demand")
            },
        }
        for s in raw_flow.get("segments", [])
    ]
    for key in ("density_summary", "demand_summary"):
        summary = raw_flow.get(key, {})
        flow[key] = (
            f"Mean {summary.get('mean')}; peak {summary.get('peak')}; "
            f"measured coverage {summary.get('coverage')}. Provisional structural policy."
        )
    return {
        "metrics": _take(profile.get("metrics", {}), METRICS),
        "flow": flow,
        "descriptor": compact_descriptor(profile.get("descriptor", {})),
        "tags": tags,
        "occurrences": [
            _compact_occurrence(o, evaluation_only=evaluation_only)
            for o in profile.get("occurrences", [])
        ],
        "sections": [
            {
                **_take(s, ("section_id", "start_us", "end_us", "pattern_ids")),
                "metrics": _take(s.get("metrics", {}), METRICS),
                "descriptor": compact_descriptor(s.get("descriptor", {})),
            }
            for s in profile.get("sections", [])
        ],
    }


def build_catalog(
    metadata: list[dict], profiles: list[dict], registry: dict, *, catalog_id: str = "local-catalog"
) -> tuple[dict, dict]:
    """Build a production catalog; evaluation sources are always withheld."""
    return _build_catalog(metadata, profiles, registry, catalog_id=catalog_id)


def build_evaluation_catalog(
    metadata: list[dict],
    profiles: list[dict],
    registry: dict,
    *,
    catalog_id: str = "evaluation-catalog",
) -> tuple[dict, dict]:
    """Build a nonpersonal research pack, explicitly barred from private consumers.

    Only public-transcription evaluation profiles are accepted. Identity review
    concerns the supplied transcription label; game identity remains unverified.
    The ordinary metadata schema is reused; no score, source URL or raw notation
    enters the browser. Missing/malformed profiles remain visibly unavailable.
    """
    return _build_catalog(metadata, profiles, registry, catalog_id=catalog_id, evaluation_only=True)


def _build_catalog(
    metadata: list[dict],
    profiles: list[dict],
    registry: dict,
    *,
    catalog_id: str,
    evaluation_only: bool = False,
) -> tuple[dict, dict]:
    """Return browser pack and separate content-hashed coverage/cache manifest.

    Unknown/unavailable inputs remain metadata entries. Mismatched profiles never
    cross a chart revision. This function accepts no player overlay or report.
    Accepted profiles must share one frozen configuration and reference scale;
    rebuild profiles together before comparing a changed demand policy.
    """
    if not isinstance(metadata, list) or len(metadata) > 100_000:
        raise ValueError("Catalog metadata must be a bounded chart list")
    if (
        not isinstance(profiles, list)
        or len(profiles) > 100_000
        or any(not isinstance(p, dict) or not isinstance(p.get("chart_id"), str) for p in profiles)
    ):
        raise ValueError("Profiles must be a bounded list with explicit chart identities")
    if evaluation_only and any(
        not isinstance(profile.get("source"), Mapping)
        or profile["source"].get("kind") != EVALUATION_SOURCE
        for profile in profiles
    ):
        raise ValueError("Evaluation catalog inputs must declare public transcription evaluation")
    charts = sorted((_metadata(m) for m in metadata), key=lambda m: m["chart_id"])
    if len({c["chart_id"] for c in charts}) != len(charts):
        raise ValueError("Duplicate catalog chart ID")
    profile_map = {p["chart_id"]: p for p in profiles}
    if len(profile_map) != len(profiles):
        raise ValueError("Duplicate profile chart ID")
    registry_version = registry["registry_version"]
    registry_hash = content_hash(registry)
    experimental_project_ids = {
        entry.get("pattern_id", entry.get("id"))
        for entry in registry["entries"]
        if (
            entry.get("naming_origin", entry.get("name_origin")) == "project_defined"
            or (
                entry.get("name_origin") == "community_attested"
                and entry.get("recognition_scope") == "scoped_community_form"
            )
        )
        and entry.get("detector_status") == "experimental"
    }
    coverage = {
        "catalog_charts": len(charts),
        "source_available": 0,
        "identity_resolved": 0,
        "parse_supported": 0,
        "fully_analyzed": 0,
        "partially_analyzed": 0,
        "reviewed_named_patterns": 0,
        "missing": 0,
        "blocked": 0,
        "unavailable": 0,
        "summary": "Configured local catalog; source coverage is not the game catalog size.",
    }
    records, diagnostics = [], []
    accepted_config_hashes, accepted_reference_scales = set(), set()
    for chart in charts:
        cid, profile = chart["chart_id"], profile_map.get(chart["chart_id"])
        if evaluation_only:
            chart["source_kind"] = EVALUATION_SOURCE
            chart["source_status"] = "use_unresolved"
            # Review applies only to the supplied transcription's variant label.
            if chart["identity_status"] == "exact":
                chart["identity_status"] = "reviewed"
        elif (
            profile is not None
            and isinstance(profile.get("source"), Mapping)
            and profile["source"].get("kind") == "public_transcription_evaluation"
        ):
            # Local evaluation is not production source/identity approval. Do not
            # let optimistic caller metadata inflate trusted coverage counters.
            chart["source_status"] = "use_unresolved"
            chart["identity_status"] = "unresolved"
        coverage["source_available"] += chart["source_status"] == "available"
        coverage["identity_resolved"] += not evaluation_only and chart["identity_status"] in {
            "exact",
            "reviewed",
        }
        coverage["missing"] += chart["source_status"] == "missing"
        coverage["blocked"] += chart["source_status"] in {"inaccessible", "use_unresolved"}
        compatible = (
            profile is not None
            and all(profile.get(k) == chart[k] for k in IDENTITY)
            and isinstance(profile.get("schema_version"), str)
            and profile["schema_version"] in SUPPORTED_SCHEMA_VERSIONS
            and profile.get("analyzer_version") == ANALYZER_VERSION
            and profile.get("registry_version") == registry_version
            and profile.get("registry_hash") == registry_hash
            and isinstance(profile.get("source"), Mapping)
            and profile["source"].get("kind")
            in (
                {EVALUATION_SOURCE}
                if evaluation_only
                else {"authored_synthetic", "reviewed_permitted_local"}
            )
            and isinstance(profile.get("coverage"), Mapping)
            and profile["source"].get("identity_status") in ("exact", "reviewed")
            and profile["coverage"].get("identity") in ("exact", "reviewed")
            and all(
                key not in chart or chart[key] == profile.get("source", {}).get(source_key)
                for key, source_key in (("source_id", "source_id"), ("source_revision", "revision"))
            )
            and (evaluation_only or chart["source_status"] == "available")
            and chart["identity_status"] in {"exact", "reviewed"}
            and ("source_hash" not in chart or chart["source_hash"] == profile.get("source_hash"))
        )
        if compatible:
            try:
                validate_profile(profile)
                compact = _compact_profile(profile, evaluation_only=evaluation_only)
                if evaluation_only and (
                    any(
                        tag["pattern_id"] not in experimental_project_ids
                        or tag.get("status") == "reviewed-present"
                        or tag.get("review_status") != "experimental"
                        for tag in compact["tags"]
                    )
                    or any(
                        occurrence["pattern_id"] not in experimental_project_ids
                        or occurrence.get("status") == "reviewed-present"
                        for occurrence in compact["occurrences"]
                    )
                ):
                    raise ValueError("Evaluation cannot claim reviewed community pattern evidence")
                canonical_bytes(compact)
            except (ValueError, TypeError, KeyError, AttributeError):
                compatible = False
        # Acquisition-only hashes and locators do not enter the browser payload.
        chart.pop("source_hash", None)
        chart["analysis_status"], chart["parse_status"] = "unavailable", "unsupported"
        chart["coverage"] = {"analysis": "unavailable"}
        if compatible:
            if profile.get("config_hash"):
                accepted_config_hashes.add(profile["config_hash"])
            if profile.get("reference_scale_id"):
                accepted_reference_scales.add(profile["reference_scale_id"])
            state = profile.get("coverage", {}).get("analysis", "partial")
            if evaluation_only and state == "complete":
                state = "partial"
            chart["analysis_status"] = (
                state if state in {"complete", "partial", "unavailable"} else "partial"
            )
            chart["parse_status"] = "complete" if state == "complete" else "partial"
            chart["coverage"] = {"analysis": chart["analysis_status"]}
            chart.update(compact)
            coverage["parse_supported"] += 1
            if chart["analysis_status"] == "complete":
                coverage["fully_analyzed"] += 1
            elif chart["analysis_status"] == "partial":
                coverage["partially_analyzed"] += 1
            records.append(
                {
                    "chart_id": cid,
                    "profile_hash": content_hash(profile),
                    "cache_key": profile.get("cache_key"),
                    "source_hash": profile.get("source_hash"),
                    "normalized_hash": profile.get("normalized_hash"),
                }
            )
        else:
            diagnostics.append({"chart_id": cid, "code": "profile_missing_or_incompatible"})
        if evaluation_only:
            chart["coverage"].update(
                game_identity="unverified",
                source="research_transcription",
                summary="Transcription measurements only; game identity and fidelity unverified.",
            )
        coverage["unavailable"] += chart["analysis_status"] == "unavailable"
    if len(accepted_config_hashes) > 1 or len(accepted_reference_scales) > 1:
        raise ValueError(
            "Catalog profiles require one frozen configuration and reference scale; "
            "rebuild compatible profiles together"
        )
    pack = {
        "schema_version": SCHEMA_VERSION,
        "catalog_id": catalog_id,
        "analyzer_version": ANALYZER_VERSION,
        "registry_version": registry_version,
        "policy_version": POLICY_VERSION,
        "coverage": coverage,
        "charts": charts,
        "patterns": [
            _pattern(e)
            for e in sorted(registry["entries"], key=lambda e: e.get("pattern_id", e.get("id")))
        ],
    }
    if evaluation_only:
        pack["evaluation_only"] = True
        coverage.update(
            game_identity="unverified",
            summary=(
                "Research transcription catalog only. Partial measurements; "
                "game identity and fidelity are unverified. No private recommendations."
            ),
        )
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "analyzer_version": ANALYZER_VERSION,
        "registry_version": registry_version,
        "catalog_hash": content_hash(pack),
        "metadata_hash": content_hash(sorted(metadata, key=lambda m: m["chart_id"])),
        "registry_hash": registry_hash,
        "coverage": copy.deepcopy(coverage),
        "profiles": records,
        "diagnostics": diagnostics,
    }
    if evaluation_only:
        manifest["evaluation_only"] = True
    canonical_bytes(pack)
    return pack, manifest
