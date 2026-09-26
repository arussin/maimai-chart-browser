"""Installed corpus preparation and receipt verification; no publication authority."""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, TypedDict
from uuid import uuid4

from maimai_analyzer.dataset import SOURCE_LOCK

from .artwork import MEDIA_PATH
from .catalog_loading import MAX_CATALOG_BYTES
from .corpus_attempts import bind_attempt
from .corpus_diagnostics import Diagnostics
from .corpus_models import PreparedLegacy, PreparedRegistry, PreparedResult, RegistryContext
from .corpus_registry import capture_claims, project_corpus, reconcile_evidence
from .corpus_requests import (
    LegacySource,
    PreparationRequest,
    RegistrySource,
    RetainedPackage,
    ReviewedRevision,
    preparation_request,
)
from .lab import build_browser
from .mai_notes import MAX_INDEX_BYTES, download_index, prepare_links
from .metadata_policy import BUILTIN_CONTEXT, PolicyContext
from .public_release import _read, build_public_release
from .publication_capacity import ReviewedCapacity, read_capacity_review, stage_capacity_review
from .research_package import extend_package, read_package
from .snapshots import MAX_BYTES, atomic_json, read_json
from .source_identity import implementation_hash as implementation_hash
from .source_registration import SourceRegistration, source_context
from .store_lock import writer_lock


class FileRecord(TypedDict):
    bytes: int
    sha256: str


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
    """Compatibility entry point; production stages consume PreparationRequest."""
    request = preparation_request(
        store,
        previous_browser,
        package=package,
        revision=revision,
        artwork_cache=artwork_cache,
        mai_notes_snapshot=mai_notes_snapshot,
        registry=registry,
        overrides=overrides,
        offline=offline,
        replay_sources=replay_sources,
        coverage_reviews=coverage_reviews,
        reassess_captured_policy=reassess_captured_policy,
        previous_public=previous_public,
        capacity_review=capacity_review,
        capacity_sha256=capacity_sha256,
        player_maishift=player_maishift,
        registry_seed=registry_seed,
        predecessor=predecessor,
    )
    return prepare_corpus(request, implementation=implementation, source_fetcher=source_fetcher)


def prepare_corpus(
    request: PreparationRequest,
    *,
    sources: tuple[SourceRegistration, ...] = (),
    implementation: Callable[[], str] | None = None,
    source_fetcher: Callable[[str, dict[str, str]], tuple[int, bytes, dict[str, str]]]
    | None = None,
) -> Path:
    """Sequence typed stages; commit readiness only after diagnostics and validation."""
    policy_context = source_context(sources)
    sources = tuple(sorted(sources, key=lambda entry: entry.adapter.provider))
    implementation = implementation or implementation_hash
    store, previous_browser, source = request.store, request.previous_browser, request.source
    replay = source.captures.receipt if isinstance(source, RegistrySource) else None
    with writer_lock(store):
        run = store / "runs" / (datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ-") + uuid4().hex[:8])
        run.mkdir(parents=True)
        atomic_json(run / "state.json", {"status": "preparing"})
        diagnostics = Diagnostics(
            run,
            mode=(
                source.captures.mode
                if isinstance(source, RegistrySource)
                else "reassess"
                if request.predecessor and request.predecessor.get("operation") == "reassess"
                else "retained"
            ),
            source="registry" if isinstance(source, RegistrySource) else "legacy_package",
        )
        try:
            with diagnostics.stage("inputs"):
                capacity = (
                    stage_capacity_review(
                        request.capacity.review, request.capacity.sha256, run / "capacity"
                    )
                    if request.capacity
                    else None
                )
                retained = _retain_public_inputs(
                    store,
                    previous_browser,
                    request.previous_public,
                    replay,
                    request.player_maishift,
                    run,
                )
                if isinstance(source, RegistrySource) and source.verify_legacy_identity:
                    _validate_legacy_seed(source.path, retained.before)
                attempt = bind_attempt(
                    run,
                    {**request.attempt_fields(), "previous_public": retained.previous_public},
                    implementation(),
                    request.predecessor,
                    policy_context=policy_context,
                )
            with diagnostics.stage("source_capture"):
                package_path = _prepare_package(request, run)
            corpus: PreparedResult
            if isinstance(source, RegistrySource):
                context = RegistryContext(
                    store,
                    run,
                    retained.before,
                    previous_browser,
                    package_path,
                    not isinstance(request.package, ReviewedRevision),
                    policy_context,
                )
                with diagnostics.stage("claims") as counts:
                    claims = capture_claims(source, context, source_fetcher, sources)
                    counts.records = len(claims.accepted["charts"])
                    if claims.refresh is not None:
                        counts.accepted = len(claims.refresh.additions["profiles"])
                        counts.unresolved = len(claims.refresh.audit["failures"])
                        counts.evidence = ["source-captures.json", "source-audit.json"]
                with diagnostics.stage("enrichment") as counts:
                    enriched = reconcile_evidence(source, context, claims)
                    counts.records = len(enriched.accepted["charts"])
                    counts.evidence = ["coverage-audit.json", "coverage-state.json"]
                with diagnostics.stage("projection") as counts:
                    corpus = project_corpus(context, enriched)
                    counts.records = len(corpus.charts)
                    counts.evidence = ["registry-provenance.json"]
            else:
                with diagnostics.stage("corpus") as counts:
                    assert package_path is not None
                    captured_at = (
                        attempt["body"]["observations"]
                        .get("mai_notes_snapshot", {})
                        .get("captured_at")
                    )
                    corpus = _prepare_legacy(package_path, run, source, captured_at=captured_at)
                    counts.records = len(corpus.charts)
                    counts.evidence = ["mai-notes-audit.json"]
            with diagnostics.stage("render"):
                rendered = _render_artifacts(run, retained, capacity, corpus)
            with diagnostics.stage("review") as counts:
                _describe_changes(run, retained.before, corpus, rendered.version)
                counts.evidence = ["changes.json", "report.md"]
            with diagnostics.stage("receipt"):
                receipt = _ready_receipt(run, request, retained, corpus, rendered, implementation)
                receipt["attempt_sha256"] = attempt["sha256"]
                receipt["source_registrations"] = policy_context.manifest()
            atomic_json(run / "state.json", {"status": "ready"})
            atomic_json(run / "ready.json", receipt)
            return run
        except BaseException as primary:
            try:
                atomic_json(run / "state.json", {"status": "failed"})
            except BaseException:
                BaseException.add_note(primary, "corpus.failure_state_record_failed")
            raise


def _validate_legacy_seed(seed: Path, before: dict[str, Any]) -> None:
    from .registry import read_registry

    accepted = read_registry(seed)
    known = set(accepted["charts"])
    known.update(old for entries in accepted["legacy-ids"].values() for old in entries)
    if not all(chart["chart_id"] in known for chart in before["catalog"]):
        raise ValueError(
            "Online legacy preparation requires an explicit registry bound to its identities"
        )


def _prepare_package(request: PreparationRequest, run: Path) -> Path | None:
    source = request.package
    if isinstance(source, RetainedPackage):
        return source.path
    if isinstance(source, ReviewedRevision):
        offline = (
            request.source.captures.offline if isinstance(request.source, RegistrySource) else True
        )
        return source_package(
            run, request.store, source.revision, source.artwork_cache, offline=offline
        )
    return None


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


def _prepare_legacy(
    package: Path | str,
    run: Path,
    source: LegacySource,
    *,
    captured_at: str | None = None,
) -> PreparedLegacy:
    from .source_preparation.prepare_chart_constants import prepare as constants

    constants(package, run / "constants")
    descriptor, retained = read_package(run / "constants")
    charts = json.loads(retained["catalog.json"])
    with source.snapshot.open("rb") as stream:
        raw = stream.read(MAX_INDEX_BYTES + 1)
    if captured_at is None:
        raise ValueError("Retained mai-notes input requires bound capture metadata")
    links, audit = prepare_links(
        charts,
        raw,
        captured_at=captured_at,
        overrides=json.loads(source.overrides.read_bytes()) if source.overrides else (),
    )
    (run / "inputs").mkdir()
    (run / "inputs" / "mai-notes.json").write_bytes(raw)
    atomic_json(run / "mai-notes-audit.json", audit)
    extend_package(run / "constants", run / "package", {"mai-notes.json": links})
    return PreparedLegacy(descriptor, charts, links, audit, run / "package")


def _render_artifacts(
    run: Path, retained: RetainedPublic, capacity: ReviewedCapacity | None, corpus: PreparedResult
) -> RenderedCandidate:
    features, previous_public, previous_identity = (
        retained.features,
        retained.previous_public,
        retained.previous_identity,
    )
    version = (
        "research-"
        + hashlib.sha256((corpus.package / "package.json").read_bytes()).hexdigest()[:12]
    )
    browser = build_browser(
        corpus.package,
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
    run: Path, before: dict[str, Any], corpus: PreparedResult, version: str
) -> dict[str, Any]:
    charts, links, audit = corpus.charts, corpus.links, corpus.audit
    changes = chart_changes(before["catalog"], charts)
    old_links = before.get("mai_notes", {}).get("charts", {})
    if isinstance(corpus, PreparedRegistry):
        aliases = corpus.prepared.get("legacy_ids", {})
        old_links = {aliases.get(cid, cid): row for cid, row in old_links.items()}
        from .official_inventory import coverage
        from .registry_catalog import coverage_report

        changes["registry"] = coverage(corpus.accepted) | coverage_report(corpus.prepared)
        changes["coverage"] = corpus.coverage_audit
        if corpus.refresh is not None:
            changes["sources"] = corpus.refresh.audit["counts"]
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
    if isinstance(corpus, PreparedRegistry):
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
    if isinstance(corpus, PreparedRegistry) and corpus.refresh is not None:
        source_audit = corpus.refresh.audit
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
    request: PreparationRequest,
    retained: RetainedPublic,
    corpus: PreparedResult,
    rendered: RenderedCandidate,
    implementation: Callable[[], str],
) -> dict[str, Any]:
    receipt = {
        "version": "catalog-update-1",
        "status": "ready",
        "catalog_version": rendered.version,
        "source": corpus.descriptor["source"],
        "base_catalog_version": read_json(request.previous_browser / "manifest.json")["default"],
        "implementation_hash": implementation(),
        "browser_features": retained.features,
        "release": rendered.release,
        "files": file_inventory(run / "public"),
        **(
            {
                "previous_public": {
                    "inputs": retained.previous_identity,
                    "historical_references_verified": True,
                }
            }
            if retained.previous_identity is not None
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
            if isinstance(corpus, PreparedRegistry)
            else {}
        ),
    }
    return receipt


def verify_candidate(
    run: Path | str,
    *,
    implementation: Callable[[], str] | None = None,
    input_locations: dict[str, Path | str] | None = None,
    policy_context: PolicyContext = BUILTIN_CONTEXT,
) -> dict[str, Any]:
    implementation = implementation or implementation_hash
    run = Path(run).resolve()
    receipt = read_json(run / "ready.json")
    policy_context.require_manifest(receipt.get("source_registrations", []))
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

        verify_attempt(
            run, implementation(), input_locations=input_locations, policy_context=policy_context
        )
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
