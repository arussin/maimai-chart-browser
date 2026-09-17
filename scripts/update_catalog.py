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
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from maimai_analyzer.contracts import content_hash
from maimai_analyzer.dataset import SOURCE_LOCK
from maimai_intelligence.artwork import MEDIA_PATH
from maimai_intelligence.catalog_loading import MAX_CATALOG_BYTES
from maimai_intelligence.lab import build_lab
from maimai_intelligence.mai_notes import MAX_INDEX_BYTES, download_index, prepare_links
from maimai_intelligence.public_release import _read, build_public_release
from maimai_intelligence.research_package import extend_package, read_package
from maimai_intelligence.snapshots import MAX_BYTES, atomic_json, read_json

REPOSITORY = "arussin/maimai-chart-browser"
OWNER = "arussin"
ACCOUNT = "30f2b0382e0303b0f28cb2fe2e5c1320"
PROJECT = "maimai-party"
REPO_ROOT = Path(__file__).resolve().parents[1]


@contextmanager
def writer_lock(store):
    store = Path(store).resolve()
    store.mkdir(parents=True, exist_ok=True)
    lock = store / "writer.lock"
    try:
        stream = lock.open("x", encoding="utf-8")
    except FileExistsError as error:
        raise ValueError(
            "An update is running or was interrupted; inspect writer.lock first"
        ) from error
    try:
        with stream:
            stream.write(str(os.getpid()))
        yield
    finally:
        lock.unlink()


def implementation_hash(root=REPO_ROOT):
    root = Path(root)
    paths = sorted(
        p
        for area in ("src", "scripts", "registry")
        for p in (root / area).rglob("*")
        if p.is_file() and "__pycache__" not in p.parts and p.suffix != ".pyc"
    )
    return content_hash(
        {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    )


def file_inventory(root):
    root = Path(root).resolve()
    result = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink() or not path.resolve().is_relative_to(root):
            raise ValueError("Release files must not be links outside the candidate")
        if path.is_file():
            raw = path.read_bytes()
            result[path.relative_to(root).as_posix()] = {
                "bytes": len(raw),
                "sha256": hashlib.sha256(raw).hexdigest(),
            }
    return result


def retain_history(source, destination):
    """Copy only manifest-listed catalogs and validated media, never arbitrary preview files."""
    source, destination = Path(source).resolve(), Path(destination).resolve()
    manifest = read_json(source / "manifest.json")
    if manifest.get("schema_version") != "1.0.0":
        raise ValueError("Previous browser must be a retained lab build, not a deployment download")
    pending, versions, latest = {}, set(), None
    for entry in manifest["releases"]:
        sha, version = entry["sha256"], entry["version"]
        if not re.fullmatch(r"[0-9a-f]{64}", sha) or entry["path"] != f"catalogs/{sha}.json":
            raise ValueError("Invalid retained catalog path")
        if version in versions:
            raise ValueError("Duplicate retained catalog version")
        versions.add(version)
        raw = _read(source, entry["path"], MAX_CATALOG_BYTES)
        if hashlib.sha256(raw).hexdigest() != sha:
            raise ValueError("Retained catalog hash mismatch")
        data = json.loads(raw)
        if data.get("package", {}).get("status") != "research_preview":
            raise ValueError("Previous catalog is not a public research catalog")
        pending[entry["path"]] = raw
        if "integration" in entry:
            ref = entry["integration"]
            if (
                not re.fullmatch(r"[a-f0-9]{64}", ref.get("sha256", ""))
                or ref.get("path") != f"integration/{ref['sha256']}.json"
            ):
                raise ValueError("Invalid retained integration catalog reference")
            integration = _read(source, ref["path"], MAX_BYTES)
            if (
                len(integration) != ref.get("bytes")
                or hashlib.sha256(integration).hexdigest() != ref["sha256"]
            ):
                raise ValueError("Retained integration catalog hash mismatch")
            pending[ref["path"]] = integration
        if version == manifest["default"]:
            latest = data
        for path, record in data.get("artwork", {}).get("assets", {}).items():
            if not MEDIA_PATH.fullmatch(path) or path != f"media/{record['sha256']}.webp":
                raise ValueError("Invalid retained media path")
            raw = _read(source, path, 256 * 1024)
            if len(raw) != record["bytes"] or hashlib.sha256(raw).hexdigest() != record["sha256"]:
                raise ValueError("Retained media hash mismatch")
            pending[path] = raw
    if latest is None:
        raise ValueError("Previous browser has no default catalog")
    for name, raw in pending.items():
        path = destination / name
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("xb") as stream:
            stream.write(raw)
    atomic_json(destination / "manifest.json", manifest)
    return latest


def chart_changes(before, after):
    def index(charts):
        # The upstream input identity survives a changed chart body/hash.
        pairs = [(c.get("input_id", c["chart_id"]), c) for c in charts]
        if len(dict(pairs)) != len(pairs):
            raise ValueError("Duplicate input identity in change report")
        return dict(pairs)

    left, right = index(before), index(after)
    changed = []
    for key in sorted(left.keys() & right.keys()):
        fields = [
            k
            for k in ("source_hash", "title", "artist", "format", "difficulty", "level", "demand")
            if left[key].get(k) != right[key].get(k)
        ]
        if fields:
            changed.append({"input_id": key, "title": right[key]["title"], "fields": fields})

    def brief(keys, records):
        return [
            {"input_id": k, "title": records[k]["title"], "difficulty": records[k]["difficulty"]}
            for k in sorted(keys)
        ]

    return {
        "added": brief(right.keys() - left.keys(), right),
        "removed": brief(left.keys() - right.keys(), left),
        "changed": changed,
    }


def source_package(run, store, revision, artwork_cache, *, offline=False):
    # New upstream commits are an explicit reviewed source-pin change in code.
    if revision != SOURCE_LOCK["revision"]:
        raise ValueError(
            "Review and update SOURCE_LOCK before acquiring a different source revision"
        )
    from scripts.acquire_maichart_pack import capture
    from scripts.build_challenge_package import build
    from scripts.build_research_overview import build as build_overview
    from scripts.prepare_maichart_pack import prepare as extract
    from scripts.prepare_public_artwork import prepare as artwork

    capture_root = store / "sources" / revision
    capture(capture_root, revision, offline=offline)
    extract(capture_root)
    build(capture_root, run / "profiles", cache_directory=store / "cache" / "profiles")
    build_overview(
        capture_root,
        run / "profiles",
        run / "patterns",
        cache_directory=store / "cache" / "overview",
    )
    artwork(
        run / "patterns", run / "artwork", artwork_cache, offline=offline, refresh_metadata=True
    )
    return run / "artwork"


def prepare_update(
    store,
    previous_browser,
    *,
    package=None,
    revision=None,
    artwork_cache=None,
    mai_notes_snapshot=None,
    registry=None,
    overrides=None,
    offline=False,
    fetcher=download_index,
):
    store, previous_browser = Path(store).resolve(), Path(previous_browser).resolve()
    if (package is not None and revision is not None) or (
        package is None and revision is None and registry is None
    ):
        raise ValueError("Choose an accepted package or an explicit reviewed source revision")
    if revision is not None and artwork_cache is None:
        raise ValueError("Source updates require an artwork cache")
    if offline and mai_notes_snapshot is None and registry is None:
        raise ValueError("Offline preparation needs an explicit retained mai-notes snapshot")
    for value in (
        previous_browser,
        package,
        mai_notes_snapshot,
        registry,
        overrides,
        artwork_cache,
    ):
        if value is not None and (
            Path(value).resolve() == store or store.is_relative_to(Path(value).resolve())
        ):
            raise ValueError("Update store must not replace or sit inside an input directory")
    with writer_lock(store):
        run = store / "runs" / (datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ-") + uuid4().hex[:8])
        run.mkdir(parents=True)
        atomic_json(run / "state.json", {"status": "preparing"})
        try:
            before = retain_history(previous_browser, run / "browser")
            if package is None and revision is not None:
                package = source_package(run, store, revision, Path(artwork_cache), offline=offline)
            if registry is not None:
                from maimai_intelligence.registry import read_registry
                from maimai_intelligence.registry_catalog import build_registry_package

                accepted = read_registry(registry)
                regions = {
                    s.get("region")
                    for s in accepted["sources"].values()
                    if s.get("acquisition") == "complete_validated_capture"
                }
                if not {"JP", "INTL"} <= regions:
                    raise ValueError(
                        "Registry preparation requires complete accepted captures "
                        "for JP and International"
                    )
                prepared = build_registry_package(
                    accepted,
                    package,
                    run / "package",
                    published=before if revision is None else None,
                )
                descriptor, _ = read_package(run / "package")
                charts = prepared["catalog"]
                links = prepared.get("mai_notes", {"charts": {}})
                audit = {"counts": {"retained_accepted_links": len(links["charts"])}}
                atomic_json(
                    run / "registry-provenance.json",
                    {"registry": prepared["registry"], "sources": prepared["sources"]},
                )
                atomic_json(run / "mai-notes-audit.json", audit)
            else:
                from scripts.prepare_chart_constants import prepare as constants

                constants(package, run / "constants")
                descriptor, retained = read_package(run / "constants")
                charts = json.loads(retained["catalog.json"])
                captured_at = datetime.now(UTC).isoformat()
                if mai_notes_snapshot is None:
                    raw = fetcher()
                else:
                    with Path(mai_notes_snapshot).open("rb") as stream:
                        raw = stream.read(MAX_INDEX_BYTES + 1)
                    # A retained file is a replay, not a fresh network verification.
                    captured_at = datetime.fromtimestamp(
                        Path(mai_notes_snapshot).stat().st_mtime, UTC
                    ).isoformat()
                links, audit = prepare_links(
                    charts,
                    raw,
                    captured_at=captured_at,
                    overrides=json.loads(Path(overrides).read_bytes()) if overrides else (),
                )
                (run / "inputs").mkdir()
                (run / "inputs" / "mai-notes.json").write_bytes(raw)
                atomic_json(run / "mai-notes-audit.json", audit)
                extend_package(run / "constants", run / "package", {"mai-notes.json": links})
            version = (
                "research-"
                + hashlib.sha256((run / "package" / "package.json").read_bytes()).hexdigest()[:12]
            )
            build_lab(run / "package", run / "browser", catalog_version=version)
            release = build_public_release(run / "browser", run / "public")
            changes = chart_changes(before["catalog"], charts)
            old_links = before.get("mai_notes", {}).get("charts", {})
            if registry:
                aliases = prepared.get("legacy_ids", {})
                old_links = {aliases.get(cid, cid): row for cid, row in old_links.items()}
                from maimai_intelligence.official_inventory import coverage
                from maimai_intelligence.registry_catalog import coverage_report

                changes["registry"] = coverage(accepted) | coverage_report(prepared)
            changes["mai_notes"] = {
                **audit["counts"],
                "added": sorted(links["charts"].keys() - old_links.keys()),
                "removed": sorted(old_links.keys() - links["charts"].keys()),
                "changed": sorted(
                    cid
                    for cid in links["charts"].keys() & old_links.keys()
                    if any(
                        links["charts"][cid].get(field) != old_links[cid].get(field)
                        for field in ("id", "format", "difficulty", "available")
                    )
                ),
                "source_mode": "accepted_registry"
                if registry
                else "retained_snapshot"
                if mai_notes_snapshot
                else "downloaded",
            }
            atomic_json(run / "changes.json", changes)
            report = [
                "# Catalog update",
                "",
                f"Catalog: {version}",
                f"Charts: {len(charts):,}",
                "",
                f"Chart changes: {len(changes['added'])} added, "
                f"{len(changes['removed'])} removed, {len(changes['changed'])} changed.",
                f"mai-notes: {len(links['charts']):,} playable links.",
                f"Match coverage: {json.dumps(audit['counts'])}",
                "",
                "See changes.json and mai-notes-audit.json for changes and unresolved matches.",
                "Preview browser/ before publishing public/. Captures and audits stay private.",
                "",
            ]
            if registry:
                report += [
                    "## Persistent inventory",
                    "",
                    f"Prepared analysis: {changes['registry']['analysis_available']:,} charts. "
                    f"Metadata only: {changes['registry']['metadata_only']:,} charts.",
                    "Regional listing counts and capture provenance are in changes.json "
                    "and registry-provenance.json. Absence from a capture is not removal.",
                    "The integration asset retains Session Report's v1 profile contract. "
                    "Metadata-only charts do not receive fabricated measurements or hashes.",
                    "",
                ]
            (run / "report.md").write_text("\n".join(report), "utf-8")
            receipt = {
                "version": "catalog-update-1",
                "status": "ready",
                "catalog_version": version,
                "source": descriptor["source"],
                "base_catalog_version": read_json(previous_browser / "manifest.json")["default"],
                "implementation_hash": implementation_hash(),
                "release": release,
                "files": file_inventory(run / "public"),
            }
            atomic_json(run / "state.json", {"status": "ready"})
            # Last write is the sole marker that a complete candidate can be published.
            atomic_json(run / "ready.json", receipt)
            return run
        except Exception:
            atomic_json(run / "state.json", {"status": "failed"})
            raise


def verify_candidate(run):
    run = Path(run).resolve()
    receipt = read_json(run / "ready.json")
    if (
        receipt.get("version") != "catalog-update-1"
        or receipt.get("status") != "ready"
        or receipt.get("source") != SOURCE_LOCK
        or receipt.get("implementation_hash") != implementation_hash()
        or receipt.get("files") != file_inventory(run / "public")
    ):
        raise ValueError("Candidate changed or was prepared by different code; prepare it again")
    return receipt


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
        projects = json.loads(runner(prefix + ["pages", "project", "list", "--json"], env=env))
        project = next((p for p in projects if p.get("Project Name") == PROJECT), None)
        if project is None:
            raise ValueError("Existing maimai-party project is unavailable; do not create another")
        if project.get("Git Provider") != "No":
            raise ValueError("Official publication requires the existing Direct Upload project")
        live = json.loads(fetch_manifest("https://maimai.party/manifest.json"))
        if live.get("default") != receipt["base_catalog_version"]:
            raise ValueError("The live catalog changed since preparation; prepare against it again")
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


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser(
        "prepare", help="Prepare a candidate and change report without publishing"
    )
    prepare.add_argument("--store", type=Path, required=True)
    prepare.add_argument("--previous-browser", type=Path, required=True)
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
    publish = commands.add_parser("publish", help="Publish a reviewed candidate as the owner")
    publish.add_argument("run", type=Path)
    publish.add_argument("--gh", default="gh")
    publish.add_argument("--git", default="git")
    publish.add_argument("--node", default="node")
    publish.add_argument("--wrangler", default="node_modules/wrangler/bin/wrangler.js")
    args = vars(parser.parse_args(argv))
    action = args.pop("command")
    result = prepare_update(**args) if action == "prepare" else publish_update(**args)
    print(str(result) if isinstance(result, Path) else json.dumps(result))


if __name__ == "__main__":
    main()
