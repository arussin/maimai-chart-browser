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

from maimai_intelligence.browser_bundle import validate_browser_resources
from maimai_intelligence.lab import build_browser
from maimai_intelligence.public_release import (
    assemble_release,
    plan_public_release,
    plan_release_composition,
    read_public_catalog_inputs,
)
from maimai_intelligence.release_composition import (
    PathOwnership,
    RecoveryOverlay,
    RuntimeClosure,
    artifact_inventory_sha256,
    inventory_from_records,
)
from maimai_intelligence.route_recovery import prepare_route_recovery
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
    browser = build_browser(
        package, output / "browser", catalog_version="transition-fictional", player_maishift=True
    )
    public = plan_public_release(
        browser.index.parent, prepared_catalogs={"transition-fictional": browser.catalog}
    )
    public.write_to(original)
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
    if public.prepared_seo is None:
        raise ValueError("The transition fixture requires prepared public routes")
    baseline_manifest = json.loads((baseline / "manifest.json").read_bytes())
    baseline_reference = next(
        entry
        for entry in baseline_manifest["releases"]
        if entry["version"] == baseline_manifest["default"]
    )
    baseline_catalog, baseline_integration = read_public_catalog_inputs(
        baseline, baseline_reference
    )
    recovered = prepare_route_recovery(
        public.prepared_seo,
        baseline_reference=baseline_reference,
        baseline_catalog=baseline_catalog,
        baseline_integration=baseline_integration,
        resources=validate_browser_resources(json.loads(public.assets["browser-resources.json"])),
        resource_assets=public.assets,
        candidate_inventory_sha256=artifact_inventory_sha256(new),
        baseline_inventory_sha256=artifact_inventory_sha256(old),
    )
    recovery = RecoveryOverlay(
        recovered.evidence_sha256,
        inventory_from_records(
            {
                name: {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
                for name, raw in recovered.assets.items()
            }
        ),
        recovered.candidate_inventory_sha256,
        recovered.baseline_inventory_sha256,
    )
    recovery_map = {file.path: file.fingerprint for file in recovery.inventory.files}
    source_maps = {"baseline": old_map, "candidate": new_map, "recovery": recovery_map}
    private = output / "private"
    private.mkdir()
    with (private / "route-recovery.json").open("xb") as stream:
        stream.write(recovered.evidence)
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
            if target == "recovery" and name in recovery_map:
                owner, reason = (
                    "recovery",
                    "Finite static recovery from verified prepared public route",
                )
            elif name not in old_map:
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
            fingerprint = source_maps[owner][name]
            ownership.append(PathOwnership(name, owner, fingerprint, reason))
        plan = plan_release_composition(
            old,
            new,
            target=target,
            ownership=tuple(ownership),
            baseline_runtime=old_runtime,
            candidate_runtime=new_runtime,
            recovery=recovery if target == "recovery" else None,
        )
        receipt = assemble_release(
            baseline,
            original,
            output / folder,
            plan=plan,
            baseline_runtime=old_runtime,
            candidate_runtime=new_runtime,
            receipt_path=output / "private" / (folder + ".json"),
            recovery_documents=recovered.assets if target == "recovery" else None,
            recovery_evidence_sha256=recovered.evidence_sha256 if target == "recovery" else None,
            recovery_candidate_inventory_sha256=recovered.candidate_inventory_sha256
            if target == "recovery"
            else None,
            recovery_baseline_inventory_sha256=recovered.baseline_inventory_sha256
            if target == "recovery"
            else None,
        )
        receipts[folder] = {"files": len(receipt.files), "plan_sha256": receipt.plan_sha256}
    atomic_json(
        output / "fixture.json",
        {
            **declared,
            "artifacts": receipts,
            "route_recovery": {
                "evidence_path": "private/route-recovery.json",
                "evidence_sha256": recovered.evidence_sha256,
                "candidate_inventory_sha256": recovered.candidate_inventory_sha256,
                "baseline_inventory_sha256": recovered.baseline_inventory_sha256,
                "documents": [
                    {
                        "path": document.path,
                        "filename": document.filename,
                        "sha256": document.sha256,
                    }
                    for document in recovered.documents
                ],
            },
            "limitations": [
                "Fictional same-corpus runtime comparison, not the complete production artifact",
                "Finite static route recovery requires browser and hosted acceptance",
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
