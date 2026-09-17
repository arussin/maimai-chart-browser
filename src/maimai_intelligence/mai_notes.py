"""Prepare display-only player links from a single public mai-notes index.

No chart text, audio, accounts, scores or browser-time requests are needed.
Matching does not qualify research charts for personal recommendations.
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
import urllib.request
from collections import Counter, defaultdict
from datetime import UTC, datetime

SOURCE_URL = "https://mai-notes.com/data/manifest.json"
VERSION = "mai-notes-links-1"
MAX_INDEX_BYTES = 16 * 1024 * 1024
UUID = re.compile(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}")
DIFFICULTIES = {"BASIC", "ADVANCED", "EXPERT", "MASTER", "RE:MASTER"}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("mai-notes index redirected; check the source before refreshing")


def download_index():
    request = urllib.request.Request(  # noqa: S310 -- fixed public HTTPS metadata URL.
        SOURCE_URL,
        headers={"User-Agent": "maimai.party-chart-links/1", "Accept": "application/json"},
    )
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=30) as response:
        raw = response.read(MAX_INDEX_BYTES + 1)
    if len(raw) > MAX_INDEX_BYTES:
        raise ValueError("mai-notes index exceeds its size limit")
    return raw


def normalize(text):
    return " ".join(unicodedata.normalize("NFKC", text).split()).casefold()


def _text(value):
    if not isinstance(value, str) or len(value) > 2000:
        raise ValueError("Invalid mai-notes text field")
    return value


def _timestamp(value):
    if not isinstance(value, str) or len(value) > 40:
        raise ValueError("Missing index capture timestamp")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Index capture timestamp needs a timezone")
    return value


def parse_index(raw):
    if not isinstance(raw, bytes) or len(raw) > MAX_INDEX_BYTES:
        raise ValueError("mai-notes index exceeds its size limit")
    data = json.loads(raw)
    songs, charts = data.get("songs"), data.get("charts")
    if (
        not isinstance(songs, dict)
        or not isinstance(charts, list)
        or not 0 < len(charts) <= 50000
        or data.get("songs_count") != len(songs)
        or data.get("charts_count") != len(charts)
    ):
        raise ValueError("Invalid mai-notes index counts or schema")
    _timestamp(data.get("generated_at"))
    visible, result, seen = {}, {}, set()
    for sid, song in songs.items():
        if not UUID.fullmatch(sid) or song.get("id") != sid:
            raise ValueError("Invalid mai-notes song identity")
        if song.get("type") not in {"standard", "deluxe"}:
            raise ValueError("Unknown mai-notes chart format")
        _text(song.get("title"))
        _text(song.get("artist"))
        if song.get("kana_index") is not None:
            visible[sid] = song
    for chart in charts:
        cid = chart.get("id", "")
        difficulty = _text(chart.get("difficulty")).upper()
        if (
            not UUID.fullmatch(cid)
            or cid in seen
            or chart.get("song_id") not in songs
            or difficulty not in DIFFICULTIES
            or type(chart.get("has_chart_data")) is not bool
        ):
            raise ValueError("Invalid, duplicate or unsupported mai-notes chart")
        seen.add(cid)
        song = visible.get(chart["song_id"])
        if song is not None:
            # Deliberately discard score fields, tag data and all unrelated metadata.
            result[cid] = {
                "id": cid,
                "title": song["title"],
                "artist": song["artist"],
                "format": "STD" if song["type"] == "standard" else "DX",
                "difficulty": difficulty,
                "available": chart["has_chart_data"],
            }
    return result, data["generated_at"]


def _key(chart):
    return (
        normalize(chart["title"]),
        normalize(chart["artist"]),
        chart["format"],
        chart["difficulty"].upper(),
    )


def prepare_links(charts, raw, *, overrides=(), captured_at=None):
    targets, generated_at = parse_index(raw)
    index, own = defaultdict(list), defaultdict(list)
    for target in targets.values():
        index[_key(target)].append(target)
    by_id = {chart["chart_id"]: chart for chart in charts}
    if len(by_id) != len(charts):
        raise ValueError("Duplicate local chart identity")
    for chart in charts:
        own[_key(chart)].append(chart)
    reviewed = {}
    for entry in overrides:
        cid, target = entry["chart_id"], targets.get(entry["mai_notes_id"])
        chart = by_id.get(cid)
        if (
            cid in reviewed
            or chart is None
            or target is None
            or entry.get("source_hash") != chart["source_hash"]
            or not isinstance(entry.get("evidence"), str)
            or not entry["evidence"].strip()
            or chart["format"] != target["format"]
            or chart["difficulty"].upper() != target["difficulty"]
        ):
            raise ValueError("Invalid or stale reviewed mai-notes mapping")
        reviewed[cid] = target
    links, audit, counts, assigned = {}, [], Counter(), defaultdict(list)
    for chart in charts:
        cid, key = chart["chart_id"], _key(chart)
        candidates = index[key]
        method = "reviewed" if cid in reviewed else "exact_metadata"
        target = reviewed.get(cid)
        if target is None and len(candidates) == 1 and len(own[key]) == 1 and key[0].strip():
            target = candidates[0]
        state = (
            "linked"
            if target and target["available"]
            else "unavailable"
            if target
            else "ambiguous"
            if candidates
            else "unmatched"
        )
        counts[state] += 1
        if state == "linked":
            links[cid] = {
                "id": target["id"],
                "source_hash": chart["source_hash"],
                "format": chart["format"],
                "difficulty": chart["difficulty"],
            }
            assigned[target["id"]].append(cid)
        audit.append(
            {
                "chart_id": cid,
                "title": chart["title"],
                "format": chart["format"],
                "difficulty": chart["difficulty"],
                "status": state,
                "method": method if target else None,
                "mai_notes_id": target["id"] if target else None,
            }
        )
    if any(len(ids) > 1 for ids in assigned.values()):
        raise ValueError("Multiple local charts resolve to one mai-notes chart; review the mapping")
    result = {
        "version": VERSION,
        "source": SOURCE_URL,
        "source_sha256": hashlib.sha256(raw).hexdigest(),
        "generated_at": generated_at,
        "captured_at": _timestamp(captured_at or datetime.now(UTC).isoformat()),
        "charts": links,
    }
    validate_links(result, charts)
    return result, {"counts": dict(counts), "charts": audit}


def validate_links(data, charts):
    if (
        set(data) != {"version", "source", "source_sha256", "generated_at", "captured_at", "charts"}
        or data["version"] not in {VERSION, "mai-notes-links-2"}
        or data["source"] != SOURCE_URL
        or not re.fullmatch(r"[0-9a-f]{64}", data["source_sha256"])
        or not isinstance(data["charts"], dict)
    ):
        raise ValueError("Invalid public mai-notes link index")
    _timestamp(data["generated_at"])
    _timestamp(data["captured_at"])
    by_id, seen = {chart["chart_id"]: chart for chart in charts}, set()
    identity = (
        ("format", "difficulty")
        if data["version"] == "mai-notes-links-2"
        else ("source_hash", "format", "difficulty")
    )
    for cid, record in data["charts"].items():
        chart = by_id.get(cid)
        if (
            set(record) != {"id", *identity}
            or not UUID.fullmatch(record["id"])
            or record["id"] in seen
            or chart is None
            or any(record[k] != chart.get(k) for k in identity)
        ):
            raise ValueError("mai-notes link does not belong to this exact catalog chart")
        seen.add(record["id"])
    return data
