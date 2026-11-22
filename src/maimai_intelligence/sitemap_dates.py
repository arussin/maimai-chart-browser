"""Date published page content without consulting a clock or changing catalogs."""

from __future__ import annotations

import hashlib
import json
import re
import xml.etree.ElementTree as ET
from collections.abc import Callable
from datetime import date
from functools import lru_cache
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote

ORIGIN = "https://maimai.party"


def song_content(raw: bytes) -> str:
    """Hash own data, excluding artwork acquisition details and redundant fallbacks."""
    content = json.loads(raw)
    artwork = content.get("data", {}).get("artwork", {})
    for asset in artwork.get("assets", {}).values():
        for key in ("source", "source_sha256", "width", "height"):
            asset.pop(key, None)
    for song in artwork.get("songs", {}).values():
        fallback = {key: song.get(key) for key in ("path", "title", "artist")}
        regions = {}
        for region, row in song.get("regions", {}).items():
            # Match the artwork model's effective path/title/artist fallback.
            effective = {
                **row,
                **{
                    key: row.get(key, value) if row.get("path") else value
                    for key, value in fallback.items()
                },
            }
            if effective != fallback:
                regions[region] = effective
        song["regions"] = regions
    return hashlib.sha256(
        json.dumps(content, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def page_content(
    path: str, raw: bytes, song_digest: Callable[[str, str, int], str] | None = None
) -> bytes:
    """Comparison-only projection of maintained localized HTML, never application data.

    Keep page markup, text, metadata and own data references. Exclude the shared
    runtime envelope and catalog membership checksum; neither describes this page.
    Other sitemap pages retain the conservative exact-byte comparison.
    """
    if re.fullmatch(r"(?:en|ja|ko|zh-hans|id)/(?:songs|versions)/[^/]+/index\.html", path) is None:
        return raw

    class Content(HTMLParser):
        def __init__(self) -> None:
            super().__init__(convert_charrefs=True)
            self.tokens: list[object] = []
            self.skip_script = False

        def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
            values = dict(attrs)
            if tag == "script" and (
                values.get("id") == "browser-resources" or "data-maimai-browser" in values
            ):
                self.skip_script = True
                return
            if tag == "link" and (
                "stylesheet" in (values.get("rel") or "").lower().split()
                or "data-maimai-modulepreload" in values
            ):
                return
            if tag == "meta" and (
                (values.get("http-equiv") or "").lower() == "content-security-policy"
                or values.get("name") == "maimai-browser-base"
            ):
                return
            values.pop("data-catalog-sha256", None)
            if "data-song-binding" in values:
                binding = json.loads(values["data-song-binding"] or "")
                binding.pop("source_catalog_sha256", None)
                if song_digest is not None:
                    digest = song_digest(binding["path"], binding["sha256"], binding["bytes"])
                    for key in ("path", "sha256", "bytes"):
                        binding.pop(key)
                    binding["content_sha256"] = digest
                values["data-song-binding"] = json.dumps(binding, sort_keys=True)
            self.tokens.append((tag, sorted(values.items())))

        def handle_endtag(self, tag: str) -> None:
            if tag == "script" and self.skip_script:
                self.skip_script = False
            else:
                self.tokens.append(("end", tag))

        def handle_data(self, data: str) -> None:
            if not self.skip_script:
                self.tokens.append(("text", data))

    parser = Content()
    parser.feed(raw.decode("utf-8"))
    parser.close()
    return json.dumps(parser.tokens, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def song_content_reader(read: Callable[[str], bytes]) -> Callable[[str, str, int], str]:
    """Resolve only verified immutable song payloads; share work across locales."""

    @lru_cache(maxsize=4096)
    def digest(path: str, sha: str, size: int) -> str:
        if re.fullmatch(r"[a-f0-9]{64}", sha) is None or path != f"song-catalog/{sha}.json":
            raise ValueError("Invalid sitemap song content reference")
        raw = read(path)
        if len(raw) != size or hashlib.sha256(raw).hexdigest() != sha:
            raise ValueError("Sitemap song content integrity mismatch")
        return song_content(raw)

    return digest


def validate_release_date(value: str | None) -> str | None:
    if value is not None:
        if not isinstance(value, str) or re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value) is None:
            raise ValueError("Release date must be YYYY-MM-DD")
        date.fromisoformat(value)
    return value


def date_sitemaps(
    assets: dict[str, bytes],
    previous: Path | None,
    release_date: str | None,
    *,
    home_catalog_unchanged: bool = True,
) -> None:
    """Compare page content, carry prior dates, then date index entries from children.

    Read only the same named sitemap/page in the explicitly supplied previous release.
    An absent date stays absent unless a release date was explicitly supplied.
    """
    validate_release_date(release_date)
    maxima: dict[str, str] = {}
    namespace = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
    prior_index: dict[str, str] = {}
    if previous is not None and (previous / "sitemap.xml").is_file():
        index = ET.fromstring((previous / "sitemap.xml").read_bytes())  # noqa: S314
        for node in index.findall(namespace + "sitemap"):
            loc = node.findtext(namespace + "loc")
            modified = node.findtext(namespace + "lastmod")
            if loc and modified:
                validate_release_date(modified)
                prior_index[loc] = modified
    current_song = song_content_reader(assets.__getitem__)
    previous_song = (
        song_content_reader(lambda name: (previous / name).read_bytes()) if previous else None
    )
    for name in sorted(assets):
        if re.fullmatch(r"sitemap(?:-[a-z-]+)?\.xml", name) is None:
            continue
        raw = re.sub(rb"<lastmod>[^<]*</lastmod>", b"", assets[name])
        assets[name] = raw
        root = ET.fromstring(raw)  # noqa: S314 - generated local sitemap, never fetched
        if root.tag != namespace + "urlset":
            continue
        prior: dict[str, str] = {}
        prior_urls: set[str] = set()
        if previous is not None and (previous / name).is_file():
            old = ET.fromstring((previous / name).read_bytes())  # noqa: S314
            for node in old.findall(namespace + "url"):
                loc, modified = (
                    node.findtext(namespace + "loc"),
                    node.findtext(namespace + "lastmod"),
                )
                if loc:
                    prior_urls.add(loc)
                if loc and modified:
                    validate_release_date(modified)
                    prior[loc] = modified
        dates: dict[str, str] = {}
        urls: set[str] = set()
        for node in root.findall(namespace + "url"):
            loc = node.findtext(namespace + "loc")
            if not loc or not loc.startswith(ORIGIN + "/"):
                raise ValueError("Unexpected public sitemap origin")
            urls.add(loc)
            path = unquote(loc[len(ORIGIN) + 1 :])
            if path == "":
                path = "index.html"
            elif path.endswith("/"):
                path += "index.html"
            if path not in assets or ".." in path.split("/"):
                raise ValueError("Sitemap URL has no prepared public page")
            modified = release_date
            if previous is not None and loc in prior and (previous / path).is_file():
                if (path != "index.html" or home_catalog_unchanged) and page_content(
                    path, (previous / path).read_bytes(), previous_song
                ) == page_content(path, assets[path], current_song):
                    modified = prior[loc]
            if modified:
                dates[loc] = modified
        # Preserve the generator's exact formatting when dates are omitted.
        text = raw.decode("utf-8")
        for loc, modified in dates.items():
            text = text.replace(
                f"<loc>{loc}</loc>", f"<loc>{loc}</loc><lastmod>{modified}</lastmod>"
            )
        assets[name] = text.encode("utf-8")
        # A removed URL changes the child even if every remaining page is old.
        # Never advertise an old maximum while a changed/new page has no date.
        removed = bool(prior_urls - urls)
        if dates and len(dates) == len(urls) and (not removed or release_date):
            maxima[name] = max(
                [*dates.values(), *([release_date] if removed and release_date else [])]
            )
            prior_modified = prior_index.get(f"{ORIGIN}/{name}")
            if (
                previous is not None
                and prior_modified
                and (previous / name).is_file()
                and (previous / name).read_bytes() == assets[name]
            ):
                maxima[name] = prior_modified
    if "sitemap.xml" in assets:
        text = assets["sitemap.xml"].decode("utf-8")
        for name, modified in maxima.items():
            if name != "sitemap.xml":
                loc = f"<loc>{ORIGIN}/{name}</loc>"
                text = text.replace(loc, f"{loc}<lastmod>{modified}</lastmod>")
        assets["sitemap.xml"] = text.encode("utf-8")
