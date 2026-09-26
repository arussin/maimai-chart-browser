"""Bounded public-source captures shared by repeatable catalog updates."""

from __future__ import annotations

import hashlib
import ipaddress
import re
import socket
import ssl
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from .coverage_types import CaptureError, Failure, FailureKind, IntegrityError
from .snapshots import atomic_json, read_json

ALLOWED = re.compile(
    r"https://(?:mai-notes\.com/data/(?:manifest\.json|charts/[a-f0-9-]{36}\.txt)"
    r"|gamerch\.com/maimai/(?:[0-9]{1,9})?"
    r"|w\.atwiki\.jp/simai/pages/[0-9]{1,6}\.html"
    r"|dp4p6x0xfi5o9\.cloudfront\.net/maimai/data\.json"
    r"|raw\.githubusercontent\.com/zvuc/otoge-db/main/maimai/data/music-ex\.json"
    r"|api\.github\.com/repos/zkldi/Tachi/commits\?per_page=1"
    r"|raw\.githubusercontent\.com/zkldi/Tachi/[a-f0-9]{40}/db/seeds/(?:songs|charts)-maimaidx\.json"
    r"|(?:maimaidx\.jp|maimaidx-eng\.com)/maimai-mobile/img/Music/[A-Za-z0-9_-]+\.(?:png|jpg|jpeg|webp)"
    r"|raw\.githubusercontent\.com/zvuc/otoge-db/[a-f0-9]{40}/maimai/(?:data/music-ex(?:-intl|-deleted)?\.json|jacket/[A-Za-z0-9_-]+\.(?:png|jpg|jpeg))"
    r"|maimai\.lxns\.net/api/v0/maimai/song/list"
    r"|assets2\.lxns\.net/maimai/jacket/[0-9]{1,9}\.png"
    r"|cdn\.gamerch\.com/[A-Za-z0-9_./-]+\.(?:png|jpg|jpeg|webp))"
)
MAX_CAPTURE_BYTES = 16 * 1024 * 1024


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise CaptureError(Failure(FailureKind.SCHEMA, "Public source redirects are not accepted"))


def fetch_public(url: str, headers: dict[str, str]) -> tuple[int, bytes, dict[str, str]]:
    if not ALLOWED.fullmatch(url):
        raise ValueError("Source URL is outside the catalog provider allowlist")
    parsed = urlsplit(url)
    if ".." in parsed.path.split("/"):
        raise ValueError("Invalid public source path")
    addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(row[4][0]).is_global for row in addresses):
        raise ValueError("Public source resolved to a private or local address")
    request = urllib.request.Request(  # noqa: S310 -- fixed public source allowlist.
        url,
        headers={"User-Agent": "maimai.party catalog updater/1", "Accept": "*/*", **headers},
    )
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=25) as response:
            return response.status, response.read(MAX_CAPTURE_BYTES + 1), dict(response.headers)
    except urllib.error.HTTPError as error:
        if error.code == 304:
            return 304, b"", dict(error.headers)
        raise


class CaptureStore:
    """One request per URL per run; conditional HTTP reads and exact offline replay.

    Raw provider captures remain in the local store, outside public assets. The
    run's source receipt pins every successful read, including unchanged bytes.
    Failures never masquerade as a fresh empty provider response.
    """

    def __init__(
        self,
        root: Path | str,
        *,
        offline: bool = False,
        fetcher: Callable[[str, dict[str, str]], tuple[int, bytes, dict[str, str]]] = fetch_public,
        replay: Path | str | None = None,
        now: int | None = None,
        cooldowns: dict[str, Any] | None = None,
    ) -> None:
        self.root = Path(root)
        self.now = int(time.time()) if now is None else now
        self.cooldowns = dict(cooldowns or {})
        self.offline = offline
        self.fetcher = fetcher
        replay_record = read_json(replay) if replay else None
        self.replay = replay_record["captures"] if replay_record else None
        self.recorded_failures = replay_record.get("failures", {}) if replay_record else {}
        self.recorded_failure_details = (
            replay_record.get("failure_details", {}) if replay_record else {}
        )
        self.captures = {}
        self.failures = {}
        self.failure_details = {}
        self.wiki_requests = set()
        self.memo = {}
        self.last_requests = {}

    def verify_record(self, record: dict[str, Any]) -> bytes:
        digest, size = record["sha256"], record["bytes"]
        if not re.fullmatch(r"[a-f0-9]{64}", digest) or not 0 < size <= MAX_CAPTURE_BYTES:
            raise IntegrityError("Invalid cached source identity or size")
        path = self.root / "blobs" / digest
        try:
            with path.open("rb") as stream:
                raw = stream.read(MAX_CAPTURE_BYTES + 1)
        except OSError as error:
            raise IntegrityError("Retained source bytes are unavailable") from error
        if len(raw) != size or hashlib.sha256(raw).hexdigest() != digest:
            raise IntegrityError("Cached source integrity mismatch")
        return raw

    def get(self, url: str) -> tuple[bytes, dict[str, Any]]:
        if not ALLOWED.fullmatch(url):
            raise ValueError("Source URL is outside the catalog provider allowlist")
        if url in self.recorded_failures:
            self.failures[url] = self.recorded_failures[url]
            self.failure_details[url] = self.recorded_failure_details.get(url, {})
            details = self.failure_details[url]
            failure = Failure(
                FailureKind(details.get("kind", "transport")),
                self.failures[url],
                status=details.get("status"),
                retry_after=details.get("retry_after"),
                verify_code=details.get("verify_code"),
                verify_message=details.get("verify_message"),
            )
            self._cooldown(url, failure)
            raise CaptureError(failure)
        if url in self.failures:
            details = self.failure_details[url]
            raise CaptureError(
                Failure(
                    FailureKind(details.get("kind", "transport")),
                    self.failures[url],
                    status=details.get("status"),
                    retry_after=details.get("retry_after"),
                )
            )
        if url in self.memo:
            return self.memo[url]
        if re.fullmatch(r"https://gamerch\.com/maimai/[1-9][0-9]{0,8}", url):
            if len(self.wiki_requests) >= 300:
                raise CaptureError(
                    Failure(FailureKind.DEFERRED, "Shared Wiki page budget reached; work deferred")
                )
            self.wiki_requests.add(url)
        pointer = self.root / "urls" / (hashlib.sha256(url.encode()).hexdigest() + ".json")
        try:
            previous = None
            # Exact replay owns its capture selection; mutable indexes are disposable.
            if not self.offline or self.replay is None:
                previous = read_json(pointer) if pointer.exists() else None
                if previous and previous.get("url") != url:
                    raise IntegrityError("Cached source URL mismatch")
            if self.offline:
                record = self.replay.get(url) if self.replay is not None else previous
                if not record or record.get("url") != url:
                    raise IntegrityError("No retained capture for offline source")
                raw = self.verify_record(record)
            else:
                headers = {}
                if previous:
                    # Never trust a 304 until the retained bytes have been verified.
                    self.verify_record(previous)
                    for field, header in (
                        ("etag", "If-None-Match"),
                        ("last_modified", "If-Modified-Since"),
                    ):
                        if previous.get(field):
                            headers[header] = previous[field]
                host = urlsplit(url).hostname
                cooldown = self.cooldowns.get(host, {})
                if cooldown.get("until", 0) > self.now:
                    raise CaptureError(
                        Failure(
                            FailureKind.SOURCE_COOLDOWN,
                            "Source is in a verified transport cooldown",
                        )
                    )
                # Public LXNS resources explicitly rate-limit callers. Production
                # reads are serial and at most one request per second per host.
                if self.fetcher is fetch_public and host in {"maimai.lxns.net", "assets2.lxns.net"}:
                    delay = self.last_requests.get(host, 0) + 1 - time.monotonic()
                    if delay > 0:
                        time.sleep(delay)
                    self.last_requests[host] = time.monotonic()
                # Only errors raised by transport are recoverable source failures.
                # Cache/persistence failures and programming defects abort the batch.
                try:
                    status, raw, response_headers = self.fetcher(url, headers)
                except OSError as error:
                    raise CaptureError(classify_failure(error)) from error
                if status == 304:
                    if not previous:
                        raise CaptureError(
                            Failure(
                                FailureKind.SCHEMA, "Source returned 304 without a retained capture"
                            )
                        )
                    record, raw = previous, self.verify_record(previous)
                elif status == 200 and 0 < len(raw) <= MAX_CAPTURE_BYTES:
                    digest = hashlib.sha256(raw).hexdigest()
                    response_headers = {k.lower(): v for k, v in response_headers.items()}
                    record = {
                        "url": url,
                        "sha256": digest,
                        "bytes": len(raw),
                        "captured_at": datetime.now(UTC).isoformat(),
                        "etag": response_headers.get("etag"),
                        "last_modified": response_headers.get("last-modified"),
                    }
                    if previous and previous["sha256"] == digest:
                        record["captured_at"] = previous["captured_at"]
                    blob = self.root / "blobs" / digest
                    blob.parent.mkdir(parents=True, exist_ok=True)
                    if not blob.exists():
                        with blob.open("xb") as stream:
                            stream.write(raw)
                    else:
                        self.verify_record(record)
                    atomic_json(pointer, record)
                else:
                    raise CaptureError(
                        Failure(
                            FailureKind.SCHEMA,
                            f"Public source returned invalid status/size: {status}",
                        )
                    )
            self.captures[url] = record
            self.memo[url] = raw, record
            return raw, record
        except CaptureError as error:
            failure = error.failure
            self.failures[url] = failure.message
            self.failure_details[url] = failure.record()
            self._cooldown(url, failure)
            raise

    def _cooldown(self, url, failure):
        if failure.kind in {FailureKind.TLS, FailureKind.RATE_LIMIT}:
            from .coverage_queue import retry_policy

            _, deadline = retry_policy([failure], 1, self.now)
            self.cooldowns[urlsplit(url).hostname] = {
                "until": deadline,
                "failure": failure.record(),
            }

    def receipt(self) -> dict[str, Any]:
        return {
            "version": "catalog-source-captures-1",
            "captures": self.captures,
            "failures": self.failures,
            "failure_details": self.failure_details,
        }


def classify_failure(error):
    """Unwrap transport exceptions without interpreting their English messages."""
    if isinstance(error, CaptureError):
        return error.failure
    cause = getattr(error, "reason", error)
    if isinstance(cause, ssl.SSLCertVerificationError):
        return Failure(
            FailureKind.TLS,
            str(error),
            verify_code=cause.verify_code,
            verify_message=cause.verify_message,
        )
    status = getattr(error, "code", None)
    kind = (
        FailureKind.RATE_LIMIT
        if status == 429
        else FailureKind.ABSENT
        if status in {404, 410}
        else FailureKind.TRANSPORT
    )
    return Failure(
        kind,
        f"{type(error).__name__}: {error}",
        status=status,
        retry_after=getattr(error, "headers", {}).get("Retry-After")
        if getattr(error, "headers", None)
        else None,
    )
