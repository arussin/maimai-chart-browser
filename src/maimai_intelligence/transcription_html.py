"""Bounded, offline discovery of public Simai collection HTML.

Indexes advertise variants; a level or colored cell does not prove a usable body.
References: https://w.atwiki.jp/simai/pages/32.html , /808.html and /31.html.
This module has no network access and never repairs chart notation.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from functools import lru_cache
from html.parser import HTMLParser
from urllib.parse import unquote, urljoin, urlsplit

MAX_HTML_BYTES = 4 * 1024 * 1024
MAX_NODES = 150_000
MAX_DEPTH = 96
MAX_ROWS = 30_000
_VOID = {
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
}
_IGNORE = {"script", "style", "form", "noscript", "iframe", "button", "select", "textarea"}
_HEADINGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
_DIFFICULTIES = {
    "ESY": "EASY",
    "EASY": "EASY",
    "BSC": "BASIC",
    "BASIC": "BASIC",
    "ADV": "ADVANCED",
    "ADVANCED": "ADVANCED",
    "EXP": "EXPERT",
    "EXPERT": "EXPERT",
    "MAS": "MASTER",
    "MASTER": "MASTER",
    "RE:MAS": "RE:MASTER",
    "RE:MASTER": "RE:MASTER",
}


class CollectionInputError(ValueError):
    """Malformed or oversized discovery input, never a partially accepted page."""


@dataclass
class _Node:
    tag: str
    attrs: dict[str, str]
    children: list = field(default_factory=list)
    comment_list: bool = False


def _ignored(node: _Node) -> bool:
    labels = node.attrs.get("id", "") + " " + node.attrs.get("class", "")
    widgets = {
        "atwiki-page-tags",
        "atwiki-liked-counter",
        "atwiki-page-keyword",
        "atwiki-lastmodify",
    }
    return (
        node.comment_list
        or bool(widgets.intersection(labels.split()))
        or node.tag in _IGNORE
        or bool(re.search(r"(?:^|[ _-])comments?(?:$|[ _-])", labels, re.I))
    )


class _Document(HTMLParser):
    def __init__(self, html: str):
        super().__init__(convert_charrefs=True)
        if not isinstance(html, str) or len(html.encode("utf-8")) > MAX_HTML_BYTES:
            raise CollectionInputError("HTML exceeds the four-MiB input limit")
        self.root = _Node("document", {})
        self.stack = [self.root]
        self.nodes = 0
        self.feed(html)
        self.close()

    def handle_starttag(self, tag, attrs):
        self.nodes += 1
        if self.nodes > MAX_NODES or len(self.stack) > MAX_DEPTH:
            raise CollectionInputError("HTML structure exceeds the bounded parser limit")
        node = _Node(tag, {k: v or "" for k, v in attrs})
        self.stack[-1].children.append(node)
        if tag not in _VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in _VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                return

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def _walk(node):
    if isinstance(node, str) or _ignored(node):
        return
    yield node
    for child in node.children:
        yield from _walk(child)


def _body(html):
    document = _Document(html)
    matches = [n for n in _walk(document.root) if n.attrs.get("id") == "wikibody"]
    if len(matches) != 1:
        raise CollectionInputError("Expected exactly one wikibody content region")
    root = matches[0]
    # The plugin's unclassed UL is immediately before its identified form.
    # Ordinary lists/prose remain visible and can make a source fail parsing.
    for parent in list(_walk(root)):
        for index, child in enumerate(parent.children):
            if (
                not isinstance(child, _Node)
                or "plugin_comment" not in child.attrs.get("class", "").split()
            ):
                continue
            for previous in reversed(parent.children[:index]):
                if isinstance(previous, str):
                    if not previous.strip():
                        continue
                    break
                if previous.tag == "br":
                    continue
                if previous.tag == "ul":
                    previous.comment_list = True
                break
    return root


def _text(node):
    if isinstance(node, str):
        return node
    if _ignored(node):
        return ""
    if node.tag == "br":
        return "\n"
    content = "".join(_text(child) for child in node.children)
    return content + ("\n" if node.tag in {"p", "div", "pre", "li"} else "")


def _label(node):
    return " ".join(_text(node).split())


def _difficulty(label):
    return _DIFFICULTIES.get(re.sub(r"\s+", "", label).upper())


def _format(label):
    value = label.upper()
    std = "スタンダード" in label or "STANDARD" in value or value.strip() == "STD"
    dx = "でらっくす" in label or "DELUXE" in value or value.strip() == "DX"
    return "STD" if std and not dx else "DX" if dx and not std else None


def _links(node):
    result = []
    for link in _walk(node):
        if link.tag != "a":
            continue
        url = urlsplit(urljoin("https://w.atwiki.jp/simai/", link.attrs.get("href", "")))
        match = re.fullmatch(r"/simai/pages/([1-9][0-9]{0,5})\.html", url.path)
        if (
            url.netloc == "w.atwiki.jp"
            and url.scheme in {"http", "https"}
            and not url.query
            and match
        ):
            result.append((int(match[1]), unquote(url.fragment) or None))
    return list(dict.fromkeys(result))


def _hint(cell):
    style = re.sub(r"\s+", "", cell.attrs.get("style", "").lower())
    return bool(re.search(r"background(?:-color)?:(?:#ffdd44|#fd4|orange)(?:;|$)", style))


def discover_indexes(indexes: dict[int, str]) -> dict:
    """Return advertised variant rows and canonical page IDs without fetching.

    Rows include missing-body candidates. Duplicate canonical variants retain all
    index associations. Event rows keep their own identity and unresolved format.
    """
    if not isinstance(indexes, dict) or set(indexes) - {32, 808}:
        raise CollectionInputError("Only the explicit Standard32 and DX808 indexes are supported")
    records = {}
    pages = set()
    duplicates = 0
    diagnostics = []
    for index_page, html in sorted(indexes.items()):
        root = _body(html)
        section = ""
        table_number = 0
        for node in _walk(root):
            if node.tag in _HEADINGS:
                section = _label(node)
            if node.tag != "table":
                continue
            table_number += 1
            columns = None
            event = False
            subsection = ""
            table_rows = [n for n in node.children if isinstance(n, _Node) and n.tag == "tr"]
            if not table_rows:
                table_rows = [n for n in _walk(node) if n.tag == "tr"]
            for row_number, tr in enumerate(table_rows, 1):
                cells = [n for n in tr.children if isinstance(n, _Node) and n.tag in {"td", "th"}]
                labels = [_label(c) for c in cells]
                if not labels:
                    continue
                if labels[0].upper() == "TITLE":
                    event = "属性" in labels
                    columns = labels if event or any(_difficulty(x) for x in labels[1:]) else None
                    continue
                if len(cells) == 1:
                    subsection = labels[0]
                    continue
                title = labels[0]
                title_links = _links(cells[0])
                unheaded_levels = len(labels) > 1 and all(
                    re.fullmatch(r"(?:-|[0-9]{1,2}\+?)", value) for value in labels[1:]
                )
                if columns is None and not title_links and not unheaded_levels:
                    continue
                title_id = title_links[0][0] if len(title_links) == 1 else None
                for page_id, _ in title_links:
                    pages.add(page_id)
                if columns is None or len(cells) != len(columns):
                    issue = "missing_table_header" if columns is None else "column_count_mismatch"
                    key = ("unresolved", index_page, table_number, row_number)
                    digest = hashlib.sha256(repr(key).encode("utf-8")).hexdigest()[:20]
                    association = {
                        "index_page": index_page,
                        "section": section,
                        "subsection": subsection,
                        "table": table_number,
                        "row": row_number,
                        "cell": None,
                    }
                    records[key] = {
                        "input_id": "simai-" + digest,
                        "stable_input_id": "simai-" + digest,
                        "title": title,
                        "difficulty": "UNRESOLVED",
                        "format": "unresolved",
                        "level": None,
                        "source_page_id": title_id,
                        "title_page_id": title_id,
                        "source_anchor": None,
                        **association,
                        "associations": [association],
                        "supplied_hint": any(_hint(c) for c in cells[1:]),
                        "identity_resolved": False,
                        "original_cells": labels,
                        "discovery_reason": issue,
                    }
                    diagnostics.append(
                        {
                            **association,
                            "reason": issue,
                            "header_columns": len(columns) if columns else 0,
                            "row_columns": len(cells),
                        }
                    )
                    continue
                selected = (
                    [(1, "UTAGE")]
                    if event
                    else [
                        (i, _difficulty(column))
                        for i, column in enumerate(columns)
                        if _difficulty(column)
                    ]
                )
                for cell_number, difficulty in selected:
                    level = (
                        (labels[columns.index("LEVEL")] if "LEVEL" in columns else None)
                        if event
                        else labels[cell_number]
                    )
                    if not event and level in {"-", "－", "—", ""}:
                        continue
                    cell = cells[cell_number]
                    destinations = _links(cell)
                    if event:
                        if "LEVEL" in columns:
                            destinations += _links(cells[columns.index("LEVEL")])
                        destinations = list(dict.fromkeys(destinations))
                    for page_id, _ in destinations:
                        pages.add(page_id)
                    destination = destinations[0] if len(destinations) == 1 else (title_id, None)
                    source_id, anchor = destination
                    association = {
                        "index_page": index_page,
                        "section": section,
                        "subsection": subsection,
                        "table": table_number,
                        "row": row_number,
                        "cell": cell_number,
                        "title": title,
                        "level": level,
                        "supplied_hint": any(_hint(c) for c in cells[1:]) if event else _hint(cell),
                    }
                    format_name = "unresolved" if event else "STD" if index_page == 32 else "DX"
                    key = (
                        (source_id, difficulty, format_name, anchor)
                        if source_id and not event
                        else ("index", index_page, table_number, row_number, cell_number)
                    )
                    if key in records:
                        records[key]["associations"].append(association)
                        records[key]["supplied_hint"] |= association["supplied_hint"]
                        duplicates += 1
                        continue
                    digest = hashlib.sha256(repr(key).encode("utf-8")).hexdigest()[:20]
                    records[key] = {
                        "input_id": "simai-" + digest,
                        "stable_input_id": "simai-" + digest,
                        "title": title,
                        "difficulty": difficulty,
                        "format": format_name,
                        "level": level,
                        "source_page_id": source_id,
                        "title_page_id": title_id,
                        "source_anchor": anchor,
                        **association,
                        "associations": [association],
                        "event_attribute": labels[1] if event else None,
                        "identity_resolved": not event
                        and source_id is not None
                        and len(destinations) <= 1,
                    }
                    if len(records) > MAX_ROWS:
                        raise CollectionInputError("Index inventory exceeds30000 variant rows")
    if len(records) > MAX_ROWS:
        raise CollectionInputError("Index inventory exceeds30000 variant rows")
    page_formats = {}
    for record in records.values():
        page = record.get("source_page_id")
        if page and record["format"] in {"STD", "DX"}:
            page_formats.setdefault(page, set()).add(record["format"])
    for record in records.values():
        record["source_page_formats"] = sorted(
            page_formats.get(record.get("source_page_id"), set())
        )
    return {
        "inventory_rows": list(records.values()),
        "page_ids": sorted(pages),
        "duplicate_associations": duplicates,
        "index_pages": sorted(indexes),
        "diagnostics": diagnostics,
    }


@lru_cache(maxsize=1)
def _prepared_page(page_html: str):
    """Retain at most one bounded page tree for its adjacent difficulty requests."""
    root = _body(page_html)
    sequence = list(_walk(root))
    headings = []
    contexts = []
    preceding_anchors = {}
    pending = set()

    def bind_anchors(node):
        # Atwiki uses both empty DIV wrappers and anchors at the very end of
        # the previous DIV. Container closure/blank BRs add no visible content.
        # Visible text or a nontransparent element breaks the association.
        if isinstance(node, str):
            if node.strip():
                pending.clear()
            return
        if _ignored(node):
            return
        if node.tag in _HEADINGS:
            preceding_anchors[id(node)] = set(pending)
            pending.clear()
            return
        if node.tag == "a" and not _label(node):
            pending.update(v for v in (node.attrs.get("name"), node.attrs.get("id")) if v)
            return
        transparent = node.tag in {"a", "br", "div", "p", "span"}
        if not transparent:
            pending.clear()
        for child in node.children:
            bind_anchors(child)
        if not transparent:
            pending.clear()

    bind_anchors(root)
    for i, node in enumerate(sequence):
        if node.tag not in _HEADINGS:
            continue
        level = int(node.tag[1])
        while contexts and contexts[-1][0] >= level:
            contexts.pop()
        label = _label(node)
        own_format = _format(label)
        context = own_format or (contexts[-1][1] if contexts else None)
        if own_format:
            contexts.append((level, own_format))
        anchors = {node.attrs.get("id"), node.attrs.get("name")}
        anchors.update(
            n.attrs.get("name") or n.attrs.get("id") for n in _walk(node) if n.tag == "a"
        )
        anchors.update(preceding_anchors.get(id(node), set()))
        headings.append(
            {
                "node": node,
                "offset": i,
                "level": level,
                "label": label,
                "format": context,
                "anchors": anchors,
                "instance": len(headings) + 1,
            }
        )
    return root, sequence, headings


def extract_chart(page_html: str, row: dict) -> dict:
    """Extract one proven heading's visible text, modifying whitespace only."""
    result = {
        "body": None,
        "reason": None,
        "source_heading": None,
        "heading_instance": None,
        "identity_resolved": False,
        "anchor_status": "not_supplied",
        "identity_resolution": None,
    }
    if row.get("format") not in {"STD", "DX"} or row.get("difficulty") == "UTAGE":
        return result | {"reason": "event_or_format_identity_unresolved"}
    if row.get("identity_resolved") is False:
        return result | {"reason": "index_link_identity_unresolved"}
    root, sequence, headings = _prepared_page(page_html)
    candidates = [h for h in headings if _difficulty(h["label"]) == row.get("difficulty")]
    anchor = row.get("source_anchor")
    if anchor:
        anchored = [h for h in candidates if anchor in h["anchors"]]
        if len(anchored) == 1:
            candidates = anchored
            result["anchor_status"] = "matched"
        elif len(anchored) > 1:
            return result | {"reason": "ambiguous_heading_anchor", "anchor_status": "ambiguous"}
        elif any(anchor in {n.attrs.get("id"), n.attrs.get("name")} for n in sequence):
            return result | {"reason": "anchor_target_mismatch", "anchor_status": "conflicting"}
        else:
            # Old index fragments often predate generated heading IDs. A dead
            # fragment is only a lookup hint: independent format/label evidence
            # must still identify one body. Existing conflicting targets reject.
            result["anchor_status"] = "stale"
    if len(candidates) > 1:
        scoped = [h for h in candidates if h["format"] == row["format"]]
        if not scoped:
            return result | {"reason": "ambiguous_heading"}
        candidates = scoped
    if len(candidates) != 1:
        return result | {"reason": "missing_heading" if not candidates else "ambiguous_heading"}
    chosen = candidates[0]
    if chosen["format"] is not None and chosen["format"] != row["format"]:
        return result | {"reason": "heading_format_mismatch"}
    if chosen["format"] is None and result["anchor_status"] != "matched":
        page_formats = row.get("source_page_formats")
        explicit_formats = {h["format"] for h in headings if h["format"] is not None}
        if (
            (page_formats is not None and page_formats != [row["format"]])
            or bool(explicit_formats - {row["format"]})
            or (result["anchor_status"] == "stale" and page_formats != [row["format"]])
        ):
            return result | {"reason": "heading_format_unresolved"}
    result.update(
        source_heading=chosen["label"],
        heading_instance=chosen["instance"],
        identity_resolved=True,
        identity_resolution="anchor" if result["anchor_status"] == "matched" else "unique_heading",
    )
    ending = next(
        (
            h["offset"]
            for h in headings
            if h["offset"] > chosen["offset"] and h["level"] <= chosen["level"]
        ),
        len(sequence),
    )
    # Traverse the original tree once so nested text is neither duplicated nor lost.
    active = False
    chunks = []
    stop_nodes = {id(n) for n in sequence[ending:]}

    def collect(node):
        nonlocal active
        if isinstance(node, str):
            if active:
                chunks.append(node)
            return
        if id(node) in stop_nodes:
            active = False
            return
        if _ignored(node):
            return
        if node is chosen["node"]:
            active = True
            return
        if node.tag == "br" and active:
            chunks.append("\n")
        for child in node.children:
            collect(child)
        if active and node.tag in {"p", "div", "pre", "li"}:
            chunks.append("\n")

    collect(root)
    body = "\n".join(line.strip() for line in "".join(chunks).splitlines() if line.strip())
    if not body:
        return result | {"reason": "empty_body"}
    return result | {"body": body + "\n", "reason": "extracted"}
