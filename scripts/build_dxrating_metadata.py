"""Project a captured public DXRating v1 catalog into the lazy sheet-ID lookup.

No network or player data. Retain the input bytes and API receipt as task evidence.
See docs/DXRATING_IMPORT.md for the data notice and explicit refresh procedure.
"""

import argparse
import hashlib
import json
import re
from datetime import date
from pathlib import Path

SOURCE = "https://miruku.dxrating.net/api/v1/dxdata"
NOTICE = (
    "https://github.com/gekichumai/dxrating/blob/"
    "1599d1dced3e7ff151ba81dc861cb231f0e63d4e/packages/dxdata/LICENSE"
)
ALPHABET = "23456789abcdefghjkmnpqrstvwxyz"


def public_id(value, prefix):
    if not isinstance(value, str) or not re.fullmatch(f"{prefix}_[{ALPHABET}]{{10}}", value):
        raise ValueError(f"Invalid {prefix} public ID")
    return value


def text(value, *, allow_empty=False):
    if not isinstance(value, str) or (not value and not allow_empty) or len(value) > 512:
        raise ValueError("Missing or oversized source metadata")
    if any(ord(c) < 32 or 0xD800 <= ord(c) <= 0xDFFF for c in value):
        raise ValueError("Invalid source metadata text")
    return value


def build(raw, captured_on):
    date.fromisoformat(captured_on)
    data = json.loads(raw)
    if data.get("schemaVersion") != 1:
        raise ValueError("Expected the public v1 song catalog, not legacy dxdata.json")
    songs, sheets = [], {}
    song_ids = set()
    for song in sorted(data["songs"], key=lambda value: value["id"]):
        sid = public_id(song["id"], "dsng")
        if sid in song_ids:
            raise ValueError("Duplicate song ID")
        song_ids.add(sid)
        index = len(songs)
        songs.append([sid, text(song["title"]), text(song["artist"], allow_empty=True)])
        for sheet in song["sheets"]:
            sheet_id = public_id(sheet["id"], "dsht")
            if sheet_id in sheets:
                raise ValueError("Duplicate sheet ID")
            # Keep types/difficulties verbatim: the parser applies the same chart
            # rules as legacy exports, including Utage exclusions/rejections.
            sheets[sheet_id] = [index, text(sheet["type"]), text(sheet["difficulty"])]
    if not sheets:
        raise ValueError("Empty public sheet catalog")
    return {
        "version": 1,
        "capturedOn": captured_on,
        "updatedAt": data["updatedAt"],
        "sources": [
            {
                "source": "dxrating",
                "url": SOURCE,
                "sha256": hashlib.sha256(raw).hexdigest(),
                "notice": NOTICE,
            }
        ],
        "credit": "Data from DXRating (dxrating.net)",
        "songs": songs,
        "sheets": dict(sorted(sheets.items())),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--captured-on", required=True)
    args = parser.parse_args()
    result = build(args.input.read_bytes(), args.captured_on)
    args.output.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "songs": len(result["songs"]),
                "sheets": len(result["sheets"]),
                "bytes": args.output.stat().st_size,
            }
        )
    )
