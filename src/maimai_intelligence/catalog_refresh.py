"""Repeatable metadata/link/transcription waterfall for the persistent inventory."""

from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import Any

from .catalog_capture import CaptureStore, fetch_public
from .catalog_identity import key
from .catalog_refresh_stages import MAX_WIKI_PAGES as MAX_WIKI_PAGES
from .catalog_refresh_stages import POLICY as POLICY
from .catalog_refresh_stages import (
    capture_transcriptions,
    discover_wiki,
)
from .catalog_sources import mai_catalog
from .coverage_types import CaptureError, IntegrityError, SnapshotError
from .mai_notes import SOURCE_URL
from .metadata_adapters import MetadataAdapter, builtin_adapter
from .metadata_policy import BUILTIN_CONTEXT, FIELDS, MetadataSourcePolicy, PolicyContext, number
from .refresh_candidates import (
    Capture,
    MetadataDecision,
    Record,
    RefreshPlan,
    apply_refresh,
    discovery_projection,
    metadata_view,
    plan_links,
    plan_metadata,
)
from .registry import validate, write_registry
from .registry_catalog import _legacy_enrichment, project_registry
from .serialization import digest
from .snapshots import atomic_json
from .source_registration import SourceRegistration, source_context

METADATA_URLS = {
    "arcade-songs": "https://dp4p6x0xfi5o9.cloudfront.net/maimai/data.json",
    "otoge-db": "https://raw.githubusercontent.com/zvuc/otoge-db/main/maimai/data/music-ex.json",
    "mai-notes": SOURCE_URL,
}


def refresh(
    value: dict[str, Any],
    published: dict[str, Any],
    cache: Path | str,
    output: Path | str,
    *,
    offline: bool = False,
    replay: Path | str | None = None,
    fetcher: Callable[[str, dict[str, str]], tuple[int, bytes, dict[str, str]]] | None = None,
    capture_store: CaptureStore | None = None,
    write_candidate: bool = True,
    metadata_adapters: Sequence[MetadataAdapter] | None = None,
    sources: tuple[SourceRegistration, ...] = (),
    metadata_policies: Mapping[str, MetadataSourcePolicy] | None = None,
    policy_context: PolicyContext = BUILTIN_CONTEXT,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """Prepare a new registry and validated additions; never mutate accepted inputs."""
    if sources:
        policy_context.require_manifest(source_context(sources).manifest())
    validate(value, policy_context=policy_context)
    base_sha256 = digest(value)
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    capture = capture_store or CaptureStore(
        Path(cache) / "sources",
        offline=offline,
        replay=replay,
        fetcher=fetcher or fetch_public,
    )
    legacy = _legacy_enrichment(published) if published.get("schema_version") else published
    projected = project_registry(value, legacy, policy_context=policy_context)
    own = {c["chart_id"]: c for c in projected["catalog"]}
    own_keys: dict[tuple[str, str, str, str], list[str]] = defaultdict(list)
    for cid, chart in own.items():
        own_keys[key(chart)].append(cid)
    audit: Record = {
        "version": POLICY,
        "metadata": {},
        "links": [],
        "transcriptions": [],
        "failures": [],
        "identity_mismatches": [],
    }
    additions: Record = {"profiles": [], "records": {}, "inventory": [], "sources": {}}

    inputs: list[Capture] = []
    targets: Record = {}
    mai_meta: Record | None = None
    mai_generated: str | None = None
    adapters = {
        entry.provider: entry
        for entry in (
            metadata_adapters
            if metadata_adapters is not None
            else [builtin_adapter(name, url) for name, url in METADATA_URLS.items()]
        )
    }
    adapters.update(
        {
            entry.adapter.provider: entry.adapter
            for entry in sorted(sources, key=lambda entry: entry.adapter.provider)
        }
    )
    for provider, adapter in adapters.items():
        url = adapter.url
        try:
            raw, metadata = capture.get(url)
            inputs.append((provider, raw, metadata))
            if provider == "mai-notes":
                targets, mai_generated = mai_catalog(raw)
                for target in targets.values():
                    target["reference_source"] = {
                        "url": metadata["url"],
                        "sha256": metadata["sha256"],
                    }
                mai_meta = metadata
        except IntegrityError:
            raise
        except (CaptureError, SnapshotError) as error:
            audit["failures"].append({"provider": provider, "reason": str(error)})
    primary = plan_metadata(
        value,
        projected,
        inputs,
        adapters=adapters,
        policies=metadata_policies,
        policy_context=policy_context,
    )
    metadata_decisions: tuple[MetadataDecision, ...] = (primary,)

    def record_metadata(decision: MetadataDecision) -> None:
        audit["failures"].extend(decision.failures)
        audit["metadata"].setdefault("ambiguous", []).extend(decision.ambiguous)
        audit["metadata"]["observations_added"] = audit["metadata"].get(
            "observations_added", 0
        ) + len(decision.claims)

    record_metadata(primary)
    links = plan_links(value, own, targets, mai_meta, mai_generated)
    audit["links"].extend(
        {"chart_id": row.chart_id, "status": row.status} for row in links.decisions.outcomes
    )
    matches = links.matches
    discovery = discovery_projection(projected, value, metadata_decisions)
    metadata_sources, metadata_observations = metadata_view(value, metadata_decisions)
    wiki = discover_wiki(
        value,
        own,
        own_keys,
        matches,
        capture,
        audit,
        capture_store is not None,
        projection=discovery,
        metadata_sources=metadata_sources,
        metadata_observations=metadata_observations,
    )
    if wiki.inputs:
        secondary = plan_metadata(
            value,
            discovery,
            wiki.inputs,
            prior=metadata_decisions,
            adapters=adapters,
            policies=metadata_policies,
            policy_context=policy_context,
        )
        metadata_decisions += (secondary,)
        record_metadata(secondary)
    transcriptions = capture_transcriptions(
        value, own, targets, matches, wiki, capture, cache, additions, audit
    )
    value = apply_refresh(
        value,
        RefreshPlan(base_sha256, metadata_decisions, links, transcriptions),
        policy_context=policy_context,
    )
    projection = project_registry(value, legacy, policy_context=policy_context)
    audit["metadata"]["remaining"] = [
        {
            "chart_id": c["chart_id"],
            "wiki_status": "field_not_published"
            if c["chart_id"] in wiki.rows
            else "variant_not_published"
            if key(c)[:2] in wiki.song_pages
            else "no_verified_page_identity",
            "fields": [
                f
                for f in FIELDS
                if number(projection["navigation"]["charts"][c["chart_id"]].get(f), f) is None
            ],
        }
        for c in projection["catalog"]
        if any(
            number(projection["navigation"]["charts"][c["chart_id"]].get(f), f) is None
            for f in FIELDS
        )
    ]
    audit["counts"] = dict(Counter(row["status"] for row in audit["transcriptions"]))
    audit["captures"] = {
        "successful": len(capture.captures),
        "failed": len(capture.failures),
        "offline": offline,
    }
    atomic_json(output / "source-captures.json", capture.receipt())
    atomic_json(output / "source-audit.json", audit)
    if write_candidate:
        write_registry(value, output / "registry", policy_context=policy_context)
    return value, additions, audit
