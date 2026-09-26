"""Sanitized public metadata and exact source-page discovery for catalog updates."""

import json
import re
from typing import Any
from urllib.parse import parse_qs, urljoin, urlsplit

from .catalog_identity import label as identity_label
from .coverage_types import SnapshotError
from .mai_notes import parse_index
from .metadata_policy import number
from .transcription_html import CollectionInputError, _Document, _label, _Node, _walk

WIKI = "https://gamerch.com/maimai/"
SIMAI = "https://w.atwiki.jp/simai/pages/"
DIFFICULTIES = ("BASIC", "ADVANCED", "EXPERT", "MASTER", "RE:MASTER")
COUNT_FIELDS = ("tap", "hold", "slide", "touch", "break")


def mai_catalog(raw: bytes) -> tuple[dict[str, Any], str | None]:
    """Drop scores, player names and tags before any matching or public projection."""
    try:
        targets, generated = parse_index(raw)
    except SnapshotError as error:
        raise SnapshotError("Malformed mai-notes metadata: " + str(error)) from error
    data = json.loads(raw)
    for chart in data["charts"]:
        target = targets.get(chart["id"])
        if target is None:
            continue
        song = data["songs"][chart["song_id"]]
        target.update(
            bpm=number(song.get("bpm"), "bpm"),
            chart_constant=number(chart.get("internal_level"), "chart_constant"),
            # The provider's version field is not a constant-investigation version.
            region=None,
            release=None,
            wiki_url=WIKI + str(song["gamerch_id"])
            if re.fullmatch(r"[1-9][0-9]{0,8}", str(song.get("gamerch_id", "")))
            else None,
            simai_url=SIMAI + str(song["simai_id"]) + ".html"
            if re.fullmatch(r"[1-9][0-9]{0,5}", str(song.get("simai_id", "")))
            else None,
        )
        counts = {
            key: chart.get(source)
            for key, source in zip(
                COUNT_FIELDS, ("taps", "hold", "slide", "touch", "breaks"), strict=True
            )
        }
        target["note_counts"] = (
            counts if all(type(v) is int and 0 <= v <= 100000 for v in counts.values()) else None
        )
    return targets, generated


def wiki_url(href):
    parsed = urlsplit(urljoin(WIKI, href))
    url = parsed._replace(fragment="").geturl()
    return url if re.fullmatch(r"https://gamerch\.com/maimai/[1-9][0-9]{0,8}", url) else None


def page_links(raw: bytes) -> dict[str, set[str]]:
    root = _Document(raw.decode("utf-8")).root
    result = {}
    for node in _walk(root):
        if node.tag != "a":
            continue
        url = wiki_url(node.attrs.get("href", ""))
        if url:
            result.setdefault(identity_label(_label(node)), set()).add(url)
    return result


def discovery_pages(raw: bytes) -> set[str]:
    """Discover genre and release indexes from their semantic link labels/titles."""
    labels = {
        identity_label(s)
        for s in (
            "POPS&アニメ",
            "niconico&ボーカロイド",
            "東方Project",
            "ゲーム&バラエティ",
            "maimai",
            "オンゲキ&CHUNITHM",
            "配信順",
        )
    }
    root = _Document(raw.decode("utf-8")).root
    urls = set()
    for node in _walk(root):
        if node.tag != "a":
            continue
        url = wiki_url(node.attrs.get("href", ""))
        if url and (
            identity_label(_label(node)) in labels
            or "配信順楽曲リスト" in node.attrs.get("title", "")
        ):
            urls.add(url)
    if len(urls) > 40:
        raise SnapshotError("Wiki index budget exceeded")
    return urls


def wiki_label(node):
    # Footnote markers are annotations, not part of title/artist/number identities.
    def text(part):
        if isinstance(part, str):
            return part
        if part.tag == "br":
            return " "
        if part.tag == "a" and re.fullmatch(r"#notes_foot_[0-9]+", part.attrs.get("href", "")):
            return ""
        return "".join(text(child) for child in part.children)

    return " ".join(text(node).split())


def wiki_catalog(raw: bytes, url: str) -> tuple[list[dict[str, Any]], str | None]:
    """Read explicit constant and note-count columns, never derive decimals from Lv."""
    if not re.fullmatch(r"https://gamerch\.com/maimai/[1-9][0-9]{0,8}", url):
        raise SnapshotError("Invalid Wiki song URL")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise SnapshotError("Invalid Wiki metadata encoding") from error
    try:
        root = _Document(text).root
    except CollectionInputError as error:
        raise SnapshotError("Malformed Wiki metadata: " + str(error)) from error
    nodes = list(_walk(root))
    metadata = {}
    for node in nodes:
        if node.tag == "tr":
            cells = [c for c in node.children if isinstance(c, _Node) and c.tag in {"td", "th"}]
            if len(cells) == 2 and _label(cells[0]) in {"タイトル", "アーティスト", "BPM"}:
                field = _label(cells[0])
                if field in metadata:
                    raise SnapshotError("Ambiguous Wiki song metadata")
                metadata[field] = wiki_label(cells[1])
    if not metadata.get("タイトル") or not metadata.get("アーティスト"):
        raise SnapshotError("Wiki page lacks explicit song identity")
    rows, formats, current_format = [], set(), None
    for offset, node in enumerate(nodes):
        if node.tag in {"h2", "h3", "h4", "h5"}:
            label = _label(node)
            if "でらっくす譜面" in label:
                current_format = "DX"
            elif "通常譜面" in label or "スタンダード譜面" in label:
                current_format = "STD"
            elif node.tag in {"h2", "h3"}:
                current_format = None
        if node.tag != "table" or current_format is None:
            continue
        table = [n for n in _walk(node) if n.tag == "tr"]
        labels = [
            [wiki_label(c) for c in tr.children if isinstance(c, _Node) and c.tag in {"td", "th"}]
            for tr in table
        ]
        if not any("定数" in cells and "Lv" in cells for cells in labels):
            continue
        chart_rows = []
        colors = {
            "#98fb98": "BASIC",
            "#6fe163": "BASIC",
            "#ffa500": "ADVANCED",
            "#f8df3a": "ADVANCED",
            "#fa8080": "EXPERT",
            "#ff828e": "EXPERT",
            "#ee82ee": "MASTER",
            "#c27ff4": "MASTER",
            "#ffceff": "RE:MASTER",
            "#ed9cfb": "RE:MASTER",
        }
        for tr, cells in zip(table, labels, strict=True):
            if not cells or not re.fullmatch(r"(?:[0-9]|1[0-5])\+?", cells[0]):
                continue
            # Some STD-only pages keep blank DX template rows.
            if cells[0] == "0" and not any(cells[1:]):
                continue
            first = next(c for c in tr.children if isinstance(c, _Node) and c.tag in {"td", "th"})
            marker = re.search(
                r"background-color\s*:\s*(#[a-f0-9]+)", first.attrs.get("style", "").lower()
            )
            color = marker[1] if marker else None
            if color == "#00ced1":  # Historical EASY is not BASIC.
                continue
            if color not in colors:
                raise SnapshotError("Unknown Wiki difficulty marker")
            chart_rows.append((colors[color], cells))
        if not chart_rows:
            continue
        if [d for d, _ in chart_rows] not in [
            list(DIFFICULTIES[:4]),
            list(DIFFICULTIES),
        ] or current_format in formats:
            raise SnapshotError("Ambiguous or incomplete Wiki difficulty table")
        formats.add(current_format)
        release = None
        for following in nodes[offset + 1 :]:
            if following.tag in {"h2", "h3"}:
                break
            if following.tag == "p":
                match = re.search(r"定数調査(?:\s*[:：]\s*|\s+)(.+)", _label(following))
                if match:
                    release = match[1].strip()
                    break
        for difficulty, cells in chart_rows:
            width = 8 if current_format == "DX" else 7
            legacy_scores = current_format == "STD" and any("スコア" in row for row in labels)
            if len(cells) != width and not (legacy_scores and len(cells) in {9, 10}):
                raise SnapshotError("Unknown Wiki chart table layout")
            # STD omits TOUCH. Ignore its separate historical maximum-score columns.
            count_cells = cells[3:width]
            counts = None
            if all(re.fullmatch(r"[0-9]{1,6}", s) for s in count_cells):
                values = list(map(int, count_cells))
                if len(values) == 4:
                    values.insert(3, 0)
                counts = dict(zip(COUNT_FIELDS, values, strict=True))
                if not cells[2].isdigit() or sum(values) != int(cells[2]):
                    raise SnapshotError("Wiki note categories disagree with total")
            rows.append(
                {
                    "title": metadata["タイトル"],
                    "artist": metadata["アーティスト"],
                    "format": current_format,
                    "difficulty": difficulty,
                    "bpm": number(metadata.get("BPM"), "bpm"),
                    "chart_constant": number(cells[1], "chart_constant"),
                    "level": cells[0],
                    "note_counts": counts,
                    "region": "JP",
                    "release": release,
                    "source_url": url,
                    "evidence": "Exact Wiki variant, difficulty marker and constant column",
                }
            )
    if not rows:
        raise SnapshotError("Wiki page has no supported ordinary chart table")
    simai_urls = set()
    for node in nodes:
        if node.tag != "a" or "simai" not in _label(node).lower():
            continue
        try:
            target = urljoin(WIKI, node.attrs.get("href", ""))
            parsed = urlsplit(target)
        except ValueError as error:
            raise SnapshotError("Malformed Wiki source link") from error
        if parsed.netloc == "gamerch.com" and parsed.path == "/maimai/jump":
            target = parse_qs(parsed.query).get("url", [""])[0]
        if re.fullmatch(r"https://w\.atwiki\.jp/simai/pages/[1-9][0-9]{0,5}\.html", target):
            simai_urls.add(target)
    return rows, next(iter(simai_urls)) if len(simai_urls) == 1 else None
