"""Resumable offline Simai corpus analysis; no acquisition or account access.

Every advertised manifest row gets an outcome, including unavailable sources and
unsupported identities. Hash-verified inputs and versioned parser outcomes drive
reuse. Research catalogs are sharded; neighbor review samples queries, never all
pairs. Neither successful parsing nor matching counts establishes game fidelity.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import tempfile
import time
from collections import Counter, defaultdict
from contextlib import contextmanager
from importlib import resources
from pathlib import Path, PurePosixPath

from maimai_analyzer import analyze, canonical_bytes, pattern_registry, validate_profile
from maimai_analyzer.catalog import build_evaluation_catalog
from maimai_analyzer.contracts import (
    ANALYZER_VERSION,
    ChartInputError,
    content_hash,
)
from maimai_analyzer.flow import validated_config
from maimai_analyzer.simai_subset import PARSER_VERSION, parse_simai_subset
from maimai_analyzer.similarity import POLICY_VERSION, compact_descriptor, distance, query_profiles
from maimai_intelligence.explorer import build_catalog_html
from maimai_intelligence.io import atomic_write_text

VERSION = "simai-corpus-1"
FAILURE_CLASSIFICATION_VERSION = 2
DIAGNOSTIC_CLASSIFICATION_VERSION = 2
DIAGNOSTIC_LABELS = {
    "analyzed": "Analyzed",
    "no_source_acquired": "No source body acquired",
    "parser_compatibility_gap": "Parser compatibility gap",
    "malformed_or_ambiguous_source": "Malformed or ambiguous notation",
    "representation_or_resource_limit": "Representation or resource limit",
    "source_verification_failed": "Source verification failed",
    "identity_unresolved": "Chart identity unresolved or unsupported",
    "analysis_failed": "Analysis failed",
}
SOURCE_KIND = "public_transcription_evaluation"
MAX_ROWS = 100_000
MAX_SOURCE_BYTES = 8 * 1024 * 1024
MAX_MANIFEST_BYTES = 256 * 1024 * 1024
MAX_CACHE_BYTES = 128 * 1024 * 1024
MAX_SHARD_PROFILE_BYTES = 16 * 1024 * 1024
MAX_SHARD_HTML_BYTES = 32 * 1024 * 1024
SUPPORTED_DIFFICULTIES = {"EASY", "BASIC", "ADVANCED", "EXPERT", "MASTER", "RE:MASTER"}


class SourceFailure(ValueError):
    def __init__(self, category, reason):
        super().__init__(reason)
        self.category = category


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _hash(value):
    return value if isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) else None


def _text(value, default="unknown", limit=512):
    return value if isinstance(value, str) and value.strip() and len(value) <= limit else default


def _source_capture(manifest, row_count):
    """Preserve declared acquisition scope without interpreting missing counts as zero."""
    capture = {}
    for key in ("snapshot_id", "capture_stopped_reason"):
        value = manifest.get(key)
        if value is not None and (not isinstance(value, str) or not 1 <= len(value) <= 512):
            raise ValueError(f"Source capture {key} must be bounded text or null")
        capture[key] = value
    for key in (
        "distinct_linked_pages",
        "captured_pages",
        "extracted_bodies",
        "captured_containers",
    ):
        value = manifest.get(key)
        if value is not None and (type(value) is not int or not 0 <= value <= MAX_ROWS):
            raise ValueError(f"Source capture {key} must be a bounded count or null")
        capture[key] = value
    linked, captured = capture["distinct_linked_pages"], capture["captured_pages"]
    if linked is not None and captured is not None and captured > linked:
        raise ValueError("Source capture captured pages exceed the linked-page denominator")
    if capture["extracted_bodies"] is not None and capture["extracted_bodies"] > row_count:
        raise ValueError("Source capture extracted bodies exceed advertised rows")
    capture["partial"] = captured < linked if captured is not None and linked is not None else None
    return capture


def _relative(root: Path, name: str) -> Path:
    if not isinstance(name, str) or not name or len(name) > 512 or "\\" in name:
        raise SourceFailure("invalid_source_path", "Source requires a confined relative path")
    relative = PurePosixPath(name)
    if relative.is_absolute() or any(part in {"..", "."} for part in relative.parts) or ":" in name:
        raise SourceFailure("invalid_source_path", "Source path must stay inside the manifest root")
    try:
        # Normalize both sides, including Windows short-name aliases, before containment.
        root = root.resolve()
        path = (root / name).resolve()
    except (OSError, RuntimeError) as error:
        raise SourceFailure("invalid_source_path", "Source path cannot be resolved") from error
    if not path.is_relative_to(root) or path == root:
        raise SourceFailure("invalid_source_path", "Source alias escapes the manifest root")
    return path


def _read(path, limit):
    with path.open("rb") as stream:
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise ValueError("Local artifact exceeds its declared byte limit")
    return data


def _policy():
    package = resources.files("maimai_analyzer")
    return {
        "processor_version": VERSION,
        "parser_version": PARSER_VERSION,
        "analyzer_version": ANALYZER_VERSION,
        "registry_hash": content_hash(pattern_registry()),
        "config_hash": content_hash(validated_config(None)),
        "implementation_hashes": {
            name: _sha(package.joinpath(name).read_bytes())
            for name in (
                "simai_subset.py",
                "simai_notation.py",
                "simai_timing.py",
                "rational.py",
                "core.py",
                "contracts.py",
                "flow.py",
                "patterns.py",
            )
        },
    }


def _destination(output, name):
    path = (output / name).resolve()
    if not path.is_relative_to(output) or path == output or path.is_dir():
        raise ValueError("Output alias escapes its explicit corpus directory")
    return path


def _write(output, name, value):
    atomic_write_text(_destination(output, name), canonical_bytes(value).decode("utf-8"))


@contextmanager
def _lines(output, name):
    destination = _destination(output, name)
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(
        prefix=".corpus-", suffix=".tmp", dir=destination.parent
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as stream:
            yield stream
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, destination)
    finally:
        Path(temporary).unlink(missing_ok=True)


def _load(manifest_path, output):
    manifest_path = Path(manifest_path).resolve()
    root = manifest_path.parent
    if output == root or root.is_relative_to(output):
        raise ValueError("Corpus output must be separate from its source root and ancestors")
    data = _read(manifest_path, MAX_SOURCE_BYTES)
    manifest = json.loads(data)
    if not isinstance(manifest, dict) or manifest.get("source_kind") != SOURCE_KIND:
        raise ValueError("Corpus manifest must explicitly declare public transcription evaluation")
    if manifest.get("schema_version", "simai-corpus-manifest-1") != "simai-corpus-manifest-1":
        raise ValueError("Unsupported corpus manifest schema")
    source_paths = {manifest_path}
    if "charts_file" in manifest:
        path = _relative(root, manifest["charts_file"])
        source_paths.add(path)
        digest, size = hashlib.sha256(), 0
        with path.open("rb") as stream:
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
                size += len(chunk)
                if size > MAX_MANIFEST_BYTES:
                    raise ValueError("Corpus row manifest exceeds its byte budget")
        if digest.hexdigest() != manifest.get("charts_sha256"):
            raise ValueError("Corpus chart manifest hash mismatch")
        rows = []
        with path.open("rb") as stream:
            for line in stream:
                if len(line) > 65536 or len(rows) >= MAX_ROWS:
                    raise ValueError("Corpus manifest row/count limit exceeded")
                if line.strip():
                    rows.append(json.loads(line))
    else:
        rows = manifest.get("charts")
    if not isinstance(rows, list) or not rows or len(rows) > MAX_ROWS:
        raise ValueError("Corpus manifest requires 1–100000 explicit advertised rows")
    ids = set()
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            raise ValueError("Corpus rows must be JSON objects")
        input_id = _text(row.get("input_id"), default=f"invalid-row-{index}", limit=200)
        if input_id in ids:
            raise ValueError("Duplicate corpus input_id")
        ids.add(input_id)
        row["input_id"] = input_id
        for key in ("body_file", "source_raw_file", "source_index_file"):
            if row.get(key):
                try:
                    source_paths.add(_relative(root, row[key]))
                except SourceFailure:
                    # A bad source locator becomes an individual verification failure.
                    pass
    if any(path == output or path.is_relative_to(output) for path in source_paths):
        raise ValueError("Corpus output must not contain any manifest/source input")
    return root, manifest, sorted(rows, key=lambda row: row["input_id"]), _sha(data)


def _verify(root, name, expected, memo, work, *, body=False):
    if not isinstance(expected, str) or re.fullmatch(r"[0-9a-f]{64}", expected) is None:
        raise SourceFailure("missing_source_hash", "Available source needs its exact SHA-256")
    path = _relative(root, name)
    try:
        stat = path.stat()
        stamp = (stat.st_size, stat.st_mtime_ns)
        if not body and memo.get(path) == (stamp, expected):
            return None
        data = _read(path, MAX_SOURCE_BYTES)
    except FileNotFoundError as error:
        raise SourceFailure("source_missing", "Declared local source file is missing") from error
    except (OSError, ValueError) as error:
        raise SourceFailure(
            "source_unreadable_or_oversize", "Source unreadable or exceeds 8 MiB"
        ) from error
    work["source_bytes_read"] += len(data)
    if _sha(data) != expected:
        raise SourceFailure(
            "source_hash_mismatch", "Local source bytes differ from the declared SHA-256"
        )
    memo[path] = (stamp, expected)
    work["source_files_verified"] += 1
    return data if body else None


def _syntax_category(error, body):
    reason = str(error)
    if "bounded rational" in reason:
        return "normalized_resource_limit"
    if "Terminal E" in reason or "terminal E" in reason:
        return "missing_end_marker"
    if "Only one initial fixed BPM" in reason:
        return "unsupported_bpm_change"
    if any(
        word in reason
        for word in ("Division", "division", "BPM", "timing command", "Timing parameter")
    ):
        return "unsupported_timing"
    match = re.search(r"source character (\d+)", reason)
    suffix = body[int(match[1]) :] if match else ""
    token = suffix.split(",", 1)[0][:1024].lstrip()
    if token[:1] in {"A", "B", "C", "D"} or re.match(r"E\s*[1-8]", token):
        return "unsupported_touch"
    if "`" in token:
        return "unsupported_pseudo_simultaneity"
    if "*" in token:
        return "unsupported_shared_slide_head"
    if "#" in token:
        return "unsupported_duration_form"
    if any(char in token for char in "x$!?"):
        return "unsupported_note_modifier"
    if any(word in reason.lower() for word in ("limit", "exceed", "resolution")):
        return "normalized_resource_limit"
    return "unsupported_note_or_slide_syntax"


def _diagnostic_group(outcome):
    """Group the first observed blocker, without claiming all rejected text is invalid."""
    status, category = outcome.get("status"), outcome.get("category")
    reason = (outcome.get("reason") or "").lower()
    if status == "analyzed":
        return "analyzed"
    if status == "acquisition_unavailable":
        return "no_source_acquired"
    if status == "input_failed":
        return "source_verification_failed"
    if category == "unsupported_identity":
        return "identity_unresolved"
    if status == "analysis_failed":
        return "analysis_failed"
    if category == "normalized_resource_limit" or any(
        word in reason
        for word in ("limit", "exceed", "resolution", "bounded rational", "require at most")
    ):
        return "representation_or_resource_limit"
    if category == "missing_end_marker" or any(
        phrase in reason
        for phrase in (
            "hold presentation modifiers are unsupported",
            "standalone star conversion on a slide is unverified",
            "headless slide cannot combine unverified head modifiers",
            "connected slide intermediate explicit waits are unsupported",
            "shared slide branches with unequal waits are outside the documented subset",
            "only one initial fixed bpm",
            "requires terminal e",
            "terminal e is required",
            "line comment requires a newline",
        )
    ):
        return "parser_compatibility_gap"
    # A generic grammar rejection does not distinguish a typo from an unknown dialect.
    return "malformed_or_ambiguous_source"


def _validate_parse_evidence(value):
    if not isinstance(value, dict) or set(value) != {"body_aliases", "token_aliases", "framing"}:
        raise ValueError("Malformed compact parser evidence")
    for key in ("body_aliases", "token_aliases"):
        counts = value[key]
        if (
            not isinstance(counts, dict)
            or len(counts) > 100
            or any(
                not isinstance(name, str)
                or re.fullmatch(r"[a-z][A-Za-z0-9_]{0,79}", name) is None
                or type(count) is not int
                or not 1 <= count <= 1_000_000
                or (key == "body_aliases" and count != 1)
                for name, count in counts.items()
            )
        ):
            raise ValueError("Malformed parser alias counts")
    framing = value["framing"]
    if framing is not None and (
        not isinstance(framing, dict)
        or set(framing) != {"termination", "final_slot_comma", "source_completeness"}
        or framing["termination"] not in {"explicit_E", "eof_after_comma"}
        or (
            framing["final_slot_comma"] is not None
            and type(framing["final_slot_comma"]) is not bool
        )
        or (framing["termination"] == "eof_after_comma" and framing["final_slot_comma"] is not True)
        or framing["source_completeness"] != "unknown"
    ):
        raise ValueError("Malformed parser framing evidence")
    return value


def _parse_evidence(audit):
    """Keep measured acceptance evidence, excluding raw chart text and invented completeness."""
    token_aliases = Counter()
    for token in audit.get("tokens", []):
        token_aliases.update(set(token.get("dialect_aliases", [])))
    framing = audit.get("framing")
    return _validate_parse_evidence(
        {
            "body_aliases": dict.fromkeys(sorted(set(audit.get("dialect_aliases", []))), 1),
            "token_aliases": dict(sorted(token_aliases.items())),
            "framing": {
                key: framing[key]
                for key in ("termination", "final_slot_comma", "source_completeness")
            }
            if framing is not None
            else None,
        }
    )


def _parse_evidence_summary(rows):
    available, alias_rows = 0, 0
    body, token, charts, framing = Counter(), Counter(), Counter(), Counter()
    for row in rows:
        if row["status"] != "analyzed" or row.get("parse_evidence") is None:
            continue
        evidence = row["parse_evidence"]
        available += 1
        names = set(evidence["body_aliases"]) | set(evidence["token_aliases"])
        alias_rows += bool(names)
        charts.update(names)
        body.update(evidence["body_aliases"])
        token.update(evidence["token_aliases"])
        if evidence["framing"] is not None:
            framing[evidence["framing"]["termination"]] += 1
    return {
        "available_analyzed_rows": available,
        "unavailable_analyzed_rows": sum(row["status"] == "analyzed" for row in rows) - available,
        "charts_with_aliases": alias_rows,
        "alias_chart_counts": dict(sorted(charts.items())),
        "body_alias_counts": dict(sorted(body.items())),
        "token_alias_counts": dict(sorted(token.items())),
        "framing_counts": dict(sorted(framing.items())),
        "source_completeness": "unknown",
        "scope": (
            "Accepted analyzed rows with retained parser audit only; aliases are not chart tags."
        ),
    }


def _identity(row):
    body_hash = _hash(row.get("body_sha256"))
    revision = "sha256:" + body_hash if body_hash else "unavailable"
    identifier = _sha(row["input_id"].encode())[:24]
    song = _text(row.get("source_song_id", row.get("song_id")), row["input_id"], 240)
    return {
        "chart_id": f"evaluation:corpus:{identifier}:{revision[-12:]}",
        "song_id": "evaluation:corpus-song:" + _sha(song.encode())[:24],
        "format": _text(row.get("format")),
        "difficulty": _text(row.get("difficulty")),
        "revision": revision,
    }


def _cache_read(path, key, identity, row, policy):
    envelope = json.loads(_read(path, MAX_CACHE_BYTES))
    if not isinstance(envelope, dict) or set(envelope) != {
        "version",
        "key",
        "outcome_hash",
        "outcome",
    }:
        raise ValueError("Malformed outcome cache")
    outcome = envelope["outcome"]
    if (
        envelope["version"] != VERSION
        or envelope["key"] != key
        or envelope["outcome_hash"] != content_hash(outcome)
    ):
        raise ValueError("Outcome cache identity or hash differs")
    if not isinstance(outcome, dict) or set(outcome) not in (
        {"status", "category", "reason", "profile"},
        {"status", "category", "reason", "profile", "parse_evidence"},
    ):
        raise ValueError("Malformed cached outcome")
    if "parse_evidence" in outcome:
        if outcome["status"] != "analyzed":
            raise ValueError("Rejected chart cannot claim accepted parser evidence")
        _validate_parse_evidence(outcome["parse_evidence"])
    if outcome["status"] == "analyzed":
        if outcome["category"] is not None or outcome["reason"] is not None:
            raise ValueError("Analyzed cache cannot claim an unsupported category")
        validate_profile(
            outcome["profile"],
            {
                **identity,
                "source_hash": row["body_sha256"],
                "registry_hash": policy["registry_hash"],
                "config_hash": policy["config_hash"],
            },
        )
        if outcome["profile"]["source"]["kind"] != SOURCE_KIND:
            raise ValueError("Cached profile lost its research boundary")
    elif outcome["status"] != "unsupported" or outcome["profile"] is not None:
        raise ValueError("Unsupported cached outcome state")
    elif (
        not isinstance(outcome["category"], str)
        or re.fullmatch(r"[a-z_]{1,80}", outcome["category"]) is None
        or not isinstance(outcome["reason"], str)
        or not 1 <= len(outcome["reason"]) <= 512
    ):
        raise ValueError("Invalid cached failure explanation")
    return outcome


def _process(row, root, output, policy, memo, work, resume):
    identity = _identity(row)
    record = {
        **identity,
        "input_id": row["input_id"],
        "title": _text(row.get("title"), row["input_id"]),
        "source_song_id": _text(row.get("source_song_id", row.get("song_id"))),
        "body_sha256": _hash(row.get("body_sha256")),
        "source_raw_sha256": _hash(row.get("source_raw_sha256")),
        "source_url": _text(row.get("source_url"), ""),
        "source_verified": False,
    }
    available = row.get("acquisition_status", row.get("acquisitions_status", "available"))
    outcome = {
        "status": "acquisition_unavailable",
        "category": "acquisition_unavailable",
        "reason": _text(row.get("reason", row.get("unavailable_reason")), "No acquired body"),
        "profile": None,
    }
    if available != "available":
        return record, outcome, None
    try:
        body_bytes = _verify(
            root, row.get("body_file"), row.get("body_sha256"), memo, work, body=True
        )
        _verify(root, row.get("source_raw_file"), row.get("source_raw_sha256"), memo, work)
        if row.get("source_index_file"):
            _verify(root, row["source_index_file"], row.get("source_index_sha256"), memo, work)
        record["source_verified"] = True
    except SourceFailure as error:
        return (
            record,
            {
                "status": "input_failed",
                "category": error.category,
                "reason": str(error),
                "profile": None,
            },
            None,
        )
    if (
        row.get("identity_resolved") is False
        or identity["format"] not in {"STD", "DX"}
        or identity["difficulty"] not in SUPPORTED_DIFFICULTIES
    ):
        if (
            identity["format"] not in {"STD", "DX"}
            or identity["difficulty"] not in SUPPORTED_DIFFICULTIES
        ):
            reason = (
                "Source format/difficulty is outside the supported identity set: "
                f"{identity['format']} / {identity['difficulty']}"
            )
        else:
            reason = "Source variant identity is unresolved"
            detail = _text(row.get("reason"), "")
            if detail and detail != "extracted":
                reason += ": " + detail
        return (
            record,
            {
                "status": "unsupported",
                "category": "unsupported_identity",
                "reason": reason[:512],
                "profile": None,
            },
            None,
        )
    key = content_hash(
        {
            "identity": identity,
            "body_sha256": row["body_sha256"],
            "source_raw_sha256": row["source_raw_sha256"],
            "policy": policy,
        }
    )
    cache_name = f"cache/{key[:2]}/{key}.json"
    cache_path = _destination(output, cache_name)
    if resume and cache_path.is_file():
        try:
            outcome = _cache_read(cache_path, key, identity, row, policy)
            previous_category = outcome["category"]
            if outcome["status"] == "unsupported" and outcome["category"] != "invalid_utf8":
                # Labels evolve independently from parser acceptance. Reclassify verified
                # cached failures without rerunning parsing or successful chart analysis.
                outcome["category"] = _syntax_category(
                    ChartInputError(outcome["reason"]), body_bytes.decode("utf-8")
                )
        except (OSError, ValueError, TypeError, KeyError, RecursionError):
            work["invalid_cache_entries"] += 1
        else:
            if outcome["category"] != previous_category:
                _write(
                    output,
                    cache_name,
                    {
                        "version": VERSION,
                        "key": key,
                        "outcome_hash": content_hash(outcome),
                        "outcome": outcome,
                    },
                )
                work["cached_failure_labels_refreshed"] += 1
            work["cache_hits"] += 1
            return record, outcome, cache_name
    work["cache_misses"] += 1
    try:
        body = body_bytes.decode("utf-8")
    except UnicodeError:
        outcome = {
            "status": "unsupported",
            "category": "invalid_utf8",
            "reason": "Body is not UTF-8 text",
            "profile": None,
        }
    else:
        try:
            work["parser_calls"] += 1
            raw, parse_audit = parse_simai_subset(
                body,
                **identity,
                source={
                    "source_id": "corpus-input:" + _sha(row["input_id"].encode())[:24],
                    "revision": identity["revision"],
                    "kind": SOURCE_KIND,
                    "byte_hash": row["body_sha256"],
                    "identity_status": "reviewed",
                },
            )
        except ChartInputError as error:
            outcome = {
                "status": "unsupported",
                "category": _syntax_category(error, body),
                "reason": str(error)[:512],
                "profile": None,
            }
        else:
            try:
                work["analyzer_calls"] += 1
                profile = analyze(raw)
                validate_profile(profile)
            except (ValueError, TypeError, KeyError, ArithmeticError, RecursionError) as error:
                return (
                    record,
                    {
                        "status": "analysis_failed",
                        "category": "analysis_error",
                        "reason": "Analyzer failed: " + type(error).__name__,
                        "profile": None,
                    },
                    None,
                )
            outcome = {
                "status": "analyzed",
                "category": None,
                "reason": None,
                "profile": profile,
                "parse_evidence": _parse_evidence(parse_audit),
            }
    _write(
        output,
        cache_name,
        {"version": VERSION, "key": key, "outcome_hash": content_hash(outcome), "outcome": outcome},
    )
    return record, outcome, cache_name


def _metadata(record, row):
    if record["format"] not in {"STD", "DX"}:
        return None
    result = {
        key: record[key]
        for key in ("chart_id", "song_id", "format", "difficulty", "revision", "title")
    }
    result.update(
        source_status="use_unresolved",
        identity_status="reviewed" if record["status"] == "analyzed" else "unresolved",
    )
    for key in ("artist", "level"):
        if isinstance(row.get(key), str) and len(row[key]) <= 512:
            result[key] = row[key]
    constant = row.get("constant")
    if type(constant) in (int, float) and 0 < constant < 20:
        result["constant"] = constant
    return result


def _publish_shards(output, batch, registry, shards, locations):
    if not batch:
        return
    metadata = [entry[0] for entry in batch]
    profiles = [entry[1] for entry in batch if entry[1] is not None]
    publication_failure = None
    try:
        pack, manifest = build_evaluation_catalog(
            metadata, profiles, registry, catalog_id=f"corpus-shard-{len(shards):05d}"
        )
        document = build_catalog_html(pack)
        if len(document.encode("utf-8")) > MAX_SHARD_HTML_BYTES:
            raise ValueError("Research browser shard exceeds its byte budget")
    except ValueError as error:
        if len(batch) > 1:
            middle = len(batch) // 2
            _publish_shards(output, batch[:middle], registry, shards, locations)
            _publish_shards(output, batch[middle:], registry, shards, locations)
            return
        publication_failure = (
            "html_byte_limit"
            if str(error) == "Research browser shard exceeds its byte budget"
            else "catalog_validation_rejected"
        )
        pack, manifest = build_evaluation_catalog(
            metadata, [], registry, catalog_id=f"corpus-shard-{len(shards):05d}"
        )
        pack["charts"][0]["coverage"]["summary"] = (
            "Full analysis retained in cache; browser publication unavailable. "
            "See the corpus publication audit."
        )
        manifest["catalog_hash"] = content_hash(pack)
        document = build_catalog_html(pack)
    # Content-addressed files keep the last completed index usable during a rerun.
    name = f"catalogs/shard-{len(shards):05d}-{manifest['catalog_hash']}"
    _write(output, name + ".json", pack)
    _write(output, name + ".manifest.json", manifest)
    atomic_write_text(_destination(output, name + ".html"), document)
    shards.append(
        {
            "catalog_file": name + ".json",
            "html_file": name + ".html",
            "charts": len(metadata),
            "published_profiles": len(manifest["profiles"]),
            "catalog_hash": manifest["catalog_hash"],
            "publication_failure": publication_failure,
        }
    )
    locations.update({entry["chart_id"]: name + ".html" for entry in metadata})


def _neighbor_audit(output, queries, strata, neighbor_limit=5):
    audit = [
        {
            "query": {k: query[k] for k in ("chart_id", "title", "format", "difficulty")},
            "candidates": 0,
            "comparable_candidates": 0,
            "qualifying_matches": 0,
            "nearest_diagnostics": [],
        }
        for query in queries
    ]
    with _destination(output, "descriptor-index.jsonl").open(encoding="utf-8") as stream:
        for line in stream:
            candidate = json.loads(line)
            for query, record in zip(queries, audit, strict=True):
                if candidate["chart_id"] == query["chart_id"]:
                    continue
                record["candidates"] += 1
                match = query_profiles(query, [candidate], limit=1)
                score = (
                    match[0] if match else distance(query["descriptor"], candidate["descriptor"])
                )
                if score is None:
                    continue
                record["comparable_candidates"] += 1
                record["qualifying_matches"] += bool(match)
                record["nearest_diagnostics"].append(
                    {
                        **{key: candidate[key] for key in ("chart_id", "title", "difficulty")},
                        **{key: score[key] for key in ("distance", "coverage", "matched_trigrams")},
                        "qualifies": bool(match),
                        "same_body_hash": candidate["body_sha256"] == query["body_sha256"],
                    }
                )
                record["nearest_diagnostics"].sort(
                    key=lambda item: (item["distance"], item["chart_id"])
                )
                del record["nearest_diagnostics"][neighbor_limit:]
    return {
        "policy_version": POLICY_VERSION,
        "evaluation_only": True,
        "sampling": (
            "One lowest SHA-256 chart ID per format/difficulty stratum; if the sample budget "
            "is smaller than the strata count, strata are chosen by SHA-256. "
            "Each sampled query scans all analyzed candidates once."
        ),
        "available_strata": sorted(strata),
        "sampled_strata": [q["format"] + " / " + q["difficulty"] for q in queries],
        "scope": (
            "Bounded proximity diagnostics, not relevance validation, game fidelity "
            "or recommendations; unsampled queries are not evaluated."
        ),
        "queries": audit,
    }


def _report(summary, shards, rows, locations):
    escape = html.escape
    source_scope = escape(
        summary.get(
            "source_scope",
            "The denominator is the acquired index manifest, not the complete game catalog.",
        )
    )
    capture = summary["source_capture"]
    capture_note = ""
    if capture["partial"]:
        capture_note = (
            '<section class="capture-note"><h2>Partial source capture</h2><p>'
            f"{capture['captured_pages']} of {capture['distinct_linked_pages']} linked source "
            "pages were captured in this snapshot. Unavailable rows can include pages that "
            "have not been captured; these totals do not establish missing-chart coverage.</p>"
        )
        if capture["extracted_bodies"] is not None:
            capture_note += f"<p>{capture['extracted_bodies']} chart bodies were extracted.</p>"
        if capture["capture_stopped_reason"]:
            capture_note += (
                "<p>Capture state: " + escape(capture["capture_stopped_reason"]) + "</p>"
            )
        capture_note += "</section>"
    elif not capture["partial"]:
        counts = []
        if capture.get("captured_containers") is not None:
            counts.append(f"{capture['captured_containers']} chart containers captured")
        captured, linked = capture["captured_pages"], capture["distinct_linked_pages"]
        if captured is not None and linked is not None:
            counts.append(f"{captured} of {linked} linked source pages captured")
        elif captured is not None:
            counts.append(f"{captured} source pages captured")
        elif linked is not None:
            counts.append(f"{linked} linked source pages")
        if capture["extracted_bodies"] is not None:
            counts.append(f"{capture['extracted_bodies']} chart bodies extracted")
        if counts:
            capture_note = '<p class="capture-counts">' + " · ".join(counts) + ".</p>"
    categories = "".join(
        f"<tr><th>{escape(key)}</th><td>{value}</td></tr>"
        for key, value in summary["failure_categories"].items()
    )
    groups = summary.get("diagnostic_groups")
    if groups is None:
        groups = Counter(_diagnostic_group(row) for row in rows)
        if not rows:
            for category, count in summary["failure_categories"].items():
                groups[
                    _diagnostic_group(
                        {
                            "status": "acquisition_unavailable"
                            if category == "acquisition_unavailable"
                            else "unsupported",
                            "category": category,
                        }
                    )
                ] += count
    diagnostic_rows = "".join(
        f"<tr><th>{escape(DIAGNOSTIC_LABELS.get(key, key))}</th><td>{value}</td></tr>"
        for key, value in sorted(groups.items())
        if key != "analyzed"
    )
    acceptance = summary.get("parse_acceptance_evidence")
    acceptance_html = ""
    if acceptance is not None:
        alias_items = "".join(
            f"<li>{escape(name.replace('_', ' '))}: {count} charts</li>"
            for name, count in acceptance["alias_chart_counts"].items()
        )
        framing_labels = {
            "explicit_E": "Written E marker",
            "eof_after_comma": "EOF after a complete comma-ended slot",
        }
        framing_items = "".join(
            f"<li>{framing_labels[name]}: {count} charts</li>"
            for name, count in acceptance["framing_counts"].items()
        )
        acceptance_html = (
            '<details id="acceptance-evidence">'
            "<summary>Accepted compatibility and framing</summary>"
            f"<p>Parser audit retained for {acceptance['available_analyzed_rows']} analyzed rows; "
            f"{acceptance['unavailable_analyzed_rows']} have no retained audit. "
            f"{acceptance['charts_with_aliases']} used recorded compatibility aliases.</p>"
            f"<ul>{alias_items}{framing_items}</ul>"
            "<p>Alias counts describe parser acceptance, not chart tags. "
            "Written E and accepted EOF "
            "do not establish source completeness or game fidelity.</p></details>"
        )
    difficulty = "".join(
        f"<tr><th>{escape(key)}</th><td>{value['rows']}</td><td>{value['analyzed']}</td></tr>"
        for key, value in summary["difficulty_coverage"].items()
    )
    links = "".join(
        f'<li><a href="{entry["html_file"]}">Browse chunk {index + 1}</a>'
        f" · {entry['charts']} rows</li>"
        for index, entry in enumerate(shards)
    )
    compact = [
        [
            row["title"],
            row["format"],
            row["difficulty"],
            row["status"],
            row["category"] or "",
            row["reason"] or "",
            locations.get(row["chart_id"], ""),
            DIAGNOSTIC_LABELS[_diagnostic_group(row)],
            (
                "Accepted aliases: "
                + ", ".join(
                    sorted(
                        set(row["parse_evidence"]["body_aliases"])
                        | set(row["parse_evidence"]["token_aliases"])
                    )
                )
                if row.get("parse_evidence")
                and (
                    row["parse_evidence"]["body_aliases"] or row["parse_evidence"]["token_aliases"]
                )
                else ""
            ),
        ]
        for row in rows
    ]
    data = json.dumps(compact, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
    script = """
const rows=JSON.parse(document.getElementById('outcomes').textContent);
const search=document.getElementById('search'), status=document.getElementById('status');
const format=document.getElementById('format'), difficulty=document.getElementById('difficulty');
const category=document.getElementById('category'), tbody=document.getElementById('rows');
const diagnostic=document.getElementById('diagnostic');
const filters=[[status,3],[format,1],[difficulty,2],[category,4],[diagnostic,7]];
for(const [select,index] of filters){
  for(const value of [...new Set(rows.map(row=>row[index]).filter(Boolean))].sort()){
    const option=document.createElement('option');option.value=value;option.textContent=value;
    select.append(option);
  }
}
let page=0;const size=100;
function render(){
  const term=search.value.trim().toLocaleLowerCase();
  const matches=rows.filter(row=>(!term||[...row.slice(0,6),row[7],row[8]].join(' ')
    .toLocaleLowerCase().includes(term))
    &&filters.every(([select,index])=>!select.value||row[index]===select.value));
  const max=Math.max(0,Math.ceil(matches.length/size)-1);page=Math.min(page,max);
  document.getElementById('count').textContent=`${matches.length} matching rows · page ${page+1}`;
  document.getElementById('previous').disabled=page===0;
  document.getElementById('next').disabled=page===max;tbody.replaceChildren();
  for(const row of matches.slice(page*size,(page+1)*size)){
    const tr=document.createElement('tr');
    for(const value of [row[0],`${row[1]} ${row[2]}`,row[7]]){
      const td=document.createElement('td');td.textContent=value;tr.append(td);
    }
    const explanation=document.createElement('td');
    if(row[5]||row[8]){
      const details=document.createElement('details'), summary=document.createElement('summary');
      summary.textContent='Details';details.append(summary);
      for(const value of [row[5],row[4],row[8]].filter(Boolean)){
        const p=document.createElement('p');p.textContent=value;details.append(p);
      }
      explanation.append(details);
    }else explanation.textContent='—';tr.append(explanation);
    const td=document.createElement('td');
    if(row[6]){const a=document.createElement('a');a.href=row[6];
      a.textContent='Browse';td.append(a);}
    else td.textContent='Identity unavailable';tr.append(td);tbody.append(tr);
  }
}
for(const element of [search,...filters.map(pair=>pair[0])]){
  element.addEventListener('input',()=>{page=0;render();});
}
document.getElementById('previous').addEventListener('click',()=>{page--;render();});
document.getElementById('next').addEventListener('click',()=>{page++;render();});render();
"""
    return f"""<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy"
content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>Simai corpus audit</title><style>
*{{box-sizing:border-box}}
body{{font:16px/1.5 system-ui;margin:24px auto;padding:0 16px;
max-width:960px;color:#193e49;background:#f3f8fa;overflow-wrap:anywhere}}
table{{border-collapse:collapse;width:100%}}
th,td{{text-align:left;vertical-align:top;padding:8px;border-bottom:1px solid #ccdce0;
overflow-wrap:anywhere}}a{{color:#006f81}}
section{{margin:24px 0;padding:18px;background:white;border-radius:12px}}li{{margin:6px 0}}
.capture-note{{border:2px solid #8a6700;background:#fff8dd}}
.scroll{{overflow:auto;max-width:100%}}
.scroll:focus-visible{{outline:3px solid #006f81;outline-offset:3px}}
.summary-table td,.summary-table thead th:not(:first-child){{white-space:nowrap;text-align:right}}
.outcome-table{{min-width:640px}}input,select,button{{font:inherit;padding:8px;max-width:100%}}
input,select{{min-width:0;width:100%}}
.filters{{display:flex;flex-wrap:wrap;gap:10px}}
label{{display:grid;gap:4px;min-width:0;max-width:100%}}</style>
<main>
<h1>{escape(summary.get("source_label", "Public transcription corpus audit"))}</h1>
{capture_note}
<p>{escape(summary.get("snapshot_id", ""))}</p>
<p>{summary["rows"]} advertised manifest rows · {summary["analyzed"]} analyzed ·
{summary["rows"] - summary["analyzed"]} not analyzed.</p>
<p>Game fidelity, geometry, community-pattern accuracy and recommendation usefulness
remain unverified.
{source_scope}</p>
<section><h2 id="difficulty-heading">Difficulty coverage</h2>
<div class="scroll" tabindex="0" role="region" aria-labelledby="difficulty-heading">
<table class="summary-table"><thead><tr><th>Format / difficulty</th><th>Rows</th>
<th>Analyzed</th></tr></thead><tbody>{difficulty}</tbody></table></div></section>
<section><h2 id="failure-heading">Why rows were not analyzed</h2>
<p>A rejected body is not automatically invalid. Counts identify the first observed blocker;
they are not a complete inventory of unsupported syntax.</p>
<div class="scroll" tabindex="0" role="region" aria-labelledby="failure-heading">
<table class="summary-table"><thead><tr><th>Outcome</th><th>Rows</th></tr></thead>
<tbody>{diagnostic_rows}</tbody></table>
<details><summary>First-error categories</summary>
<table class="summary-table"><thead><tr><th>Recorded category</th><th>Rows</th></tr></thead>
<tbody>{categories}</tbody></table></details></div>{acceptance_html}</section>
<section><h2 id="outcome-heading">Find an outcome</h2><div class="filters">
<label>Title or reason<input id="search" type="search"></label>
<label>Status<select id="status"><option value="">All</option></select></label>
<label>Outcome<select id="diagnostic"><option value="">All</option></select></label>
<label>Format<select id="format"><option value="">All</option></select></label>
<label>Difficulty<select id="difficulty"><option value="">All</option></select></label>
<label>Failure category<select id="category"><option value="">All</option></select></label></div>
<p id="count" aria-live="polite"></p>
<div class="scroll" tabindex="0" role="region" aria-labelledby="outcome-heading">
<table class="outcome-table">
<thead><tr><th>Title</th><th>Chart</th><th>Outcome</th><th>Details</th><th>Catalog</th></tr></thead>
<tbody id="rows"></tbody></table></div><p><button id="previous">Previous</button>
<button id="next">Next</button></p><noscript>Every outcome is also in results.jsonl.</noscript>
</section><section><h2>Research catalogs</h2>
<p>Each link browses one bounded chunk. Its Similar charts search covers that chunk only.
The sampled neighbor audit scans all analyzed corpus charts for each sampled query.</p>
<ul>{links}</ul></section>
<p><a href="summary.json">Aggregate evidence</a> · <a href="results.jsonl">Every input outcome</a> ·
<a href="work-audit.json">Work and cache audit</a> ·
<a href="neighbor-audit.json">Sampled neighbors</a></p>
<p><a href="run-state.json">Run state</a> must say complete for the latest invocation.
An interrupted rerun retains this last completed index and its content-addressed chunks.</p>
</main>
<script id="outcomes" type="application/json">{data}</script><script>{script}</script></html>"""


def process_corpus(
    manifest_path, output_dir, *, sample_queries=8, shard_size=128, resume=True, progress=False
):
    if (
        type(sample_queries) is not int
        or not 0 <= sample_queries <= 32
        or type(shard_size) is not int
        or not 1 <= shard_size <= 256
    ):
        raise ValueError("Sample query count must be 0–32; shard size must be 1–256")
    started = time.monotonic()
    output = Path(output_dir).resolve()
    root, manifest, rows, manifest_hash = _load(manifest_path, output)
    source_capture = _source_capture(manifest, len(rows))
    _write(output, "run-state.json", {"status": "in_progress", "manifest_sha256": manifest_hash})
    policy, registry, work, memo = _policy(), pattern_registry(), Counter(), {}
    statuses, categories, acquisition_reasons = Counter(), Counter(), Counter()
    difficulties = defaultdict(Counter)
    tags = {entry["pattern_id"]: Counter() for entry in registry["entries"]}
    shards, batch, batch_bytes, representatives = [], [], 0, {}
    display_rows, locations = [], {}
    with (
        _lines(output, "results.jsonl") as results_stream,
        _lines(output, "descriptor-index.jsonl") as descriptor_stream,
    ):
        for index, row in enumerate(rows):
            record, outcome, cache_name = _process(row, root, output, policy, memo, work, resume)
            profile = outcome["profile"]
            record.update({key: outcome[key] for key in ("status", "category", "reason")})
            record["diagnostic_group"] = _diagnostic_group(outcome)
            record["parse_evidence"] = outcome.get("parse_evidence")
            record["cache_file"] = cache_name
            record["profile_hash"] = content_hash(profile) if profile else None
            statuses[record["status"]] += 1
            if record["category"]:
                categories[record["category"]] += 1
            if record["status"] == "acquisition_unavailable":
                acquisition_reasons[record["reason"]] += 1
            difficulty = difficulties[record["format"] + " / " + record["difficulty"]]
            difficulty["rows"] += 1
            difficulty[record["status"]] += 1
            meta = _metadata(record, row)
            record["catalog_identity_supported"] = meta is not None
            results_stream.write(canonical_bytes(record).decode("utf-8"))
            display_rows.append(record)
            profile_bytes = 0
            if profile:
                profile_bytes = len(canonical_bytes(profile))
                descriptor = {
                    key: record[key]
                    for key in ("chart_id", "title", "format", "difficulty", "body_sha256")
                }
                descriptor.update(
                    descriptor=compact_descriptor(profile["descriptor"]), metrics=profile["metrics"]
                )
                descriptor_stream.write(canonical_bytes(descriptor).decode("utf-8"))
                stratum = record["format"] + " / " + record["difficulty"]
                previous = representatives.get(stratum)
                if previous is None or _sha(descriptor["chart_id"].encode()) < _sha(
                    previous["chart_id"].encode()
                ):
                    representatives[stratum] = descriptor
                for tag in profile["tags"]:
                    counts = tags[tag["pattern_id"]]
                    counts[tag["status"]] += 1
                    if tag["status"] == "detected":
                        counts["occurrences"] += tag["occurrence_count"]
            if meta:
                if batch and (
                    len(batch) >= shard_size
                    or batch_bytes + profile_bytes > MAX_SHARD_PROFILE_BYTES
                ):
                    _publish_shards(output, batch, registry, shards, locations)
                    batch, batch_bytes = [], 0
                batch.append((meta, profile))
                batch_bytes += profile_bytes
            if progress and (index + 1) % 25 == 0:
                print(
                    json.dumps(
                        {
                            "processed": index + 1,
                            "rows": len(rows),
                            "analyzed": statuses["analyzed"],
                            "cache_hits": work["cache_hits"],
                        }
                    ),
                    flush=True,
                )
    _publish_shards(output, batch, registry, shards, locations)
    sampled_strata = sorted(representatives, key=lambda key: _sha(key.encode()))[:sample_queries]
    queries = [representatives[key] for key in sampled_strata]
    neighbors = _neighbor_audit(output, queries, representatives)
    summary = {
        "version": VERSION,
        "evaluation_only": True,
        "source_kind": SOURCE_KIND,
        "snapshot_id": _text(manifest.get("snapshot_id")),
        "source_label": _text(manifest.get("source_label"), "Public transcription corpus audit"),
        "source_scope": _text(
            manifest.get("source_scope"),
            "The denominator is the acquired index manifest, not the complete game catalog.",
        ),
        "source_capture": source_capture,
        "manifest_sha256": manifest_hash,
        "policy": policy,
        "rows": len(rows),
        "analyzed": statuses["analyzed"],
        "statuses": dict(sorted(statuses.items())),
        "failure_categories": dict(sorted(categories.items())),
        "acquisition_unavailable_reasons": dict(sorted(acquisition_reasons.items())),
        "parser_failure_scope": "First strict-parser rejection only; not a full syntax inventory.",
        "failure_classification_version": FAILURE_CLASSIFICATION_VERSION,
        "diagnostic_classification_version": DIAGNOSTIC_CLASSIFICATION_VERSION,
        "diagnostic_groups": dict(
            sorted(Counter(row["diagnostic_group"] for row in display_rows).items())
        ),
        "parse_acceptance_evidence": _parse_evidence_summary(display_rows),
        "difficulty_coverage": {
            key: {"analyzed": 0, **dict(value)} for key, value in sorted(difficulties.items())
        },
        "tag_distribution": {
            key: dict(sorted(value.items())) for key, value in sorted(tags.items())
        },
        "tag_distribution_denominator": (
            "Analyzed profiles only. Unavailable or unsupported rows have no asserted tag absence."
        ),
        "catalog_shards": shards,
        "published_profiles": sum(shard["published_profiles"] for shard in shards),
        "game_identity": "unverified",
        "reviewed_named_patterns": 0,
        "scope": (
            "Every advertised manifest row; unavailable acquisitions remain in the denominator. "
            "Experimental project detections only."
        ),
    }
    _write(output, "neighbor-audit.json", neighbors)
    _write(output, "summary.json", summary)
    _write(
        output,
        "work-audit.json",
        {
            "version": VERSION,
            "manifest_sha256": manifest_hash,
            "failure_classification_version": FAILURE_CLASSIFICATION_VERSION,
            "work": dict(work),
            "elapsed_seconds": round(time.monotonic() - started, 3),
            "resumability": (
                "Atomic per-input cache outcomes; aggregate files replace atomically. "
                "Hash failures retry on every run."
            ),
        },
    )
    atomic_write_text(
        _destination(output, "index.html"), _report(summary, shards, display_rows, locations)
    )
    _write(output, "run-state.json", {"status": "complete", "manifest_sha256": manifest_hash})
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--sample-queries", type=int, default=8)
    parser.add_argument("--shard-size", type=int, default=128)
    parser.add_argument("--no-resume", action="store_true")
    args = parser.parse_args(argv)
    summary = process_corpus(
        args.manifest,
        args.output_dir,
        sample_queries=args.sample_queries,
        shard_size=args.shard_size,
        resume=not args.no_resume,
        progress=True,
    )
    print(
        json.dumps(
            {
                "rows": summary["rows"],
                "analyzed": summary["analyzed"],
                "statuses": summary["statuses"],
                "shards": len(summary["catalog_shards"]),
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
