"""Project reviewed Diving-Fish and LXNS public song snapshots into the import lookup.

No player data or network access. Keep the raw input and SHA-256 receipt beside
the task evidence; rerun explicitly when refreshing the pinned public snapshot.
"""

import argparse
import hashlib
import json
from pathlib import Path


def build(inputs):
    songs = {}
    raw = (inputs / "fish-metadata.json").read_bytes()
    for song in json.loads(raw):
        if song["type"] not in ("SD", "DX") or int(song["id"]) >= 100000:
            continue
        key = str(song["id"]) + ":" + ("STD" if song["type"] == "SD" else "DX")
        info = song["basic_info"]
        for index in range(min(len(song["level"]), 5)):
            row = [song["title"], info["artist"], info.get("genre", ""), 1 << index]
            # Conflicting public source identities deliberately have no automatic join.
            prior = songs.get(key, row)
            songs[key] = [*row[:3], prior[3] | row[3]] if prior and prior[:3] == row[:3] else None
    lxns_songs = {}
    lxns_raw = (inputs / "lxns-metadata.json").read_bytes()
    for song in json.loads(lxns_raw)["songs"]:
        for kind, chart_format in (("standard", "STD"), ("dx", "DX")):
            for chart in song["difficulties"].get(kind, []):
                index = chart["difficulty"]
                if type(index) is not int or not 0 <= index < 5:
                    continue
                key = str(song["id"]) + ":" + chart_format
                row = [song["title"], song["artist"], song.get("genre", ""), 1 << index]
                prior = lxns_songs.get(key, row)
                lxns_songs[key] = (
                    [*row[:3], prior[3] | row[3]] if prior and prior[:3] == row[:3] else None
                )
    return {
        "version": 1,
        "capturedOn": "2026-10-11",
        "sources": [
            {
                "source": "fish",
                "url": "https://www.diving-fish.com/api/maimaidxprober/music_data",
                "sha256": hashlib.sha256(raw).hexdigest(),
            },
            {
                "source": "lxns",
                "url": "https://maimai.lxns.net/api/v0/maimai/song/list",
                "sha256": hashlib.sha256(lxns_raw).hexdigest(),
            },
        ],
        "tables": {"diving-fish": songs, "lxns": lxns_songs},
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inputs", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    result = build(args.inputs)
    args.output.write_text(
        json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "tables": {key: len(value) for key, value in result["tables"].items()},
                "bytes": args.output.stat().st_size,
            }
        )
    )
