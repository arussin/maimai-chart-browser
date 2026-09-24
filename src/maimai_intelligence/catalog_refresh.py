"""Repeatable metadata/link/transcription waterfall for the persistent inventory."""

from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Callable, Mapping, Sequence
from copy import deepcopy
from pathlib import Path
from typing import Any

from .catalog_capture import CaptureStore
from .catalog_refresh_stages import MAX_WIKI_PAGES as MAX_WIKI_PAGES
from .catalog_refresh_stages import POLICY as POLICY
from .catalog_refresh_stages import (
    discover_wiki,
    ingest_metadata,
    prepare_transcriptions,
    reconcile_links,
)
from .catalog_sources import mai_catalog
from .coverage_types import CaptureError, IntegrityError, SnapshotError
from .mai_notes import SOURCE_URL
from .metadata_adapters import MetadataAdapter, builtin_adapter
from .metadata_policy import MetadataSourcePolicy
from .metadata_waterfall import FIELDS, key, number
from .registry import write_registry
from .registry_catalog import _legacy_enrichment, project_registry
from .snapshots import atomic_json

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
    metadata_policies: Mapping[str, MetadataSourcePolicy] | None = None,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
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

    inputs, targets, mai_meta, mai_generated = [], {}, None, None
    adapters = {
        entry.provider: entry
        for entry in (
            metadata_adapters
            if metadata_adapters is not None
            else [builtin_adapter(name, url) for name, url in METADATA_URLS.items()]
        )
    }
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
    ingest_metadata(value, legacy, inputs, audit, adapters=adapters, policies=metadata_policies)
    matches = reconcile_links(value, own, own_keys, targets, mai_meta, mai_generated, audit)
    wiki = discover_wiki(
        value, legacy, own, own_keys, matches, capture, audit, capture_store is not None
    )
    if wiki.inputs:
        ingest_metadata(
            value, legacy, wiki.inputs, audit, adapters=adapters, policies=metadata_policies
        )
    prepare_transcriptions(value, own, targets, matches, wiki, capture, cache, additions, audit)
    projection = project_registry(value, legacy)
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
        write_registry(value, output / "registry")
    return value, additions, audit
