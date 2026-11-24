"""Assemble a maimai.party catalog (data) release from a ready ``update_catalog prepare`` run.

The November 22 historical candidate omitted two release inputs:

* the export-sized song artwork (``export_artwork_source``), which the score-export
  loader still references, and
* the Cloudflare Web Analytics allowance in the page policy (``preserve_web_analytics``).

The pipeline now carries both inputs. This tool accepts either generation, proves
that its re-plan differs only in those inputs, and lays the result over the previous
release. That overlay remains necessary: the pipeline does not retain every
unreferenced published path. Source/readiness and paid hosting gates still apply.

The release also retains a compact ``planner-input`` for the next interface release:
the planner's browser assets, default-catalog artwork and a one-entry research
manifest. Catalog/integration bytes come from the verified ``public`` tree when
that interface release is prepared; historical preview files are unnecessary.

It never uploads, deploys, changes an account or deletes anything. It refuses to write
into an existing release folder. Run with ``-B`` and ``PYTHONPATH=<repo>/src;<repo>``.
Receipts have no generation timestamp. Explicit candidate sitemap dates are reused.
"""

from __future__ import annotations

import argparse
import collections
import gzip
import json
import shutil
from pathlib import Path

from scripts import prepare_interface_release as tool
from scripts.prepare_interface_release import (
    FREE_RESERVE,
    IMMUTABLE,
    MAX_FILE,
    PAID_FILES,
    checked,
    encoded,
    fingerprint,
    raw_file,
    read,
    relative,
    require,
    save,
    sha,
)

DATA = tool.DATA
# The planner derives every document's policy from index.html, so the analytics
# allowance legitimately changes documents and nothing else.
DOCUMENT = (".html",)


def area(name):
    return name.split("/")[0] if "/" in name else "(root)"


def retain_planner_input(browser, target, document):
    """Retain the planner's read closure, without copying preview catalog history.

    Also usable for an older data release: decode its verified public default
    using the matching run's browser entry, then write to a fresh work folder.
    This does not modify the browser, public release or existing receipts.
    """
    from maimai_intelligence import public_release
    from maimai_intelligence.artwork import MEDIA_PATH

    browser, target = checked(browser), checked(target)
    require(not target.exists(), "Planner input already exists; never overwrite")
    manifest = read(browser / "manifest.json")
    require(manifest.get("schema_version") == "1.0.0", "Unexpected browser manifest")
    versions = [entry["version"] for entry in manifest["releases"]]
    require(len(versions) == len(set(versions)), "Duplicate browser catalog")
    require(manifest["default"] in versions, "Missing default browser catalog")
    entry = manifest["releases"][versions.index(manifest["default"])]
    document.require_binding(entry)
    # Validate ordinary paths before the planner's allowlisted reader opens them.
    tool.files(browser)
    assets = public_release._browser_assets(browser)
    assets["manifest.json"] = encoded({**manifest, "releases": [entry]}) + b"\n"
    for name, row in document.data.get("artwork", {}).get("assets", {}).items():
        require(
            MEDIA_PATH.fullmatch(name) and name == f"media/{row['sha256']}.webp",
            "Invalid planner artwork path",
        )
        raw = raw_file(browser / name, 256 * 1024)
        require(
            fingerprint(raw) == {"bytes": row["bytes"], "sha256": row["sha256"]},
            "Planner artwork integrity mismatch: " + name,
        )
        assets[name] = raw
    rows = {relative(name): fingerprint(raw) for name, raw in assets.items()}
    from maimai_intelligence.release_composition import inventory_from_records

    inventory_from_records(rows)
    tool.materialize(target, rows, assets, browser)
    tool.verify(target, rows)
    return {
        "files": len(rows),
        "bytes": sum(row["bytes"] for row in rows.values()),
        "inventory_sha256": sha(encoded(rows)),
        "catalog_version": entry["version"],
    }


def prepare(args):
    from maimai_intelligence import public_release
    from maimai_intelligence.catalog_document import decode_catalog_document
    from maimai_intelligence.export_artwork import (
        read_export_artwork_assets,
        read_export_artwork_manifest,
    )
    from maimai_intelligence.release_composition import inventory_from_records
    from maimai_intelligence.source_identity import source_implementation_hash

    base, release, run = checked(args.base_release), checked(args.release), checked(args.run)
    require(
        not release.exists(), "Release folder already exists; never overwrite or retry in place"
    )
    require(release.parent.is_dir(), "Release parent folder is missing")
    tool.bind_source(args.expected_commit)
    hosting = tool.hosting_check(args.hosting_check, args.base_deployment)
    prior, prior_inventory_sha, base_manifest = tool.baseline(base)
    live = tool.observed_manifest(args, hosting)
    require(
        live == raw_file(base / "public" / "manifest.json"),
        "The live site is not the release this candidate is built on",
    )

    # The candidate: ready, built on the live catalog, from exactly this source, bytes as recorded.
    ready = read(run / "ready.json", 64 * 1024**2)
    require(
        ready.get("status") == "ready" and read(run / "state.json") == {"status": "ready"},
        "Candidate is not ready",
    )
    require(
        ready["base_catalog_version"] == base_manifest["default"],
        "Candidate was not prepared on the live catalog",
    )
    require(
        ready["previous_public"]["inputs"]["files"]["manifest.json"] == fingerprint(live),
        "Candidate was prepared against a different published manifest",
    )
    require(
        source_implementation_hash(tool.SOURCE) == ready["implementation_hash"],
        "Source differs from the implementation that prepared the candidate",
    )
    candidate = tool.files(run / "public")
    require(
        set(candidate) == set(ready["files"]),
        "Candidate public file set differs from its readiness record",
    )
    candidate_rows = {}
    for name, path in candidate.items():
        candidate_rows[name] = fingerprint(raw_file(path))
        require(
            candidate_rows[name] == ready["files"][name],
            "Candidate bytes differ from the readiness record: " + name,
        )

    export_index = read_export_artwork_manifest()
    export_media = set(export_index["assets"])
    source = checked(args.export_artwork_source)
    for name in export_media:
        relative(name)
        require(
            checked(source / name).is_relative_to(source),
            "Export media escaped the explicit source",
        )
    read_export_artwork_assets(source, manifest=export_index)

    total = sum(row["bytes"] for row in prior.values()) + sum(
        row["bytes"] for row in candidate_rows.values()
    )
    require(
        shutil.disk_usage(release.parent).free >= FREE_RESERVE + total, "Not enough free disk space"
    )

    # Plan the same browser output again, adding only the two options the pipeline lacks.
    browser_manifest = read(run / "browser" / "manifest.json")
    version = browser_manifest["default"]
    require(
        version == ready["catalog_version"],
        "Candidate browser and readiness record name different catalogs",
    )
    candidate_manifest = read(run / "public" / "manifest.json")
    public_entry = next(
        entry for entry in candidate_manifest["releases"] if entry["version"] == version
    )
    browser_entry = next(
        entry for entry in browser_manifest["releases"] if entry["version"] == version
    )
    raw, integration = public_release.read_public_catalog_inputs(run / "public", public_entry)
    document = decode_catalog_document(browser_entry, raw, integration)
    plan = public_release.plan_public_release(
        run / "browser",
        previous_public=base / "public",
        prepared_catalogs={version: document},
        preserve_web_analytics=True,
        export_artwork_source=source,
        release_date=ready.get("release", {}).get("release_date"),
    )
    require(
        public_release._plain(plan.manifest) == candidate_manifest,
        "Replanned manifest differs from the candidate's",
    )
    planned = dict(plan.assets)
    planned["manifest.json"] = raw_file(run / "public" / "manifest.json")

    # Nothing but the page policy and the export artwork may differ from the pipeline's tree.
    # The policy lives in the shell, which is also stored under a name derived from its
    # bytes and listed in browser-resources.json, so exactly that copy is renamed.
    shell_copy = "browser-resources/" + sha(planned["browser-shell.html"]) + ".txt"
    old_shell_copy = (
        "browser-resources/" + sha(raw_file(run / "public" / "browser-shell.html")) + ".txt"
    )
    require(
        planned.get(shell_copy) == planned["browser-shell.html"]
        and old_shell_copy in candidate_rows,
        "Shell copies are not where the planner normally puts them",
    )
    require(
        set(candidate_rows) - set(planned)
        == ({old_shell_copy} if old_shell_copy != shell_copy else set()),
        "Replanning lost a candidate path",
    )
    added_media = set(planned) - set(candidate_rows) - {shell_copy}
    require(
        added_media <= export_media and all(name.startswith("media/") for name in added_media),
        "Replanning added something other than export artwork",
    )
    require(export_media <= set(planned), "Export artwork is incomplete in the plan")
    policy_documents = []
    for name, row in candidate_rows.items():
        if name == old_shell_copy or fingerprint(planned[name]) == row:
            continue
        require(
            name == "browser-resources.json"
            or name.endswith(DOCUMENT)
            and not name.startswith(DATA),
            "Unexpected difference from the candidate: " + name,
        )
        policy_documents.append(name)
    for name in ("index.html", "browser-shell.html"):
        require(
            b"static.cloudflareinsights.com" in planned[name],
            "Analytics allowance is missing from " + name,
        )

    # Lay the plan over the live release. Content-addressed paths can never change bytes.
    for name, body in planned.items():
        relative(name)
        if name in prior and name.startswith(IMMUTABLE):
            require(
                fingerprint(body) == prior[name], "Immutable published bytes would change: " + name
            )
    delta = {name: body for name, body in planned.items() if fingerprint(body) != prior.get(name)}
    rows = {**prior, **{name: fingerprint(body) for name, body in delta.items()}}
    inventory_from_records(rows)  # Strict path, case-alias, hash and directory validation.
    require(prior.keys() <= rows.keys(), "A previously published path would disappear")
    require(max(row["bytes"] for row in rows.values()) <= MAX_FILE, "Per-file Pages limit exceeded")
    require(len(rows) <= PAID_FILES, "Pages file limit for the paid plan exceeded")
    kept = sorted(set(prior) - set(planned))
    tool.bind_source(args.expected_commit)
    require(not release.exists(), "Release folder appeared during preparation")
    release.mkdir()
    planner_receipt = retain_planner_input(run / "browser", release / "planner-input", document)
    tool.materialize(release / "public", rows, delta, base / "public")
    tool.verify(release / "public", rows)
    inventory_raw = encoded(rows)
    with (release / "inventory.json.gz").open("xb") as stream:
        stream.write(gzip.compress(inventory_raw, mtime=0))
    added = sorted(name for name in delta if name not in prior)
    changed = sorted(name for name in delta if name in prior)
    receipt = {
        "schema": "maimai-data-release-1",
        "status": "complete_verified_not_deployed",
        "published": False,
        "root": str(release / "public"),
        "source": str(tool.SOURCE),
        "source_commit": args.expected_commit,
        "script_sha256": sha(raw_file(__file__)),
        "interface_tool_sha256": sha(raw_file(tool.__file__)),
        "candidate_run": str(run),
        "candidate_attempt_sha256": ready["attempt_sha256"],
        "implementation_hash": ready["implementation_hash"],
        "catalog_version": version,
        "base_catalog_version": base_manifest["default"],
        "base_release": str(base),
        "base_deployment": args.base_deployment,
        "base_inventory_sha256": prior_inventory_sha,
        "base_manifest_sha256": sha(live),
        "live_manifest_matched_base": getattr(args, "observed_manifest", None) is None,
        "saved_manifest_matched_base": getattr(args, "observed_manifest", None) is not None,
        "inventory_sha256": sha(inventory_raw),
        "files": len(rows),
        "bytes": sum(row["bytes"] for row in rows.values()),
        "changed_files": len(changed),
        "added_files": len(added),
        "removed_files": 0,
        "added_by_area": dict(collections.Counter(area(name) for name in added).most_common()),
        "changed_by_area": dict(collections.Counter(area(name) for name in changed).most_common()),
        "differences_from_pipeline_output": {
            "documents_and_resource_list_with_analytics_allowance": len(policy_documents),
            "shell_copy_renamed": {"from": old_shell_copy, "to": shell_copy},
            "export_artwork_added": len(added_media),
            "everything_else": "byte-identical",
        },
        "previous_paths_kept_beyond_plan": dict(
            collections.Counter(area(name) for name in kept).most_common()
        ),
        "all_previous_paths_retained": True,
        "limits": {
            "files": PAID_FILES,
            "file_bytes": MAX_FILE,
            "largest_file_bytes": max(row["bytes"] for row in rows.values()),
        },
        "hosting_check": hosting,
        "generated_plan_summary": public_release._plain(plan.summary),
        "export_artwork_source": str(source),
        "next_interface_release_input": str(release / "planner-input"),
        "planner_input": planner_receipt,
        "remaining_gates": ["preview upload and checks", "Adam's approval before production"],
    }
    save(release / "preparation.json", receipt)
    print(
        json.dumps(
            {
                key: receipt[key]
                for key in (
                    "status",
                    "catalog_version",
                    "files",
                    "bytes",
                    "changed_files",
                    "added_files",
                    "added_by_area",
                    "changed_by_area",
                    "differences_from_pipeline_output",
                    "previous_paths_kept_beyond_plan",
                    "inventory_sha256",
                )
            },
            indent=1,
        )
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        required=True,
        help="Clean checkout of the commit the candidate was prepared from",
    )
    parser.add_argument("--expected-commit", required=True)
    parser.add_argument("--run", type=Path, required=True, help="Ready update_catalog run folder")
    parser.add_argument(
        "--base-release", type=Path, required=True, help="Live release folder (public, inventory)"
    )
    parser.add_argument(
        "--base-deployment", required=True, help="Pages deployment id that is in production now"
    )
    parser.add_argument("--release", type=Path, required=True, help="Fresh folder for this release")
    parser.add_argument("--hosting-check", type=Path, required=True)
    parser.add_argument(
        "--observed-manifest", type=Path, help="Saved live manifest; no network read"
    )
    parser.add_argument("--export-artwork-source", type=Path, required=True)
    parser.add_argument("--git", default="git")
    args = parser.parse_args()
    tool.GIT, tool.SOURCE = args.git, checked(args.source)
    prepare(args)


if __name__ == "__main__":
    main()
