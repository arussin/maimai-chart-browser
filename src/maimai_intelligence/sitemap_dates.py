"""Date final published page bytes without consulting a clock or changing catalogs."""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path
from urllib.parse import unquote

ORIGIN = "https://maimai.party"


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
    """Compare sealed HTML, carry prior dates, then date index entries from children.

    Read only the same named sitemap/page in the explicitly supplied previous release.
    An absent date stays absent unless a release date was explicitly supplied.
    """
    validate_release_date(release_date)
    maxima: dict[str, str] = {}
    namespace = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
    for name in sorted(assets):
        if re.fullmatch(r"sitemap(?:-[a-z-]+)?\.xml", name) is None:
            continue
        raw = re.sub(rb"<lastmod>[^<]*</lastmod>", b"", assets[name])
        assets[name] = raw
        root = ET.fromstring(raw)  # noqa: S314 - generated local sitemap, never fetched
        if root.tag != namespace + "urlset":
            continue
        prior: dict[str, str] = {}
        if previous is not None and (previous / name).is_file():
            old = ET.fromstring((previous / name).read_bytes())  # noqa: S314
            for node in old.findall(namespace + "url"):
                loc, modified = (
                    node.findtext(namespace + "loc"),
                    node.findtext(namespace + "lastmod"),
                )
                if loc and modified:
                    validate_release_date(modified)
                    prior[loc] = modified
        dates: dict[str, str] = {}
        for node in root.findall(namespace + "url"):
            loc = node.findtext(namespace + "loc")
            if not loc or not loc.startswith(ORIGIN + "/"):
                raise ValueError("Unexpected public sitemap origin")
            path = unquote(loc[len(ORIGIN) + 1 :])
            if path == "":
                path = "index.html"
            elif path.endswith("/"):
                path += "index.html"
            if path not in assets or ".." in path.split("/"):
                raise ValueError("Sitemap URL has no prepared public page")
            modified = release_date
            if previous is not None and loc in prior and (previous / path).is_file():
                if (path != "index.html" or home_catalog_unchanged) and (
                    previous / path
                ).read_bytes() == assets[path]:
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
        if dates:
            maxima[name] = max(dates.values())
    if "sitemap.xml" in assets:
        text = assets["sitemap.xml"].decode("utf-8")
        for name, modified in maxima.items():
            if name != "sitemap.xml":
                loc = f"<loc>{ORIGIN}/{name}</loc>"
                text = text.replace(loc, f"{loc}<lastmod>{modified}</lastmod>")
        assets["sitemap.xml"] = text.encode("utf-8")
