"""Build a fresh registry candidate from reviewed public metadata, without enabling imports."""

import argparse
import hashlib
import json
from collections import defaultdict
from copy import deepcopy
from pathlib import Path

from maimai_intelligence.registry import accept_mapping, digest, read_registry, write_registry
from maimai_intelligence.snapshots import canonical
from scripts.check_maishift_review import ROOT, require, validate_review

SOURCE_NAME = "maishift-source-20260921.json"
REVIEW_NAME = "maishift-review-20260921.json"
FIELDS = ("title", "artist", "format", "difficulty")


def snapshot_from_candidates(directory, review):
    rows, inputs = [], {}
    for region in ("intl", "jp"):
        raw = (directory / ("candidate-crosswalk-" + region + ".json")).read_bytes()
        sha = hashlib.sha256(raw).hexdigest()
        # The exception review pins the complete candidate files, including strict joins.
        require(sha == review["inputs"]["candidate_sha256"][region], "Candidate capture changed")
        inputs[region] = sha
        for candidate in json.loads(raw):
            require(len(candidate["chartIDs"]) == 1, "Ambiguous or unresolved candidate")
            rows.append(
                {
                    "region": region,
                    "provider_chart_id": str(candidate["providerChartID"]),
                    "chart_id": candidate["chartIDs"][0],
                    "source": {k: candidate["metadata"][k] for k in FIELDS},
                    "jacket_url": candidate["metadata"]["jacketUrl"],
                    "basis": candidate["basis"],
                }
            )
    return {
        "schema_version": "maishift-public-chart-snapshot-1",
        "captured_at": "2026-09-21",
        "capture_date_precision": "day",
        "provider": "maishift",
        "game": "maimaidx",
        "inputs": inputs,
        "review_id": review["review_id"],
        "charts": rows,
    }


def install_snapshot(registry, snapshot, review):
    require(snapshot["schema_version"] == "maishift-public-chart-snapshot-1", "Unknown snapshot")
    require(snapshot["provider"] == "maishift" and snapshot["game"] == "maimaidx", "Wrong provider")
    require(snapshot["review_id"] == review["review_id"], "Wrong review")
    reviewed = validate_review(review, registry)
    exact = defaultdict(list)
    for c in registry["charts"].values():
        if c.get("redirect") or c["variant_id"] != "ordinary":
            continue
        song = registry["songs"][c["song_id"]]["metadata"]
        exact[(song.get("title", ""), song.get("artist", ""), c["format"], c["difficulty"])].append(
            c["chart_id"]
        )
    result = deepcopy(registry)
    snapshot_id = "maishift-public-charts:" + digest(snapshot)
    raw = canonical(snapshot) + b"\n"
    result["sources"][snapshot_id] = {
        "provider": "maishift",
        "snapshot_id": snapshot_id,
        "url": "https://maimai.shiftpsh.com",
        "parser": "maishift-public-chart-snapshot-1",
        "captured_at": snapshot["captured_at"],
        "capture_date_precision": "day",
        "sha256": hashlib.sha256(raw).hexdigest(),
        "bytes": len(raw),
        "retained_path": SOURCE_NAME,
        "chart_slots": len(snapshot["charts"]),
    }
    seen, targets, used_reviews = set(), set(), set()
    for entry in snapshot["charts"]:
        region, pid, cid, source = (
            entry[k] for k in ("region", "provider_chart_id", "chart_id", "source")
        )
        require(
            region in {"intl", "jp"}
            and pid.isascii()
            and pid.isdecimal()
            and str(int(pid)) == pid
            and int(pid) > 0,
            "Invalid provider identity",
        )
        key = "maishift:" + region + ":" + pid
        require(key not in seen and (region, cid) not in targets, "Duplicate source or target")
        seen.add(key)
        targets.add((region, cid))
        target = registry["charts"][cid]
        require(
            not target.get("redirect")
            and target["variant_id"] == "ordinary"
            and all(source[k] == target[k] for k in ("format", "difficulty")),
            "Changed chart slot",
        )
        decision = reviewed.get(key)
        if decision:
            require(
                decision["chart_id"] == cid
                and all(source[k] == decision["expected_source"][k] for k in FIELDS),
                "Review identity changed",
            )
            require(
                entry["jacket_url"].rsplit("/", 1)[-1]
                == decision["expected_source"]["jacket_filename"],
                "Review jacket changed",
            )
            evidence = {
                "decision_sha256": decision["decision_sha256"],
                "review_id": review["review_id"],
            }
            used_reviews.add(key)
            method = "reviewed-source-exception"
        else:
            require(
                entry["basis"] == "exact-title-artist-format-difficulty"
                and source["title"]
                and source["artist"]
                and exact[tuple(source[k] for k in FIELDS)] == [cid],
                "Strict unique identity no longer agrees",
            )
            evidence = {"canonical_identity": digest({k: source[k] for k in FIELDS})}
            method = "exact-title-artist-format-difficulty"
        evidence["source_record"] = digest(entry)
        mapping_key = digest(["maishift", "maimaidx", region + ":" + pid])
        old = result["mappings"].get(mapping_key)
        accept_mapping(
            result,
            provider="maishift",
            provider_id=region + ":" + pid,
            subject_id=cid,
            snapshot_id=snapshot_id,
            evidence=evidence,
            method=method,
            expected_source=source,
        )
        require(
            old is None or old == result["mappings"][mapping_key],
            "Existing mapping requires a new explicit review",
        )
    require(used_reviews == set(reviewed), "Snapshot omits reviewed exceptions")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument("--research-input", type=Path)
    inputs.add_argument("--snapshot", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    require(
        str(args.output.resolve()).lower().startswith("c:\\devcache\\"),
        "Output must be a fresh DevCache workspace",
    )
    review = json.loads((ROOT / "registry" / REVIEW_NAME).read_text("utf-8"))
    snapshot = (
        snapshot_from_candidates(args.research_input, review)
        if args.research_input
        else json.loads(args.snapshot.read_text("utf-8"))
    )
    result = install_snapshot(read_registry(ROOT / "registry"), snapshot, review)
    write_registry(result, args.output)
    (args.output / SOURCE_NAME).write_bytes(canonical(snapshot) + b"\n")
    print(
        json.dumps(
            {
                "accepted_mappings": len(snapshot["charts"]),
                "reviewed_exceptions": 56,
                "registry": str(args.output),
                "release_enabled": False,
            }
        )
    )


if __name__ == "__main__":
    main()
