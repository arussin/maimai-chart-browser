"""Exact236 public acquisition, then a separately invoked networkless Linux pair.

Default is a small plan. No upload, image pull, dependency installation, cleanup,
credential access, workflow dispatch or account mutation is implemented here.
"""

import argparse
import ast
import gzip
import hashlib
import http.client
import importlib.util
import json
import os
import shutil
import ssl
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from pathlib import Path, PurePosixPath

HERE = Path(__file__).resolve().parent
SOURCE = "2364f72de9d01a0636cbc22aec4f2c04d02607bb"
BASE = "cc5a703936b61f3c3e9d151ade5b7a5067379d2e"
PUBLIC = "https://6662deec.maimai-party.pages.dev"
RAW = "https://raw.githubusercontent.com/arussin/maimai-chart-browser/"
INVENTORY_SHA = "1e34913c85e95341b7c976caa878170db6457ef7b8b204f31c91d1d51fc104bd"
TEMPLATE_SHA = "d4b42bf104c152eea9ba193f7b3c182c1c37e503697841fe8033e5723561d562"
RUNNER_SHA = "2fe2bf9271df711010facff0a5e1becf4f903e083ffbc8005f25c75c3a468e35"
PACKET = {
    "bytes": 18015314,
    "sha256": "98480ad2b49313e233a0bddccb23c1ee45ebe9f9face81b094b218ca8ac3b319",
}
PUBLIC_SOURCE = {
    "bytes": 12786,
    "sha256": "d2b05a9354352261b6046473c289d75097902ab15d2ba844c5bd7adbc9354125",
}
CONTROL_SOURCE = "src/maimai_intelligence/public_release.py"
IMMUTABLE_PREFIXES = (
    "catalogs/",
    "catalog-parts/",
    "catalog-index/",
    "chart-details/",
    "media/",
    "integration/",
)
FREE_RESERVE = 30 * 1024**3
ORDINARY_GUARD = 20 * 1024**3
PAIR_BYTES = 2 * 4 * 1024**3 + 128 * 1024**2
ACQUISITION_RESERVE = 16 * 1024**2


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def fingerprint(path):
    result, count = hashlib.sha256(), 0
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
            count += len(block)
    return {"bytes": count, "sha256": result.hexdigest()}


def regular(path):
    path = Path(path).absolute()
    for item in (path, *path.parents):
        if item.exists() or item.is_symlink():
            info = item.lstat()
            if (
                stat.S_ISLNK(info.st_mode)
                or not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode))
                or getattr(info, "st_file_attributes", 0) & 0x400
            ):
                raise ValueError("NONREGULAR_PATH")
    return path.resolve()


def relative(name):
    if not isinstance(name, str) or not name or "\\" in name or any(ord(c) < 32 for c in name):
        raise ValueError("INVALID_MEMBER")
    path = PurePosixPath(name)
    if path.is_absolute() or any(p in {"", ".", ".."} or ":" in p for p in name.split("/")):
        raise ValueError("INVALID_MEMBER")
    return path


def write_new(path, raw):
    path = regular(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as stream:
        stream.write(raw)


def checked_raw(path, expected_sha):
    raw = regular(path).read_bytes()
    if sha(raw) != expected_sha:
        raise ValueError("HELPER_PIN_CHANGED")
    return raw


def recipe():
    packed = checked_raw(HERE / "inventory-726.json.gz", INVENTORY_SHA)
    raw = gzip.decompress(packed)
    if len(raw) != 3329387:
        raise ValueError("INVENTORY_LENGTH")
    trees = json.loads(raw)
    spec = json.loads(checked_raw(HERE / "inputs-726.template.json", TEMPLATE_SHA))
    if set(trees) != {"registry", "package", "previous-browser", "previous-public"}:
        raise ValueError("INVENTORY_LABELS")
    for label, files in trees.items():
        for name, row in files.items():
            relative(name)
            if set(row) != {"bytes", "sha256"} or type(row["bytes"]) is not int or row["bytes"] < 0:
                raise ValueError("INVALID_INVENTORY")
        actual = {
            "kind": "tree",
            "files": len(files),
            "bytes": sum(r["bytes"] for r in files.values()),
            "inventory_sha256": sha(encoded(files)),
        }
        if actual != spec["inputs"][label]:
            raise ValueError("INVENTORY_DIGEST")
    return trees, spec


def load_runner():
    checked_raw(HERE / "run.py", RUNNER_SHA)
    spec = importlib.util.spec_from_file_location("sealed_corpus_runner", HERE / "run.py")
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    return runner


def public_url(url, category, *, redirect=False):
    parsed = urllib.parse.urlsplit(url)
    if (
        parsed.scheme != "https"
        or parsed.username
        or parsed.password
        or parsed.port not in (None, 443)
        or parsed.fragment
    ):
        raise ValueError("ENDPOINT_DENIED")
    if category == "pages":
        allowed = parsed.netloc == "6662deec.maimai-party.pages.dev" and not parsed.query
    elif category == "source":
        allowed = (
            parsed.netloc == "raw.githubusercontent.com"
            and parsed.path.startswith(
                (
                    "/arussin/maimai-chart-browser/" + SOURCE + "/",
                    "/arussin/maimai-chart-browser/" + BASE + "/",
                )
            )
            and not parsed.query
        )
    elif category == "packet":
        initial = (
            parsed.netloc == "github.com"
            and parsed.path.startswith("/arussin/maimai-chart-browser/releases/download/")
            and parsed.path.endswith("/maimai-corpus-inputs-726e546.zip")
            and not parsed.query
        )
        allowed = initial or (redirect and parsed.netloc == "release-assets.githubusercontent.com")
    else:
        allowed = False
    if not allowed:
        raise ValueError("ENDPOINT_DENIED")
    return url


class Redirects(urllib.request.HTTPRedirectHandler):
    def __init__(self, category):
        self.category = category

    def redirect_request(self, request, fp, code, msg, headers, newurl):
        public_url(newurl, self.category, redirect=True)
        return super().redirect_request(request, fp, code, msg, headers, newurl)


def stream_checked(source, target, expected):
    count, digest = 0, hashlib.sha256()
    with target.open("xb") as output:
        while block := source.read(min(1024 * 1024, expected["bytes"] - count + 1)):
            count += len(block)
            if count > expected["bytes"]:
                raise ValueError("INPUT_OVERSIZE")
            digest.update(block)
            output.write(block)
    if {"bytes": count, "sha256": digest.hexdigest()} != expected:
        raise ValueError("INPUT_DIGEST_MISMATCH")


class AcquisitionFailure(ValueError):
    """Finite diagnostics bound to a public input, never a request or response."""

    def __init__(self, code, category, expected, http_status=None):
        super().__init__("PUBLIC_INPUT_ACQUISITION_FAILED")
        self.detail = {
            "code": code,
            "category": category,
            "expected_sha256": expected["sha256"],
            "expected_bytes": expected["bytes"],
        }
        if http_status is not None:
            self.detail["http_status"] = http_status


def download_failure(error, category, expected):
    """Classify expected acquisition failures without serializing exception text."""
    if isinstance(error, AcquisitionFailure):
        return error
    if isinstance(error, urllib.error.HTTPError):
        return AcquisitionFailure("HTTP_STATUS", category, expected, error.code)
    cause = error.reason if isinstance(error, urllib.error.URLError) else error
    if isinstance(cause, ssl.SSLCertVerificationError):
        code = "TLS_VERIFICATION_FAILED"
    elif isinstance(cause, ssl.SSLError):
        code = "TLS_FAILURE"
    elif isinstance(cause, TimeoutError):
        code = "TIMEOUT"
    elif isinstance(cause, http.client.IncompleteRead):
        code = "TRUNCATED_RESPONSE"
    elif isinstance(error, (urllib.error.URLError, ConnectionError)):
        code = "TRANSPORT_FAILURE"
    elif isinstance(error, ValueError) and str(error) in {
        "ENDPOINT_DENIED",
        "HTTP_LENGTH_INVALID",
        "INPUT_LENGTH_MISMATCH",
        "INPUT_OVERSIZE",
        "INPUT_DIGEST_MISMATCH",
    }:
        code = str(error)
    else:
        return None  # Programming and local filesystem errors must still abort.
    return AcquisitionFailure(code, category, expected)


def download(url, path, expected, category):
    public_url(url, category)
    path = regular(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), Redirects(category))
    request = urllib.request.Request(  # noqa: S310 -- exact HTTPS origin validated above
        url, headers={"User-Agent": "maimai-offline-corpus-proof/1", "Accept-Encoding": "identity"}
    )
    try:
        with opener.open(request, timeout=30) as response:  # noqa: S310 -- HTTPS allowlist above
            public_url(response.url, category, redirect=True)
            if response.status != 200:
                raise AcquisitionFailure("HTTP_STATUS", category, expected, response.status)
            if response.headers.get("Content-Encoding", "identity") != "identity":
                raise AcquisitionFailure("HTTP_ENCODING_REJECTED", category, expected)
            length = response.headers.get("Content-Length")
            if length is not None:
                try:
                    length = int(length)
                except ValueError:
                    raise ValueError("HTTP_LENGTH_INVALID") from None
                if length != expected["bytes"]:
                    raise ValueError("INPUT_LENGTH_MISMATCH")
            stream_checked(response, path, expected)
    except Exception as error:
        failure = download_failure(error, category, expected)
        if failure is None:
            raise
        raise failure from None


def controls(source):
    """Read constant syntax only; never execute historical Python."""
    if {"bytes": len(source), "sha256": sha(source)} != PUBLIC_SOURCE:
        raise ValueError("CONTROL_SOURCE_CHANGED")
    tree = ast.parse(source)
    public = next(
        n.value
        for n in tree.body
        if isinstance(n, ast.Assign)
        and any(isinstance(t, ast.Name) and t.id == "PUBLIC_FILES" for t in n.targets)
    )
    names = [
        n.value
        for n in public.elts
        if isinstance(n, ast.Constant)
        and isinstance(n.value, str)
        and n.value.endswith((".js", ".css"))
    ]
    base = next(
        n.value.value
        for n in ast.walk(tree)
        if isinstance(n, ast.Assign)
        and isinstance(n.value, ast.Constant)
        and isinstance(n.value.value, bytes)
        and any(
            isinstance(t, ast.Subscript)
            and isinstance(t.slice, ast.Constant)
            and t.slice.value == "_headers"
            for t in n.targets
        )
    )
    headers = (
        base
        + b"\n"
        + b"".join(
            (name + "\n  Cache-Control: no-store\n").encode()
            for name in ["/", "/index.html", "/manifest.json", *("/" + n for n in names)]
        )
    )
    redirects = (
        b"\n/pilot/maishift /?view=catalog 302\n"
        b"/pilot/maishift/ /?view=catalog 302\n"
        b"/pilot/maishift/* /?view=catalog 302\n"
    )
    return {
        "_headers": headers.replace(b"\n", b"\r\n"),
        "_redirects": redirects.replace(b"\n", b"\r\n"),
    }


def packet_members(trees):
    public = trees["previous-public"]
    answer = {
        "registry/" + n: trees["registry"][n] for n in ("charts.json", "songs.json", "sources.json")
    }
    answer.update(
        {
            "package/" + n: row
            for n, row in trees["package"].items()
            if n != "review.json" and (not n.startswith("media/") or public.get(n) != row)
        }
    )
    if len(answer) != 153 or sum(r["bytes"] for r in answer.values()) != 88758400:
        raise ValueError("PACKET_SCOPE_CHANGED")
    return answer


def unpack_packet(path, root, expected):
    if fingerprint(path) != PACKET:
        raise ValueError("PACKET_CHANGED")
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        names = [row.filename for row in entries]
        if len(names) != len(set(names)) or set(names) != set(expected):
            raise ValueError("PACKET_MEMBERS_CHANGED")
        for row in entries:
            relative(row.filename)
            mode = row.external_attr >> 16
            if (
                row.is_dir()
                or not stat.S_ISREG(mode)
                or row.flag_bits & 1
                or row.file_size != expected[row.filename]["bytes"]
            ):
                raise ValueError("PACKET_MEMBER_TYPE_OR_SIZE")
            target = regular(root / row.filename)
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(row) as source:
                stream_checked(source, target, expected[row.filename])


def materialize_derived(root, trees):
    registry = trees["registry"]
    value = {
        "schema_version": "maimai-registry-1",
        "files": {
            name[:-5]: {"path": name, **row}
            for name, row in registry.items()
            if name != "manifest.json"
        },
    }
    write_new(root / "registry/manifest.json", encoded(value) + b"\n")
    for label in ("package", "previous-browser"):
        for name, expected in trees[label].items():
            target = root / label / name
            if target.exists() or name == "manifest.json" or name.startswith("catalogs/"):
                continue
            keeper = root / "previous-public" / name
            if trees["previous-public"].get(name) != expected or fingerprint(keeper) != expected:
                raise ValueError("PUBLIC_COPY_BINDING")
            target.parent.mkdir(parents=True, exist_ok=True)
            with keeper.open("rb") as source:
                stream_checked(source, target, expected)
    public = json.loads((root / "previous-public/manifest.json").read_bytes())
    catalogs = {entry["path"]: entry for entry in public["releases"]}
    for name, expected in trees["previous-browser"].items():
        if not name.startswith("catalogs/"):
            continue
        entry = catalogs[name]
        if (
            entry["sha256"] != expected["sha256"]
            or sum(p["bytes"] for p in entry["parts"]) != expected["bytes"]
        ):
            raise ValueError("CATALOG_MANIFEST_BINDING")
        target = root / "previous-browser" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("xb") as output:
            for part in entry["parts"]:
                relative(part["path"])
                keeper = root / "previous-public" / part["path"]
                expected_part = {k: part[k] for k in ("bytes", "sha256")}
                if (
                    trees["previous-public"].get(part["path"]) != expected_part
                    or fingerprint(keeper) != expected_part
                ):
                    raise ValueError("CATALOG_PART_BINDING")
                with keeper.open("rb") as stream:
                    shutil.copyfileobj(stream, output, 1024 * 1024)
        if fingerprint(target) != expected:
            raise ValueError("CONCATENATED_CATALOG_CHANGED")
    legacy = {
        **public,
        "schema_version": "1.0.0",
        "releases": [
            {k: v for k, v in r.items() if k not in {"parts", "startup"}}
            for r in public["releases"]
        ],
    }
    write_new(root / "previous-browser/manifest.json", encoded(legacy) + b"\n")


def storage_entry(path, roots):
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode):
        target = path.resolve(strict=True)
        if not any(target.is_relative_to(root) for root in roots):
            raise ValueError("STORAGE_LINK_ESCAPES_SCOPE")
        if not (target.is_file() or target.is_dir()):
            raise ValueError("NONREGULAR_STORAGE_LINK_TARGET")
        # Existing Node/npm links are not traversed. Their actual destination is
        # counted once at its real location in these same ordinary roots.
        return info.st_size, True, False
    regular(path)
    if stat.S_ISREG(info.st_mode):
        return info.st_size, False, True
    if stat.S_ISDIR(info.st_mode):
        return 0, False, False
    raise ValueError("NONREGULAR_STORAGE_ENTRY")


def storage(roots, required_paths, free_path):
    selected = sorted({regular(p) for p in roots}, key=lambda p: len(p.parts))
    normalized = []
    for root in selected:
        if not root.is_dir():
            raise ValueError("STORAGE_ROOT_MISSING")
        if not any(root.is_relative_to(parent) for parent in normalized):
            normalized.append(root)
    if not normalized or any(
        not any(regular(p).is_relative_to(r) for r in normalized) for p in required_paths
    ):
        raise ValueError("STORAGE_SCOPE_INCOMPLETE")
    total, count, links = 0, 0, 0

    def fail(error):
        raise error

    for root in normalized:
        for directory, dirs, files in os.walk(root, followlinks=False, onerror=fail):
            for name in [*dirs, *files]:
                path = Path(directory) / name
                size, linked, file = storage_entry(path, normalized)
                total += size
                count += int(file)
                links += int(linked)
                if linked and name in dirs:
                    dirs.remove(name)
    return {
        "ordinary_bytes": total,
        "files": count,
        "internal_links_not_followed": links,
        "free_bytes": shutil.disk_usage(free_path).free,
        "measured_at_unix": time.time(),
        "roots": [str(p) for p in normalized],
        "errors": 0,
    }


def acquire_tasks(tasks, progress=None):
    """Keep at most four requests live; stop scheduling after the first failure."""
    remaining = iter(tasks)
    progress = progress if progress is not None else {}
    progress.update(total=len(tasks), scheduled=0, completed_observed=0)
    with ThreadPoolExecutor(max_workers=4) as pool:
        pending = {
            pool.submit(download, *item)
            for item in [next(remaining, None) for _ in range(4)]
            if item is not None
        }
        progress["scheduled"] = len(pending)
        try:
            while pending:
                complete, pending = wait(pending, return_when=FIRST_COMPLETED)
                for future in complete:
                    future.result()
                    progress["completed_observed"] += 1
                    if progress["completed_observed"] % 500 == 0:
                        print(
                            json.dumps({"status": "acquisition_progress", **progress}), flush=True
                        )
                for _ in complete:
                    item = next(remaining, None)
                    if item is not None:
                        pending.add(pool.submit(download, *item))
                        progress["scheduled"] += 1
        except BaseException:
            for future in pending:
                future.cancel()
            raise


def guard_space(survey, additional):
    if (
        survey["ordinary_bytes"] + additional >= ORDINARY_GUARD
        or survey["free_bytes"] - additional < FREE_RESERVE
    ):
        raise ValueError("DESTINATION_CAPACITY_NOT_ACCEPTED")


def storage_diagnostic(survey, additional):
    return {
        "status": "storage_preflight",
        "ordinary_bytes": survey["ordinary_bytes"],
        "free_bytes": survey["free_bytes"],
        "measured_at_unix": survey["measured_at_unix"],
        "requested_additional_bytes": additional,
        "ordinary_guard_bytes": ORDINARY_GUARD,
        "free_reserve_bytes": FREE_RESERVE,
    }


def acquire(args, trees, template):
    if sys.platform != "linux":
        raise ValueError("ACQUISITION_REQUIRES_APPROVED_LINUX_DESTINATION")
    public_url(args.packet_url, "packet")
    root, wheel = regular(args.output), regular(args.wheel)
    if (
        root.exists()
        or not root.parent.is_dir()
        or not wheel.is_file()
        or root.is_relative_to(wheel)
        or wheel.is_relative_to(root)
    ):
        raise ValueError("NEW_SEPARATE_OUTPUT_REQUIRED")
    actual_wheel = fingerprint(wheel)
    if (
        actual_wheel["sha256"] != template["inputs"]["wheel"]["sha256"]
        or not 0 < actual_wheel["bytes"] < 8 * 1024**2
    ):
        raise ValueError("CURRENT_LINUX_WHEEL_CHANGED")
    runner = load_runner()
    runner.verify_wheel(wheel)
    roots = args.ordinary_root
    if os.environ.get("GITHUB_ACTIONS") == "true":
        roots = [*roots, os.environ["RUNNER_WORKSPACE"], os.environ["RUNNER_TEMP"]]
    survey = storage(roots, [root.parent, wheel], root.parent)
    addition = (
        sum(row["bytes"] for label, files in trees.items() for row in files.values())
        + 904
        + PACKET["bytes"]
        + ACQUISITION_RESERVE
    )
    print(json.dumps(storage_diagnostic(survey, addition + PAIR_BYTES)), flush=True)
    guard_space(survey, addition + PAIR_BYTES)
    root.mkdir()
    result = {
        "schema": "maimai-linux-public-acquisition-726-1",
        "status": "failed",
        "source_commit": SOURCE,
        "survey": survey,
        "acquisition_bound_bytes": addition,
        "packet_sha256": PACKET["sha256"],
        "publication_or_upload": False,
        "networkless_pair_executed": False,
    }
    try:
        inputs = root / "inputs"
        inputs.mkdir()
        packet = root / "packet.zip"
        download(args.packet_url, packet, PACKET, "packet")
        unpack_packet(packet, inputs, packet_members(trees))
        source_path = root / "published-controls-source.py"
        download(RAW + BASE + "/" + CONTROL_SOURCE, source_path, PUBLIC_SOURCE, "source")
        for name, raw in controls(source_path.read_bytes()).items():
            if {"bytes": len(raw), "sha256": sha(raw)} != trees["previous-public"][name]:
                raise ValueError("CONTROL_RECONSTRUCTION_CHANGED")
            write_new(inputs / "previous-public" / name, raw)
        tasks = [
            (
                PUBLIC + "/" + urllib.parse.quote(name, safe="/"),
                inputs / "previous-public" / name,
                row,
                "pages",
            )
            for name, row in trees["previous-public"].items()
            if name not in {"_headers", "_redirects"}
        ]
        tasks += [
            (
                RAW + SOURCE + "/registry/" + name,
                inputs / "registry" / name,
                trees["registry"][name],
                "source",
            )
            for name in ("legacy-ids.json", "mappings.json", "observations.json")
        ]
        tasks += [
            (
                RAW + SOURCE + "/config/mai-notes-overrides.json",
                inputs / "package/review.json",
                trees["package"]["review.json"],
                "source",
            ),
            (
                RAW + SOURCE + "/config/coverage-reviews.json",
                inputs / "reviews.json",
                {k: v for k, v in template["inputs"]["reviews"].items() if k != "kind"},
                "source",
            ),
        ]
        # Four bounded static requests at a time; never retries failed providers.
        result["progress"] = {}
        acquire_tasks(tasks, result["progress"])
        materialize_derived(inputs, trees)
        paths = {name: str(inputs / name) for name in trees}
        paths.update(wheel=str(wheel), reviews=str(inputs / "reviews.json"))
        spec = {
            **template,
            "inputs": {**template["inputs"], "wheel": {"kind": "file", **actual_wheel}},
        }
        spec["total_input_bytes"] = sum(row["bytes"] for row in spec["inputs"].values())
        bindings = runner.verify_inputs(spec, paths)
        raw = encoded(spec) + b"\n"
        write_new(root / "execution-manifest.json", raw)
        write_new(root / "paths.json", encoded(paths) + b"\n")
        actual = runner.inventory(root)
        if sum(row["bytes"] for row in actual.values()) > addition:
            raise ValueError("ACQUISITION_BOUND_EXCEEDED")
        result.update(
            status="exact_inputs_acquired_pair_not_executed",
            bindings=bindings,
            execution_manifest_sha256=sha(raw),
            paths_sha256=sha(encoded(paths) + b"\n"),
            helper_sha256=sha(Path(__file__).read_bytes()),
            runner_sha256=RUNNER_SHA,
            inventory_recipe_sha256=INVENTORY_SHA,
            footprint_bytes=sum(row["bytes"] for row in actual.values()),
            public_request_count=len(tasks) + 2,
        )
    except BaseException as error:
        result["failure_type"] = type(error).__name__
        if isinstance(error, AcquisitionFailure):
            result["failure_detail"] = error.detail
        result["failure_code"] = (
            str(error)
            if str(error)
            in {
                "PUBLIC_INPUT_ACQUISITION_FAILED",
                "ACQUISITION_BOUND_EXCEEDED",
                "CONTROL_RECONSTRUCTION_CHANGED",
            }
            else "ACQUISITION_INTEGRITY_FAILURE"
        )
        raise
    finally:
        write_new(root / "acquisition-result.json", encoded(result) + b"\n")


def run_pair(args):
    if sys.platform != "linux":
        raise ValueError("PAIR_REQUIRES_APPROVED_LINUX_DESTINATION")
    root = regular(args.acquired)
    receipt = json.loads((root / "acquisition-result.json").read_bytes())
    if (
        receipt["status"] != "exact_inputs_acquired_pair_not_executed"
        or receipt["source_commit"] != SOURCE
        or receipt["runner_sha256"] != RUNNER_SHA
        or receipt["inventory_recipe_sha256"] != INVENTORY_SHA
    ):
        raise ValueError("ACQUISITION_NOT_ACCEPTED")
    runner = load_runner()
    spec = runner.manifest(root / "execution-manifest.json", receipt["execution_manifest_sha256"])
    paths_raw = checked_raw(root / "paths.json", receipt["paths_sha256"])
    paths = json.loads(paths_raw)
    output = runner.separate_output(args.output, paths)
    bindings = runner.verify_inputs(spec, paths)
    if bindings != receipt["bindings"]:
        raise ValueError("ACQUIRED_INPUTS_CHANGED")
    roots = args.ordinary_root
    if os.environ.get("GITHUB_ACTIONS") == "true":
        roots = [*roots, os.environ["RUNNER_WORKSPACE"], os.environ["RUNNER_TEMP"]]
    survey = storage(roots, [root, output.parent, *paths.values()], output.parent)
    print(json.dumps(storage_diagnostic(survey, PAIR_BYTES)), flush=True)
    guard_space(survey, PAIR_BYTES)
    # Survey includes acquired inputs, earlier CI outputs and project acquisition;
    # the separately measured actual free-space reserve also covers Docker layers.
    write_new(root / "pre-pair-storage.json", encoded(survey) + b"\n")
    subprocess.run(  # noqa: S603 -- pinned tools, explicit argv, no shell
        [
            sys.executable,
            "-B",
            str(HERE / "run.py"),
            "--manifest",
            str(root / "execution-manifest.json"),
            "--manifest-sha256",
            receipt["execution_manifest_sha256"],
            "--paths",
            str(root / "paths.json"),
            "--output",
            str(output),
            "--existing-ordinary-bytes",
            str(survey["ordinary_bytes"] + 65536),
            "--run",
        ],
        check=True,
        env={
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "HOME": "/nonexistent",
            "LANG": "C.UTF-8",
            "PYTHONDONTWRITEBYTECODE": "1",
        },
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("plan", "acquire", "run"), nargs="?", default="plan")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--wheel", type=Path)
    parser.add_argument("--packet-url")
    parser.add_argument("--acquired", type=Path)
    parser.add_argument("--ordinary-root", action="append", default=[], type=Path)
    args = parser.parse_args()
    trees, template = recipe()
    if args.phase == "plan":
        print(
            json.dumps(
                {
                    "status": "plan_only",
                    "source_commit": SOURCE,
                    "packet": PACKET,
                    "packet_publication_approved_here": False,
                    "linux_wheel_sha256": template["inputs"]["wheel"]["sha256"],
                    "input_bytes_excluding_wheel": 1738192120,
                    "pair_reservation_bytes": PAIR_BYTES,
                    "minimum_free_before_pair_bytes": PAIR_BYTES + FREE_RESERVE,
                    "ordinary_guard_bytes": ORDINARY_GUARD,
                    "measured_destination_capacity": None,
                    "network_or_build_executed": False,
                },
                indent=2,
            )
        )
    elif args.phase == "acquire":
        if args.output is None or args.wheel is None or args.packet_url is None:
            parser.error("acquire requires --output, --wheel and approved --packet-url")
        acquire(args, trees, template)
    else:
        if args.output is None or args.acquired is None:
            parser.error("run requires --output and --acquired")
        run_pair(args)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(
            json.dumps(
                {
                    "status": "refused_or_failed",
                    "error_type": type(error).__name__,
                    "raw_exception_redacted": True,
                }
            ),
            file=sys.stderr,
        )
        raise SystemExit(1) from None
