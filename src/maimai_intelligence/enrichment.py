"""Durable song capabilities; enrichment never admits identities or analysis."""

import re
from copy import deepcopy

from .serialization import digest

SONG_VERSION = "song-enrichment-1"
CHART_VERSION = "chart-enrichment-1"
TITLE_STATES = {"present", "intentional_blank", "missing"}
OUTCOMES = {"accepted", "absent", "ambiguous", "conflicting", "failed_refresh", "deferred"}
SHA = re.compile(r"[a-f0-9]{64}")


def validate_enrichment(value):
    for song in value["songs"].values():
        enrichment = song.get("enrichment")
        if enrichment is None:
            continue
        if enrichment.get("version") != SONG_VERSION:
            raise ValueError("Unsupported song enrichment")
        title = enrichment.get("title")
        if title is not None:
            if title.get("state") not in TITLE_STATES or title.get("assertion") != digest(
                song["metadata"]
            ):
                raise ValueError("Title classification no longer matches song metadata")
            if title["state"] == "intentional_blank" and not title.get("evidence"):
                raise ValueError("Intentional blank requires bound source evidence")
        art = enrichment.get("artwork", {})
        for scope, selection in art.get("selected", {}).items():
            if scope not in {"default", "JP", "INTL"}:
                raise ValueError("Unsupported artwork scope")
            asset = selection.get("asset", {})
            if (
                not SHA.fullmatch(asset.get("sha256", ""))
                or selection.get("path") != "media/" + asset["sha256"] + ".webp"
                or type(asset.get("bytes")) is not int
                or not 0 < asset["bytes"] <= 256 * 1024
                or not selection.get("evidence")
                or not selection.get("policy")
            ):
                raise ValueError("Invalid persistent artwork selection")
    for chart in value["charts"].values():
        enrichment = chart.get("enrichment")
        if enrichment is None:
            continue
        if enrichment.get("version") != CHART_VERSION:
            raise ValueError("Unsupported chart enrichment")
        for outcome in enrichment.get("providers", {}).values():
            if outcome.get("status") not in OUTCOMES or type(outcome.get("usable")) is not bool:
                raise ValueError("Invalid provider coverage outcome")
    return value


def classify_titles(value, reviews=()):
    reviewed = {r["song_id"]: r for r in reviews}
    if len(reviewed) != len(reviews):
        raise ValueError("Duplicate title review")
    for sid, song in value["songs"].items():
        if song.get("redirect"):
            continue
        song.setdefault("enrichment", {"version": SONG_VERSION})["title"] = classify_title(
            song["metadata"], song.get("enrichment", {}).get("title", {}), reviewed.get(sid)
        )


def classify_title(metadata, prior=None, review=None):
    """Return a bound title decision without changing metadata or prior evidence."""
    assertion = digest(metadata)
    raw = metadata.get("title")
    state = "present" if isinstance(raw, str) and raw.strip() else "missing"
    prior = prior or {}
    if review:
        if review.get("assertion") != assertion or not review.get("evidence"):
            raise ValueError("Reviewed title assertion changed")
        if state != "missing" or not isinstance(raw, str):
            raise ValueError("Intentional blank review requires an explicit blank string")
        return {
            "state": "intentional_blank",
            "assertion": assertion,
            "evidence": deepcopy(review["evidence"]),
        }
    if prior.get("assertion") == assertion and prior.get("state") == "intentional_blank":
        return deepcopy(prior)
    return {"state": state, "assertion": assertion}


def select_artwork(song, scope, selection):
    art = song.setdefault("enrichment", {"version": SONG_VERSION}).setdefault(
        "artwork", {"selected": {}, "history": []}
    )
    prior = art["selected"].get(scope)
    if prior == selection:
        return False
    if prior:
        history = {"scope": scope, "selection": prior, "replaced_by": digest(selection)}
        if history not in art["history"]:
            art["history"].append(history)
    art["selected"][scope] = deepcopy(selection)
    return True


def project_artwork(value, catalog, legacy=None):
    """Compact selected references, with no history or source review queue."""
    result = (
        deepcopy(legacy)
        if legacy
        else {"version": "public-artwork-1", "songs": {}, "assets": {}, "versions": {}}
    )
    by_song = {c["song_id"]: c for c in catalog}
    for sid, row in by_song.items():
        selected = value["songs"][sid].get("enrichment", {}).get("artwork", {}).get("selected", {})
        default = selected.get("default") or selected.get("JP") or selected.get("INTL")
        if not default:
            continue
        entry = {"title": row["title"], "artist": row["artist"], "path": default["path"]}
        regions = {}
        for scope, selection in selected.items():
            result["assets"][selection["path"]] = deepcopy(selection["asset"])
            if scope in {"JP", "INTL"}:
                meta = row.get("regional", {}).get(scope, {}).get("metadata", {})
                regions[scope] = {
                    "title": meta.get("title", row["title"]),
                    "artist": meta.get("artist", row["artist"]),
                    "path": selection["path"],
                }
        if regions:
            entry["regions"] = regions
        result["songs"][sid] = entry
    return result
