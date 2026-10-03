"""Compare two clean offline builds and a wheel rebuilt from the source archive.

The same registry-owned algorithm accepts either independent repository. Run in
an external disposable output directory; it never edits or installs into source.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import zipfile
from pathlib import Path

EXCLUDE = {
    ".git",
    "node_modules",
    "__pycache__",
    ".ruff_cache",
    ".pytest_cache",
    ".wrangler",
    "output",
    "dist",
    "generated",
    "test-results",
    "synthetic-results",
    "playwright-report",
    "tools",
    "retained-results",
    ".snapshots",
}
BUILD = """import json,socket,sys
from pathlib import Path
calls=[]
def deny(*args,**kwargs):
    calls.append('blocked')
    raise PermissionError('Offline reproducibility build denies sockets')
socket.create_connection=socket.getaddrinfo=socket.socket.connect=socket.socket.connect_ex=deny
sys.path.insert(0,str(Path('build_backend').resolve()))
import maimai_build_backend as backend
result={'wheel':backend.build_wheel('artifacts')}
if sys.argv[1]=='all':result['sdist']=backend.build_sdist('artifacts')
result['network_attempts']=len(calls)
result['hash_randomization']=sys.flags.hash_randomization
result['hash_seed_probe']=hash('maimai-reproduction-seed')
print(json.dumps(result))
"""


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def files(source):
    result = []
    for folder, names, entries in os.walk(source, followlinks=False):
        for name in names:
            if name not in EXCLUDE and (Path(folder) / name).is_symlink():
                raise ValueError("Source directory links are not build inputs")
        names[:] = sorted(
            name for name in names if name not in EXCLUDE and not name.startswith(".venv")
        )
        for name in sorted(entries):
            path = Path(folder) / name
            if (
                name == ".git"
                or name.startswith(".env")
                or name.endswith(".pyc")
                or name
                in {
                    "source-copy-manifest.json",
                    "development-layout.json",
                    "AGENTS.md",
                    "DEVELOPMENT.md",
                    "requirements-migration-tests.txt",
                    "Test-LocalDevelopment.ps1",
                    "Test-OfflineSuite.py",
                }
            ):
                continue
            if path.is_symlink():
                raise ValueError(
                    "Source links must be materialized and reviewed before reproduction"
                )
            result.append(path.relative_to(source))
    return result


def wheel_entries(path):
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError("Duplicate wheel entry")
        return {name: digest(archive.read(name)) for name in sorted(names)}


def extract_sdist(path, output):
    with tarfile.open(path, "r:gz") as archive:
        for member in archive.getmembers():
            target = (output / member.name).resolve()
            if (
                not target.is_relative_to(output.resolve())
                or member.issym()
                or member.islnk()
                or not (member.isfile() or member.isdir())
            ):
                raise ValueError("Unsafe source archive entry")
        archive.extractall(output, filter="data")
    roots = list(output.iterdir())
    if len(roots) != 1 or not roots[0].is_dir():
        raise ValueError("Expected one source archive root")
    return roots[0]


def run_build(source, mode):
    env = {
        **{k: v for k, v in os.environ.items() if not k.startswith("PYTHON")},
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONHASHSEED": "0",
        "SOURCE_DATE_EPOCH": "1577836800",
    }
    result = subprocess.run(  # noqa: S603 -- explicit interpreter/tool argv in disposable source
        [sys.executable, "-B", "-s", "-P", "-c", BUILD, mode],
        cwd=source,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    (source / "build.log").write_text(result.stdout + result.stderr, encoding="utf-8")
    if result.returncode:
        raise ValueError("Build failed; inspect " + str(source / "build.log"))
    output = json.loads(result.stdout.splitlines()[-1])
    if output["network_attempts"]:
        raise ValueError("Build attempted network access")
    return output


def verify(source, output, *, npm_cache=None):
    source = source.resolve(strict=True)
    output = output.resolve()
    if output.is_relative_to(source) or source.is_relative_to(output):
        raise ValueError("Build output must be external to the source checkout")
    selected = files(source)
    source_hashes = {p.as_posix(): digest((source / p).read_bytes()) for p in selected}
    lock_hashes = {
        p: h
        for p, h in source_hashes.items()
        if p.endswith(".lock") or p.endswith("package-lock.json")
    }
    if not lock_hashes:
        raise ValueError("Committed dependency locks are required")
    output.mkdir(parents=True, exist_ok=False)
    builds = []
    for label in ("first", "second"):
        workspace = output / label
        workspace.mkdir()
        for relative in selected:
            target = workspace / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes((source / relative).read_bytes())
        generated = {"status": "not-applicable"}
        if (workspace / "web/package-lock.json").is_file():
            if npm_cache is None:
                generated = {
                    "status": "unavailable",
                    "reason": "Supply --npm-cache for offline generated-JS verification",
                }
            else:
                npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
                node = shutil.which("node")
                if not npm or not node:
                    raise ValueError(
                        "Pinned Node and npm are required for generated-JS verification"
                    )
                commands = [
                    [
                        npm,
                        "ci",
                        "--offline",
                        "--ignore-scripts",
                        "--no-audit",
                        "--no-fund",
                        "--cache",
                        str(npm_cache),
                    ],
                    [node, "build.mjs", "--check"],
                ]
                for index, command in enumerate(commands):
                    result = subprocess.run(  # noqa: S603 -- explicit interpreter/tool argv in disposable source
                        command, cwd=workspace / "web", capture_output=True, text=True, check=False
                    )
                    (workspace / f"web-{index}.log").write_text(
                        result.stdout + result.stderr, encoding="utf-8"
                    )
                    if result.returncode:
                        raise ValueError(
                            "Offline browser build failed; inspect "
                            + str(workspace / f"web-{index}.log")
                        )
                generated = {
                    "status": "passed",
                    "commands": commands,
                    "manifest_sha256": digest(
                        (workspace / "web/generated-assets.json").read_bytes()
                    ),
                }
        built = run_build(workspace, "all")
        wheel = workspace / "artifacts" / built["wheel"]
        sdist = workspace / "artifacts" / built["sdist"]
        builds.append(
            {
                "workspace": str(workspace),
                "wheel_sha256": digest(wheel.read_bytes()),
                "sdist_sha256": digest(sdist.read_bytes()),
                "wheel_entries": wheel_entries(wheel),
                "generated_assets": generated,
                "network_attempts": built["network_attempts"],
                "hash_randomization": built["hash_randomization"],
                "hash_seed_probe": built["hash_seed_probe"],
            }
        )
    extracted = extract_sdist(output / "first/artifacts" / built["sdist"], output / "from-sdist")
    rebuilt = run_build(extracted, "wheel")
    rebuilt_entries = wheel_entries(extracted / "artifacts" / rebuilt["wheel"])
    checks = {
        "fixed_hash_seed_verified": all(b["hash_randomization"] == 0 for b in builds)
        and rebuilt["hash_randomization"] == 0
        and builds[0]["hash_seed_probe"]
        == builds[1]["hash_seed_probe"]
        == rebuilt["hash_seed_probe"],
        "wheel_bytes_identical": builds[0]["wheel_sha256"] == builds[1]["wheel_sha256"],
        "sdist_bytes_identical": builds[0]["sdist_sha256"] == builds[1]["sdist_sha256"],
        "wheel_entries_identical": builds[0]["wheel_entries"] == builds[1]["wheel_entries"],
        "sdist_to_wheel_entries_identical": builds[0]["wheel_entries"] == rebuilt_entries,
        "source_unchanged": source_hashes
        == {p.as_posix(): digest((source / p).read_bytes()) for p in selected},
    }
    generated_complete = all(b["generated_assets"]["status"] != "unavailable" for b in builds)
    receipt = {
        "schema_version": "maimai-reproducible-build-1",
        "source": str(source),
        "source_files": source_hashes,
        "source_sha256": digest(canonical(source_hashes)),
        "locks": lock_hashes,
        "runtime": {
            "python": sys.version,
            "executable": sys.executable,
            "platform": platform.platform(),
            "implementation": platform.python_implementation(),
        },
        "network_container": os.environ.get("MAIMAI_REPRO_NETWORK", "unavailable"),
        "network_mode": ("Python build sockets denied; npm offline; lifecycle scripts disabled"),
        "builds": builds,
        "sdist_wheel_entries": rebuilt_entries,
        "checks": checks,
        "archive_checks_passed": all(checks.values()),
        "passed": all(checks.values()) and generated_complete,
        "status": "passed"
        if all(checks.values()) and generated_complete
        else "incomplete"
        if all(checks.values())
        else "failed",
        "generated_verification_complete": generated_complete,
        "cross_os_status": "unavailable until receipts from each required OS are compared",
    }
    (output / "receipt.json").write_bytes(canonical(receipt))
    if not receipt["passed"]:
        raise ValueError("Reproducibility mismatch; inspect " + str(output / "receipt.json"))
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--npm-cache", type=Path)
    args = parser.parse_args()
    result = verify(args.source, args.output, npm_cache=args.npm_cache)
    print(
        json.dumps(
            {
                "passed": result["passed"],
                "generated_verification_complete": result["generated_verification_complete"],
                "receipt": str(args.output / "receipt.json"),
            }
        )
    )


if __name__ == "__main__":
    main()
