"""Offline owner release gates. Prints upload commands; never executes Wrangler.

Run with python -B -m scripts.release_driver. Preparation uses a JSON specification;
deployment observations and approval are supplied explicitly, never fetched.
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path
from uuid import UUID

from scripts import prepare_data_release as data
from scripts import prepare_interface_release as tool

PROJECT = "maimai-party"
SCHEMA = "maimai-release-driver-1"


def digest(path):
    return tool.sha(tool.raw_file(path, 256 * 1024**2))


def timestamp(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    tool.require(parsed.utcoffset() is not None, "An explicit timezone is required")
    return value


def upload_argv(release, state, stage):
    spec = state["spec"]
    return [
        spec["node"],
        spec["wrangler"],
        "pages",
        "deploy",
        str(release / "public"),
        "--project-name",
        PROJECT,
        "--branch",
        "main" if stage == "production" else spec["preview_branch"],
        "--commit-hash",
        spec["expected_commit"],
        "--commit-dirty=false",
        "--no-bundle",
    ]


def powershell(argv):
    return "& " + " ".join("'" + item.replace("'", "''") + "'" for item in argv)


def validate_spec(spec):
    common = {
        "kind",
        "source",
        "expected_commit",
        "base_release",
        "base_deployment",
        "release",
        "hosting_check",
        "observed_manifest",
        "node",
        "wrangler",
        "wrangler_sha256",
        "preview_branch",
    }
    kind = spec.get("kind")
    tool.require(kind in ("interface", "catalog"), "Expected interface or catalog release")
    required = common | (
        {"base_commit"} if kind == "interface" else {"run", "export_artwork_source"}
    )
    optional = (
        {
            "git",
            "export_artwork_source",
            "release_date",
            "allow_headers_change",
            "allow_invitation_change",
        }
        if kind == "interface"
        else {"git"}
    )
    tool.require(
        required <= spec.keys() <= required | optional, "Missing or unknown release inputs"
    )
    spec = dict(spec)
    for name in ("expected_commit", *(["base_commit"] if kind == "interface" else [])):
        tool.require(re.fullmatch(r"[0-9a-f]{40}", spec[name]), "Use a full commit SHA")
    UUID(spec["base_deployment"])
    tool.require(
        re.fullmatch(r"[a-z0-9][a-z0-9-]{0,62}", spec["preview_branch"])
        and spec["preview_branch"] != "main",
        "Preview branch must differ from main",
    )
    for name in ("allow_headers_change", "allow_invitation_change"):
        tool.require(type(spec.get(name, False)) is bool, "Opt-ins must be JSON booleans")
    for name in (
        "source",
        "base_release",
        "release",
        "hosting_check",
        "observed_manifest",
        "node",
        "wrangler",
        "run",
        "export_artwork_source",
    ):
        if name in spec:
            spec[name] = str(tool.checked(spec[name]))
    for name in ("hosting_check", "observed_manifest", "node", "wrangler"):
        tool.require(Path(spec[name]).is_file(), "Missing input: " + name)
    tool.require(digest(spec["wrangler"]) == spec["wrangler_sha256"], "Reviewed Wrangler changed")
    # Both owner tools import the library in this interpreter. Never silently use
    # a different checkout's installed library for the claimed source commit.
    import maimai_intelligence.public_release as library

    tool.require(
        Path(library.__file__).resolve()
        == Path(spec["source"]) / "src/maimai_intelligence/public_release.py",
        "Set PYTHONPATH to the release source's src directory and repository",
    )
    return spec


def summarize(base, release, prior, rows):
    changed = sorted(name for name in rows if name in prior and rows[name] != prior[name])
    added = sorted(rows.keys() - prior.keys())
    removed = sorted(prior.keys() - rows.keys())
    tool.require(not removed, "A previously published path would disappear")
    for name in rows.keys() & prior.keys():
        if name.startswith(tool.IMMUTABLE):
            tool.require(rows[name] == prior[name], "Immutable published bytes changed: " + name)
    old_headers = tool.raw_file(base / "public/_headers") if "_headers" in prior else b""
    new_headers = tool.raw_file(release / "public/_headers") if "_headers" in rows else b""
    dates = {}
    for name in sorted(rows):
        if name.startswith("sitemap") and name.endswith(".xml"):
            values = {}
            for label, root, inventory in (("previous", base, prior), ("candidate", release, rows)):
                counts = {}
                if name in inventory:
                    xml = ET.fromstring(tool.raw_file(root / "public" / name))  # noqa: S314
                    for entry in xml:
                        date = entry.findtext(
                            "{http://www.sitemaps.org/schemas/sitemap/0.9}lastmod"
                        )
                        counts[date or "undated"] = counts.get(date or "undated", 0) + 1
                values[label] = counts
            dates[name] = values
    return {
        "files": len(rows),
        "changed_files": changed,
        "added_files": added,
        "removed_files": removed,
        "changed_pages": [name for name in changed if name.endswith(".html")],
        "added_pages": [name for name in added if name.endswith(".html")],
        "headers_diff": "".join(
            difflib.unified_diff(
                old_headers.decode().splitlines(keepends=True),
                new_headers.decode().splitlines(keepends=True),
                fromfile="previous/_headers",
                tofile="candidate/_headers",
            )
        ),
        "sitemap_dates": dates,
    }


def prepare(spec_path):
    spec = validate_spec(tool.read(spec_path))
    release = Path(spec["release"])
    tool.require(not release.exists(), "Release already exists; use a fresh folder")
    args = argparse.Namespace(
        **{
            "export_artwork_source": None,
            "release_date": None,
            "allow_headers_change": False,
            "allow_invitation_change": False,
            **spec,
        }
    )
    tool.GIT, tool.SOURCE = spec.get("git", "git"), Path(spec["source"])
    (tool if spec["kind"] == "interface" else data).prepare(args)
    prior, _, _ = tool.baseline(Path(spec["base_release"]))
    rows, inventory_sha, _ = tool.baseline(release)
    receipt = tool.read(release / "preparation.json")
    tool.require(receipt["inventory_sha256"] == inventory_sha, "Preparation inventory mismatch")
    summary = summarize(Path(spec["base_release"]), release, prior, rows)
    tool.save(release / "review-summary.json", summary)
    state = {
        "schema": SCHEMA,
        "spec": spec,
        "preparation_sha256": digest(release / "preparation.json"),
        "summary_sha256": digest(release / "review-summary.json"),
        "inventory_sha256": inventory_sha,
        "node_sha256": digest(spec["node"]),
    }
    tool.save(release / "driver.json", state)
    print(
        json.dumps(
            {
                **{
                    key: len(summary[key])
                    for key in (
                        "changed_files",
                        "added_files",
                        "removed_files",
                        "changed_pages",
                        "added_pages",
                    )
                },
                "files": summary["files"],
                "headers_diff": summary["headers_diff"],
                "sitemap_dates": summary["sitemap_dates"],
                "file_lists": str(release / "review-summary.json"),
            },
            indent=2,
        )
    )
    print("Next: review these changes, then request upload-command --stage preview.")


def load(release):
    release = tool.checked(release)
    state = tool.read(release / "driver.json")
    tool.require(state.get("schema") == SCHEMA, "Unknown driver receipt")
    tool.require(state["spec"]["release"] == str(release), "Release moved; review its bindings")
    tool.require(
        digest(release / "preparation.json") == state["preparation_sha256"],
        "Preparation receipt changed",
    )
    tool.require(
        digest(release / "review-summary.json") == state["summary_sha256"], "Review summary changed"
    )
    rows, inventory_sha, manifest = tool.baseline(release)
    tool.require(inventory_sha == state["inventory_sha256"], "Release inventory changed")
    return release, state, rows, manifest


def uploader(state):
    spec = state["spec"]
    tool.require(digest(spec["wrangler"]) == spec["wrangler_sha256"], "Reviewed Wrangler changed")
    tool.require(digest(spec["node"]) == state["node_sha256"], "Reviewed Node changed")


def checked_checks(value, release, stage):
    tool.require(isinstance(value, dict) and value.get("passed") is True, "Checks did not pass")
    checks = value.get("checks")
    tool.require(isinstance(checks, dict) and bool(checks), "Describe the checks performed")
    tool.require(
        all(v is True or isinstance(v, str) and v.strip() for v in checks.values()),
        "Checks must have positive results, with failures resolved before recording",
    )
    expected = digest(release / "public/manifest.json")
    tool.require(value.get("manifest_sha256") == expected, "Deployment manifest check mismatch")
    if stage == "production":
        tool.require(value.get("live_manifest_sha256") == expected, "Live manifest check mismatch")
    return value


def preview_record(release, state):
    value = tool.read(release / "preview-upload.json")
    tool.require(
        value["preparation_sha256"] == state["preparation_sha256"], "Preview binding changed"
    )
    tool.require(
        value["command"] == upload_argv(release, state, "preview"), "Preview command changed"
    )
    checked_checks(value["checks"], release, "preview")
    return value


def validate_approval(value, state, preview):
    tool.require(
        value.get("approved_by") == "Adam"
        and value.get("approved") is True
        and isinstance(value.get("evidence"), str)
        and value["evidence"].strip(),
        "Record Adam's actual approval and its evidence",
    )
    tool.require(
        value.get("preparation_sha256") == state["preparation_sha256"]
        and value.get("preview_deployment") == preview["deployment_id"],
        "Approval must name this preparation and checked preview",
    )
    timestamp(value["approved_at"])
    tool.require(
        datetime.fromisoformat(value["approved_at"].replace("Z", "+00:00"))
        >= datetime.fromisoformat(preview["ran_at"].replace("Z", "+00:00")),
        "Approval predates the checked preview",
    )


def production_gate(release, state):
    preview = preview_record(release, state)
    gate = tool.read(release / "production-gate.json")
    validate_approval(gate["approval"], state, preview)
    tool.require(
        gate["command"] == upload_argv(release, state, "production")
        and gate["preview_sha256"] == digest(release / "preview-upload.json"),
        "Production gate changed",
    )
    return gate


def command(release, stage, approval=None):
    release, state, _, _ = load(release)
    uploader(state)
    tool.require(not (release / "deployment.json").exists(), "Production already recorded")
    if stage == "production":
        preview = preview_record(release, state)
        tool.require(approval is not None, "Production requires Adam's approval input")
        value = tool.read(approval)
        validate_approval(value, state, preview)
        gate = {
            "approval": value,
            "command": upload_argv(release, state, stage),
            "preview_sha256": digest(release / "preview-upload.json"),
        }
        path = release / "production-gate.json"
        if path.exists():
            tool.require(
                tool.read(path) == gate, "Production gate already records different inputs"
            )
        else:
            tool.save(path, gate)
    print(powershell(upload_argv(release, state, stage)))


def record(release, stage, deployment_id, checks_path, ran_at, released_by):
    release, state, rows, manifest = load(release)
    uploader(state)
    tool.require(str(UUID(deployment_id)) == deployment_id, "Use the full deployment UUID")
    timestamp(ran_at)
    tool.require(bool(released_by.strip()), "Name who ran the upload")
    checks = checked_checks(tool.read(checks_path), release, stage)
    command_args = upload_argv(release, state, stage)
    event = {
        "deployment_id": deployment_id,
        "ran_at": ran_at,
        "reported_by": released_by,
        "command": command_args,
        "checks": checks,
        "preparation_sha256": state["preparation_sha256"],
        "evidence_source": "owner-supplied; no hosting or uploader call by driver",
    }
    if stage == "preview":
        tool.require(
            not (release / "production-gate.json").exists(), "Production gate already exists"
        )
        tool.save(release / "preview-upload.json", event)
        return
    preview = preview_record(release, state)
    gate = production_gate(release, state)
    tool.require(
        deployment_id not in (preview["deployment_id"], state["spec"]["base_deployment"]),
        "Production must be a new deployment",
    )
    tool.require(
        datetime.fromisoformat(ran_at.replace("Z", "+00:00"))
        >= datetime.fromisoformat(gate["approval"]["approved_at"].replace("Z", "+00:00")),
        "Production upload predates approval",
    )
    spec = state["spec"]
    receipt = {
        "schema": "maimai-release-deployment-1",
        "released_at": ran_at,
        "released_by": released_by,
        "kind": spec["kind"] + " release",
        "source": {
            "repository": "arussin/maimai-chart-browser",
            "main_commit": spec["expected_commit"],
            "tested_commit": spec["expected_commit"],
        },
        "site": {
            "project": PROJECT,
            "production_deployment": deployment_id,
            "immutable_url": "https://" + deployment_id[:8] + ".maimai-party.pages.dev",
            "preview_deployment_url": "https://"
            + preview["deployment_id"][:8]
            + ".maimai-party.pages.dev",
            "rollback_deployment": spec["base_deployment"],
            "rollback_release": spec["base_release"],
            "files": len(rows),
            "manifest_sha256": digest(release / "public/manifest.json"),
            "catalog_default": manifest["default"],
            "uploader": powershell(command_args),
        },
        "changes": tool.read(release / "review-summary.json"),
        "checks_before_deployment": preview["checks"],
        "checks_after_deployment": checks,
        "approval": gate["approval"],
        "upload": event,
        "preparation_sha256": state["preparation_sha256"],
        "workers": "Not managed by this driver",
        "next_release_base": str(release),
    }
    if spec["kind"] == "catalog":
        receipt["catalog"] = {"version": manifest["default"], "update_run": spec["run"]}
    tool.save(release / "deployment.json", receipt)


def retention_extras(state):
    if state["spec"]["kind"] != "catalog":
        return []
    run = tool.checked(state["spec"]["run"])
    tool.files(run)  # Reject redirected paths before the archiver walks anything.
    for name in ("browser", "package", "registry", "ready.json", "state.json", "attempt.json"):
        tool.require((run / name).exists(), "Missing catalog retention input: " + name)
    return [
        str(path)
        for path in sorted(run.iterdir())
        if path.name not in {"public", ".wrangler", "cache", "node_modules"}
    ]


def retain(release, target, root):
    release, state, _, _ = load(release)
    production_gate(release, state)
    deployment = tool.read(release / "deployment.json")
    tool.require(
        deployment["preparation_sha256"] == state["preparation_sha256"],
        "Deployment binding changed",
    )
    checked_checks(deployment["checks_after_deployment"], release, "production")
    target, root = tool.checked(target), tool.checked(root)
    tool.require(
        not target.exists() and not Path(str(target) + ".partial").exists(),
        "Archive destination or partial already exists",
    )
    tool.require(not (release / "retention.json").exists(), "Retention already recorded")
    extras = retention_extras(state)
    for path in [release, *map(Path, extras)]:
        tool.require(path.is_relative_to(root) and path != root, "Retention input outside root")
        tool.require(not target.is_relative_to(path), "Archive must be outside retained inputs")
        tool.files(path) if path.is_dir() else tool.checked(path)
    script = Path(__file__).with_name("retain_release_state.py")
    result = subprocess.run(  # noqa: S603 -- fixed local Python script; never uploader
        [
            sys.executable,
            "-B",
            str(script),
            str(release),
            str(target),
            *extras,
            "--root",
            str(root),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    receipt = json.loads(result.stdout)
    tool.require(receipt["archive_sha256"] == file_digest(target), "Archive digest mismatch")
    tool.save(
        release / "retention.json",
        {**receipt, "extras": extras, "deployment_sha256": digest(release / "deployment.json")},
    )
    print(json.dumps(receipt, indent=2))


def file_digest(path):
    import hashlib

    value = hashlib.sha256()
    with tool.checked(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024**2), b""):
            value.update(block)
    return value.hexdigest()


def status(release):
    release = tool.checked(release)
    if not (release / "driver.json").exists():
        return {"next_gate": "prepare in a fresh folder", "complete": []}
    release, state, _, _ = load(release)
    done = ["prepare"]
    if not (release / "preview-upload.json").exists():
        return {"complete": done, "next_gate": "preview upload and checks"}
    preview_record(release, state)
    done.append("preview upload and checks")
    if not (release / "production-gate.json").exists():
        return {"complete": done, "next_gate": "Adam's production approval"}
    production_gate(release, state)
    done.append("production approval recorded")
    if not (release / "deployment.json").exists():
        return {"complete": done, "next_gate": "production upload and checks"}
    deployment = tool.read(release / "deployment.json")
    tool.require(
        deployment["preparation_sha256"] == state["preparation_sha256"], "Deployment changed"
    )
    checked_checks(deployment["checks_after_deployment"], release, "production")
    done.append("production recorded")
    if not (release / "retention.json").exists():
        return {"complete": done, "next_gate": "retain"}
    retained = tool.read(release / "retention.json")
    tool.require(
        retained["deployment_sha256"] == digest(release / "deployment.json"),
        "Retained deployment receipt changed",
    )
    tool.require(
        file_digest(retained["archive"]) == retained["archive_sha256"], "Retained archive changed"
    )
    done.append("retained archive verified")
    return {
        "complete": done,
        "next_gate": "update production record and WORKSPACE-RETENTION.md",
        "records": [
            "docs/OWNER_PUBLICATION.md (current production link)",
            r"C:\Dev\maimai\WORKSPACE-RETENTION.md",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("prepare").add_argument("--spec", type=Path, required=True)
    for name in ("upload-command", "record", "retain", "status"):
        item = sub.add_parser(name)
        item.add_argument("--release", type=Path, required=True)
        if name in ("upload-command", "record"):
            item.add_argument("--stage", choices=("preview", "production"), required=True)
        if name == "upload-command":
            item.add_argument("--approval", type=Path)
        if name == "record":
            for flag in ("deployment-id", "checks", "ran-at", "released-by"):
                item.add_argument("--" + flag, required=True)
        if name == "retain":
            item.add_argument("--target", type=Path, required=True)
            item.add_argument("--root", type=Path, required=True)
    args = vars(parser.parse_args())
    action = args.pop("action")
    if action == "prepare":
        prepare(args["spec"])
    elif action == "upload-command":
        command(**args)
    elif action == "record":
        args["checks_path"] = args.pop("checks")
        record(**args)
    elif action == "retain":
        retain(**args)
    else:
        print(json.dumps(status(**args), indent=2))


if __name__ == "__main__":
    main()
