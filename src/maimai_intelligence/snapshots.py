"""Read-only Kamaitachi acquisition and immutable, append-only local captures."""

from __future__ import annotations

import contextlib
import hashlib
import json
import os
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path

MAX_BYTES = 32 * 1024 * 1024
SCHEMA_VERSION = "1.0.0"


def canonical(value):
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    ).encode("utf-8")


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def read_json(path):
    with Path(path).open("rb") as stream:
        data = stream.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("JSON input exceeds 32 MiB")
    result = json.loads(
        data, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Nonfinite JSON"))
    )
    if not isinstance(result, dict):
        raise ValueError("Expected a JSON object")
    return result


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".pending-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(canonical(value) + b"\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


class KamaitachiDownloader:
    """Only the two score-reading operations; never initiates a game import."""

    def __init__(self, token=None, *, opener=None, timeout=60):
        self.token = token

        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                raise ValueError("Score downloads do not follow redirects")

        self.opener = opener or urllib.request.build_opener(NoRedirect()).open
        self.timeout = timeout

    def _read(self, username, game, resource):
        user = urllib.parse.quote(username, safe="")
        game_path = urllib.parse.quote(game, safe="")
        headers = {"Accept": "application/json", "User-Agent": "maimai-chart-browser/0.1.0"}
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        request = urllib.request.Request(  # noqa: S310 - fixed HTTPS host; quoted path segments
            f"https://kamai.tachi.ac/api/v1/users/{user}/games/{game_path}/{resource}",
            headers=headers,
            method="GET",
        )
        try:
            with self.opener(request, timeout=self.timeout) as response:
                raw = response.read(MAX_BYTES + 1)
            if len(raw) > MAX_BYTES:
                raise ValueError("Score response exceeds 32 MiB")
            payload = json.loads(raw)
            if not isinstance(payload, dict) or payload.get("success") is not True:
                raise ValueError("Unsuccessful score response")
            canonical(payload)
            return payload
        except Exception as exc:
            # Never expose response bodies, usernames, or credentials in error output.
            raise ValueError(
                "Could not download scores; check access and retry explicitly"
            ) from exc

    def read_scores(self, username, game):
        return (self._read(username, game, "pbs/all"), self._read(username, game, "scores/recent"))


def _body(payload, key):
    body = payload.get("body", payload)
    if not isinstance(body, dict) or not isinstance(body.get(key), list):
        raise ValueError(f"Score response requires a {key} list")
    if any(not isinstance(record, dict) for record in body[key]):
        raise ValueError("Score records must be objects")
    return body


def normalize_snapshot(pbs, recent, *, source, cutoff_ms, previous_attempts=()):
    """Preserve provider identities, best-score times and observed attempt history."""
    if type(cutoff_ms) is not int or not 0 <= cutoff_ms < 8_640_000_000_000_000:
        raise ValueError("Invalid snapshot cutoff")
    body = _body(pbs, "pbs")
    scores = _body(recent, "scores")["scores"]
    seen_pbs = set()
    for pb in body["pbs"]:
        cid = pb.get("chartID")
        when = pb.get("timeAchieved")
        if not isinstance(cid, str) or not cid or cid in seen_pbs:
            raise ValueError("PBs require unique exact provider chart IDs")
        seen_pbs.add(cid)
        if when is not None and (type(when) is not int or not 0 <= when <= cutoff_ms):
            raise ValueError("Invalid PB time")
    attempts = {}
    for record in [*previous_attempts, *scores]:
        aid, when, cid = record.get("scoreID"), record.get("timeAchieved"), record.get("chartID")
        if not isinstance(aid, str) or not aid or not isinstance(cid, str) or not cid:
            raise ValueError("Attempts require stable score and chart IDs")
        if type(when) is not int or not 0 <= when <= cutoff_ms:
            raise ValueError("Invalid attempt time")
        if aid in attempts and attempts[aid] != record:
            raise ValueError("Conflicting records for one attempt ID")
        attempts[aid] = record
    snapshot = {
        "schema_version": SCHEMA_VERSION,
        "source": source,
        "cutoff_ms": cutoff_ms,
        "pbs": body,
        "attempts": sorted(attempts.values(), key=lambda a: (a["timeAchieved"], a["scoreID"])),
        "coverage": {
            "history_complete": False,
            "unknown_gaps": True,
            "scope": "Observed recent-score downloads; earlier or intervening plays may be missing",
        },
        "raw_hashes": {"pbs": digest(pbs), "recent": digest(recent)},
    }
    return {"snapshot_id": digest(snapshot), **snapshot}


def validate_snapshot(snapshot):
    if snapshot.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unsupported snapshot version")
    contents = {k: v for k, v in snapshot.items() if k != "snapshot_id"}
    if snapshot.get("snapshot_id") != digest(contents):
        raise ValueError("Snapshot content does not match its identity")
    return snapshot


def download_snapshot(store, username, game, *, downloader=None, cutoff_ms=None):
    """Commit both reads together; failures leave the last successful manifest intact."""
    if not username or not game:
        raise ValueError("Username and game are required")
    source = {"provider": "kamaitachi", "username": username, "game": game}
    pbs, recent = (downloader or KamaitachiDownloader()).read_scores(username, game)
    cutoff = int(time.time() * 1000) if cutoff_ms is None else cutoff_ms
    root = Path(store)
    root.mkdir(parents=True, exist_ok=True)
    lock = root / ".capture-lock"
    try:
        descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError as exc:
        raise ValueError(
            "Snapshot store is locked; confirm no writer is running before removing a stale lock"
        ) from exc
    os.close(descriptor)
    try:
        manifest_path = root / "manifest.json"
        manifest = (
            read_json(manifest_path)
            if manifest_path.exists()
            else {
                "schema_version": SCHEMA_VERSION,
                "source": source,
                "latest": None,
                "captures": [],
            }
        )
        if manifest.get("schema_version") != SCHEMA_VERSION or manifest.get("source") != source:
            raise ValueError("Use a separate snapshot store for each player and game")
        previous = []
        if manifest["latest"]:
            latest = manifest["latest"]
            if (
                not isinstance(latest, str)
                or len(latest) != 64
                or any(c not in "0123456789abcdef" for c in latest)
            ):
                raise ValueError("Invalid latest snapshot identity")
            old = validate_snapshot(read_json(root / "captures" / latest / "snapshot.json"))
            if old["source"] != source:
                raise ValueError("Latest snapshot belongs to a different player or game")
            if cutoff < old["cutoff_ms"]:
                raise ValueError("A new capture cannot precede the latest capture")
            previous = old["attempts"]
        snapshot = normalize_snapshot(
            pbs, recent, source=source, cutoff_ms=cutoff, previous_attempts=previous
        )
        sid = snapshot["snapshot_id"]
        captures = root / "captures"
        captures.mkdir(exist_ok=True)
        destination = captures / sid
        artifacts = {"pbs.json": pbs, "recent.json": recent, "snapshot.json": snapshot}
        if destination.exists():
            if any(read_json(destination / name) != value for name, value in artifacts.items()):
                raise ValueError("Existing immutable capture differs")
        else:
            with tempfile.TemporaryDirectory(prefix=".capture-", dir=root) as temporary:
                staged = Path(temporary) / sid
                staged.mkdir()
                for name, value in artifacts.items():
                    atomic_json(staged / name, value)
                os.rename(staged, destination)
        if not any(capture["snapshot_id"] == sid for capture in manifest["captures"]):
            manifest["captures"].append(
                {"snapshot_id": sid, "cutoff_ms": cutoff, "path": f"captures/{sid}/snapshot.json"}
            )
        manifest["latest"] = sid
        atomic_json(manifest_path, manifest)
        return snapshot
    finally:
        with contextlib.suppress(FileNotFoundError):
            lock.unlink()
