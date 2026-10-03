"""Validated, explicit, player-independent normalized chart input (no parser)."""

from __future__ import annotations

import hashlib
import json
from bisect import bisect_right
from fractions import Fraction
from typing import Any

from .rational import (
    MAX_RATIONAL_INTEGER as MAX_RATIONAL_INTEGER,
)
from .rational import RationalEncodingError, RationalPair, decode_rational, encode_rational

SCHEMA_VERSION = "1.0.0"
EXACT_RATIONAL_SCHEMA_VERSION = "1.1.0"
SUPPORTED_SCHEMA_VERSIONS = frozenset({SCHEMA_VERSION, EXACT_RATIONAL_SCHEMA_VERSION})
ANALYZER_VERSION = "0.3.0-experimental"
MAX_EVENTS = 100_000
MAX_DURATION_US = 3_600_000_000
MAX_INPUT_BYTES = 32 * 1024 * 1024
CAPABILITIES = frozenset(
    {
        "timing",
        "positions",
        "beat_grid",
        "authored_simultaneity",
        "hold_intervals",
        "slide_wait",
        "slide_movement",
        "slide_groups",
        "note_flags",
        "span",
        "touch_zones",
    }
)


class ChartInputError(ValueError):
    """Input cannot safely or honestly represent a normalized chart."""


def canonical_bytes(value: Any) -> bytes:
    return (
        json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
        )
        + "\n"
    ).encode("utf-8")


def content_hash(value: Any) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def _keys(value: Any, allowed: set[str], required: set[str], label: str) -> dict:
    if not isinstance(value, dict) or set(value) - allowed or required - set(value):
        raise ChartInputError(f"Invalid {label} fields")
    return value


def _text(value: Any, label: str, limit: int = 240) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ChartInputError(f"Invalid {label}")
    return value


def _integer(value: Any, label: str, *, negative: bool = False) -> int:
    if type(value) is not int or abs(value) > MAX_DURATION_US or (value < 0 and not negative):
        raise ChartInputError(f"Invalid {label}")
    return value


def _beat(value: Any, *, schema_version: str = SCHEMA_VERSION) -> RationalPair | None:
    if value is None:
        return None
    try:
        return encode_rational(
            decode_rational(value, allow_strings=schema_version == EXACT_RATIONAL_SCHEMA_VERSION)
        )
    except RationalEncodingError as error:
        raise ChartInputError(str(error)) from error


def _normalize_chart(raw: dict) -> dict:
    """Validate, sort and shift negative chart times; keep source/audio offsets separate.

    Extra fields are rejected, including personal overlays. This format deliberately
    does not claim Simai compatibility. Source bytes are acquired outside this core.
    """
    _keys(
        raw,
        {
            "schema_version",
            "chart_id",
            "song_id",
            "format",
            "difficulty",
            "revision",
            "source",
            "capabilities",
            "onsets",
            "holds",
            "slides",
            "bpm_segments",
            "known_intervals",
            "diagnostics",
            "source_offset_us",
            "audio_offset_us",
            "track_duration_us",
            "geometry_version",
        },
        {
            "schema_version",
            "chart_id",
            "song_id",
            "format",
            "difficulty",
            "revision",
            "source",
            "capabilities",
            "onsets",
        },
        "chart",
    )
    try:
        if len(canonical_bytes(raw)) > MAX_INPUT_BYTES:
            raise ChartInputError("Chart exceeds input byte limit")
    except (ValueError, TypeError, RecursionError) as error:
        raise ChartInputError("Chart must contain finite, bounded JSON data") from error
    if (
        not isinstance(raw["schema_version"], str)
        or raw["schema_version"] not in SUPPORTED_SCHEMA_VERSIONS
    ):
        raise ChartInputError("Unsupported normalized chart schema")
    chart = {
        key: _text(raw[key], key)
        for key in ("chart_id", "song_id", "format", "difficulty", "revision")
    }
    if chart["format"] not in {"STD", "DX"}:
        raise ChartInputError("Chart format must be STD or DX")
    if chart["difficulty"] not in {
        "EASY",
        "BASIC",
        "ADVANCED",
        "EXPERT",
        "MASTER",
        "RE:MASTER",
        "UTAGE",
    }:
        raise ChartInputError("Unsupported difficulty identity")
    source = _keys(
        raw["source"],
        {
            "source_id",
            "revision",
            "kind",
            "byte_hash",
            "identity_status",
            "parser_version",
            "normalizer_version",
        },
        {
            "source_id",
            "revision",
            "kind",
            "identity_status",
            "parser_version",
            "normalizer_version",
        },
        "source",
    )
    chart["source"] = {key: _text(value, f"source {key}") for key, value in source.items()}
    if source["identity_status"] not in {"exact", "reviewed", "ambiguous", "unresolved"}:
        raise ChartInputError("Invalid identity coverage")
    if source["kind"] not in {
        "authored_synthetic",
        "reviewed_permitted_local",
        "public_transcription_evaluation",
    }:
        raise ChartInputError(
            "Source kind must declare synthetic, reviewed local or evaluation use"
        )
    if "byte_hash" in source and (
        len(source["byte_hash"]) != 64
        or any(c not in "0123456789abcdef" for c in source["byte_hash"])
    ):
        raise ChartInputError("Source byte hash must be lowercase SHA-256")
    if source["kind"] != "authored_synthetic" and "byte_hash" not in source:
        raise ChartInputError("Nonsynthetic sources require their original byte hash")
    caps = raw["capabilities"]
    if not isinstance(caps, list) or any(not isinstance(c, str) for c in caps):
        raise ChartInputError("Capabilities must be explicit names")
    if set(caps) - CAPABILITIES or len(caps) != len(set(caps)):
        raise ChartInputError("Unknown or duplicate capability")
    chart["capabilities"] = sorted(caps)
    chart["onsets"], chart["holds"], chart["slides"] = [], [], []
    if any(not isinstance(raw.get(key, []), list) for key in ("onsets", "holds", "slides")):
        raise ChartInputError("Chart events must be lists")
    if sum(len(raw.get(key, [])) for key in ("onsets", "holds", "slides")) > MAX_EVENTS:
        raise ChartInputError("Chart exceeds event limit")
    ids: set[str] = set()
    for event in raw["onsets"]:
        _keys(
            event,
            {"event_id", "time_us", "beat", "role", "position", "group_id", "break", "ex"},
            {"event_id", "time_us", "role"},
            "onset",
        )
        event_id = _text(event["event_id"], "event ID")
        if event_id in ids:
            raise ChartInputError("Duplicate onset ID: normalize shared slide heads once")
        ids.add(event_id)
        role = event["role"]
        if role not in {"tap", "star_tap", "hold_onset", "touch", "touch_hold"}:
            raise ChartInputError("Unsupported onset role")
        position = event.get("position")
        if position is not None and not (type(position) is int and 1 <= position <= 8):
            if role not in {"touch", "touch_hold"} or not isinstance(position, str):
                raise ChartInputError("Button positions must be 1..8; touch zones must be text")
            _text(position, "touch zone", 12)
        beat = _beat(event.get("beat"), schema_version=raw["schema_version"])
        if "positions" in caps and position is None:
            raise ChartInputError("Complete positions capability requires every onset position")
        if "beat_grid" in caps and beat is None:
            raise ChartInputError("Complete beat grid requires every onset beat")
        for flag in ("break", "ex"):
            if flag in event and type(event[flag]) is not bool:
                raise ChartInputError("Note flags must be Boolean")
        group_id = event.get("group_id")
        if group_id is not None:
            _text(group_id, "authored group ID")
        chart["onsets"].append(
            {
                "event_id": event_id,
                "time_us": _integer(event["time_us"], "onset time", negative=True),
                "beat": beat,
                "role": role,
                "position": position,
                "group_id": group_id,
                "break": event.get("break", False),
                "ex": event.get("ex", False),
            }
        )
    onset_by_id = {event["event_id"]: event for event in chart["onsets"]}
    for hold in raw.get("holds", []):
        _keys(hold, {"hold_id", "onset_id", "end_us"}, {"hold_id", "onset_id", "end_us"}, "hold")
        onset = onset_by_id.get(hold["onset_id"])
        if onset is None or onset["role"] not in {"hold_onset", "touch_hold"}:
            raise ChartInputError("Hold must link an existing hold input onset")
        end = _integer(hold["end_us"], "hold end", negative=True)
        if end < onset["time_us"]:
            raise ChartInputError("Hold ends before its onset")
        chart["holds"].append(
            {
                "hold_id": _text(hold["hold_id"], "hold ID"),
                "onset_id": hold["onset_id"],
                "start_us": onset["time_us"],
                "end_us": end,
            }
        )
    linked_holds = [hold["onset_id"] for hold in chart["holds"]]
    if len(linked_holds) != len(set(linked_holds)):
        raise ChartInputError("Duplicate hold interval for one physical onset")
    linked_hold_ids = set(linked_holds)
    if "hold_intervals" in caps and any(
        event["event_id"] not in linked_hold_ids
        for event in chart["onsets"]
        if event["role"] in {"hold_onset", "touch_hold"}
    ):
        raise ChartInputError("Complete hold intervals require every hold end")
    for slide in raw.get("slides", []):
        _keys(
            slide,
            {
                "path_id",
                "head_id",
                "wait_start_us",
                "wait_end_us",
                "movement_start_us",
                "movement_end_us",
                "segment_ids",
                "path",
            },
            {"path_id", "wait_start_us", "wait_end_us", "movement_start_us", "movement_end_us"},
            "slide",
        )
        normalized = {
            key: _integer(slide[key], key, negative=True)
            for key in ("wait_start_us", "wait_end_us", "movement_start_us", "movement_end_us")
        }
        if sorted(normalized.values()) != list(normalized.values()):
            raise ChartInputError("Slide wait/movement times must be nondecreasing")
        head = slide.get("head_id")
        if head is not None and (
            head not in onset_by_id or onset_by_id[head]["role"] not in {"tap", "star_tap"}
        ):
            raise ChartInputError("Slide head must link one existing tap or star-tap input")
        if head is not None and onset_by_id[head]["time_us"] > normalized["wait_start_us"]:
            raise ChartInputError("Slide wait cannot precede its head")
        segments = slide.get("segment_ids", [])
        if not isinstance(segments, list) or len(segments) > 128:
            raise ChartInputError("Invalid connected slide segments")
        segments = [_text(item, "segment ID") for item in segments]
        if len(segments) != len(set(segments)):
            raise ChartInputError("Duplicate connected segment ID")
        path = slide.get("path")
        if path is not None:
            _text(path, "documented path representation", 1024)
        chart["slides"].append(
            {
                **normalized,
                "path_id": _text(slide["path_id"], "path ID"),
                "head_id": head,
                "segment_ids": segments,
                "path": path,
            }
        )
    for name, key in (("holds", "hold_id"), ("slides", "path_id")):
        identifiers = [item[key] for item in chart[name]]
        if len(identifiers) != len(set(identifiers)):
            raise ChartInputError(f"Duplicate {name} identity")
    times = [item["time_us"] for item in chart["onsets"]]
    times += [
        item[key]
        for item in chart["slides"]
        for key in ("wait_start_us", "wait_end_us", "movement_start_us", "movement_end_us")
    ]
    times += [item["end_us"] for item in chart["holds"]]
    origin_shift = max(0, -min(times, default=0))
    for field, time_keys in (
        ("onsets", ("time_us",)),
        ("holds", ("start_us", "end_us")),
        ("slides", ("wait_start_us", "wait_end_us", "movement_start_us", "movement_end_us")),
    ):
        for event in chart[field]:
            for key in time_keys:
                event[key] += origin_shift
        chart[field].sort(key=lambda item: canonical_bytes(item))
    chart["onsets"].sort(key=lambda item: (item["time_us"], item["event_id"]))
    chart["origin_shift_us"] = origin_shift
    chart["source_offset_us"] = _integer(
        raw.get("source_offset_us", 0), "source offset", negative=True
    )
    chart["audio_offset_us"] = raw.get("audio_offset_us")
    if chart["audio_offset_us"] is not None:
        _integer(chart["audio_offset_us"], "audio offset", negative=True)
    first, last = min(times, default=0) + origin_shift, max(times, default=0) + origin_shift
    track_duration = raw.get("track_duration_us")
    if track_duration is not None:
        _integer(track_duration, "verified chart-aligned track duration")
        if track_duration < last:
            raise ChartInputError("Verified track duration truncates active chart events")
        if any(event["time_us"] >= track_duration for event in chart["onsets"]):
            raise ChartInputError("Input onset lies at or beyond the half-open track end")
    chart["span_start_us"] = 0 if track_duration is not None else first
    # A point onset has zero duration; a one-microsecond span includes the final point.
    last_input_end = max((event["time_us"] + 1 for event in chart["onsets"]), default=0)
    chart["span_end_us"] = (
        track_duration if track_duration is not None else max(last, last_input_end)
    )
    if chart["span_end_us"] > MAX_DURATION_US:
        raise ChartInputError("Chart exceeds duration limit")
    chart["span_basis"] = "verified_track_duration" if track_duration is not None else "chart_span"
    known = raw.get("known_intervals")
    if known is None:
        known = [[chart["span_start_us"], chart["span_end_us"]]] if "timing" in caps else []
    else:
        if not isinstance(known, list) or len(known) > 4096:
            raise ChartInputError("Invalid known intervals")
        normalized_known = []
        for interval in known:
            if not isinstance(interval, list) or len(interval) != 2:
                raise ChartInputError("Known interval must have two endpoints")
            start, end = [
                _integer(value, "known interval", negative=True) + origin_shift
                for value in interval
            ]
            if not chart["span_start_us"] <= start <= end <= chart["span_end_us"]:
                raise ChartInputError("Known interval lies outside analyzed span")
            normalized_known.append([start, end])
        known = sorted(normalized_known)
        if any(left[1] > right[0] for left, right in zip(known, known[1:], strict=False)):
            raise ChartInputError("Known intervals must not overlap")
    chart["known_intervals"] = known
    groups: dict[str, int] = {}
    for event in chart["onsets"]:
        group = event["group_id"]
        if group is not None:
            if group in groups and groups[group] != event["time_us"]:
                raise ChartInputError("Authored simultaneous group has different onset times")
            groups[group] = event["time_us"]
    chart["bpm_segments"] = []
    if not isinstance(raw.get("bpm_segments", []), list) or len(raw.get("bpm_segments", [])) > 2048:
        raise ChartInputError("BPM segments must be a bounded list")
    for segment in raw.get("bpm_segments", []):
        _keys(segment, {"time_us", "beat", "bpm"}, {"time_us", "beat", "bpm"}, "BPM segment")
        bpm, beat = (
            _beat(segment[key], schema_version=raw["schema_version"]) for key in ("bpm", "beat")
        )
        if bpm is None or beat is None or not 1 <= decode_rational(bpm) <= 2000:
            raise ChartInputError("Invalid BPM segment")
        chart["bpm_segments"].append(
            {
                "time_us": _integer(segment["time_us"], "BPM time", negative=True) + origin_shift,
                "beat": beat,
                "bpm": bpm,
            }
        )
    chart["bpm_segments"].sort(key=lambda item: item["time_us"])
    # Retain one exact clock across tempo changes. Re-seeding from each rounded
    # anchor would accumulate rounding drift. Round in source time before the
    # integer origin shift, which preserves ties-to-even for negative inputs too.
    expected_anchor_us = (
        Fraction(chart["bpm_segments"][0]["time_us"] - origin_shift)
        if chart["bpm_segments"]
        else Fraction(0)
    )
    for previous, current in zip(chart["bpm_segments"], chart["bpm_segments"][1:], strict=False):
        beat_delta = decode_rational(current["beat"]) - decode_rational(previous["beat"])
        expected_anchor_us += beat_delta * 60_000_000 / decode_rational(previous["bpm"])
        if (
            current["time_us"] <= previous["time_us"]
            or beat_delta <= 0
            or current["time_us"] != round(expected_anchor_us) + origin_shift
        ):
            raise ChartInputError("BPM anchors must be continuous and strictly ordered")
    anchor_times = [segment["time_us"] for segment in chart["bpm_segments"]]
    previous_beat = None
    for event in chart["onsets"]:
        current_beat = decode_rational(event["beat"]) if event["beat"] is not None else None
        if current_beat is not None and previous_beat is not None and current_beat < previous_beat:
            raise ChartInputError("Onset beats must not go backwards in chart time")
        if current_beat is not None:
            previous_beat = current_beat
        anchor_index = bisect_right(anchor_times, event["time_us"]) - 1
        if event["beat"] is not None and anchor_index >= 0:
            anchor = chart["bpm_segments"][anchor_index]
            expected_us = anchor["time_us"] + (
                decode_rational(event["beat"]) - decode_rational(anchor["beat"])
            ) * 60_000_000 / decode_rational(anchor["bpm"])
            if abs(expected_us - event["time_us"]) > 2:
                raise ChartInputError("Onset beat disagrees with BPM timeline")
    diagnostics = raw.get("diagnostics", [])
    if not isinstance(diagnostics, list) or len(diagnostics) > 128:
        raise ChartInputError("Invalid bounded diagnostics")
    chart["diagnostics"] = sorted(_text(item, "diagnostic", 512) for item in diagnostics)
    chart["geometry_version"] = raw.get("geometry_version")
    if chart["geometry_version"] is not None:
        _text(chart["geometry_version"], "geometry version")
    chart["schema_version"] = raw["schema_version"]
    return chart


def normalize_chart(raw: dict) -> dict:
    """Validate malformed caller data through one documented exception boundary."""
    try:
        return _normalize_chart(raw)
    except ChartInputError:
        raise
    except (TypeError, KeyError, OverflowError, RecursionError) as error:
        raise ChartInputError("Invalid normalized chart field type or nesting") from error
