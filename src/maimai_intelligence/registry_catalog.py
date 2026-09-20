"""Allowlisted browser projection of accepted inventory and optional legacy analysis."""

import hashlib
import json
from collections import Counter, defaultdict
from copy import deepcopy
from pathlib import Path

from maimai_analyzer.dataset import SOURCE_LOCK

from .artwork import copy_artwork, validate_artwork
from .catalog_loading import PROFILE_FIELDS
from .metadata_waterfall import project as project_metadata
from .registry import STATES, digest, resolve, validate
from .research_overview import validate_overview
from .research_package import read_package
from .snapshots import atomic_json, canonical

SCHEMA = "maimai-browser-catalog-2"
CHART_FIELDS = PROFILE_FIELDS | {
    "variant_id",
    "capabilities",
    "regional",
    "metadata_region",
    "legacy_identity",
    "input_id",
    "transcription",
}
GENRES = {
    "POPS＆アニメ": ("POPSアニメ", "POPS & ANIME"),
    "niconico＆ボーカロイド": ("niconicoボーカロイド", "niconico & VOCALOID"),
    "東方Project": ("東方Project", "Touhou Project"),
    "ゲーム＆バラエティ": ("ゲームバラエティ", "GAME & VARIETY"),
    "maimai": ("maimai", "maimai"),
    "オンゲキ＆CHUNITHM": ("オンゲキCHUNITHM", "ONGEKI & CHUNITHM"),
}
# Explicit official song-introduction codes. New values stay visible as raw codes.
VERSIONS = dict(
    zip(
        (
            10000,
            11000,
            12000,
            13000,
            14000,
            15000,
            16000,
            17000,
            18000,
            18500,
            19000,
            19500,
            19900,
            20000,
            20500,
            21000,
            21500,
            22000,
            22500,
            23000,
            23500,
            24000,
            24500,
            25000,
            25500,
            26000,
            26500,
            27000,
        ),
        (
            "maimai",
            "maimai PLUS",
            "maimai GreeN",
            "maimai GreeN PLUS",
            "maimai ORANGE",
            "maimai ORANGE PLUS",
            "maimai PiNK",
            "maimai PiNK PLUS",
            "maimai MURASAKi",
            "maimai MURASAKi PLUS",
            "maimai MiLK",
            "maimai MiLK PLUS",
            "maimai FiNALE",
            "maimai DX",
            "maimai DX PLUS",
            "maimai DX Splash",
            "maimai DX Splash PLUS",
            "maimai DX UNiVERSE",
            "maimai DX UNiVERSE PLUS",
            "maimai DX FESTiVAL",
            "maimai DX FESTiVAL PLUS",
            "maimai DX BUDDiES",
            "maimai DX BUDDiES PLUS",
            "maimai DX PRiSM",
            "maimai DX PRiSM PLUS",
            "maimai DX CiRCLE",
            "maimai DX CiRCLE PLUS",
            "maimai DX MAGiCAL",
        ),
        strict=True,
    )
)


def version_label(code):
    try:
        number = int(code)
    except (TypeError, ValueError):
        return "Unknown introduction"
    # Last two digits identify a listing update within the explicitly named release.
    return VERSIONS.get(number // 100 * 100, "SEGA version " + code)


def project_registry(value, legacy):
    validate(value)
    profiles = {c["chart_id"]: c for c in legacy.get("catalog", [])}
    observations = defaultdict(dict)
    metrics = defaultdict(list)
    for entry in sorted(
        value["observations"].values(), key=lambda o: (o["observed_at"], o["observation_id"])
    ):
        subject = resolve(value, entry["subject_id"])
        observations[subject][entry["region"], entry["field"]] = entry
        if entry.get("policy") == "metadata-waterfall-1":
            metrics[subject].append(entry)
    data = {
        "schema_version": SCHEMA,
        "catalog": [],
        "review": [],
        "snippets": {},
        "benchmark_hash": legacy.get("benchmark_hash", ""),
        "registry": {"schema_version": value["schema_version"], "sha256": digest(value)},
        "legacy_ids": {},
        "sources": {},
        "navigation": {
            "version": "challenge-navigation-2",
            "charts": {},
            "genres": [],
            "versions": [],
            "constant_basis": {
                "provider": "Neskol",
                "revision": SOURCE_LOCK["revision"],
                "region": None,
                "release": None,
            },
        },
        "provider_mapping": {
            "schema_version": "provider-mapping-2",
            "provider": "kamaitachi",
            "game": "maimaidx",
            "charts": {},
        },
    }
    id_map, genres, versions = {}, {}, set()
    for source_id, source in value["sources"].items():
        data["sources"][source_id] = {
            k: source[k]
            for k in (
                "provider",
                "region",
                "url",
                "revision",
                "sha256",
                "bytes",
                "captured_at",
                "http",
                "parser",
                "ordinary_rows",
                "chart_slots",
            )
            if k in source
        }
    for chart in value["charts"].values():
        if chart.get("redirect"):
            continue
        cid, sid = chart["chart_id"], chart["song_id"]
        song = value["songs"][sid]
        selected = chart.get("transcription", {})
        profile = profiles.get(selected.get("legacy_chart_id"))
        if profile and (
            profile.get("source_hash"),
            profile.get("format"),
            profile.get("difficulty"),
        ) != (selected.get("source_hash"), chart["format"], chart["difficulty"]):
            profile = None
        if profile and profile.get("version") != "challenge-profile-1-experimental":
            raise ValueError("Selected analysis is not an accepted profile")
        regions, aliases = {}, set(song["metadata"].get("aliases", []))
        aliases.update(entry["value"] for entry in song.get("search_aliases", []))
        for region in ("JP", "INTL"):
            meta = observations[sid].get((region, "metadata"))
            level = observations[cid].get((region, "level"))
            listing = observations[cid].get((region, "listing"))
            if meta:
                aliases.update(meta["value"].get(k, "") for k in ("title", "title_kana", "artist"))
            regions[region] = {
                "listing": listing["value"] if listing else "unknown",
                "snapshot_id": listing["snapshot_id"] if listing else None,
                "observed_at": listing["observed_at"] if listing else None,
                "level": level["value"] if level else None,
                "level_snapshot_id": level["snapshot_id"] if level else None,
                "level_observed_at": level["observed_at"] if level else None,
                "metadata": deepcopy(meta["value"]) if meta else {},
            }
            if meta:
                regional_genre = meta["value"].get("catcode", "")
                genre, label = GENRES.get(
                    regional_genre, ("sega:" + regional_genre, regional_genre)
                )
                genres[genre] = label
                regions[region]["genre"] = genre
                regions[region]["version"] = version_label(meta["value"].get("version"))
                versions.add(regions[region]["version"])
        preferred = next((r for r in ("JP", "INTL") if regions[r]["metadata"]), None)
        meta = dict(song["metadata"])
        for region in ("INTL", "JP"):
            meta.update({k: v for k, v in regions[region]["metadata"].items() if v})
        old_nav = (
            legacy.get("navigation", {}).get("charts", {}).get(profile["chart_id"], {})
            if profile
            else {}
        )
        nav = {
            **deepcopy(chart.get("source_metadata", {})),
            **{
                k: old_nav[k]
                for k in ("bpm", "chart_constant", "source_path", "source_hash", "genre", "version")
                if k in old_nav and k not in old_nav.get("metric_sources", {})
            },
        }
        if meta.get("catcode"):
            raw_genre = meta["catcode"]
            genre, label = GENRES.get(raw_genre, ("sega:" + raw_genre, raw_genre))
            nav["genre"] = genre
            genres[genre] = label
        if meta.get("version"):
            nav["version"] = version_label(meta["version"])
            nav["version_basis"] = "official_song_introduction"
        if nav.get("version"):
            versions.add(nav["version"])
        nav["chart_id"] = cid
        if profile:
            nav["source_hash"] = profile["source_hash"]
        project_metadata(nav, metrics[cid], value["sources"])
        data["navigation"]["charts"][cid] = nav
        unavailable = (
            chart.get("analysis_state")
            if chart.get("analysis_state") in {"unsupported", "unreviewed", "ambiguous"}
            else "not_prepared"
        )
        capabilities = {
            "metadata": "available",
            "artwork": "not_prepared",
            "aliases": "available" if aliases else "missing",
            "provider_mapping": "missing",
            "player_link": "missing",
            "constant": "available" if nav.get("chart_constant") else "missing",
            "transcription": "available" if selected.get("source_hash") else "missing",
            "flow": unavailable,
            "patterns": unavailable,
            "similarity": "available" if profile else unavailable,
        }
        row = {
            "version": "registry-chart-1",
            "chart_id": cid,
            "song_id": sid,
            "song_family": sid,
            "variant_id": chart["variant_id"],
            "title": meta.get("title", ""),
            "artist": meta.get("artist", ""),
            "format": chart["format"],
            "difficulty": chart["difficulty"],
            "level": next(
                (regions[r]["level"] for r in ("JP", "INTL") if regions[r]["level"]),
                chart.get("legacy_level"),
            ),
            "aliases": sorted(aliases - {"", meta.get("title")}),
            "regional": regions,
            "metadata_region": preferred,
            "capabilities": capabilities,
        }
        if profile:
            id_map[profile["chart_id"]] = cid
            row.update(
                {
                    k: deepcopy(profile[k])
                    for k in ("version", "source_hash", "source_container_id", "input_id", "demand")
                    if k in profile
                }
            )
            row["legacy_identity"] = {
                k: deepcopy(v) for k, v in profile.items() if k in PROFILE_FIELDS - {"demand"}
            }
            row["transcription"] = {
                k: selected[k]
                for k in ("source_hash", "container_hash", "snapshot_id")
                if k in selected
            }
        data["catalog"].append(row)
    for identities in value["legacy-ids"].values():
        for old, record in identities.items():
            cid = resolve(value, record["chart_id"])
            if old in data["legacy_ids"] and data["legacy_ids"][old] != cid:
                raise ValueError("Legacy route ambiguity requires release-specific reconciliation")
            data["legacy_ids"][old] = cid
    data["legacy_ids"].update(
        {cid: resolve(value, cid) for cid, c in value["charts"].items() if c.get("redirect")}
    )
    for item in legacy.get("navigation", {}).get("genres", []):
        genres.setdefault(item["id"], item["label"])
    data["navigation"]["genres"] = [{"id": k, "label": v} for k, v in sorted(genres.items())]
    data["navigation"]["versions"] = sorted(
        versions,
        key=lambda v: list(VERSIONS.values()).index(v) if v in VERSIONS.values() else 999,
        reverse=True,
    )
    if legacy.get("analysis"):
        data["analysis"] = deepcopy(legacy["analysis"])
        data["analysis"]["charts"] = {
            id_map[cid]: deepcopy(row)
            for cid, row in legacy["analysis"]["charts"].items()
            if cid in id_map
        }
        validate_overview(data["analysis"], data["catalog"])
    data["snippets"] = {
        id_map[cid]: deepcopy(row)
        for cid, row in legacy.get("snippets", {}).items()
        if cid in id_map
    }
    by_id = {c["chart_id"]: c for c in data["catalog"]}
    for cid in data.get("analysis", {}).get("charts", {}):
        by_id[cid]["capabilities"].update(flow="available", patterns="available")
    for mapping in value["mappings"].values():
        if mapping["state"] != "accepted" or mapping["provider"] not in {"kamaitachi", "mai-notes"}:
            continue
        cid = resolve(value, mapping["subject_id"])
        chart = by_id.get(cid)
        if not chart:
            continue
        if mapping["provider"] == "kamaitachi":
            record = {
                k: v
                for k, v in mapping.get("metadata", {}).items()
                if k
                in {
                    "constant",
                    "versions",
                    "displayVersion",
                    "title",
                    "artist",
                    "level",
                    "songID",
                    "aliasOf",
                }
            }
            record.update(
                chart_id=cid,
                format=chart["format"],
                difficulty=chart["difficulty"],
                acceptance_basis=mapping["acceptance_basis"],
                method=mapping.get("method", "reviewed"),
                snapshot_id=mapping["snapshot_id"],
            )
            data["provider_mapping"]["charts"][mapping["provider_id"]] = record
            chart["capabilities"]["provider_mapping"] = "available"
        elif mapping.get("available"):
            metadata = mapping.get("metadata", {})
            if "mai_notes" not in data:
                data["mai_notes"] = {
                    k: metadata[k]
                    for k in ("source", "source_sha256", "generated_at", "captured_at")
                    if k in metadata
                }
                data["mai_notes"].update(version="mai-notes-links-2", charts={})
            data["mai_notes"]["charts"][cid] = {
                "id": mapping["provider_id"],
                "format": chart["format"],
                "difficulty": chart["difficulty"],
            }
            chart["capabilities"]["player_link"] = "available"
    if legacy.get("artwork"):
        art = deepcopy(legacy["artwork"])
        art["songs"] = {}
        for row in data["catalog"]:
            old = row.get("legacy_identity", {})
            record = legacy["artwork"]["songs"].get(old.get("song_id"))
            if record:
                art["songs"][row["song_id"]] = {
                    **record,
                    "title": row["title"],
                    "artist": row["artist"],
                }
        art["versions"] = {k: v for k, v in art["versions"].items() if k in versions}
        used = {r["path"] for r in art["songs"].values()} | set(art["versions"].values())
        art["assets"] = {k: v for k, v in art["assets"].items() if k in used}
        validate_artwork(art, data["catalog"], data["navigation"]["versions"])
        data["artwork"] = art
        for row in data["catalog"]:
            if row["song_id"] in art["songs"]:
                row["capabilities"]["artwork"] = "available"
    return validate_catalog(data)


def coverage_report(data):
    """Report exact inventory and optional capability coverage without source payloads."""
    charts = data["catalog"]
    return {
        "analysis_available": sum("demand" in c for c in charts),
        "metadata_only": sum("demand" not in c for c in charts),
        "formats": dict(Counter(c["format"] for c in charts)),
        "difficulties": dict(Counter(c["difficulty"] for c in charts)),
        "capabilities": {
            key: dict(Counter(c["capabilities"][key] for c in charts))
            for key in sorted({key for c in charts for key in c["capabilities"]})
        },
        "regional_listings": {
            r: dict(Counter(c["regional"][r]["listing"] for c in charts)) for r in ("JP", "INTL")
        },
        "not_currently_listed_in_either_region": sum(
            all(c["regional"][r]["listing"] != "listed" for r in ("JP", "INTL")) for c in charts
        ),
        "constant_basis": data["navigation"]["constant_basis"],
        "unresolved_versions": sorted(
            v for v in data["navigation"]["versions"] if v not in VERSIONS.values()
        ),
    }


def validate_catalog(data):
    if data.get("schema_version") != SCHEMA:
        raise ValueError("Unsupported browser inventory schema")
    ids = set()
    for c in data["catalog"]:
        if (
            c["chart_id"] in ids
            or set(c) - CHART_FIELDS
            or c["difficulty"] not in {"BASIC", "ADVANCED", "EXPERT", "MASTER", "RE:MASTER"}
        ):
            raise ValueError("Invalid browser inventory chart")
        ids.add(c["chart_id"])
        if any(state not in STATES for state in c["capabilities"].values()):
            raise ValueError("Unknown prepared capability state")
        analyzed = c["capabilities"]["similarity"] == "available"
        if analyzed != (
            c.get("version") == "challenge-profile-1-experimental"
            and bool(c.get("source_hash"))
            and isinstance(c.get("demand"), dict)
        ):
            raise ValueError("Analysis capability and profile disagree")
        if not analyzed and any(k in c for k in ("demand", "source_hash", "legacy_identity")):
            raise ValueError("Metadata-only chart carries fabricated analysis")
    if any(target not in ids for target in data["legacy_ids"].values()):
        raise ValueError("Unresolvable legacy chart alias")
    return data


def _legacy_enrichment(data):
    """Recover retained profile identities when a v2 package is reused as enrichment."""
    rows = {c["chart_id"]: c for c in data["catalog"] if c.get("legacy_identity")}
    result = deepcopy(data)
    result["catalog"] = [
        {
            **c["legacy_identity"],
            "demand": c["demand"],
            **({"input_id": c["input_id"]} if "input_id" in c else {}),
        }
        for c in rows.values()
    ]
    for key in ("analysis", "navigation"):
        if key in result:
            result[key]["charts"] = {
                rows[cid]["legacy_identity"]["chart_id"]: row
                for cid, row in result[key].get("charts", {}).items()
                if cid in rows
            }
    result["snippets"] = {
        rows[cid]["legacy_identity"]["chart_id"]: row
        for cid, row in result.get("snippets", {}).items()
        if cid in rows
    }
    if "artwork" in result:
        songs = result["artwork"]["songs"]
        result["artwork"]["songs"] = {
            c["legacy_identity"]["song_id"]: songs[c["song_id"]]
            for c in rows.values()
            if c["song_id"] in songs
        }
    return result


def build_registry_package(value, source, output, *, published=None, additions=None):
    """Adapter retains accepted artifacts; inventory never depends on profile count."""
    if source is None:
        descriptor = {
            "source": SOURCE_LOCK,
            "status": "research_preview",
            "transcription_input": "not_prepared",
        }
        retained = {
            name: canonical(content)
            for name, content in {
                "catalog.json": [],
                "source-inventory.json": [],
                "review.json": [],
                "snippets.json": {},
                "navigation.json": {"charts": {}, "genres": [], "versions": []},
                "benchmark.json": {"benchmark_hash": digest({"registry": digest(value)})},
            }.items()
        }
    else:
        descriptor, retained = read_package(source)
        source = Path(source).resolve()
    output = Path(output).resolve()
    if (
        source == output
        or (source is not None and (source.is_relative_to(output) or output.is_relative_to(source)))
        or (output.exists() and any(output.iterdir()))
    ):
        raise ValueError("Use a fresh separate registry package destination")
    legacy = {
        "catalog": json.loads(retained["catalog.json"]),
        "navigation": json.loads(retained["navigation.json"]),
    }
    for name, key in (
        ("analysis.json", "analysis"),
        ("artwork.json", "artwork"),
        ("snippets.json", "snippets"),
    ):
        if name in retained:
            legacy[key] = json.loads(retained[name])
    if descriptor.get("version") == "challenge-package-2":
        legacy = _legacy_enrichment(legacy)
    if published is not None and published.get("schema_version") == SCHEMA:
        published = _legacy_enrichment(published)
    if published is not None and published.get("analysis"):
        # A retained package may predate the last published detector preparation.
        # Reuse only a whole accepted overview with identical selected profiles.
        identities = {(c["chart_id"], c.get("source_hash")) for c in legacy["catalog"]}
        published_identities = {(c["chart_id"], c.get("source_hash")) for c in published["catalog"]}
        if identities == published_identities:
            validate_overview(published["analysis"], legacy["catalog"])
            legacy["analysis"] = deepcopy(published["analysis"])
    if additions and additions["profiles"]:
        from .catalog_transcriptions import merge_overviews

        known = {c["chart_id"] for c in legacy["catalog"]}
        incoming = [c["chart_id"] for c in additions["profiles"]]
        if known.intersection(incoming) or len(set(incoming)) != len(incoming):
            raise ValueError("Supplemental profiles must have new, unique identities")
        legacy["catalog"].extend(deepcopy(additions["profiles"]))
        legacy["analysis"] = merge_overviews(legacy.get("analysis"), additions["records"])
        retained["source-inventory.json"] = canonical(
            json.loads(retained["source-inventory.json"]) + additions["inventory"]
        )
        descriptor["supplemental_sources"] = {
            **descriptor.get("supplemental_sources", {}),
            **additions["sources"],
        }
    # Matching a body hash alone is insufficient when its selected container
    # timing/extraction context changed. Keep the inventory and discard stale analysis.
    inventory = {r["input_id"]: r for r in json.loads(retained["source-inventory.json"])}
    invalid = set()
    for chart in value["charts"].values():
        selected = chart.get("transcription", {})
        row = inventory.get(selected.get("input_id"))
        if selected.get("container_hash") and (
            not row
            or selected["container_hash"] != row.get("source_raw_sha256")
            or any(
                selected.get("context", {}).get(k) != row.get(k)
                for k in ("body_byte_start", "body_byte_end")
            )
        ):
            invalid.add(selected["legacy_chart_id"])
    legacy["catalog"] = [c for c in legacy["catalog"] if c["chart_id"] not in invalid]
    data = project_registry(value, legacy)
    if "artwork" in data:
        copy_artwork(data["artwork"], source, output)
    values = {
        name: json.loads(raw)
        for name, raw in retained.items()
        if name not in {"mai-notes.json", "artwork.json", "analysis.json"}
    }
    for key, name in (
        ("catalog", "catalog.json"),
        ("navigation", "navigation.json"),
        ("analysis", "analysis.json"),
        ("artwork", "artwork.json"),
        ("mai_notes", "mai-notes.json"),
        ("provider_mapping", "provider-mapping.json"),
        ("snippets", "snippets.json"),
        ("review", "review.json"),
    ):
        if key in data:
            values[name] = data[key]
    values["browser-metadata.json"] = {
        k: data[k] for k in ("schema_version", "registry", "legacy_ids", "sources")
    }
    entries = []
    for name, entry in sorted(values.items()):
        raw = canonical(entry) + b"\n"
        atomic_json(output / name, entry)
        entries.append({"path": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})
    atomic_json(
        output / "package.json",
        {
            **descriptor,
            "version": "challenge-package-2",
            "registry": data["registry"],
            "files": entries,
        },
    )
    return data
