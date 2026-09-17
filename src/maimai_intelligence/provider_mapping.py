"""Exact public Kamaitachi metadata joins. Ambiguities require explicit review."""

import gzip
import hashlib
import json
import unicodedata
from collections import defaultdict
from functools import lru_cache
from importlib.resources import files


def normalized(value):
    return " ".join(unicodedata.normalize("NFKC", value or "").casefold().split())


@lru_cache(maxsize=1)
def registry():
    assets = files("maimai_intelligence.assets")
    raw = gzip.decompress(assets.joinpath("provider-registry.json.gz").read_bytes())
    provenance = json.loads(assets.joinpath("provider-registry-source.json").read_text("utf-8"))
    if hashlib.sha256(raw).hexdigest() != provenance["registry_sha256"]:
        raise ValueError("Public provider registry integrity mismatch")
    return json.loads(raw)


def default_mapping(catalog):
    source = registry()
    usable = [
        c
        for c in catalog
        if all(
            k in c for k in ("chart_id", "source_hash", "title", "artist", "format", "difficulty")
        )
    ]
    overrides = json.loads(
        files("maimai_intelligence.assets")
        .joinpath("provider-mapping-overrides.json")
        .read_text("utf-8")
    )
    return build_mapping(usable, source["charts"], source["songs"], overrides=overrides)


def integration_catalog(data, version):
    from copy import deepcopy

    from .catalog_loading import PROFILE_FIELDS

    if data.get("schema_version") == "maimai-browser-catalog-2":
        # Session Report v1 consumes genuine experimental profiles and legacy IDs.
        # Inventory membership alone never becomes recommendation qualification.
        legacy = {}
        for c in data["catalog"]:
            if c.get("legacy_identity") and c.get("version") == "challenge-profile-1-experimental":
                original = deepcopy(c["legacy_identity"])
                original["demand"] = deepcopy(c["demand"])
                legacy[c["chart_id"]] = original
        translated = {
            "catalog": list(legacy.values()),
            "analysis": deepcopy(data.get("analysis", {})),
            "provider_mapping": {
                "schema_version": "provider-mapping-1",
                "provider": "kamaitachi",
                "game": "maimaidx",
                "charts": {},
            },
        }
        translated["analysis"]["charts"] = {
            legacy[cid]["chart_id"]: row
            for cid, row in translated["analysis"].get("charts", {}).items()
            if cid in legacy
        }
        for pid, row in data.get("provider_mapping", {}).get("charts", {}).items():
            c = legacy.get(row["chart_id"])
            if c is not None:
                translated["provider_mapping"]["charts"][pid] = {
                    **{
                        k: v for k, v in row.items() if k not in {"acceptance_basis", "snapshot_id"}
                    },
                    "chart_id": c["chart_id"],
                    "source_hash": c["source_hash"],
                }
        return integration_catalog(translated, version)

    analysis = deepcopy(data.get("analysis", {}))
    for row in analysis.get("charts", {}).values():
        sparse = analysis.get("representation") in {"sparse-tags-2", "sparse-tags-3"}
        row["tags"] = [t[: 4 if sparse else 6] + [[], []] for t in row.get("tags", [])]
        row.pop("segments", None)
    analysis.pop("evidence_pool", None)
    return {
        "schema_version": "maimai-public-integration-1",
        "matching_version": 1,
        "catalog_version": version,
        "catalog": [{k: v for k, v in c.items() if k in PROFILE_FIELDS} for c in data["catalog"]],
        "analysis": analysis,
        "provider_mapping": data.get("provider_mapping", {"charts": {}}),
    }


def variant(difficulty):
    value = normalized(difficulty).upper()
    format_ = "DX" if value.startswith("DX ") else "STD"
    value = (
        value.removeprefix("DX ")
        .replace("REMASTER", "RE:MASTER")
        .replace("RE: MASTER", "RE:MASTER")
    )
    return format_, value


def build_mapping(catalog, charts, songs, *, overrides=None):
    by_key, by_id = defaultdict(list), {c["chart_id"]: c for c in catalog}
    for c in catalog:
        key = (
            normalized(c["title"]),
            normalized(c["artist"]),
            c["format"],
            c["difficulty"].upper(),
        )
        if key[0] and key[1]:
            by_key[key].append(c)
    song_map = {s["id"]: s for s in songs}
    rows, unmatched = {}, []
    for chart in charts:
        song = song_map.get(chart.get("songID"), {})
        fmt, difficulty = variant(chart.get("difficulty", ""))
        key = (normalized(song.get("title")), normalized(song.get("artist")), fmt, difficulty)
        matches = by_key.get(key, [])
        cid = chart["chartID"]
        reviewed = (overrides or {}).get(cid)
        if reviewed:
            candidate = by_id.get(reviewed.get("chart_id"))
            if (
                not candidate
                or candidate["source_hash"] != reviewed.get("source_hash")
                or not reviewed.get("reason")
            ):
                raise ValueError("Reviewed provider mapping needs exact chart source and reason")
            if (candidate["format"], candidate["difficulty"].upper()) != (fmt, difficulty):
                raise ValueError("Reviewed mapping changes chart variant")
            matches = [candidate]
        if len(matches) != 1:
            unmatched.append({"chartID": cid, "reason": "ambiguous" if matches else "unmatched"})
            continue
        c = matches[0]
        rows[cid] = {
            "chart_id": c["chart_id"],
            "source_hash": c["source_hash"],
            "method": "reviewed" if reviewed else "unique-title-artist-variant",
            "constant": chart.get("levelNum"),
            "versions": chart.get("versions", []),
            "displayVersion": chart.get("data", {}).get("displayVersion", ""),
            "title": song.get("title", ""),
            "artist": song.get("artist", ""),
            "format": fmt,
            "difficulty": difficulty,
            "level": chart.get("level", ""),
            "songID": chart.get("songID", ""),
        }
        if chart.get("legacyChartID"):
            rows[chart["legacyChartID"]] = {**rows[cid], "aliasOf": cid}
    return {
        "schema_version": "provider-mapping-1",
        "provider": "kamaitachi",
        "game": "maimaidx",
        "catalog_identity": hashlib.sha256(
            json.dumps(
                sorted((c["chart_id"], c["source_hash"]) for c in catalog), separators=(",", ":")
            ).encode()
        ).hexdigest(),
        "charts": rows,
        "unmatched": unmatched,
    }


def validate_mapping(mapping, catalog):
    if (
        mapping.get("schema_version") not in {"provider-mapping-1", "provider-mapping-2"}
        or mapping.get("provider") != "kamaitachi"
        or mapping.get("game") != "maimaidx"
    ):
        raise ValueError("Unsupported provider mapping")
    by_id = {c["chart_id"]: c for c in catalog}
    for row in mapping.get("charts", {}).values():
        c = by_id.get(row.get("chart_id"))
        if (
            not c
            or (
                mapping["schema_version"] == "provider-mapping-1"
                and c.get("source_hash") != row.get("source_hash")
            )
            or (
                mapping["schema_version"] == "provider-mapping-2"
                and row.get("acceptance_basis") not in {"reviewed", "legacy_published"}
            )
            or (c["format"], c["difficulty"].upper()) != (row.get("format"), row.get("difficulty"))
        ):
            raise ValueError("Provider mapping belongs to another chart revision")
    return mapping
