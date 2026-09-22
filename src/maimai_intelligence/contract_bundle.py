"""Deterministic downstream contracts read from exact Git objects, never dirty files."""

from __future__ import annotations

import base64
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path

SCHEMA = "maimai-public-contract-bundle-1"
UPSTREAM = "https://github.com/arussin/maimai-chart-browser"
FILES = {
    "player_data.py": "src/maimai_intelligence/player_data.py",
    "public_matching.py": "src/maimai_intelligence/public_matching.py",
    "site-brand.html": "src/maimai_intelligence/assets/site-brand.html",
    "site-brand.css": "src/maimai_intelligence/assets/site-brand.css",
    "LICENSE": "LICENSE",
}
MAX_FILE_BYTES = 1024 * 1024


def canonical(value: object) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
    ).encode()


def git_bytes(source: Path, *arguments: str) -> bytes:
    git = shutil.which("git")
    if git is None:
        raise ValueError("Git is required to verify the contract source revision")
    result = subprocess.run(  # noqa: S603 -- resolved Git executable, explicit argument list
        [git, "--no-optional-locks", "-C", str(source), *arguments],
        capture_output=True,
        check=False,
    )
    if result.returncode:
        raise ValueError("Cannot read the requested contract from the source Git database")
    return result.stdout


def export_bundle(source: Path, revision: str) -> dict:
    """Export only the public allowlist at one full, resolved commit SHA."""
    if not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise ValueError("A full lowercase Git commit SHA is required")
    source = source.resolve(strict=True)
    resolved = git_bytes(source, "rev-parse", "--verify", revision + "^{commit}").decode().strip()
    if resolved != revision:
        raise ValueError("Contract revision must resolve to the requested commit")
    entries = {}
    for name, path in FILES.items():
        raw = git_bytes(source, "show", revision + ":" + path)
        if not 0 < len(raw) <= MAX_FILE_BYTES:
            raise ValueError("Public contract file is empty or exceeds its limit")
        raw.decode("utf-8")  # Preserve exact committed bytes, but require portable text.
        entries[name] = {
            "source_path": path,
            "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
            "content_base64": base64.b64encode(raw).decode("ascii"),
        }
    return {
        "schema_version": SCHEMA,
        "upstream": UPSTREAM,
        "upstream_revision": revision,
        "api_version": 1,
        "contracts": {"player_data": "maimai-player-data-1", "matching": "public-matching-1"},
        "files": entries,
    }
