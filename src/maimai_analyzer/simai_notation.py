"""Bounded note-token AST for documented Simai notation, without timing or geometry.

The caller owns comma/EACH/backtick grouping, source offsets and exact duration
interpretation. This module consumes one complete compact note token. Durations
remain bracketed strings; no BPM, time, position geometry or account state enters
this lexical layer. Presentation records modifier characters in source order.

Simulator modifier aliases are documented in docs/SIMAI_COMPATIBILITY_ALIASES.md.
They preserve explicit source flags; they do not establish official game mechanics.
"""

from __future__ import annotations

import re

MAX_TOKEN_CHARS = 4096
MAX_BRANCHES = 128
MAX_SEGMENTS = 128
MAX_DURATION_CHARS = 128
SHAPES = ("pp", "qq", "-", "^", "<", ">", "v", "p", "q", "s", "z", "V", "w")


class NoteSyntaxError(ValueError):
    """A token is malformed, unsupported or outside bounded lexical resources."""

    def __init__(self, message: str, offset: int = 0):
        self.message = message
        self.offset = offset
        super().__init__(f"{message} at token character {offset}")


def _duration(token: str, cursor: int) -> tuple[str, int]:
    end = token.find("]", cursor + 1)
    if end < 0:
        raise NoteSyntaxError("Unclosed duration", cursor)
    value = token[cursor : end + 1]
    if len(value) > MAX_DURATION_CHARS or re.fullmatch(r"\[[0-9.:#]+\]", value) is None:
        raise NoteSyntaxError("Unsupported or oversized duration spelling", cursor)
    return value, end + 1


def _flags(token: str, cursor: int) -> tuple[list[str], int]:
    flags = []
    while cursor < len(token) and token[cursor] in "bhxf$@!?":
        flag = token[cursor]
        maximum = 2 if flag == "$" else 1
        if flags.count(flag) >= maximum:
            raise NoteSyntaxError("Repeated note modifier", cursor)
        flags.append(flag)
        cursor += 1
    return flags, cursor


def _branch(token: str, head: int, start: int) -> dict:
    cursor, position, segments = start, head, []
    break_before_duration = False
    ex_before_duration = False
    aliases = []
    while cursor < len(token) and token[cursor] not in "bx":
        if break_before_duration:
            raise NoteSyntaxError("Whole-chain break must mark the final segment", cursor)
        if ex_before_duration:
            raise NoteSyntaxError("Slide-head EX alias must mark the final duration", cursor)
        shape = next((shape for shape in SHAPES if token.startswith(shape, cursor)), None)
        if shape is None:
            raise NoteSyntaxError("Expected a documented slide shape", cursor)
        cursor += len(shape)
        count = 2 if shape == "V" else 1
        digits = token[cursor : cursor + count]
        if len(digits) != count or any(char not in "12345678" for char in digits):
            raise NoteSyntaxError("Slide shape needs button endpoints", cursor)
        turn = int(digits[0]) if shape == "V" else None
        end = int(digits[-1])
        cursor += count
        duration = None
        if token.startswith("x[", cursor):
            ex_before_duration = True
            aliases.append("slide_head_ex_before_duration")
            cursor += 1
        if token.startswith("b[", cursor):
            break_before_duration = True
            aliases.append("track_break_before_duration")
            cursor += 1
        if cursor < len(token) and token[cursor] == "[":
            duration, cursor = _duration(token, cursor)
        segments.append(
            {
                "start": position,
                "shape": shape,
                "end": end,
                "turn": turn,
                "duration": duration,
            }
        )
        if len(segments) > MAX_SEGMENTS:
            raise NoteSyntaxError("Slide segment limit exceeded", cursor)
        position = end
    suffix = token[cursor:]
    if suffix not in {"", "b", "x", "xb"}:
        raise NoteSyntaxError("Unsupported trailing slide notation", cursor)
    ex_after_duration = suffix in {"x", "xb"}
    if ex_after_duration:
        if ex_before_duration:
            raise NoteSyntaxError("Repeated slide-head EX modifier", cursor)
        aliases.append("slide_head_ex_after_duration")
    broken = suffix in {"b", "xb"}
    if broken:
        if break_before_duration:
            raise NoteSyntaxError("Repeated track break modifier", cursor)
        if not segments or segments[-1]["duration"] is None:
            raise NoteSyntaxError("Track break must follow the final duration", cursor)
    if not segments or segments[-1]["duration"] is None:
        raise NoteSyntaxError("Slide requires a final duration", cursor)
    durations = sum(segment["duration"] is not None for segment in segments)
    if durations == len(segments):
        mode = "per_segment"
    elif durations == 1:
        mode = "global"
    else:
        raise NoteSyntaxError("Connected slide timings must cover every segment or only the total")
    return {
        "segments": segments,
        "duration_mode": mode,
        "break": broken or break_before_duration,
        "path_notation": token[start:],
        "dialect_aliases": aliases,
        "_head_ex": ex_before_duration or ex_after_duration,
    }


def parse_note(token: str) -> dict:
    """Return one note AST, consuming the complete token or raising NoteSyntaxError.

    ``role`` is None only for a headless slide. ``presentation`` preserves $/$$,
    @, ? and ! as a list of characters. ``implicit_duration`` distinguishes a
    documented bare hold's [1280:1] duration from an explicitly written duration.
    Each * branch inherits the physical head position. Global chain durations
    assign no intermediate timing; segments retain only notation and endpoints.
    """
    if not isinstance(token, str) or not 1 <= len(token) <= MAX_TOKEN_CHARS:
        raise NoteSyntaxError("Note token must be nonempty bounded text")
    if any(char.isspace() for char in token):
        raise NoteSyntaxError("Note token must be compact; caller owns source whitespace")
    cursor = 1
    touch = token[0] in "ABCDE"
    if token[0] in "12345678":
        position: int | str = int(token[0])
    elif touch:
        region = token[0]
        digit = token[cursor : cursor + 1]
        if region == "C":
            if digit in {"1", "2"}:
                cursor += 1
            elif digit.isdigit():
                raise NoteSyntaxError("Center touch accepts C, C1 or C2", cursor)
            position = "C"
        else:
            if digit not in "12345678" or not digit:
                raise NoteSyntaxError("Touch region needs a button index", cursor)
            position = region + digit
            cursor += 1
    else:
        raise NoteSyntaxError("Expected a button or documented touch zone")
    flags, cursor = _flags(token, cursor)
    held = "h" in flags
    result = {
        "position": position,
        "role": "touch_hold"
        if touch and held
        else "touch"
        if touch
        else "hold_onset"
        if held
        else "tap",
        "break": "b" in flags,
        "ex": "x" in flags,
        "firework": "f" in flags,
        "presentation": [flag for flag in flags if flag in "$@!?"],
        "hold_duration": None,
        "implicit_duration": False,
        "branches": [],
        "dialect_aliases": [],
    }
    if touch:
        if set(flags) - {"h", "f", "x"}:
            raise NoteSyntaxError("Touch inputs support only hold, firework and dialect EX")
    elif "f" in flags:
        raise NoteSyntaxError("Firework modifier requires a touch input")
    if held:
        if result["presentation"]:
            raise NoteSyntaxError("Hold presentation modifiers are unsupported")
        if cursor < len(token) and token[cursor] == "[":
            result["hold_duration"], cursor = _duration(token, cursor)
            suffix = token[cursor:]
            if suffix == "x" and not touch and not result["ex"]:
                result["ex"] = True
                result["dialect_aliases"].append("hold_ex_after_duration")
                cursor += 1
            elif suffix == "b" and not touch and not result["break"]:
                result["break"] = True
                result["dialect_aliases"].append("hold_break_after_duration")
                cursor += 1
            elif suffix == "x" and touch and not result["ex"]:
                result["ex"] = True
                result["dialect_aliases"].append("touch_hold_ex_after_duration")
                cursor += 1
            elif suffix == "f" and touch and not result["firework"]:
                result["firework"] = True
                result["dialect_aliases"].append("touch_firework_after_duration")
                cursor += 1
        else:
            result["hold_duration"] = "[1280:1]"
            result["implicit_duration"] = True
        if cursor != len(token):
            raise NoteSyntaxError("Unsupported trailing hold notation", cursor)
        if touch and result["ex"]:
            result["dialect_aliases"].append("touch_hold_ex")
        return result
    if touch:
        if cursor != len(token):
            raise NoteSyntaxError("Unsupported trailing touch notation", cursor)
        if result["ex"]:
            result["dialect_aliases"].append("touch_ex")
        return result
    if cursor == len(token):
        if any(flag in flags for flag in "@!?"):
            raise NoteSyntaxError("Slide-head presentation requires an actual slide")
        if "$" in flags:
            result["role"] = "star_tap"
        return result
    if "$" in flags:
        raise NoteSyntaxError("Standalone star conversion on a slide is unverified")
    headless = [flag for flag in flags if flag in "!?"]
    if headless and len(flags) != 1:
        raise NoteSyntaxError("Headless slide cannot combine unverified head modifiers")
    parts = token[cursor:].split("*")
    if len(parts) > MAX_BRANCHES:
        raise NoteSyntaxError("Shared branch limit exceeded", cursor)
    if any(not part for part in parts):
        raise NoteSyntaxError("Empty shared slide branch", cursor)
    result["role"] = None if headless else "tap" if "@" in flags else "star_tap"
    for index, part in enumerate(parts):
        try:
            branch = _branch(part, position, 0)
        except NoteSyntaxError as error:
            raise NoteSyntaxError(error.message, cursor + error.offset) from error
        if branch.pop("_head_ex"):
            if index or headless:
                raise NoteSyntaxError(
                    "Slide-head EX alias requires the first branch's actual head",
                    cursor + part.index("x"),
                )
            if result["ex"]:
                raise NoteSyntaxError("Repeated slide-head EX modifier", cursor + part.index("x"))
            result["ex"] = True
        result["branches"].append(branch)
        cursor += len(part) + 1
    result["dialect_aliases"] = sorted(
        {alias for branch in result["branches"] for alias in branch["dialect_aliases"]}
    )
    if sum(len(branch["segments"]) for branch in result["branches"]) > MAX_SEGMENTS:
        raise NoteSyntaxError("Total slide segment limit exceeded")
    return result
