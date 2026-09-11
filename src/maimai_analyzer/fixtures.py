"""Intentionally authored examples: no copied chart or account data."""

from __future__ import annotations

from copy import deepcopy
from fractions import Fraction

from .contracts import CAPABILITIES, SCHEMA_VERSION


def synthetic_charts() -> list[dict]:
    """Small exact-variant corpus for illustration, never real-chart validation."""
    base = {
        "schema_version": SCHEMA_VERSION,
        "chart_id": "synthetic:orbit:STD:EXPERT:r1",
        "song_id": "synthetic:orbit",
        "format": "STD",
        "difficulty": "EXPERT",
        "revision": "r1",
        "source": {
            "source_id": "synthetic-authored-v1",
            "revision": "r1",
            "kind": "authored_synthetic",
            "identity_status": "exact",
            "parser_version": "normalized-json-1",
            "normalizer_version": "1.0.0",
        },
        "capabilities": sorted(CAPABILITIES),
        "onsets": [],
        "holds": [],
        "slides": [],
        "source_offset_us": 0,
        "audio_offset_us": None,
        "track_duration_us": 8_000_000,
        "bpm_segments": [{"time_us": 0, "beat": [0, 1], "bpm": [120, 1]}],
    }
    for index in range(32):
        beat = Fraction(index, 2)
        base["onsets"].append(
            {
                "event_id": f"note-{index:03}",
                "time_us": index * 250_000,
                "beat": [beat.numerator, beat.denominator],
                "role": "tap",
                "position": 1 if index % 2 == 0 else 3,
            }
        )
    slow = deepcopy(base)
    slow.update(
        chart_id="synthetic:orbit:DX:ADVANCED:r1",
        format="DX",
        difficulty="ADVANCED",
        track_duration_us=16_000_000,
    )
    slow["bpm_segments"][0]["bpm"] = [60, 1]
    for event in slow["onsets"]:
        event["time_us"] *= 2
    different = deepcopy(base)
    different.update(chart_id="synthetic:steps:STD:EXPERT:r1", song_id="synthetic:steps")
    for index, event in enumerate(different["onsets"]):
        event["position"] = index % 8 + 1
    slides = deepcopy(base)
    slides.update(
        chart_id="synthetic:lantern:DX:MASTER:r1",
        song_id="synthetic:lantern",
        format="DX",
        difficulty="MASTER",
    )
    slides["onsets"][0]["role"] = "star_tap"
    slides["onsets"][8]["role"] = "hold_onset"
    slides["holds"] = [{"hold_id": "hold-1", "onset_id": "note-008", "end_us": 5_000_000}]
    slides["slides"] = [
        {
            "path_id": "path-1",
            "head_id": "note-000",
            "wait_start_us": 0,
            "wait_end_us": 1_000_000,
            "movement_start_us": 1_000_000,
            "movement_end_us": 6_000_000,
            "segment_ids": ["part-1", "part-2"],
        },
        {
            "path_id": "path-2",
            "head_id": "note-000",
            "wait_start_us": 0,
            "wait_end_us": 2_000_000,
            "movement_start_us": 2_000_000,
            "movement_end_us": 7_000_000,
            "segment_ids": [],
        },
    ]
    burst = deepcopy(base)
    burst.update(
        chart_id="synthetic:pulse:STD:MASTER:r1", song_id="synthetic:pulse", difficulty="MASTER"
    )
    for index, event in enumerate(burst["onsets"]):
        event["time_us"] = 4_000_000 + index * 50_000
        beat = Fraction(event["time_us"], 500_000)
        event["beat"] = [beat.numerator, beat.denominator]
    partial = deepcopy(slides)
    partial.update(chart_id="synthetic:lantern:DX:EXPERT:r1", difficulty="EXPERT")
    partial["capabilities"].remove("slide_movement")
    partial["known_intervals"] = [[0, 3_000_000], [5_000_000, 8_000_000]]
    partial["diagnostics"] = [
        "Authored synthetic gap from 3 to 5 seconds; movement capability withheld."
    ]
    return [base, slow, different, slides, burst, partial]


def synthetic_profiles() -> list[dict]:
    from .core import analyze

    return [analyze(chart) for chart in synthetic_charts()]
