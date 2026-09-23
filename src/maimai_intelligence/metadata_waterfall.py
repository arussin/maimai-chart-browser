"""Source-bound, field-by-field metadata proposals; never chart analysis or inventory."""

import hashlib
from collections import defaultdict
from copy import deepcopy
from datetime import datetime

from .catalog_identity import key
from .coverage_types import IntegrityError, SnapshotError
from .metadata_policy import FIELDS, SOURCE_POLICIES
from .metadata_policy import number as number
from .registry import digest, validate

VERSION = "metadata-waterfall-1"
LABELS = {name: policy.label for name, policy in SOURCE_POLICIES.items()}
MAX_BYTES = 16 * 1024 * 1024


def parse(raw, provider):
    """Historical public parser entry point uses the maintained source adapter."""
    from .metadata_adapters import parse_metadata

    return parse_metadata(raw, provider)


def source(raw, provider, metadata, *, policy=None):
    sha = hashlib.sha256(raw).hexdigest()
    if metadata.get("sha256") != sha or metadata.get("bytes") != len(raw):
        raise IntegrityError("Metadata capture integrity mismatch")
    if datetime.fromisoformat(metadata["captured_at"].replace("Z", "+00:00")).tzinfo is None:
        raise ValueError("Capture timestamp requires a timezone")
    if not metadata.get("url", "").startswith("https://"):
        raise ValueError("Metadata source requires its public URL")
    return {
        "provider": provider,
        "label": policy.label if policy else LABELS[provider],
        "sha256": sha,
        "bytes": len(raw),
        "url": metadata["url"],
        "captured_at": metadata["captured_at"],
        "parser": VERSION,
        "revision": metadata.get("revision"),
        "acquisition": "reviewed_page_extraction"
        if provider == "reviewed-page"
        else "public_metadata_capture",
    }


def propose(value, captures, *, adapters=None, policies=None):
    """Exact unique matches only. A failure of an optional provider is retained in the report."""
    from .metadata_adapters import normalize_builtin

    policies = SOURCE_POLICIES if policies is None else policies
    adapters = adapters or {}
    validate(value)
    own, claims, sources, failures, ambiguous = defaultdict(list), [], {}, [], []
    for chart in value["charts"].values():
        if not chart.get("redirect"):
            song = value["songs"][chart["song_id"]]["metadata"]
            own[key({**song, **chart})].append(chart["chart_id"])
    for provider, raw, metadata in captures:
        if provider not in policies:
            raise ValueError("Metadata source has no explicit policy entry")
        policy = policies[provider]
        captured = source(raw, provider, metadata, policy=policy)
        try:
            adapter = adapters.get(provider)
            rows = (
                adapter.normalize(raw, metadata)
                if adapter
                else normalize_builtin(provider, raw, metadata)
            )
        except SnapshotError as error:
            failures.append({"provider": provider, "reason": str(error)})
            continue
        sid = provider + ":" + captured["sha256"]
        sources[sid] = captured
        index = defaultdict(list)
        for row in rows:
            index[key(row)].append(row)
        for identity, chart_ids in own.items():
            candidates = index.get(identity, [])
            if len(candidates) > 1 or len(chart_ids) > 1:
                if candidates:
                    ambiguous.append({"provider": provider, "chart_ids": chart_ids})
                continue
            if not candidates:
                continue
            row, cid = candidates[0], chart_ids[0]
            for field in FIELDS:
                if row[field] is None:
                    continue
                claim = {
                    "subject_id": cid,
                    "snapshot_id": sid,
                    "field": field,
                    "value": row[field],
                    "region": row.get("region") if field == "chart_constant" else None,
                    "release": row.get("release") if field == "chart_constant" else None,
                    "observed_at": captured["captured_at"],
                    "priority": policy.priority,
                    "source_url": row.get("source_url", captured["url"]),
                    "evidence": row.get("evidence")
                    or (
                        "Unique normalized title, artist, format and difficulty; "
                        "explicit numeric field"
                    ),
                    "policy": VERSION,
                }
                claim["observation_id"] = "metadata:" + digest(claim)
                claims.append(claim)
    return {
        "schema_version": VERSION,
        "registry_sha256": digest(value),
        "sources": sources,
        "claims": claims,
        "failures": failures,
        "ambiguous": ambiguous,
    }


def accept(value, proposal, review):
    if (
        proposal["registry_sha256"] != digest(value)
        or review.get("proposal_sha256") != digest(proposal)
        or not review.get("evidence")
    ):
        raise ValueError("Metadata acceptance requires a current source-bound review")
    selected = set(review["accept"])
    available = {c["observation_id"] for c in proposal["claims"]}
    if not selected <= available:
        raise ValueError("Unknown metadata claim in review")
    result = deepcopy(value)
    result["sources"].update(proposal["sources"])
    for claim in proposal["claims"]:
        if claim["observation_id"] in selected:
            result["observations"][claim["observation_id"]] = deepcopy(claim)
    for sid, entry in review.get("song_aliases", {}).items():
        if (
            sid not in result["songs"]
            or not entry.get("evidence")
            or not isinstance(entry.get("aliases"), list)
            or any(not isinstance(a, str) or not 0 < len(a) <= 200 for a in entry["aliases"])
        ):
            raise ValueError("Invalid reviewed song aliases")
        meta = result["songs"][sid]["metadata"]
        meta["aliases"] = sorted(set(meta.get("aliases", [])) | set(entry["aliases"]))
    return validate(result)


def project(nav, claims, sources):
    """Retain accepted primary metrics; choose supplemental fields independently."""

    def provenance(claim):
        src = sources[claim["snapshot_id"]]
        return {
            "provider": src.get("label", LABELS.get(src["provider"], src["provider"])),
            "snapshot_id": claim["snapshot_id"],
            "region": claim["region"],
            "release": claim.get("release"),
            "url": claim["source_url"],
        }

    metric_sources, scoped, scoped_sources, conflicts = {}, {}, {}, {}
    for field in FIELDS:
        primary = number(nav.get(field), field)
        if primary is not None:
            continue
        current = {}
        for claim in sorted(
            claims,
            key=lambda c: (
                datetime.fromisoformat(c["observed_at"].replace("Z", "+00:00")),
                c["observation_id"],
            ),
        ):
            if claim["field"] == field:
                src = sources[claim["snapshot_id"]]
                current[src["provider"], claim["region"]] = claim
        candidates = sorted(
            current.values(),
            key=lambda c: (
                {"JP": 0, "INTL": 1, None: 2}[c["region"]],
                c["priority"],
                c["snapshot_id"],
            ),
        )
        if not candidates:
            continue
        chosen = candidates[0]
        nav[field] = chosen["value"]
        metric_sources[field] = provenance(chosen)
        if field == "chart_constant":
            regional = {
                r: next((c for c in candidates if c["region"] == r), None) for r in ("JP", "INTL")
            }
            scoped[field] = {r: c["value"] if c else None for r, c in regional.items()}
            scoped_sources[field] = {r: provenance(c) if c else None for r, c in regional.items()}
        others = [c for c in candidates[1:] if c["value"] != chosen["value"]]
        if others:
            conflicts[field] = [
                {k: c.get(k) for k in ("value", "snapshot_id", "region", "release")}
                for c in [chosen, *others]
            ]
    if metric_sources:
        nav["metric_sources"] = metric_sources
    if scoped:
        nav["regional_metrics"] = scoped
        nav["regional_metric_sources"] = scoped_sources
    if conflicts:
        nav["metadata_alternatives"] = conflicts
    return nav
