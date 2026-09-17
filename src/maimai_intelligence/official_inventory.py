"""Bounded, regional SEGA listing captures and explicitly reviewed reconciliation."""

import hashlib
import json
import re
import urllib.request
from collections import Counter
from copy import deepcopy
from datetime import UTC, datetime

from .registry import (
    accept_mapping,
    admit_chart,
    admit_song,
    digest,
    metadata_candidates,
    resolve,
    source_mapping,
    validate,
)

URLS = {
    "JP": "https://maimai.sega.jp/data/maimai_songs.json",
    "INTL": "https://maimai.sega.com/assets/data/maimai_songs.json",
}
PARSER = "sega-listing-1"
MAX_CAPTURE = 8 * 1024 * 1024
SLOTS = {"bas": "BASIC", "adv": "ADVANCED", "exp": "EXPERT", "mas": "MASTER", "remas": "RE:MASTER"}
LEVEL = re.compile(r"(?:[1-9]|1[0-5])\+?")
METADATA = ("title", "artist", "title_kana", "catcode", "version", "image_url")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Official inventory redirected; review its source URL")


def capture(region):
    url = URLS[region]
    request = urllib.request.Request(  # noqa: S310 -- fixed official HTTPS URLs.
        url, headers={"User-Agent": "maimai.party-inventory/1", "Accept": "application/json"}
    )
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=30) as response:
        raw = response.read(MAX_CAPTURE + 1)
        headers = {
            key: response.headers.get(key) for key in ("Last-Modified", "ETag", "Content-Type")
        }
    metadata = {"url": url, "captured_at": datetime.now(UTC).isoformat(), "http": headers}
    return raw, snapshot(raw, region, metadata)


def assertion(row):
    # An assertion signature for reviewed matching, never a persistent song ID.
    return digest([row["title"], row["artist"]])


def parse(raw):
    if not isinstance(raw, bytes) or not 0 < len(raw) <= MAX_CAPTURE:
        raise ValueError("Official inventory exceeds its byte budget")
    rows = json.loads(raw)
    if not isinstance(rows, list) or not 0 < len(rows) <= 10000:
        raise ValueError("Invalid official inventory count")
    ordinary, outside, seen = [], [], set()
    for index, row in enumerate(rows):
        if not isinstance(row, dict) or any(
            not isinstance(v, str) or len(v) > 4000 for v in row.values()
        ):
            raise ValueError("Official inventory schema drift")
        if not all(k in row for k in METADATA) or not row["title"]:
            raise ValueError("Official inventory is missing identity metadata")
        known_slots = {prefix + suffix for prefix in ("lev_", "dx_lev_") for suffix in SLOTS} | {
            "lev_utage"
        }
        if any(
            k.startswith(("lev_", "dx_lev_")) and k not in known_slots and v for k, v in row.items()
        ):
            raise ValueError("Unknown official chart slot requires schema review")
        slots = []
        for prefix, format_ in (("lev_", "STD"), ("dx_lev_", "DX")):
            for suffix, difficulty in SLOTS.items():
                level = row.get(prefix + suffix)
                if level:
                    if not LEVEL.fullmatch(level):
                        raise ValueError("Unsupported official level label")
                    slots.append({"format": format_, "difficulty": difficulty, "level": level})
        record = {
            "key": assertion(row),
            "locator": index,
            "raw_record_sha256": digest(row),
            "metadata": {k: row[k] for k in METADATA},
            "slots": slots,
        }
        if row.get("lev_utage"):
            if slots:
                raise ValueError("Mixed ordinary/Utage row requires schema review")
            outside.append(
                {
                    "locator": index,
                    "raw_record_sha256": digest(row),
                    "reason": "unsupported_utage_scope",
                }
            )
        elif not slots:
            raise ValueError("Unaccounted official row has no supported chart slots")
        else:
            if record["key"] in seen:
                raise ValueError("Official title/artist collision requires explicit source review")
            seen.add(record["key"])
            ordinary.append(record)
    return ordinary, outside


def snapshot(raw, region, metadata):
    if region not in URLS or metadata.get("url") != URLS[region]:
        raise ValueError("Unexpected official inventory source")
    captured = datetime.fromisoformat(metadata["captured_at"].replace("Z", "+00:00"))
    if captured.tzinfo is None:
        raise ValueError("Capture time needs a timezone")
    ordinary, outside = parse(raw)
    if metadata.get("sha256", hashlib.sha256(raw).hexdigest()) != hashlib.sha256(
        raw
    ).hexdigest() or metadata.get("bytes", len(raw)) != len(raw):
        raise ValueError("Retained capture metadata does not match its bytes")
    return {
        "snapshot_id": "sega-" + region.lower() + ":" + hashlib.sha256(raw).hexdigest(),
        "provider": "sega-" + region.lower(),
        "region": region,
        "url": URLS[region],
        "sha256": hashlib.sha256(raw).hexdigest(),
        "bytes": len(raw),
        "parser": PARSER,
        "captured_at": metadata["captured_at"],
        "http": metadata.get("http", {}),
        "acquisition": "complete_validated_capture",
        "ordinary_rows": len(ordinary),
        "chart_slots": sum(len(r["slots"]) for r in ordinary),
        "outside_scope": outside,
    }


def propose(value, raw, region):
    ordinary, _ = parse(raw)
    proposals = []
    for row in ordinary:
        accepted = source_mapping(value, "sega-" + region.lower(), row["key"])
        candidates = metadata_candidates(value, row["metadata"]["title"], row["metadata"]["artist"])
        proposals.append(
            {
                "key": row["key"],
                "metadata": row["metadata"],
                "slots": row["slots"],
                "accepted_song_id": accepted,
                "candidates": candidates,
                "decision": "retained" if accepted else "needs_review",
            }
        )
    return proposals


def apply_snapshot(value, raw, source, decisions, *, count_review=None):
    """All-or-nothing candidate; every new or changed identity needs explicit evidence."""
    result = deepcopy(value)
    region, provider, sid = source["region"], source["provider"], source["snapshot_id"]
    expected = snapshot(raw, region, source)
    if source != expected:
        raise ValueError("Official capture provenance or counts do not match its bytes")
    ordinary, _ = parse(raw)
    previous = sorted(
        (s for s in result["sources"].values() if s.get("provider") == provider),
        key=lambda s: s["captured_at"],
    )
    if previous and source["captured_at"] < previous[-1]["captured_at"]:
        raise ValueError("Cannot replace regional current listing with an older observation")
    if (
        previous
        and (
            source["ordinary_rows"] < previous[-1]["ordinary_rows"] * 0.9
            or source["chart_slots"] < previous[-1]["chart_slots"] * 0.9
        )
        and not count_review
    ):
        raise ValueError("Large inventory decrease requires completeness review")
    if sid in result["sources"]:
        # Same bytes are the same observation; do not make old content appear newer.
        return validate(result)
    result["sources"][sid] = source
    if count_review:
        result["sources"][sid] = {**source, "count_review": count_review}
    listed = set()
    for row in ordinary:
        song_id = source_mapping(result, provider, row["key"])
        if song_id is None:
            decision = decisions.get(row["key"], {})
            if not decision.get("evidence") or decision.get("action") not in {"link", "admit"}:
                raise ValueError("Every new official identity needs an explicit reviewed decision")
            if decision["action"] == "admit":
                song_id = admit_song(
                    result,
                    row["metadata"],
                    evidence={
                        "snapshot": sid,
                        "record": row["raw_record_sha256"],
                        "review": decision["evidence"],
                    },
                    basis="official_observation",
                )
            else:
                song_id = resolve(result, decision["song_id"])
            accept_mapping(
                result,
                provider=provider,
                provider_id=row["key"],
                subject_id=song_id,
                snapshot_id=sid,
                evidence=decision["evidence"],
                assertion=row["metadata"],
            )
        subjects = [(song_id, "metadata", row["metadata"])]
        for slot in row["slots"]:
            chart_id = admit_chart(
                result,
                song_id,
                slot["format"],
                slot["difficulty"],
                evidence={"snapshot": sid, "record": row["raw_record_sha256"]},
            )
            listed.add(chart_id)
            subjects.append((chart_id, "level", slot["level"]))
        for subject, field, entry in subjects:
            oid = digest([sid, row["raw_record_sha256"], subject, field])
            result["observations"][oid] = {
                "observation_id": oid,
                "subject_id": subject,
                "field": field,
                "value": entry,
                "region": region,
                "game_release": None,
                "snapshot_id": sid,
                "observed_at": source["captured_at"],
                "effective_date": None,
                "raw_record_locator": row["locator"],
                "raw_record_sha256": row["raw_record_sha256"],
            }
    # A negative observation is bounded to charts already observed in this region.
    known = {
        o["subject_id"]
        for o in result["observations"].values()
        if o["region"] == region and o["subject_id"] in result["charts"]
    }
    for subject in known | listed:
        oid = digest([sid, subject, "listing"])
        result["observations"][oid] = {
            "observation_id": oid,
            "subject_id": subject,
            "field": "listing",
            "value": "listed" if subject in listed else "not_observed_in_latest_capture",
            "region": region,
            "game_release": None,
            "snapshot_id": sid,
            "observed_at": source["captured_at"],
            "effective_date": None,
        }
    return validate(result)


def coverage(value):
    return {
        "songs": sum(not s.get("redirect") for s in value["songs"].values()),
        "charts": sum(not c.get("redirect") for c in value["charts"].values()),
        "sources": {
            key: {
                k: s[k] for k in ("region", "captured_at", "ordinary_rows", "chart_slots") if k in s
            }
            for key, s in value["sources"].items()
        },
        "mappings": dict(Counter(m["state"] for m in value["mappings"].values())),
    }
