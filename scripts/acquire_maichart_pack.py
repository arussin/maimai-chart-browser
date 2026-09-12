"""Explicit text-only capture of a pinned Maichart-Converts Git tree.

No accounts, audio, images, archives, score APIs or analyzer calls. Cached bytes
must match their Git blob hashes; denied or throttled requests stop the capture.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path, PurePosixPath

from maimai_intelligence.io import atomic_write_text
from scripts.analyze_simai_corpus import _relative

REPOSITORY = "Neskol/Maichart-Converts"
MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_PACK_BYTES = 64 * 1024 * 1024


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def git_blob_hash(data):
    return hashlib.sha1(  # Git object identity, not a security primitive.
        b"blob " + str(len(data)).encode() + b"\0" + data, usedforsecurity=False
    ).hexdigest()


def write_json(path, value):
    atomic_write_text(path, json.dumps(value, ensure_ascii=False, indent=2) + "\n")


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        raise ValueError("Pinned public source unexpectedly redirected; capture stopped")


def fetch(url):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or parsed.netloc not in {
        "raw.githubusercontent.com",
        "api.github.com",
    }:
        raise ValueError("Only the explicit public GitHub source is allowed")
    request = urllib.request.Request(  # noqa: S310 -- HTTPS allowlist above.
        url, headers={"User-Agent": "maimai-chart-intelligence-local-evaluation/1.0"}
    )
    with urllib.request.build_opener(NoRedirects()).open(request, timeout=45) as response:
        data = response.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        raise ValueError("Public text response exceeds the capture limit")
    return data


def selected_entries(tree):
    if not isinstance(tree, dict) or tree.get("truncated") is not False:
        raise ValueError("Capture requires a complete, untruncated Git tree")
    entries, seen = [], set()
    for item in tree.get("tree", []):
        path = item.get("path", "")
        if not isinstance(path, str):
            raise ValueError("Invalid Git tree path")
        wanted = (
            path == "index.json"
            or path.endswith("/maidata.txt")
            or (path.startswith("collections/") and path.endswith("/manifest.json"))
        )
        if not wanted:
            continue
        parts = PurePosixPath(path).parts
        if (
            len(parts) not in {1, 3}
            or path.startswith("/")
            or "\\" in path
            or ":" in path
            or any(p in {".", ".."} for p in path.split("/"))
            or item.get("type") != "blob"
            or item.get("mode") != "100644"
            or re.fullmatch(r"[0-9a-f]{40}", item.get("sha", "")) is None
            or type(item.get("size")) is not int
            or not 0 < item["size"] <= MAX_FILE_BYTES
            or path in seen
        ):
            raise ValueError("Invalid, duplicate or unsafe text entry in source tree")
        seen.add(path)
        entries.append(item)
    if not entries or len(entries) > 10_000 or sum(x["size"] for x in entries) > MAX_PACK_BYTES:
        raise ValueError("Source inventory exceeds bounded text capture scope")
    if "index.json" not in seen:
        raise ValueError("Source inventory has no index.json")
    return sorted(entries, key=lambda item: item["path"])


def capture(output, revision, *, offline=False, fetcher=fetch, workers=4):
    if re.fullmatch(r"[0-9a-f]{40}", revision or "") is None:
        raise ValueError("An explicit full source commit SHA is required")
    if type(workers) is not int or not 1 <= workers <= 4:
        raise ValueError("Use one to four bounded acquisition workers")
    root = Path(output).resolve()
    root.mkdir(parents=True, exist_ok=True)
    tree_path = _relative(root, "source-tree.json")
    provenance_path = _relative(root, "capture.json")
    if provenance_path.exists():
        previous = json.loads(provenance_path.read_bytes())
        if previous.get("revision") != revision or previous.get("repository") != REPOSITORY:
            raise ValueError("Capture directory already belongs to another source revision")
    if tree_path.exists():
        if not provenance_path.exists():
            raise ValueError("Existing tree requires its pinned capture provenance")
        tree_bytes = tree_path.read_bytes()
        if sha256(tree_bytes) != previous.get("tree_sha256"):
            raise ValueError("Captured tree hash changed")
    else:
        if offline:
            raise ValueError("Offline capture requires the saved source tree")
        tree_bytes = fetcher(
            f"https://api.github.com/repos/{REPOSITORY}/git/trees/{revision}?recursive=1"
        )
        if len(tree_bytes) > MAX_FILE_BYTES:
            raise ValueError("Git tree exceeds byte budget")
        selected_entries(json.loads(tree_bytes))
        atomic_write_text(tree_path, tree_bytes.decode("utf-8"))
    entries = selected_entries(json.loads(tree_bytes))
    state = {
        "schema_version": "maichart-capture-1",
        "repository": REPOSITORY,
        "revision": revision,
        "tree_sha256": sha256(tree_bytes),
        "status": "in_progress",
        "expected_files": len(entries),
        "scope": "maidata.txt, index.json and collection manifests only",
        "files": [],
    }
    write_json(provenance_path, state)

    def acquire(entry):
        name = "raw/" + entry["path"]
        path = _relative(root, name)
        cached = path.is_file()
        if cached:
            if path.stat().st_size > MAX_FILE_BYTES:
                raise ValueError("Cached file exceeds text budget")
            data = path.read_bytes()
        else:
            if offline:
                raise ValueError("Offline capture is missing a declared source file")
            url = (
                f"https://raw.githubusercontent.com/{REPOSITORY}/{revision}/"
                + urllib.parse.quote(entry["path"], safe="/")
            )
            data = fetcher(url)
        if len(data) != entry["size"] or git_blob_hash(data) != entry["sha"]:
            raise ValueError("Source bytes do not match the pinned Git blob")
        data.decode("utf-8-sig")  # Reject non-text; preserve exact BOM/newline bytes on disk.
        if not cached:
            atomic_write_text(path, data.decode("utf-8"))
        return {
            "path": entry["path"],
            "file": name,
            "bytes": len(data),
            "git_blob_sha": entry["sha"],
            "sha256": sha256(data),
        }

    try:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            # Submit only one bounded batch at a time; denial never schedules the remainder.
            for offset in range(0, len(entries), workers):
                state["files"].extend(pool.map(acquire, entries[offset : offset + workers]))
                if len(state["files"]) % 100 == 0:
                    write_json(provenance_path, state)
                    print(
                        f"Captured and verified {len(state['files'])}/{len(entries)} text files",
                        flush=True,
                    )
    except Exception:
        state["status"] = "interrupted"
        write_json(provenance_path, state)
        raise
    state["status"] = "complete"
    state["total_bytes"] = sum(x["bytes"] for x in state["files"])
    state["container_files"] = sum(x["path"].endswith("/maidata.txt") for x in state["files"])
    write_json(provenance_path, state)
    return state


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args(argv)
    result = capture(args.output_dir, args.revision, offline=args.offline)
    print(json.dumps({key: result[key] for key in ("status", "container_files", "total_bytes")}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
