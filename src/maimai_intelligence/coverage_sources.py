"""Public metadata acquisition adapters; jackets never authorize score mappings."""

import json
import re
from collections import Counter, defaultdict
from urllib.parse import urljoin, urlsplit

from .catalog_identity import discovery_labels, label
from .catalog_sources import WIKI, discovery_pages, page_links
from .coverage_policy import ArtworkCandidate, artwork_identity, choose_candidate
from .coverage_types import CaptureError, Failure, FailureKind, ReviewError, SnapshotError
from .registry import digest

OTOGE_REVISION = "751705e5710a4c8bce3dc50573c6912e55283dd2"
OTOGE_BASE = "https://raw.githubusercontent.com/zvuc/otoge-db/" + OTOGE_REVISION + "/maimai/"
LXNS_INDEX = "https://maimai.lxns.net/api/v0/maimai/song/list"
LXNS_JACKETS = "https://assets2.lxns.net/maimai/jacket/"
IMAGE_NAME = re.compile(r"[A-Za-z0-9_-]+\.(?:png|jpg|jpeg)", re.I)


def capture_snapshot(capture):
    from .provider_reconciliation import BASE, REVISION_URL

    def read_capture(url):
        raw, reference = capture.get(url)
        try:
            return json.loads(raw), reference
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise SnapshotError("Malformed public provider snapshot") from error

    commits, revision_source = read_capture(REVISION_URL)
    if (
        not isinstance(commits, list)
        or not commits
        or not isinstance(commits[0], dict)
        or not isinstance(commits[0].get("sha"), str)
        or not re.fullmatch(r"[a-f0-9]{40}", commits[0]["sha"])
    ):
        raise SnapshotError("Invalid public provider revision")
    revision = commits[0]["sha"]
    records, sources = {}, {"revision": revision_source}
    for kind in ("songs", "charts"):
        url = BASE + revision + "/db/seeds/" + kind + "-maimaidx.json"
        records[kind], sources[kind] = read_capture(url)
    return {"revision": revision, "sources": sources, **records}


class ArtworkSources:
    """Load each metadata snapshot once; return evidence, never registry mutations."""

    def __init__(self, capture, songs, *, providers=("otoge-db", "lxns"), reviews=()):
        self.capture = capture
        self.providers = providers
        self.reviews = reviews
        self.counts = Counter(
            artwork_identity(s["metadata"]) for s in songs.values() if not s.get("redirect")
        )
        self.loaded = {}
        self.indexes = {}
        self.failures = {}
        self.assessments = {}

    def _rows(self, provider):
        if provider in self.loaded:
            return self.loaded[provider]
        candidates, seen = [], set()
        urls = (
            [
                OTOGE_BASE + "data/" + name
                for name in ("music-ex.json", "music-ex-intl.json", "music-ex-deleted.json")
            ]
            if provider == "otoge-db"
            else [LXNS_INDEX]
        )
        try:
            for url in urls:
                raw, reference = self.capture.get(url)
                data = json.loads(raw)
                rows = (
                    data
                    if provider == "otoge-db"
                    else data.get("songs")
                    if isinstance(data, dict)
                    else None
                )
                if not isinstance(rows, list):
                    raise SnapshotError("Artwork provider does not contain a song list")
                for row in rows:
                    if not isinstance(row, dict) or any(
                        not isinstance(row.get(k), str) for k in ("title", "artist")
                    ):
                        raise SnapshotError("Artwork provider has an invalid song identity")
                    if provider == "otoge-db":
                        identifier = row.get("image_url")
                        if not isinstance(identifier, str) or not IMAGE_NAME.fullmatch(identifier):
                            continue
                        image = OTOGE_BASE + "jacket/" + identifier
                    else:
                        identifier = row.get("id")
                        if type(identifier) is not int or not 0 < identifier < 1000000000:
                            raise SnapshotError("Invalid public jacket identifier")
                        image = LXNS_JACKETS + str(identifier) + ".png"
                    metadata = {
                        "title": row["title"],
                        "artist": row["artist"],
                        "id": str(identifier),
                    }
                    source_id = provider + ":" + digest(metadata)
                    candidate = ArtworkCandidate(
                        provider, source_id, image, digest(metadata), metadata, reference
                    )
                    if source_id not in seen:
                        seen.add(source_id)
                        candidates.append(candidate)
        except (CaptureError, SnapshotError, json.JSONDecodeError) as error:
            self.failures[provider] = (
                error.failure
                if isinstance(error, CaptureError)
                else Failure(FailureKind.SCHEMA, str(error))
            )
            candidates = []
        self.loaded[provider] = candidates
        index = defaultdict(list)
        for candidate in candidates:
            index[artwork_identity(candidate.metadata)].append(candidate)
        self.indexes[provider] = index
        return candidates

    def validate_reviews(self, songs):
        seen = set()
        for review in self.reviews:
            sid, provider = review.get("song_id"), review.get("provider")
            if (
                sid in seen
                or sid not in songs
                or songs[sid].get("redirect")
                or provider not in self.providers
            ):
                raise ReviewError("Invalid or duplicate artwork review identity")
            if (
                review.get("purpose") != "artwork"
                or not review.get("evidence")
                or review.get("canonical_assertion") != digest(songs[sid]["metadata"])
            ):
                raise ReviewError("Stale or invalid artwork review")
            seen.add(sid)
            rows = self._rows(provider)
            if provider not in self.failures:
                choose_candidate(sid, songs[sid]["metadata"], self.counts, rows, [review])

    def evidence(self, sid, song):
        """Only a song's relevant assertions invalidate its negative cache entry."""
        result = {}
        identity = artwork_identity(song["metadata"])
        for provider in self.providers:
            self._rows(provider)
            failure = self.failures.get(provider)
            result[provider] = {
                "failure": failure.kind if failure else None,
                "candidates": sorted(c.assertion for c in self.indexes[provider].get(identity, [])),
            }
        result["reviews"] = digest([r for r in self.reviews if r.get("song_id") == sid])
        return result

    def for_song(self, sid, song):
        result, dispositions = [], []
        for provider in self.providers:
            candidates = self._rows(provider)
            reviews = [r for r in self.reviews if r.get("provider") == provider]
            candidate = (
                None
                if provider in self.failures
                else choose_candidate(sid, song["metadata"], self.counts, candidates, reviews)
            )
            matching = self.indexes[provider].get(artwork_identity(song["metadata"]), [])
            status = (
                "candidate"
                if candidate
                else "source_unavailable"
                if provider in self.failures
                else "needs_review"
                if matching
                else "no_complete_identity"
            )
            dispositions.append(
                {
                    "provider": provider,
                    "status": status,
                    "candidates": [
                        dict(
                            source_id=c.source_id,
                            assertion=c.assertion,
                            metadata=c.metadata,
                            url=c.url,
                        )
                        for c in matching
                    ],
                }
            )
            if candidate:
                result.append(candidate)
        self.assessments[sid] = dispositions
        return result

    def report(self):
        return {
            "version": "artwork-source-assessment-1",
            "otoge_revision": OTOGE_REVISION,
            "sources": {p: {"records": len(rows)} for p, rows in self.loaded.items()},
            "failures": {p: f.record() for p, f in self.failures.items()},
            "songs": self.assessments,
        }


def wiki_jacket(raw, url, song):
    """Only the identity-bearing metadata table's image is eligible."""
    from .transcription_html import _Document, _label, _Node, _walk

    try:
        root = _Document(raw.decode("utf-8")).root
    except UnicodeDecodeError as error:
        raise CaptureError(
            Failure(FailureKind.SCHEMA, "Invalid Wiki character encoding")
        ) from error
    matches = []
    for table in (n for n in _walk(root) if n.tag == "table"):
        fields = {}
        for row in (n for n in _walk(table) if n.tag == "tr"):
            cells = [n for n in row.children if isinstance(n, _Node) and n.tag in {"td", "th"}]
            if len(cells) == 2 and _label(cells[0]) in {"タイトル", "アーティスト"}:
                key = _label(cells[0])
                if key in fields:
                    raise CaptureError(
                        Failure(FailureKind.AMBIGUOUS, "Ambiguous Wiki song metadata")
                    )
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
            raise CaptureError(Failure(FailureKind.UNSUPPORTED, "Ambiguous or missing Wiki jacket"))
        matches.extend(images)
    if len(set(matches)) != 1:
        raise CaptureError(
            Failure(FailureKind.AMBIGUOUS, "Wiki jacket lacks unique complete song identity")
        )
    return matches[0]


class WikiArtwork:
    def __init__(self, capture, songs):
        self.capture = capture
        self.counts = Counter(
            artwork_identity(s["metadata"]) for s in songs.values() if not s.get("redirect")
        )
        self.links = None

    def selection(self, sid, song, job, put):
        identity = artwork_identity(song["metadata"])
        if identity is None or self.counts.get(identity) != 1:
            raise CaptureError(
                Failure(FailureKind.AMBIGUOUS, "Ambiguous accepted song identity for Wiki artwork")
            )
        if self.links is None:
            home, _ = self.capture.get(WIKI)
            links = page_links(home)
            for url in sorted(discovery_pages(home)):
                try:
                    for name, found in page_links(self.capture.get(url)[0]).items():
                        links.setdefault(name, set()).update(found)
                except CaptureError as error:
                    if error.failure.kind == FailureKind.DEFERRED:
                        raise
            self.links = links
        urls = set(job.get("wiki_urls", []))
        for name in discovery_labels(song["metadata"]):
            urls.update(self.links.get(name, []))
        job["wiki_urls"] = sorted(urls)
        if len(urls) > 4:
            raise CaptureError(Failure(FailureKind.AMBIGUOUS, "Ambiguous Wiki discovery"))
        candidates = []
        for url in sorted(urls):
            raw, page = self.capture.get(url)
            candidates.append((wiki_jacket(raw, url, song), page))
        if len({url for url, _ in candidates}) != 1:
            raise CaptureError(
                Failure(FailureKind.UNSUPPORTED, "Missing or ambiguous verified Wiki jacket")
            )
        url, page = candidates[0]
        raw, metadata = self.capture.get(url)
        return put(
            raw,
            metadata,
            {"song_id": sid, "page": page, "assertion": digest(song["metadata"]), "image": url},
        )
