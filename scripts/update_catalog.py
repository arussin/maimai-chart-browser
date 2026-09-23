"""Owner-run catalog preparation and publication. Never runs on a schedule or PR.

prepare produces an immutable candidate, change report and checksummed receipt.
publish verifies that receipt and the owner's checked main branch before Direct Upload.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import urllib.request
from pathlib import Path

from maimai_intelligence import corpus_update
from maimai_intelligence.corpus_update import (
    chart_changes as chart_changes,
)
from maimai_intelligence.corpus_update import (
    file_inventory as file_inventory,
)
from maimai_intelligence.corpus_update import (
    previous_public_identity as previous_public_identity,
)
from maimai_intelligence.corpus_update import (
    published_public as published_public,
)
from maimai_intelligence.corpus_update import (
    retain_history as retain_history,
)
from maimai_intelligence.corpus_update import (
    retained_browser_features as retained_browser_features,
)
from maimai_intelligence.corpus_update import (
    source_package as source_package,
)
from maimai_intelligence.public_release import build_public_release as build_public_release
from maimai_intelligence.snapshots import atomic_json, read_json
from maimai_intelligence.source_identity import source_implementation_hash
from maimai_intelligence.store_lock import writer_lock as writer_lock

REPOSITORY = "arussin/maimai-chart-browser"
OWNER = "arussin"
ACCOUNT = "30f2b0382e0303b0f28cb2fe2e5c1320"
PROJECT = "maimai-party"
REPO_ROOT = Path(__file__).resolve().parents[1]


def implementation_hash(root=REPO_ROOT):
    return source_implementation_hash(Path(root))


def prepare_update(store, previous_browser, **options):
    """Owner defaults around the installed preparation service."""
    options.setdefault("registry_seed", REPO_ROOT / "registry")
    if options.get("coverage_reviews") is None:
        options["coverage_reviews"] = read_json(REPO_ROOT / "config/coverage-reviews.json")
    return corpus_update.prepare_update(
        store, previous_browser, implementation=implementation_hash, **options
    )


def verify_candidate(run):
    return corpus_update.verify_candidate(run, implementation=implementation_hash)


def command(args, *, cwd=REPO_ROOT, env=None):
    return subprocess.run(  # noqa: S603 -- argument arrays, no shell.
        args, cwd=cwd, env=env, check=True, capture_output=True, text=True, encoding="utf-8"
    ).stdout.strip()


def public_manifest(url):
    from maimai_intelligence.mai_notes import NoRedirect

    if not re.fullmatch(
        r"https://(?:maimai\.party|[0-9a-f]+\.maimai-party\.pages\.dev)/manifest.json", url
    ):
        raise ValueError("Unexpected publication verification URL")
    request = urllib.request.Request(  # noqa: S310 -- fixed official site/deployment allowlist.
        url, headers={"User-Agent": "maimai.party-owner-update/1", "Cache-Control": "no-cache"}
    )
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=30) as response:
        raw = response.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024:
        raise ValueError("Public manifest exceeds its size limit")
    return raw


def publish_update(
    run,
    *,
    gh="gh",
    git="git",
    node="node",
    wrangler="node_modules/wrangler/bin/wrangler.js",
    runner=command,
    fetch_manifest=public_manifest,
):
    run = Path(run).resolve()
    if run.parent.name != "runs":
        raise ValueError("Publish an update from its original store/runs directory")
    store = run.parent.parent
    with writer_lock(store):
        receipt = verify_candidate(run)
        if (run / "publication.json").exists():
            return read_json(run / "publication.json")
        if (run / "publish-attempt.json").exists():
            raise ValueError("An upload was attempted; inspect deployment history before retrying")
        git_command = [str(git), "-c", f"safe.directory={REPO_ROOT}"]
        if runner([str(gh), "api", "user", "--jq", ".login"]) != OWNER:
            raise ValueError("Only arussin may publish the official catalog")
        if runner(git_command + ["branch", "--show-current"]) != "main":
            raise ValueError("Publish only from the checked main branch")
        if runner(git_command + ["status", "--porcelain", "--untracked-files=normal"]):
            raise ValueError("Commit and check source changes before publication")
        head = runner(git_command + ["rev-parse", "HEAD"])
        remote = runner(
            [str(gh), "api", f"repos/{REPOSITORY}/branches/main", "--jq", ".commit.sha"]
        )
        if head != remote or not re.fullmatch(r"[0-9a-f]{40}", head):
            raise ValueError("Local source is not the repository's checked main commit")
        env = {**os.environ, "CLOUDFLARE_ACCOUNT_ID": ACCOUNT, "WRANGLER_SEND_METRICS": "false"}
        wrangler = str(Path(wrangler).resolve())
        prefix = [str(node), wrangler]
        capacity = receipt.get("release", {}).get("capacity", {})
        if capacity.get("profile") == "pages-paid-100000":
            if capacity.get("account_id") != ACCOUNT or capacity.get("project") != PROJECT:
                raise ValueError("Capacity review names a different publication target")
            version = runner(prefix + ["--version"], env=env)
            if not re.fullmatch(r"4\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?", version.strip()):
                raise ValueError("Reviewed paid capacity requires Wrangler major version 4")
            env["PAGES_WRANGLER_MAJOR_VERSION"] = "4"
        projects = json.loads(runner(prefix + ["pages", "project", "list", "--json"], env=env))
        project = next((p for p in projects if p.get("Project Name") == PROJECT), None)
        if project is None:
            raise ValueError("Existing maimai-party project is unavailable; do not create another")
        if project.get("Git Provider") != "No":
            raise ValueError("Official publication requires the existing Direct Upload project")
        live_raw = fetch_manifest("https://maimai.party/manifest.json")
        live = json.loads(live_raw)
        if live.get("default") != receipt["base_catalog_version"]:
            raise ValueError("The live catalog changed since preparation; prepare against it again")
        if live.get("releases") and receipt.get("previous_public", {}).get("inputs", {}).get(
            "files", {}
        ).get("manifest.json") != {
            "bytes": len(live_raw),
            "sha256": hashlib.sha256(live_raw).hexdigest(),
        }:
            raise ValueError("Candidate does not bind the live preceding publication")
        # Preserve an attempt marker even if the process/network dies after a successful upload.
        atomic_json(run / "publish-attempt.json", {"commit": head, "status": "started"})
        # Isolated cwd prevents an unrelated functions/ directory from joining this static upload.
        result = runner(
            prefix
            + [
                "pages",
                "deploy",
                str(run / "public"),
                "--project-name",
                PROJECT,
                "--branch",
                "main",
                "--commit-hash",
                head,
            ],
            cwd=run,
            env=env,
        )
        urls = re.findall(r"https://[0-9a-f]+\.maimai-party\.pages\.dev", result)
        if not urls:
            raise ValueError(
                "Upload result is uncertain; inspect deployment history before retrying"
            )
        for origin in (urls[-1], "https://maimai.party"):
            raw = fetch_manifest(origin + "/manifest.json")
            if hashlib.sha256(raw).hexdigest() != receipt["files"]["manifest.json"]["sha256"]:
                raise ValueError("Deployment verification is incomplete; inspect before retrying")
        publication = {
            "version": "catalog-publication-1",
            "catalog_version": receipt["catalog_version"],
            "commit": head,
            "deployment": urls[-1],
            "run": run.name,
            "manifest_sha256": receipt["files"]["manifest.json"]["sha256"],
        }
        atomic_json(run / "publication.json", publication)
        atomic_json(store / "latest.json", publication)
        return publication


def refresh_latest(
    store,
    *,
    offline=False,
    replay_sources=None,
    capacity_review=None,
    capacity_sha256=None,
    reassess_captured_policy=False,
    player_maishift=None,
):
    """Continue from the last verified publication, including its accepted registry."""
    store = Path(store).resolve()
    preceding_public = published_public(store)
    if preceding_public is None:
        raise ValueError("No verified current publication; use explicit preparation inputs")
    previous = preceding_public.parent
    registry = previous / "registry"
    receipt = read_json(previous / "ready.json")
    if "registry_files" in receipt:
        if receipt["registry_files"] != file_inventory(registry):
            raise ValueError("Published registry changed; restore the verified update state")
    elif not registry.is_dir():
        # First migration from the earlier updater's versioned accepted registry.
        registry = REPO_ROOT / "registry"
    return prepare_update(
        store,
        previous / "browser",
        previous_public=preceding_public,
        player_maishift=player_maishift,
        package=previous / "package",
        registry=registry,
        offline=offline,
        replay_sources=replay_sources,
        reassess_captured_policy=reassess_captured_policy,
        capacity_review=capacity_review,
        capacity_sha256=capacity_sha256,
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser(
        "prepare", help="Prepare a candidate and change report without publishing"
    )
    prepare.add_argument("--store", type=Path, required=True)
    prepare.add_argument("--previous-browser", type=Path, required=True)
    prepare.add_argument(
        "--previous-public",
        type=Path,
        help="Retain preceding public startup references and permalink identities exactly",
    )
    source = prepare.add_mutually_exclusive_group()
    source.add_argument("--package", type=Path, help="Reuse an accepted package without reanalysis")
    source.add_argument(
        "--revision", help="Acquire the reviewed SOURCE_LOCK commit and analyze changes"
    )
    prepare.add_argument("--artwork-cache", type=Path)
    prepare.add_argument("--mai-notes-snapshot", type=Path)
    prepare.add_argument(
        "--registry",
        type=Path,
        help="Use an accepted persistent inventory and optional retained enrichments",
    )
    prepare.add_argument("--overrides", type=Path)
    prepare.add_argument("--offline", action="store_true")
    prepare.add_argument(
        "--replay-sources", type=Path, help="Replay a retained source-captures.json offline"
    )
    refresh = commands.add_parser(
        "refresh", help="Refresh sources from the last verified publication"
    )
    refresh.add_argument("--store", type=Path, required=True)
    refresh.add_argument("--offline", action="store_true")
    refresh.add_argument("--replay-sources", type=Path)
    for action in (prepare, refresh):
        action.add_argument(
            "--player-maishift",
            action=argparse.BooleanOptionalAction,
            default=None,
            help="Override capability; otherwise preserve the preceding public configuration",
        )
        action.add_argument(
            "--reassess-captured-policy",
            action="store_true",
            help=(
                "Reassess retained source captures under the current policy; "
                "not an exact old-policy replay"
            ),
        )
        action.add_argument(
            "--capacity-review",
            type=Path,
            help="Private reviewed capacity evidence; default is 20,000 files",
        )
        action.add_argument(
            "--capacity-sha256", help="Explicitly reviewed SHA256 of the capacity review"
        )
    publish = commands.add_parser("publish", help="Publish a reviewed candidate as the owner")
    publish.add_argument("run", type=Path)
    publish.add_argument("--gh", default="gh")
    publish.add_argument("--git", default="git")
    publish.add_argument("--node", default="node")
    publish.add_argument("--wrangler", default="node_modules/wrangler/bin/wrangler.js")
    args = vars(parser.parse_args(argv))
    action = args.pop("command")
    result = {"prepare": prepare_update, "refresh": refresh_latest, "publish": publish_update}[
        action
    ](**args)
    print(str(result) if isinstance(result, Path) else json.dumps(result))


if __name__ == "__main__":
    main()
