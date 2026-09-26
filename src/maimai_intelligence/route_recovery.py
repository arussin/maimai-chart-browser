"""Finite static recovery pages transformed from hash-bound prepared public pages.

This is an artifact adapter, not a second song renderer or a route fallback.
The baseline reader owns historical catalog adaptation; the pure policy owns
which exact chart identities may lead back into that retained browser.
"""

from __future__ import annotations

import hashlib
import re
from base64 import b64encode
from collections.abc import Mapping
from dataclasses import asdict, dataclass
from html import escape
from html.parser import HTMLParser
from types import MappingProxyType
from typing import Any
from urllib.parse import urlencode

from .browser_bundle import BrowserResourceReference, BrowserResources, validate_browser_resources
from .catalog_document import decode_catalog_document
from .public_routes import LOCALES, parse_route
from .recovery_policy import ChartRecoveryDecision, decide_chart_recovery
from .seo import ORIGIN, EmittedPublicRoute, PreparedSEO
from .serialization import canonical

Attributes = dict[str, str | None]
MAX_DOCUMENT_BYTES = 2 * 1024 * 1024
POLICY = (
    "default-src 'none'; script-src 'none'; connect-src 'none'; style-src 'self'; "
    "img-src 'self' data:; base-uri 'none'; form-action 'none'; object-src 'none'"
)
NOTICES = {
    "en": "Temporary public view. Interactive tools are available through supported chart links.",
    "ja": "一時的な公開情報表示です。対応する譜面リンクからブラウザーの機能を利用できます。",
    "ko": "임시 공개 정보 화면입니다. 지원되는 채보 링크에서 브라우저 기능을 이용할 수 있습니다.",
    "zh-hans": "这是临时公开信息页面。可通过支持的谱面链接使用浏览器功能。",
}
UNAVAILABLE = {
    "en": "Public information only; this chart is unavailable in the retained browser.",
    "ja": "公開情報のみ。この譜面は保持されているブラウザーでは利用できません。",
    "ko": "공개 정보만 표시됩니다. 이 채보는 보존된 브라우저에서 사용할 수 없습니다.",
    "zh-hans": "仅显示公开信息；保留的浏览器中没有此谱面。",
}


@dataclass(frozen=True)
class RecoveryDocument:
    path: str
    filename: str
    content: bytes
    original_sha256: str
    sha256: str


@dataclass(frozen=True)
class PreparedRouteRecovery:
    documents: tuple[RecoveryDocument, ...]
    evidence: bytes
    evidence_sha256: str
    candidate_inventory_sha256: str
    baseline_inventory_sha256: str

    @property
    def assets(self) -> Mapping[str, bytes]:
        return MappingProxyType(
            {document.filename: document.content for document in self.documents}
        )


def _sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _verify_routes(prepared: PreparedSEO) -> tuple[EmittedPublicRoute, ...]:
    records = prepared.emitted_routes
    if not isinstance(records, tuple):
        raise ValueError("Emitted public routes must be an immutable tuple")
    paths: set[str] = set()
    filenames: set[str] = set()
    aliases: set[str] = set()
    for record in records:
        if not isinstance(record, EmittedPublicRoute):
            raise ValueError("Expected an emitted public route")
        parsed = parse_route(record.path)
        if (
            parsed is None
            or parsed.locale != record.locale
            or parsed.kind != record.kind + "s"
            or record.filename != parsed.filename
            or not isinstance(record.chart_ids, tuple)
            or (record.kind == "song" and not record.chart_ids)
            or (record.kind == "version" and record.chart_ids)
        ):
            raise ValueError("Invalid emitted public route")
        if record.path in paths or record.filename.casefold() in aliases:
            raise ValueError("Duplicate emitted public route")
        raw = prepared.assets.get(record.filename)
        if not isinstance(raw, bytes) or not 0 < len(raw) <= MAX_DOCUMENT_BYTES:
            raise ValueError("Missing or oversized original public document")
        if _sha(raw) != record.html_sha256:
            raise ValueError("Original public document integrity mismatch")
        paths.add(record.path)
        filenames.add(record.filename)
        aliases.add(record.filename.casefold())
    # Compare the explicit emitted set with preparation output; do not discover
    # identities/routes from the previous ledger, HTML, or a filesystem tree.
    actual = {name for name in prepared.assets if name.endswith(".html") and name != "404.html"}
    if filenames != actual or len(records) != prepared.summary["localized_documents"]:
        raise ValueError("Emitted public document set changed")
    return tuple(sorted(records, key=lambda item: item.path))


def _styles(
    resources: BrowserResources, assets: Mapping[str, bytes]
) -> dict[str, BrowserResourceReference]:
    validated = validate_browser_resources(resources.record())
    if validated.seoStyle is None:
        raise ValueError("Recovery requires public page styles")
    refs = {"/seo-pages.css": validated.seoStyle, "/challenge-review.css": validated.styles}
    for ref in refs.values():
        raw = assets.get(ref.path)
        if not isinstance(raw, bytes) or len(raw) != ref.bytes or _sha(raw) != ref.sha256:
            raise ValueError("Recovery stylesheet integrity mismatch")
    return refs


class _StaticDocument(HTMLParser):
    """Narrow presentation transform that fails on unreviewed interactive markup."""

    _void = {"meta", "link", "img", "input"}
    _tags = {
        "html",
        "head",
        "meta",
        "title",
        "link",
        "body",
        "a",
        "header",
        "nav",
        "main",
        "section",
        "h1",
        "img",
        "p",
        "label",
        "input",
        "dl",
        "dt",
        "dd",
        "h2",
        "div",
        "table",
        "thead",
        "tr",
        "th",
        "tbody",
        "td",
        "ul",
        "li",
        "script",
    }

    _attributes = {
        "id",
        "class",
        "lang",
        "rel",
        "href",
        "hreflang",
        "charset",
        "name",
        "content",
        "http-equiv",
        "aria-label",
        "src",
        "width",
        "height",
        "alt",
        "scope",
        "type",
        "hidden",
        "data-maimai-browser",
        "data-maimai-modulepreload",
        "data-seo-page",
        "data-locale",
        "data-song-page",
        "data-song-id",
        "data-song-binding",
        "data-catalog-sha256",
        "data-seo-jp",
        "data-seo-intl",
        "data-seo-jp-src",
        "data-seo-intl-src",
        "data-open-browser",
        "data-back-results",
        "data-seo-international",
        "data-seo-version",
        "data-seo-jp-visible",
        "data-seo-intl-visible",
    }

    def __init__(
        self,
        record: EmittedPublicRoute,
        decisions: tuple[ChartRecoveryDecision, ...],
        styles: dict[str, BrowserResourceReference],
        routes: frozenset[str],
    ) -> None:
        super().__init__(convert_charrefs=True)
        self.record = record
        self.decisions = (decisions[0], *decisions) if decisions else ()
        self.styles = styles
        self.routes = routes
        self.output: list[str] = []
        self.stack: list[tuple[str, str, bool]] = []
        self.ids: set[str] = set()
        self.used_styles: set[str] = set()
        self.links = 0
        self.controls = 0
        self.labels = 0
        self.main = 0
        self.head = 0
        self.csp = 0
        self.canonical = 0
        self.replaced_label: str | None = None

    def handle_decl(self, decl: str) -> None:
        if decl.lower() != "doctype html":
            raise ValueError("Unknown public document declaration")
        self.output.append("<!doctype html>")

    def _checked_attributes(self, tag: str, items: list[tuple[str, str | None]]) -> Attributes:
        attrs = dict(items)
        if tag not in self._tags or len(attrs) != len(items) or set(attrs) - self._attributes:
            raise ValueError("Unknown or duplicate public markup needs review")
        if any(name.startswith("on") for name in attrs) or any(
            name in attrs for name in ("style", "contenteditable", "autofocus", "srcdoc")
        ):
            raise ValueError("Unreviewed interactive public attributes")
        identifier = attrs.get("id")
        if identifier:
            if identifier in self.ids:
                raise ValueError("Duplicate public element identity")
            self.ids.add(identifier)
        return attrs

    def _control(self, tag: str, attrs: Attributes) -> bool:
        """Validate the maintained control shape and return whether to suppress it."""
        if tag == "script":
            return True
        if tag == "label":
            if attrs != {"class": "check international-data-option"}:
                raise ValueError("Unknown public control needs review")
            self.labels += 1
            return True
        if attrs != {"type": "checkbox", "data-seo-international": None} or not (
            self.stack and self.stack[-1][0] == "label"
        ):
            raise ValueError("Unknown public control needs review")
        self.controls += 1
        return False

    def _metadata(self, attrs: Attributes) -> bool:
        if (attrs.get("http-equiv") or "").lower() == "content-security-policy":
            attrs["content"] = POLICY
            self.csp += 1
        elif "http-equiv" in attrs:
            raise ValueError("Unknown public redirect/control metadata")
        return attrs.get("name") in {"maimai-browser-base", "robots"}

    def _link(self, attrs: Attributes) -> Attributes:
        href = attrs.get("href", "") or ""
        if attrs.get("rel") == "stylesheet":
            reference = self.styles.get(href)
            if reference is None or href in self.used_styles:
                raise ValueError("Unknown or duplicate public stylesheet")
            self.used_styles.add(href)
            return {
                "rel": "stylesheet",
                "href": "/" + reference.path,
                "integrity": "sha256-" + b64encode(bytes.fromhex(reference.sha256)).decode(),
            }
        if attrs.get("rel") not in {"canonical", "alternate"} or not (
            href.startswith(ORIGIN) and href[len(ORIGIN) :] in self.routes
        ):
            raise ValueError("Unknown public link target")
        if attrs.get("rel") == "canonical":
            if href != ORIGIN + self.record.path:
                raise ValueError("Public canonical route changed")
            self.canonical += 1
        return attrs

    def _chart_link(self, attrs: Attributes) -> tuple[str, Attributes]:
        if self.links >= len(self.decisions):
            raise ValueError("Unexpected public chart link")
        decision = self.decisions[self.links]
        expected = "/?" + urlencode(
            {"view": "catalog", "chart": decision.chart_id, "lang": LOCALES[self.record.locale]}
        )
        if attrs.get("href") != expected:
            raise ValueError("Public chart link differs from emitted identity")
        if decision.target is None:
            self.replaced_label = UNAVAILABLE[self.record.locale]
            return "span", {"class": "muted", "data-recovery-reason": decision.reason}
        attrs["href"] = decision.target
        return "a", attrs

    def _anchor(self, attrs: Attributes) -> tuple[str, Attributes]:
        tag = "a"
        if "data-open-browser" in attrs:
            if self.record.kind == "song":
                tag, attrs = self._chart_link(attrs)
            else:
                attrs["href"] = "/"
            self.links += 1
        elif (
            attrs.get("href") not in {"/", "#seo-content"} and attrs.get("href") not in self.routes
        ):
            raise ValueError("Unknown public navigation target")
        return tag, attrs

    def _content(self, tag: str, attrs: Attributes) -> None:
        if tag == "main":
            if attrs.get("data-seo-page") != self.record.kind or (
                attrs.get("data-locale") != self.record.locale
            ):
                raise ValueError("Public route kind or locale changed")
            self.main += 1
        elif tag == "head":
            self.head += 1
        elif tag == "img":
            source = attrs.get("src", "") or ""
            if not source.startswith("/") or source.startswith("//"):
                raise ValueError("Unknown public image source")
        elif tag == "li" and self.record.kind == "version":
            if attrs.get("data-seo-jp-visible") not in {"true", "false"} or (
                attrs.get("data-seo-intl-visible") not in {"true", "false"}
                or attrs.get("data-seo-jp-visible") == attrs.get("data-seo-intl-visible") == "false"
            ):
                raise ValueError("Unknown public version membership")
            attrs.pop("hidden", None)

    def _append_start(self, tag: str, output_tag: str, attrs: Attributes) -> None:
        self.output.append(
            "<"
            + output_tag
            + "".join(
                " " + name + ("" if value is None else '="' + escape(value, quote=True) + '"')
                for name, value in attrs.items()
                if not name.startswith("data-")
                or name in {"data-seo-page", "data-locale", "data-recovery-reason"}
            )
            + ">"
        )
        if tag == "head":
            self.output.append(
                '<meta name="robots" content="noindex">'
                '<meta name="maimai-route-recovery" content="static-v1" data-path="'
                + escape(self.record.path, quote=True)
                + '">'
            )
        if tag == "main":
            self.output.append(
                '<p class="muted" role="status">' + escape(NOTICES[self.record.locale]) + "</p>"
            )

    def handle_starttag(self, tag: str, items: list[tuple[str, str | None]]) -> None:
        attrs = self._checked_attributes(tag, items)
        suppressed = bool(self.stack and self.stack[-1][2])
        output_tag = tag
        if tag in {"script", "label", "input"}:
            suppressed = self._control(tag, attrs) or suppressed
        elif tag == "meta":
            suppressed = self._metadata(attrs) or suppressed
        elif tag == "link":
            if attrs.get("rel") == "modulepreload":
                suppressed = True
            else:
                attrs = self._link(attrs)
        elif tag == "a":
            output_tag, attrs = self._anchor(attrs)
        else:
            self._content(tag, attrs)
        if not suppressed:
            self._append_start(tag, output_tag, attrs)
        if tag not in self._void:
            self.stack.append((tag, output_tag, suppressed))

    def handle_endtag(self, tag: str) -> None:
        if not self.stack or self.stack[-1][0] != tag:
            raise ValueError("Unbalanced public document markup")
        _, output_tag, suppressed = self.stack.pop()
        if not suppressed:
            self.output.append("</" + output_tag + ">")
        if tag == "a":
            self.replaced_label = None

    def handle_data(self, data: str) -> None:
        if self.stack and self.stack[-1][2]:
            return
        if self.replaced_label is not None:
            self.output.append(escape(self.replaced_label))
            self.replaced_label = ""
        else:
            self.output.append(escape(data))

    def finish(self, raw: bytes) -> bytes:
        self.feed(raw.decode("utf-8"))
        self.close()
        expected_links = len(self.decisions) if self.record.kind == "song" else 1
        if self.stack or (
            self.head,
            self.main,
            self.csp,
            self.canonical,
            self.labels,
            self.controls,
        ) != (1, 1, 1, 1, 1, 1):
            raise ValueError("Incomplete maintained public document")
        if self.links != expected_links or self.used_styles != set(self.styles):
            raise ValueError("Incomplete public chart links or styles")
        result = "".join(self.output).encode("utf-8")
        if len(result) > MAX_DOCUMENT_BYTES:
            raise ValueError("Recovery document exceeds reader limit")
        return result


def prepare_route_recovery(
    prepared: PreparedSEO,
    *,
    baseline_reference: dict[str, Any],
    baseline_catalog: bytes,
    resources: BrowserResources,
    resource_assets: Mapping[str, bytes],
    candidate_inventory_sha256: str,
    baseline_inventory_sha256: str,
    baseline_integration: bytes | None = None,
) -> PreparedRouteRecovery:
    """Prepare a finite overlay; callers bind it to and assemble the complete candidate."""
    if (
        not isinstance(candidate_inventory_sha256, str)
        or re.fullmatch(r"[a-f0-9]{64}", candidate_inventory_sha256) is None
    ):
        raise ValueError("Invalid candidate inventory binding")
    if (
        not isinstance(baseline_inventory_sha256, str)
        or re.fullmatch(r"[a-f0-9]{64}", baseline_inventory_sha256) is None
    ):
        raise ValueError("Invalid baseline inventory binding")
    baseline = decode_catalog_document(baseline_reference, baseline_catalog, baseline_integration)
    rows = baseline.data.get("catalog")
    if not isinstance(rows, list) or not all(
        isinstance(row, dict) and isinstance(row.get("chart_id"), str) for row in rows
    ):
        raise ValueError("Invalid baseline chart identities")
    identifiers = tuple(row["chart_id"] for row in rows)
    # Also validate empty and historical catalogs, not only IDs used by a route.
    decide_chart_recovery(identifiers, frozenset(), baseline.entry["version"])
    baseline_ids = frozenset(identifiers)
    records = _verify_routes(prepared)
    style_refs = _styles(resources, resource_assets)
    routes = frozenset(record.path for record in records)
    documents: list[RecoveryDocument] = []
    evidence_rows = []
    for record in records:
        decisions = decide_chart_recovery(record.chart_ids, baseline_ids, baseline.entry["version"])
        raw = _StaticDocument(record, decisions, style_refs, routes).finish(
            prepared.assets[record.filename]
        )
        document = RecoveryDocument(
            record.path, record.filename, raw, record.html_sha256, _sha(raw)
        )
        documents.append(document)
        evidence_rows.append(
            {
                "path": record.path,
                "filename": record.filename,
                "locale": record.locale,
                "kind": record.kind,
                "original_sha256": record.html_sha256,
                "decisions": [asdict(decision) for decision in decisions],
                "sha256": document.sha256,
                "bytes": len(raw),
            }
        )
    evidence = canonical(
        {
            "schema_version": "maimai-route-recovery-1",
            "candidate_inventory_sha256": candidate_inventory_sha256,
            "baseline_inventory_sha256": baseline_inventory_sha256,
            "baseline_catalog": baseline.entry,
            "styles": {name: asdict(ref) for name, ref in sorted(style_refs.items())},
            "documents": evidence_rows,
        }
    )
    return PreparedRouteRecovery(
        tuple(documents),
        evidence,
        _sha(evidence),
        candidate_inventory_sha256,
        baseline_inventory_sha256,
    )
