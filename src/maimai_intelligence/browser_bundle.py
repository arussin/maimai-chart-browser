"""Verified packaged browser graph and data-only configuration, shared by both renderers."""

from __future__ import annotations

import hashlib
import json
import re
from base64 import b64encode
from collections.abc import Callable
from dataclasses import asdict, dataclass
from importlib.resources import files
from pathlib import Path, PurePosixPath
from typing import Any

from .localization import localization_data
from .snapshots import canonical
from .song_search import song_search_data

RESOURCE_FILE = "browser-resources.json"
STATIC_RESOURCES = (
    "challenge-review.css",
    "seo-pages.css",
    "localization.js",
    "localization.css",
    "support-config.js",
    "support-client.js",
    "support-stripe.js",
    "support-checkout.css",
    "support-page.js",
    "support-page.css",
    "site-brand.css",
    "support-footer.css",
    "support-return.js",
    "stripe-wordmark.svg",
    "player-import-help.css",
    "maishift-favicon.ico",
)


@dataclass(frozen=True)
class BrowserResourceReference:
    path: str
    sha256: str
    bytes: int


@dataclass(frozen=True)
class BrowserResources:
    entry: BrowserResourceReference
    configuration: BrowserResourceReference
    shell: BrowserResourceReference
    catalog: BrowserResourceReference
    styles: BrowserResourceReference
    permalinks: BrowserResourceReference | None = None
    seoStyle: BrowserResourceReference | None = None
    version: int = 1

    def record(self) -> dict[str, Any]:
        return asdict(self)


def validate_browser_resources(value: Any) -> BrowserResources:
    """Validate the complete hosted-document contract, including immutable names."""
    if (
        not isinstance(value, dict)
        or set(value)
        != {
            "version",
            "entry",
            "configuration",
            "shell",
            "catalog",
            "styles",
            "permalinks",
            "seoStyle",
        }
        or type(value["version"]) is not int
        or value["version"] != 1
    ):
        raise ValueError("Invalid browser resources")

    def reference(name: str, extension: str, maximum: int) -> BrowserResourceReference:
        row = value[name]
        if (
            not isinstance(row, dict)
            or set(row) != {"path", "sha256", "bytes"}
            or not isinstance(row["sha256"], str)
            or not re.fullmatch(r"[a-f0-9]{64}", row["sha256"])
            or type(row["bytes"]) is not int
            or not 0 < row["bytes"] <= maximum
            or not isinstance(row["path"], str)
        ):
            raise ValueError("Invalid browser resource reference")
        if name == "entry":
            valid = re.fullmatch(r"browser/[A-Za-z0-9][A-Za-z0-9._-]*\.js", row["path"])
        else:
            valid = row["path"] == f"browser-resources/{row['sha256']}.{extension}"
        if not valid:
            raise ValueError("Invalid immutable browser resource path")
        return BrowserResourceReference(row["path"], row["sha256"], row["bytes"])

    return BrowserResources(
        entry=reference("entry", "js", 2 * 1024 * 1024),
        configuration=reference("configuration", "json", 4 * 1024 * 1024),
        shell=reference("shell", "html", 2 * 1024 * 1024),
        catalog=reference("catalog", "json", 1024 * 1024),
        styles=reference("styles", "css", 2 * 1024 * 1024),
        permalinks=reference("permalinks", "json", 2 * 1024 * 1024)
        if value["permalinks"] is not None
        else None,
        seoStyle=reference("seoStyle", "css", 2 * 1024 * 1024)
        if value["seoStyle"] is not None
        else None,
    )


def _bind_resource_document(
    raw: bytes, references: dict[str, BrowserResourceReference], resources: BrowserResources | None
) -> bytes:
    """Bind only declared resource attributes in maintained generated documents."""
    html = raw.decode("utf-8")
    for name, reference in references.items():
        pattern = r'((?<![\w-])(?:src|href)=")(/?)' + re.escape(name) + r'(?:\?v=[^"<>]*)?"'
        html = re.sub(
            pattern,
            lambda match, reference=reference: match[1] + match[2] + reference.path + '"',
            html,
        )
    styles = {ref.path: ref for ref in references.values() if ref.path.endswith(".css")}

    def stylesheet(match: re.Match[str]) -> str:
        tag = match[0]
        href = re.search(r'\bhref="/?([^"<>]+)"', tag)
        if 'rel="stylesheet"' not in tag or href is None or href[1] not in styles:
            return tag
        reference = styles[href[1]]
        integrity = "sha256-" + b64encode(bytes.fromhex(reference.sha256)).decode("ascii")
        tag = re.sub(r'\s+integrity="[^"<>]*"', "", tag)
        return tag[:-1] + f' integrity="{integrity}">'

    html = re.sub(r"<link\b[^<>]*>", stylesheet, html)
    entry = re.compile(r'<script type="module" data-maimai-browser src="(/?)[^"<>]+"></script>')
    if resources is not None and "data-maimai-browser" in html:
        html = re.sub(
            r'<script type="application/json" id="browser-resources">[^<]*</script>', "", html
        )
        payload = canonical(resources.record()).decode("utf-8").replace("<", "\\u003c")
        html, count = entry.subn(
            lambda match: (
                '<script type="application/json" id="browser-resources">'
                + payload
                + '</script><script type="module" data-maimai-browser src="'
                + match[1]
                + resources.entry.path
                + '"></script>'
            ),
            html,
        )
        if count != 1:
            raise ValueError("Expected one maintained browser entry")
        if html.count('id="browser-resources"') != 1:
            raise ValueError("Expected one browser resource descriptor")
    return html.encode("utf-8")


def seal_browser_resources(assets: dict[str, bytes], manifest: dict[str, Any]) -> dict[str, bytes]:
    """Name final bytes, then bind every activating document to one resource set.

    Logical root files remain explicit compatibility aliases. Hosted clients use
    their embedded descriptor, never a mutable descriptor lookup at startup.
    This runs again after publication metadata and the final catalog directory
    are prepared; shell bytes cannot contain their own activation descriptor.
    """
    if "browser-assets.json" not in assets:
        return dict(assets)
    result = dict(assets)
    graph, _ = read_browser_assets(lambda name, _limit: result[name])
    entry_path = graph["entries"]["hosted"]
    entry = BrowserResourceReference(entry_path, **graph["assets"][entry_path])

    def retain(raw: bytes, extension: str) -> BrowserResourceReference:
        sha = hashlib.sha256(raw).hexdigest()
        path = f"browser-resources/{sha}.{extension}"
        if path in result and result[path] != raw:
            raise ValueError("Immutable browser resource differs")
        result[path] = raw
        return BrowserResourceReference(path, sha, len(raw))

    references = {
        name: retain(result[name], name.rsplit(".", 1)[1])
        for name in STATIC_RESOURCES
        if name in result
    }
    if RESOURCE_FILE in result:
        previous = validate_browser_resources(json.loads(result[RESOURCE_FILE]))
        references[previous.styles.path] = references["challenge-review.css"]
        if previous.seoStyle is not None and "seo-pages.css" in references:
            references[previous.seoStyle.path] = references["seo-pages.css"]
    shell = _bind_resource_document(result["browser-shell.html"], references, None)
    if b"data-maimai-browser" in shell or b'id="browser-resources"' in shell:
        raise ValueError("Browser shell must not activate another application")
    result["browser-shell.html"] = shell
    resources = BrowserResources(
        entry=entry,
        configuration=retain(result["browser-config.json"], "json"),
        shell=retain(shell, "html"),
        catalog=retain(canonical(manifest) + b"\n", "json"),
        styles=references["challenge-review.css"],
        permalinks=retain(result["permalinks.json"], "json")
        if "permalinks.json" in result
        else None,
        seoStyle=references.get("seo-pages.css"),
    )
    validate_browser_resources(resources.record())
    for name, raw in list(result.items()):
        if name.endswith(".html") and not name.startswith("browser-resources/"):
            result[name] = _bind_resource_document(raw, references, resources)
    result[RESOURCE_FILE] = canonical(resources.record()) + b"\n"
    return result


def browser_configuration(*, player_pilot=False, player_maishift=False):
    assets = files("maimai_intelligence.assets")
    return {
        **localization_data(),
        "search": song_search_data(),
        "theme": json.loads(assets.joinpath("chart-theme.json").read_text("utf-8")),
        "lessons": json.loads(assets.joinpath("pattern-lessons.json").read_text("utf-8")),
        "features": {"maishift": bool(player_maishift or player_pilot)},
        "support": json.loads(assets.joinpath("support-config.json").read_text("utf-8")),
        "pilot": bool(player_pilot),
    }


def read_browser_assets(
    read: Callable[[str, int], bytes],
) -> tuple[dict[str, Any], dict[str, bytes]]:
    """Validate one generated dependency graph using a bounded byte reader."""
    raw = read("browser-assets.json", 256 * 1024)
    manifest = json.loads(raw)
    if (
        not isinstance(manifest, dict)
        or set(manifest) != {"version", "tool", "entries", "assets", "replaces"}
        or manifest["version"] != 1
        or not isinstance(manifest["tool"], str)
        or not isinstance(manifest["entries"], dict)
        or set(manifest["entries"]) != {"hosted", "offline"}
        or not isinstance(manifest["assets"], dict)
        or not 2 <= len(manifest["assets"]) <= 128
        or not isinstance(manifest["replaces"], list)
        or not all(isinstance(name, str) for name in manifest["replaces"])
        or len(set(manifest["replaces"])) != len(manifest["replaces"])
        or not all(
            isinstance(name, str) and name in manifest["assets"]
            for name in manifest["entries"].values()
        )
    ):
        raise ValueError("Invalid generated browser dependency manifest")
    assets = {}
    for name, record in manifest["assets"].items():
        if (
            not re.fullmatch(r"browser/[A-Za-z0-9][A-Za-z0-9._-]*\.js", name)
            or not isinstance(record, dict)
            or set(record) != {"sha256", "bytes"}
            or not isinstance(record["sha256"], str)
            or not re.fullmatch(r"[a-f0-9]{64}", record["sha256"])
            or type(record["bytes"]) is not int
            or not 0 < record["bytes"] <= 2 * 1024 * 1024
        ):
            raise ValueError("Invalid generated browser asset reference")
        body = read(name, 2 * 1024 * 1024)
        if len(body) != record["bytes"] or hashlib.sha256(body).hexdigest() != record["sha256"]:
            raise ValueError("Generated browser asset integrity mismatch")
        assets[name] = body
    assets["browser-assets.json"] = raw
    return manifest, assets


def browser_assets():
    assets = files("maimai_intelligence.assets")

    def read(name, limit):
        with assets.joinpath(*PurePosixPath(name).parts).open("rb") as stream:
            raw = stream.read(limit + 1)
        if len(raw) > limit:
            raise ValueError("Packaged browser asset exceeds its size limit")
        return raw

    return read_browser_assets(read)


def offline_script():
    manifest, assets = browser_assets()
    return assets[manifest["entries"]["offline"]].decode("utf-8")


def write_browser_assets(output, *, player_pilot=False, player_maishift=False):
    manifest, assets = browser_assets()
    root = Path(output)
    for name, data in assets.items():
        target = root.joinpath(*PurePosixPath(name).parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    (root / "browser-config.json").write_bytes(
        canonical(browser_configuration(player_pilot=player_pilot, player_maishift=player_maishift))
    )
    return manifest
