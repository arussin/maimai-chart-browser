from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from .errors import CalculationError

JSONDict = dict[str, Any]


def make_maps(body: JSONDict) -> tuple[dict[str, JSONDict], dict[str, JSONDict]]:
    charts = body.get("charts")
    songs = body.get("songs")
    if not isinstance(charts, list) or not isinstance(songs, list):
        raise CalculationError("Score data is missing its charts or songs list.")
    chart_map = {
        chart["chartID"]: chart
        for chart in charts
        if isinstance(chart, dict) and isinstance(chart.get("chartID"), str)
    }
    song_map = {
        song["id"]: song
        for song in songs
        if isinstance(song, dict) and isinstance(song.get("id"), str)
    }
    return chart_map, song_map


def compact_record(
    record: JSONDict,
    chart_map: dict[str, JSONDict],
    song_map: dict[str, JSONDict],
) -> JSONDict:
    chart = chart_map.get(record.get("chartID"), {})
    song = song_map.get(record.get("songID"), {})
    if not song and isinstance(chart.get("song"), dict):
        song = chart["song"]

    score_data = record.get("scoreData") if isinstance(record.get("scoreData"), dict) else {}
    optional = score_data.get("optional") if isinstance(score_data.get("optional"), dict) else {}
    judgements = (
        score_data.get("judgements") if isinstance(score_data.get("judgements"), dict) else {}
    )
    calculated = (
        record.get("calculatedData") if isinstance(record.get("calculatedData"), dict) else {}
    )
    chart_data = chart.get("data") if isinstance(chart.get("data"), dict) else {}

    return {
        "chartID": record.get("chartID"),
        "songID": record.get("songID"),
        "title": song.get("title"),
        "artist": song.get("artist"),
        "difficulty": chart.get("difficulty"),
        "level": chart.get("level"),
        "levelNum": chart.get("levelNum"),
        "displayVersion": chart_data.get("displayVersion"),
        "percent": score_data.get("percent"),
        "rate": calculated.get("rate"),
        "grade": score_data.get("grade"),
        "lamp": score_data.get("lamp"),
        "fast": optional.get("fast"),
        "slow": optional.get("slow"),
        "miss": judgements.get("miss"),
        "good": judgements.get("good"),
        "great": judgements.get("great"),
        "perfect": judgements.get("perfect"),
        "pcrit": judgements.get("pcrit"),
        "timeAchieved": record.get("timeAchieved"),
    }


def rate_value(record: JSONDict) -> int:
    calculated = record.get("calculatedData")
    if not isinstance(calculated, dict):
        return 0
    value = calculated.get("rate")
    return value if isinstance(value, int) else 0


def display_version(record: JSONDict, chart_map: dict[str, JSONDict]) -> str | None:
    chart = chart_map.get(record.get("chartID"), {})
    data = chart.get("data")
    if not isinstance(data, dict):
        return None
    value = data.get("displayVersion")
    return value if isinstance(value, str) else None


def rating_summary(
    body: JSONDict,
    current_version_display_names: Iterable[str],
) -> JSONDict:
    """Calculate the audited top-35 legacy plus top-15 current-version pools."""

    chart_map, song_map = make_maps(body)
    pbs_value = body.get("pbs")
    if not isinstance(pbs_value, list):
        raise CalculationError("PB data is missing its pbs list.")
    pbs = [pb for pb in pbs_value if isinstance(pb, dict)]
    sorted_pbs = sorted(pbs, key=rate_value, reverse=True)
    current_versions = frozenset(current_version_display_names)

    new_pool = [pb for pb in sorted_pbs if display_version(pb, chart_map) in current_versions]
    old_pool = [pb for pb in sorted_pbs if display_version(pb, chart_map) not in current_versions]
    new15 = new_pool[:15]
    old35 = old_pool[:35]
    best50 = sorted_pbs[:50]

    return {
        "pbCount": len(pbs),
        "naiveRating": sum(rate_value(pb) for pb in best50),
        "old35Rating": sum(rate_value(pb) for pb in old35),
        "new15Rating": sum(rate_value(pb) for pb in new15),
        "reconstructedRating": sum(rate_value(pb) for pb in old35 + new15),
        "newPoolPlayed": len(new_pool),
        "newSlotsFilled": len(new15),
        "old35Floor": rate_value(old35[-1]) if len(old35) == 35 else 0,
        "new15Floor": rate_value(new15[-1]) if len(new15) == 15 else 0,
        "old35": [compact_record(pb, chart_map, song_map) for pb in old35],
        "new15": [compact_record(pb, chart_map, song_map) for pb in new15],
    }
