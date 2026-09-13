"""Authored provider metadata; never read the live mai-notes index in tests."""

import json
from uuid import UUID


def manifest(charts, *, unavailable=()):
    songs, entries = {}, []
    for index, chart in enumerate(charts, 1):
        sid, cid = str(UUID(int=index)), str(UUID(int=1000 + index))
        songs[sid] = {
            "id": sid,
            "title": chart["title"],
            "artist": chart["artist"],
            "type": "standard" if chart["format"] == "STD" else "deluxe",
            "kana_index": index,
        }
        entries.append(
            {
                "id": cid,
                "song_id": sid,
                "difficulty": chart["difficulty"],
                "has_chart_data": index not in unavailable,
                "top_player_name": "UNRELATED_SCORE_SENTINEL",
            }
        )
    return {
        "songs": songs,
        "charts": entries,
        "songs_count": len(songs),
        "charts_count": len(entries),
        "generated_at": "2026-09-13T00:00:00Z",
    }


def encoded(charts, **kwargs):
    return json.dumps(manifest(charts, **kwargs), ensure_ascii=False).encode("utf-8")
