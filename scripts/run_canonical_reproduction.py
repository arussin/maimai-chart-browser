"""Acquire pinned public tools, then run the shared build proof in networkless Linux.

This is an ordinary Linux CI command, not an installer for the developer host.
Docker must already be available. Both source and toolkit mounts are read-only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import subprocess
import tarfile
import urllib.request
from pathlib import Path


def container_command(docker, source, toolkit, output, node, cache, image, *, web):
    command = [
        docker,
        "run",
        "--rm",
        "--network=none",
        "--platform=linux/amd64",
        "-v",
        str(source) + ":/input:ro",
        "-v",
        str(toolkit) + ":/toolkit:ro",
        "-v",
        str(output) + ":/work",
        "-v",
        str(node) + ":/node:ro",
        "-v",
        str(cache) + ":/npm-cache",
        "-e",
        "PATH=/node/bin:/usr/local/bin:/usr/bin:/bin",
        "-e",
        "PYTHONDONTWRITEBYTECODE=1",
        "-e",
        "MAIMAI_REPRO_NETWORK=container-none",
        image,
        "python",
        "/toolkit/scripts/verify_reproducible_build.py",
        "--source",
        "/input",
        "--output",
        "/work/proof",
    ]
    if web:
        command += ["--npm-cache", "/npm-cache"]
    return command


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--toolkit", type=Path, required=True, help="Pinned registry checkout")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if platform.system() != "Linux" or platform.machine() not in ("x86_64", "AMD64"):
        raise SystemExit(
            "Canonical Linux execution unavailable on this host; use the ordinary Linux CI job"
        )
    docker = shutil.which("docker")
    if not docker:
        raise SystemExit("Existing Docker is required; this command does not install it")
    source = args.source.resolve(strict=True)
    toolkit = args.toolkit.resolve(strict=True)
    output = args.output.resolve()
    if output.is_relative_to(source) or output.is_relative_to(toolkit):
        raise SystemExit("Output must be external to both source checkouts")
    config = json.loads((toolkit / "config/reproducibility.json").read_text())
    output.mkdir(parents=True, exist_ok=False)
    acquisition = output / "acquisition"
    acquisition.mkdir()
    cache = output / "npm-cache"
    cache.mkdir()
    node_pin = config["node_linux"]
    archive = acquisition / "node.tar.xz"
    # Public acquisition is complete before the networkless build starts.
    with urllib.request.urlopen(node_pin["url"], timeout=60) as response:  # noqa: S310 -- reviewed HTTPS release URL
        raw = response.read(100 * 1024 * 1024)
    if hashlib.sha256(raw).hexdigest() != node_pin["sha256"]:
        raise SystemExit("Pinned Node archive integrity mismatch")
    archive.write_bytes(raw)
    with tarfile.open(archive, "r:xz") as package:
        package.extractall(acquisition, filter="data")
    node = acquisition / f"node-v{node_pin['version']}-linux-x64"
    env = {**os.environ, "PATH": str(node / "bin") + os.pathsep + os.environ.get("PATH", "")}
    commands = []

    def run(command, cwd=None):
        commands.append(command)
        result = subprocess.run(  # noqa: S603 -- pinned tools and explicit argv
            command, cwd=cwd, env=env, text=True, capture_output=True, check=False
        )
        (acquisition / f"command-{len(commands)}.log").write_text(result.stdout + result.stderr)
        if result.returncode:
            raise SystemExit("Acquisition/build failed; inspect retained command log")

    web = (source / "web/package-lock.json").is_file()
    if web:
        target = acquisition / "web"
        target.mkdir()
        for name in ("package.json", "package-lock.json"):
            shutil.copyfile(source / "web" / name, target / name)
        run(
            [
                str(node / "bin/node"),
                str(node / "lib/node_modules/npm/bin/npm-cli.js"),
                "ci",
                "--ignore-scripts",
                "--no-audit",
                "--no-fund",
                "--cache",
                str(cache),
            ],
            cwd=target,
        )
    image = config["canonical_linux"]["image"]
    run([docker, "pull", "--platform=linux/amd64", image])
    receipt = {
        "schema_version": "maimai-build-acquisition-1",
        "image": image,
        "node": node_pin,
        "node_archive_sha256": hashlib.sha256(raw).hexdigest(),
        "toolkit_runtime_manifest_sha256": hashlib.sha256(
            (toolkit / "config/reproducibility.json").read_bytes()
        ).hexdigest(),
        "web_lock_sha256": hashlib.sha256(
            (source / "web/package-lock.json").read_bytes()
        ).hexdigest()
        if web
        else None,
        "commands": commands,
        "next_phase_network": "none",
    }
    (output / "acquisition.json").write_text(json.dumps(receipt, indent=2) + "\n")
    run(container_command(docker, source, toolkit, output, node, cache, image, web=web))
    print("Canonical networkless build proof: " + str(output / "proof/receipt.json"))


if __name__ == "__main__":
    main()
