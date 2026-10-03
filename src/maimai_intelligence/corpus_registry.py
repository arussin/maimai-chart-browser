"""Registry adapters: capture claims, reconcile/checkpoint, then project once."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from .catalog_capture import CaptureStore
from .corpus_models import PreparedRegistry, RegistryContext, SourceRefresh
from .corpus_requests import RegistrySource
from .snapshots import atomic_json
from .source_registration import SourceRegistration

SourceFetcher = Callable[[str, dict[str, str]], tuple[int, bytes, dict[str, str]]]


@dataclass(frozen=True)
class CapturedClaims:
    accepted: dict[str, Any]
    captures: CaptureStore
    refresh: SourceRefresh | None


@dataclass(frozen=True)
class EnrichedRegistry:
    accepted: dict[str, Any]
    coverage_audit: dict[str, Any]
    refresh: SourceRefresh | None


def capture_claims(
    source: RegistrySource,
    context: RegistryContext,
    source_fetcher: SourceFetcher | None,
    sources: tuple[SourceRegistration, ...] = (),
) -> CapturedClaims:
    from maimai_intelligence.registry import read_registry

    accepted = read_registry(source.path, policy_context=context.policy_context)
    regions = {
        s.get("region")
        for s in accepted["sources"].values()
        if s.get("acquisition") == "complete_validated_capture"
    }
    if not {"JP", "INTL"} <= regions:
        raise ValueError(
            "Registry preparation requires complete accepted captures for JP and International"
        )
    refreshed = None
    from maimai_intelligence.catalog_capture import CaptureStore, fetch_public

    shared_capture = CaptureStore(
        context.store / "cache" / "waterfall" / "sources",
        offline=source.captures.offline,
        replay=source.captures.receipt,
        fetcher=source_fetcher if source_fetcher is not None else fetch_public,
    )
    if source.captures.mode != "retained":
        from maimai_intelligence.catalog_refresh import refresh

        accepted, additions, source_audit = refresh(
            accepted,
            context.before,
            context.store / "cache" / "waterfall",
            context.run,
            offline=source.captures.offline,
            replay=source.captures.receipt,
            fetcher=source_fetcher,
            capture_store=shared_capture,
            write_candidate=False,
            sources=sources,
            policy_context=context.policy_context,
        )
        refreshed = SourceRefresh(additions, source_audit)
    return CapturedClaims(accepted, shared_capture, refreshed)


def reconcile_evidence(
    source: RegistrySource, context: RegistryContext, claims: CapturedClaims
) -> EnrichedRegistry:
    from .coverage import prepare_coverage

    accepted = claims.accepted
    reviews = source.reviews or {}
    replay_sources = source.captures.receipt
    reassess_captured_policy = source.captures.mode == "reassess"
    offline = source.captures.offline
    store, run, before = context.store, context.run, context.before
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
    coverage_policy = policy_identity(
        COVERAGE_CONFIG, reviews, policy_context=context.policy_context
    )
    coverage_parent = None
    coverage_work = None
    if replay_sources:
        accepted = replay_checkpoint_start(
            coverage_root, accepted, replay_sources, policy_context=context.policy_context
        )
        if reassess_captured_policy:
            # Verify the store's current checkpoint for ancestry, not as recomputed output.
            _, coverage_parent = restore_checkpoint(
                coverage_root, coverage_base, coverage_policy, policy_context=context.policy_context
            )
    else:
        accepted, coverage_parent = restore_checkpoint(
            coverage_root, accepted, coverage_policy, policy_context=context.policy_context
        )
        if coverage_parent:
            coverage_work = checkpoint_work(
                coverage_root, coverage_parent, policy_context=context.policy_context
            )
    accepted, coverage_audit = prepare_coverage(
        accepted,
        before,
        claims.captures,
        store / "cache" / "coverage",
        run,
        roots=(context.previous_browser, context.package),
        offline=offline,
        replay=replay_sources,
        title_reviews=reviews.get("titles", ()),
        provider_reviews=reviews.get("providers", ()),
        artwork_reviews=reviews.get("artwork", ()),
        work=coverage_work,
        reassess_policy=reassess_captured_policy,
        policy_context=context.policy_context,
    )
    from maimai_intelligence.registry import write_registry

    write_registry(accepted, run / "registry", policy_context=context.policy_context)
    atomic_json(run / "source-captures.json", claims.captures.receipt())
    if (not offline and not replay_sources) or reassess_captured_policy:
        checkpoint = commit_checkpoint(
            coverage_root,
            coverage_base,
            accepted,
            run,
            coverage_policy,
            predecessor=coverage_parent,
            policy_context=context.policy_context,
        )
        atomic_json(run / "coverage-checkpoint.json", checkpoint)
    return EnrichedRegistry(accepted, coverage_audit, claims.refresh)


def project_corpus(context: RegistryContext, enriched: EnrichedRegistry) -> PreparedRegistry:
    from .registry_catalog import build_registry_package
    from .research_package import read_package

    accepted = enriched.accepted
    run = context.run
    from maimai_intelligence.multilingual_search import compile_aliases

    # Search aids belong to the projection and its retained report;
    # the accepted identity registry remains exactly as reconciled.
    search_aliases = compile_aliases(accepted)
    atomic_json(run / "multilingual-search.json", search_aliases)
    prepared = build_registry_package(
        accepted,
        context.package,
        run / "package",
        published=context.before if context.use_retained_analysis else None,
        additions=enriched.refresh.additions if enriched.refresh else None,
        search_aliases={
            sid: tuple(alias["value"] for alias in record["aliases"])
            for sid, record in search_aliases["songs"].items()
        },
        artwork_source=context.store / "cache" / "coverage",
        policy_context=context.policy_context,
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
    return PreparedRegistry(
        descriptor,
        charts,
        links,
        audit,
        run / "package",
        accepted,
        prepared,
        enriched.coverage_audit,
        enriched.refresh,
    )
