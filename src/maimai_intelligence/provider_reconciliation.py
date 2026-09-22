"""Revision-bound public Kamaitachi reconciliation, independent of player records."""

import re
from collections import defaultdict
from copy import deepcopy

from .coverage_types import ReconciliationDecision, ReviewError, SnapshotError
from .enrichment import CHART_VERSION
from .identity_policy import normalized, variant
from .registry import DIFFICULTIES, accept_mapping, digest, resolve

POLICY = "kamaitachi-reconciliation-1"
REVISION_URL = "https://api.github.com/repos/zkldi/Tachi/commits?per_page=1"
BASE = "https://raw.githubusercontent.com/zkldi/Tachi/"


def validate_snapshot(snapshot, previous_counts=None):
    if not isinstance(snapshot, dict) or not re.fullmatch(
        r"[a-f0-9]{40}", snapshot.get("revision", "")
    ):
        raise SnapshotError("Provider snapshot requires an immutable revision")
    ids, charts = set(), set()
    for kind in ("songs", "charts"):
        if not isinstance(snapshot.get(kind), list) or not snapshot[kind]:
            raise SnapshotError("Incomplete provider snapshot")
        old = (previous_counts or {}).get(kind, 0)
        if old and abs(len(snapshot[kind]) - old) > max(50, old * 0.25):
            raise SnapshotError("Provider count change requires explicit review")
    for song in snapshot["songs"]:
        if not isinstance(song, dict):
            raise SnapshotError("Invalid provider song structure")
        sid = song.get("id")
        if (
            not isinstance(sid, str)
            or not sid
            or sid in ids
            or any(not isinstance(song.get(k), str) for k in ("title", "artist"))
        ):
            raise SnapshotError("Invalid or duplicate provider song")
        ids.add(sid)
    aliases = set()
    for chart in snapshot["charts"]:
        if not isinstance(chart, dict):
            raise SnapshotError("Invalid provider chart structure")
        cid = chart.get("chartID", chart.get("id"))
        if (
            not isinstance(cid, str)
            or not cid
            or cid in charts
            or chart.get("songID") not in ids
            or not isinstance(chart.get("difficulty"), str)
        ):
            raise SnapshotError("Invalid provider chart reference or duplicate")
        charts.add(cid)
        alias = chart.get("legacyChartID")
        if alias:
            if not isinstance(alias, str) or alias in aliases:
                raise SnapshotError("Duplicate historical provider alias")
            aliases.add(alias)
    if aliases & charts:
        raise SnapshotError("Historical alias collides with provider identity")
    return snapshot


def _outcomes(value, status, *, usable=None, snapshot_id=None):
    accepted = {
        resolve(value, m["subject_id"])
        for m in value["mappings"].values()
        if m["provider"] == "kamaitachi" and m["state"] == "accepted"
    }
    for cid, chart in value["charts"].items():
        if chart.get("redirect"):
            continue
        result = {
            "status": status,
            "usable": cid in accepted if usable is None else usable,
            "policy": POLICY,
        }
        if snapshot_id:
            result["snapshot_id"] = snapshot_id
        chart.setdefault("enrichment", {"version": CHART_VERSION}).setdefault("providers", {})[
            "kamaitachi"
        ] = result


def failed_refresh(value, reason):
    result = deepcopy(value)
    _outcomes(result, "failed_refresh")
    return result, {"status": "failed_refresh", "reason": reason, "conflicts": [], "added": []}


def reconcile(value, snapshot, reviews=()):
    """Strict unique matches and scoped reviews only; never admit songs or charts."""
    result = deepcopy(value)
    previous = [s for s in value["sources"].values() if s.get("provider") == "kamaitachi-metadata"]
    latest = max(previous, key=lambda source: source.get("sequence", 0)) if previous else {}
    counts = latest.get("counts")
    validate_snapshot(snapshot, counts)
    identity = digest({"songs": snapshot["songs"], "charts": snapshot["charts"], "policy": POLICY})
    source_id = "kamaitachi-metadata:" + identity
    result["sources"].setdefault(
        source_id,
        {
            "provider": "kamaitachi-metadata",
            "sequence": latest.get("sequence", 0) + 1,
            "revision": snapshot["revision"],
            "policy": POLICY,
            "sha256": identity,
            "counts": {k: len(snapshot[k]) for k in ("songs", "charts")},
            "captures": deepcopy(snapshot.get("sources", {})),
        },
    )
    own, incoming = defaultdict(list), defaultdict(list)
    songs = {s["id"]: s for s in snapshot["songs"]}
    rows = {}
    for cid, chart in value["charts"].items():
        if chart.get("redirect") or chart["variant_id"] != "ordinary":
            continue
        song = value["songs"][resolve(value, chart["song_id"])]["metadata"]
        identity = (
            normalized(song.get("title")),
            normalized(song.get("artist")),
            chart["format"],
            chart["difficulty"],
        )
        if all(identity[:2]):
            own[identity].append(cid)
    for chart in snapshot["charts"]:
        fmt, difficulty = variant(chart["difficulty"])
        if difficulty not in DIFFICULTIES:
            continue
        song = songs[chart["songID"]]
        pid = chart.get("chartID", chart.get("id"))
        identity = (normalized(song["title"]), normalized(song["artist"]), fmt, difficulty)
        row = {
            "title": song["title"],
            "artist": song["artist"],
            "format": fmt,
            "difficulty": difficulty,
            "songID": chart["songID"],
            "constant": chart.get("levelNum"),
            "versions": chart.get("versions", []),
            "displayVersion": chart.get("data", {}).get("displayVersion", ""),
            "level": chart.get("level", ""),
        }
        rows[pid] = (row, chart.get("legacyChartID"), identity)
        incoming[identity].append(pid)
    reviewed = {r["provider_chart_id"]: r for r in reviews if "provider_chart_id" in r}
    reviewed_songs = {r["provider_song_id"]: r for r in reviews if "provider_song_id" in r}
    if len(reviewed) + len(reviewed_songs) != len(reviews):
        raise ReviewError("Duplicate or unsupported provider review")
    existing = {
        m["provider_id"]: m
        for m in value["mappings"].values()
        if m["provider"] == "kamaitachi" and m["state"] == "accepted"
    }
    _outcomes(result, "absent", snapshot_id=source_id)
    report = {
        "status": "accepted",
        "revision": snapshot["revision"],
        "added": [],
        "conflicts": [],
        "ambiguous": [],
    }
    for pid, (row, alias, identity) in rows.items():
        candidates = own.get(identity, []) if len(incoming[identity]) == 1 else []
        old = existing.get(pid) or (existing.get(alias) if alias else None)
        review = reviewed.get(pid)
        song_review = reviewed_songs.get(row["songID"])
        if song_review:
            sid = song_review.get("song_id")
            if (
                song_review.get("provider") != "kamaitachi"
                or not song_review.get("evidence")
                or sid not in value["songs"]
                or value["songs"][sid].get("redirect")
                or song_review.get("canonical_assertion") != digest(value["songs"][sid]["metadata"])
                or song_review.get("expected_source") != {k: row[k] for k in ("title", "artist")}
            ):
                raise ReviewError("Stale or invalid provider song review")
            slots = [
                cid
                for cid, chart in value["charts"].items()
                if chart["song_id"] == sid
                and not chart.get("redirect")
                and chart["variant_id"] == "ordinary"
                and (chart["format"], chart["difficulty"]) == identity[2:]
            ]
            if len(slots) != 1:
                continue
            review = {
                "provider": "kamaitachi",
                "chart_id": slots[0],
                "evidence": song_review["evidence"],
                "expected_source": {k: row[k] for k in ("title", "artist", "format", "difficulty")},
            }
        if review:
            cid = review.get("chart_id")
            if (
                review.get("provider") != "kamaitachi"
                or not review.get("evidence")
                or review.get("expected_source")
                != {k: row[k] for k in ("title", "artist", "format", "difficulty")}
                or cid not in value["charts"]
                or value["charts"][cid].get("redirect")
                or value["charts"][cid]["variant_id"] != "ordinary"
                or (value["charts"][cid]["format"], value["charts"][cid]["difficulty"])
                != identity[2:]
            ):
                raise ReviewError("Stale or invalid provider review")
            candidates = [cid]
        elif old:
            cid = resolve(value, old["subject_id"])
            recorded = old.get("metadata", {})
            unchanged = all(recorded.get(k) == row[k] for k in ("title", "artist"))
            if (
                unchanged
                and (old.get("format"), old.get("difficulty")) == identity[2:]
                and (not candidates or candidates == [cid])
            ):
                candidates = [cid]
        if old and candidates != [resolve(value, old["subject_id"])]:
            cid = resolve(value, old["subject_id"])
            report["conflicts"].append(
                {"provider_chart_id": pid, "chart_id": cid, "source_assertion": digest(row)}
            )
            result["charts"][cid]["enrichment"]["providers"]["kamaitachi"].update(
                status="conflicting"
            )
            continue
        if len(candidates) != 1:
            for cid in own.get(identity, []):
                result["charts"][cid]["enrichment"]["providers"]["kamaitachi"].update(
                    status="ambiguous"
                )
            if own.get(identity):
                report["ambiguous"].append(pid)
            continue
        cid = candidates[0]
        for provider_id in (pid, alias):
            if not provider_id:
                continue
            prior = existing.get(provider_id)
            if prior:
                if resolve(value, prior["subject_id"]) != cid:
                    report["conflicts"].append({"provider_chart_id": provider_id, "chart_id": cid})
                continue
            accept_mapping(
                result,
                provider="kamaitachi",
                provider_id=provider_id,
                subject_id=cid,
                snapshot_id=source_id,
                acceptance_basis="reviewed" if review else "policy_exact",
                evidence=review["evidence"]
                if review
                else {"policy": POLICY, "assertion": digest(row)},
                method="reviewed-source-exception" if review else "unique-title-artist-variant",
                metadata={**row, **({"aliasOf": pid} if provider_id == alias else {})},
            )
            report["added"].append(provider_id)
        result["charts"][cid]["enrichment"]["providers"]["kamaitachi"].update(
            status="accepted", usable=True
        )
    if report["conflicts"]:
        report["status"] = "conflicting"
    return result, report


def decide_reconciliation(value, snapshot, reviews=()):
    """Return typed blockers separately from accepted/retained provider state."""
    try:
        result, report = reconcile(value, snapshot, reviews)
    except ReviewError as error:
        return ReconciliationDecision(
            value, {"status": "blocked", "conflicts": [], "added": []}, (str(error),)
        )
    blockers = ("Conflicting provider assignment requires review",) if report["conflicts"] else ()
    return ReconciliationDecision(result, report, blockers)
