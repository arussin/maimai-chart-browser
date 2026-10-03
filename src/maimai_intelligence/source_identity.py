"""Source checkout identity for the existing owner release guard.

Installed-only attempts use the packaged implementation identity. Owner attempts
add compiler, policy, configuration and developer-tool inputs from a checkout.
"""

import hashlib
from importlib.resources import files
from importlib.resources.abc import Traversable
from pathlib import Path

from maimai_analyzer.contracts import content_hash

from .corpus_failures import CorpusInputError


def source_implementation_hash(root: Path) -> str:
    root = Path(root)
    paths = sorted(
        p
        for area in (
            "src",
            "scripts",
            "registry",
            "config",
            "build_backend",
            "web/src",
            "usage-worker/migrations",
        )
        for p in (root / area).rglob("*")
        if p.is_file() and "__pycache__" not in p.parts and p.suffix != ".pyc"
    )
    # Runtime code alone does not bind decoder, compiler or Worker policy changes.
    paths.extend(
        root / name
        for name in (
            "requirements-dev.txt",
            "requirements-localization.txt",
            "pyproject.toml",
            "web/package.json",
            "web/package-lock.json",
            "web/build.mjs",
            "web/tsconfig.json",
            "web/generated-assets.json",
            "usage-worker/worker.ts",
            "usage-worker/wrangler.jsonc",
            "usage-worker/package.json",
            "usage-worker/package-lock.json",
            "usage-worker/tsconfig.json",
            "usage-worker/report.mjs",
        )
        if (root / name).is_file()
    )
    return content_hash(
        {
            p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(paths)
        }
    )


def runtime_inventory() -> dict[str, dict[str, str]]:
    """Bind installed implementation and assets without requiring a source checkout."""

    def inventory(node: Traversable, prefix: str) -> dict[str, str]:
        result = {}
        for child in sorted(node.iterdir(), key=lambda p: p.name):
            name = prefix + child.name
            if child.is_dir() and child.name != "__pycache__":
                result.update(inventory(child, name + "/"))
            elif child.is_file() and not child.name.endswith((".pyc", ".pyo")):
                result[name] = hashlib.sha256(child.read_bytes()).hexdigest()
        return result

    return {name: inventory(files(name), "") for name in ("maimai_analyzer", "maimai_intelligence")}


def implementation_hash() -> str:
    return content_hash(runtime_inventory())


def verified_source_implementation_hash(root: Path) -> str:
    """An owner source identity may describe only the package actually executing."""
    expected = runtime_inventory()
    actual: dict[str, dict[str, str]] = {}
    for name in expected:
        directory = root / "src" / name
        actual[name] = {
            path.relative_to(directory).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in directory.rglob("*")
            if path.is_file()
            and "__pycache__" not in path.parts
            and path.suffix not in (".pyc", ".pyo")
        }
    if actual != expected:
        raise CorpusInputError("Source checkout does not match the executing package")
    return source_implementation_hash(root)
