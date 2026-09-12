"""Capture the two public Simai transcription indexes and their linked chart pages.

This explicit acquisition command is separate from the hermetic analyzer. It uses
one request at a time, caches exact responses, honors robots, and stops on denial
or throttling. It never requests accounts, edit/history routes, music or images.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from datetime import UTC, datetime
from pathlib import Path

MAX_RESPONSE_BYTES = 8 * 1024 * 1024
MAX_CAPTURE_BYTES = 1024 * 1024 * 1024
USER_AGENT = "maimai-chart-intelligence-local-study/1.0"
ORIGIN = "https://w.atwiki.jp"


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def now() -> str:
    return datetime.now(UTC).isoformat()


def write_json(path: Path, value) -> None:
    temporary = path.with_suffix(path.suffix + ".pending")
    parent = path.parent.resolve()
    if path.resolve().parent != parent or temporary.resolve().parent != parent:
        raise ValueError("Metadata or temporary path escapes its directory")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def confined(root: Path, relative: str) -> Path:
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()) or path == root.resolve():
        raise ValueError("Capture artifact escapes its output directory")
    return path


def write_capture_bytes(root: Path, relative: str, data: bytes) -> None:
    path = confined(root, relative)
    temporary = path.with_suffix(path.suffix + ".pending")
    if temporary.resolve().parent != path.parent:
        raise ValueError("Temporary artifact escapes its output directory")
    temporary.write_bytes(data)
    temporary.replace(path)


class CaptureStopped(RuntimeError):
    """The origin denied access or requested throttling; do not work around it."""


def allowed_url(url: str, *, robots: bool = False) -> bool:
    if not isinstance(url, str):
        return False
    parsed = urllib.parse.urlsplit(url)
    return (
        parsed.scheme == "https"
        and parsed.netloc == "w.atwiki.jp"
        and not parsed.query
        and not parsed.fragment
        and bool(
            (robots and parsed.path == "/robots.txt")
            or re.fullmatch(r"/simai/pages/[1-9][0-9]{0,5}\.html", parsed.path)
        )
    )


class PageRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        parsed = urllib.parse.urlsplit(newurl)
        if parsed.scheme != "https" or parsed.netloc != "w.atwiki.jp":
            raise CaptureStopped("Redirect left the explicit public source origin")
        # Requests never follow login, search, edit, backup or arbitrary host paths.
        if not allowed_url(newurl):
            raise CaptureStopped("Redirect left the explicit public chart-page routes")
        return super().redirect_request(request, fp, code, msg, headers, newurl)


class Fetcher:
    def __init__(self, root: Path, delay: float = 1.0, *, offline: bool = False):
        self.root = root.resolve()
        if not math.isfinite(delay) or not 0 <= delay <= 60:
            raise ValueError("Request interval must be finite and at most 60 seconds")
        self.delay = max(1.0, delay)
        self.offline = offline
        self.last_request = 0.0
        self.total_bytes = 0
        self.requests = 0
        self.cache_hits = 0
        self.robot = None
        self.opener = urllib.request.build_opener(PageRedirects())

    def fetch(self, url: str, relative: str) -> tuple[bytes, dict]:
        parsed = urllib.parse.urlsplit(url)
        if (
            parsed.scheme != "https"
            or parsed.netloc != "w.atwiki.jp"
            or parsed.query
            or parsed.fragment
            or (
                parsed.path != "/robots.txt"
                and not re.fullmatch(r"/simai/pages/[1-9][0-9]{0,5}\.html", parsed.path)
            )
        ):
            raise ValueError("Only explicit public source-page URLs are accepted")
        if self.robot is not None and not self.robot.can_fetch(USER_AGENT, url):
            raise CaptureStopped("Robots excludes this source route")
        path = (self.root / relative).resolve()
        if not path.is_relative_to(self.root) or path == self.root:
            raise ValueError("Capture output escapes its directory")
        sidecar = path.with_suffix(path.suffix + ".capture.json")
        if not sidecar.resolve().is_relative_to(self.root):
            raise ValueError("Capture metadata escapes its directory")
        path.parent.mkdir(parents=True, exist_ok=True)
        if sidecar.is_file():
            if sidecar.stat().st_size > 16 * 1024:
                raise ValueError("Capture sidecar exceeds metadata budget")
            metadata = json.loads(sidecar.read_text(encoding="utf-8"))
            if path.stat().st_size > MAX_RESPONSE_BYTES:
                raise ValueError("Cached source exceeds response budget")
            data = path.read_bytes()
            if (
                not isinstance(metadata, dict)
                or metadata.get("url") != url
                or metadata.get("file") != relative
                or not allowed_url(metadata.get("final_url"), robots=url.endswith("/robots.txt"))
                or metadata.get("bytes") != len(data)
                or metadata.get("http_status") != 200
                or metadata.get("encoding") not in {"utf-8", "UTF-8", "utf8"}
                or not isinstance(metadata.get("retrieved_at_utc"), str)
                or metadata.get("sha256") != digest(data)
            ):
                raise ValueError("Cached response does not match its recorded source hash")
            self.cache_hits += 1
        else:
            if self.offline:
                raise ValueError("Offline acquisition requires a verified cached response")
            time.sleep(max(0, self.delay - (time.monotonic() - self.last_request)))
            self.last_request = time.monotonic()
            self.requests += 1
            # Scheme, origin and numeric chart-page route were allowlisted above.
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})  # noqa: S310
            try:
                with self.opener.open(request, timeout=30) as response:
                    data = response.read(MAX_RESPONSE_BYTES + 1)
                    status = response.status
                    encoding = response.headers.get_content_charset() or "utf-8"
                    final_url = response.url
            except urllib.error.HTTPError as error:
                if error.code in {401, 403, 429}:
                    raise CaptureStopped(
                        f"HTTP {error.code}; "
                        f"Retry-After={error.headers.get('Retry-After', 'unknown')}"
                    ) from error
                raise
            if len(data) > MAX_RESPONSE_BYTES:
                raise ValueError("Response exceeds capture byte budget")
            if self.total_bytes + len(data) > MAX_CAPTURE_BYTES:
                raise CaptureStopped("Capture exceeded its one-GiB byte budget")
            metadata = {
                "url": url,
                "final_url": final_url,
                "file": relative,
                "retrieved_at_utc": now(),
                "http_status": status,
                "encoding": encoding,
                "bytes": len(data),
                "sha256": digest(data),
            }
            temporary = path.with_suffix(path.suffix + ".pending")
            if temporary.resolve().parent != path.parent:
                raise ValueError("Temporary response path escapes its directory")
            temporary.write_bytes(data)
            temporary.replace(path)
            write_json(sidecar, metadata)
        self.total_bytes += len(data)
        if self.total_bytes > MAX_CAPTURE_BYTES:
            raise CaptureStopped("Capture exceeded its one-GiB byte budget")
        return data, metadata


def acquire(output: Path, *, delay: float = 1.0, offline: bool = False) -> dict:
    # Import only the authored extraction helper, never source-provided code.
    from scripts.simai_collection import discover_indexes, extract_chart

    output = output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    write_json(output / "capture-state.json", {"status": "in_progress", "started_at_utc": now()})
    fetcher = Fetcher(output, delay, offline=offline)
    robots, robots_meta = fetcher.fetch(ORIGIN + "/robots.txt", "indexes/robots.txt")
    robot = urllib.robotparser.RobotFileParser()
    robot.parse(robots.decode("utf-8").splitlines())
    fetcher.robot = robot
    required_delay = robot.crawl_delay(USER_AGENT) or 0
    if required_delay > 60:
        raise CaptureStopped("Robots requires an interval beyond this collector's 60-second limit")
    fetcher.delay = max(fetcher.delay, required_delay)
    indexes, sources = {}, [robots_meta]
    for page in (32, 808):
        data, metadata = fetcher.fetch(ORIGIN + f"/simai/pages/{page}.html", f"indexes/{page}.html")
        indexes[page] = data.decode(metadata["encoding"])
        sources.append(metadata)
    inventory = discover_indexes(indexes)
    page_ids = inventory["page_ids"]
    if len(page_ids) > 4096:
        raise ValueError("Index exceeded the explicit 4096-page capture limit")
    write_json(output / "inventory.json", inventory)
    print(
        json.dumps(
            {"stage": "inventory", "pages": len(page_ids), "rows": len(inventory["inventory_rows"])}
        ),
        flush=True,
    )
    page_states, stopped = {}, None
    journal = confined(output, "capture-progress.jsonl")
    for index, page in enumerate(page_ids):
        relative = f"pages/{page}.html"
        if stopped:
            state = {"status": "not_requested", "reason": stopped}
        elif offline and not (output / (relative + ".capture.json")).is_file():
            state = {"status": "not_captured", "reason": "offline cache miss"}
        else:
            try:
                _, metadata = fetcher.fetch(ORIGIN + f"/simai/pages/{page}.html", relative)
                state = {"status": "captured", **metadata}
            except CaptureStopped as error:
                stopped = str(error)
                state = {"status": "stopped", "reason": stopped}
            except (OSError, ValueError) as error:
                state = {"status": "fetch_failed", "reason": str(error)[:400]}
        page_states[page] = state
        with journal.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps({"page": page, **state}, ensure_ascii=False) + "\n")
        if (index + 1) % 25 == 0 or index + 1 == len(page_ids):
            write_json(
                output / "capture-state.json",
                {
                    "status": "capturing" if not stopped else "stopped",
                    "processed_pages": index + 1,
                    "total_pages": len(page_ids),
                    "reason": stopped,
                    "updated_at_utc": now(),
                },
            )
            print(
                json.dumps(
                    {
                        "stage": "capture",
                        "processed": index + 1,
                        "total": len(page_ids),
                        "requests": fetcher.requests,
                        "cached": fetcher.cache_hits,
                        "bytes": fetcher.total_bytes,
                        "stopped": stopped,
                    }
                ),
                flush=True,
            )
    write_json(output / "capture-pages.json", page_states)
    write_json(output / "capture-state.json", {"status": "extracting", "updated_at_utc": now()})
    confined(output, "bodies").mkdir(exist_ok=True)
    rows, loaded_page = [], None
    # Sorting by page permits releasing each HTML tree/body after its associations.
    for row in sorted(
        inventory["inventory_rows"],
        key=lambda item: (item.get("source_page_id") or -1, item["input_id"]),
    ):
        row = dict(row)
        page = row.get("source_page_id")
        state = page_states.get(
            page, {"status": "unlinked", "reason": "No canonical chart-page link"}
        )
        row["acquisition_status"] = "unavailable"
        row["reason"] = state.get("reason", state["status"])
        if state["status"] == "captured":
            if loaded_page != page:
                page_html = (output / state["file"]).read_text(encoding=state["encoding"])
                loaded_page = page
            try:
                extracted = extract_chart(page_html, row)
            except ValueError as error:
                extracted = {
                    "body": None,
                    "identity_resolved": False,
                    "reason": "extraction_rejected: " + str(error)[:300],
                }
            row.update({key: value for key, value in extracted.items() if key != "body"})
            row.update(
                source_raw_file=state["file"],
                source_raw_sha256=state["sha256"],
                source_url=state["url"],
                source_song_id=f"simai:page:{page}",
                retrieved_at_utc=state["retrieved_at_utc"],
            )
            if extracted.get("body") is not None:
                if not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", row["input_id"]):
                    raise ValueError("Extracted input ID is not a safe body filename")
                data = extracted["body"].encode("utf-8")
                relative = f"bodies/{row['input_id']}.simai"
                write_capture_bytes(output, relative, data)
                row.update(
                    acquisition_status="available",
                    body_file=relative,
                    body_sha256=digest(data),
                    body_bytes=len(data),
                )
        rows.append(row)
    lines = "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows)
    write_capture_bytes(output, "charts.jsonl", lines.encode("utf-8"))
    manifest = {
        "schema_version": "simai-corpus-manifest-1",
        "source_kind": "public_transcription_evaluation",
        "snapshot_id": "simai-index-" + digest((indexes[32] + indexes[808]).encode())[:16],
        "charts_file": "charts.jsonl",
        "charts_sha256": digest(lines.encode()),
        "created_at_utc": now(),
        "sources": sources,
        "discovery_scope": (
            "All chart rows linked from the frozen Standard and DX transcription indexes"
        ),
        "inventory_rows": len(rows),
        "distinct_linked_pages": len(page_ids),
        "captured_pages": sum(value["status"] == "captured" for value in page_states.values()),
        "extracted_bodies": sum(row["acquisition_status"] == "available" for row in rows),
        "capture_stopped_reason": stopped,
        "acquisition_policy": {
            "user_agent": USER_AGENT,
            "single_inflight": True,
            "minimum_interval_s": fetcher.delay,
        },
        "limitations": [
            "Community transcriptions; game fidelity and reuse permission unverified.",
            "No account data, audio, images or video acquired.",
            "No source token repairs, skipped unsupported notation or trained pattern claims.",
        ],
    }
    write_json(output / "capture-pages.json", page_states)
    write_json(output / "manifest.json", manifest)
    write_json(
        output / "capture-state.json",
        {
            "status": "complete" if manifest["captured_pages"] == len(page_ids) else "partial",
            "manifest_sha256": digest((output / "manifest.json").read_bytes()),
            "updated_at_utc": now(),
            "reason": stopped,
        },
    )
    print(
        json.dumps(
            {
                "stage": "complete",
                **{
                    key: manifest[key]
                    for key in (
                        "inventory_rows",
                        "distinct_linked_pages",
                        "captured_pages",
                        "extracted_bodies",
                        "capture_stopped_reason",
                    )
                },
            }
        ),
        flush=True,
    )
    return manifest


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--delay", type=float, default=1.0)
    parser.add_argument("--offline", action="store_true", help="Reuse captured chart pages only")
    args = parser.parse_args(argv)
    try:
        result = acquire(args.output_dir, delay=args.delay, offline=args.offline)
    except (KeyboardInterrupt, CaptureStopped, ValueError, OSError) as error:
        output = args.output_dir.resolve()
        if output.is_dir():
            write_json(
                output / "capture-state.json",
                {
                    "status": "interrupted" if isinstance(error, KeyboardInterrupt) else "failed",
                    "reason": str(error)[:500],
                    "updated_at_utc": now(),
                },
            )
        print(json.dumps({"stage": "stopped", "reason": str(error)[:500]}), flush=True)
        return 1
    return 1 if result["capture_stopped_reason"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
