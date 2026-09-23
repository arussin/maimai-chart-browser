"""Validate and cache supplemental transcriptions using the existing analysis engine."""

import hashlib
import re
from copy import deepcopy
from importlib.resources import files
from pathlib import Path

from maimai_analyzer.challenge import VERSION, profile_chart
from maimai_analyzer.contracts import content_hash
from maimai_analyzer.simai_subset import PARSER_VERSION, parse_simai_subset

from .coverage_types import IntegrityError, SnapshotError
from .metadata_policy import number
from .overview_codec import compact_overview
from .registry import analysis_fingerprint
from .research_overview import chart_overview, overview_package
from .snapshots import atomic_json, read_json
from .transcription_counts import COUNT_CONVENTION, count_comparison, note_counts
from .transcription_identity import input_identity

POLICY = "catalog-transcription-1"


def implementation():
    roots = (files("maimai_analyzer"), files("maimai_intelligence"))
    return {
        f"{i}/{p.name}": hashlib.sha256(p.read_bytes()).hexdigest()
        for i, root in enumerate(roots)
        for p in root.iterdir()
        if p.is_file() and p.name.endswith((".py", ".json"))
    } | {
        "count_validator": hashlib.sha256(
            files("maimai_intelligence").joinpath("transcription_counts.py").read_bytes()
        ).hexdigest()
    }


def prepare_body(body, reference):
    """Supply a missing initial tempo from the same identity-checked reference row.

    Keep the original source hash and reference capture in the transformation audit.
    The prepared body hash binds this tempo into analysis and subsequent refreshes.
    Explicit in-body tempo always wins; never repair arbitrary notation.
    """
    text = body.decode("utf-8")
    prefix = re.match(r"\s*(?:&inote_[1-6]=\s*)?(?:(?:\|\|[^\n]*\n)\s*)*", text)
    position = prefix.end()
    bpm = number(reference.get("bpm"), "bpm")
    source = reference.get("reference_source")
    if text[position : position + 1] != "{" or bpm is None or not source:
        return body, None
    transform = {
        "kind": "initial_bpm_from_reference",
        "bpm": bpm,
        "original_body_sha256": hashlib.sha256(body).hexdigest(),
        "reference_source": source,
    }
    prepared = (text[:position] + "(" + format(bpm, ".15g") + ")" + text[position:]).encode("utf-8")
    return prepared, transform


def qualify(body, row, expected_counts, cache, *, fingerprints=None):
    if not isinstance(expected_counts, dict) or set(expected_counts) != {
        "tap",
        "hold",
        "slide",
        "touch",
        "break",
    }:
        raise SnapshotError("Complete reference note counts are required for automatic analysis")
    if hashlib.sha256(body).hexdigest() != row["body_sha256"]:
        raise IntegrityError("Transcription body integrity mismatch")
    fingerprints = fingerprints or implementation()
    cache_key = analysis_fingerprint(row, fingerprints, parser=PARSER_VERSION, analyzer=VERSION)
    path = Path(cache) / (cache_key + ".json")
    identity = input_identity(row)
    hit = path.exists()
    if hit:
        envelope = read_json(path)
        record = envelope["record"]
        if envelope.get("hash") != content_hash(record) or record["identity"] != identity:
            raise IntegrityError("Supplemental analysis cache integrity mismatch")
    else:
        chart, audit = parse_simai_subset(
            body.decode("utf-8"),
            **identity,
            source={
                "source_id": row["input_id"],
                "revision": identity["revision"],
                "kind": "public_transcription_evaluation",
                "identity_status": "exact",
                "byte_hash": row["body_sha256"],
            },
        )
        counts = note_counts(chart, audit)
        comparison = count_comparison(chart, counts, expected_counts, COUNT_CONVENTION)
        if not comparison["comparable"] or not comparison["matches"]:
            raise SnapshotError(
                f"Transcription note-count mismatch: expected {expected_counts}, parsed {counts}"
            )
        profile = profile_chart(chart)
        record = {
            "identity": identity,
            "counts": {key: counts.get(key, 0) for key in expected_counts},
            "profile": {k: v for k, v in profile.items() if k != "windows"},
            "overview": chart_overview(chart),
        }
        atomic_json(path, {"record": record, "hash": content_hash(record)})
    if record["counts"] != expected_counts:
        raise SnapshotError("Cached transcription disagrees with current reference note counts")
    profile = deepcopy(record["profile"])
    profile.update(
        title=row["title"],
        artist=row["artist"],
        level=row.get("level"),
        input_id=row["input_id"],
        source_container_id=row["source_container_id"],
        song_family=row["source_song_id"],
    )
    return (
        profile,
        deepcopy(record["overview"]),
        {"cache_hit": hit, "counts": record["counts"], "fingerprint": cache_key},
    )


def merge_overviews(retained, additions):
    """Append new evidence without changing any retained chart's evidence indices."""
    if not additions:
        return retained
    new = compact_overview(overview_package(additions))
    if not retained:
        return new
    old = compact_overview(retained)
    for field in ("version", "patterns", "detector_version", "registry_version", "definitions"):
        if old.get(field) != new.get(field):
            raise ValueError(
                "Supplemental analysis uses different detector definitions; reanalysis required"
            )
    result = deepcopy(old)
    base = len(result["evidence_pool"])
    result["evidence_pool"].extend(new["evidence_pool"])
    for cid, record in new["charts"].items():
        if cid in result["charts"]:
            raise ValueError("Supplemental analysis cannot replace an existing chart implicitly")
        for tag in record["tags"]:
            tag[5] = [index + base for index in tag[5]]
        result["charts"][cid] = record
    return result
