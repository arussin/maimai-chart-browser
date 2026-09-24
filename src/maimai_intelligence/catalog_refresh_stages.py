"""Repeatable metadata/link/transcription waterfall for the persistent inventory."""

from __future__ import annotations

import hashlib
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from maimai_analyzer.contracts import ChartInputError

from .catalog_identity import discovery_labels
from .catalog_sources import WIKI, discovery_pages, page_links, wiki_catalog
from .catalog_transcriptions import implementation, prepare_body, qualify
from .coverage_types import CaptureError, Failure, FailureKind, IntegrityError, SnapshotError
from .mai_notes import SOURCE_URL
from .metadata_policy import BUILTIN_CONTEXT, PolicyContext
from .metadata_selection import eligible_claims
from .metadata_waterfall import FIELDS, accept, key, number, propose
from .registry import accept_mapping, digest, resolve, select_transcription
from .registry_catalog import project_registry
from .transcription_html import extract_chart

POLICY = "catalog-waterfall-2"
MAX_WIKI_PAGES = 300


@dataclass(frozen=True)
class WikiEvidence:
    inputs: list[tuple[str, bytes, dict[str, Any]]]
    rows: dict[str, dict[str, Any]]
    simai: dict[str, str]
    song_pages: set[tuple[str, str]]


def ingest_metadata(
    value,
    legacy,
    inputs,
    audit,
    *,
    adapters=None,
    policies=None,
    policy_context: PolicyContext = BUILTIN_CONTEXT,
):
    projection = project_registry(value, legacy, policy_context=policy_context)
    proposal = propose(
        value, inputs, adapters=adapters, policies=policies, policy_context=policy_context
    )
    claims = eligible_claims(projection, proposal, value["observations"], value["sources"])
    used = {c["snapshot_id"] for c in claims}
    proposal["claims"] = claims
    proposal["sources"] = {k: v for k, v in proposal["sources"].items() if k in used}
    reviewed = accept(
        value,
        proposal,
        {
            "proposal_sha256": digest(proposal),
            "evidence": POLICY
            + ": exact unique variant, finite numeric field; retain primary metrics",
            "accept": [c["observation_id"] for c in claims],
        },
        policy_context=policy_context,
    )
    value.clear()
    value.update(reviewed)
    audit["failures"].extend(proposal["failures"])
    audit["metadata"].setdefault("ambiguous", []).extend(proposal["ambiguous"])
    audit["metadata"]["observations_added"] = audit["metadata"].get("observations_added", 0) + len(
        claims
    )


def reconcile_links(value, own, own_keys, targets, mai_meta, mai_generated, audit):
    source_id = None
    if mai_meta:
        source_id = "mai-notes-index:" + mai_meta["sha256"]
        value["sources"].setdefault(
            source_id,
            {"provider": "mai-notes", **mai_meta, "acquisition": "public_metadata_capture"},
        )
    target_keys = defaultdict(list)
    for target in targets.values():
        target_keys[key(target)].append(target)
    accepted_links = {
        resolve(value, m["subject_id"]): m
        for m in value["mappings"].values()
        if m["provider"] == "mai-notes" and m["state"] == "accepted"
    }
    matches = {}
    for cid, chart in own.items():
        prior = accepted_links.get(cid)
        candidate = targets.get(prior["provider_id"]) if prior else None
        if prior and mai_meta and candidate is None:
            prior["available"] = False
            audit["links"].append({"chart_id": cid, "status": "provider_entry_missing"})
            continue
        if candidate:
            evidence = prior.get("evidence")
            credit = evidence if isinstance(evidence, dict) else {}
            artist_matches = key(candidate)[1] == key(chart)[1]
            artist_matches |= (
                credit.get("provider_artist") == candidate["artist"]
                and credit.get("official_artist") == chart["artist"]
            )
            if (candidate["format"], candidate["difficulty"], key(candidate)[0]) != (
                chart["format"],
                chart["difficulty"],
                key(chart)[0],
            ) or not artist_matches:
                prior["available"] = False
                audit["links"].append({"chart_id": cid, "status": "changed_identity_review"})
                continue
        if candidate is None:
            rows = target_keys[key(chart)]
            if len(rows) == 1 and len(own_keys[key(chart)]) == 1:
                candidate = rows[0]
            elif rows:
                audit["links"].append({"chart_id": cid, "status": "ambiguous"})
        if candidate:
            matches[cid] = candidate
            if prior and bool(prior.get("available")) != candidate["available"]:
                prior["available"] = candidate["available"]
                prior["availability_snapshot_id"] = source_id
                audit["links"].append({"chart_id": cid, "status": "availability_changed"})
            if candidate["available"] and prior is None:
                accept_mapping(
                    value,
                    provider="mai-notes",
                    provider_id=candidate["id"],
                    subject_id=cid,
                    snapshot_id=source_id,
                    evidence=POLICY + ": exact unique title, artist, format and difficulty",
                    acceptance_basis="policy_exact",
                    available=True,
                    metadata={
                        "source": SOURCE_URL,
                        "source_sha256": mai_meta["sha256"],
                        "captured_at": mai_meta["captured_at"],
                        "generated_at": mai_generated,
                    },
                )
                audit["links"].append({"chart_id": cid, "status": "added"})

    return matches


def discover_wiki(
    value,
    legacy,
    own,
    own_keys,
    matches,
    capture,
    audit,
    shared_capture,
    *,
    policy_context: PolicyContext = BUILTIN_CONTEXT,
):
    wiki_inputs, wiki_rows, wiki_simai = [], {}, {}
    checked_urls = set()
    wiki_song_pages = set()

    def read_wiki(url):
        if url in checked_urls:
            return
        if len(checked_urls) >= (200 if shared_capture else MAX_WIKI_PAGES):
            raise CaptureError(
                Failure(
                    FailureKind.DEFERRED, "Wiki page budget reached; remaining sources deferred"
                )
            )
        checked_urls.add(url)
        raw, metadata = capture.get(url)
        rows, simai = wiki_catalog(raw, url)
        wiki_inputs.append(("gamerch-wiki", raw, metadata))
        for row in rows:
            wiki_song_pages.add(key(row)[:2])
            ids = own_keys.get(key(row), [])
            if len(ids) != 1:
                audit["identity_mismatches"].append(
                    {
                        "source_url": url,
                        "title": row["title"],
                        "artist": row["artist"],
                        "format": row["format"],
                        "difficulty": row["difficulty"],
                        "reason": "ambiguous_identity" if ids else "no_accepted_identity",
                    }
                )
            if len(ids) == 1:
                wiki_rows[ids[0]] = {
                    **row,
                    "reference_source": {"url": url, "sha256": metadata["sha256"]},
                }
                if simai:
                    wiki_simai[ids[0]] = simai

    projection = project_registry(value, legacy, policy_context=policy_context)
    missing = {
        c["chart_id"]
        for c in projection["catalog"]
        if any(
            number(projection["navigation"]["charts"][c["chart_id"]].get(f), f) is None
            for f in FIELDS
        )
    }
    for cid, target in matches.items():
        if target.get("wiki_url") and (
            cid in missing or not value["charts"][cid].get("transcription")
        ):
            try:
                read_wiki(target["wiki_url"])
            except IntegrityError:
                raise
            except (CaptureError, SnapshotError) as error:
                audit["failures"].append(
                    {"chart_id": cid, "provider": "gamerch-wiki", "reason": str(error)}
                )
    # Refresh previously used Wiki pages even after they filled all missing fields.
    used_wiki = {
        value["sources"][o["snapshot_id"]]["url"]
        for o in value["observations"].values()
        if value["sources"].get(o.get("snapshot_id"), {}).get("provider") == "gamerch-wiki"
    }
    for url in sorted(used_wiki):
        try:
            read_wiki(url)
        except IntegrityError:
            raise
        except (CaptureError, SnapshotError) as error:
            audit["failures"].append({"provider": "gamerch-wiki", "url": url, "reason": str(error)})
    # Aliases discover candidate pages; full identity still gates every value/body.
    undiscovered = set()
    for cid, chart in own.items():
        if cid not in wiki_rows and (
            cid in missing or not value["charts"][cid].get("transcription")
        ):
            undiscovered.update(discovery_labels(chart))
    if undiscovered:
        try:
            root_page = capture.get(WIKI)[0]
            links = page_links(root_page)
            discovered = defaultdict(set)
            for name, found in links.items():
                if name in undiscovered:
                    discovered[name].update(found)
            for url in sorted(discovery_pages(root_page)):
                try:
                    for name, found in page_links(capture.get(url)[0]).items():
                        if name in undiscovered:
                            discovered[name].update(found)
                except IntegrityError:
                    raise
                except (CaptureError, SnapshotError) as error:
                    audit["failures"].append(
                        {"provider": "gamerch-wiki-discovery", "url": url, "reason": str(error)}
                    )
            for name, urls in discovered.items():
                for url in sorted(urls):
                    try:
                        read_wiki(url)
                    except IntegrityError:
                        raise
                    except (CaptureError, SnapshotError) as error:
                        audit["failures"].append(
                            {
                                "provider": "gamerch-wiki",
                                "title": name,
                                "url": url,
                                "reason": str(error),
                            }
                        )
        except IntegrityError:
            raise
        except (CaptureError, SnapshotError) as error:
            audit["failures"].append({"provider": "gamerch-wiki-discovery", "reason": str(error)})

    return WikiEvidence(wiki_inputs, wiki_rows, wiki_simai, wiki_song_pages)


def prepare_transcriptions(
    value, own, targets, matches, wiki: WikiEvidence, capture, cache, additions, audit
):
    wiki_rows, wiki_simai, wiki_song_pages = wiki.rows, wiki.simai, wiki.song_pages
    fingerprints = implementation()
    for cid, chart in own.items():
        selected = value["charts"][cid].get("transcription")
        prior_provider = (
            value["sources"].get(selected.get("snapshot_id"), {}).get("provider")
            if selected
            else None
        )
        if selected and prior_provider not in {
            "mai-notes-transcription",
            "simai-wiki-transcription",
        }:
            continue
        target = matches.get(cid, {})
        reference_row = (
            wiki_rows.get(cid, {}) if wiki_rows.get(cid, {}).get("note_counts") else target
        )
        reference = reference_row.get("note_counts")
        candidates = []
        if target.get("available"):
            candidates.append(
                ("mai-notes-transcription", f"https://mai-notes.com/data/charts/{target['id']}.txt")
            )
        simai_url = wiki_simai.get(cid) or target.get("simai_url")
        if simai_url:
            candidates.append(("simai-wiki-transcription", simai_url))
        outcome = {
            "chart_id": cid,
            "title": chart["title"],
            "difficulty": chart["difficulty"],
            "status": "no_transcription_source",
            "attempts": [],
        }
        if reference and target.get("note_counts") and reference != target["note_counts"]:
            outcome.update(
                status="reference_counts_conflict",
                references=[
                    {"counts": reference, "source": reference_row.get("reference_source")},
                    {"counts": target["note_counts"], "source": target.get("reference_source")},
                ],
            )
            audit["transcriptions"].append(outcome)
            continue
        if not reference:
            outcome["reference_status"] = (
                "counts_not_published"
                if cid in wiki_rows
                else "variant_not_published"
                if key(chart)[:2] in wiki_song_pages
                else "no_verified_reference_identity"
            )
            outcome["status"] = "reference_counts_missing"
            audit["transcriptions"].append(outcome)
            continue
        for provider, url in candidates:
            try:
                raw, metadata = capture.get(url)
                if provider == "simai-wiki-transcription":
                    result = extract_chart(
                        raw.decode("utf-8"),
                        {
                            "format": chart["format"],
                            "difficulty": chart["difficulty"],
                            "source_page_formats": sorted(
                                {t["format"] for t in targets.values() if t.get("simai_url") == url}
                                or {chart["format"]}
                            ),
                        },
                    )
                    if not result["body"] or not result["identity_resolved"]:
                        raise SnapshotError(result["reason"])
                    body = result["body"].encode("utf-8")
                else:
                    if raw.lstrip().lower().startswith((b"<!doctype", b"<html")):
                        raise SnapshotError(
                            "Chart-text endpoint returned HTML instead of a transcription"
                        )
                    body = raw
                body, transformation = prepare_body(body, reference_row)
                body_hash = hashlib.sha256(body).hexdigest()
                if selected:
                    unchanged = (
                        selected["source_hash"] == body_hash
                        and selected.get("container_hash") == metadata["sha256"]
                        and prior_provider == provider
                        and selected.get("evidence", {}).get("note_counts") == reference
                    )
                    outcome["status"] = (
                        "retained_unchanged" if unchanged else "changed_source_review"
                    )
                    outcome["candidate_sha256"] = body_hash
                    break
                row = {
                    "input_id": provider + ":" + url.rsplit("/", 1)[-1] + ":" + chart["difficulty"],
                    "source_container_id": provider + ":" + metadata["sha256"],
                    "source_song_id": chart["song_id"],
                    "title": chart["title"],
                    "artist": chart["artist"],
                    "format": chart["format"],
                    "difficulty": chart["difficulty"],
                    "level": chart["level"],
                    "source_path": url,
                    "body_sha256": body_hash,
                    "source_raw_sha256": metadata["sha256"],
                    "transformation": transformation,
                    "acquisition_status": "available",
                    "identity_resolved": True,
                }
                profile, record, validation = qualify(
                    body, row, reference, Path(cache) / "analysis", fingerprints=fingerprints
                )
                snapshot = provider + ":" + metadata["sha256"]
                value["sources"].setdefault(
                    snapshot,
                    {
                        "provider": provider,
                        **metadata,
                        "parser": POLICY,
                        "acquisition": "public_transcription_capture",
                    },
                )
                select_transcription(
                    value,
                    cid,
                    row,
                    snapshot_id=snapshot,
                    evidence={
                        "policy": POLICY,
                        "source_url": url,
                        "note_counts": reference,
                        "reference_source": reference_row["reference_source"],
                        "count_match": True,
                        "transformation": transformation,
                        "source_identity": "accepted mapping or unique Wiki identity",
                        "game_fidelity": "unverified",
                    },
                    legacy_chart_id=profile["chart_id"],
                    analysis_state="available",
                    provider=provider + "-input",
                    acceptance_basis="policy_validated",
                )
                additions["profiles"].append(profile)
                additions["records"][profile["chart_id"]] = record
                additions["inventory"].append(row)
                additions["sources"][snapshot] = value["sources"][snapshot]
                outcome.update(
                    status="analyzed",
                    provider=provider,
                    source_url=url,
                    transformation=transformation,
                    **validation,
                )
                break
            except IntegrityError:
                raise
            except (CaptureError, SnapshotError, ChartInputError, UnicodeError) as error:
                outcome["attempts"].append({"provider": provider, "url": url, "reason": str(error)})
                outcome["status"] = "unavailable_or_unsupported"
        audit["transcriptions"].append(outcome)
