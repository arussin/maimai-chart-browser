"""Producer evidence for private coverage receipts, separate from domain policy."""

import hashlib
import platform
from importlib import metadata
from importlib.resources import files

from .serialization import digest

POLICY_FILES = (
    "coverage.py",
    "coverage_store.py",
    "coverage_runtime.py",
    "coverage_policy.py",
    "coverage_queue.py",
    "coverage_sources.py",
    "coverage_types.py",
    "provider_reconciliation.py",
    "enrichment.py",
    "artwork_store.py",
    "catalog_capture.py",
    "catalog_sources.py",
    "transcription_html.py",
    "identity_policy.py",
    "serialization.py",
    "registry.py",
    "metadata_policy.py",
    "official_contract.py",
)


def producer_identity():
    package = files("maimai_intelligence")
    sources = {
        name: hashlib.sha256(package.joinpath(name).read_bytes()).hexdigest()
        for name in POLICY_FILES
    }
    try:
        pillow = metadata.version("Pillow")
    except metadata.PackageNotFoundError:
        pillow = None
    runtime = {
        "python": platform.python_version(),
        "implementation": platform.python_implementation(),
        "platform": platform.system(),
        "machine": platform.machine(),
        "pillow": pillow,
    }
    return {
        "version": "coverage-producer-1",
        "sources": sources,
        "runtime": runtime,
        "policy_sha256": digest({"sources": sources, "runtime": runtime}),
    }
