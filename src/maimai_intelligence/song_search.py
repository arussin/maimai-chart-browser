"""Package public title aliases for local search, independently of chart identity."""

import json
import re
import unicodedata
from importlib.resources import files


def display_readings(songs, entries, reviewed=()):
    """Display faithful readings, never generated approximations or nicknames."""

    def key(value):
        return unicodedata.normalize("NFKC", value).casefold().strip()

    def compact(value):
        return "".join(c for c in key(value) if c.isalnum())

    aliases = {(key(title), key(artist)): names for title, artist, names in entries}
    approved = {}
    for row in reviewed:
        song = songs.get(row["song_id"])
        identity = (key(row["title"]), key(row["artist"]))
        reading = row["reading"]
        if (
            not song
            or (song["title"], song["artist"]) != (row["title"], row["artist"])
            or (identity in approved and approved[identity] != reading)
            or not reading.strip()
            or re.search(r"[ぁ-ヿ\u3400-\u9fff]", reading)
            or not any(key(name) == key(reading) for name in aliases.get(identity, []))
        ):
            raise ValueError("Display pronunciation does not match its reviewed source identity")
        approved[identity] = reading
    result = []
    for row in songs.values():
        if not re.search(r"[ぁ-ヿ\u3400-\u9fff]", row["title"]):
            continue
        readings = [
            a["value"]
            for a in row["aliases"]
            if a["locale"] == "en" and a["kind"] in {"authored-pronunciation", "kana-title"}
        ]
        if identity_reading := approved.get((key(row["title"]), key(row["artist"]))):
            readings.insert(0, identity_reading)
        if not readings:
            continue
        reading = readings[0]
        if re.search(r"[ぁ-ヿ\u3400-\u9fff]", reading):
            continue
        # Recover human spacing/case only when the alias spells the same reading.
        names = aliases.get((key(row["title"]), key(row["artist"])), [])
        if not identity_reading:
            reading = next((name for name in names if compact(name) == compact(reading)), reading)
        if compact(reading) != compact(row["title"]):
            result.append([row["title"], row["artist"], reading])
    return result


def song_search_data():
    assets = files("maimai_intelligence.assets")
    aliases = json.loads(assets.joinpath("song-aliases.json").read_text("utf-8"))
    multilingual = json.loads(assets.joinpath("song-localizations.json").read_text("utf-8"))
    reviewed = json.loads(assets.joinpath("song-display-readings.json").read_text("utf-8"))
    if reviewed["source_revision"] != aliases["revision"]:
        raise ValueError("Display pronunciations require review against the current alias revision")
    return {
        "entries": aliases["entries"],
        "multilingual": {
            sid: sorted({alias["value"] for alias in row["aliases"]})
            for sid, row in multilingual["songs"].items()
        },
        "readings": display_readings(
            multilingual["songs"], aliases["entries"], reviewed["entries"]
        ),
    }


def song_search_script():
    data = song_search_data()
    script = files("maimai_intelligence.assets").joinpath("song-search.js").read_text("utf-8")
    for placeholder, field in {
        "__MAIMAI_SONG_ALIASES__": "entries",
        "__MAIMAI_MULTILINGUAL_ALIASES__": "multilingual",
        "__MAIMAI_DISPLAY_READINGS__": "readings",
    }.items():
        value = json.dumps(data[field], ensure_ascii=False, separators=(",", ":"))
        value = value.replace("&", "\\u0026").replace("<", "\\u003c").replace(">", "\\u003e")
        script = script.replace(placeholder, value)
    return script
