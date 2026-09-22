"""Repeatable metadata/link/transcription waterfall for the persistent inventory."""

import hashlib
import json
from collections import Counter, defaultdict
from copy import deepcopy
from pathlib import Path

from .catalog_capture import CaptureStore
from .catalog_identity import discovery_labels
from .catalog_sources import WIKI, discovery_pages, mai_catalog, page_links, wiki_catalog
from .catalog_transcriptions import implementation, prepare_body, qualify
from .mai_notes import SOURCE_URL
from .metadata_waterfall import FIELDS, accept, key, number, propose
from .registry import accept_mapping, digest, resolve, select_transcription, write_registry
from .registry_catalog import _legacy_enrichment, project_registry
from .snapshots import atomic_json
from .transcription_html import extract_chart

POLICY = "catalog-waterfall-2"
METADATA_URLS = {
    "arcade-songs": "https://dp4p6x0xfi5o9.cloudfront.net/maimai/data.json",
    "otoge-db": "https://raw.githubusercontent.com/zvuc/otoge-db/main/maimai/data/music-ex.json",
    "mai-notes": SOURCE_URL,
}
MAX_WIKI_PAGES = 300


def refresh(
    value,
    published,
    cache,
    output,
    *,
    offline=False,
    replay=None,
    fetcher=None,
    capture_store=None,
    write_candidate=True,
):
    """Prepare a new registry and validated additions; never mutate accepted inputs."""
    value = deepcopy(value)
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    capture = capture_store or CaptureStore(
        Path(cache) / "sources",
        offline=offline,
        replay=replay,
        **({"fetcher": fetcher} if fetcher else {}),
    )
    legacy = _legacy_enrichment(published) if published.get("schema_version") else published
    projected = project_registry(value, legacy)
    own = {c["chart_id"]: c for c in projected["catalog"]}
    own_keys = defaultdict(list)
    for cid, chart in own.items():
        own_keys[key(chart)].append(cid)
    audit = {
        "version": POLICY,
        "metadata": {},
        "links": [],
        "transcriptions": [],
        "failures": [],
        "identity_mismatches": [],
    }
    additions = {"profiles": [], "records": {}, "inventory": [], "sources": {}}

    def view():
        return project_registry(value, legacy)

    def ingest(inputs):
        projection = view()
        wanted = {
            c["chart_id"]: {
                f
                for f in FIELDS
                if number(projection["navigation"]["charts"][c["chart_id"]].get(f), f) is None
                or f in projection["navigation"]["charts"][c["chart_id"]].get("metric_sources", {})
            }
            for c in projection["catalog"]
        }
        proposal = propose(value, inputs)
        latest = {}
        for observation in sorted(
            value["observations"].values(),
            key=lambda o: (o.get("observed_at", ""), o.get("observation_id", "")),
        ):
            if observation.get("policy") == "metadata-waterfall-1":
                scope = (
                    observation["subject_id"],
                    observation["field"],
                    observation["region"],
                    observation.get("release"),
                    value["sources"][observation["snapshot_id"]]["provider"],
                )
                latest[scope] = observation["value"]
        existing = {(*scope[:4], metric, scope[4]) for scope, metric in latest.items()}
        claims = [
            c
            for c in proposal["claims"]
            if c["field"] in wanted[c["subject_id"]]
            and (
                c["subject_id"],
                c["field"],
                c["region"],
                c.get("release"),
                c["value"],
                proposal["sources"][c["snapshot_id"]]["provider"],
            )
            not in existing
        ]
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
        )
        value.clear()
        value.update(reviewed)
        audit["failures"].extend(proposal["failures"])
        audit["metadata"].setdefault("ambiguous", []).extend(proposal["ambiguous"])
        audit["metadata"]["observations_added"] = audit["metadata"].get(
            "observations_added", 0
        ) + len(claims)

    inputs, targets, mai_meta = [], {}, None
    for provider, url in METADATA_URLS.items():
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
        except ValueError as error:
            audit["failures"].append({"provider": provider, "reason": str(error)})
    ingest(inputs)
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

    wiki_inputs, wiki_rows, wiki_simai = [], {}, {}
    checked_urls = set()
    wiki_song_pages = set()

    def read_wiki(url):
        if url in checked_urls:
            return
        if len(checked_urls) >= (200 if capture_store is not None else MAX_WIKI_PAGES):
            raise ValueError("Wiki page budget reached; remaining sources deferred")
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

    projection = view()
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
            except ValueError as error:
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
        except ValueError as error:
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
                except ValueError as error:
                    audit["failures"].append(
                        {"provider": "gamerch-wiki-discovery", "url": url, "reason": str(error)}
                    )
            for name, urls in discovered.items():
                for url in sorted(urls):
                    try:
                        read_wiki(url)
                    except ValueError as error:
                        audit["failures"].append(
                            {
                                "provider": "gamerch-wiki",
                                "title": name,
                                "url": url,
                                "reason": str(error),
                            }
                        )
        except ValueError as error:
            audit["failures"].append({"provider": "gamerch-wiki-discovery", "reason": str(error)})

    if wiki_inputs:
        ingest(wiki_inputs)
    print(
        json.dumps(
            {
                "metadata_captures": len(capture.captures),
                "metadata_failures": len(audit["failures"]),
            }
        ),
        flush=True,
    )
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
                        raise ValueError(result["reason"])
                    body = result["body"].encode("utf-8")
                else:
                    if raw.lstrip().lower().startswith((b"<!doctype", b"<html")):
                        raise ValueError(
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
            except (ValueError, KeyError, UnicodeError) as error:
                outcome["attempts"].append({"provider": provider, "url": url, "reason": str(error)})
                outcome["status"] = "unavailable_or_unsupported"
        audit["transcriptions"].append(outcome)
        if len(audit["transcriptions"]) % 10 == 0:
            print(
                json.dumps(
                    {
                        "transcriptions_checked": len(audit["transcriptions"]),
                        "analysis_added": len(additions["profiles"]),
                    }
                ),
                flush=True,
            )
    projection = view()
    audit["metadata"]["remaining"] = [
        {
            "chart_id": c["chart_id"],
            "wiki_status": "field_not_published"
            if c["chart_id"] in wiki_rows
            else "variant_not_published"
            if key(c)[:2] in wiki_song_pages
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
        write_registry(value, output / "registry")
    return value, additions, audit
