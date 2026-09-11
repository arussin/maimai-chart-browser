"""Strict, independently implemented Simai notation reader for offline evaluation.

The historical module/function name remains compatible with existing callers.
This reads one inote body, optionally with its single slot-checked inote header.
Other maidata metadata, audio and native game files remain unsupported.
References: https://w.atwiki.jp/simai/pages/1002.html and /1003.html.
Every character is consumed as notation, whitespace, a recorded line comment
or the recorded leading header.
Slide geometry and game fidelity are not inferred from successful parsing.
"""

from __future__ import annotations

import hashlib
import re
from bisect import bisect_right
from copy import deepcopy
from fractions import Fraction

from .contracts import (
    CAPABILITIES,
    EXACT_RATIONAL_SCHEMA_VERSION,
    MAX_DURATION_US,
    MAX_EVENTS,
    ChartInputError,
    normalize_chart,
)
from .rational import RationalEncodingError, encode_rational
from .simai_notation import NoteSyntaxError, parse_note
from .simai_timing import TimingSyntaxError, duration, number

PARSER_VERSION = "simai-notation-0.3.3"
MAX_TEXT_BYTES = 1024 * 1024
MAX_TIMING_COMMANDS = 20_000
MAX_RATIONAL_BITS = 4096
INOTE_DIFFICULTIES = ("EASY", "BASIC", "ADVANCED", "EXPERT", "MASTER", "RE:MASTER")


class SimaiSubsetError(ChartInputError):
    """Unsupported or malformed notation; no partially parsed body is returned."""


def _pair(value: Fraction) -> list[int] | list[str]:
    try:
        return encode_rational(value)
    except RationalEncodingError as error:
        raise SimaiSubsetError(str(error)) from error


def _microseconds(seconds: Fraction) -> int:
    if max(seconds.numerator.bit_length(), seconds.denominator.bit_length()) > MAX_RATIONAL_BITS:
        raise SimaiSubsetError("Exact timing exceeds the bounded rational arithmetic limit")
    value = round(seconds * 1_000_000)
    if not 0 <= value <= MAX_DURATION_US:
        raise SimaiSubsetError("Chart timeline exceeds the one-hour normalized limit")
    return value


def parse_simai_subset(
    text: str,
    *,
    chart_id: str,
    song_id: str,
    format: str,
    difficulty: str,
    revision: str,
    source: dict,
) -> tuple[dict, dict]:
    """Return normalized input and a separate source-position/notation audit.

    Fractions retain exact accumulated time across tempo/division changes. Only
    absolute timestamps are rounded, once, to nearest microsecond (ties even).
    Durations use the tempo declared at the note; later chart tempo commands do
    not stretch an existing hold or slide. Pseudo-EACH offsets are milliseconds,
    and never become an authored simultaneous group.
    """
    if not isinstance(text, str):
        raise SimaiSubsetError("Simai body must be text")
    try:
        body_bytes = text.encode("utf-8")
    except UnicodeError as error:
        raise SimaiSubsetError("Simai body must be valid Unicode text") from error
    if len(body_bytes) > MAX_TEXT_BYTES:
        raise SimaiSubsetError("Simai body exceeds its one-MiB limit")
    if not isinstance(source, dict):
        raise SimaiSubsetError("Source identity must be supplied explicitly")
    # Creator's maidata variable reference /simai/pages/510.html maps slots 1-6
    # to these difficulties. This is one leading container header, never a
    # search for a later body that could discard preceding notation.
    container_header = None
    header = re.match(r"[ \t\r\n\u3000]*(&inote_([1-6])=)", text)
    if header is not None:
        slot_number = int(header.group(2))
        declared_difficulty = INOTE_DIFFICULTIES[slot_number - 1]
        if difficulty != declared_difficulty:
            raise SimaiSubsetError(
                "Inote header difficulty does not match the declared chart difficulty "
                f"at source character {header.start(1)}"
            )
        container_header = {
            "slot": slot_number,
            "difficulty": declared_difficulty,
            "source_start": header.start(1),
            "source_end": header.end(1),
            "source_text": header.group(1),
        }
    offsets, comments = [], []
    ideographic_space_used = False
    index = 0
    while index < len(text):
        if container_header is not None and index == container_header["source_start"]:
            index = container_header["source_end"]
        elif text.startswith("||", index):
            end = text.find("\n", index + 2)
            if end < 0:
                raise SimaiSubsetError(
                    f"Line comment requires a newline at source character {index}"
                )
            comments.append(
                {"source_start": index, "source_end": end + 1, "source_text": text[index : end + 1]}
            )
            index = end + 1
        else:
            if text[index] == "&":
                raise SimaiSubsetError(
                    "Only a single leading slot-matched inote header is supported; "
                    "additional or embedded metadata is not allowed "
                    f"at source character {index}"
                )
            ideographic_space_used |= text[index] == "\u3000"
            if text[index] not in " \t\r\n\u3000":
                offsets.append(index)
            index += 1
    compact = "".join(text[index] for index in offsets)
    source = deepcopy(source)
    source.update(parser_version=PARSER_VERSION, normalizer_version=EXACT_RATIONAL_SCHEMA_VERSION)
    raw = {
        "schema_version": EXACT_RATIONAL_SCHEMA_VERSION,
        "chart_id": chart_id,
        "song_id": song_id,
        "format": format,
        "difficulty": difficulty,
        "revision": revision,
        "source": source,
        "capabilities": sorted(CAPABILITIES - {"span"}),
        "onsets": [],
        "holds": [],
        "slides": [],
        "bpm_segments": [],
        "source_offset_us": 0,
        "audio_offset_us": None,
        "track_duration_us": None,
        "geometry_version": None,
        "diagnostics": [
            "Strict Simai notation; source-variant review is not game-byte verification.",
            "Slide paths retain notation only; geometry and path speed are unavailable.",
            "Time is relative to the body start; audio offset and track duration are unknown.",
            "Firework/appearance and slide-track flags remain in the separate parse audit.",
            "Connected slides retain total movement intervals; "
            "no geometric segment times are invented.",
        ],
    }
    audit = {
        "parser_version": PARSER_VERSION,
        "body_sha256": hashlib.sha256(body_bytes).hexdigest(),
        "source_offset_unit": "Unicode code-point index, zero-based and half-open",
        "time_basis": "body start at beat zero; exact fractions rounded once to microseconds",
        "rounding": "nearest microsecond, ties to even",
        "tokens": [],
        "commands": [],
        "comments": comments,
        "end_marker": None,
        "dialect_aliases": ["ideographic_space"] if ideographic_space_used else [],
        "framing": {
            "termination": None,
            "final_slot_comma": None,
            "source_completeness": "unknown",
        },
        "path_geometry_validated": False,
        "unsupported_syntax_policy": "reject entire body; never skip notes or timing",
    }
    if container_header is not None:
        audit["container_header"] = container_header
        audit["dialect_aliases"].append("single_inote_wrapper")

    def fail(message: str, at: int) -> None:
        original = offsets[at] if at < len(offsets) else len(text)
        raise SimaiSubsetError(f"{message} at source character {original}")

    def location(start: int, end: int) -> dict:
        original_start, original_end = offsets[start], offsets[end - 1] + 1
        return {
            "source_start": original_start,
            "source_end": original_end,
            "source_text": text[original_start:original_end],
            "token": compact[start:end],
        }

    def timing_number(value: str, at: int) -> Fraction:
        try:
            return number(value)
        except TimingSyntaxError as error:
            fail(str(error), at)

    # Read declared clock first: delayed pseudo-EACH inputs may cross an anchor.
    timeline, notes = [], []
    bpm, division, fixed_seconds = None, None, None
    beat, seconds = Fraction(0), Fraction(0)
    cursor, slot, event_budget = 0, 0, 0
    while cursor < len(compact):
        while cursor < len(compact) and compact[cursor] in "({":
            start = cursor
            opening = compact[cursor]
            closing = ")" if opening == "(" else "}"
            end = compact.find(closing, cursor + 1)
            if end < 0:
                fail("Unclosed timing command", cursor)
            value = compact[cursor + 1 : end]
            if opening == "(":
                bpm = timing_number(value, cursor)
                if not 1 <= bpm <= 2000:
                    fail("BPM must be between 1 and 2000", cursor)
                anchor = {"seconds": seconds, "beat": beat, "bpm": bpm}
                if timeline and timeline[-1]["seconds"] == seconds:
                    timeline[-1] = anchor
                elif not timeline or timeline[-1]["bpm"] != bpm:
                    timeline.append(anchor)
                if len(timeline) > 2048:
                    fail("BPM segment limit exceeded", cursor)
            else:
                if bpm is None:
                    fail("BPM must precede the division", cursor)
                if value.startswith("#"):
                    fixed_seconds, division = timing_number(value[1:], cursor), None
                else:
                    division, fixed_seconds = timing_number(value, cursor), None
            cursor = end + 1
            audit["commands"].append(
                {
                    **location(start, cursor),
                    "beat": _pair(beat),
                    "seconds": _pair(seconds),
                    "kind": "bpm" if opening == "(" else "division",
                }
            )
            if len(audit["commands"]) > MAX_TIMING_COMMANDS:
                fail("Timing command limit exceeded", start)
        if bpm is None or (division is None and fixed_seconds is None):
            fail("An initial BPM and division are required", cursor)
        if cursor >= len(compact):
            break
        time_us = _microseconds(seconds)
        if compact[cursor:] in {"E", "E,"}:
            audit["end_marker"] = {
                **location(cursor, cursor + 1),
                "beat": _pair(beat),
                "seconds": _pair(seconds),
                "time_us": time_us,
            }
            audit["framing"]["termination"] = "explicit_E"
            cursor += 1
            if cursor < len(compact):
                audit["dialect_aliases"].append("comma_after_terminal_E")
                audit["framing"]["trailing_delimiter"] = location(cursor, cursor + 1)
                cursor += 1
            break
        if compact[cursor] == "E" and compact[cursor + 1 : cursor + 2] not in "12345678":
            fail("E must be the final notation", cursor)
        end = compact.find(",", cursor)
        has_comma = end >= 0
        if (end < 0 and compact.endswith("E")) or (
            end == len(compact) - 1 and compact.endswith("E,")
        ):
            # E closes the final note group at the current clock position.
            # A comma after E is a trailing delimiter, not another time step.
            end = len(compact) - (2 if compact.endswith("E,") else 1)
            has_comma = False
            audit["dialect_aliases"].append("terminal_E_without_comma")
        elif end < 0:
            fail("Final note slot requires a comma or terminal E", cursor)
        audit["framing"]["final_slot_comma"] = has_comma
        cell = compact[cursor:end]
        if cell:
            group_start = cursor
            pseudo_groups = cell.split("`")
            for pseudo_index, group in enumerate(pseudo_groups):
                if not group:
                    fail("Empty pseudo-EACH component", group_start)
                strings = group.split("/")
                if any(not part for part in strings):
                    fail("Empty EACH component", group_start)
                tap_only = re.fullmatch(r"[1-8/]+", group) is not None
                parts, part_start = [], group_start
                for part in strings:
                    if tap_only:
                        parts.extend(
                            (char, part_start + offset) for offset, char in enumerate(part)
                        )
                    else:
                        parts.append((part, part_start))
                    part_start += len(part) + 1
                group_notes, positions = [], set()
                for token, token_start in parts:
                    try:
                        note = parse_note(token)
                    except NoteSyntaxError as error:
                        fail(error.message, token_start + error.offset)
                    if note["role"] is not None:
                        if note["position"] in positions:
                            fail(
                                "Duplicate same-position EACH input; shared slides require *",
                                token_start,
                            )
                        positions.add(note["position"])
                    event_budget += (
                        int(note["role"] is not None)
                        + int(note["hold_duration"] is not None)
                        + len(note["branches"])
                    )
                    if event_budget >= MAX_EVENTS:
                        fail("Normalized event limit exceeded", token_start)
                    group_notes.append((note, token, token_start))
                count = sum(note["role"] is not None for note, _, _ in group_notes)
                group_id = f"simai-each-{slot:06d}" if count > 1 else None
                if group_id and len(pseudo_groups) > 1:
                    group_id += f"-p{pseudo_index:03d}"
                for note, token, token_start in group_notes:
                    notes.append(
                        (
                            note,
                            token,
                            token_start,
                            seconds + Fraction(pseudo_index, 1000),
                            bpm,
                            group_id,
                        )
                    )
                group_start += len(group) + 1
        if not has_comma:
            cursor = end
            continue
        delta = fixed_seconds if fixed_seconds is not None else 240 / (bpm * division)
        next_seconds = seconds + delta
        if _microseconds(next_seconds) <= time_us:
            fail("Division is below normalized microsecond resolution", cursor)
        beat += delta * bpm / 60
        seconds = next_seconds
        slot += 1
        cursor = end + 1
    if audit["end_marker"] is None:
        if not compact.endswith(",") or not slot:
            fail("Terminal E is required unless the final slot has a comma", cursor)
        audit["dialect_aliases"].append("terminal_E_omitted")
        audit["framing"]["termination"] = "eof_after_comma"
    if audit["dialect_aliases"]:
        raw["diagnostics"].append(
            "Source compatibility aliases: " + ", ".join(audit["dialect_aliases"]) + ". "
            "Every supplied note is parsed; source completeness and track duration remain unknown."
        )

    anchor_seconds = [segment["seconds"] for segment in timeline]

    def beat_at(at: Fraction) -> Fraction:
        anchor = timeline[bisect_right(anchor_seconds, at) - 1]
        return anchor["beat"] + (at - anchor["seconds"]) * anchor["bpm"] / 60

    raw["bpm_segments"] = [
        {
            "time_us": _microseconds(item["seconds"]),
            "beat": _pair(item["beat"]),
            "bpm": _pair(item["bpm"]),
        }
        for item in timeline
    ]

    def note_duration(spec: str, tempo: Fraction, start: int, *, slide: bool) -> dict:
        try:
            return duration(spec, tempo, slide=slide)
        except TimingSyntaxError as error:
            fail(str(error), start)

    for note, token, token_start, seconds, tempo, group_id in notes:
        time_us, beat = _microseconds(seconds), beat_at(seconds)
        event_id = None
        if note["role"] is not None:
            event_id = f"simai-onset-{len(raw['onsets']):06d}"
            raw["onsets"].append(
                {
                    "event_id": event_id,
                    "time_us": time_us,
                    "beat": _pair(beat),
                    "position": note["position"],
                    "role": note["role"],
                    "group_id": group_id,
                    "break": note["break"],
                    "ex": note["ex"],
                }
            )
        token_audit = {
            **location(token_start, token_start + len(token)),
            "onset_id": event_id,
            "beat": _pair(beat),
            "seconds": _pair(seconds),
            "role": note["role"],
            "head_break": note["break"],
            "head_ex": note["ex"],
            "start_position": note["position"],
            "presentation": note["presentation"],
            "firework": note["firework"],
            "implicit_duration": note["implicit_duration"],
            "dialect_aliases": note["dialect_aliases"],
            "paths": [],
        }
        if note["hold_duration"] is not None:
            held = note_duration(note["hold_duration"], tempo, token_start, slide=False)
            end_us = _microseconds(seconds + held["seconds"])
            if held["seconds"] == 0:
                token_audit["dialect_aliases"].append("zero_duration_hold")
            elif end_us <= time_us:
                fail("Hold duration is below normalized microsecond resolution", token_start)
            hold_id = f"simai-hold-{len(raw['holds']):06d}"
            raw["holds"].append({"hold_id": hold_id, "onset_id": event_id, "end_us": end_us})
            token_audit.update(
                hold_id=hold_id,
                duration_beats=_pair(held["beats"]),
                duration_seconds=_pair(held["seconds"]),
            )
        for branch in note["branches"]:
            segments = branch["segments"]
            specs = [segments[-1]] if branch["duration_mode"] == "global" else segments
            timings = [
                note_duration(segment["duration"], tempo, token_start, slide=True)
                for segment in specs
            ]
            if any(segment["duration"].startswith("[#") for segment in specs):
                token_audit["dialect_aliases"].append("slide_seconds_without_bpm")
            if any(item["explicit_wait"] for item in timings[1:]):
                fail("Connected slide intermediate explicit waits are unsupported", token_start)
            movement = sum((item["seconds"] for item in timings), Fraction(0))
            waiting = timings[0]["wait_seconds"]
            movement_start, movement_end = seconds + waiting, seconds + waiting + movement
            if _microseconds(movement_end) <= _microseconds(movement_start):
                fail("Slide duration is below normalized microsecond resolution", token_start)
            path_id = f"simai-path-{len(raw['slides']):06d}"
            segment_ids = (
                [f"{path_id}-segment-{index:03d}" for index in range(len(segments))]
                if len(segments) > 1
                else []
            )
            path = str(segments[0]["start"]) + "".join(
                segment["shape"]
                + (str(segment["turn"]) if segment["turn"] is not None else "")
                + str(segment["end"])
                for segment in segments
            )
            raw["slides"].append(
                {
                    "path_id": path_id,
                    "head_id": event_id,
                    "wait_start_us": time_us,
                    "wait_end_us": _microseconds(movement_start),
                    "movement_start_us": _microseconds(movement_start),
                    "movement_end_us": _microseconds(movement_end),
                    "segment_ids": segment_ids,
                    "path": "simai:" + path,
                }
            )
            path_audit = {
                "path_id": path_id,
                "path_shape": segments[0]["shape"] if len(segments) == 1 else "connected",
                "path_notation": path,
                "source_path_notation": branch["path_notation"],
                "turning_position": segments[0]["turn"] if len(segments) == 1 else None,
                "end_position": segments[-1]["end"],
                "wait_beats": _pair(waiting * tempo / 60),
                "wait_seconds": _pair(waiting),
                "duration_beats": _pair(movement * tempo / 60),
                "duration_seconds": _pair(movement),
                "break": branch["break"],
                "duration_mode": branch["duration_mode"],
                "segments": segments,
                "segment_timing": "explicit_durations"
                if branch["duration_mode"] == "per_segment"
                else "total_only_no_geometry",
            }
            if branch["duration_mode"] == "per_segment":
                at = movement_start
                path_audit["segment_movement_seconds"] = []
                for item in timings:
                    path_audit["segment_movement_seconds"].append(
                        [_pair(at), _pair(at + item["seconds"])]
                    )
                    at += item["seconds"]
            token_audit["paths"].append(path_audit)
        if len(token_audit["paths"]) == 1:
            token_audit.update(token_audit["paths"][0])
        audit["tokens"].append(token_audit)
    normalize_chart(raw)
    audit["counts"] = {
        "onsets": len(raw["onsets"]),
        "holds": len(raw["holds"]),
        "slide_paths": len(raw["slides"]),
        "comma_slots": slot,
    }
    return raw, audit
