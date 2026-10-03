"""Prepared refresh decisions and their single validated candidate application.

Historical registry rows stay at this application boundary. Pure decisions use
normalized identities; capture and analysis adapters never receive a candidate.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping
from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from .catalog_identity import key
from .mai_notes import SOURCE_URL
from .metadata_adapters import MetadataAdapter
from .metadata_policy import BUILTIN_CONTEXT, MetadataSourcePolicy, PolicyContext
from .metadata_selection import eligible_claims
from .metadata_waterfall import project, propose
from .refresh_policy import AcceptedLink, LinkChart, LinkDecisions, LinkTarget, decide_links
from .registry import accept_mapping, resolve, select_transcription, validate
from .serialization import digest

POLICY = "catalog-waterfall-2"
Record = dict[str, Any]
Capture = tuple[str, bytes, Record]


@dataclass(frozen=True)
class MetadataDecision:
    sources: Record
    claims: tuple[Record, ...]
    failures: tuple[Record, ...]
    ambiguous: tuple[Record, ...]


@dataclass(frozen=True)
class PreparedLinks:
    decisions: LinkDecisions
    targets: Record
    metadata: Record | None
    generated_at: str | None

    @property
    def matches(self) -> Record:
        return {cid: self.targets[provider_id] for cid, provider_id in self.decisions.matches}


@dataclass(frozen=True)
class TranscriptionDecision:
    chart_id: str
    row: Record
    snapshot_id: str
    source: Record
    evidence: Record
    legacy_chart_id: str
    provider: str


@dataclass(frozen=True)
class RefreshPlan:
    base_sha256: str
    metadata: tuple[MetadataDecision, ...]
    links: PreparedLinks
    transcriptions: tuple[TranscriptionDecision, ...]


def metadata_view(value: Record, decisions: tuple[MetadataDecision, ...]) -> tuple[Record, Record]:
    """Read model for staged claims; never an intermediate canonical registry."""
    sources = dict(value["sources"])
    observations = dict(value["observations"])
    for decision in decisions:
        sources.update(decision.sources)
        observations.update((claim["observation_id"], claim) for claim in decision.claims)
    return sources, observations


def plan_metadata(
    value: Record,
    projection: Record,
    inputs: list[Capture],
    *,
    prior: tuple[MetadataDecision, ...] = (),
    adapters: dict[str, MetadataAdapter] | None = None,
    policies: Mapping[str, MetadataSourcePolicy] | None = None,
    policy_context: PolicyContext = BUILTIN_CONTEXT,
) -> MetadataDecision:
    proposal = propose(
        value, inputs, adapters=adapters, policies=policies, policy_context=policy_context
    )
    sources, observations = metadata_view(value, prior)
    claims = eligible_claims(projection, proposal, observations, sources)
    used = {claim["snapshot_id"] for claim in claims}
    return MetadataDecision(
        {sid: row for sid, row in proposal["sources"].items() if sid in used},
        tuple(claims),
        tuple(proposal["failures"]),
        tuple(proposal["ambiguous"]),
    )


def discovery_projection(
    projection: Record, value: Record, decisions: tuple[MetadataDecision, ...]
) -> Record:
    """Re-evaluate supplemental fields only, without rebuilding catalog projections."""
    sources, observations = metadata_view(value, decisions)
    claims: dict[str, list[Record]] = defaultdict(list)
    for row in observations.values():
        if row.get("policy") == "metadata-waterfall-1":
            claims[resolve(value, row["subject_id"])].append(row)
    charts = {}
    for cid, original in projection["navigation"]["charts"].items():
        nav = deepcopy(original)
        for field in nav.get("metric_sources", {}):
            nav.pop(field, None)
        for field in (
            "metric_sources",
            "regional_metrics",
            "regional_metric_sources",
            "metadata_alternatives",
        ):
            nav.pop(field, None)
        project(nav, claims[cid], sources)
        charts[cid] = nav
    return {"catalog": projection["catalog"], "navigation": {"charts": charts}}


def plan_links(
    value: Record, own: Record, targets: Record, metadata: Record | None, generated_at: str | None
) -> PreparedLinks:
    accepted = {
        resolve(value, row["subject_id"]): (mid, row)
        for mid, row in value["mappings"].items()
        if row["provider"] == "mai-notes" and row["state"] == "accepted"
    }
    charts = []
    for cid, row in own.items():
        prior = None
        if cid in accepted:
            mid, mapping = accepted[cid]
            evidence = mapping.get("evidence")
            credit = evidence if isinstance(evidence, dict) else {}
            prior = AcceptedLink(
                mid,
                mapping["provider_id"],
                bool(mapping.get("available")),
                credit.get("provider_artist"),
                credit.get("official_artist"),
            )
        charts.append(
            LinkChart(cid, key(row), row["artist"], row["format"], row["difficulty"], prior)
        )
    normalized = tuple(
        LinkTarget(
            row["id"], key(row), row["artist"], row["format"], row["difficulty"], row["available"]
        )
        for row in targets.values()
    )
    return PreparedLinks(
        decide_links(tuple(charts), normalized, captured=metadata is not None),
        targets,
        metadata,
        generated_at,
    )


def apply_refresh(
    value: Record, plan: RefreshPlan, *, policy_context: PolicyContext = BUILTIN_CONTEXT
) -> Record:
    """Apply a base-bound plan once, using the existing canonical identity rules."""
    if digest(value) != plan.base_sha256:
        raise ValueError("Refresh decisions require their unchanged accepted base")
    candidate = deepcopy(value)
    for decision in plan.metadata:
        candidate["sources"].update(deepcopy(decision.sources))
        for claim in decision.claims:
            candidate["observations"][claim["observation_id"]] = deepcopy(claim)
    links = plan.links
    snapshot = None
    if links.metadata is not None:
        snapshot = "mai-notes-index:" + links.metadata["sha256"]
        candidate["sources"].setdefault(
            snapshot,
            {
                "provider": "mai-notes",
                **deepcopy(links.metadata),
                "acquisition": "public_metadata_capture",
            },
        )
    for change in links.decisions.changes:
        if change.mapping_id is not None:
            mapping = candidate["mappings"][change.mapping_id]
            mapping["available"] = change.available
            if change.bind_capture:
                mapping["availability_snapshot_id"] = snapshot
        else:
            assert links.metadata is not None and snapshot is not None
            accept_mapping(
                candidate,
                provider="mai-notes",
                provider_id=change.provider_id,
                subject_id=change.chart_id,
                snapshot_id=snapshot,
                evidence=POLICY + ": exact unique title, artist, format and difficulty",
                acceptance_basis="policy_exact",
                available=True,
                metadata={
                    "source": SOURCE_URL,
                    "source_sha256": links.metadata["sha256"],
                    "captured_at": links.metadata["captured_at"],
                    "generated_at": links.generated_at,
                },
            )
    for selection in plan.transcriptions:
        candidate["sources"].setdefault(selection.snapshot_id, deepcopy(selection.source))
        select_transcription(
            candidate,
            selection.chart_id,
            selection.row,
            snapshot_id=selection.snapshot_id,
            evidence=deepcopy(selection.evidence),
            legacy_chart_id=selection.legacy_chart_id,
            analysis_state="available",
            provider=selection.provider + "-input",
            acceptance_basis="policy_validated",
        )
    return validate(candidate, policy_context=policy_context)
