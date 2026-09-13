"""English discovery names; aliases never change pattern identity or recognition."""

ALIASES = {
    "pattern.umiyuri": ["Umiyuri", "Umiyuri Kaiteitan pattern"],
    "pattern.two_position_alternation": ["trill", "trills", "two-button alternation"],
    "pattern.same_position_repetition": ["jack", "jacks", "repeated taps"],
    "pattern.gallop_pairs": ["gallops", "short-long pairs"],
    "pattern.simultaneous_group": ["EACH", "simultaneous notes", "chord", "chords"],
    "pattern.chord_stream": ["chord stream", "repeated chords", "EACH stream"],
    "pattern.tap_staircase": ["button sweep", "sweep", "sweeps", "staircase"],
    "pattern.perimeter_run": ["rotation", "rotations", "spin", "spins", "button rotation"],
    "pattern.direction_reversal": ["reversal", "reversals", "foldback", "reverse sweep"],
    "pattern.same_head_slide_fan": ["branching slides", "shared-head slides", "slide fan"],
    "pattern.connected_slide_chain": ["connected slides", "chained slide", "slide chain"],
    "pattern.slide_tap_interleave": ["slide and tap", "tap during slide movement"],
    "pattern.delayed_slide_interleave": ["tap during slide wait"],
    "pattern.variable_slide_wait": ["variable slide waits"],
    "pattern.hold_tap_interleave": ["hold and tap"],
    "pattern.hold_slide_overlap": ["hold and slide"],
    "pattern.touch_tap_interleave": ["touch and button", "touch and tap"],
}


def english_aliases(entry):
    """Retain English seed aliases and add missing vocabulary without false synonyms."""
    values = [
        a if isinstance(a, str) else a["text"]
        for a in entry.get("aliases", [])
        if isinstance(a, str) or a.get("language") == "en"
    ] + ALIASES.get(entry["id"], [])
    seen, result = set(), []
    for value in values:
        if value.casefold() not in seen:
            seen.add(value.casefold())
            result.append({"text": value, "language": "en", "relation": "search_alias"})
    return result
