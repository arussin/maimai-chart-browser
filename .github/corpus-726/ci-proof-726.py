"""Finite provenance and receipt retention for the existing opt-in job, pinned to producte51."""

import argparse
import hashlib
import importlib.util
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = "e51abd0d9a087819accc6344e4e392ccda0a4231"
SOURCE_FILES_SHA = "0b7562cd3cf111d6e7f71737751712c32538afbd7dee0eced750f4c3fa6046cc"
WHEEL_SHA = "81c5c68a74ad2e7805c57b30c3888424d1e502f648389ea503feaf3c50ba264d"
WHEEL_NAME = "maimai_chart_intelligence-0.2.0-py3-none-any.whl"
PAYLOAD = {
    "run.py",
    "consume-726.py",
    "inputs-726.template.json",
    "inventory-726.json.gz",
    "ci-proof-726.py",
}
MAX_RAW = 64 * 1024**2
MAX_ZIP = 16 * 1024**2


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def ordinary(path):
    path = Path(path).absolute()
    for item in (path, *path.parents):
        if item.exists() or item.is_symlink():
            mode = item.lstat().st_mode
            if stat.S_ISLNK(mode) or not (stat.S_ISDIR(mode) or stat.S_ISREG(mode)):
                raise ValueError("Nonregular evidence path")
    return path


def write_new(path, raw):
    with ordinary(path).open("xb") as stream:
        stream.write(raw)


def load_consumer():
    spec = importlib.util.spec_from_file_location("consumer", HERE / "consume-726.py")
    consumer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(consumer)
    return consumer


def provenance(source, toolkit, output):
    source, toolkit, output = ordinary(source), ordinary(toolkit), ordinary(output)
    revision = os.environ.get("GITHUB_SHA", "")
    if (
        not re.fullmatch("[a-f0-9]{40}", revision)
        or os.environ.get("GITHUB_EVENT_NAME") != "workflow_dispatch"
    ):
        raise ValueError("Explicit GitHub dispatch required")
    git = shutil.which("git")
    if git is None:
        raise ValueError("Existing Git tool required")
    for root, expected in ((source, SOURCE), (toolkit, revision)):
        actual = subprocess.check_output(  # noqa: S603 -- pinned tool and explicit argv
            [git, "-C", str(root), "rev-parse", "HEAD"], text=True
        ).strip()
        dirty = subprocess.check_output(  # noqa: S603 -- pinned tool and explicit argv
            [git, "-C", str(root), "status", "--porcelain", "--untracked-files=no"], text=True
        )
        if actual != expected or dirty:
            raise ValueError("Checkout revision or tracked source changed")
    if HERE != toolkit / ".github/corpus-726":
        raise ValueError("Harness must come from the distinct reviewed toolkit checkout")
    manifest = json.loads((HERE / "payload.json").read_bytes())
    if manifest["schema"] != "maimai-corpus-ci-payload-726-1" or set(manifest["files"]) != PAYLOAD:
        raise ValueError("Unexpected CI payload")
    for name, expected in manifest["files"].items():
        raw = ordinary(HERE / name).read_bytes()
        if {"bytes": len(raw), "sha256": digest(raw)} != expected:
            raise ValueError("Reviewed CI payload changed")
    consumer = load_consumer()
    mode = os.environ.get("CORPUS_MODE")
    if mode not in {"capacity", "full"}:
        raise ValueError("Explicit capacity or full mode required")
    if mode == "full":
        consumer.public_url(os.environ.get("CORPUS_PACKET_URL", ""), "packet")
    consumer.recipe()
    record = {
        "schema": "maimai-corpus-ci-provenance-726-1",
        "product_commit": SOURCE,
        "mode": mode,
        "toolkit_commit": revision,
        "workflow_ref": os.environ.get("GITHUB_WORKFLOW_REF"),
        "workflow_sha": os.environ.get("GITHUB_WORKFLOW_SHA"),
        "run_id": os.environ.get("GITHUB_RUN_ID"),
        "run_attempt": os.environ.get("GITHUB_RUN_ATTEMPT"),
        "payload": manifest,
        "packet_sha256": consumer.PACKET["sha256"],
        "packet_publication_performed": False,
        "capacity_accepted": False,
    }
    write_new(output / "corpus-ci-provenance.json", encoded(record))


def package_identity(proof, wheel_sha):
    if (
        proof["passed"] is not True
        or proof["source_sha256"] != SOURCE_FILES_SHA
        or len(proof["source_files"]) != 788
        or len(proof["builds"]) != 2
        or any(row["wheel_sha256"] != WHEEL_SHA for row in proof["builds"])
        or wheel_sha != WHEEL_SHA
    ):
        raise ValueError("Frozene51 canonical package identity differs")


def package_proof(output):
    output = ordinary(output)
    proof = json.loads((output / "reproduction/proof/receipt.json").read_bytes())
    wheel = output / "reproduction/proof/first/artifacts" / WHEEL_NAME
    package_identity(proof, digest(ordinary(wheel).read_bytes()))


def reservation(consumer, trees):
    # Same complete acquisition plus pair bound used by acquire(), before input downloads.
    return (
        sum(row["bytes"] for files in trees.values() for row in files.values())
        + 904
        + consumer.recipe()[1]["inputs"]["builder-wheels"]["bytes"]
        + consumer.PACKET["bytes"]
        + consumer.ACQUISITION_RESERVE
        + consumer.PAIR_BYTES
    )


def capacity_record(consumer, survey, additional):
    accepted = (
        survey["ordinary_bytes"] + additional < consumer.ORDINARY_GUARD
        and survey["free_bytes"] - additional >= consumer.FREE_RESERVE
    )
    return {
        "schema": "maimai-corpus-ci-capacity-726-1",
        "product_commit": SOURCE,
        **consumer.storage_diagnostic(survey, additional),
        "status": "capacity_accepted_corpus_unexecuted" if accepted else "capacity_refused",
        "capacity_accepted": accepted,
        "corpus_passed": False,
        "packet_downloaded": False,
        "pair_executed": False,
        "survey": survey,
    }


def capacity(output):
    if sys.platform != "linux" or os.environ.get("GITHUB_ACTIONS") != "true":
        raise ValueError("Actual GitHub Linux runner required for capacity evidence")
    output = ordinary(output)
    package_proof(output)
    consumer = load_consumer()
    trees, _ = consumer.recipe()
    wheel = output / "reproduction/proof/first/artifacts" / WHEEL_NAME
    survey = consumer.storage(
        [os.environ["RUNNER_WORKSPACE"], os.environ["RUNNER_TEMP"]],
        [output, wheel],
        output,
    )
    additional = reservation(consumer, trees)
    record = capacity_record(consumer, survey, additional)
    write_new(output / "corpus-capacity-726.json", encoded(record))
    print(json.dumps({key: value for key, value in record.items() if key != "survey"}))
    consumer.guard_space(survey, additional)


def selected_files(root):
    """Finite metadata only; never upload input ZIPs, corpus bodies or caches."""
    names = [
        "corpus-ci-provenance.json",
        "corpus-capacity-726.json",
        "reproduction/acquisition.json",
        "reproduction/proof/receipt.json",
        "corpus-input-726/acquisition-result.json",
        "corpus-input-726/execution-manifest.json",
        "corpus-input-726/paths.json",
        "corpus-input-726/pre-pair-storage.json",
        "corpus-pair-726/plan.json",
        "corpus-pair-726/result.json",
        "corpus-pair-726/a-inventory.json",
        "corpus-pair-726/b-inventory.json",
        "corpus-pair-726/a-container.cleanup.json",
        "corpus-pair-726/b-container.cleanup.json",
    ]
    for attempt in ("a", "b"):
        prefix = "corpus-pair-726/" + attempt
        names.append(prefix + "/worker-result.json")
        names.append(prefix + "/worker-failure.json")
        runs = ordinary(root / prefix / "store/runs")
        if runs.exists():
            children = list(runs.iterdir())
            if len(children) != 1 or not re.fullmatch(
                r"[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}", children[0].name
            ):
                raise ValueError("Unexpected retained attempt namespace")
            for name in ("attempt.json", "state.json", "diagnostics.jsonl", "coverage-inputs.json"):
                names.append(prefix + "/store/runs/" + children[0].name + "/" + name)
    return names


def retain(output):
    root = ordinary(output)
    target = root / "corpus-proof-726.zip"
    if target.exists():
        raise ValueError("Prior proof archive exists")
    names = selected_files(root)
    members, missing, total = {}, [], 0
    for name in names:
        file = ordinary(root / name)
        if not file.exists():
            missing.append(name)
            continue
        if not file.is_file() or file.stat().st_size > 32 * 1024**2:
            raise ValueError("Oversized or non-file receipt")
        raw = file.read_bytes()
        total += len(raw)
        if total > MAX_RAW:
            raise ValueError("Proof metadata exceeds64MiB bound")
        members[name] = raw
    result_raw = members.get("corpus-pair-726/result.json")
    result = json.loads(result_raw) if result_raw else {}
    summary = {
        "schema": "maimai-corpus-ci-retention-726-1",
        "product_commit": SOURCE,
        "scope": (
            "finite provenance, canonical inventories, outcomes and structured diagnostics only"
        ),
        "pair_passed": result.get("passed") is True,
        "pair_status": result.get("status", "not_started_or_incomplete"),
        "missing": missing,
        "raw_metadata_bytes": total,
        "members": {
            name: {"bytes": len(raw), "sha256": digest(raw)} for name, raw in members.items()
        },
        "limits": {"raw_bytes": MAX_RAW, "zip_bytes": MAX_ZIP},
        "not_retained": [
            "input corpus bodies",
            "public packet ZIP",
            "full rendered artifacts",
            "dependency caches",
            "raw acquisition logs",
        ],
        "production_or_account_changes": False,
    }
    members["retention.json"] = encoded(summary)
    with zipfile.ZipFile(target, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, raw in sorted(members.items()):
            info = zipfile.ZipInfo(name, (2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, raw)
            if archive.fp.tell() > MAX_ZIP:
                raise ValueError("Proof ZIP exceeds16MiB bound; preserve partial output")
    if target.stat().st_size > MAX_ZIP:
        raise ValueError("Final proof ZIP exceeds16MiB bound")
    write_new(
        root / "corpus-proof-726-retention.json",
        encoded(
            {
                **summary,
                "archive": {"bytes": target.stat().st_size, "sha256": digest(target.read_bytes())},
            }
        ),
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("provenance", "package", "capacity", "retain"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--source", type=Path)
    parser.add_argument("--toolkit", type=Path)
    args = parser.parse_args()
    if args.phase == "provenance":
        provenance(args.source, args.toolkit, args.output)
    elif args.phase == "package":
        package_proof(args.output)
    elif args.phase == "capacity":
        capacity(args.output)
    else:
        retain(args.output)
