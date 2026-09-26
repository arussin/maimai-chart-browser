"""Bounded retained transcription input readers shared by all preparation callers."""

import hashlib
import json
import re
from pathlib import Path, PurePosixPath

SOURCE_KIND = "public_transcription_evaluation"
MAX_ROWS = 100_000
MAX_SOURCE_BYTES = 8 * 1024 * 1024
MAX_MANIFEST_BYTES = 256 * 1024 * 1024


class SourceFailure(ValueError):
    def __init__(self, category, reason):
        super().__init__(reason)
        self.category = category


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _text(value, default="unknown", limit=512):
    return value if isinstance(value, str) and value.strip() and len(value) <= limit else default


def _relative(root: Path, name: str) -> Path:
    if not isinstance(name, str) or not name or len(name) > 512 or "\\" in name:
        raise SourceFailure("invalid_source_path", "Source requires a confined relative path")
    relative = PurePosixPath(name)
    if relative.is_absolute() or any(part in {"..", "."} for part in relative.parts) or ":" in name:
        raise SourceFailure("invalid_source_path", "Source path must stay inside the manifest root")
    try:
        # Normalize both sides, including Windows short-name aliases, before containment.
        root = root.resolve()
        path = (root / name).resolve()
    except (OSError, RuntimeError) as error:
        raise SourceFailure("invalid_source_path", "Source path cannot be resolved") from error
    if not path.is_relative_to(root) or path == root:
        raise SourceFailure("invalid_source_path", "Source alias escapes the manifest root")
    return path


def _read(path, limit):
    with path.open("rb") as stream:
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise ValueError("Local artifact exceeds its declared byte limit")
    return data


def _load(manifest_path, output):
    manifest_path = Path(manifest_path).resolve()
    root = manifest_path.parent
    if output == root or root.is_relative_to(output):
        raise ValueError("Corpus output must be separate from its source root and ancestors")
    data = _read(manifest_path, MAX_SOURCE_BYTES)
    manifest = json.loads(data)
    if not isinstance(manifest, dict) or manifest.get("source_kind") != SOURCE_KIND:
        raise ValueError("Corpus manifest must explicitly declare public transcription evaluation")
    if manifest.get("schema_version", "simai-corpus-manifest-1") != "simai-corpus-manifest-1":
        raise ValueError("Unsupported corpus manifest schema")
    source_paths = {manifest_path}
    if "charts_file" in manifest:
        path = _relative(root, manifest["charts_file"])
        source_paths.add(path)
        digest, size = hashlib.sha256(), 0
        with path.open("rb") as stream:
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
                size += len(chunk)
                if size > MAX_MANIFEST_BYTES:
                    raise ValueError("Corpus row manifest exceeds its byte budget")
        if digest.hexdigest() != manifest.get("charts_sha256"):
            raise ValueError("Corpus chart manifest hash mismatch")
        rows = []
        with path.open("rb") as stream:
            for line in stream:
                if len(line) > 65536 or len(rows) >= MAX_ROWS:
                    raise ValueError("Corpus manifest row/count limit exceeded")
                if line.strip():
                    rows.append(json.loads(line))
    else:
        rows = manifest.get("charts")
    if not isinstance(rows, list) or not rows or len(rows) > MAX_ROWS:
        raise ValueError("Corpus manifest requires 1–100000 explicit advertised rows")
    ids = set()
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            raise ValueError("Corpus rows must be JSON objects")
        input_id = _text(row.get("input_id"), default=f"invalid-row-{index}", limit=200)
        if input_id in ids:
            raise ValueError("Duplicate corpus input_id")
        ids.add(input_id)
        row["input_id"] = input_id
        for key in ("body_file", "source_raw_file", "source_index_file"):
            if row.get(key):
                try:
                    source_paths.add(_relative(root, row[key]))
                except SourceFailure:
                    # A bad source locator becomes an individual verification failure.
                    pass
    if any(path == output or path.is_relative_to(output) for path in source_paths):
        raise ValueError("Corpus output must not contain any manifest/source input")
    return root, manifest, sorted(rows, key=lambda row: row["input_id"]), _sha(data)


def _verify(root, name, expected, memo, work, *, body=False):
    if not isinstance(expected, str) or re.fullmatch(r"[0-9a-f]{64}", expected) is None:
        raise SourceFailure("missing_source_hash", "Available source needs its exact SHA-256")
    path = _relative(root, name)
    try:
        stat = path.stat()
        stamp = (stat.st_size, stat.st_mtime_ns)
        if not body and memo.get(path) == (stamp, expected):
            return None
        data = _read(path, MAX_SOURCE_BYTES)
    except FileNotFoundError as error:
        raise SourceFailure("source_missing", "Declared local source file is missing") from error
    except (OSError, ValueError) as error:
        raise SourceFailure(
            "source_unreadable_or_oversize", "Source unreadable or exceeds 8 MiB"
        ) from error
    work["source_bytes_read"] += len(data)
    if _sha(data) != expected:
        raise SourceFailure(
            "source_hash_mismatch", "Local source bytes differ from the declared SHA-256"
        )
    memo[path] = (stamp, expected)
    work["source_files_verified"] += 1
    return data if body else None
