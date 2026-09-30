"""One exact offline Linux pair. Default verifies inputs and prints a plan only."""

import argparse
import hashlib
import importlib.abc
import json
import os
import platform
import shutil
import stat
import subprocess
import sys
import time
import traceback
import uuid
import zipfile
from collections.abc import Mapping
from pathlib import Path, PurePosixPath

HERE = Path(__file__).resolve().parent
MANIFEST_SHA = "cfc44a0c88cb8e1e31e41a98ad61dd2405b4da4eb27de48c0fe0c2a022525ed0"
RUN_RE = r"[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}"
OPERATIONAL = {"run/diagnostics.jsonl", "run/coverage-inputs.json"}
WHEEL_NAME = "maimai_chart_intelligence-0.2.0-py3-none-any.whl"


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def plain(value):
    if isinstance(value, Mapping):
        return {key: plain(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [plain(item) for item in value]
    return value


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def read(path):
    return json.loads(Path(path).read_bytes())


def write(path, value):
    with Path(path).open("xb") as stream:
        stream.write(encoded(value) + b"\n")


def regular_path(path):
    path = Path(path).absolute()
    for item in [path, *path.parents]:
        if item.exists() or item.is_symlink():
            mode = item.lstat().st_mode
            if stat.S_ISLNK(mode) or not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
                raise ValueError("Nonregular or redirected path: " + str(item))
    return path.resolve()


def inventory(root):
    root = regular_path(root)
    result = {}
    for path in sorted(root.rglob("*")):
        mode = path.lstat().st_mode
        if stat.S_ISDIR(mode):
            continue
        if not stat.S_ISREG(mode):
            raise ValueError("Nonregular artifact: " + str(path))
        result[path.relative_to(root).as_posix()] = fingerprint(path)
    return result


def fingerprint(path):
    size, sha = 0, hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            size += len(chunk)
            sha.update(chunk)
    return {"bytes": size, "sha256": sha.hexdigest()}


def verify_inputs(spec, paths):
    if set(paths) != set(spec["inputs"]):
        raise ValueError("Supply exactly the pinned named inputs")
    results = {}
    for name, expected in spec["inputs"].items():
        path = regular_path(paths[name])
        if expected["kind"] == "tree":
            if not path.is_dir():
                raise ValueError("Input is not a directory: " + name)
            files = inventory(path)
            actual = {
                "files": len(files),
                "bytes": sum(row["bytes"] for row in files.values()),
                "inventory_sha256": digest(encoded(files)),
            }
        else:
            if not path.is_file():
                raise ValueError("Input is not a file: " + name)
            actual = fingerprint(path)
        if actual != {key: value for key, value in expected.items() if key != "kind"}:
            raise ValueError("Complete input identity differs: " + name)
        results[name] = actual
    return results


def separate_output(output, paths):
    output = regular_path(output)
    if output.exists() or not output.parent.is_dir():
        raise ValueError("Output must be absent beneath an existing approved directory")
    for value in paths.values():
        path = regular_path(value)
        if output == path or output.is_relative_to(path) or path.is_relative_to(output):
            raise ValueError("Output overlaps an input")
    return output


def allocation(spec, free, existing_ordinary):
    limits = spec["allocation"]
    required = 2 * limits["per_attempt_max_bytes"] + limits["pair_receipt_reserve_bytes"]
    if type(existing_ordinary) is not int or existing_ordinary < spec["total_input_bytes"]:
        raise ValueError("Existing ordinary usage must include the retained input set")
    if existing_ordinary + required >= limits["ordinary_guard_bytes"]:
        raise ValueError("Pair reservation exceeds the 20 GiB ordinary-work guard")
    if free - required < limits["free_reserve_bytes"]:
        raise ValueError("Pair reservation would consume the 30 GiB free reserve")
    return {
        "required_output_bytes": required,
        "existing_ordinary_bytes": existing_ordinary,
        "free_before": free,
        "free_reserve_bytes": limits["free_reserve_bytes"],
        "scope": (
            "Owner-supplied ordinary usage; fresh filesystem free-space check. "
            "No automatic cleanup."
        ),
    }


def manifest(path=None, expected_sha=None):
    if (path is None) != (expected_sha is None):
        raise ValueError("An explicit execution manifest requires its SHA256")
    raw = regular_path(path or HERE / "inputs.json").read_bytes()
    if digest(raw) != (expected_sha or MANIFEST_SHA):
        raise ValueError("Input manifest changed; review and reseal before execution")
    spec = json.loads(raw)
    if path is not None and (
        spec["schema"] != "maimai-linux-retained-corpus-inputs-2"
        or spec["source_commit"] != "2364f72de9d01a0636cbc22aec4f2c04d02607bb"
        or spec["acceptance_mode"] != "derived-count-with-exact-corpus-and-closure"
        or spec["inputs"]["wheel"]["sha256"]
        != "951f98d10f2a7f3b28ce5b4aae7f19ec5a699705cc1fcce4faa08c0bcde61552"
        or type(spec["inputs"]["wheel"]["bytes"]) is not int
        or spec["total_input_bytes"] != sum(row["bytes"] for row in spec["inputs"].values())
    ):
        raise ValueError("Unsealed or unsupported current-source execution manifest")
    if path is not None:
        template_raw = (HERE / "inputs-726.template.json").read_bytes()
        if (
            digest(template_raw)
            != "7bb09128e00aaa22bbe65443515d97e39273379dcfadecdbbe503d4b8c42e0a5"
        ):
            raise ValueError("Current execution template changed")
        expected = json.loads(template_raw)
        expected["inputs"]["wheel"]["bytes"] = spec["inputs"]["wheel"]["bytes"]
        expected["total_input_bytes"] = sum(row["bytes"] for row in expected["inputs"].values())
        if spec != expected or not 0 < spec["inputs"]["wheel"]["bytes"] < 8 * 1024**2:
            raise ValueError("Current manifest changed a pinned control or input")
    return spec


def verify_wheel(wheel, installed=None):
    with zipfile.ZipFile(wheel) as archive:
        files = {row.filename: archive.read(row) for row in archive.infolist() if not row.is_dir()}
    if len(files) != 278 or any(
        PurePosixPath(name).is_absolute() or ".." in PurePosixPath(name).parts or "\\" in name
        for name in files
    ):
        raise ValueError("Unexpected wheel members")
    metadata = files["maimai_chart_intelligence-0.2.0.dist-info/METADATA"].decode()
    if any(line.startswith("Requires-Dist:") for line in metadata.splitlines()):
        raise ValueError("This no-dependency offline recipe cannot satisfy a changed wheel")
    runtime = {
        name: {"bytes": len(raw), "sha256": digest(raw)}
        for name, raw in files.items()
        if name.startswith(("maimai_intelligence/", "maimai_analyzer/"))
    }
    if len(runtime) != 270:
        raise ValueError("Unexpected runtime payload count")
    if installed is not None:
        actual = {}
        for package in ("maimai_intelligence", "maimai_analyzer"):
            actual.update(
                {package + "/" + name: row for name, row in inventory(installed / package).items()}
            )
        if actual != runtime:
            raise ValueError("Installed runtime is not the exact wheel payload")
    return {
        "runtime_files": len(runtime),
        "runtime_inventory_sha256": digest(encoded(runtime)),
        "requires_dist": [],
    }


def install_command(installed, paths, spec):
    """Only verified local wheels; never resolve or acquire dependencies here."""
    return [
        sys.executable,
        "-I",
        "-B",
        "-m",
        "pip",
        "install",
        "--no-index",
        "--no-deps",
        "--no-compile",
        "--no-cache-dir",
        "--disable-pip-version-check",
        "--target",
        str(installed),
        str(paths["wheel"]),
        *(str(paths["builder-wheels"] / name) for name in sorted(spec["builder_wheels"])),
    ]


def verify_builder_install(paths, spec, installed):
    """Check installed dependency contents against the hash-verified local wheels."""
    for name in sorted(spec["builder_wheels"]):
        with zipfile.ZipFile(paths["builder-wheels"] / name) as archive:
            names = archive.namelist()
            if len(names) != len(set(names)):
                raise ValueError("Duplicate builder wheel member")
            for member in archive.infolist():
                relative = PurePosixPath(member.filename)
                if relative.is_absolute() or ".." in relative.parts or "\\" in member.filename:
                    raise ValueError("Unexpected builder wheel member")
                if member.is_dir() or member.filename.endswith(".dist-info/RECORD"):
                    continue
                raw = archive.read(member)
                if fingerprint(installed / member.filename) != {
                    "bytes": len(raw),
                    "sha256": digest(raw),
                }:
                    raise ValueError("Installed builder dependency differs from its pinned wheel")


def failure_receipt(error):
    """Bounded code locations and error kinds; no messages, locals or raw requests."""
    chain, seen = [], set()
    while error is not None and id(error) not in seen and len(chain) < 4:
        seen.add(id(error))
        frames = []
        trace = error.__traceback__
        while trace is not None:
            path = Path(trace.tb_frame.f_code.co_filename).resolve()
            for root, label in ((Path("/output/installed"), "installed"), (HERE, "harness")):
                if path.is_relative_to(root):
                    frames.append(
                        {
                            "file": label + "/" + path.relative_to(root).as_posix(),
                            "line": trace.tb_lineno,
                        }
                    )
                    break
            trace = trace.tb_next
        kind = type(error).__name__ if type(error).__module__ == "builtins" else "application_error"
        row = {"type": kind, "frames": frames[-12:]}
        if isinstance(error, ModuleNotFoundError):
            row["missing_module"] = (
                error.name if error.name in {"opencc", "pypinyin"} else "unlisted"
            )
        chain.append(row)
        error = error.__cause__ or (None if error.__suppress_context__ else error.__context__)
    return {"schema": "maimai-offline-worker-failure-1", "status": "failed", "chain": chain}


def require_linux(spec):
    if (
        sys.platform != "linux"
        or platform.machine() not in {"x86_64", "AMD64"}
        or platform.python_version() != spec["python"]
    ):
        raise ValueError("The full worker requires the pinned Linux amd64 Python runtime")
    if sys.flags.hash_randomization != 0 or os.environ.get("PYTHONHASHSEED") != "0":
        raise ValueError("Canonical hash seed was not applied")


def guard_product(root):
    forbidden = []

    def writable(value):
        if isinstance(value, int):
            return
        path = Path(os.fsdecode(value)).resolve()
        if path != root and not path.is_relative_to(root):
            raise PermissionError("Product write escaped its fresh attempt output")

    def audit(event, args):
        if event.startswith("socket.") or event in {
            "subprocess.Popen",
            "os.system",
            "os.exec",
            "os.posix_spawn",
            "os.fork",
        }:
            forbidden.append(event)
            raise PermissionError("Offline product execution forbids network and child processes")
        if event == "open":
            _, mode, flags = args
            if (mode and any(char in mode for char in "wax+")) or (flags or 0) & (
                os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC
            ):
                writable(args[0])
        elif event in {"os.mkdir", "os.remove", "os.rmdir", "os.chmod", "os.utime"}:
            writable(args[0])
        elif event == "os.rename":
            writable(args[0])
            writable(args[1])
        elif event in {"os.symlink", "os.link"}:
            raise PermissionError("Links are not allowed in this recipe")

    class InstalledOnly(importlib.abc.MetaPathFinder):
        def find_spec(self, fullname, *unused):
            if fullname.split(".")[0] in {"scripts", "tests", "PIL", "numpy", "maimai_report"}:
                raise ImportError(
                    "Unexpected dependency outside this retained offline recipe: " + fullname
                )

    sys.addaudithook(audit)
    sys.meta_path.insert(0, InstalledOnly())
    return forbidden


def check_capacity(summary, spec):
    expected = spec["expected_public_files"]
    derived = (
        spec.get("schema") == "maimai-linux-retained-corpus-inputs-2"
        and spec.get("acceptance_mode") == "derived-count-with-exact-corpus-and-closure"
        and spec.get("source_commit") == "2364f72de9d01a0636cbc22aec4f2c04d02607bb"
        and expected is None
    )
    if (
        summary["deployable"]
        or summary["capacity"] != spec["capacity"]
        or not summary["capacity_error"]
        or (not derived and summary["files"] != expected)
        or (derived and (type(summary["files"]) is not int or summary["files"] <= 20000))
    ):
        raise ValueError(
            "Expected the complete default-capacity refusal, not a publishable release"
        )


def verify_current_corpus(run, paths, plan, spec):
    """Exact retained-corpus invariants; no analysis recalculation or acquisition."""
    from maimai_intelligence.corpus_analysis import inspect_prepared_analysis
    from maimai_intelligence.registry import read_registry
    from maimai_intelligence.registry_catalog import validate_catalog
    from maimai_intelligence.research_package import read_package
    from maimai_intelligence.serialization import digest as canonical_digest

    authority = spec["current_authority"]
    accepted, actual = read_registry(paths["registry"]), read_registry(run / "registry")
    if actual != accepted or canonical_digest(actual) != authority["canonical_registry_sha256"]:
        raise ValueError("Accepted canonical registry changed")

    def package(root):
        descriptor, retained = read_package(root)
        data = {**json.loads(retained["browser-metadata.json"]), "package": descriptor}
        for key in (
            "catalog",
            "navigation",
            "analysis",
            "artwork",
            "provider-mapping",
            "maishift-mapping",
            "snippets",
        ):
            data[key.replace("-", "_")] = json.loads(retained[key + ".json"])
        validate_catalog(data)
        return data

    before, after = package(paths["package"]), package(run / "package")
    aliases = read(run / "multilingual-search.json")["songs"]
    old = {row["chart_id"]: row for row in before["catalog"]}
    new = {row["chart_id"]: row for row in after["catalog"]}
    if set(old) != set(new) or set(new) != set(actual["charts"]):
        raise ValueError("Canonical chart membership changed")
    for chart_id, prior in old.items():
        row = new[chart_id]
        if set(row) != set(prior):
            raise ValueError("Catalog field membership changed")
        for key in prior:
            if prior[key] == row[key]:
                continue
            if key == "aliases":
                expected = (
                    set(prior[key]) | {item["value"] for item in aliases[row["song_id"]]["aliases"]}
                ) - {"", row["title"]}
                if not set(prior[key]) <= set(row[key]) or set(row[key]) != expected:
                    raise ValueError("Alias projection changed unexpectedly")
            elif key == "capabilities":
                if prior[key]["aliases"] != "missing" or row[key] != {
                    **prior[key],
                    "aliases": "available",
                }:
                    raise ValueError("Catalog capabilities changed unexpectedly")
            else:
                raise ValueError("Unexpected catalog field change: " + key)
    songs = {row["song_id"] for row in new.values()}
    counts = {
        "charts": len(new),
        "public_songs": len(songs),
        "accepted_songs": len(actual["songs"]),
        "artwork": len(after["artwork"]["songs"]),
    }
    if counts != authority["preparation_counts"] or songs != {
        sid for sid, row in actual["songs"].items() if not row.get("redirect")
    }:
        raise ValueError("Current corpus counts or identity dispositions changed")
    for key in (
        "navigation",
        "analysis",
        "artwork",
        "provider_mapping",
        "maishift_mapping",
        "snippets",
        "sources",
        "legacy_ids",
    ):
        if before[key] != after[key]:
            raise ValueError("Retained prepared section changed: " + key)
    if (
        after["registry"] != after["package"]["registry"]
        or after["registry"] != read(run / "registry-provenance.json")["registry"]
        or after["registry"]["sha256"] != canonical_digest(actual)
    ):
        raise ValueError("Registry/projection provenance differs")
    for name, row in after["artwork"]["assets"].items():
        if fingerprint(run / "package" / name) != {key: row[key] for key in ("bytes", "sha256")}:
            raise ValueError("Accepted artwork bytes changed")
    inspection = inspect_prepared_analysis(run, actual)
    if (
        inspection["status"] != "available"
        or len(inspection["charts"]) != 7251
        or inspection["preparation"]["capture_bytes"] != "not_checked"
    ):
        raise ValueError("Prepared analysis binding is incomplete")
    preserved = {}
    for name, row in inventory(paths["previous-public"]).items():
        if name.startswith(
            (
                "catalogs/",
                "catalog-parts/",
                "catalog-index/",
                "chart-details/",
                "media/",
                "integration/",
            )
        ):
            raw = plan.assets.get(name)
            if raw is None or {"bytes": len(raw), "sha256": digest(raw)} != row:
                raise ValueError("Published immutable history changed")
            preserved[name] = row
    return {
        "counts": counts,
        "registry_sha256": canonical_digest(actual),
        "immutable_files": len(preserved),
        "immutable_inventory_sha256": digest(encoded(preserved)),
        "analysis_records_verified": len(inspection["charts"]),
        "capture_bytes": "not_checked",
        "publication_ready": False,
    }


def canonical_inventory(root):
    import re

    root = Path(root)
    runs = list((root / "store" / "runs").iterdir())
    if len(runs) != 1 or not re.fullmatch(RUN_RE, runs[0].name) or not runs[0].is_dir():
        raise ValueError("Each store must contain exactly one fresh attempt")
    all_files = inventory(root / "store")
    prefix = "runs/" + runs[0].name + "/"
    logical = {
        ("run/" + name[len(prefix) :] if name.startswith(prefix) else name): row
        for name, row in all_files.items()
    }
    operational = {name: logical.pop(name) for name in sorted(OPERATIONAL)}
    logical.update({"review/" + name: row for name, row in inventory(root / "review").items()})
    coverage = read(runs[0] / "coverage-inputs.json")
    checked_at = coverage.pop("checked_at")
    if type(checked_at) is not int:
        raise ValueError("Coverage operational clock has unexpected shape")
    return {
        "files": logical,
        "operational": operational,
        "coverage_without_clock": coverage,
        "checked_at": checked_at,
        "run_name": runs[0].name,
    }


def compare(left, right):
    a, b = left["files"], right["files"]
    differences = {
        "left_only": sorted(a.keys() - b.keys()),
        "right_only": sorted(b.keys() - a.keys()),
        "changed": sorted(name for name in a.keys() & b.keys() if a[name] != b[name]),
    }
    decisions_equal = left["coverage_without_clock"] == right["coverage_without_clock"]
    return {
        "passed": not any(differences.values()) and decisions_equal,
        "differences": differences,
        "coverage_inputs_except_checked_at_equal": decisions_equal,
        "canonical_files": len(a),
        "left_inventory_sha256": digest(encoded(a)),
        "right_inventory_sha256": digest(encoded(b)),
        "operational_raw": {"a": left["operational"], "b": right["operational"]},
        "operational_checked_at": [left["checked_at"], right["checked_at"]],
    }


def worker(manifest_path=None, manifest_sha=None):
    spec = manifest(manifest_path, manifest_sha)
    require_linux(spec)
    root, installed = Path("/output"), Path("/output/installed")
    paths = {name: Path("/inputs") / name for name in spec["inputs"]}
    paths["wheel"] = Path("/inputs") / WHEEL_NAME
    if any(
        not (os.statvfs(path).f_flag & os.ST_RDONLY)
        for path in [HERE, *paths.values(), *([manifest_path] if manifest_path else [])]
    ):
        raise ValueError("Harness and all inputs require read-only mounts")
    if shutil.which("node") is not None:
        raise ValueError("Unexpected Node in the canonical Python-only image")
    bindings = verify_inputs(spec, paths)
    verify_wheel(paths["wheel"])
    # Offline installation is part of explicit execution, never the default plan.
    subprocess.run(  # noqa: S603 -- pinned tools, explicit argv, no shell
        install_command(installed, paths, spec),
        check=True,
        stdout=subprocess.DEVNULL,
    )
    wheel = verify_wheel(paths["wheel"], installed)
    verify_builder_install(paths, spec, installed)
    sys.path.insert(0, str(installed))
    forbidden = guard_product(root)
    from maimai_intelligence.corpus_attempts import verify_attempt
    from maimai_intelligence.corpus_diagnostics import read_diagnostics
    from maimai_intelligence.corpus_failures import PublicationCapacityError
    from maimai_intelligence.corpus_requests import preparation_request
    from maimai_intelligence.corpus_update import implementation_hash, prepare_corpus
    from maimai_intelligence.public_release import plan_public_release

    start = time.monotonic()
    request = preparation_request(
        root / "store",
        paths["previous-browser"],
        previous_public=paths["previous-public"],
        registry=paths["registry"],
        package=paths["package"],
        coverage_reviews=read(paths["reviews"]),
        offline=True,
    )
    try:
        prepare_corpus(request)
    except PublicationCapacityError as error:
        refusal = str(error)
    else:
        raise ValueError("Expected capacity refusal was not raised")
    runs = list((root / "store" / "runs").iterdir())
    if len(runs) != 1:
        raise ValueError("Unexpected number of attempts")
    run = runs[0]
    attempt = verify_attempt(run, implementation_hash())
    events = read_diagnostics(run)
    if (
        read(run / "state.json") != {"status": "failed"}
        or (run / "ready.json").exists()
        or (root / "store" / "latest.json").exists()
        or (run / "public").exists()
    ):
        raise ValueError("Capacity refusal unexpectedly advanced readiness/publication")
    if [row["stage"] for row in events if row["outcome"] == "complete"] != [
        "inputs",
        "source_capture",
        "claims",
        "enrichment",
        "projection",
    ] or any(
        events[-1][key] != value
        for key, value in {
            "stage": "render",
            "outcome": "blocked",
            "code": "publication_capacity",
            "retry": "review_capacity_then_prepare",
        }.items()
    ):
        raise ValueError("Preparation did not reach the expected typed render refusal")
    if read(run / "source-captures.json")["captures"]:
        raise ValueError("Retained preparation unexpectedly acquired captures")
    plan = plan_public_release(run / "browser", previous_public=paths["previous-public"])
    summary = plain(plan.summary)
    check_capacity(summary, spec)
    corpus = (
        verify_current_corpus(run, paths, plan, spec)
        if spec.get("schema") == "maimai-linux-retained-corpus-inputs-2"
        else None
    )
    if refusal != summary["capacity_error"]:
        raise ValueError("Refusal does not bind the rendered public plan")
    before = inventory(root)
    planned = (
        sum(len(raw) for raw in plan.assets.values())
        + len(encoded(plain(plan.manifest)))
        + len(encoded(summary))
        + 2
    )
    if (
        sum(row["bytes"] for row in before.values()) + planned + 16 * 1024 * 1024
        > spec["allocation"]["per_attempt_max_bytes"]
    ):
        raise ValueError("Exact public plan exceeds the bounded attempt allocation")
    plan.write_review_to(root / "review")
    public_expected = {
        "planned-assets/" + name: {"bytes": len(raw), "sha256": digest(raw)}
        for name, raw in plan.assets.items()
    }
    public_actual = inventory(root / "review")
    if (
        set(public_actual) != set(public_expected) | {"planned-manifest.json", "release-plan.json"}
        or {name: row for name, row in public_actual.items() if name.startswith("planned-assets/")}
        != public_expected
        or read(root / "review" / "planned-manifest.json") != plain(plan.manifest)
        or read(root / "review" / "release-plan.json") != summary
    ):
        raise ValueError("Complete public review readback differs from the installed plan")
    if bindings != verify_inputs(spec, paths) or forbidden:
        raise ValueError("Inputs changed or an offline boundary was attempted")
    verify_wheel(paths["wheel"], installed)
    verify_builder_install(paths, spec, installed)
    for name, module in sys.modules.items():
        if name.split(".")[0] in {
            "maimai_intelligence",
            "maimai_analyzer",
            "opencc",
            "pypinyin",
        } and not Path(module.__file__).resolve().is_relative_to(installed):
            raise ValueError("Executing module escaped the installed wheel")
    observed = inventory(root)
    if sum(row["bytes"] for row in observed.values()) > spec["allocation"]["per_attempt_max_bytes"]:
        raise ValueError("Actual output exceeded its allocation")
    write(
        root / "worker-result.json",
        {
            "status": "complete_preparation_and_nondeployable_review",
            "source_commit": spec["source_commit"],
            "wheel": wheel,
            "inputs": bindings,
            "attempt_sha256": attempt["sha256"],
            "implementation": implementation_hash(),
            "summary": summary,
            "corpus": corpus,
            "elapsed_seconds": time.monotonic() - start,
            "forbidden_attempts": forbidden,
            "python": platform.python_version(),
            "platform": dict(
                zip(
                    ("sysname", "nodename", "release", "version", "machine"),
                    os.uname(),
                    strict=True,
                )
            ),
            "node_present": False,
            "live_or_deployable": False,
        },
    )


def docker_arguments(
    spec,
    docker,
    socket,
    control,
    paths,
    output,
    container_name,
    run_id,
    *,
    manifest_path=None,
    manifest_sha=None,
):
    base = [docker, "--host", "unix://" + str(socket), "--config", str(control)]
    args = base + [
        "run",
        "--rm",
        "--name",
        container_name,
        "--label",
        "maimai.corpus.run=" + run_id,
        "--pull=never",
        "--network=none",
        "--read-only",
        "--platform",
        spec["platform"],
        "--user",
        str(os.getuid()) + ":" + str(os.getgid()),
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--pids-limit=64",
        "--memory=8g",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,size=67108864",  # noqa: S108 -- isolated container tmpfs
        "--env",
        "PYTHONDONTWRITEBYTECODE=1",
        "--env",
        "PYTHONHASHSEED=0",
        "--env",
        "TZ=UTC",
        "--env",
        "LC_ALL=C.UTF-8",
    ]
    for source, destination, readonly in [
        (HERE, "/harness", True),
        (output, "/output", False),
        *(
            (path, "/inputs/" + (WHEEL_NAME if name == "wheel" else name), True)
            for name, path in paths.items()
        ),
    ]:
        if any(character in str(source) for character in (",", "\n", "\r")):
            raise ValueError("Unsupported Docker bind path")
        args.extend(
            [
                "--mount",
                "type=bind,src="
                + str(source)
                + ",dst="
                + destination
                + (",readonly" if readonly else ""),
            ]
        )
    # -I would ignore PYTHONHASHSEED. The pinned image receives no host Python
    # environment; -s suppresses user-site imports while retaining the fixed seed.
    tail = []
    if manifest_path is not None:
        manifest_path = regular_path(manifest_path)
        if any(character in str(manifest_path) for character in (",", "\n", "\r")):
            raise ValueError("Unsupported Docker manifest bind path")
        args.extend(
            [
                "--mount",
                "type=bind,src=" + str(manifest_path) + ",dst=/execution-manifest.json,readonly",
            ]
        )
        tail = ["--manifest", "/execution-manifest.json", "--manifest-sha256", manifest_sha]
    return base, args + [spec["image"], "python", "-s", "-B", "/harness/run.py", "--worker", *tail]


def close_own_container(base, env, name, run_id):
    def present():
        raw = subprocess.check_output(  # noqa: S603 -- pinned tool and explicit argv
            base
            + [
                "container",
                "ls",
                "--all",
                "--filter",
                "name=^/" + name + "$",
                "--format",
                "{{.ID}}",
            ],
            env=env,
            timeout=15,
            text=True,
        )
        ids = raw.split()
        if len(ids) > 1:
            raise ValueError("Ambiguous owned-container identity")
        if not ids:
            return None
        row = json.loads(
            subprocess.check_output(  # noqa: S603 -- verified owned container only
                base + ["container", "inspect", ids[0]], env=env, timeout=15
            )
        )[0]
        if (
            row["Name"] != "/" + name
            or row["Config"].get("Labels", {}).get("maimai.corpus.run") != run_id
        ):
            raise ValueError("Refuse cleanup of a container not owned by this exact invocation")
        return row

    row = present()
    if row is None:
        return {"status": "confirmed_absent"}
    try:
        stopped = subprocess.run(  # noqa: S603 -- pinned tools, explicit argv, no shell
            base + ["container", "stop", "--time", "10", row["Id"]],
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=20,
        )
        stop_code = stopped.returncode
    except subprocess.TimeoutExpired:
        stop_code = "timeout"
    current = present()
    if current is not None and current["State"]["Running"]:
        subprocess.run(  # noqa: S603 -- pinned tools, explicit argv, no shell
            base + ["container", "kill", row["Id"]],
            env=env,
            check=True,
            stdout=subprocess.DEVNULL,
            timeout=15,
        )
        current = present()
    if current is not None and current["State"]["Running"]:
        raise ValueError("Owned container remains running; execution is incomplete")
    return {"status": "confirmed_stopped_or_absent", "stop_exit_code": stop_code}


def execute_container(base, command, env, name, run_id, log):
    cleanup = {"status": "unverified"}
    try:
        with Path(log).open("xb") as stream:
            return subprocess.run(  # noqa: S603 -- pinned tools, explicit argv, no shell
                command, env=env, stdout=stream, stderr=subprocess.STDOUT, timeout=3600
            ).returncode
    finally:
        try:
            cleanup = close_own_container(base, env, name, run_id)
        except BaseException as error:
            cleanup = {"status": "failed_cleanup_verification", "error_type": type(error).__name__}
            raise
        finally:
            write(Path(log).with_suffix(".cleanup.json"), cleanup)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--paths",
        type=Path,
        help="Owner-local JSON map of the pinned labels to existing absolute paths",
    )
    parser.add_argument(
        "--output", type=Path, help="Absent directory in the destination's approved cache"
    )
    parser.add_argument(
        "--existing-ordinary-bytes",
        type=int,
        help="Fresh owner-verified ordinary usage including inputs",
    )
    parser.add_argument(
        "--run", action="store_true", help="Explicitly execute one pair; never downloads or retries"
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        help="Explicit current-source execution manifest; historical default is unchanged",
    )
    parser.add_argument("--manifest-sha256", help="Reviewed current execution manifest SHA256")
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.worker:
        try:
            worker(args.manifest, args.manifest_sha256)
        except BaseException as error:
            write(Path("/output/worker-failure.json"), failure_receipt(error))
            raise
        return
    if args.paths is None or args.output is None or args.existing_ordinary_bytes is None:
        parser.error("--paths, --output and --existing-ordinary-bytes are required")
    spec = manifest(args.manifest, args.manifest_sha256)
    execution_sha = args.manifest_sha256 or MANIFEST_SHA
    values = read(args.paths)
    if any(not Path(value).is_absolute() for value in values.values()):
        raise ValueError("Destination input paths must be absolute")
    paths = {name: regular_path(value) for name, value in values.items()}
    output = separate_output(args.output, paths)
    bindings = verify_inputs(spec, paths)
    wheel = verify_wheel(paths["wheel"])
    space = allocation(spec, shutil.disk_usage(output.parent).free, args.existing_ordinary_bytes)
    plan = {
        "status": "plan_only_not_executed",
        "source_commit": spec["source_commit"],
        "manifest_sha256": execution_sha,
        "runner_sha256": fingerprint(__file__)["sha256"],
        "inputs": bindings,
        "wheel": wheel,
        "allocation": space,
        "image": spec["image"],
        "independent_containers": 2,
        "canonical_artifacts_compared": False,
    }
    if not args.run:
        print(json.dumps(plan, indent=2))
        return
    if sys.platform != "linux":
        raise ValueError("Explicit execution requires the approved Linux destination")
    docker = shutil.which("docker")
    socket = Path("/var/run/docker.sock")
    if docker is None or not socket.exists() or not stat.S_ISSOCK(socket.stat().st_mode):
        raise ValueError("Existing local Docker engine is required; no provisioning is attempted")
    output.mkdir()
    control = output / "empty-docker-config"
    control.mkdir()
    write(output / "plan.json", plan)
    result = {
        "status": "failed",
        "passed": False,
        "source_commit": spec["source_commit"],
        "manifest_sha256": execution_sha,
        "completed_attempts": [],
        "live_or_deployable": False,
    }
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": "/nonexistent",
        "LANG": "C.UTF-8",
    }
    try:
        run_id = uuid.uuid4().hex
        base, _ = docker_arguments(
            spec,
            docker,
            socket,
            control,
            paths,
            output / "a",
            "maimai-corpus-" + run_id + "-a",
            run_id,
            manifest_path=args.manifest,
            manifest_sha=args.manifest_sha256,
        )
        image = json.loads(
            subprocess.check_output(  # noqa: S603 -- pinned image; read-only inspection
                base + ["image", "inspect", spec["image"]], env=env, timeout=15
            )
        )[0]
        if (
            image["Os"] != "linux"
            or image["Architecture"] != "amd64"
            or not any(
                item.endswith("@" + spec["image"].split("@", 1)[1])
                for item in image.get("RepoDigests", [])
            )
        ):
            raise ValueError("Local image identity differs from the pinned canonical image")
        result["image"] = {key: image[key] for key in ("Id", "Os", "Architecture", "RepoDigests")}
        for name in ("a", "b"):
            root = output / name
            root.mkdir()
            if bindings != verify_inputs(spec, paths):
                raise ValueError("Inputs changed between independent preparations")
            container_name = "maimai-corpus-" + run_id + "-" + name
            _, command = docker_arguments(
                spec,
                docker,
                socket,
                control,
                paths,
                root,
                container_name,
                run_id,
                manifest_path=args.manifest,
                manifest_sha=args.manifest_sha256,
            )
            exit_code = execute_container(
                base, command, env, container_name, run_id, output / (name + "-container.txt")
            )
            result["completed_attempts"].append({"name": name, "exit_code": exit_code})
            if exit_code != 0:
                raise ValueError(
                    "Independent preparation failed; retain its output "
                    "and do not retry automatically"
                )
            proof = read(root / "worker-result.json")
            if (
                proof["status"] != "complete_preparation_and_nondeployable_review"
                or proof["source_commit"] != spec["source_commit"]
                or proof["inputs"] != bindings
                or proof["forbidden_attempts"]
            ):
                raise ValueError("Worker receipt is incomplete or mismatched")
        first, second = canonical_inventory(output / "a"), canonical_inventory(output / "b")
        write(output / "a-inventory.json", first)
        write(output / "b-inventory.json", second)
        result["comparison"] = compare(first, second)
        if bindings != verify_inputs(spec, paths):
            raise ValueError("Retained inputs changed during the pair")
        if not result["comparison"]["passed"]:
            raise ValueError("Canonical outputs differ; all differences are retained")
        result.update(status="two_clean_linux_corpus_reviews_match", passed=True)
    except BaseException as error:
        result["failure"] = {"type": type(error).__name__, "message": str(error)[:1500]}
        raise
    finally:
        write(output / "result.json", result)


if __name__ == "__main__":
    try:
        main()
    except BaseException:
        traceback.print_exc()
        raise SystemExit(1) from None
