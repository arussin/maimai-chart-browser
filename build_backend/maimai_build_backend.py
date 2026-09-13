"""Dependency-free PEP 517 backend, adapted from the attributed report backend."""

from __future__ import annotations

import base64
import csv
import gzip
import hashlib
import io
import tarfile
import zipfile
from pathlib import Path

NAME = "maimai_chart_intelligence"
DISPLAY_NAME = "maimai-chart-intelligence"
VERSION = "0.2.0"
DIST_INFO = f"{NAME}-{VERSION}.dist-info"


def get_requires_for_build_wheel(config_settings=None):
    return []


get_requires_for_build_sdist = get_requires_for_build_wheel
get_requires_for_build_editable = get_requires_for_build_wheel


def _metadata():
    return (
        "Metadata-Version: 2.4\n"
        f"Name: {DISPLAY_NAME}\nVersion: {VERSION}\n"
        "Summary: Offline chart intelligence and standalone maimai browser\n"
        "Requires-Python: >=3.11\nLicense-Expression: MIT\nLicense-File: LICENSE\n"
        "License-File: THIRD_PARTY_NOTICES.md\nDescription-Content-Type: text/markdown\n\n"
        + Path("README.md").read_text("utf-8")
    )


def _entries(editable=False):
    root = Path.cwd()
    result = {}
    if editable:
        result[f"{NAME}.pth"] = (str(root.joinpath("src").resolve()) + "\n").encode()
    else:
        for package in ("maimai_analyzer", "maimai_intelligence"):
            for path in root.joinpath("src", package).rglob("*"):
                if path.is_file() and "__pycache__" not in path.parts and path.suffix != ".pyc":
                    result[path.relative_to(root / "src").as_posix()] = path.read_bytes()
    result[f"{DIST_INFO}/METADATA"] = _metadata().encode()
    result[f"{DIST_INFO}/WHEEL"] = (
        b"Wheel-Version: 1.0\nGenerator: maimai-build-backend\n"
        b"Root-Is-Purelib: true\nTag: py3-none-any\n"
    )
    result[f"{DIST_INFO}/entry_points.txt"] = (
        b"[console_scripts]\nmaimai-chart = maimai_intelligence.cli:main\n"
    )
    for name in ("LICENSE", "THIRD_PARTY_NOTICES.md"):
        result[f"{DIST_INFO}/licenses/{name}"] = root.joinpath(name).read_bytes()
    return result


def prepare_metadata_for_build_wheel(metadata_directory, config_settings=None):
    target = Path(metadata_directory)
    for name, content in _entries(True).items():
        if name.startswith(DIST_INFO + "/"):
            path = target / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
    return DIST_INFO


prepare_metadata_for_build_editable = prepare_metadata_for_build_wheel


def _write_wheel(wheel_directory, editable=False):
    target = Path(wheel_directory, f"{NAME}-{VERSION}-py3-none-any.whl")
    target.parent.mkdir(parents=True, exist_ok=True)
    entries = _entries(editable)
    record = io.StringIO(newline="")
    writer = csv.writer(record, lineterminator="\n")
    for name, content in sorted(entries.items()):
        value = base64.urlsafe_b64encode(hashlib.sha256(content).digest()).rstrip(b"=").decode()
        writer.writerow((name, "sha256=" + value, len(content)))
    writer.writerow((f"{DIST_INFO}/RECORD", "", ""))
    entries[f"{DIST_INFO}/RECORD"] = record.getvalue().encode()
    with zipfile.ZipFile(target, "w") as archive:
        for name, content in sorted(entries.items()):
            info = zipfile.ZipInfo(name, (2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, content)
    return target.name


def build_wheel(wheel_directory, config_settings=None, metadata_directory=None):
    return _write_wheel(wheel_directory)


def build_editable(wheel_directory, config_settings=None, metadata_directory=None):
    return _write_wheel(wheel_directory, True)


def build_sdist(sdist_directory, config_settings=None):
    target = Path(sdist_directory, f"{DISPLAY_NAME}-{VERSION}.tar.gz")
    target.parent.mkdir(parents=True, exist_ok=True)
    selected = [
        Path(p)
        for p in (
            "pyproject.toml",
            "README.md",
            "LICENSE",
            "THIRD_PARTY_NOTICES.md",
            "requirements-dev.txt",
            ".gitignore",
        )
    ]
    for directory in ("src", "build_backend", "tests", "scripts", "docs"):
        selected.extend(
            p
            for p in Path(directory).rglob("*")
            if p.is_file()
            and not {
                "__pycache__",
                "node_modules",
                "test-results",
                "playwright-report",
            }.intersection(p.parts)
            and p.suffix
            in {".py", ".json", ".jsonl", ".js", ".mjs", ".css", ".html", ".md", ".toml", ".gz"}
        )
    with (
        target.open("wb") as stream,
        gzip.GzipFile(filename="", fileobj=stream, mode="wb", mtime=0) as compressed,
    ):
        with tarfile.open(fileobj=compressed, mode="w") as archive:
            for path in sorted(set(selected)):
                content = path.read_bytes()
                info = tarfile.TarInfo(f"{DISPLAY_NAME}-{VERSION}/{path.as_posix()}")
                info.size = len(content)
                info.mode = 0o644
                archive.addfile(info, io.BytesIO(content))
    return target.name
