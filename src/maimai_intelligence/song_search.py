"""Package public title aliases for local search, independently of chart identity."""

import json
from importlib.resources import files


def song_search_script():
    assets = files("maimai_intelligence.assets")
    aliases = json.loads(assets.joinpath("song-aliases.json").read_text("utf-8"))
    entries = json.dumps(aliases["entries"], ensure_ascii=False, separators=(",", ":"))
    # Only title/artist/alias strings enter the script, never provenance URLs.
    entries = entries.replace("&", "\\u0026").replace("<", "\\u003c").replace(">", "\\u003e")
    multilingual = json.loads(assets.joinpath("song-localizations.json").read_text("utf-8"))
    supplemental = (
        json.dumps(
            {
                sid: sorted({alias["value"] for alias in row["aliases"]})
                for sid, row in multilingual["songs"].items()
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
        .replace("&", "\\u0026")
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
    )
    return (
        assets.joinpath("song-search.js")
        .read_text("utf-8")
        .replace("__MAIMAI_SONG_ALIASES__", entries)
        .replace("__MAIMAI_MULTILINGUAL_ALIASES__", supplemental)
    )
