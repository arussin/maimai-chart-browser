"""Incremental song artwork and public mapping preparation shared by rebuild paths."""

from __future__ import annotations

import re
import time
from collections import Counter
from collections.abc import Sequence
from copy import deepcopy
from pathlib import Path
from typing import Any

from .artwork_store import migrate_artwork, verify_asset
from .catalog_capture import CaptureStore
from .coverage_queue import complete_job, empty_work, migrate_work, plan_batch, retry_policy
from .coverage_runtime import producer_identity
from .coverage_sources import ArtworkSources, WikiArtwork, capture_snapshot
from .coverage_sources import wiki_jacket as wiki_jacket
from .coverage_types import CaptureError, Failure, FailureKind, SnapshotError
from .enrichment import classify_titles, select_artwork
from .provider_reconciliation import decide_reconciliation, failed_refresh
from .registry import digest, resolve
from .snapshots import atomic_json, read_json

POLICY = "sustainable-coverage-2"
IMAGE_BASES = {
    "JP": "https://maimaidx.jp/maimai-mobile/img/Music/",
    "INTL": "https://maimaidx-eng.com/maimai-mobile/img/Music/",
}
IMAGE_NAME = re.compile(r"[A-Za-z0-9_-]+\.(?:png|jpg|jpeg|webp)", re.I)
CONFIG = {
    "version": POLICY,
    "wiki_budget": 300,
    "oldest_reserved": 100,
    "song_budget": 300,
    "retry_seconds": {
        "not_found": 86400 * 7,
        "ambiguous": 86400 * 7,
        "unavailable": 900,
        "unsupported": 86400,
        "missing": 86400,
    },
    "image_bytes": 4 * 1024 * 1024,
    "image_pixels": 16000000,
    "thumbnail_pixels": 128,
    "webp_quality": 85,
    "placeholder_sha256": [],
    "artwork_sources": ["otoge-db", "lxns"],
    "otoge_revision": "751705e5710a4c8bce3dc50573c6912e55283dd2",
}


def thumbnail(raw):
    from .artwork_store import thumbnail as convert

    return convert(raw, CONFIG)


def _official_index(value):
    latest = {}
    for observation in sorted(
        value["observations"].values(),
        key=lambda o: (o.get("observed_at", ""), o["observation_id"]),
    ):
        if observation["field"] != "metadata":
            continue
        sid = resolve(value, observation["subject_id"])
        source = value["sources"][observation["snapshot_id"]]
        region = observation["region"]
        if source.get("provider") == "sega-" + str(region).lower() and region in IMAGE_BASES:
            latest[sid, region] = observation
    result = {}
    for (sid, region), observation in latest.items():
        name = observation["value"].get("image_url")
        if isinstance(name, str) and IMAGE_NAME.fullmatch(name):
            result.setdefault(sid, {})[region] = {
                "url": IMAGE_BASES[region] + name,
                "snapshot_id": observation["snapshot_id"],
                "assertion": digest(observation["value"]),
            }
    return result


def _state(path):
    return migrate_work(read_json(path)) if path.exists() else empty_work()


def _put_asset(raw, metadata, root, evidence, *, policy=POLICY, producer=None):
    from .artwork_store import put_asset

    return put_asset(
        raw,
        metadata,
        root,
        evidence,
        policy=policy,
        config=CONFIG,
        codec=thumbnail,
        producer=producer,
    )


def _queue(value, state, now, official_index=None):
    official_index = _official_index(value) if official_index is None else official_index
    evidence = {
        sid: digest(
            {
                "metadata": song["metadata"],
                "official": official_index.get(sid, {}),
                "policy": CONFIG,
                "producer": state.get("producer_policy"),
                "external": state.get("source_evidence", {}).get(sid, {}),
            }
        )
        for sid, song in value["songs"].items()
        if not song.get("redirect")
    }
    selected = {
        sid: song.get("enrichment", {}).get("artwork", {}).get("selected", {})
        for sid, song in value["songs"].items()
    }
    return plan_batch(
        evidence,
        selected,
        state,
        now,
        limit=CONFIG["song_budget"],
        reserved=CONFIG["oldest_reserved"],
    )


def _retry(details, attempts, now, errors=()):
    failures = [
        Failure(
            FailureKind.RATE_LIMIT
            if item.get("status") == 429
            else FailureKind.ABSENT
            if item.get("status") == 404
            else FailureKind.TRANSPORT,
            "retained HTTP outcome",
            status=item.get("status"),
            retry_after=item.get("retry_after"),
        )
        for item in details
    ]
    failures.extend(error for error in errors if isinstance(error, Failure))
    return retry_policy(failures, attempts, now)


def coverage_inventory(value):
    songs = {sid for sid, song in value["songs"].items() if not song.get("redirect")}
    charts = {cid for cid, chart in value["charts"].items() if not chart.get("redirect")}
    mapped = {
        resolve(value, mapping["subject_id"])
        for mapping in value["mappings"].values()
        if mapping["provider"] == "kamaitachi" and mapping["state"] == "accepted"
    }
    jackets = {
        sid: {
            scope: selection["path"]
            for scope, selection in value["songs"][sid]
            .get("enrichment", {})
            .get("artwork", {})
            .get("selected", {})
            .items()
        }
        for sid in songs
    }
    jackets = {sid: selections for sid, selections in jackets.items() if selections}
    listings = {}
    for observation in sorted(
        value["observations"].values(),
        key=lambda row: (row.get("observed_at", ""), row["observation_id"]),
    ):
        if observation["field"] == "listing":
            listings[resolve(value, observation["subject_id"]), observation["region"]] = (
                observation["value"]
            )
    scopes = {}
    for region in ("JP", "INTL", "historical"):
        group = {
            cid
            for cid in charts
            if (
                all(listings.get((cid, r)) != "listed" for r in ("JP", "INTL"))
                if region == "historical"
                else listings.get((cid, region)) == "listed"
            )
        }
        group_songs = {resolve(value, value["charts"][cid]["song_id"]) for cid in group}
        scopes[region] = {
            "charts": len(group),
            "mapped_charts": len(group & mapped),
            "songs": len(group_songs),
            "songs_with_artwork": len(group_songs & jackets.keys()),
        }
    return {
        "charts": len(charts),
        "songs": len(songs),
        "mapped": sorted(mapped & charts),
        "artwork": jackets,
        "scopes": scopes,
    }


def coverage_changes(before, after):
    result = {"before": before, "after": after}
    for kind, left, right in (
        ("mappings", set(before["mapped"]), set(after["mapped"])),
        ("artwork", set(before["artwork"]), set(after["artwork"])),
    ):
        changed = sorted(
            sid
            for sid in left & right
            if kind == "artwork" and before["artwork"][sid] != after["artwork"][sid]
        )
        result[kind] = {
            "added": sorted(right - left),
            "removed": sorted(left - right),
            "replaced": changed,
            "unchanged": len(left & right) - len(changed),
        }
        if left - right:
            raise ValueError("Unexplained accepted identity-level coverage loss")
    return result


def _prepare_song(sid, song, job, official, capture, root, sources, wiki, producer):
    old = deepcopy(song.get("enrichment", {}).get("artwork", {}).get("selected", {}))
    accepted, failures = [], []

    def put(raw, metadata, evidence):
        return _put_asset(raw, metadata, root, evidence, producer=producer)

    for region, candidate in official.items():
        evidence = {"song_id": sid, "region": region, **candidate}
        if old.get(region, {}).get("evidence") == evidence:
            accepted.append(region)
            continue
        try:
            raw, metadata = capture.get(candidate["url"])
            select_artwork(song, region, put(raw, metadata, evidence))
            accepted.append(region)
        except CaptureError as error:
            failures.append(error.failure)
    if not accepted and not old:
        candidates = sources.for_song(sid, song)
        failures.extend(sources.failures.values())
        for candidate in candidates:
            try:
                raw, metadata = capture.get(candidate.url)
                select_artwork(
                    song, "default", put(raw, metadata, candidate.evidence(sid, song["metadata"]))
                )
                accepted.append("default")
                break
            except CaptureError as error:
                failures.append(error.failure)
        if not accepted:
            try:
                select_artwork(song, "default", wiki.selection(sid, song, job, put))
                accepted.append("default")
            except CaptureError as error:
                failures.append(error.failure)
    current = song.get("enrichment", {}).get("artwork", {}).get("selected", {})
    if not current.get("default") and current:
        select_artwork(song, "default", current.get("JP") or current.get("INTL"))
    deferred = any(f.kind == FailureKind.DEFERRED for f in failures)
    status = (
        "accepted"
        if current and not failures
        else "partial"
        if accepted
        else "retained_on_failure"
        if old
        else "deferred"
        if deferred
        else "unresolved"
    )
    job["source_assessment"] = sources.assessments.get(
        sid, [{"status": "retained_verified" if old else "official_verified"}]
    )
    return status, failures, not deferred


def assessment_inventory(value, state):
    gaps, unattempted = [], []
    for sid, song in value["songs"].items():
        if song.get("redirect"):
            continue
        job = state["jobs"].get(sid, {})
        if not job.get("attempts") or job.get("evidence") != job.get("pending_evidence"):
            unattempted.append(sid)
        if not song.get("enrichment", {}).get("artwork", {}).get("selected"):
            gaps.append(
                {
                    "song_id": sid,
                    "title": song["metadata"].get("title"),
                    "artist": song["metadata"].get("artist"),
                    "status": job.get("status", "unattempted"),
                    "reason": job.get("reason"),
                    "sources": job.get("source_assessment", []),
                }
            )
    return {
        "songs": len([s for s in value["songs"].values() if not s.get("redirect")]),
        "unattempted": unattempted,
        "artwork_gaps": gaps,
    }


def prepare_coverage(
    value: dict[str, Any],
    published: dict[str, Any],
    capture: CaptureStore,
    root: Path | str,
    output: Path | str,
    *,
    roots: Sequence[Path | str | None] = (),
    offline: bool = False,
    replay: Path | str | None = None,
    now: int | None = None,
    title_reviews: Sequence[dict[str, Any]] = (),
    provider_reviews: Sequence[dict[str, Any]] = (),
    artwork_reviews: Sequence[dict[str, Any]] = (),
    work: dict[str, Any] | None = None,
    reassess_policy: bool = False,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Prepare a validated batch; the caller can checkpoint it before publication."""
    now = int(time.time()) if now is None else now
    root, output = Path(root), Path(output)
    result = deepcopy(value)
    producer = producer_identity()
    if reassess_policy and not replay:
        raise ValueError("Policy reassessment requires an explicit captured replay")
    state = migrate_work(work) if work is not None else _state(root / "work.json")
    prior = read_json(Path(replay).parent / "coverage-inputs.json") if replay else None
    if prior:
        if prior["starting_registry_sha256"] != digest(value):
            raise ValueError("Coverage replay starting state differs")
        if not reassess_policy and (prior["config"] != CONFIG or prior.get("producer") != producer):
            raise ValueError(
                "Coverage replay producer or policy differs; explicitly reassess captures"
            )
        state, now = migrate_work(prior["work"]), prior["checked_at"]
    inputs = {
        "version": POLICY,
        "starting_registry_sha256": digest(value),
        "config": CONFIG,
        "producer": producer,
        "reassessment_of": digest(prior)
        if reassess_policy
        else prior.get("reassessment_of")
        if prior
        else None,
        "work": deepcopy(state),
        "checked_at": now,
        "title_reviews": list(title_reviews),
        "provider_reviews": list(provider_reviews),
        "artwork_reviews": list(artwork_reviews),
    }
    if prior and any(
        prior.get(k, []) != inputs[k]
        for k in ("title_reviews", "provider_reviews", "artwork_reviews")
    ):
        raise ValueError("Coverage replay reviews differ")
    migration = migrate_artwork(result, published, roots, root)
    classify_titles(result, title_reviews)
    before = coverage_inventory(result)
    capture.now = now
    capture.cooldowns.update(state.get("source_cooldowns", {}))
    provider = {"status": "offline_retained", "conflicts": [], "added": []}
    if not offline or replay:
        try:
            decision = decide_reconciliation(result, capture_snapshot(capture), provider_reviews)
        except (CaptureError, SnapshotError) as error:
            result, provider = failed_refresh(result, str(error))
            provider["failure"] = (
                error.failure
                if isinstance(error, CaptureError)
                else Failure(FailureKind.SCHEMA, str(error))
            ).record()
        else:
            if decision.blockers:
                atomic_json(
                    output / "coverage-conflicts.json",
                    {**decision.report, "blockers": decision.blockers},
                )
            result, provider = decision.require_valid()
    sources = ArtworkSources(
        capture, result["songs"], providers=CONFIG["artwork_sources"], reviews=artwork_reviews
    )
    # Capture each catalog once so new evidence invalidates a negative result.
    if not offline or replay:
        for name in sources.providers:
            sources._rows(name)
        sources.validate_reviews(result["songs"])
        state["source_evidence"] = {
            sid: sources.evidence(sid, song)
            for sid, song in result["songs"].items()
            if not song.get("redirect")
        }
    state["producer_policy"] = producer["policy_sha256"]
    official = _official_index(result)
    state, selected = _queue(result, state, now, official)
    selected = prior["selected_work"] if prior else [] if offline else selected
    inputs["selected_work"] = selected
    atomic_json(output / "coverage-inputs.json", inputs)
    atomic_json(output / "coverage-start.json", value)
    outcomes, wiki = [], WikiArtwork(capture, result["songs"])
    for sid in selected:
        song, job = result["songs"][sid], state["jobs"][sid]
        status, failures, performed = _prepare_song(
            sid,
            song,
            job,
            official.get(sid, {}),
            capture,
            root,
            sources,
            wiki,
            producer["policy_sha256"],
        )
        complete_job(state, sid, status=status, failures=failures, now=now, performed=performed)
        errors = [f.message for f in failures]
        if not song.get("enrichment", {}).get("artwork", {}).get("selected"):
            fingerprint = digest(
                {"song_id": sid, "evidence": job["pending_evidence"], "policy": POLICY}
            )
            state["reviews"].setdefault(
                fingerprint,
                {
                    "song_id": sid,
                    "status": status,
                    "reason": errors[-1] if errors else "no verified source",
                },
            )
        outcomes.append(
            {
                "song_id": sid,
                "status": status,
                "errors": errors,
                "failures": [f.record() for f in failures],
            }
        )
    state["source_cooldowns"] = dict(capture.cooldowns)
    assets = {}
    for song in result["songs"].values():
        for selection in song.get("enrichment", {}).get("artwork", {}).get("selected", {}).values():
            verify_asset(root, selection["path"], selection["asset"])
            assets[selection["path"]] = selection["asset"]
    atomic_json(output / "coverage-state.json", state)
    report = {
        "version": POLICY,
        "provider": provider,
        "migration": migration,
        "artwork": outcomes,
        "counts": dict(Counter(row["status"] for row in outcomes)),
        "assets": assets,
        "coverage": coverage_changes(before, coverage_inventory(result)),
        "assessment": assessment_inventory(result, state),
        "source_assessment": sources.report(),
    }
    atomic_json(output / "coverage-audit.json", report)
    return result, report
