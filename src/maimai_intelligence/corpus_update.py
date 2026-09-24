"""Installed corpus preparation and receipt verification; no publication authority."""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from importlib.resources import files
from importlib.resources.abc import Traversable
from pathlib import Path
from typing import Any, Literal, TypedDict
from uuid import uuid4

from maimai_analyzer.contracts import content_hash
from maimai_analyzer.dataset import SOURCE_LOCK

from .artwork import MEDIA_PATH
from .catalog_loading import MAX_CATALOG_BYTES
from .corpus_attempts import bind_attempt
from .corpus_diagnostics import Diagnostics
from .corpus_failures import CorpusInputError
from .corpus_policy import SourceSelection
from .lab import build_browser
from .mai_notes import MAX_INDEX_BYTES, download_index, prepare_links
from .public_release import _read, build_public_release
from .publication_capacity import ReviewedCapacity, read_capacity_review, stage_capacity_review
from .research_package import extend_package, read_package
from .snapshots import MAX_BYTES, atomic_json, read_json
from .store_lock import writer_lock


class FileRecord(TypedDict):
    bytes: int
    sha256: str


def implementation_hash() -> str:
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

    return content_hash(
        {name: inventory(files(name), "") for name in ("maimai_analyzer", "maimai_intelligence")}
    )


def file_inventory(root: Path | str) -> dict[str, FileRecord]:
    root = Path(root).resolve()
    result: dict[str, FileRecord] = {}
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


def published_public(store: Path | str) -> Path | None:
    """Resolve only a verified current publication; never guess from directory age."""
    store = Path(store)
    pointer = store / "latest.json"
    if not pointer.is_file():
        return None
    latest = read_json(pointer)
    name = latest.get("run", "")
    if not isinstance(name, str) or not re.fullmatch(r"[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}", name):
        raise ValueError("Invalid published run identity")
    previous = store / "runs" / name
    if read_json(previous / "publication.json") != latest:
        raise ValueError("Latest update is not a verified publication")
    receipt = read_json(previous / "ready.json")
    if receipt.get("files") != file_inventory(previous / "public"):
        raise ValueError("Published public files changed; restore the verified update state")
    return previous / "public"


def retained_browser_features(root: Path | str) -> dict[str, bool]:
    """Read retained capabilities without executing historical browser scripts."""
    root = Path(root)
    config = root / "browser-config.json"
    if config.is_file():
        features = read_json(config).get("features")
        if (
            not isinstance(features, dict)
            or set(features) != {"maishift"}
            or type(features["maishift"]) is not bool
        ):
            raise ValueError("Invalid retained browser capability configuration")
        return features
    legacy = root / "player-import-config.js"
    if legacy.is_file():
        text = legacy.read_text("utf-8")
        text = re.sub(r"/\*.*?\*/", "", text, flags=re.S).strip()
        match = re.fullmatch(
            r"globalThis\.maimaiPlayerFeatures\s*\|\|=\s*Object\.freeze\(\{maishift:(true|false)\}\);",
            text,
        )
        if match is None:
            raise ValueError("Unknown retained browser capability adapter")
        return {"maishift": match[1] == "true"}
    return {"maishift": False}


def previous_public_identity(root: Path | str | None) -> dict[str, Any] | None:
    """Bind immutable publication inputs separately from regenerated browser files."""
    if root is None:
        return None
    root = Path(root)
    files = {}
    for name in (
        "manifest.json",
        "permalinks.json",
        "browser-config.json",
        "player-import-config.js",
    ):
        if name != "manifest.json" and not (root / name).is_file():
            continue
        raw = _read(root, name, 2 * 1024 * 1024)
        files[name] = {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
    return {"version": "previous-public-inputs-1", "files": files}


def retain_history(source: Path | str, destination: Path | str) -> dict[str, Any]:
    """Copy only manifest-listed catalogs and validated media, never arbitrary preview files."""
    source, destination = Path(source).resolve(), Path(destination).resolve()
    manifest = read_json(source / "manifest.json")
    if manifest.get("schema_version") != "1.0.0":
        raise ValueError("Previous browser must be a retained lab build, not a deployment download")
    pending: dict[str, bytes] = {}
    versions: set[str] = set()
    latest: dict[str, Any] | None = None
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
        if not isinstance(data, dict):
            raise ValueError("Retained catalog must be an object")
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


def chart_changes(before: list[dict[str, Any]], after: list[dict[str, Any]]) -> dict[str, Any]:
    def index(charts: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
        pairs = [
            (c["chart_id"] if "capabilities" in c else c.get("input_id", c["chart_id"]), c)
            for c in charts
        ]
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

    def brief(keys: Iterable[str], records: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
        return [
            {"input_id": k, "title": records[k]["title"], "difficulty": records[k]["difficulty"]}
            for k in sorted(keys)
        ]

    return {
        "added": brief(right.keys() - left.keys(), right),
        "removed": brief(left.keys() - right.keys(), left),
        "changed": changed,
    }


def source_package(
    run: Path, store: Path, revision: str, artwork_cache: Path | str, *, offline: bool = False
) -> Path:
    if revision != SOURCE_LOCK["revision"]:
        raise ValueError(
            "Review and update SOURCE_LOCK before acquiring a different source revision"
        )
    from .source_preparation.acquire_maichart_pack import capture
    from .source_preparation.build_challenge_package import build
    from .source_preparation.build_research_overview import build as build_overview
    from .source_preparation.prepare_maichart_pack import prepare as extract

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
    # Song artwork is prepared once by the shared accepted-registry coverage stage.
    return run / "patterns"


@dataclass(frozen=True)
class RetainedPublic:
    previous_public: Path | None
    previous_identity: dict[str, Any] | None
    features: dict[str, bool]
    before: dict[str, Any]


@dataclass(frozen=True)
class PreparedCorpus:
    descriptor: dict[str, Any]
    charts: list[dict[str, Any]]
    links: dict[str, Any]
    audit: dict[str, Any]
    accepted: dict[str, Any] | None = None
    prepared: dict[str, Any] | None = None
    coverage_audit: dict[str, Any] | None = None
    source_audit: dict[str, Any] | None = None
    additions: dict[str, Any] | None = None
    source_mode: Literal["accepted_registry", "retained_snapshot", "downloaded"] = (
        "accepted_registry"
    )


@dataclass(frozen=True)
class RenderedCandidate:
    version: str
    release: dict[str, Any]


def prepare_update(
    store: Path | str,
    previous_browser: Path | str,
    *,
    package: Path | str | None = None,
    revision: str | None = None,
    artwork_cache: Path | str | None = None,
    mai_notes_snapshot: Path | str | None = None,
    registry: Path | str | None = None,
    overrides: Path | str | None = None,
    offline: bool = False,
    fetcher: Callable[[], bytes] = download_index,
    replay_sources: Path | str | None = None,
    source_fetcher: Callable[[str, dict[str, str]], tuple[int, bytes, dict[str, str]]]
    | None = None,
    coverage_reviews: dict[str, Any] | None = None,
    reassess_captured_policy: bool = False,
    previous_public: Path | str | None = None,
    capacity_review: Path | str | None = None,
    capacity_sha256: str | None = None,
    player_maishift: bool | None = None,
    implementation: Callable[[], str] | None = None,
    registry_seed: Path | str | None = None,
    predecessor: dict[str, str] | None = None,
) -> Path:
    implementation = implementation or implementation_hash
    if player_maishift is not None and type(player_maishift) is not bool:
        raise CorpusInputError("Maishift capability must be an explicit boolean")
    if (capacity_review is None) != (capacity_sha256 is None):
        raise CorpusInputError(
            "Capacity review and its explicitly reviewed SHA256 are required together"
        )
    store, previous_browser = Path(store).resolve(), Path(previous_browser).resolve()
    previous_public = Path(previous_public).resolve() if previous_public is not None else None
    SourceSelection(
        package is not None,
        revision is not None,
        registry is not None,
        offline,
        replay_sources is not None,
        artwork_cache is not None,
        mai_notes_snapshot is not None,
    ).validate()
    for value in (
        previous_browser,
        previous_public,
        package,
        mai_notes_snapshot,
        registry,
        overrides,
        artwork_cache,
    ):
        if value is not None and (
            Path(value).resolve() == store or store.is_relative_to(Path(value).resolve())
        ):
            raise CorpusInputError("Update store must not replace or sit inside an input directory")
    with writer_lock(store):
        run = store / "runs" / (datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ-") + uuid4().hex[:8])
        run.mkdir(parents=True)
        atomic_json(run / "state.json", {"status": "preparing"})
        diagnostics = Diagnostics(run)
        try:
            with diagnostics.stage("inputs") as counts:
                capacity = (
                    stage_capacity_review(capacity_review, capacity_sha256, run / "capacity")
                    if capacity_review is not None
                    else None
                )
                retained = _retain_public_inputs(
                    store, previous_browser, previous_public, replay_sources, player_maishift, run
                )
                if registry is None and not offline:
                    from maimai_intelligence.registry import read_registry

                    seed = registry_seed
                    if seed is None:
                        raise ValueError(
                            "Online preparation requires an explicit accepted registry"
                        )
                    accepted_seed = read_registry(seed)
                    known = set(accepted_seed["charts"])
                    known.update(
                        old for entries in accepted_seed["legacy-ids"].values() for old in entries
                    )
                    if not all(chart["chart_id"] in known for chart in retained.before["catalog"]):
                        raise ValueError(
                            "Online legacy preparation requires an explicit registry "
                            "bound to its identities"
                        )
                    registry = seed
                attempt = bind_attempt(
                    run,
                    {
                        "previous_browser": previous_browser,
                        "previous_public": retained.previous_public,
                        "package": package,
                        "revision": revision,
                        "registry": registry,
                        "artwork_cache": artwork_cache,
                        "mai_notes_snapshot": mai_notes_snapshot,
                        "overrides": overrides,
                        "offline": offline,
                        "coverage_reviews": coverage_reviews,
                        "reassess_captured_policy": reassess_captured_policy,
                        "replay_sources": replay_sources,
                        "capacity_review": capacity_review,
                        "capacity_sha256": capacity_sha256,
                        "player_maishift": player_maishift,
                    },
                    implementation(),
                    predecessor,
                )
            with diagnostics.stage("source_capture") as counts:
                if package is None and revision is not None:
                    assert artwork_cache is not None
                    package = source_package(
                        run, store, revision, Path(artwork_cache), offline=offline
                    )
            with diagnostics.stage("corpus") as counts:
                if registry is not None:
                    corpus = _prepare_registry(
                        registry,
                        retained.before,
                        store,
                        run,
                        package,
                        previous_browser,
                        revision,
                        offline,
                        replay_sources,
                        source_fetcher,
                        coverage_reviews,
                        reassess_captured_policy,
                    )
                else:
                    assert package is not None
                    corpus = _prepare_legacy(
                        package,
                        run,
                        mai_notes_snapshot,
                        fetcher,
                        overrides,
                        captured_at=attempt["body"]["observations"]
                        .get("mai_notes_snapshot", {})
                        .get("captured_at"),
                    )
                counts.records = len(corpus.charts)
                counts.evidence = (
                    ["coverage-audit.json", "registry-provenance.json"]
                    if registry
                    else ["mai-notes-audit.json"]
                )
            with diagnostics.stage("render") as counts:
                rendered = _render_artifacts(run, retained, capacity)
            with diagnostics.stage("review") as counts:
                _describe_changes(run, retained.before, corpus, rendered.version)
                counts.evidence = ["changes.json", "report.md"]
            with diagnostics.stage("receipt") as counts:
                receipt = _ready_receipt(
                    run,
                    corpus.descriptor,
                    rendered.version,
                    previous_browser,
                    retained.features,
                    rendered.release,
                    retained.previous_identity,
                    registry,
                    implementation,
                )
                receipt["attempt_sha256"] = attempt["sha256"]
            atomic_json(run / "state.json", {"status": "ready"})
            # Commit only after every required stage and diagnostic write has succeeded.
            atomic_json(run / "ready.json", receipt)
            return run
        except BaseException as primary:
            try:
                atomic_json(run / "state.json", {"status": "failed"})
            except BaseException:
                BaseException.add_note(primary, "corpus.failure_state_record_failed")
            raise


def _retain_public_inputs(
    store: Path,
    previous_browser: Path,
    previous_public: Path | None,
    replay_sources: Path | str | None,
    player_maishift: bool | None,
    run: Path,
) -> RetainedPublic:
    current_public = published_public(store)
    if previous_public is None:
        previous_public = current_public
        if previous_public is None and any((store / "runs").glob("*/publication.json")):
            raise ValueError("A preceding publication exists; supply --previous-public")
    previous_identity = previous_public_identity(previous_public)
    if current_public is not None and previous_identity != previous_public_identity(current_public):
        raise ValueError("Preparation does not bind the current preceding publication")
    if replay_sources:
        prior = Path(replay_sources).parent / "previous-public.json"
        if (read_json(prior) if prior.is_file() else None) != previous_identity:
            raise ValueError("Source replay preceding public inputs differ")
    if previous_identity is not None:
        atomic_json(run / "previous-public.json", previous_identity)
    features = retained_browser_features(previous_public or previous_browser)
    if player_maishift is not None:
        features = {"maishift": player_maishift}
    if replay_sources:
        prior_ready = Path(replay_sources).parent / "ready.json"
        if (
            prior_ready.is_file()
            and read_json(prior_ready).get("browser_features", features) != features
        ):
            raise ValueError("Source replay browser capabilities differ")
    before = retain_history(previous_browser, run / "browser")
    return RetainedPublic(previous_public, previous_identity, features, before)


def _prepare_registry(
    registry: Path | str,
    before: dict[str, Any],
    store: Path,
    run: Path,
    package: Path | str | None,
    previous_browser: Path | str,
    revision: str | None,
    offline: bool,
    replay_sources: Path | str | None,
    source_fetcher: Callable[[str, dict[str, str]], tuple[int, bytes, dict[str, str]]] | None,
    coverage_reviews: dict[str, Any] | None,
    reassess_captured_policy: bool,
) -> PreparedCorpus:
    source_audit = None
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
            "Registry preparation requires complete accepted captures for JP and International"
        )
    additions = None
    from maimai_intelligence.catalog_capture import CaptureStore, fetch_public
    from maimai_intelligence.coverage import prepare_coverage

    shared_capture = CaptureStore(
        store / "cache" / "waterfall" / "sources",
        offline=offline,
        replay=replay_sources,
        fetcher=source_fetcher if source_fetcher is not None else fetch_public,
    )
    if not offline or replay_sources:
        from maimai_intelligence.catalog_refresh import refresh

        accepted, additions, source_audit = refresh(
            accepted,
            before,
            store / "cache" / "waterfall",
            run,
            offline=offline,
            replay=replay_sources,
            fetcher=source_fetcher,
            capture_store=shared_capture,
            write_candidate=False,
        )
    reviews = coverage_reviews if coverage_reviews is not None else {}
    from maimai_intelligence.coverage import CONFIG as COVERAGE_CONFIG
    from maimai_intelligence.coverage_store import (
        checkpoint_work,
        commit_checkpoint,
        policy_identity,
        replay_checkpoint_start,
        restore_checkpoint,
    )

    coverage_root = store / "cache" / "coverage"
    coverage_base = accepted
    coverage_policy = policy_identity(COVERAGE_CONFIG, reviews)
    coverage_parent = None
    coverage_work = None
    if replay_sources:
        accepted = replay_checkpoint_start(coverage_root, accepted, replay_sources)
        if reassess_captured_policy:
            # Verify the store's current checkpoint for ancestry, not as recomputed output.
            _, coverage_parent = restore_checkpoint(coverage_root, coverage_base, coverage_policy)
    else:
        accepted, coverage_parent = restore_checkpoint(coverage_root, accepted, coverage_policy)
        if coverage_parent:
            coverage_work = checkpoint_work(coverage_root, coverage_parent)
    accepted, coverage_audit = prepare_coverage(
        accepted,
        before,
        shared_capture,
        store / "cache" / "coverage",
        run,
        roots=(previous_browser, package),
        offline=offline,
        replay=replay_sources,
        title_reviews=reviews.get("titles", ()),
        provider_reviews=reviews.get("providers", ()),
        artwork_reviews=reviews.get("artwork", ()),
        work=coverage_work,
        reassess_policy=reassess_captured_policy,
    )
    from maimai_intelligence.registry import write_registry

    write_registry(accepted, run / "registry")
    atomic_json(run / "source-captures.json", shared_capture.receipt())
    if (not offline and not replay_sources) or reassess_captured_policy:
        checkpoint = commit_checkpoint(
            coverage_root,
            coverage_base,
            accepted,
            run,
            coverage_policy,
            predecessor=coverage_parent,
        )
        atomic_json(run / "coverage-checkpoint.json", checkpoint)
    from maimai_intelligence.multilingual_search import enrich_registry

    # Search aids belong to the projection and its retained report;
    # the accepted identity registry remains exactly as reconciled.
    accepted, search_aliases = enrich_registry(accepted)
    atomic_json(run / "multilingual-search.json", search_aliases)
    prepared = build_registry_package(
        accepted,
        package,
        run / "package",
        published=before if revision is None else None,
        additions=additions,
        artwork_source=store / "cache" / "coverage",
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
    return PreparedCorpus(
        descriptor,
        charts,
        links,
        audit,
        accepted,
        prepared,
        coverage_audit,
        source_audit,
        additions,
    )


def _prepare_legacy(
    package: Path | str,
    run: Path,
    mai_notes_snapshot: Path | str | None,
    fetcher: Callable[[], bytes],
    overrides: Path | str | None,
    *,
    captured_at: str | None = None,
) -> PreparedCorpus:
    from .source_preparation.prepare_chart_constants import prepare as constants

    constants(package, run / "constants")
    descriptor, retained = read_package(run / "constants")
    charts = json.loads(retained["catalog.json"])
    if mai_notes_snapshot is None:
        raw = fetcher()
        captured_at = datetime.now(UTC).isoformat()
    else:
        with Path(mai_notes_snapshot).open("rb") as stream:
            raw = stream.read(MAX_INDEX_BYTES + 1)
        if captured_at is None:
            raise ValueError("Retained mai-notes input requires bound capture metadata")
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
    return PreparedCorpus(
        descriptor,
        charts,
        links,
        audit,
        source_mode="retained_snapshot" if mai_notes_snapshot else "downloaded",
    )


def _render_artifacts(
    run: Path, retained: RetainedPublic, capacity: ReviewedCapacity | None
) -> RenderedCandidate:
    features, previous_public, previous_identity = (
        retained.features,
        retained.previous_public,
        retained.previous_identity,
    )
    version = (
        "research-"
        + hashlib.sha256((run / "package" / "package.json").read_bytes()).hexdigest()[:12]
    )
    browser = build_browser(
        run / "package",
        run / "browser",
        catalog_version=version,
        player_maishift=features["maishift"],
    )
    release = build_public_release(
        run / "browser",
        run / "public",
        previous_public=previous_public,
        capacity=capacity,
        prepared_catalogs={version: browser.catalog},
    )
    if previous_public_identity(previous_public) != previous_identity:
        raise ValueError("Preceding public inputs changed during preparation")
    return RenderedCandidate(version, release)


def _describe_changes(
    run: Path, before: dict[str, Any], corpus: PreparedCorpus, version: str
) -> dict[str, Any]:
    charts, links, audit = corpus.charts, corpus.links, corpus.audit
    accepted, prepared, coverage_audit, source_audit, additions = (
        corpus.accepted,
        corpus.prepared,
        corpus.coverage_audit,
        corpus.source_audit,
        corpus.additions,
    )
    registry = accepted is not None
    changes = chart_changes(before["catalog"], charts)
    old_links = before.get("mai_notes", {}).get("charts", {})
    if registry:
        assert accepted is not None and prepared is not None and coverage_audit is not None
        aliases = prepared.get("legacy_ids", {})
        old_links = {aliases.get(cid, cid): row for cid, row in old_links.items()}
        from maimai_intelligence.official_inventory import coverage
        from maimai_intelligence.registry_catalog import coverage_report

        changes["registry"] = coverage(accepted) | coverage_report(prepared)
        changes["coverage"] = coverage_audit
        if additions is not None:
            assert source_audit is not None
            changes["sources"] = source_audit["counts"]
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
        "source_mode": corpus.source_mode,
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
    if registry and additions is not None:
        assert source_audit is not None
        report += [
            "## Automatic source refresh",
            "",
            "Metadata observations added: " + str(source_audit["metadata"]["observations_added"]),
            "Transcription outcomes: " + json.dumps(source_audit["counts"]),
            "Charts with remaining numeric gaps: "
            + str(len(source_audit["metadata"]["remaining"])),
            "Provider failures: " + str(len(source_audit["failures"])),
            "See source-audit.json for failures, held changes and unresolved charts.",
            "source-captures.json pins inputs; registry/ is the next accepted state.",
            "",
        ]
    (run / "report.md").write_text("\n".join(report), "utf-8")
    return changes


def _ready_receipt(
    run: Path,
    descriptor: dict[str, Any],
    version: str,
    previous_browser: Path,
    features: dict[str, bool],
    release: dict[str, Any],
    previous_identity: dict[str, Any] | None,
    registry: Path | str | None,
    implementation: Callable[[], str],
) -> dict[str, Any]:
    receipt = {
        "version": "catalog-update-1",
        "status": "ready",
        "catalog_version": version,
        "source": descriptor["source"],
        "base_catalog_version": read_json(previous_browser / "manifest.json")["default"],
        "implementation_hash": implementation(),
        "browser_features": features,
        "release": release,
        "files": file_inventory(run / "public"),
        **(
            {
                "previous_public": {
                    "inputs": previous_identity,
                    "historical_references_verified": True,
                }
            }
            if previous_identity is not None
            else {}
        ),
        **(
            {
                "registry_files": file_inventory(run / "registry"),
                "coverage_files": {
                    name: {
                        "bytes": (run / name).stat().st_size,
                        "sha256": hashlib.sha256((run / name).read_bytes()).hexdigest(),
                    }
                    for name in (
                        "coverage-inputs.json",
                        "coverage-start.json",
                        "coverage-state.json",
                        "coverage-audit.json",
                        "source-captures.json",
                        *(
                            ("coverage-checkpoint.json",)
                            if (run / "coverage-checkpoint.json").is_file()
                            else ()
                        ),
                    )
                },
            }
            if registry
            else {}
        ),
    }
    return receipt


def verify_candidate(
    run: Path | str,
    *,
    implementation: Callable[[], str] | None = None,
    input_locations: dict[str, Path | str] | None = None,
) -> dict[str, Any]:
    implementation = implementation or implementation_hash
    run = Path(run).resolve()
    receipt = read_json(run / "ready.json")
    if (
        receipt.get("version") != "catalog-update-1"
        or receipt.get("status") != "ready"
        or receipt.get("source") != SOURCE_LOCK
        or receipt.get("implementation_hash") != implementation()
        or receipt.get("files") != file_inventory(run / "public")
        or (
            "registry_files" in receipt
            and receipt["registry_files"] != file_inventory(run / "registry")
        )
    ):
        raise ValueError("Candidate changed or was prepared by different code; prepare it again")
    if "attempt_sha256" in receipt:
        from .corpus_attempts import verify_attempt

        verify_attempt(run, implementation(), input_locations=input_locations)
    preceding_public = published_public(run.parent.parent)
    if preceding_public is not None and preceding_public.parent != run:
        if receipt.get("previous_public", {}).get("inputs") != previous_public_identity(
            preceding_public
        ):
            raise ValueError("Candidate does not bind the preceding publication")
    elif (
        preceding_public is None
        and "previous_public" not in receipt
        and any(path.parent != run for path in run.parent.glob("*/publication.json"))
    ):
        raise ValueError("Candidate does not bind the preceding publication")
    if "previous_public" in receipt:
        preceding = receipt["previous_public"]
        if (
            preceding.get("historical_references_verified") is not True
            or not (run / "previous-public.json").is_file()
            or read_json(run / "previous-public.json") != preceding.get("inputs")
        ):
            raise ValueError("Candidate preceding public inputs changed")
    for name, record in receipt.get("coverage_files", {}).items():
        if Path(name).name != name or not (run / name).is_file():
            raise ValueError("Candidate coverage inputs changed")
        raw = (run / name).read_bytes()
        if len(raw) != record["bytes"] or hashlib.sha256(raw).hexdigest() != record["sha256"]:
            raise ValueError("Candidate coverage inputs changed")
    capacity = receipt.get("release", {}).get("capacity", {})
    if capacity.get("profile") == "pages-paid-100000":
        verified = read_capacity_review(
            run / "capacity" / "review.json", capacity.get("review_sha256")
        )
        if verified.receipt() != capacity:
            raise ValueError("Candidate capacity review changed")
    elif capacity and capacity != {"profile": "pages-default", "max_files": 20000}:
        raise ValueError("Unknown candidate capacity profile")
    return receipt
