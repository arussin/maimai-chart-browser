"""Exact exclusive note-category validation shared by preparation and research."""

COUNT_CONVENTION = "exclusive_note_categories_v1"


def audited_paths(raw: dict, audit: dict | None) -> list[tuple[dict, dict, dict]] | None:
    """Pair every physical path with exactly one audit entry; never infer missing flags."""
    if not isinstance(audit, dict) or not isinstance(audit.get("tokens"), list):
        return [] if not raw["slides"] else None
    source = raw.get("source", {})
    if source.get("parser_version") is not None and source["parser_version"] != audit.get(
        "parser_version"
    ):
        return None
    if source.get("byte_hash") is not None and source["byte_hash"] != audit.get("body_sha256"):
        return None
    paths = {path["path_id"]: path for path in raw["slides"]}
    found, seen = [], set()
    for token in audit["tokens"]:
        if not isinstance(token, dict):
            return None
        entries = token.get("paths", [token] if "path_id" in token else [])
        if not isinstance(entries, list):
            return None
        if (
            len(entries) == 1
            and "path_id" in token
            and isinstance(entries[0], dict)
            and any(token[key] != value for key, value in entries[0].items() if key in token)
        ):
            return None
        for detail in entries:
            if not isinstance(detail, dict):
                return None
            path_id = detail.get("path_id")
            if path_id not in paths or path_id in seen:
                return None
            seen.add(path_id)
            found.append((token, detail, paths[path_id]))
    return found if seen == set(paths) else None


def note_counts(raw: dict, audit: dict | None = None) -> dict:
    """Exclusive note categories, with unknown track categories if audit evidence is absent.

    EX changes judgement tolerance, not the category. Touch holds use HOLD; a
    connected movement is one SLIDE and shared branches are separate movements.
    Break holds/tracks use BREAK under this explicitly named convention, whose
    agreement with a reference table must be declared for those newer categories.
    """
    onsets = {e["event_id"]: e for e in raw["onsets"]}
    counts = {
        "tap": sum(e["role"] in {"tap", "star_tap"} and not e.get("break") for e in raw["onsets"]),
        "hold": sum(not onsets[h["onset_id"]].get("break") for h in raw["holds"]),
        "slide": len(raw["slides"]),
        "break": sum(bool(e.get("break")) for e in raw["onsets"]),
    }
    touch = sum(e["role"] == "touch" and not e.get("break") for e in raw["onsets"])
    if touch:
        counts["touch"] = touch
    entries = audited_paths(raw, audit)
    legacy = raw.get("source", {}).get("parser_version") == "simai-subset-0.1.0" and (
        audit is None
        or (isinstance(audit, dict) and audit.get("parser_version") == "simai-subset-0.1.0")
    )
    if entries is None and not (legacy and audit is None):
        counts["slide"] = counts["break"] = None
    elif entries is not None:
        flags = [detail.get("break", False if legacy else None) for _, detail, _ in entries]
        if any(type(flag) is not bool for flag in flags):
            counts["slide"] = counts["break"] = None
        else:
            track_breaks = sum(flags)
            counts["slide"] -= track_breaks
            counts["break"] += track_breaks
    return counts


def count_comparison(raw, counts, reference, reference_convention=None):
    """Withhold comparisons whose category coverage or counting convention is unknown."""
    if reference_convention is not None and reference_convention != COUNT_CONVENTION:
        raise ValueError("Unsupported reference note-count convention")
    reason = None
    if reference is None:
        reason = "Reference note counts were not supplied."
    elif (
        not isinstance(reference, dict)
        or not {"tap", "hold", "slide", "break"} <= set(reference)
        or set(reference) - {"tap", "hold", "slide", "break", "touch"}
        or any(type(value) is not int or not 0 <= value <= 100_000 for value in reference.values())
    ):
        raise ValueError("Reference note counts require bounded named note categories")
    elif any(value is None for value in counts.values()):
        reason = "Slide-track flags are unavailable or inconsistent in the parse audit."
    elif counts.get("touch", 0) and "touch" not in reference:
        reason = "Reference table does not declare a separate TOUCH count."
    elif (
        any(e["role"] in {"hold_onset", "touch_hold"} and e.get("break") for e in raw["onsets"])
        or counts["slide"] < len(raw["slides"])
    ) and reference_convention != COUNT_CONVENTION:
        reason = "Reference counting convention for break holds/tracks has not been declared."
    return {
        "convention": COUNT_CONVENTION,
        "reference_convention": reference_convention,
        "comparable": reason is None,
        "reason": reason,
        "matches": None
        if reason
        else all(counts.get(key, 0) == value for key, value in reference.items()),
    }
