"""Build the pinned, nonpersonal challenge research package entirely offline."""

from __future__ import annotations

import argparse
import json
import time
import unicodedata
from collections import Counter
from importlib.resources import files as resource_files
from pathlib import Path

from maimai_analyzer.catalog_navigation import build_navigation, source_bpm
from maimai_analyzer.challenge import VERSION, profile_chart, snippet
from maimai_analyzer.challenge_similarity import POLICY, query_challenges, reference_scale
from maimai_analyzer.contracts import ChartInputError, canonical_bytes, content_hash
from maimai_analyzer.dataset import SOURCE_LOCK, inventory_delta, review_benchmark
from maimai_analyzer.simai_subset import PARSER_VERSION, parse_simai_subset
from maimai_intelligence.io import atomic_write_text
from scripts.acquire_maichart_pack import selected_entries, sha256
from scripts.analyze_simai_corpus import _identity, _load, _relative, _verify
from scripts.prepare_maichart_pack import _verify_file

PACKAGE_VERSION = "challenge-package-1"


def write(root, name, value):
    path = _relative(root, name)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = canonical_bytes(value)
    atomic_write_text(path, data.decode())
    return {"path": name, "sha256": sha256(data), "bytes": len(data)}


def verify_capture(root, manifest):
    raw = (root / "capture.json").read_bytes()
    capture = json.loads(raw)
    if sha256(raw) != manifest["capture_sha256"] or capture["revision"] != SOURCE_LOCK["revision"]:
        raise ValueError("Capture hash or pinned source revision mismatch")
    if capture["repository"] != SOURCE_LOCK["repository"]:
        raise ValueError("Unexpected chart repository")
    tree = (root / "source-tree.json").read_bytes()
    if sha256(tree) != capture["tree_sha256"]:
        raise ValueError("Source inventory hash mismatch")
    expected = {(r["path"], r["sha"], r["size"]) for r in selected_entries(json.loads(tree))}
    actual = {(r["path"], r["git_blob_sha"], r["bytes"]) for r in capture["files"]}
    if expected != actual or len(actual) != len(capture["files"]):
        raise ValueError("Captured inventory differs from source tree")
    for item in capture["files"]:
        _verify_file(root, item)
    return capture


def parse_row(root, row, memo, work):
    body = _verify(root, row["body_file"], row["body_sha256"], memo, work, body=True)
    raw = _verify(root, row["source_raw_file"], row["source_raw_sha256"], memo, work, body=True)
    if raw[row["body_byte_start"] : row["body_byte_end"]] != body:
        raise ValueError("Body does not match its raw source byte range")
    identity = _identity(row)
    chart, audit = parse_simai_subset(
        body.decode(),
        **identity,
        source={
            "source_id": row["input_id"],
            "revision": identity["revision"],
            "kind": "public_transcription_evaluation",
            "identity_status": "reviewed",
            "byte_hash": row["body_sha256"],
        },
    )
    return chart, audit


def source_bpms(root, rows):
    """Read retained, hash-verified container metadata without reanalyzing notes."""
    result, memo, work = {}, {}, Counter()
    for row in rows:
        digest = row.get("source_raw_sha256")
        if row.get("acquisition_status") != "available" or not digest or digest in result:
            continue
        raw = _verify(root, row["source_raw_file"], digest, memo, work, body=True)
        result[digest] = source_bpm(raw.decode("utf-8"))
    return result


def build(source, output, *, review_count=12, previous=None):
    output = Path(output).resolve()
    root, manifest, rows, manifest_hash = _load(Path(source) / "manifest.json", output)
    if output.is_relative_to(root):
        raise ValueError("Package output must be outside the source directory")
    output.mkdir(parents=True, exist_ok=True)
    capture = verify_capture(root, manifest)
    started = time.perf_counter()
    implementation = {
        name: sha256(resource_files("maimai_analyzer").joinpath(name).read_bytes())
        for name in (
            "challenge.py",
            "dataset.py",
            "simai_subset.py",
            "simai_notation.py",
            "simai_timing.py",
            "contracts.py",
            "rational.py",
        )
    }
    memo, work, profiles, outcomes = {}, Counter(), [], []
    index = {}
    for number, row in enumerate(rows, 1):
        status = (
            "unavailable"
            if row.get("acquisition_status") != "available"
            else "excluded"
            if row["format"] not in {"STD", "DX"}
            else "identity_unresolved"
        )
        outcome = {"input_id": row["input_id"], "status": status}
        if row.get("body_file") and row["format"] in {"STD", "DX"} and row.get("identity_resolved"):
            key = content_hash(
                {
                    "row": row,
                    "version": VERSION,
                    "parser": PARSER_VERSION,
                    "implementation": implementation,
                }
            )
            cache = _relative(output, f"profiles/{key}.json")
            try:
                if cache.exists():
                    if cache.stat().st_size > 8 * 1024 * 1024:
                        raise ValueError("Cached profile exceeds byte budget")
                    profile = json.loads(cache.read_bytes())
                    digest = profile.pop("package_profile_hash")
                    if content_hash(profile) != digest:
                        raise ValueError("Cached profile hash mismatch")
                    if (
                        profile.get("source_hash") != row["body_sha256"]
                        or profile.get("version") != VERSION
                        or any(profile.get(k) != value for k, value in _identity(row).items())
                    ):
                        raise ValueError("Cached profile belongs to another input or version")
                    work["cache_hits"] += 1
                else:
                    chart, _ = parse_row(root, row, memo, work)
                    profile = profile_chart(chart)
                    profile.update(
                        title=row["title"],
                        artist=row["artist"],
                        level=row.get("level"),
                        input_id=row["input_id"],
                        source_container_id=row["source_container_id"],
                    )
                    # Conservative evaluation grouping only; never an account identity join.
                    profile["song_family"] = (
                        "title-family:"
                        + content_hash(
                            unicodedata.normalize("NFKC", row["title"]).casefold().strip()
                        )[:24]
                    )
                    write(
                        output,
                        f"profiles/{key}.json",
                        {**profile, "package_profile_hash": content_hash(profile)},
                    )
                    work["analyzed"] += 1
                profiles.append(profile)
                index[profile["chart_id"]] = row
                outcome.update(
                    status="analyzed",
                    profile_path=f"profiles/{key}.json",
                    chart_id=profile["chart_id"],
                    source_hash=row["body_sha256"],
                    profile_content_hash=content_hash(profile),
                )
            except ChartInputError as error:
                outcome.update(status="unsupported", reason=str(error))
        outcomes.append(outcome)
        if number % 250 == 0:
            print(json.dumps({"processed": number, "profiles": len(profiles)}), flush=True)
    scale = reference_scale(profiles)
    benchmark = review_benchmark(profiles)
    profile_map = {p["chart_id"]: p for p in profiles}
    review = []
    available = [q for q in benchmark["queries"] if q["partition"] == "development"]
    amount = min(review_count, len(available))
    development = [
        available[round(i * (len(available) - 1) / max(1, amount - 1))] for i in range(amount)
    ]
    for number, entry in enumerate(development, 1):
        query = profile_map[entry["chart_id"]]
        matches = query_challenges(query, profiles, scale)
        alternatives = query_challenges(query, profiles, scale, detail=False)
        item = {
            "query_id": query["chart_id"],
            "candidates": matches,
            "demand_baseline": [m["chart_id"] for m in alternatives],
            "judgments": [],
        }
        review.append(item)
        print(json.dumps({"review_query": number, "matches": len(matches)}), flush=True)
    # Snippets are restricted to the review's supporting passages, not full charts.
    needed = {}
    for item in review:
        for match in item["candidates"]:
            for pair in match["passages"]:
                needed.setdefault(item["query_id"], set()).add(pair["query_window"])
                needed.setdefault(match["chart_id"], set()).add(pair["candidate_window"])
    snippets = {}
    for cid, windows in needed.items():
        raw, _ = parse_row(root, index[cid], memo, work)
        snippets[cid] = {
            w["window_id"]: snippet(raw, w)
            for w in profile_map[cid]["windows"]
            if w["window_id"] in windows
        }
    public = [{k: v for k, v in p.items() if k not in {"windows"}} for p in profiles]
    navigation = build_navigation(public, rows, bpm_by_source=source_bpms(root, rows))
    files = [
        write(output, "catalog.json", public),
        write(output, "reference-scale.json", scale),
        write(output, "benchmark.json", benchmark),
        write(output, "review.json", review),
        write(output, "snippets.json", snippets),
        write(output, "outcomes.json", outcomes),
        write(output, "navigation.json", navigation),
    ]
    if previous:
        before = json.loads(Path(previous).read_bytes())
        files.append(write(output, "inventory-delta.json", inventory_delta(before, rows)))
    files.append(write(output, "source-inventory.json", rows))
    result = {
        "version": PACKAGE_VERSION,
        "profile_version": VERSION,
        "retrieval_policy": POLICY,
        "source": SOURCE_LOCK,
        "manifest_hash": manifest_hash,
        "implementation": implementation,
        "builder_hash": sha256(Path(__file__).read_bytes()),
        "navigation_builder_hash": sha256(
            resource_files("maimai_analyzer").joinpath("catalog_navigation.py").read_bytes()
        ),
        "retrieval_hash": sha256(
            resource_files("maimai_analyzer").joinpath("challenge_similarity.py").read_bytes()
        ),
        "source_files": len(capture["files"]),
        "outcomes": dict(Counter(r["status"] for r in outcomes)),
        "files": files,
        "status": "research_preview",
        "adoption_gates": {
            "source_fidelity": "unreviewed",
            "patterns": "unreviewed",
            "retrieval": "awaiting_user_judgments",
        },
        "score_mapping": "No report identity mapping supplied; personal overlay disabled",
    }
    write(output, "package.json", result)
    write(
        output,
        "work.json",
        {"elapsed_seconds": round(time.perf_counter() - started, 3), "work": dict(work)},
    )
    from maimai_intelligence.challenge_review import render_review

    atomic_write_text(
        output / "index.html",
        render_review(result, public, review, snippets, benchmark, navigation),
    )
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--review-count", type=int, default=12, choices=range(0, 25))
    parser.add_argument("--previous-inventory", type=Path)
    args = parser.parse_args()
    result = build(
        args.source, args.output, review_count=args.review_count, previous=args.previous_inventory
    )
    print(json.dumps(result["outcomes"]))


if __name__ == "__main__":
    main()
