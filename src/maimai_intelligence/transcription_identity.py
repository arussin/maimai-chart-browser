"""Stable identities for explicit validated transcription inputs."""

import hashlib
import re


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _hash(value):
    return value if isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) else None


def _text(value, default="unknown", limit=512):
    return value if isinstance(value, str) and value.strip() and len(value) <= limit else default


def input_identity(row):
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
