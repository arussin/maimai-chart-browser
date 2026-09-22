"""Incremental song artwork and public mapping preparation shared by rebuild paths."""

import hashlib
import io
import re
import time
import warnings
from collections import Counter
from copy import deepcopy
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from .catalog_identity import discovery_labels, label
from .catalog_sources import WIKI, discovery_pages, page_links
from .enrichment import classify_titles, migrate_artwork, select_artwork, verify_asset
from .provider_reconciliation import capture_snapshot, failed_refresh, reconcile
from .registry import digest, resolve
from .snapshots import atomic_json, read_json

POLICY = "sustainable-coverage-1"
IMAGE_BASES = {
    "JP": "https://maimaidx.jp/maimai-mobile/img/Music/",
    "INTL": "https://maimaidx-eng.com/maimai-mobile/img/Music/",
}
IMAGE_NAME = re.compile(r"[A-Za-z0-9_-]+\.(?:png|jpg|jpeg|webp)", re.I)
CONFIG = {
    "version": POLICY,
    "wiki_budget": 300,
    "oldest_reserved": 100,
    "song_budget": 300,
    "retry_seconds": {
        "not_found": 86400 * 7,
        "ambiguous": 86400 * 7,
        "unavailable": 900,
        "unsupported": 86400,
        "missing": 86400,
    },
    "image_bytes": 4 * 1024 * 1024,
    "image_pixels": 16000000,
    "thumbnail_pixels": 128,
    "webp_quality": 85,
    "placeholder_sha256": [],
}


def thumbnail(raw):
    from PIL import Image

    if not raw or len(raw) > CONFIG["image_bytes"]:
        raise ValueError("Artwork download exceeds limit")
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(raw)) as image:
            if (
                image.format not in {"PNG", "JPEG", "WEBP"}
                or not 0 < image.width * image.height <= CONFIG["image_pixels"]
            ):
                raise ValueError("Unsupported artwork dimensions or format")
            dimensions = {"width": image.width, "height": image.height}
            image.load()
            image.thumbnail((128, 128), Image.Resampling.LANCZOS)
            output = io.BytesIO()
            image.convert("RGB").save(output, "WEBP", quality=85, method=4)
            converted = output.getvalue()
    if len(converted) > 256 * 1024:
        raise ValueError("Artwork thumbnail exceeds limit")
    return converted, dimensions


def wiki_jacket(raw, url, song):
    """Only the identity-bearing metadata table's image is eligible."""
    from .transcription_html import _Document, _label, _Node, _walk

    root = _Document(raw.decode("utf-8")).root
    matches = []
    for table in (n for n in _walk(root) if n.tag == "table"):
        fields = {}
        for row in (n for n in _walk(table) if n.tag == "tr"):
            cells = [n for n in row.children if isinstance(n, _Node) and n.tag in {"td", "th"}]
            if len(cells) == 2 and _label(cells[0]) in {"タイトル", "アーティスト"}:
                key = _label(cells[0])
                if key in fields:
                    raise ValueError("Ambiguous Wiki song metadata")
                fields[key] = _label(cells[1])
        if set(fields) != {"タイトル", "アーティスト"}:
            continue
        if not all(
            label(fields[k]) and label(fields[k]) == label(song["metadata"].get(f))
            for k, f in (("タイトル", "title"), ("アーティスト", "artist"))
        ):
            continue
        images = set()
        for node in _walk(table):
            if node.tag != "img":
                continue
            href = next(
                (
                    node.attrs[k]
                    for k in ("data-original", "data-original-src", "data-src", "src")
                    if node.attrs.get(k)
                ),
                "",
            )
            target = urljoin(url, href)
            parsed = urlsplit(target)
            if (
                parsed.scheme == "https"
                and parsed.netloc == "cdn.gamerch.com"
                and not parsed.query
                and not parsed.fragment
                and re.fullmatch(r"/[A-Za-z0-9_./-]+\.(?:png|jpg|jpeg|webp)", parsed.path, re.I)
                and ".." not in parsed.path.split("/")
            ):
                images.add(target)
        if len(images) != 1:
            raise ValueError("Ambiguous or missing Wiki jacket")
        matches.extend(images)
    if len(set(matches)) != 1:
        raise ValueError("Wiki jacket lacks unique complete song identity")
    return matches[0]


def _official_index(value):
    latest = {}
    for observation in sorted(
        value["observations"].values(),
        key=lambda o: (o.get("observed_at", ""), o["observation_id"]),
    ):
        if observation["field"] != "metadata":
            continue
        sid = resolve(value, observation["subject_id"])
        source = value["sources"][observation["snapshot_id"]]
        region = observation["region"]
        if source.get("provider") == "sega-" + str(region).lower() and region in IMAGE_BASES:
            latest[sid, region] = observation
    result = {}
    for (sid, region), observation in latest.items():
        name = observation["value"].get("image_url")
        if isinstance(name, str) and IMAGE_NAME.fullmatch(name):
            result.setdefault(sid, {})[region] = {
                "url": IMAGE_BASES[region] + name,
                "snapshot_id": observation["snapshot_id"],
                "assertion": digest(observation["value"]),
            }
    return result


def _state(path):
    if path.exists():
        result = read_json(path)
        if result.get("version") != "coverage-work-1":
            raise ValueError("Unsupported coverage work state")
        return result
    return {"version": "coverage-work-1", "generation": 0, "jobs": {}, "reviews": {}}


def _put_asset(raw, metadata, root, evidence, *, policy=POLICY):
    if metadata["sha256"] in CONFIG["placeholder_sha256"]:
        raise ValueError("Recognized generic artwork placeholder")
    key = digest({"source": metadata["sha256"], "policy": policy, "conversion": CONFIG})
    conversion = Path(root) / "conversions" / (key + ".json")
    if conversion.exists():
        selection = read_json(conversion)
        verify_asset(root, selection["path"], selection["asset"])
        return {
            **selection,
            "evidence": evidence,
            "asset": {
                **selection["asset"],
                "source": metadata["url"],
                "source_sha256": metadata["sha256"],
            },
        }
    converted, dimensions = thumbnail(raw)
    sha = hashlib.sha256(converted).hexdigest()
    path = "media/" + sha + ".webp"
    asset = {
        "sha256": sha,
        "bytes": len(converted),
        "source": metadata["url"],
        "source_sha256": metadata["sha256"],
        **dimensions,
    }
    output = Path(root) / path
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        verify_asset(root, path, asset)
    else:
        with output.open("xb") as stream:
            stream.write(converted)
    selection = {"path": path, "asset": asset, "policy": policy, "evidence": evidence}
    atomic_json(conversion, selection)
    return selection


def _queue(value, state, now, official_index=None):
    state = deepcopy(state)
    state["generation"] += 1
    eligible = []
    official_index = _official_index(value) if official_index is None else official_index
    for sid, song in value["songs"].items():
        if song.get("redirect"):
            continue
        evidence = digest(
            {
                "metadata": song["metadata"],
                "official": official_index.get(sid, {}),
                "policy": CONFIG,
            }
        )
        job = state["jobs"].setdefault(
            sid, {"first_seen": state["generation"], "attempts": 0, "next_retry": 0}
        )
        changed = job.get("evidence") != evidence
        selected = song.get("enrichment", {}).get("artwork", {}).get("selected", {})
        retry = not selected or job.get("status") in {
            "retained_on_failure",
            "partial",
            "deferred",
            "unresolved",
        }
        rate_limited = job.get("reason") == "rate_limited" and job.get("next_retry", 0) > now
        if not rate_limited and (changed or (retry and job.get("next_retry", 0) <= now)):
            eligible.append((sid, changed))
        job["pending_evidence"] = evidence
    old = sorted(
        (sid for sid, _ in eligible), key=lambda sid: (state["jobs"][sid]["first_seen"], sid)
    )
    fresh = [sid for sid, changed in eligible if changed]
    ordered = old[: CONFIG["oldest_reserved"]]
    ordered = list(dict.fromkeys(ordered + fresh + old))
    return state, ordered[: CONFIG["song_budget"]]


def _retry(details, attempts, now, errors):
    statuses = {item.get("status") for item in details}
    if 429 in statuses:
        deadlines = []
        for item in details:
            value = item.get("retry_after")
            try:
                deadlines.append(now + max(0, int(value)))
            except (ValueError, TypeError):
                try:
                    deadlines.append(int(parsedate_to_datetime(value).timestamp()))
                except (ValueError, TypeError, AttributeError):
                    continue
        return "rate_limited", max([now + 900, *deadlines])
    if 404 in statuses:
        return "not_found", now + CONFIG["retry_seconds"]["not_found"]
    if any("ambiguous" in error.lower() for error in errors):
        return "ambiguous", now + CONFIG["retry_seconds"]["ambiguous"]
    if any("budget" in error.lower() for error in errors):
        return "deferred", 0
    return "unavailable", now + min(86400, 900 * 2 ** min(attempts - 1, 7))


def coverage_inventory(value):
    songs = {sid for sid, song in value["songs"].items() if not song.get("redirect")}
    charts = {cid for cid, chart in value["charts"].items() if not chart.get("redirect")}
    mapped = {
        resolve(value, mapping["subject_id"])
        for mapping in value["mappings"].values()
        if mapping["provider"] == "kamaitachi" and mapping["state"] == "accepted"
    }
    jackets = {
        sid: {
            scope: selection["path"]
            for scope, selection in value["songs"][sid]
            .get("enrichment", {})
            .get("artwork", {})
            .get("selected", {})
            .items()
        }
        for sid in songs
    }
    jackets = {sid: selections for sid, selections in jackets.items() if selections}
    listings = {}
    for observation in sorted(
        value["observations"].values(),
        key=lambda row: (row.get("observed_at", ""), row["observation_id"]),
    ):
        if observation["field"] == "listing":
            listings[resolve(value, observation["subject_id"]), observation["region"]] = (
                observation["value"]
            )
    scopes = {}
    for region in ("JP", "INTL", "historical"):
        group = {
            cid
            for cid in charts
            if (
                all(listings.get((cid, r)) != "listed" for r in ("JP", "INTL"))
                if region == "historical"
                else listings.get((cid, region)) == "listed"
            )
        }
        group_songs = {resolve(value, value["charts"][cid]["song_id"]) for cid in group}
        scopes[region] = {
            "charts": len(group),
            "mapped_charts": len(group & mapped),
            "songs": len(group_songs),
            "songs_with_artwork": len(group_songs & jackets.keys()),
        }
    return {
        "charts": len(charts),
        "songs": len(songs),
        "mapped": sorted(mapped & charts),
        "artwork": jackets,
        "scopes": scopes,
    }


def coverage_changes(before, after):
    result = {"before": before, "after": after}
    for kind, left, right in (
        ("mappings", set(before["mapped"]), set(after["mapped"])),
        ("artwork", set(before["artwork"]), set(after["artwork"])),
    ):
        changed = sorted(
            sid
            for sid in left & right
            if kind == "artwork" and before["artwork"][sid] != after["artwork"][sid]
        )
        result[kind] = {
            "added": sorted(right - left),
            "removed": sorted(left - right),
            "replaced": changed,
            "unchanged": len(left & right) - len(changed),
        }
        if left - right:
            raise ValueError("Unexplained accepted identity-level coverage loss")
    return result


def prepare_coverage(
    value,
    published,
    capture,
    root,
    output,
    *,
    roots=(),
    offline=False,
    replay=None,
    now=None,
    title_reviews=(),
    provider_reviews=(),
):
    """Return candidate state; only the caller commits progress after full preparation."""
    now = int(time.time()) if now is None else now
    root, output = Path(root), Path(output)
    result = deepcopy(value)
    state = _state(root / "work.json")
    prior = None
    if replay:
        prior = read_json(Path(replay).parent / "coverage-inputs.json")
        if prior["starting_registry_sha256"] != digest(value) or prior["config"] != CONFIG:
            raise ValueError("Coverage replay starting state or policy differs")
        state = prior["work"]
        now = prior["checked_at"]
    inputs = {
        "version": POLICY,
        "starting_registry_sha256": digest(value),
        "config": CONFIG,
        "work": deepcopy(state),
        "checked_at": now,
        "title_reviews": list(title_reviews),
        "provider_reviews": list(provider_reviews),
    }
    if prior and (
        prior["title_reviews"] != inputs["title_reviews"]
        or prior["provider_reviews"] != inputs["provider_reviews"]
    ):
        raise ValueError("Coverage replay reviews differ")
    migration = migrate_artwork(result, published, roots, root)
    classify_titles(result, title_reviews)
    before = coverage_inventory(result)
    provider = {"status": "offline_retained", "conflicts": [], "added": []}
    if not offline or replay:
        try:
            result, provider = reconcile(result, capture_snapshot(capture), provider_reviews)
        except (OSError, ValueError, KeyError, TypeError) as error:
            result, provider = failed_refresh(result, str(error))
    if provider["conflicts"]:
        atomic_json(output / "coverage-conflicts.json", provider)
        raise ValueError("Conflicting provider assignment requires review")
    official_index = _official_index(result)
    state, selected = _queue(result, state, now, official_index)
    if prior:
        selected = prior["selected_work"]
    elif offline:
        selected = []
    inputs["selected_work"] = selected
    atomic_json(output / "coverage-inputs.json", inputs)
    atomic_json(output / "coverage-start.json", value)
    outcomes, links = [], None
    wiki_identities = Counter(
        (label(song["metadata"].get("title")), label(song["metadata"].get("artist")))
        for song in result["songs"].values()
        if not song.get("redirect")
    )
    for sid in selected:
        song, job = result["songs"][sid], state["jobs"][sid]
        old = deepcopy(song.get("enrichment", {}).get("artwork", {}).get("selected", {}))
        official = official_index.get(sid, {})
        errors, accepted = [], []
        attempted = set()

        def acquire(url, attempted=attempted):
            attempted.add(url)
            return capture.get(url)

        for region, candidate in official.items():
            prior_selection = old.get(region)
            evidence = {"song_id": sid, "region": region, **candidate}
            if prior_selection and prior_selection.get("evidence") == evidence:
                accepted.append(region)
                continue
            try:
                raw, metadata = acquire(candidate["url"])
                selection = _put_asset(raw, metadata, root, evidence)
                select_artwork(song, region, selection)
                accepted.append(region)
            except (OSError, ValueError, Warning) as error:
                errors.append(str(error))
        if not accepted and not old:
            try:
                if (
                    wiki_identities[
                        (
                            label(song["metadata"].get("title")),
                            label(song["metadata"].get("artist")),
                        )
                    ]
                    != 1
                ):
                    raise ValueError("Ambiguous accepted song identity for Wiki artwork")
                if links is None:
                    home, _ = acquire(WIKI)
                    links = page_links(home)
                    for url in sorted(discovery_pages(home)):
                        try:
                            for name, found in page_links(acquire(url)[0]).items():
                                links.setdefault(name, set()).update(found)
                        except ValueError:
                            continue
                names = discovery_labels(song["metadata"])
                urls = set(job.get("wiki_urls", []))
                for name in names:
                    urls.update(links.get(name, []))
                job["wiki_urls"] = sorted(urls)
                if len(urls) > 4:
                    raise ValueError("Ambiguous Wiki discovery")
                candidates = []
                for url in sorted(urls):
                    raw, page_meta = acquire(url)
                    image_url = wiki_jacket(raw, url, song)
                    candidates.append((image_url, page_meta))
                if len({url for url, _ in candidates}) != 1:
                    raise ValueError("Missing or ambiguous verified Wiki jacket")
                image_url, page_meta = candidates[0]
                raw, metadata = acquire(image_url)
                selection = _put_asset(
                    raw,
                    metadata,
                    root,
                    {
                        "song_id": sid,
                        "page": page_meta,
                        "assertion": digest(song["metadata"]),
                        "image": image_url,
                    },
                )
                select_artwork(song, "default", selection)
                accepted.append("default")
            except (OSError, ValueError, Warning) as error:
                errors.append(str(error))
        current = song.get("enrichment", {}).get("artwork", {}).get("selected", {})
        if not current.get("default") and current:
            select_artwork(song, "default", current.get("JP") or current.get("INTL"))
        status = (
            "accepted"
            if accepted and not errors
            else "partial"
            if accepted
            else "retained_on_failure"
            if old
            else "deferred"
            if any("budget" in e.lower() for e in errors)
            else "unresolved"
        )
        job["evidence"] = job["pending_evidence"]
        job["attempts"] += 1
        job["checked_at"] = now
        job["status"] = status
        reason, deadline = _retry(
            [capture.failure_details.get(url, {}) for url in attempted],
            job["attempts"],
            now,
            errors,
        )
        job["reason"], job["next_retry"] = reason, deadline
        if status == "accepted":
            job["reason"], job["next_retry"] = "accepted", 0
        if not current:
            fingerprint = digest({"song_id": sid, "evidence": job["evidence"], "policy": POLICY})
            state["reviews"].setdefault(
                fingerprint,
                {
                    "song_id": sid,
                    "status": status,
                    "reason": errors[-1] if errors else "no verified source",
                },
            )
        outcomes.append({"song_id": sid, "status": status, "errors": errors})
    assets = {}
    for song in result["songs"].values():
        for selection in song.get("enrichment", {}).get("artwork", {}).get("selected", {}).values():
            verify_asset(root, selection["path"], selection["asset"])
            assets[selection["path"]] = selection["asset"]
    atomic_json(output / "coverage-state.json", state)
    report = {
        "version": POLICY,
        "provider": provider,
        "migration": migration,
        "artwork": outcomes,
        "counts": dict(Counter(row["status"] for row in outcomes)),
        "assets": assets,
        "coverage": coverage_changes(before, coverage_inventory(result)),
    }
    atomic_json(output / "coverage-audit.json", report)
    return result, report
