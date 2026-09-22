"""Reproduce nondeployable full-corpus review bundles from exact committed source.

Each build runs in a fresh offline interpreter. Inputs and every source byte are
bound before and after both builds. An old source revision may be supplied with
--source; the receipt identifies the current verifier separately from that source.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import io
import json
import os
import shutil
import socket
import subprocess
import sys
import tarfile
import time
from collections.abc import Mapping
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IMMUTABLE = (
    "catalog-parts",
    "catalog-index",
    "catalog-index-parts",
    "chart-details",
    "integration",
    "media",
)
BUILD_ENV = {
    "PYTHONDONTWRITEBYTECODE": "1",
    "PYTHONHASHSEED": "0",
    "SOURCE_DATE_EPOCH": "1577836800",
}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def record(raw):
    return {"bytes": len(raw), "sha256": sha(raw)}


def plain(value):
    if isinstance(value, Mapping):
        return {key: plain(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [plain(item) for item in value]
    return value


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def inventory(root):
    result = {}
    for folder, directories, names in os.walk(root, followlinks=False):
        for name in directories + names:
            if (Path(folder) / name).is_symlink():
                raise ValueError(
                    "Review inputs must not contain links: " + str(Path(folder) / name)
                )
        for name in sorted(names):
            path = Path(folder) / name
            result[path.relative_to(root).as_posix()] = record(path.read_bytes())
    return dict(sorted(result.items()))


def git_bytes(source, *arguments):
    git = shutil.which("git")
    if not git:
        raise ValueError("Git is required to verify committed source")
    return subprocess.run(  # noqa: S603 -- fixed read-only Git commands
        [git, "--no-optional-locks", "-C", str(source), *arguments],
        check=True,
        capture_output=True,
    ).stdout


def committed_source(source):
    revision = git_bytes(source, "rev-parse", "HEAD").decode().strip()
    # Include ignored untracked files: an ignored Python module can still shadow an import.
    if git_bytes(source, "ls-files", "--others", "-z").strip():
        raise ValueError("Acceptance source contains untracked files (including ignored files)")
    if git_bytes(source, "diff", "HEAD", "--name-only").strip():
        raise ValueError("Acceptance source contains tracked changes")
    raw = git_bytes(source, "archive", "--format=tar", revision)
    files = {}
    with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
        for member in archive.getmembers():
            if member.isdir():
                continue
            if not member.isfile():
                raise ValueError("Acceptance source Git archive contains a link or special file")
            path = source / member.name
            if path.is_symlink() or not path.resolve().is_relative_to(source.resolve()):
                raise ValueError("Acceptance source contains an escaped or linked file")
            expected = archive.extractfile(member).read()
            if not path.is_file() or path.read_bytes() != expected:
                raise ValueError("Source bytes differ from Git archive: " + member.name)
            files[member.name] = record(expected)
    return {
        "root": str(source),
        "commit": revision,
        "archive_sha256": sha(raw),
        "files": files,
        "inventory_sha256": sha(canonical(files)),
    }


def runtime_identity():
    return {
        "executable": sys.executable,
        "executable_sha256": sha(Path(sys.executable).read_bytes()),
        "version": sys.version,
        "platform": sys.platform,
        "hash_randomization": sys.flags.hash_randomization,
        "packages": dict(
            sorted((d.metadata["Name"], d.version) for d in importlib.metadata.distributions())
        ),
        "environment": BUILD_ENV,
    }


def build_child(source, package, retained, previous, output, version, *, player_maishift=False):
    attempts = []

    def deny(*args, **kwargs):
        attempts.append("network attempt")
        raise PermissionError("Offline review preparation denies network")

    socket.create_connection = socket.getaddrinfo = deny
    socket.socket.connect = socket.socket.connect_ex = deny
    sys.path[:0] = [str(source / "src"), str(source)]
    # Imports occur only after the child network guard; the parent verifies all source first.
    from maimai_intelligence.lab import build_lab
    from maimai_intelligence.public_release import plan_public_release
    from scripts.update_catalog import retain_history

    start = time.monotonic()
    retain_history(retained, output / "browser")
    build_lab(package, output / "browser", catalog_version=version, player_maishift=player_maishift)
    plan = plan_public_release(output / "browser", previous_public=previous)
    plan.write_review_to(output / "review")
    preserved = {}
    for directory in IMMUTABLE:
        for path in sorted((previous / directory).rglob("*")):
            if path.is_file():
                name = path.relative_to(previous).as_posix()
                expected = path.read_bytes()
                if name not in plan.assets or plan.assets[name] != expected:
                    raise ValueError("Historical immutable URL changed or disappeared: " + name)
                preserved[name] = sha(expected)
    if attempts:
        raise ValueError("An offline operation attempted network access")
    result = {
        "directory": str(output),
        "process_id": os.getpid(),
        "build_options": {"player_maishift": player_maishift},
        "runtime": runtime_identity(),
        "elapsed_seconds": round(time.monotonic() - start, 3),
        "summary": plain(plan.summary),
        "files": inventory(output / "review"),
        "network_attempts": attempts,
        "historical_immutable_files": len(preserved),
        "historical_inventory_sha256": sha(canonical(preserved)),
    }
    (output / "result.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")


def run_build(source, package, retained, previous, output, version, *, player_maishift=False):
    output.mkdir(parents=True, exist_ok=False)
    command = [
        sys.executable,
        "-B",
        "-s",
        "-P",
        str(Path(__file__).resolve()),
        "--build-child",
        "--source",
        str(source),
        "--package",
        str(package),
        "--retained",
        str(retained),
        "--previous",
        str(previous),
        "--output",
        str(output),
        "--version",
        version,
        "--player-maishift" if player_maishift else "--no-player-maishift",
    ]
    result = subprocess.run(  # noqa: S603 -- fixed interpreter and explicit local child arguments
        command,
        cwd=source,
        env={**{k: v for k, v in os.environ.items() if not k.startswith("PYTHON")}, **BUILD_ENV},
        capture_output=True,
        text=True,
        check=False,
    )
    (output / "build.log").write_text(result.stdout + result.stderr, encoding="utf-8")
    if result.returncode:
        raise ValueError("Full review build failed; inspect " + str(output / "build.log"))
    return json.loads((output / "result.json").read_text(encoding="utf-8"))


def run(package, retained, previous, output, version, *, source=ROOT, player_maishift=False):
    roots = {"package": package, "retained": retained, "previous": previous}
    for root in [source, ROOT, *roots.values()]:
        if output.is_relative_to(root) or root.is_relative_to(output):
            raise ValueError("Review output must be external to every source and input root")
    source_binding = committed_source(source)
    verifier = source_binding if source == ROOT else committed_source(ROOT)
    inputs = {name: {"root": str(root), "files": inventory(root)} for name, root in roots.items()}
    output.mkdir(parents=True, exist_ok=False)
    results = []
    for number in (1, 2):
        if any(value["files"] != inventory(roots[name]) for name, value in inputs.items()):
            raise ValueError("Review input changed before a build")
        result = run_build(
            source,
            package,
            retained,
            previous,
            output / f"build-{number}",
            version,
            player_maishift=player_maishift,
        )
        if result["build_options"] != {"player_maishift": player_maishift}:
            raise ValueError("Child build options differ from the requested options")
        results.append(result)
        if any(value["files"] != inventory(roots[name]) for name, value in inputs.items()):
            raise ValueError("Review input changed during a build")
        if committed_source(source) != source_binding or committed_source(ROOT) != verifier:
            raise ValueError("Committed source or verifier changed during preparation")
        print(
            json.dumps(
                {
                    "build": number,
                    "files": len(result["files"]),
                    "seconds": result["elapsed_seconds"],
                }
            ),
            flush=True,
        )
    if results[0]["process_id"] == results[1]["process_id"]:
        raise ValueError("Expected distinct build processes")
    if results[0]["files"] != results[1]["files"]:
        raise ValueError("Independent full-corpus review builds differ")
    if results[0]["runtime"] != results[1]["runtime"]:
        raise ValueError("Build runtime changed during preparation")
    receipt = {
        "schema_version": "maimai-full-review-reproduction-2",
        "passed": True,
        "published": False,
        "candidate_commit": source_binding["commit"],
        "build_options": {"player_maishift": player_maishift},
        "source": source_binding,
        "verifier": verifier,
        "inputs": inputs,
        "runtime": results[0]["runtime"],
        "version": version,
        "builds": results,
    }
    (output / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("package", "retained", "previous", "output"):
        parser.add_argument("--" + name, required=True, type=Path)
    parser.add_argument("--source", type=Path, default=ROOT)
    parser.add_argument("--version", required=True)
    parser.add_argument("--player-maishift", action=argparse.BooleanOptionalAction, default=False)
    parser.add_argument("--build-child", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    args.source = args.source.resolve(strict=True)
    values = (
        args.source,
        args.package.resolve(strict=True),
        args.retained.resolve(strict=True),
        args.previous.resolve(strict=True),
        args.output.resolve(),
        args.version,
    )
    if args.build_child:
        build_child(*values, player_maishift=args.player_maishift)
    else:
        run(*values[1:], source=values[0], player_maishift=args.player_maishift)


if __name__ == "__main__":
    main()
