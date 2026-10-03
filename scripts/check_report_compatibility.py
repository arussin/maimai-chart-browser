"""Exercise the real pinned consumer and producer together without network access.

Ordinary CI checks out both public repositories at full SHAs before this command.
No dispatch token, installed cross-repository dependency or floating ref is used.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from maimai_intelligence.contract_bundle import canonical, export_bundle, git_bytes


def fingerprint(root, paths):
    return {
        str(path.relative_to(root)).replace("\\", "/"): hashlib.sha256(
            path.read_bytes()
        ).hexdigest()
        for path in sorted(paths)
        if path.is_file()
    }


def check(registry, report, *, candidate, output, allow_working_tree=False):
    registry, report = registry.resolve(strict=True), report.resolve(strict=True)
    if registry == report:
        raise ValueError("Registry and report must remain independent repositories")
    revisions = {
        "registry": git_bytes(registry, "rev-parse", "HEAD").decode().strip(),
        "report": git_bytes(report, "rev-parse", "HEAD").decode().strip(),
    }
    candidate_root = registry if candidate == "registry" else report
    counterpart = "report" if candidate == "registry" else "registry"
    pin = json.loads((candidate_root / "config/compatibility.json").read_text())
    expected_repo = {
        "registry": "arussin/maimai-chart-browser",
        "report": "arussin/maimai-session-report",
    }
    if (
        pin.get("schema_version") != "maimai-reciprocal-compatibility-1"
        or pin[counterpart]["repository"] != expected_repo[counterpart]
        or not re.fullmatch(r"[a-f0-9]{40}", pin[counterpart]["revision"])
        or revisions[counterpart] != pin[counterpart]["revision"]
    ):
        raise ValueError("Counterpart checkout does not match the reviewed full-SHA pin")
    dirty = {}
    for name, source in (("registry", registry), ("report", report)):
        dirty[name] = bool(
            git_bytes(source, "diff", "HEAD", "--name-only").strip()
            or git_bytes(source, "ls-files", "--others", "--exclude-standard").strip()
        )
    if any(dirty.values()) and not allow_working_tree:
        raise ValueError("Compatibility acceptance requires committed source in both repositories")
    tooling = report / "scripts/_contract_tool"
    tool_pin = json.loads((tooling / "PROVENANCE.json").read_text())
    if (
        tool_pin.get("upstream") != "https://github.com/arussin/maimai-chart-browser"
        or tool_pin.get("source_path") != "src/maimai_intelligence/contract_bundle.py"
        or not re.fullmatch(r"[a-f0-9]{40}", tool_pin.get("upstream_revision", ""))
    ):
        raise ValueError("Invalid developer tooling provenance")
    exact_tool = git_bytes(
        registry, "show", tool_pin["upstream_revision"] + ":" + tool_pin["source_path"]
    )
    if (
        hashlib.sha256(exact_tool).hexdigest() != tool_pin["sha256"]
        or (tooling / "contract_bundle.py").read_bytes().replace(b"\r\n", b"\n") != exact_tool
    ):
        raise ValueError("Report developer validator differs from its exact registry tool pin")
    bundle = export_bundle(registry, revisions["registry"])
    raw = canonical(bundle)
    output.mkdir(parents=True, exist_ok=False)
    archive = output / "candidate-contract.json"
    archive.write_bytes(raw)
    runtime_pin = json.loads((report / "src/maimai_report/_party/PROVENANCE.json").read_text())
    runtime = canonical(export_bundle(registry, runtime_pin["upstream_revision"]))
    (output / "runtime-contract.json").write_bytes(runtime)
    # Every execution below is the actual consumer checkout, with all sockets denied.
    guard = (
        "import runpy,socket,sys; "
        "deny=lambda *a,**k: (_ for _ in ()).throw(PermissionError('Offline compatibility gate')); "
        "socket.create_connection=socket.getaddrinfo=deny; "
        "socket.socket.connect=socket.socket.connect_ex=deny; "
        "sys.argv=sys.argv[1:]; runpy.run_path(sys.argv[0],run_name='__main__')"
    )
    commands = [
        [
            sys.executable,
            "-B",
            "-c",
            guard,
            str(report / "scripts/sync_party_library.py"),
            "--bundle",
            str(output / "runtime-contract.json"),
            "--revision",
            runtime_pin["upstream_revision"],
            "--bundle-sha256",
            hashlib.sha256(runtime).hexdigest(),
            "--check",
        ],
        [
            sys.executable,
            "-B",
            "-c",
            guard,
            str(report / "scripts/check_party_contract.py"),
            "--bundle",
            str(archive),
            "--revision",
            revisions["registry"],
            "--bundle-sha256",
            hashlib.sha256(raw).hexdigest(),
        ],
    ]
    env = {
        **os.environ,
        "PYTHONPATH": str(report / "src") + os.pathsep + str(report),
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    checks = []
    for index, command in enumerate(commands):
        result = subprocess.run(  # noqa: S603 -- reviewed pinned consumer, explicit interpreter/argv
            command, cwd=report, env=env, capture_output=True, text=True, check=False
        )
        (output / f"check-{index}.log").write_text(result.stdout + result.stderr, encoding="utf-8")
        checks.append(
            {
                "command": command[4:],
                "exit_code": result.returncode,
                "status": "passed" if result.returncode == 0 else "failed",
            }
        )
    fixtures = fingerprint(
        report,
        list((report / "src/maimai_report/fixtures").rglob("*.py"))
        + [report / "scripts/check_party_contract.py"],
    )
    receipt = {
        "schema_version": "maimai-reciprocal-compatibility-receipt-1",
        "candidate": candidate,
        "revisions": revisions,
        "counterpart_pin": pin,
        "dirty_or_untracked": dirty,
        "mode": "working-tree-probe" if any(dirty.values()) else "committed-acceptance",
        "tooling": tool_pin,
        "bundle_sha256": hashlib.sha256(raw).hexdigest(),
        "runtime_bundle_sha256": hashlib.sha256(runtime).hexdigest(),
        "fixtures": fixtures,
        "fixture_set_sha256": hashlib.sha256(canonical(fixtures)).hexdigest(),
        "python": sys.version,
        "network": "all Python sockets denied during consumer checks",
        "checks": checks,
        "passed": all(check["exit_code"] == 0 for check in checks),
    }
    (output / "receipt.json").write_bytes(canonical(receipt))
    if not receipt["passed"]:
        raise ValueError("Cross-repository compatibility failed; inspect the retained check logs")
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--candidate", choices=("registry", "report"), required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--allow-working-tree", action="store_true", help="Local probe only; never CI acceptance"
    )
    args = parser.parse_args()
    result = check(
        args.registry,
        args.report,
        candidate=args.candidate,
        output=args.output,
        allow_working_tree=args.allow_working_tree,
    )
    print(
        json.dumps(
            {"passed": result["passed"], "mode": result["mode"], "revisions": result["revisions"]}
        )
    )


if __name__ == "__main__":
    main()
