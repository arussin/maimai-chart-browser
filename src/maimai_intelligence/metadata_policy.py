"""Pure supplemental metadata limits and source priority; no acquisition."""

import math

FIELDS = ("bpm", "chart_constant")
PRIORITY = {
    "reviewed-page": 10,
    "gamerch-wiki": 15,
    "arcade-songs": 20,
    "otoge-db": 30,
    "mai-notes": 40,
}


def number(value, field):
    if isinstance(value, bool) or value in (None, ""):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    ceiling = 15 if field == "chart_constant" else 2000
    return result if math.isfinite(result) and 0 < result <= ceiling else None
