"""Source checkout identity for the existing owner release guard.

Installed-only attempts use the packaged implementation identity. Owner attempts
add compiler, policy, configuration and developer-tool inputs from a checkout.
"""

import hashlib
from pathlib import Path

from maimai_analyzer.contracts import content_hash


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
