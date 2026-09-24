"""Small same-corpus runtime fixtures, never a production release or rollback.

Keep accepted legacy document/runtime bytes but replace its real corpus with the
same authored corpus as the candidate. This bounds disk use and isolates runtime
compatibility. Full retained-corpus and hosted recovery remain separate gates.
"""

import argparse
import hashlib
import json
import shutil
from pathlib import Path

from maimai_intelligence.lab import build_lab
from maimai_intelligence.public_release import (
    assemble_release,
    build_public_release,
    plan_release_composition,
)
from maimai_intelligence.release_composition import (
    PathOwnership,
    RuntimeClosure,
    inventory_from_records,
)
from maimai_intelligence.serialization import digest
from maimai_intelligence.snapshots import atomic_json
from tests.lab_fixture import write_package

DATA = {
    "catalogs",
    "catalog-parts",
    "catalog-index",
    "chart-details",
    "integration",
    "song-catalog",
    "song-catalog-index",
    "media",
}
DOCUMENTS = {
    "index.html",
    "manifest.json",
    "_headers",
    "_redirects",
    "robots.txt",
    "sitemap.xml",
    "support.html",
    "support-return.html",
    *(f"player-import-help.{locale}.html" for locale in ("en", "ko", "ja", "zh-Hans")),
}


def inventory(root):
    return {
        path.relative_to(root).as_posix(): {
            "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
        }
        for path in sorted(root.rglob("*"))
        if path.is_file()
        for raw in (path.read_bytes(),)
    }


def prepare(accepted, accepted_inventory, output):
    output = output.resolve()
    if output.exists():
        raise ValueError("Use a new fictional fixture output")
    accepted = accepted.resolve()
    if output.is_relative_to(accepted) or accepted.is_relative_to(output):
        raise ValueError("Never write inside the accepted release")
    expected = json.loads(accepted_inventory.read_text(encoding="utf-8-sig"))
    baseline = output / "baseline"
    original = output / "candidate-input"
    package = write_package(output / "package", grouped=True)
    build_lab(
        package, output / "browser", catalog_version="transition-fictional", player_maishift=True
    )
    build_public_release(output / "browser", original)
    baseline.mkdir()
    retained = {}
    for name in sorted(expected):
        if "/" in name and name != "lab/index.html":
            continue
        raw = (accepted / name).read_bytes()
        if hashlib.sha256(raw).hexdigest() != expected[name]:
            raise ValueError("Accepted fixture runtime hash mismatch: " + name)
        target = baseline / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
        retained[name] = expected[name]
    # Both actual runtime generations consume one authored corpus; no player data
    # or real-corpus copy is needed for this local transition characterization.
    shutil.copyfile(original / "manifest.json", baseline / "manifest.json")
    for name in DATA:
        if (original / name).is_dir():
            shutil.copytree(original / name, baseline / name)
    old, new = (
        inventory_from_records(inventory(baseline)),
        inventory_from_records(inventory(original)),
    )
    old_map = {file.path: file.fingerprint for file in old.files}
    new_map = {file.path: file.fingerprint for file in new.files}
    declared = {
        "scope": "authored_runtime_fixture_closures_not_observed_full_corpus",
        "retained_legacy_files": retained,
        "legacy_manifest": "replaced with identical fictional candidate catalog",
    }
    old_runtime = RuntimeClosure(
        digest({**declared, "runtime": "legacy"}),
        tuple(
            file
            for file in old.files
            if file.path.endswith((".js", ".css", ".svg", ".ico"))
            or file.path.split("/")[0] in DATA
        ),
    )
    new_runtime = RuntimeClosure(
        digest({**declared, "runtime": "modular"}),
        tuple(
            file
            for file in new.files
            if file.path.split("/")[0] in DATA | {"browser", "browser-resources"}
        ),
    )
    receipts = {}
    for target, folder in (("candidate", "promotion"), ("recovery", "recovery")):
        ownership = []
        for name in sorted(old_map.keys() | new_map.keys()):
            if name not in old_map:
                owner, reason = "candidate", "Candidate-only retained fixture path"
            elif name not in new_map:
                owner, reason = "baseline", "Legacy-only retained fixture path"
            elif old_map[name] == new_map[name]:
                owner, reason = "baseline", "Verified identical fixture bytes"
            elif name.endswith((".js", ".css", ".svg", ".ico")) and "/" not in name:
                owner, reason = "baseline", "Open legacy documents require exact root runtime bytes"
            elif name in DOCUMENTS:
                owner = "candidate" if target == "candidate" else "baseline"
                reason = "Explicit document/configuration ownership for this fixture target"
            else:
                raise ValueError("Unreviewed fixture collision: " + name)
            if name == "index.html":
                owner = "candidate" if target == "candidate" else "baseline"
            fingerprint = (old_map if owner == "baseline" else new_map)[name]
            ownership.append(PathOwnership(name, owner, fingerprint, reason))
        plan = plan_release_composition(
            old,
            new,
            target=target,
            ownership=tuple(ownership),
            baseline_runtime=old_runtime,
            candidate_runtime=new_runtime,
        )
        receipt = assemble_release(
            baseline,
            original,
            output / folder,
            plan=plan,
            baseline_runtime=old_runtime,
            candidate_runtime=new_runtime,
            receipt_path=output / "private" / (folder + ".json"),
        )
        receipts[folder] = {"files": len(receipt.files), "plan_sha256": receipt.plan_sha256}
    atomic_json(
        output / "fixture.json",
        {
            **declared,
            "artifacts": receipts,
            "limitations": [
                "Fictional same-corpus runtime comparison, not the complete production artifact",
                "Recovery retains candidate public routes; finite route recovery remains unproven",
                "Static test server does not apply Cloudflare headers, redirects or propagation",
            ],
        },
    )
    print(json.dumps({"output": str(output), "artifacts": receipts}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--accepted", required=True, type=Path)
    parser.add_argument("--accepted-inventory", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    arguments = parser.parse_args()
    prepare(arguments.accepted, arguments.accepted_inventory, arguments.output)
