"""Verify retained Maishift decisions offline; never install or enable mappings."""

import json
import re
import unicodedata
from pathlib import Path

from maimai_intelligence.registry import digest, read_registry

ROOT = Path(__file__).resolve().parents[1]
LEVEL_FIELDS = {
    "BASIC": "bas",
    "ADVANCED": "adv",
    "EXPERT": "exp",
    "MASTER": "mas",
    "RE:MASTER": "remas",
}


def normalized(value):
    return unicodedata.normalize("NFKC", value).strip()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def source_identity(group, chart):
    return {
        "provider": "maishift",
        "game": "maimaidx",
        "region": group["region"],
        "provider_chart_id": chart["provider_chart_id"],
        **group["source"],
        "difficulty": chart["difficulty"],
    }


def validate_review(review, registry):
    require(
        review["schema_version"] == "maishift-mapping-review-1"
        and review["status"] == "reviewed-not-installed",
        "Unsupported review",
    )
    rows, targets = {}, set()
    for group in review["groups"]:
        require(
            group["region"] in {"intl", "jp"} and group["decision"] == "accept",
            "Invalid regional decision",
        )
        require(
            group["decision_sha256"]
            == digest({k: v for k, v in group.items() if k != "decision_sha256"}),
            "Review decision changed",
        )
        source, canonical, evidence = group["source"], group["canonical"], group["official"]
        mapping = registry["mappings"].get(evidence["mapping_key"])
        require(
            mapping is not None and digest(mapping) == evidence["mapping_sha256"],
            "Referenced official mapping changed",
        )
        require(
            mapping["state"] == "accepted"
            and mapping["acceptance_basis"] == "reviewed"
            and mapping["provider"] == "sega-" + group["region"]
            and mapping["subject_id"] == canonical["song_id"]
            and mapping["snapshot_id"] == evidence["snapshot_id"]
            and mapping["evidence"]["record"] == evidence["record_sha256"],
            "Official evidence does not identify this song and region",
        )
        snapshot = registry["sources"][evidence["snapshot_id"]]
        require(
            snapshot["sha256"] == review["inputs"]["official"][group["region"]]["sha256"],
            "Official capture changed",
        )
        song = registry["songs"][canonical["song_id"]]
        require(
            not song.get("redirect")
            and all(song["metadata"].get(k, "") == canonical[k] for k in ("title", "artist")),
            "Canonical song identity changed",
        )
        assertion, observed = mapping["assertion"], evidence["observed_record"]
        require(
            all(observed[k] == assertion[k] for k in ("title", "artist", "image_url"))
            and source["jacket_filename"] == observed["image_url"]
            and normalized(source["title"]) == normalized(observed["title"]),
            "Exact title or jacket evidence differs",
        )
        reason = group["reason"]
        require(
            reason in {"blank_title", "blank_artist", "shortened_artist_credit"},
            "Unreviewed exception type",
        )
        if reason == "blank_title":
            require(
                not normalized(source["title"]) and source["artist"] == canonical["artist"],
                "Wrong blank-title decision",
            )
        elif reason == "blank_artist":
            require(
                not normalized(source["artist"]) and not normalized(observed["artist"]),
                "Wrong blank-artist decision",
            )
        else:
            require(
                source["artist"] and source["artist"] != canonical["artist"],
                "Missing explicit artist-credit difference",
            )
        for chart in group["charts"]:
            pid, difficulty = chart["provider_chart_id"], chart["difficulty"]
            require(re.fullmatch(r"[1-9][0-9]*", pid) is not None, "Invalid provider ID")
            identity = source_identity(group, chart)
            require(
                digest(identity) == chart["source_identity_sha256"],
                "Observed source identity changed",
            )
            target = registry["charts"][chart["chart_id"]]
            require(
                not target.get("redirect")
                and target["song_id"] == canonical["song_id"]
                and target["format"] == source["format"]
                and target["difficulty"] == difficulty
                and target["variant_id"] == "ordinary",
                "Mapping changes canonical chart slot",
            )
            field = ("dx_" if source["format"] == "DX" else "") + "lev_" + LEVEL_FIELDS[difficulty]
            require(bool(observed.get(field)), "Chart slot absent from official evidence")
            key = "maishift:" + group["region"] + ":" + pid
            target_key = group["region"], target["chart_id"]
            require(key not in rows and target_key not in targets, "Duplicate provider or target")
            targets.add(target_key)
            rows[key] = {
                "chart_id": target["chart_id"],
                "expected_source": identity,
                "review_id": review["review_id"],
                "decision_sha256": group["decision_sha256"],
            }
    return rows


def main():
    review = json.loads((ROOT / "registry/maishift-review-20260921.json").read_text("utf-8"))
    rows = validate_review(review, read_registry(ROOT / "registry"))
    print(json.dumps({"reviewed_chart_decisions": len(rows), "runtime_mappings_installed": False}))


if __name__ == "__main__":
    main()
