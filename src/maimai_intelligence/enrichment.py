"""Durable song capabilities; enrichment never admits identities or analysis."""

import hashlib
import re
from copy import deepcopy
from pathlib import Path

from .snapshots import digest

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
    for sid, song in value["songs"].items():
        if song.get("redirect"):
            continue
        assertion = digest(song["metadata"])
        raw = song["metadata"].get("title")
        state = "present" if isinstance(raw, str) and raw.strip() else "missing"
        prior = song.get("enrichment", {}).get("title", {})
        decision = reviewed.get(sid)
        if decision:
            if decision.get("assertion") != assertion or not decision.get("evidence"):
                raise ValueError("Reviewed title assertion changed")
            if state != "missing" or not isinstance(raw, str):
                raise ValueError("Intentional blank review requires an explicit blank string")
            title = {
                "state": "intentional_blank",
                "assertion": assertion,
                "evidence": decision["evidence"],
            }
        elif prior.get("assertion") == assertion and prior.get("state") == "intentional_blank":
            title = prior
        else:
            title = {"state": state, "assertion": assertion}
        song.setdefault("enrichment", {"version": SONG_VERSION})["title"] = title


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


def verify_asset(root, path, asset):
    if path != "media/" + asset.get("sha256", "") + ".webp":
        raise ValueError("Invalid persistent asset path")
    with (Path(root) / path).open("rb") as stream:
        raw = stream.read(256 * 1024 + 1)
    if (
        len(raw) != asset.get("bytes")
        or hashlib.sha256(raw).hexdigest() != asset.get("sha256")
        or raw[:4] != b"RIFF"
        or raw[8:12] != b"WEBP"
    ):
        raise ValueError("Persistent artwork integrity mismatch")
    return raw


def migrate_artwork(value, published, roots, destination):
    """Idempotent, verified migration through accepted IDs and retained aliases."""
    from .registry import resolve

    destination = Path(destination)
    # Saved accepted state remains reusable in a fresh cache when its package holds the assets.
    for song in value["songs"].values():
        for selection in song.get("enrichment", {}).get("artwork", {}).get("selected", {}).values():
            path, asset = selection["path"], selection["asset"]
            output = destination / path
            if output.exists():
                verify_asset(destination, path, asset)
                continue
            origin = next(
                (root for root in roots if root is not None and (Path(root) / path).is_file()), None
            )
            if origin is None:
                raise ValueError("Accepted artwork bytes unavailable; supply its retained package")
            raw = verify_asset(origin, path, asset)
            output.parent.mkdir(parents=True, exist_ok=True)
            with output.open("xb") as stream:
                stream.write(raw)
    artwork = published.get("artwork", {})
    songs = {}
    for c in published.get("catalog", []):
        cid = c["chart_id"]
        if cid not in value["charts"]:
            candidates = {
                r["chart_id"]
                for entries in value["legacy-ids"].values()
                for old, r in entries.items()
                if old == cid
            }
            if len(candidates) != 1:
                continue
            cid = next(iter(candidates))
        target = value["charts"][resolve(value, cid)]["song_id"]
        songs.setdefault(c["song_id"], set()).add(resolve(value, target))
    report = []
    for old, record in artwork.get("songs", {}).items():
        targets = songs.get(old, set())
        if len(targets) != 1:
            report.append({"song_id": old, "status": "ambiguous_legacy_identity"})
            continue
        sid = next(iter(targets))
        selections = {"default": record, **record.get("regions", {})}
        for scope, record in selections.items():
            if scope not in {"default", "JP", "INTL"}:
                raise ValueError("Unsupported retained regional artwork")
            path, asset = record["path"], artwork["assets"][record["path"]]
            raw = None
            for root in roots:
                if root is not None and (Path(root) / path).is_file():
                    raw = verify_asset(root, path, asset)
                    break
            if raw is None:
                report.append(
                    {"song_id": sid, "scope": scope, "status": "historical_asset_unavailable"}
                )
                continue
            output = destination / path
            output.parent.mkdir(parents=True, exist_ok=True)
            if output.exists():
                verify_asset(destination, path, asset)
            else:
                with output.open("xb") as stream:
                    stream.write(raw)
            song = value["songs"][sid]
            if not song.get("enrichment", {}).get("artwork", {}).get("selected", {}).get(scope):
                select_artwork(
                    song,
                    scope,
                    {
                        "path": path,
                        "asset": deepcopy(asset),
                        "policy": "retained-artwork-migration-1",
                        "evidence": {
                            "legacy_song_id": old,
                            "scope": scope,
                            "title": record["title"],
                            "artist": record["artist"],
                        },
                        "provenance_status": "retained"
                        if asset.get("source")
                        else "historical_source_unavailable",
                    },
                )
            report.append({"song_id": sid, "scope": scope, "status": "retained"})
    return report


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
