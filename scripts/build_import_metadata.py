"""Project reviewed public song snapshots into the lazy file-import lookup.

No player data or network access. Keep the raw inputs and SHA-256 receipt beside
the task evidence; rerun explicitly when refreshing the pinned public snapshots.
"""

import argparse
import hashlib
import json
from pathlib import Path


def build(inputs, *, include_file_providers=True):
    tables = {"diving-fish": {}, "lxns": {}}
    if include_file_providers:
        tables.update({"dxrating": {}, "in-game-id": {}})
    provenance = []
    difficulty = ["BASIC", "ADVANCED", "EXPERT", "MASTER", "RE:MASTER"]

    def add(provider, sid, fmt, dif, title, artist, genre=""):
        key = str(sid) + ":" + fmt
        row = [title, artist, genre, 1 << difficulty.index(dif)]
        # Conflicting public source identities deliberately have no automatic join.
        prior = tables[provider].get(key, row)
        tables[provider][key] = (
            [*row[:3], prior[3] | row[3]] if prior and prior[:3] == row[:3] else None
        )

    for name, url in (
        ("fish", "https://www.diving-fish.com/api/maimaidxprober/music_data"),
        ("lxns", "https://maimai.lxns.net/api/v0/maimai/song/list"),
        (
            "dxrating",
            "https://raw.githubusercontent.com/gekichumai/dxrating/"
            "301fed158b621b060de2e3460f544fd7634959f7/packages/dxdata/dxdata.json",
        ),
    ):
        if name == "dxrating" and not include_file_providers:
            continue
        raw = (inputs / (name + "-metadata.json")).read_bytes()
        data = json.loads(raw)
        provenance.append({"source": name, "url": url, "sha256": hashlib.sha256(raw).hexdigest()})
        if name == "fish":
            for song in data:
                if song["type"] not in ("SD", "DX") or int(song["id"]) >= 100000:
                    continue
                for i in range(min(len(song["level"]), 5)):
                    info = song["basic_info"]
                    add(
                        "diving-fish",
                        song["id"],
                        "STD" if song["type"] == "SD" else "DX",
                        difficulty[i],
                        song["title"],
                        info["artist"],
                        info.get("genre", ""),
                    )
        elif name == "lxns":
            for song in data["songs"]:
                for kind, fmt in (("standard", "STD"), ("dx", "DX")):
                    for chart in song["difficulties"].get(kind, []):
                        i = chart["difficulty"]
                        if type(i) is int and 0 <= i < 5:
                            add(
                                "lxns",
                                song["id"],
                                fmt,
                                difficulty[i],
                                song["title"],
                                song["artist"],
                                song.get("genre", ""),
                            )
        else:
            difs = dict(
                zip(("basic", "advanced", "expert", "master", "remaster"), difficulty, strict=True)
            )
            for song in data["songs"]:
                for sheet in song["sheets"]:
                    if (
                        sheet["type"] not in ("std", "dx")
                        or sheet["difficulty"] not in difs
                        or sheet.get("isSpecial")
                    ):
                        continue
                    args = (
                        sheet["type"].upper(),
                        difs[sheet["difficulty"]],
                        song["title"],
                        song["artist"],
                        song.get("category", ""),
                    )
                    add("dxrating", song["songId"], *args)
                    sid = sheet.get("internalId")
                    if type(sid) is int and 0 < sid < 100000:
                        add("in-game-id", sid, *args)
    return {"version": 1, "capturedOn": "2026-10-11", "sources": provenance, "tables": tables}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inputs", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument(
        "--api-only",
        action="store_true",
        help="Explicitly omit file-provider supplements for a tracker-only build.",
    )
    args = parser.parse_args()
    result = build(args.inputs, include_file_providers=not args.api_only)
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
