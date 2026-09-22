"""Bounded public-source captures shared by repeatable catalog updates."""

import hashlib
import ipaddress
import re
import socket
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

from .mai_notes import NoRedirect
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
    r"|cdn\.gamerch\.com/[A-Za-z0-9_./-]+\.(?:png|jpg|jpeg|webp))"
)
MAX_CAPTURE_BYTES = 16 * 1024 * 1024


def fetch_public(url, headers):
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

    def __init__(self, root, *, offline=False, fetcher=fetch_public, replay=None):
        self.root = Path(root)
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

    def _read(self, record):
        digest, size = record["sha256"], record["bytes"]
        if not re.fullmatch(r"[a-f0-9]{64}", digest) or not 0 < size <= MAX_CAPTURE_BYTES:
            raise ValueError("Invalid cached source identity or size")
        path = self.root / "blobs" / digest
        with path.open("rb") as stream:
            raw = stream.read(MAX_CAPTURE_BYTES + 1)
        if len(raw) != size or hashlib.sha256(raw).hexdigest() != digest:
            raise ValueError("Cached source integrity mismatch")
        return raw

    def get(self, url):
        if not ALLOWED.fullmatch(url):
            raise ValueError("Source URL is outside the catalog provider allowlist")
        if url in self.recorded_failures:
            self.failures[url] = self.recorded_failures[url]
            self.failure_details[url] = self.recorded_failure_details.get(url, {})
            raise ValueError(self.failures[url])
        if url in self.failures:
            raise ValueError(self.failures[url])
        if url in self.memo:
            return self.memo[url]
        if re.fullmatch(r"https://gamerch\.com/maimai/[1-9][0-9]{0,8}", url):
            if len(self.wiki_requests) >= 300:
                raise ValueError("Shared Wiki page budget reached; work deferred")
            self.wiki_requests.add(url)
        pointer = self.root / "urls" / (hashlib.sha256(url.encode()).hexdigest() + ".json")
        try:
            previous = read_json(pointer) if pointer.exists() else None
            if previous and previous.get("url") != url:
                raise ValueError("Cached source URL mismatch")
            if self.offline:
                record = self.replay.get(url) if self.replay is not None else previous
                if not record or record.get("url") != url:
                    raise ValueError("No retained capture for offline source")
                raw = self._read(record)
            else:
                headers = {}
                if previous:
                    # Never trust a 304 until the retained bytes have been verified.
                    self._read(previous)
                    for field, header in (
                        ("etag", "If-None-Match"),
                        ("last_modified", "If-Modified-Since"),
                    ):
                        if previous.get(field):
                            headers[header] = previous[field]
                status, raw, response_headers = self.fetcher(url, headers)
                if status == 304:
                    if not previous:
                        raise ValueError("Source returned 304 without a retained capture")
                    record, raw = previous, self._read(previous)
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
                        self._read(record)
                    atomic_json(pointer, record)
                else:
                    raise ValueError(f"Public source returned invalid status/size: {status}")
            self.captures[url] = record
            self.memo[url] = raw, record
            return raw, record
        except (OSError, ValueError, KeyError, TypeError) as error:
            self.failures[url] = f"{type(error).__name__}: {error}"
            self.failure_details[url] = {
                "status": getattr(error, "code", None),
                "retry_after": getattr(error, "headers", {}).get("Retry-After")
                if getattr(error, "headers", None)
                else None,
            }
            raise ValueError(self.failures[url]) from error

    def receipt(self):
        return {
            "version": "catalog-source-captures-1",
            "captures": self.captures,
            "failures": self.failures,
            "failure_details": self.failure_details,
        }
