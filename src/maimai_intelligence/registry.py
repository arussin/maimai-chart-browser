"""Persistent inventory and evidence ledger, independent of transcription availability.

Only explicit acceptance functions change identity. Normalized metadata is a
candidate lookup, never an ID or an implicit provider mapping authorization.
"""

from __future__ import annotations

import hashlib
import json
import re
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from .identity_policy import normalized
from .metadata_policy import BUILTIN_CONTEXT, PolicyContext
from .snapshots import MAX_BYTES, atomic_json, canonical, read_json

VERSION = "maimai-registry-1"
TABLES = ("songs", "charts", "observations", "mappings", "legacy-ids", "sources")
DIFFICULTIES = {"BASIC", "ADVANCED", "EXPERT", "MASTER", "RE:MASTER"}
STATES = {"available", "missing", "unreviewed", "ambiguous", "unsupported", "not_prepared"}


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def new_id(kind):
    return kind + ":" + str(uuid4())


def empty():
    return {"schema_version": VERSION, **{key: {} for key in TABLES}}


def _id(value, kind):
    try:
        return (
            value.startswith(kind + ":")
            and str(UUID(value.split(":", 1)[1])) == value[len(kind) + 1 :]
        )
    except (ValueError, AttributeError):
        return False


def validate(value, *, policy_context: PolicyContext = BUILTIN_CONTEXT):
    if value.get("schema_version") != VERSION or set(value) != {"schema_version", *TABLES}:
        raise ValueError("Unsupported registry schema")
    if any(not isinstance(value[key], dict) for key in TABLES):
        raise ValueError("Invalid registry tables")
    slots = set()
    for sid, song in value["songs"].items():
        if not _id(sid, "song") or song.get("song_id") != sid or not song.get("evidence"):
            raise ValueError("Invalid accepted song identity")
        if song.get("redirect") and song["redirect"] not in value["songs"]:
            raise ValueError("Unknown song redirect")
    for cid, chart in value["charts"].items():
        slot = (
            chart.get("song_id"),
            chart.get("format"),
            chart.get("difficulty"),
            chart.get("variant_id"),
        )
        if (
            not _id(cid, "chart")
            or chart.get("chart_id") != cid
            or slot[0] not in value["songs"]
            or slot[1] not in {"STD", "DX"}
            or slot[2] not in DIFFICULTIES
            or not slot[3]
            or not chart.get("evidence")
            or (not chart.get("redirect") and slot in slots)
        ):
            raise ValueError("Invalid or duplicate accepted chart variant")
        if chart.get("redirect"):
            if chart["redirect"] not in value["charts"]:
                raise ValueError("Unknown chart redirect")
        else:
            slots.add(slot)
    for kind in ("songs", "charts"):
        for key in value[kind]:
            seen = set()
            while value[kind][key].get("redirect"):
                if key in seen:
                    raise ValueError("Registry redirect cycle")
                seen.add(key)
                key = value[kind][key]["redirect"]
    subjects = value["songs"].keys() | value["charts"].keys()
    source_counts = {}
    policies = policy_context.policies
    for oid, observation in value["observations"].items():
        if (
            observation.get("subject_id") not in subjects
            or observation.get("snapshot_id") not in value["sources"]
            or observation.get("region") not in {None, "JP", "INTL"}
            or observation.get("observation_id") != oid
        ):
            raise ValueError("Orphaned registry observation")
        counts = source_counts.setdefault(observation["snapshot_id"], {})
        counts[observation["field"]] = counts.get(observation["field"], 0) + 1
        if observation.get("policy") == "metadata-waterfall-1":
            from .metadata_policy import FIELDS, number

            provider = value["sources"][observation["snapshot_id"]].get("provider")
            if (
                provider not in policies
                or observation["field"] not in FIELDS
                or observation.get("priority") != policies[provider].priority
                or number(observation["value"], observation["field"]) is None
                or observation["subject_id"] not in value["charts"]
                or not observation.get("evidence")
            ):
                raise ValueError("Invalid supplemental metadata observation")
        if observation["field"] == "listing":
            if observation["value"] not in {
                "listed",
                "not_observed_in_latest_capture",
                "announced",
                "removed",
                "unknown",
            }:
                raise ValueError("Unknown listing observation state")
            if observation["value"] in {"removed", "announced"} and (
                value["sources"][observation["snapshot_id"]].get("provider") != "sega-notice"
                or not observation.get("evidence")
                or not observation.get("effective_date")
            ):
                raise ValueError(
                    "Removal and announcement require explicit dated official notice evidence"
                )
    from .official_contract import PARSER, URLS

    for source_id, source in value["sources"].items():
        binding = policy_context.binding(source.get("provider", ""))
        if binding is not None and (
            source.get("parser") != binding.parser_revision or source.get("url") != binding.url
        ):
            raise ValueError("Supplemental source parser revision or URL differs")
        if source.get("provider") not in {"sega-jp", "sega-intl"}:
            continue
        region = source.get("region")
        if (
            region not in URLS
            or source.get("url") != URLS[region]
            or source.get("parser") != PARSER
            or source.get("snapshot_id") != source_id
            or source.get("acquisition") != "complete_validated_capture"
            or not re.fullmatch(r"[0-9a-f]{64}", source.get("sha256", ""))
            or source_counts.get(source_id, {}).get("metadata", 0) != source.get("ordinary_rows")
            or source_counts.get(source_id, {}).get("level", 0) != source.get("chart_slots")
        ):
            raise ValueError("Incomplete or inconsistent accepted official snapshot")
        if datetime.fromisoformat(source["captured_at"].replace("Z", "+00:00")).tzinfo is None:
            raise ValueError("Official observation time requires a timezone")
    foreign = set()
    for mapping in value["mappings"].values():
        key = (mapping.get("provider"), mapping.get("game"), mapping.get("provider_id"))
        if mapping.get("state") not in {"accepted", "candidate", "rejected"}:
            raise ValueError("Unknown mapping state")
        if mapping["state"] != "accepted":
            continue
        if (
            mapping.get("subject_id") not in subjects
            or key in foreign
            or not mapping.get("evidence")
            or not mapping.get("acceptance_basis")
            or mapping.get("snapshot_id") not in value["sources"]
        ):
            raise ValueError("Invalid or conflicting accepted mapping")
        foreign.add(key)
        chart = value["charts"].get(mapping["subject_id"])
        if chart and (mapping.get("format"), mapping.get("difficulty")) != (
            chart["format"],
            chart["difficulty"],
        ):
            raise ValueError("Provider mapping changes chart variant")
    for release in value["legacy-ids"].values():
        for identity in release.values():
            if identity.get("chart_id") not in value["charts"] or not re.fullmatch(
                r"[0-9a-f]{64}", identity.get("source_hash", "")
            ):
                raise ValueError("Invalid legacy chart identity")
    from .enrichment import validate_enrichment

    return validate_enrichment(value)


def read_registry(
    directory: Path | str, *, policy_context: PolicyContext = BUILTIN_CONTEXT
) -> dict[str, Any]:
    root = Path(directory).resolve()
    manifest = read_json(root / "manifest.json")
    if manifest.get("schema_version") != VERSION or set(manifest.get("files", {})) != set(TABLES):
        raise ValueError("Incomplete registry manifest")
    result = {"schema_version": VERSION}
    for table, ref in manifest["files"].items():
        if (
            ref.get("path") != table + ".json"
            or type(ref.get("bytes")) is not int
            or not 0 < ref["bytes"] <= MAX_BYTES
        ):
            raise ValueError("Invalid registry reference")
        path = (root / ref["path"]).resolve()
        if path.parent != root:
            raise ValueError("Registry reference leaves its directory")
        with path.open("rb") as stream:
            raw = stream.read(ref["bytes"] + 1)
        if len(raw) != ref["bytes"] or hashlib.sha256(raw).hexdigest() != ref.get("sha256"):
            raise ValueError("Registry integrity mismatch")
        result[table] = json.loads(raw)
    return validate(result, policy_context=policy_context)


def write_registry(
    value: dict[str, Any], directory: Path | str, *, policy_context: PolicyContext = BUILTIN_CONTEXT
) -> None:
    """Write a fresh candidate. Existing registries are never partially overwritten."""
    validate(value, policy_context=policy_context)
    root = Path(directory)
    if root.exists() and any(root.iterdir()):
        raise ValueError("Use a fresh registry destination")
    entries = {}
    for table in TABLES:
        raw = canonical(value[table]) + b"\n"
        if len(raw) > MAX_BYTES:
            raise ValueError("Registry table exceeds its byte budget")
        entries[table] = {
            "path": table + ".json",
            "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
        }
    for table in TABLES:
        atomic_json(root / (table + ".json"), value[table])
    atomic_json(root / "manifest.json", {"schema_version": VERSION, "files": entries})
    return root


def resolve(value, subject):
    table = value["charts"] if subject.startswith("chart:") else value["songs"]
    while table[subject].get("redirect"):
        subject = table[subject]["redirect"]
    return subject


def accept_mapping(
    value,
    *,
    provider,
    provider_id,
    subject_id,
    snapshot_id,
    evidence,
    acceptance_basis="reviewed",
    game="maimaidx",
    **metadata,
):
    if not evidence or snapshot_id not in value["sources"]:
        raise ValueError("Mapping acceptance requires captured evidence")
    key = digest([provider, game, provider_id])
    old = value["mappings"].get(key)
    if (
        old
        and old["state"] == "accepted"
        and resolve(value, old["subject_id"]) != resolve(value, subject_id)
    ):
        raise ValueError("Accepted provider identity cannot be silently redirected")
    row = {
        "provider": provider,
        "game": game,
        "provider_id": provider_id,
        "subject_id": subject_id,
        "snapshot_id": snapshot_id,
        "evidence": evidence,
        "acceptance_basis": acceptance_basis,
        "state": "accepted",
        **metadata,
    }
    if subject_id in value["charts"]:
        chart = value["charts"][subject_id]
        row.update(format=chart["format"], difficulty=chart["difficulty"])
    value["mappings"][key] = row


def source_mapping(value, provider, provider_id):
    mapping = value["mappings"].get(digest([provider, "maimaidx", provider_id]))
    return (
        resolve(value, mapping["subject_id"])
        if mapping and mapping["state"] == "accepted"
        else None
    )


def admit_song(value, metadata, *, evidence, basis):
    sid = new_id("song")
    value["songs"][sid] = {
        "song_id": sid,
        "metadata": deepcopy(metadata),
        "evidence": evidence,
        "acceptance_basis": basis,
        "status": "accepted",
    }
    return sid


def admit_chart(value, song_id, format_, difficulty, *, evidence, variant_id="ordinary"):
    song_id = resolve(value, song_id)
    for chart in value["charts"].values():
        if not chart.get("redirect") and (
            chart["song_id"],
            chart["format"],
            chart["difficulty"],
            chart["variant_id"],
        ) == (song_id, format_, difficulty, variant_id):
            return chart["chart_id"]
    cid = new_id("chart")
    value["charts"][cid] = {
        "chart_id": cid,
        "song_id": song_id,
        "format": format_,
        "difficulty": difficulty,
        "variant_id": variant_id,
        "evidence": evidence,
    }
    return cid


def merge_songs(value, source, target, *, evidence):
    """Reviewed correction only; conflicting chart slots require their own decision."""
    source, target = resolve(value, source), resolve(value, target)
    if source == target:
        return
    if not evidence:
        raise ValueError("Song merge needs review evidence")
    left = [c for c in value["charts"].values() if c["song_id"] == source and not c.get("redirect")]
    right = {
        (c["format"], c["difficulty"], c["variant_id"])
        for c in value["charts"].values()
        if c["song_id"] == target and not c.get("redirect")
    }
    if any((c["format"], c["difficulty"], c["variant_id"]) in right for c in left):
        raise ValueError("Overlapping chart identities require explicit chart reconciliation")
    for chart in left:
        chart["song_id"] = target
    value["songs"][source].update(redirect=target, redirect_evidence=evidence)


def analysis_fingerprint(row, implementation, *, parser, analyzer):
    """Metadata-free key; full container hash conservatively includes timing context."""
    if not row.get("body_sha256") or not row.get("source_raw_sha256"):
        raise ValueError("Analysis needs body and container context hashes")
    return digest(
        {
            "schema": "analysis-input-2",
            "input_id": row.get("input_id"),
            "body": row["body_sha256"],
            "container": row["source_raw_sha256"],
            "start": row.get("body_byte_start"),
            "end": row.get("body_byte_end"),
            "format": row["format"],
            "difficulty": row["difficulty"],
            "parser": parser,
            "analyzer": analyzer,
            "implementation": implementation,
        }
    )


def select_transcription(
    value,
    chart_id,
    row,
    *,
    snapshot_id,
    evidence,
    legacy_chart_id,
    analysis_state="not_prepared",
    provider="neskol-input",
    acceptance_basis="reviewed",
):
    """Select a reviewed source revision while keeping the persistent chart identity."""
    chart_id = resolve(value, chart_id)
    chart = value["charts"][chart_id]
    if (row.get("format"), row.get("difficulty")) != (chart["format"], chart["difficulty"]):
        raise ValueError("Transcription selection changes chart variant")
    if not evidence or snapshot_id not in value["sources"] or analysis_state not in STATES:
        raise ValueError("Transcription selection needs accepted provenance and explicit state")
    if not re.fullmatch(r"[0-9a-f]{64}", row.get("body_sha256", "")) or not re.fullmatch(
        r"[0-9a-f]{64}", row.get("source_raw_sha256", "")
    ):
        raise ValueError("Transcription selection needs body and container hashes")
    history = chart.setdefault("transcription_history", {})
    if chart.get("transcription"):
        history[digest(chart["transcription"])] = deepcopy(chart["transcription"])
    selected = {
        "legacy_chart_id": legacy_chart_id,
        "source_hash": row["body_sha256"],
        "container_hash": row["source_raw_sha256"],
        "snapshot_id": snapshot_id,
        "input_id": row["input_id"],
        "context": {k: row[k] for k in ("body_byte_start", "body_byte_end") if k in row},
        "evidence": evidence,
    }
    chart["transcription"] = selected
    chart["analysis_state"] = analysis_state
    from maimai_analyzer.catalog_navigation import source_constant

    chart["source_metadata"] = {
        "chart_constant": source_constant(row.get("source_level")),
        "source_path": row.get("source_path"),
        "bpm": None,
    }
    history[digest(selected)] = deepcopy(selected)
    accept_mapping(
        value,
        provider=provider,
        acceptance_basis=acceptance_basis,
        provider_id=row["input_id"],
        subject_id=chart_id,
        snapshot_id=snapshot_id,
        evidence=evidence,
        assertion={k: row[k] for k in ("title", "artist", "format", "difficulty")},
    )
    value["legacy-ids"].setdefault(snapshot_id, {})[legacy_chart_id] = {
        "chart_id": chart_id,
        "song_id": chart["song_id"],
        "source_hash": row["body_sha256"],
    }
    return chart_id


def bootstrap(value, data, release, *, source_inventory=(), select_current=False):
    """Import verified accepted release identities without reclassifying past review."""
    result = deepcopy(value)
    snapshot = "legacy:" + digest(data)
    result["sources"][snapshot] = {
        "provider": "legacy_published",
        "revision": release,
        "sha256": digest(data),
        "acquisition": "verified_retained_release",
    }
    rows = {row["input_id"]: row for row in source_inventory}
    by_song = {}
    for old_release in result["legacy-ids"].values():
        for old in old_release.values():
            by_song[old["song_id"]] = result["charts"][resolve(result, old["chart_id"])]["song_id"]
    aliases = result["legacy-ids"].setdefault(release, {})
    for profile in data["catalog"]:
        if profile.get("version") != "challenge-profile-1-experimental" or not profile.get(
            "source_hash"
        ):
            raise ValueError("Bootstrap requires genuine accepted legacy profiles")
        sid = by_song.get(profile["song_id"])
        if sid is None:
            sid = admit_song(
                result,
                {k: deepcopy(profile[k]) for k in ("title", "artist", "aliases") if k in profile},
                evidence=snapshot,
                basis="reviewed_supplement",
            )
            by_song[profile["song_id"]] = sid
        cid = source_mapping(result, "neskol-input", profile.get("input_id", profile["chart_id"]))
        if cid is None:
            cid = admit_chart(
                result, sid, profile["format"], profile["difficulty"], evidence=snapshot
            )
        legacy = {
            "chart_id": cid,
            "source_hash": profile["source_hash"],
            "song_id": profile["song_id"],
        }
        if profile["chart_id"] in aliases and aliases[profile["chart_id"]] != legacy:
            raise ValueError("Legacy release identity changed")
        aliases[profile["chart_id"]] = legacy
        chart = result["charts"][cid]
        # Bootstrap order is historical -> current. Only explicit bootstrap selects a revision.
        row = rows.get(profile.get("input_id"), {})
        selected_transcription = {
            "legacy_chart_id": profile["chart_id"],
            "source_hash": profile["source_hash"],
            "container_hash": row.get("source_raw_sha256"),
            "snapshot_id": snapshot,
            "input_id": profile.get("input_id"),
            "context": {k: row[k] for k in ("body_byte_start", "body_byte_end") if k in row},
        }
        if select_current or "transcription" not in chart:
            chart["transcription"] = selected_transcription
            chart["legacy_level"] = profile.get("level")
        navigation = data.get("navigation", {}).get("charts", {}).get(profile["chart_id"], {})
        if (select_current or "source_metadata" not in chart) and navigation.get(
            "source_hash"
        ) == profile["source_hash"]:
            chart["source_metadata"] = {
                k: deepcopy(navigation[k])
                for k in ("bpm", "chart_constant", "source_path", "genre", "version")
                if k in navigation
            }
        if not select_current and source_mapping(
            result, "neskol-input", profile.get("input_id", profile["chart_id"])
        ):
            continue
        accept_mapping(
            result,
            provider="neskol-input",
            provider_id=profile.get("input_id", profile["chart_id"]),
            subject_id=cid,
            snapshot_id=snapshot,
            evidence="Accepted retained release " + release,
            acceptance_basis="legacy_published",
        )
    for pid, row in data.get("provider_mapping", {}).get("charts", {}).items():
        if source_mapping(result, "kamaitachi", pid) and not select_current:
            continue
        if row["chart_id"] in aliases and aliases[row["chart_id"]]["source_hash"] == row.get(
            "source_hash"
        ):
            accept_mapping(
                result,
                provider="kamaitachi",
                provider_id=pid,
                subject_id=aliases[row["chart_id"]]["chart_id"],
                snapshot_id=snapshot,
                evidence="Published mapping in " + release,
                acceptance_basis="legacy_published",
                metadata=deepcopy(row),
                method=row.get("method", "published"),
            )
    for old, row in data.get("mai_notes", {}).get("charts", {}).items():
        if source_mapping(result, "mai-notes", row["id"]) and not select_current:
            continue
        if old in aliases and aliases[old]["source_hash"] == row.get("source_hash"):
            accept_mapping(
                result,
                provider="mai-notes",
                provider_id=row["id"],
                subject_id=aliases[old]["chart_id"],
                snapshot_id=snapshot,
                evidence="Published player link in " + release,
                acceptance_basis="legacy_published",
                metadata=deepcopy(data["mai_notes"] | {"charts": {}}),
                available=True,
            )
    return validate(result)


def metadata_candidates(value, title, artist):
    key = (normalized(title), normalized(artist))
    return sorted(
        sid
        for sid, song in value["songs"].items()
        if not song.get("redirect")
        and (normalized(song["metadata"].get("title")), normalized(song["metadata"].get("artist")))
        == key
    )
