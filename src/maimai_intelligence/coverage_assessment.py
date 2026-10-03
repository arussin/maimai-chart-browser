"""Assess a finite public catalog backlog without building or publishing a website."""

import json
from datetime import UTC, datetime
from pathlib import Path

from maimai_intelligence.artwork_store import migrate_artwork
from maimai_intelligence.coverage import coverage_changes, coverage_inventory
from maimai_intelligence.coverage_store import prepare_checkpoint_batch
from maimai_intelligence.registry import read_registry
from maimai_intelligence.snapshots import atomic_json

from .store_lock import writer_lock


def assess(
    registry, published, store, *, roots=(), reviews=None, max_batches=10, fetcher=None, now=None
):
    if not 1 <= max_batches <= 30:
        raise ValueError("Assessment must be bounded to 1 through 30 batches")
    value = read_registry(registry)
    from maimai_intelligence.catalog_loading import MAX_CATALOG_BYTES

    with Path(published).open("rb") as stream:
        raw = stream.read(MAX_CATALOG_BYTES + 1)
    if len(raw) > MAX_CATALOG_BYTES:
        raise ValueError("Retained public catalog exceeds its existing size contract")
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("Retained public catalog must be an object")
    store = Path(store)
    receipts = []
    with writer_lock(store):
        migrate_artwork(value, data, roots, store / "cache/coverage")
        before = coverage_inventory(value)
        initial_gaps = set(value["songs"]) - set(before["artwork"])
        initial_gaps = {sid for sid in initial_gaps if not value["songs"][sid].get("redirect")}
        for index in range(max_batches):
            run = store / "runs" / (datetime.now(UTC).strftime("%Y%m%dT%H%M%S%f") + f"-{index:02d}")
            result, audit, receipt = prepare_checkpoint_batch(
                value, data, store, run, roots=roots, reviews=reviews, fetcher=fetcher, now=now
            )
            receipts.append(
                {
                    **receipt,
                    "run": str(run),
                    "counts": audit["counts"],
                    "unattempted": len(audit["assessment"]["unattempted"]),
                }
            )
            print(json.dumps(receipts[-1]), flush=True)
            if not audit["assessment"]["unattempted"] or not audit["artwork"]:
                break
        summary = {
            "version": "coverage-assessment-1",
            "batches": receipts,
            "coverage": coverage_changes(before, coverage_inventory(result)),
            "assessment": audit["assessment"],
            "complete": not audit["assessment"]["unattempted"],
        }
        remaining = {row["song_id"]: row for row in audit["assessment"]["artwork_gaps"]}
        dispositions = []
        for sid in sorted(initial_gaps):
            selections = (
                result["songs"][sid].get("enrichment", {}).get("artwork", {}).get("selected", {})
            )
            dispositions.append(
                {
                    "song_id": sid,
                    "metadata": result["songs"][sid]["metadata"],
                    "status": "resolved" if selections else "remaining",
                    "selection": selections.get("default"),
                    "gap": remaining.get(sid),
                }
            )
        atomic_json(
            store / "gap-dispositions.json",
            {"version": "artwork-gap-dispositions-1", "songs": dispositions},
        )
        atomic_json(store / "assessment.json", summary)
        return summary
