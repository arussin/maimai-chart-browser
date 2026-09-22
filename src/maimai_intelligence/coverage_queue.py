"""Pure fair queue and retry policy; clocks and persistence belong to callers."""

from copy import deepcopy
from email.utils import parsedate_to_datetime

from .coverage_types import FailureKind

VERSION = "coverage-work-2"
RETRYABLE = {"retained_on_failure", "partial", "deferred", "unresolved"}


def empty_work():
    return {"version": VERSION, "generation": 0, "sequence": 0, "jobs": {}, "reviews": {}}


def migrate_work(value):
    if value.get("version") not in {"coverage-work-1", VERSION}:
        raise ValueError("Unsupported coverage work state")
    state = deepcopy(value)
    state["version"] = VERSION
    state.setdefault("sequence", 0)
    # Older jobs retain their discovery order. New attempts move behind pending work.
    for _sid, job in sorted(
        state["jobs"].items(), key=lambda item: (item[1].get("first_seen", 0), item[0])
    ):
        if "queue_order" not in job:
            state["sequence"] += 1
            job["queue_order"] = state["sequence"]
            job["ordered_attempts"] = job.get("attempts", 0)
    return state


def plan_batch(evidence, selected_artwork, work, now, *, limit=300, reserved=100):
    state = migrate_work(work)
    state["generation"] += 1
    eligible, changed = [], []
    for sid, fingerprint in evidence.items():
        if sid not in state["jobs"]:
            state["sequence"] += 1
            state["jobs"][sid] = {
                "first_seen": state["generation"],
                "attempts": 0,
                "next_retry": 0,
                "queue_order": state["sequence"],
                "ordered_attempts": 0,
            }
        job = state["jobs"][sid]
        if job.get("attempts", 0) > job.get("ordered_attempts", 0):
            state["sequence"] += 1
            job["queue_order"] = state["sequence"]
            job["ordered_attempts"] = job["attempts"]
        new = job.get("evidence") != fingerprint
        retry = not selected_artwork.get(sid) or job.get("status") in RETRYABLE
        # A host cooldown is enforced by acquisition, not by suppressing other
        # providers when a new snapshot offers fresh evidence for this song.
        if new or (retry and job.get("next_retry", 0) <= now):
            eligible.append(sid)
            if new:
                changed.append(sid)
        job["pending_evidence"] = fingerprint

    def order(sid):
        return state["jobs"][sid]["queue_order"], sid

    oldest = sorted(eligible, key=order)
    batch = list(dict.fromkeys(oldest[:reserved] + sorted(changed, key=order) + oldest))
    return state, batch[:limit]


def retry_policy(failures, attempts, now):
    kinds = {f.kind for f in failures}
    if FailureKind.RATE_LIMIT in kinds:
        deadlines = [now + 900]
        for failure in failures:
            if failure.kind != FailureKind.RATE_LIMIT:
                continue
            try:
                deadlines.append(now + max(0, int(failure.retry_after)))
            except (ValueError, TypeError):
                try:
                    deadlines.append(int(parsedate_to_datetime(failure.retry_after).timestamp()))
                except (ValueError, TypeError, AttributeError):
                    pass
        return "rate_limited", max(deadlines)
    if FailureKind.TLS in kinds or FailureKind.SOURCE_COOLDOWN in kinds:
        return "source_cooldown", now + 86400
    if FailureKind.ABSENT in kinds:
        return "not_found", now + 7 * 86400
    if FailureKind.AMBIGUOUS in kinds:
        return "ambiguous", now + 7 * 86400
    if FailureKind.DEFERRED in kinds:
        return "deferred", 0
    if FailureKind.UNSUPPORTED in kinds:
        return "unsupported", now + 86400
    return "unavailable", now + min(86400, 900 * 2 ** min(max(0, attempts - 1), 7))


def complete_job(work, sid, *, status, failures, now, performed=True):
    """A skipped budget slot acknowledges no evidence and does not advance the FIFO."""
    job = work["jobs"][sid]
    if not performed:
        job["status"] = "deferred"
        return
    job["evidence"] = job["pending_evidence"]
    job["attempts"] += 1
    job["checked_at"] = now
    job["status"] = status
    job["reason"], job["next_retry"] = (
        ("accepted", 0) if status == "accepted" else retry_policy(failures, job["attempts"], now)
    )
    work["sequence"] += 1
    job["queue_order"] = work["sequence"]
    job["ordered_attempts"] = job["attempts"]
