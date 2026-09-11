"""Exact, bounded Simai timing parameters, independent of chart traversal.

References: creator's notation specification /simai/pages/1002.html and
/1003.html, and timing/hold/slide manuals /20.html, /22.html, /23.html.
Durations are evaluated against the BPM at the note, not later tempo commands.
"""

from __future__ import annotations

import re
from fractions import Fraction

NUMBER = r"[0-9]{1,6}(?:\.[0-9]{1,32})?"


class TimingSyntaxError(ValueError):
    """Invalid or unsupported timing parameter; never a default replacement."""


def number(text: str, *, zero: bool = False) -> Fraction:
    if re.fullmatch(NUMBER, text) is None:
        if re.fullmatch(r"[0-9]+(?:\.[0-9]+)?", text) is None:
            raise TimingSyntaxError("Timing parameter requires a decimal number")
        raise TimingSyntaxError("Timing numbers require at most six integer and 32 decimal digits")
    value = Fraction(text)
    if value < 0 or (value == 0 and not zero):
        raise TimingSyntaxError("Timing value must be positive" if not zero else "Negative time")
    return value


def duration(spec: str, bpm: Fraction, *, slide: bool) -> dict:
    """Return exact seconds and declared parameters for one bracket duration.

    The optional wait applies once at the start of a slide, never between connected
    segments. An explicit per-segment chain can use a BPM override for movement;
    an intermediate explicit wait remains unsupported by the caller.
    """
    if (
        not isinstance(spec, str)
        or len(spec) > 128
        or not spec.startswith("[")
        or not spec.endswith("]")
    ):
        raise TimingSyntaxError("Duration requires bounded square brackets")
    value = spec[1:-1]
    wait = Fraction(60) / bpm if slide else Fraction(0)
    explicit_wait = False
    duration_bpm = bpm
    if "##" in value:
        if not slide or value.count("##") != 1:
            raise TimingSyntaxError("Explicit waiting is only valid for a slide")
        waiting, value = value.split("##")
        wait = number(waiting, zero=True)
        explicit_wait = True
    seconds_form = False
    if "#" in value:
        if value.count("#") != 1:
            raise TimingSyntaxError("Malformed duration BPM override")
        tempo, value = value.split("#")
        if tempo:
            duration_bpm = number(tempo)
            if slide and not explicit_wait:
                wait = Fraction(60) / duration_bpm
        elif ":" in value:
            raise TimingSyntaxError("Beat duration BPM override cannot be empty")
        seconds_form = ":" not in value
    elif explicit_wait and ":" not in value:
        seconds_form = True
    if ":" in value:
        if value.count(":") != 1:
            raise TimingSyntaxError("Malformed beat duration")
        divisor_text, multiple_text = value.split(":")
        divisor = number(divisor_text)
        multiple = number(multiple_text, zero=not slide)
        beats = 4 * multiple / divisor
        seconds = beats * 60 / duration_bpm
    elif seconds_form:
        seconds = number(value, zero=not slide)
        beats = seconds * duration_bpm / 60
    else:
        raise TimingSyntaxError("Duration requires n:m, #seconds or a documented override")
    return {
        "seconds": seconds,
        "wait_seconds": wait,
        "beats": beats,
        "bpm": duration_bpm,
        "explicit_wait": explicit_wait,
        "seconds_form": seconds_form,
    }
